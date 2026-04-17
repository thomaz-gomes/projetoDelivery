/**
 * mdeService.js — Manifestação do Destinatário Eletrônica (MDe)
 *
 * Connects to SEFAZ NFeDistribuicaoDFe webservice (Ambiente Nacional)
 * to retrieve NFe documents destined to a company's CNPJ.
 */

import { prisma } from '../prisma.js';
import { loadCertConfig, getEmitenteConfig } from './nfe.js';
import { parseNfeXml } from './purchaseImportService.js';
import https from 'https';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import axios from 'axios';
import { parseStringPromise } from 'xml2js';
import forge from 'node-forge';
import crypto from 'crypto';

// MDe endpoints (Ambiente Nacional — not state-specific)
const MDE_ENDPOINTS = {
  production: 'https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx',
  homologation: 'https://hom1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx',
};

const SOAP_ACTION = 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe/nfeDistDFeInteresse';

// RecepcaoEvento endpoints (Ambiente Nacional)
const EVENTO_ENDPOINTS = {
  production: 'https://www.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx',
  homologation: 'https://hom1.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx',
};

const EVENTO_SOAP_ACTION = 'http://www.portalfiscal.inf.br/nfe/wsdl/RecepcaoEvento/nfeRecepcaoEvento';

// Default UF code for Bahia
const DEFAULT_CUFAUTOR = '29';

/**
 * Pad NSU to 15 digits with leading zeros.
 */
function padNsu(nsu) {
  return String(nsu || '0').padStart(15, '0');
}

/**
 * Build SOAP 1.2 envelope for NFeDistribuicaoDFe (consulta por chave de acesso).
 */
function buildConsChNFeEnvelope({ cnpj, chNFe, cUFAutor, tpAmb }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">
  <soap12:Header/>
  <soap12:Body>
    <nfeDistDFeInteresse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe">
      <nfeDadosMsg>
        <distDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01">
          <tpAmb>${tpAmb}</tpAmb>
          <cUFAutor>${cUFAutor}</cUFAutor>
          <CNPJ>${cnpj}</CNPJ>
          <consChNFe>
            <chNFe>${chNFe}</chNFe>
          </consChNFe>
        </distDFeInt>
      </nfeDadosMsg>
    </nfeDistDFeInteresse>
  </soap12:Body>
</soap12:Envelope>`;
}

/**
 * Build SOAP 1.2 envelope for NFeDistribuicaoDFe (consulta por último NSU).
 */
function buildDistDFeEnvelope({ cnpj, ultNSU, cUFAutor, tpAmb }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">
  <soap12:Header/>
  <soap12:Body>
    <nfeDistDFeInteresse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe">
      <nfeDadosMsg>
        <distDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01">
          <tpAmb>${tpAmb}</tpAmb>
          <cUFAutor>${cUFAutor}</cUFAutor>
          <CNPJ>${cnpj}</CNPJ>
          <distNSU>
            <ultNSU>${padNsu(ultNSU)}</ultNSU>
          </distNSU>
        </distDFeInt>
      </nfeDadosMsg>
    </nfeDistDFeInteresse>
  </soap12:Body>
</soap12:Envelope>`;
}

/**
 * Extract PEM key + base64 cert from a PFX buffer using node-forge.
 */
function extractPemFromPfx(pfxBuf, passphrase) {
  const raw = pfxBuf.toString('binary');
  const p12Asn1 = forge.asn1.fromDer(raw);
  let p12;
  try {
    p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, passphrase || '');
  } catch (e1) {
    if (passphrase) {
      try { p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, ''); } catch { throw e1; }
    } else { throw e1; }
  }
  let keyObj = null;
  const certs = [];
  for (const sc of p12.safeContents) {
    for (const sb of sc.safeBags) {
      if (sb.type === forge.pki.oids.certBag && sb.cert) certs.push(sb.cert);
      if (sb.type === forge.pki.oids.pkcs8ShroudedKeyBag || sb.type === forge.pki.oids.keyBag) keyObj = sb.key;
    }
  }
  if (!keyObj || !certs.length) throw new Error('Failed to extract key/cert from PFX');
  let certObj = certs[0];
  if (certs.length > 1) {
    const privMod = keyObj.n.toString(16);
    for (const c of certs) { if (c.publicKey.n.toString(16) === privMod) { certObj = c; break; } }
  }
  const privateKeyPem = forge.pki.privateKeyToPem(keyObj);
  const certPem = forge.pki.certificateToPem(certObj);
  const certB64 = forge.util.encode64(forge.pem.decode(certPem)[0].body);
  return { privateKeyPem, certPem, certB64 };
}

/**
 * Canonicalize XML (simple C14N — remove XML declaration, normalize whitespace between tags).
 */
function simpleC14n(xml) {
  return xml.replace(/<\?xml[^?]*\?>\s*/, '').replace(/>\s+</g, '><').trim();
}

/**
 * Sign an infEvento XML element with RSA-SHA1 (required by SEFAZ RecepcaoEvento).
 */
