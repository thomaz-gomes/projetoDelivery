import axios from 'axios'
import https from 'https'
import fs from 'fs'
import { parseStringPromise } from 'xml2js'
import path from 'path'
import { loadConfig } from './config'
import { readPfx, readPfxFromBuffer } from './sign'
import { SignedXml } from 'xml-crypto'

// Stable WS-Security token id used in BinarySecurityToken and SecurityTokenReference
const WSSEC_TOKEN_ID = 'X509-Token'

export type SendOptions = {
  certBuffer?: Buffer
  certPath?: string
  certPassword?: string
  environment?: 'homologation' | 'production'
  uf?: string // state code (ex: 'ba')
  mod?: string // '55' for NF-e, '65' for NFC-e (default: '65')
  wsSecurity?: boolean // include WS-Security header (BinarySecurityToken + Timestamp)
  signSoap?: boolean // attempt to sign the SOAP Body using the provided cert/key
}

/**
 * Build a SOAP 1.2 envelope for NFe/NFC-e Autorizacao.
 * mod='55' → NFeAutorizacao4 namespace (NF-e)
 * mod='65' → NfceAutorizacao4 namespace by default, but if the endpoint URL uses
 *             NFeAutorizacao4 (e.g. SVRS states like BA), that namespace is used instead.
 */
function buildAutorizacaoEnvelope(signedXml: string, mod: string = '65', headerXml?: string, endpoint?: string) {
  const lote = Date.now().toString()
  const useNfeNs = mod === '55' || (!!endpoint && /NFeAutorizacao/i.test(endpoint))
  const ns = useNfeNs
    ? 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4'
    : 'http://www.portalfiscal.inf.br/nfe/wsdl/NfceAutorizacao4'
  // Strip XML declaration from signedXml before embedding (SEFAZ rejects it inside SOAP body)
  const innerXml = signedXml.trim().replace(/^<\?xml[^?]*\?>\s*/i, '')
  // enviNFe must have NO whitespace between tags (SEFAZ cStat 588 otherwise)
  return `<?xml version="1.0" encoding="UTF-8"?>\n<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">\n  <soap12:Header>${headerXml || ''}</soap12:Header>\n  <soap12:Body>\n    <nfeDadosMsg xmlns="${ns}"><enviNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><idLote>${lote}</idLote><indSinc>1</indSinc>${innerXml}</enviNFe></nfeDadosMsg>\n  </soap12:Body>\n</soap12:Envelope>`
}

function buildWsSecurityHeader(certB64: string) {
  const created = new Date().toISOString()
  const expires = new Date(Date.now() + 5 * 60 * 1000).toISOString()
  return `<wsse:Security xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">\n    <wsu:Timestamp wsu:Id="TS-${Date.now()}">\n      <wsu:Created>${created}</wsu:Created>\n      <wsu:Expires>${expires}</wsu:Expires>\n    </wsu:Timestamp>\n    <wsse:BinarySecurityToken EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary" ValueType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-x509-token-profile-1.0#X509v3" wsu:Id="${WSSEC_TOKEN_ID}">\n      ${certB64}\n    </wsse:BinarySecurityToken>\n  </wsse:Security>`
}

/**
 * Send signed NFC-e XML to SEFAZ Authorization endpoint using SOAP 1.2 with mutual TLS.
 * Supports providing PFX as buffer or file path. Returns parsed XML response.
 */
