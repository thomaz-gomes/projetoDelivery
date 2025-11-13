import path from 'path'
import fs from 'fs-extra'
import { generateNFCeXml } from './generate'
import { readPfx, readPfxFromBuffer, signXml } from './sign'
import { loadConfig } from './config'
import { validateXmlWithDir } from './validate'
import { sendNFCeToSefaz } from './soap'
import axios from 'axios'

export async function generateAndSignSimpleNFCe(example: {
  cnpj: string
  companyName: string
  uf: string
  serie: string
  nNF: string
  itens: Array<{ id: number; prodName: string; vProd: string; vUnCom?: string; qCom?: string; ncm?: string; cfop?: string; unity?: string }>
}, options?: { certPath?: string; certBuffer?: Buffer; certPassword?: string; companyId?: string }) {
  const cfg = loadConfig()
  const xml = await generateNFCeXml({ ...example })

  // If XSDs dir configured, attempt validation before signing
  try {
    if (cfg.xsdsDir) {
      // main NFe xsd filename may vary; try common name and report errors
      const xsdName = 'NFe_v4.00.xsd'
      const res = await validateXmlWithDir(xml, cfg.xsdsDir, xsdName)
      if (!res.valid) {
        throw new Error('XML validation failed: ' + JSON.stringify(res.errors, null, 2))
      }
    }
  } catch (e) {
    // bubble up validation error
    throw new Error('XML validation step failed: ' + ((e as any)?.message || String(e)))
  }

  // read pfx and sign - support dynamic certificate per call (SAAS)
  let privateKeyPem: string
  let certPem: string
  let certB64: string
  const password = options?.certPassword || cfg.certPassword
  if (options?.certBuffer) {
    const r = readPfxFromBuffer(options.certBuffer, password)
    privateKeyPem = r.privateKeyPem
    certPem = r.certPem
    certB64 = r.certB64
  } else {
    const effectivePath = options?.certPath || cfg.certPath
    const pfxPath = path.isAbsolute(effectivePath) ? effectivePath : path.join(process.cwd(), effectivePath)
    const r = readPfx(pfxPath, password)
    privateKeyPem = r.privateKeyPem
    certPem = r.certPem
    certB64 = r.certB64
  }
  const signed = signXml(xml, privateKeyPem, certB64)

  // save signed XML to emitidas dir
  const dir = path.isAbsolute(cfg.xmlDirs.emitidas) ? cfg.xmlDirs.emitidas : path.join(process.cwd(), cfg.xmlDirs.emitidas)
  await fs.mkdirp(dir)
  const filename = `nfe-${example.serie}-${example.nNF}-${Date.now()}.xml`
  const outPath = path.join(dir, filename)
  await fs.writeFile(outPath, signed, 'utf8')

  return { signedXml: signed, path: outPath }
}

export default { generateAndSignSimpleNFCe }

/**
 * Helper: load company certificate file from a configured certs directory.
 * This is a simple example for SAAS where each company may have its own PFX
 * stored as <companyId>.pfx under the configured certsDir in config.json.
export async function sendSignedNFCe(signedXml: string, options?: { certBuffer?: Buffer; certPath?: string; certPassword?: string; environment?: 'homologation'|'production'; uf?: string }) {
  // delegate to soap.ts which will use mutual TLS with provided pfx
  const res = await sendNFCeToSefaz(signedXml, { certBuffer: options?.certBuffer, certPath: options?.certPath, certPassword: options?.certPassword, environment: options?.environment, uf: options?.uf })
  return res
}
 */
export async function loadCompanyCertBuffer(companyId: string) {
  const cfg = loadConfig()
  if (!cfg || !('certsDir' in cfg)) return null
  const dir = (cfg as any).certsDir
  const p = path.isAbsolute(dir) ? path.join(dir, `${companyId}.pfx`) : path.join(process.cwd(), dir, `${companyId}.pfx`)
  try {
    if (await fs.pathExists(p)) {
      return await fs.readFile(p)
    }
    return null
  } catch (e) {
    return null
  }
}

/**
 * Send signed XML to SEFAZ and optionally persist the returned protocol to a backend
 * persistenceUrl: optional base URL of the delivery-saas-backend (ex: https://localhost:3000)
 * persistPayload: { companyId, orderId? }
 */
export async function sendAndPersist(signedXml: string, sendOpts?: { certBuffer?: Buffer; certPath?: string; certPassword?: string; environment?: 'homologation'|'production'; uf?: string }, persistenceOpts?: { persistenceUrl?: string; companyId?: string; orderId?: string }) {
  const res = await sendNFCeToSefaz(signedXml, { certBuffer: sendOpts?.certBuffer, certPath: sendOpts?.certPath, certPassword: sendOpts?.certPassword, environment: sendOpts?.environment, uf: sendOpts?.uf, wsSecurity: true })

  // If persistence URL provided, call backend to save protocol
  if (persistenceOpts?.persistenceUrl && persistenceOpts?.companyId) {
    try {
      const url = `${persistenceOpts.persistenceUrl.replace(/\/$/, '')}/nfe/protocol`
      const payload: any = {
        companyId: persistenceOpts.companyId,
        orderId: persistenceOpts.orderId || null,
        nProt: res.protocolo || null,
        cStat: res.cStat || null,
        xMotivo: res.xMotivo || null,
        rawXml: res.raw || null,
      }
      await axios.post(url, payload, { timeout: 10000 })
    } catch (err) {
      // don't throw — persistence failure should not hide SEFAZ response
      // eslint-disable-next-line no-console
      console.warn('Failed to persist NFe protocol to backend:', (err as Error).message)
    }
  }

  return res
}