function signEventoXml(eventoXml, privateKeyPem, certB64) {
  // Extract the infEvento element
  const infEventoMatch = eventoXml.match(/<infEvento[^>]*Id="([^"]+)"[^>]*>[\s\S]*?<\/infEvento>/);
  if (!infEventoMatch) throw new Error('infEvento not found in evento XML');
  const infEventoXml = infEventoMatch[0];
  const refId = infEventoMatch[1];

  // Canonicalize infEvento
  const c14nInfEvento = simpleC14n(infEventoXml);

  // SHA-1 digest of canonicalized infEvento
  const digestHash = crypto.createHash('sha1').update(c14nInfEvento, 'utf8').digest('base64');

  // Build SignedInfo
  const signedInfo = `<SignedInfo xmlns="http://www.w3.org/2000/09/xmldsig#"><CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/><SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"/><Reference URI="#${refId}"><Transforms><Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"/><Transform Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/></Transforms><DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"/><DigestValue>${digestHash}</DigestValue></Reference></SignedInfo>`;

  // Sign the SignedInfo
  const signer = crypto.createSign('RSA-SHA1');
  signer.update(signedInfo);
  const signatureValue = signer.sign(privateKeyPem, 'base64');

  // Build Signature element
  const signatureXml = `<Signature xmlns="http://www.w3.org/2000/09/xmldsig#">${signedInfo}<SignatureValue>${signatureValue}</SignatureValue><KeyInfo><X509Data><X509Certificate>${certB64}</X509Certificate></X509Data></KeyInfo></Signature>`;

  // Insert Signature after </infEvento> but inside <evento>
  const signed = eventoXml.replace('</infEvento>', `</infEvento>${signatureXml}`);
  return signed;
}

/**
 * Build and sign SOAP envelope for RecepcaoEvento (manifestação).
 * tpEvento: 210200=Confirmacao, 210210=Ciencia, 210220=Desconhecimento, 210240=Nao Realizada
 */
function buildSignedEventoEnvelope({ cnpj, chNFe, tpEvento, nSeqEvento, tpAmb, cOrgao, privateKeyPem, certB64 }) {
  const dhEvento = new Date().toISOString().replace(/\.\d{3}Z$/, '-03:00');
  const idLote = Date.now().toString();
  const eventId = `ID${tpEvento}${chNFe}${String(nSeqEvento).padStart(2, '0')}`;

  const descEvento = tpEvento === '210210' ? 'Ciencia da Operacao'
    : tpEvento === '210200' ? 'Confirmacao da Operacao'
    : tpEvento === '210220' ? 'Desconhecimento da Operacao'
    : 'Operacao nao Realizada';

  const eventoXml = `<evento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00"><infEvento Id="${eventId}"><cOrgao>${cOrgao || DEFAULT_CUFAUTOR}</cOrgao><tpAmb>${tpAmb}</tpAmb><CNPJ>${cnpj}</CNPJ><chNFe>${chNFe}</chNFe><dhEvento>${dhEvento}</dhEvento><tpEvento>${tpEvento}</tpEvento><nSeqEvento>${nSeqEvento}</nSeqEvento><verEvento>1.00</verEvento><detEvento versao="1.00"><descEvento>${descEvento}</descEvento></detEvento></infEvento></evento>`;

  // Sign the evento
  const signedEvento = signEventoXml(eventoXml, privateKeyPem, certB64);

  return `<?xml version="1.0" encoding="UTF-8"?>
<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">
  <soap12:Header/>
  <soap12:Body>
    <nfeRecepcaoEvento xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/RecepcaoEvento">
      <nfeDadosMsg>
        <envEvento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00">
          <idLote>${idLote}</idLote>
          ${signedEvento}
        </envEvento>
      </nfeDadosMsg>
    </nfeRecepcaoEvento>
  </soap12:Body>
</soap12:Envelope>`;
}

/**
 * Send a manifestação event (210210 Ciência da Operação) to SEFAZ.
 * Requires certConfig with certPath/certBuffer + certPassword for signing.
 */