export async function sendNFCeToSefaz(signedXml: string, opts: SendOptions = {}) {
  const cfg = loadConfig()
  const env = opts.environment || cfg.environment || 'homologation'
  const uf = (opts.uf || 'ba').toLowerCase()

  // Auto-detect mod from XML if not provided (look for <mod>65</mod>)
  let mod = opts.mod || '65'
  if (!opts.mod) {
    const modMatch = signedXml.match(/<mod>(\d+)<\/mod>/)
    if (modMatch) mod = modMatch[1]
  }

  // resolve endpoint from config.sefaz
  const sefazCfg = (cfg.sefaz && cfg.sefaz[uf]) || null
  if (!sefazCfg) throw new Error(`SEFAZ config for UF '${uf}' not found in config.json`)

  // Use NFC-e endpoint (nfce) when mod=65, fallback to NF-e endpoint (nfe)
  const endpointKey = mod === '55' ? 'nfe' : 'nfce'
  const endpoint = (sefazCfg[env] && (sefazCfg[env][endpointKey] || sefazCfg[env].nfe))
  if (!endpoint) throw new Error(`${endpointKey.toUpperCase()} endpoint for UF '${uf}' environment '${env}' not configured`)

  // SOAP action: use NFeAutorizacao4 when endpoint uses that service (e.g. SVRS/BA for NFC-e)
  const useNfeAction = mod === '55' || /NFeAutorizacao/i.test(endpoint)
  const soapAction = useNfeAction
    ? 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4/nfeAutorizacaoLote'
    : 'http://www.portalfiscal.inf.br/nfe/wsdl/NfceAutorizacao4/nfceAutorizacaoLote'

  const envelope = buildAutorizacaoEnvelope(signedXml, mod, undefined, endpoint)
  // optionally build WS-Security header and/or sign SOAP body
  let headerXml: string | undefined
  if (opts.wsSecurity) {
    // obtain cert (base64) to include
    let certB64: string | undefined
    let privateKeyPem: string | undefined
    if (opts.certBuffer) {
      const info = readPfxFromBuffer(opts.certBuffer, opts.certPassword ?? '')
      certB64 = info.certB64
      privateKeyPem = info.privateKeyPem
    } else if (opts.certPath) {
      const info = readPfx(opts.certPath, opts.certPassword ?? '')
      certB64 = info.certB64
      privateKeyPem = info.privateKeyPem
    } else if (cfg.certPath) {
      const p = path.isAbsolute(cfg.certPath) ? cfg.certPath : path.join(process.cwd(), cfg.certPath)
      if (fs.existsSync(p)) {
        const info = readPfx(p, opts.certPassword ?? cfg.certPassword ?? '')
        certB64 = info.certB64
        privateKeyPem = info.privateKeyPem
      }
    }

    if (certB64) {
      headerXml = buildWsSecurityHeader(certB64)

      // if signing is requested, attempt to sign the SOAP Body and insert Signature under wsse:Security
      if (opts.signSoap && privateKeyPem) {
        try {
          // build envelope with header so signature references the Body
          const envWithHeader = buildAutorizacaoEnvelope(signedXml, mod, headerXml, endpoint)
          const sig = new SignedXml()
          sig.signatureAlgorithm = 'http://www.w3.org/2000/09/xmldsig#rsa-sha1'
          // reference SOAP Body
          sig.addReference("//*[local-name(.)='Body']", ['http://www.w3.org/2000/09/xmldsig#enveloped-signature', 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315'], 'http://www.w3.org/2000/09/xmldsig#sha1')
          sig.signingKey = privateKeyPem
          // include SecurityTokenReference that points to BinarySecurityToken
          sig.keyInfoProvider = {
            getKeyInfo: function () {
              return `<wsse:SecurityTokenReference xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd"><wsse:Reference URI="#${WSSEC_TOKEN_ID}" ValueType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-x509-token-profile-1.0#X509v3"/></wsse:SecurityTokenReference>`
            }
          } as any

          sig.computeSignature(envWithHeader)
          const signedFull = sig.getSignedXml()
          // extract <Signature...>...</Signature>
          const m = signedFull.match(/<Signature[\s\S]*?<\/Signature>/)
          if (m) {
            const signatureXml = m[0]
            // insert signatureXml before closing </wsse:Security>
            headerXml = headerXml.replace('</wsse:Security>', `${signatureXml}</wsse:Security>`)
          }
        } catch (err) {
          // continue without SOAP signature but log
          // eslint-disable-next-line no-console
          console.warn('SOAP signing failed (continuing without signature):', (err as Error).message)
        }
      }
    }
  }

  const envelopeWithHeader = buildAutorizacaoEnvelope(signedXml, mod, headerXml, endpoint)

  // Build HTTPS agent with client certificate (mutual TLS) if provided.
  // Use node-forge to extract PEM key+cert from PFX instead of passing the raw
  // PFX buffer to Node's https.Agent — Node.js 17+ uses OpenSSL 3.0 which
  // rejects legacy PKCS12 encryption (RC2/DES) commonly used by Brazilian CAs.
  let httpsAgent: https.Agent | undefined
  if (opts.certBuffer || opts.certPath || cfg.certPath) {
    const passphrase = opts.certPassword ?? cfg.certPassword ?? ''
    let pfxBuf: Buffer | undefined
    if (opts.certBuffer) pfxBuf = opts.certBuffer
    else {
      const cp = opts.certPath || cfg.certPath
      const p = path.isAbsolute(cp) ? cp : path.join(process.cwd(), cp)
      if (!fs.existsSync(p)) throw new Error(`Certificate file not found: ${p}`)
      pfxBuf = fs.readFileSync(p)
    }
    try {
      // Extract PEM via node-forge (handles legacy PKCS12 algorithms)
      const pemInfo = opts.certBuffer
        ? readPfxFromBuffer(pfxBuf!, passphrase)
        : (opts.certPath ? readPfx(opts.certPath, passphrase) : readPfx(cfg.certPath, passphrase))
      httpsAgent = new https.Agent({
        key: pemInfo.privateKeyPem,
        cert: pemInfo.certPem,
        rejectUnauthorized: false
      })
    } catch (forgeErr) {
      // Fallback: try raw PFX in case the cert uses modern algorithms
      // eslint-disable-next-line no-console
      console.warn('node-forge PFX extraction failed, falling back to raw PFX:', (forgeErr as Error).message)
      httpsAgent = new https.Agent({ pfx: pfxBuf, passphrase, rejectUnauthorized: false })
    }
  }

  const headers: Record<string, string> = {
    'Content-Type': `application/soap+xml; charset=utf-8; action="${soapAction}"`
  }

  const res = await axios.post(endpoint, envelopeWithHeader, { headers, httpsAgent, timeout: 60000 })
  const text = typeof res.data === 'string' ? res.data : res.data.toString()

  // persist raw response to disk if configured
  try {
    const xmlDirs = cfg.xmlDirs || {}
    const retornoDir = xmlDirs.retorno ? (path.isAbsolute(xmlDirs.retorno) ? xmlDirs.retorno : path.join(process.cwd(), xmlDirs.retorno)) : null
    if (retornoDir) {
      fs.mkdirSync(retornoDir, { recursive: true })
      const fname = `sefaz_response_${(new Date()).toISOString().replace(/[:.]/g, '-')}.xml`
      fs.writeFileSync(path.join(retornoDir, fname), text, 'utf8')
    }
  } catch (err) {
    // don't fail on save errors
    // eslint-disable-next-line no-console
    console.warn('Failed to save SEFAZ response to disk:', (err as Error).message)
  }

  // parse XML response
  const parsed = await parseStringPromise(text, { explicitArray: false, ignoreAttrs: false })

  // try to locate protocol info (protNFe / infProt) and return a concise summary
  function findKey(o: any, key: string): any {
    if (!o || typeof o !== 'object') return null
    if (key in o) return o[key]
    for (const k of Object.keys(o)) {
      const res = findKey(o[k], key)
      if (res) return res
    }
    return null
  }

  const protNFe = findKey(parsed, 'protNFe') || findKey(parsed, 'protNFe')
  const infProt = protNFe ? (protNFe.infProt || protNFe) : findKey(parsed, 'infProt')
  let protocolo: string | undefined
  let cStat: string | undefined
  let xMotivo: string | undefined
  if (infProt) {
    protocolo = infProt.nProt || infProt.prot || undefined
    cStat = infProt.cStat || undefined
    xMotivo = infProt.xMotivo || infProt.xMotivo || undefined
  }

  // If no protocol-level info found, check batch-level rejection (retEnviNFe)
  if (!cStat) {
    const retEnvi = findKey(parsed, 'retEnviNFe')
    if (retEnvi) {
      cStat = retEnvi.cStat || undefined
      xMotivo = retEnvi.xMotivo || undefined
    }
  }

  // eslint-disable-next-line no-console
  console.log('[soap] SEFAZ parsed result:', { cStat, xMotivo, protocolo, hasProtNFe: !!protNFe })

  return { raw: text, parsed, protocolo, cStat, xMotivo }
}

export default { sendNFCeToSefaz }