async function sendManifestacao({ cnpj, chNFe, tpEvento, tpAmb, httpsAgent, certConfig }) {
  const environment = tpAmb === '1' ? 'production' : 'homologation';
  const endpoint = EVENTO_ENDPOINTS[environment];

  // Extract PEM for XML signing
  let pfxBuf;
  if (certConfig.certBuffer) {
    pfxBuf = certConfig.certBuffer;
  } else if (certConfig.certPath) {
    pfxBuf = fs.readFileSync(certConfig.certPath);
  } else {
    throw new Error('Certificado necessario para assinar manifestacao');
  }
  const { privateKeyPem, certB64 } = extractPemFromPfx(pfxBuf, certConfig.certPassword || '');

  const envelope = buildSignedEventoEnvelope({
    cnpj,
    chNFe,
    tpEvento: tpEvento || '210210',
    nSeqEvento: 1,
    tpAmb,
    cOrgao: '91', // Manifestação is always processed at Ambiente Nacional
    privateKeyPem,
    certB64,
  });

  const headers = {
    'Content-Type': `application/soap+xml; charset=utf-8; action="${EVENTO_SOAP_ACTION}"`,
  };

  console.log(`[MDe] Sending signed manifestacao ${tpEvento || '210210'} for chNFe=${chNFe}`);

  let responseText;
  try {
    const res = await axios.post(endpoint, envelope, { headers, httpsAgent, timeout: 60000 });
    responseText = typeof res.data === 'string' ? res.data : res.data.toString();
  } catch (err) {
    // Capture SOAP fault body on HTTP errors (e.g. 500)
    const body = err?.response?.data;
    const statusCode = err?.response?.status;
    if (body) {
      console.warn(`[MDe] Manifestacao HTTP ${statusCode} response:`, typeof body === 'string' ? body.substring(0, 500) : JSON.stringify(body).substring(0, 500));
    }
    throw new Error(`SEFAZ RecepcaoEvento retornou HTTP ${statusCode || 'timeout'}: ${err?.message}`);
  }

  const parsed = await parseStringPromise(responseText, { explicitArray: false, ignoreAttrs: false });
  const retEvento = findKey(parsed, 'retEvento') || findKey(parsed, 'retEnvEvento');

  if (!retEvento) {
    console.warn('[MDe] Unexpected manifestacao response:', responseText.substring(0, 500));
    throw new Error('Resposta inesperada do SEFAZ para manifestacao');
  }

  const infEvento = findKey(retEvento, 'infEvento') || retEvento;
  const cStat = infEvento.cStat || retEvento.cStat || '';
  const xMotivo = infEvento.xMotivo || retEvento.xMotivo || '';

  console.log(`[MDe] Manifestacao response: cStat=${cStat}, xMotivo=${xMotivo}`);

  // 135 = Evento registrado e vinculado, 573 = Duplicidade de evento
  if (cStat === '135' || cStat === '573') {
    return { ok: true, cStat, xMotivo };
  }

  throw new Error(`Falha na manifestacao: cStat ${cStat} — ${xMotivo}`);
}

/**
 * Load certificate and create an HTTPS agent for mutual TLS.
 * Reuses the same PFX loading logic as nfe.js (loadCertConfig + node-forge).
 */
function loadCertAndCreateAgent(certConfig) {
  const { certPath, certBuffer, certPassword } = certConfig;
  const passphrase = certPassword || '';

  let pfxBuf;
  if (certBuffer) {
    pfxBuf = certBuffer;
  } else if (certPath) {
    if (!fs.existsSync(certPath)) throw new Error(`Arquivo de certificado nao encontrado: ${certPath}`);
    pfxBuf = fs.readFileSync(certPath);
  } else {
    throw new Error('Certificado digital A1 (.pfx) nao configurado para esta loja/empresa');
  }

  // Use node-forge to extract PEM (handles legacy PKCS12 algorithms from Brazilian CAs)
  try {
    const raw = pfxBuf.toString('binary');
    const p12Asn1 = forge.asn1.fromDer(raw);
    let p12;
    try {
      p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, passphrase);
    } catch (e1) {
      if (passphrase) {
        try { p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, ''); } catch { throw e1; }
      } else {
        throw e1;
      }
    }

    let keyObj = null;
    const certs = [];
    for (const safeContent of p12.safeContents) {
      for (const safeBag of safeContent.safeBags) {
        if (safeBag.type === forge.pki.oids.certBag && safeBag.cert) certs.push(safeBag.cert);
        if (safeBag.type === forge.pki.oids.pkcs8ShroudedKeyBag || safeBag.type === forge.pki.oids.keyBag) keyObj = safeBag.key;
      }
    }
    if (!keyObj || certs.length === 0) throw new Error('Falha ao extrair chave/certificado do PFX');

    let certObj = certs[0];
    if (certs.length > 1) {
      const privModulus = keyObj.n.toString(16);
      for (const c of certs) {
        if (c.publicKey.n.toString(16) === privModulus) { certObj = c; break; }
      }
    }

    const privateKeyPem = forge.pki.privateKeyToPem(keyObj);
    const certPem = forge.pki.certificateToPem(certObj);

    return new https.Agent({ key: privateKeyPem, cert: certPem, rejectUnauthorized: false });
  } catch (forgeErr) {
    // Fallback: try raw PFX (modern algorithms)
    console.warn('[MDe] node-forge PFX extraction failed, falling back to raw PFX:', forgeErr?.message);
    return new https.Agent({ pfx: pfxBuf, passphrase, rejectUnauthorized: false });
  }
}

/**
 * Decompress a base64-encoded gzipped XML string.
 */
function decompressDocZip(base64Content) {
  const buf = Buffer.from(base64Content, 'base64');
  return zlib.gunzipSync(buf).toString('utf-8');
}

/**
 * Extract key fields from a resNFe (summary) XML string.
 */
async function parseResNFe(xmlStr) {
  const parsed = await parseStringPromise(xmlStr, { explicitArray: false, ignoreAttrs: false });
  const res = parsed.resNFe || parsed['nfe:resNFe'] || parsed;
  return {
    chNFe: res.chNFe || null,
    CNPJ: res.CNPJ || null,
    xNome: res.xNome || null,
    vNF: res.vNF ? parseFloat(res.vNF) : null,
    dhEmi: res.dhEmi || null,
    tpNF: res.tpNF || null,
    cSitNFe: res.cSitNFe || null,
  };
}

/**
 * Determine the last NSU for a given store from existing MDE PurchaseImport records.
 * We store the NSU in the parsedItems JSON under a _mdeNsu key.
 */
async function getLastNsu(storeId, companyId) {
  // Find the highest NSU stored in MDE imports for this store
  const lastImport = await prisma.purchaseImport.findFirst({
    where: { storeId, companyId, source: 'MDE' },
    orderBy: { createdAt: 'desc' },
    select: { parsedItems: true },
  });

  if (lastImport?.parsedItems && typeof lastImport.parsedItems === 'object') {
    const nsu = lastImport.parsedItems._mdeNsu || lastImport.parsedItems._mdeMaxNSU;
    if (nsu) return String(nsu);
  }

  return '0';
}

/**
 * Sync NFe documents from SEFAZ MDe (NFeDistribuicaoDFe) for a given store.
 *
 * @param {string} storeId
 * @param {string} companyId
 * @returns {{ fetched: number, newImports: number, maxNSU: string, ultNSU: string }}
 */
export async function syncMde(storeId, companyId) {
  // 1. Load store info (CNPJ)
  const store = await prisma.store.findUnique({ where: { id: storeId }, select: { id: true, companyId: true, cnpj: true } });
  if (!store) throw new Error('Loja nao encontrada');
  if (store.companyId !== companyId) throw new Error('Loja nao pertence a esta empresa');

  // Get CNPJ — try store first, then emitente config
  let cnpj = store.cnpj ? store.cnpj.replace(/\D/g, '') : null;
  if (!cnpj) {
    const emitenteConfig = getEmitenteConfig(companyId, storeId);
    cnpj = emitenteConfig.cnpj ? emitenteConfig.cnpj.replace(/\D/g, '') : null;
  }
  if (!cnpj || cnpj.length !== 14) {
    throw new Error('CNPJ nao configurado para esta loja. Configure o CNPJ nas configuracoes da loja.');
  }

  // 2. Load certificate
  const certConfig = await loadCertConfig(companyId);
  // Also try store-level cert (same pattern as nfe.js loadStoreCert)
  const base = process.cwd();
  const storeCertCandidates = [
    path.join(base, 'settings', 'stores', storeId, 'settings.json'),
    path.join(base, 'public', 'uploads', 'store', storeId, 'settings.json'),
  ];
  for (const settingsPath of storeCertCandidates) {
    try {
      if (fs.existsSync(settingsPath)) {
        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8') || '{}');
        if (settings.certFilename) {
          const cp = path.join(base, 'secure', 'certs', String(settings.certFilename));
          if (fs.existsSync(cp)) {
            certConfig.certPath = cp;
            certConfig.certBuffer = fs.readFileSync(cp);
          }
        }
        if (settings.certPasswordEnc) {
          try {
            const { decryptText } = await import('../utils/secretStore.js');
            certConfig.certPassword = decryptText(settings.certPasswordEnc);
          } catch (e) {
            console.warn('[MDe] Failed to decrypt store cert password:', e?.message);
          }
        }
        if (certConfig.certPath) break;
      }
    } catch { /* ignore */ }
  }

  if (!certConfig.certPath && !certConfig.certBuffer) {
    throw new Error('Certificado digital A1 (.pfx) nao encontrado. Configure o certificado nas configuracoes fiscais.');
  }

  // 3. Create HTTPS agent
  const httpsAgent = loadCertAndCreateAgent(certConfig);

  // 4. Determine environment and last NSU
  const emitenteConfig = getEmitenteConfig(companyId, storeId);
  const tpAmb = emitenteConfig.nfeEnvironment === 'production' ? '1' : '2';
  const environment = tpAmb === '1' ? 'production' : 'homologation';
  const endpoint = MDE_ENDPOINTS[environment];

  const lastNsu = await getLastNsu(storeId, companyId);
  console.log(`[MDe] Syncing for store ${storeId}, CNPJ ${cnpj}, env=${environment}, lastNSU=${lastNsu}`);

  // 5. Build and send SOAP request
  const envelope = buildDistDFeEnvelope({
    cnpj,
    ultNSU: lastNsu,
    cUFAutor: DEFAULT_CUFAUTOR,
    tpAmb,
  });

  const headers = {
    'Content-Type': `application/soap+xml; charset=utf-8; action="${SOAP_ACTION}"`,
  };

  let responseText;
  try {
    const res = await axios.post(endpoint, envelope, { headers, httpsAgent, timeout: 60000 });
    responseText = typeof res.data === 'string' ? res.data : res.data.toString();
  } catch (err) {
    const msg = err?.response
      ? `SEFAZ retornou HTTP ${err.response.status}: ${typeof err.response.data === 'string' ? err.response.data.substring(0, 300) : JSON.stringify(err.response.data).substring(0, 300)}`
      : `Falha na comunicacao com SEFAZ MDe: ${err?.message || String(err)}`;
    throw new Error(msg);
  }

  // 6. Parse SOAP response
  const parsed = await parseStringPromise(responseText, { explicitArray: false, ignoreAttrs: false });

  // Navigate to retDistDFeInt (response body)
  const body = findKey(parsed, 'retDistDFeInt');
  if (!body) {
    console.warn('[MDe] Unexpected response structure:', JSON.stringify(parsed).substring(0, 500));
    throw new Error('Resposta inesperada do SEFAZ MDe — retDistDFeInt nao encontrado');
  }

  const cStat = body.cStat || '';
  const xMotivo = body.xMotivo || '';
  const maxNSU = body.maxNSU || '0';
  const ultNSUResp = body.ultNSU || lastNsu;

  console.log(`[MDe] Response: cStat=${cStat}, xMotivo=${xMotivo}, maxNSU=${maxNSU}, ultNSU=${ultNSUResp}`);

  // cStat 137 = no documents found, 138 = documents found
  if (cStat !== '137' && cStat !== '138') {
    // Other statuses may indicate errors
    if (cStat === '656' || cStat === '657') {
      // Save ultNSU/maxNSU on 656 so next sync uses the correct NSU
      // SEFAZ may return maxNSU=0 but ultNSU with the correct value
      const bestNsu = [ultNSUResp, maxNSU]
        .map(v => String(v || '0').replace(/^0+/, '') || '0')
        .sort((a, b) => parseInt(b, 10) - parseInt(a, 10))[0];
      const numericBest = parseInt(bestNsu, 10) || 0;
      if (numericBest > 0) {
        const paddedNsu = bestNsu.padStart(15, '0');
        try {
          await prisma.purchaseImport.create({
            data: {
              companyId, storeId, source: 'MDE', status: 'APPLIED',
              parsedItems: { _mdeActivation: true, _mdeMaxNSU: paddedNsu, _mdeNsu: paddedNsu },
            },
          });
          console.log(`[MDe] Saved NSU=${paddedNsu} on ${cStat} for store ${storeId} (ultNSU=${ultNSUResp}, maxNSU=${maxNSU})`);
        } catch { /* ignore duplicate */ }
      }
      throw new Error(`SEFAZ MDe: Consumo indevido (${cStat}) — ${xMotivo}. Aguarde 1 hora antes de tentar novamente.`);
    }
    throw new Error(`SEFAZ MDe retornou cStat ${cStat}: ${xMotivo}`);
  }

  // 7. Process docZip entries if documents were found
  let fetched = 0;
  let newImports = 0;

  if (cStat === '138') {
    const loteDistDFeInt = body.loteDistDFeInt;
    if (loteDistDFeInt) {
      let docZipEntries = loteDistDFeInt.docZip;
      if (!Array.isArray(docZipEntries)) docZipEntries = docZipEntries ? [docZipEntries] : [];

      for (const docZip of docZipEntries) {
        fetched++;
        try {
          // docZip may be an object with _ (content) and $ (attrs) or just a string
          const base64Content = typeof docZip === 'string' ? docZip : (docZip._ || docZip['$value'] || '');
          const nsu = typeof docZip === 'object' && docZip.$ ? docZip.$.NSU : null;

          if (!base64Content) continue;

          const xmlStr = decompressDocZip(base64Content);

          // Determine document type
          const isResNFe = xmlStr.includes('<resNFe') || xmlStr.includes(':resNFe');
          const isProcNFe = xmlStr.includes('<procNFe') || xmlStr.includes('<nfeProc') || xmlStr.includes(':nfeProc');
          const isResEvento = xmlStr.includes('<resEvento') || xmlStr.includes(':resEvento');

          if (isResEvento) {
            // Skip event summaries (cancellation events, etc.) for now
            console.log(`[MDe] Skipping resEvento NSU=${nsu}`);
            continue;
          }

          let importData = {
            companyId,
            storeId,
            source: 'MDE',
            status: 'PENDING',
          };

          if (isResNFe) {
            // Summary document
            const summary = await parseResNFe(xmlStr);
            if (!summary.chNFe) continue;

            // Only import incoming NFe (tpNF=1 means saida do emitente = entrada do destinatario)
            // tpNF=0 means entrada — less common in MDe context

            importData.accessKey = summary.chNFe;
            importData.supplierCnpj = summary.CNPJ || null;
            importData.supplierName = summary.xNome || null;
            importData.totalValue = summary.vNF || null;
            importData.issueDate = summary.dhEmi ? new Date(summary.dhEmi) : null;
            importData.rawXml = xmlStr;
            importData.parsedItems = { _mdeNsu: nsu || ultNSUResp, _mdeMaxNSU: maxNSU, _type: 'resNFe', cSitNFe: summary.cSitNFe };
          } else if (isProcNFe) {
            // Full authorized NFe — parse with the existing service
            try {
              const nfeData = await parseNfeXml(xmlStr);
              importData.accessKey = nfeData.accessKey || null;
              importData.nfeNumber = nfeData.nfeNumber || null;
              importData.nfeSeries = nfeData.nfeSeries || null;
              importData.issueDate = nfeData.issueDate || null;
              importData.supplierCnpj = nfeData.supplierCnpj || null;
              importData.supplierName = nfeData.supplierName || null;
              importData.totalValue = nfeData.totalValue || null;
              importData.rawXml = xmlStr;
              importData.parsedItems = {
                ...(nfeData.items ? { items: nfeData.items } : {}),
                _mdeNsu: nsu || ultNSUResp,
                _mdeMaxNSU: maxNSU,
                _type: 'procNFe',
              };
            } catch (parseErr) {
              console.warn(`[MDe] Failed to parse procNFe NSU=${nsu}:`, parseErr?.message);
              // Still create import with raw XML for manual processing
              importData.rawXml = xmlStr;
              importData.status = 'ERROR';
              importData.parsedItems = { _mdeNsu: nsu || ultNSUResp, _mdeMaxNSU: maxNSU, _type: 'procNFe', _parseError: parseErr?.message };
            }
          } else {
            // Unknown document type — store raw XML
            console.log(`[MDe] Unknown doc type NSU=${nsu}, storing raw`);
            importData.rawXml = xmlStr;
            importData.parsedItems = { _mdeNsu: nsu || ultNSUResp, _mdeMaxNSU: maxNSU, _type: 'unknown' };
          }

          // Skip if accessKey already exists
          if (importData.accessKey) {
            const existing = await prisma.purchaseImport.findUnique({
              where: { accessKey: importData.accessKey },
              select: { id: true },
            });
            if (existing) {
              console.log(`[MDe] Skipping duplicate accessKey ${importData.accessKey}`);
              continue;
            }
          } else {
            // No access key — use NSU as a pseudo-key to avoid duplicates
            // We skip documents without access keys that are not procNFe
            if (!isProcNFe && !isResNFe) continue;
          }

          await prisma.purchaseImport.create({ data: importData });
          newImports++;
        } catch (docErr) {
          console.error(`[MDe] Error processing docZip entry:`, docErr?.message || docErr);
        }
      }
    }
  }

  console.log(`[MDe] Sync complete: fetched=${fetched}, newImports=${newImports}, maxNSU=${maxNSU}`);

  return {
    fetched,
    newImports,
    maxNSU,
    ultNSU: ultNSUResp,
    cStat,
    xMotivo,
  };
}

/**
 * Fetch the full procNFe XML from SEFAZ for a resNFe (summary) import.
 * Uses consChNFe to request the document by access key.
 *
 * @param {string} importId - PurchaseImport ID
 * @param {string} companyId
 * @returns {{ ok: boolean, itemCount: number }}
 */
export async function fetchFullNFe(importId, companyId) {
  const importRecord = await prisma.purchaseImport.findUnique({ where: { id: importId } });
  if (!importRecord) throw new Error('Importacao nao encontrada');
  if (importRecord.companyId !== companyId) throw new Error('Acesso negado');
  if (!importRecord.accessKey) throw new Error('Importacao sem chave de acesso');

  const parsedItems = importRecord.parsedItems || {};
  if (parsedItems._type !== 'resNFe') {
    throw new Error('Esta importacao ja possui o XML completo');
  }

  const storeId = importRecord.storeId;
  const store = await prisma.store.findUnique({ where: { id: storeId }, select: { id: true, cnpj: true } });
  if (!store) throw new Error('Loja nao encontrada');

  let cnpj = store.cnpj ? store.cnpj.replace(/\D/g, '') : null;
  if (!cnpj) {
    const emitenteConfig = getEmitenteConfig(companyId, storeId);
    cnpj = emitenteConfig.cnpj ? emitenteConfig.cnpj.replace(/\D/g, '') : null;
  }
  if (!cnpj || cnpj.length !== 14) {
    throw new Error('CNPJ nao configurado para esta loja');
  }

  // Load certificate
  const certConfig = await loadCertConfig(companyId);
  const base = process.cwd();
  const storeCertCandidates = [
    path.join(base, 'settings', 'stores', storeId, 'settings.json'),
    path.join(base, 'public', 'uploads', 'store', storeId, 'settings.json'),
  ];
  for (const settingsPath of storeCertCandidates) {
    try {
      if (fs.existsSync(settingsPath)) {
        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8') || '{}');
        if (settings.certFilename) {
          const cp = path.join(base, 'secure', 'certs', String(settings.certFilename));
          if (fs.existsSync(cp)) {
            certConfig.certPath = cp;
            certConfig.certBuffer = fs.readFileSync(cp);
          }
        }
        if (settings.certPasswordEnc) {
          try {
            const { decryptText } = await import('../utils/secretStore.js');
            certConfig.certPassword = decryptText(settings.certPasswordEnc);
          } catch (e) {
            console.warn('[MDe] Failed to decrypt store cert password:', e?.message);
          }
        }
        if (certConfig.certPath) break;
      }
    } catch { /* ignore */ }
  }

  if (!certConfig.certPath && !certConfig.certBuffer) {
    throw new Error('Certificado digital nao encontrado');
  }

  const httpsAgent = loadCertAndCreateAgent(certConfig);
  const emitenteConfig = getEmitenteConfig(companyId, storeId);
  const tpAmb = emitenteConfig.nfeEnvironment === 'production' ? '1' : '2';
  const environment = tpAmb === '1' ? 'production' : 'homologation';
  const endpoint = MDE_ENDPOINTS[environment];

  console.log(`[MDe] Fetching full NFe for chNFe=${importRecord.accessKey}, store=${storeId}`);

  const envelope = buildConsChNFeEnvelope({
    cnpj,
    chNFe: importRecord.accessKey,
    cUFAutor: DEFAULT_CUFAUTOR,
    tpAmb,
  });

  const headers = {
    'Content-Type': `application/soap+xml; charset=utf-8; action="${SOAP_ACTION}"`,
  };

  let responseText;
  try {
    const res = await axios.post(endpoint, envelope, { headers, httpsAgent, timeout: 60000 });
    responseText = typeof res.data === 'string' ? res.data : res.data.toString();
  } catch (err) {
    const msg = err?.response
      ? `SEFAZ retornou HTTP ${err.response.status}`
      : `Falha na comunicacao com SEFAZ: ${err?.message || String(err)}`;
    throw new Error(msg);
  }

  const parsed = await parseStringPromise(responseText, { explicitArray: false, ignoreAttrs: false });
  const body = findKey(parsed, 'retDistDFeInt');
  if (!body) throw new Error('Resposta inesperada do SEFAZ');

  const cStat = body.cStat || '';
  const xMotivo = body.xMotivo || '';

  if (cStat === '656' || cStat === '657') {
    throw new Error(`SEFAZ: Consumo indevido (${cStat}) — Aguarde 1 hora antes de tentar novamente.`);
  }

  if (cStat !== '138') {
    throw new Error(`SEFAZ retornou cStat ${cStat}: ${xMotivo}`);
  }

  // Extract the docZip
  const loteDistDFeInt = body.loteDistDFeInt;
  if (!loteDistDFeInt) throw new Error('Resposta sem documentos');

  let docZipEntries = loteDistDFeInt.docZip;
  if (!Array.isArray(docZipEntries)) docZipEntries = docZipEntries ? [docZipEntries] : [];

  for (const docZip of docZipEntries) {
    const base64Content = typeof docZip === 'string' ? docZip : (docZip._ || docZip['$value'] || '');
    if (!base64Content) continue;

    const xmlStr = decompressDocZip(base64Content);
    const isProcNFe = xmlStr.includes('<procNFe') || xmlStr.includes('<nfeProc') || xmlStr.includes(':nfeProc');

    if (isProcNFe) {
      const nfeData = await parseNfeXml(xmlStr);

      // Update the import record with full data
      await prisma.purchaseImport.update({
        where: { id: importId },
        data: {
          rawXml: xmlStr,
          nfeNumber: nfeData.nfeNumber || importRecord.nfeNumber,
          nfeSeries: nfeData.nfeSeries || importRecord.nfeSeries,
          issueDate: nfeData.issueDate || importRecord.issueDate,
          supplierCnpj: nfeData.supplierCnpj || importRecord.supplierCnpj,
          supplierName: nfeData.supplierName || importRecord.supplierName,
          totalValue: nfeData.totalValue || importRecord.totalValue,
          parsedItems: {
            ...(nfeData.items ? { items: nfeData.items } : {}),
            _mdeNsu: parsedItems._mdeNsu,
            _mdeMaxNSU: parsedItems._mdeMaxNSU,
            _type: 'procNFe',
          },
        },
      });

      console.log(`[MDe] Updated import ${importId} with full procNFe (${nfeData.items?.length || 0} items)`);
      return { ok: true, itemCount: nfeData.items?.length || 0 };
    }
  }

  // XML completo não veio — tentar manifestar ciência e buscar novamente
  console.log(`[MDe] procNFe not found in response, attempting Ciencia da Operacao for chNFe=${importRecord.accessKey}`);

  try {
    await sendManifestacao({
      cnpj,
      chNFe: importRecord.accessKey,
      tpEvento: '210210',
      tpAmb,
      httpsAgent,
      certConfig,
    });
  } catch (manifErr) {
    console.warn(`[MDe] Manifestacao failed: ${manifErr?.message}`);
    throw new Error(`SEFAZ nao retornou o XML completo e a manifestacao de ciencia falhou: ${manifErr?.message}`);
  }

  // Wait a few seconds for SEFAZ to process the event
  await new Promise(resolve => setTimeout(resolve, 5000));

  // Retry fetch after manifestação
  console.log(`[MDe] Retrying fetch after Ciencia da Operacao for chNFe=${importRecord.accessKey}`);
  try {
    const retryRes = await axios.post(endpoint, envelope, { headers, httpsAgent, timeout: 60000 });
    const retryText = typeof retryRes.data === 'string' ? retryRes.data : retryRes.data.toString();

    const retryParsed = await parseStringPromise(retryText, { explicitArray: false, ignoreAttrs: false });
    const retryBody = findKey(retryParsed, 'retDistDFeInt');

    if (retryBody && retryBody.cStat === '138') {
      let retryDocs = retryBody.loteDistDFeInt?.docZip;
      if (!Array.isArray(retryDocs)) retryDocs = retryDocs ? [retryDocs] : [];

      for (const docZip of retryDocs) {
        const base64Content = typeof docZip === 'string' ? docZip : (docZip._ || docZip['$value'] || '');
        if (!base64Content) continue;

        const xmlStr = decompressDocZip(base64Content);
        const isProcNFe = xmlStr.includes('<procNFe') || xmlStr.includes('<nfeProc') || xmlStr.includes(':nfeProc');

        if (isProcNFe) {
          const nfeData = await parseNfeXml(xmlStr);
          await prisma.purchaseImport.update({
            where: { id: importId },
            data: {
              rawXml: xmlStr,
              nfeNumber: nfeData.nfeNumber || importRecord.nfeNumber,
              nfeSeries: nfeData.nfeSeries || importRecord.nfeSeries,
              issueDate: nfeData.issueDate || importRecord.issueDate,
              supplierCnpj: nfeData.supplierCnpj || importRecord.supplierCnpj,
              supplierName: nfeData.supplierName || importRecord.supplierName,
              totalValue: nfeData.totalValue || importRecord.totalValue,
              parsedItems: {
                ...(nfeData.items ? { items: nfeData.items } : {}),
                _mdeNsu: parsedItems._mdeNsu,
                _mdeMaxNSU: parsedItems._mdeMaxNSU,
                _type: 'procNFe',
              },
            },
          });

          console.log(`[MDe] Updated import ${importId} with full procNFe after Ciencia (${nfeData.items?.length || 0} items)`);
          return { ok: true, itemCount: nfeData.items?.length || 0 };
        }
      }
    }
  } catch (retryErr) {
    console.warn(`[MDe] Retry fetch after manifestacao failed: ${retryErr?.message}`);
  }

  throw new Error('Ciencia da Operacao enviada com sucesso, mas o XML completo ainda nao esta disponivel. Tente novamente em alguns minutos.');
}

/**
 * Activate MDe sync for a store — validates config (CNPJ + certificate)
 * and creates a local marker record. Does NOT call SEFAZ to avoid
 * consuming the 1-hour rate limit window before the first real sync.
 */
export async function activateMde(storeId, companyId) {
  // 1. Validate store + CNPJ
  const store = await prisma.store.findUnique({ where: { id: storeId }, select: { id: true, companyId: true, cnpj: true } });
  if (!store) throw new Error('Loja nao encontrada');
  if (store.companyId !== companyId) throw new Error('Loja nao pertence a esta empresa');

  let cnpj = store.cnpj ? store.cnpj.replace(/\D/g, '') : null;
  if (!cnpj) {
    const emitenteConfig = getEmitenteConfig(companyId, storeId);
    cnpj = emitenteConfig.cnpj ? emitenteConfig.cnpj.replace(/\D/g, '') : null;
  }
  if (!cnpj || cnpj.length !== 14) {
    throw new Error('CNPJ nao configurado para esta loja. Configure o CNPJ nas configuracoes da loja.');
  }

  // 2. Validate certificate exists
  const certConfig = await loadCertConfig(companyId);
  const base = process.cwd();
  const storeCertCandidates = [
    path.join(base, 'settings', 'stores', storeId, 'settings.json'),
    path.join(base, 'public', 'uploads', 'store', storeId, 'settings.json'),
  ];
  for (const settingsPath of storeCertCandidates) {
    try {
      if (fs.existsSync(settingsPath)) {
        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8') || '{}');
        if (settings.certFilename) {
          const cp = path.join(base, 'secure', 'certs', String(settings.certFilename));
          if (fs.existsSync(cp)) {
            certConfig.certPath = cp;
          }
        }
        if (certConfig.certPath) break;
      }
    } catch { /* ignore */ }
  }

  if (!certConfig.certPath && !certConfig.certBuffer) {
    throw new Error('Certificado digital A1 (.pfx) nao encontrado. Configure o certificado nas configuracoes fiscais.');
  }

  // 3. Create activation marker (no SEFAZ call — first sync will handle it)
  await prisma.purchaseImport.create({
    data: {
      companyId,
      storeId,
      source: 'MDE',
      status: 'APPLIED',
      parsedItems: { _mdeActivation: true, _mdeMaxNSU: '0', _mdeNsu: '0' },
    },
  });

  console.log(`[MDe] Activated for store ${storeId}, CNPJ ${cnpj} — ready for first sync`);
  return { activated: true };
}

/**
 * Get MDe sync status for a store — last sync time, pending count, and activation state.
 */
export async function getMdeStatus(storeId, companyId) {
  const [lastSync, pendingCount, totalCount] = await Promise.all([
    prisma.purchaseImport.findFirst({
      where: { storeId, companyId, source: 'MDE' },
      orderBy: { createdAt: 'desc' },
      select: { id: true, createdAt: true, parsedItems: true },
    }),
    prisma.purchaseImport.count({
      where: { storeId, companyId, source: 'MDE', status: 'PENDING' },
    }),
    prisma.purchaseImport.count({
      where: { storeId, companyId, source: 'MDE' },
    }),
  ]);

  // Check if MDe has been activated (has any MDE record at all)
  const activated = totalCount > 0;

  return {
    lastSyncAt: lastSync?.createdAt || null,
    lastNSU: lastSync?.parsedItems?._mdeNsu || lastSync?.parsedItems?._mdeMaxNSU || '0',
    pendingCount,
    totalCount,
    activated,
  };
}

/**
 * Recursively search for a key in a nested object.
 */
function findKey(obj, key) {
  if (!obj || typeof obj !== 'object') return null;
  if (key in obj) return obj[key];
  for (const k of Object.keys(obj)) {
    const res = findKey(obj[k], key);
    if (res) return res;
  }
  return null;
}

export default { syncMde, getMdeStatus, activateMde, fetchFullNFe };
