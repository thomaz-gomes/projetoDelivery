import { prisma } from '../prisma.js'
import events from '../utils/events.js'

/**
 * Save SEFAZ protocol/authorization response into DB.
 * Accepts an object with { companyId, orderId, nProt, cStat, xMotivo, rawXml }
 */
export async function saveNfeProtocol({ companyId, orderId, nProt, cStat, xMotivo, rawXml }) {
  if (!companyId) throw new Error('companyId is required')

  // create record; if nProt exists, return existing
  if (nProt) {
    const existing = await prisma.nfeProtocol.findUnique({ where: { nProt } })
    if (existing) return existing
  }

  const created = await prisma.nfeProtocol.create({
    data: {
      companyId,
      orderId: orderId || null,
      nProt: nProt || null,
      cStat: cStat || null,
      xMotivo: xMotivo || null,
      rawXml: rawXml || null,
    },
  })

  // If protocol indicates authorization (100), attach to order payload and emit an event to update frontend
  try {
    const cstatNum = Number(cStat)
    if (!Number.isNaN(cstatNum) && cstatNum === 100 && orderId) {
      // load order
      const order = await prisma.order.findUnique({ where: { id: orderId } })
      if (order) {
        // attach nfe info into payload JSON field (non-destructive)
        const oldPayload = order.payload || {}
        const nfeInfo = { nProt: nProt || null, cStat: cStat || null, xMotivo: xMotivo || null, authorizedAt: new Date() }
  const newPayload = { ...oldPayload, nfe: nfeInfo }
  // update order payload and set status to INVOICE_AUTHORIZED
  await prisma.order.update({ where: { id: orderId }, data: { payload: newPayload, status: 'INVOICE_AUTHORIZED' } })

        // emit app-level event so socket layer can notify frontend
        const payload = { id: order.id, displayId: order.displayId, status: order.status, nfe: nfeInfo }
        try { events.emit('nfe.authorized', payload) } catch (e) { console.warn('Failed to emit nfe.authorized', e) }
      }
    }
  } catch (e) {
    console.warn('Error handling post-protocol order update:', e)
  }

  // optional: if orderId provided, return combined object with order
  if (orderId) {
    const withOrder = await prisma.nfeProtocol.findUnique({ where: { id: created.id }, include: { order: true } })
    return withOrder
  }

  return created
}

export default { saveNfeProtocol }

/**
 * Resolve fiscal configuration for an order, preferring store-level settings when available.
 *
 * Returns an object with keys:
 *  - cnpj, ie, nfeSerie, nfeEnvironment, csc, cscId
 *  - certPath: absolute path to a .pfx certificate file (if found)
 *  - certExists: boolean
 *  - source: 'store' | 'company'
 *
 * This helper reads the public settings files under:
 *  - public/uploads/company/<companyId>/settings.json
 *  - public/uploads/store/<storeId>/settings.json
 * and checks for certificate files placed in secure/certs/ (filename stored in settings.certFilename)
 */
export async function getFiscalConfigForOrder(orderId) {
  if (!orderId) throw new Error('orderId is required')
  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { id: true, companyId: true, storeId: true } })
  if (!order) throw new Error('Order not found')

  const path = await import('path')
  const fs = await import('fs')
  const base = process.cwd()

  // Helper to load JSON settings file if present
  const loadSettings = async (type, id) => {
    try {
      const settingsPath = path.join(base, 'public', 'uploads', type, id, 'settings.json')
      if (fs.existsSync(settingsPath)) {
        const raw = await fs.promises.readFile(settingsPath, 'utf8')
        return JSON.parse(raw || '{}')
      }
    } catch (e) {
      // ignore parse errors
    }
    return {}
  }

  // Start with company-level settings
  const companyExtra = await loadSettings('company', order.companyId)
  const result = {
    cnpj: companyExtra.cnpj || null,
    ie: companyExtra.ie || null,
    nfeSerie: companyExtra.nfeSerie || null,
    nfeEnvironment: companyExtra.nfeEnvironment || null,
    csc: companyExtra.csc || null,
    cscId: companyExtra.cscId || null,
    certPath: null,
    certExists: false,
    source: 'company',
  }

  // company cert file (if present)
  if (companyExtra.certFilename) {
    const cp = path.join(base, 'secure', 'certs', String(companyExtra.certFilename))
    try { if (fs.existsSync(cp)) { result.certPath = cp; result.certExists = true } } catch (e) { /* ignore */ }
  }

  // If order is bound to a store, allow store overrides
  if (order.storeId) {
    const storeExtra = await loadSettings('store', order.storeId)
    // prefer store-level simple fields when present
    if (storeExtra.cnpj) result.cnpj = storeExtra.cnpj
    if (storeExtra.ie) result.ie = storeExtra.ie
    if (storeExtra.nfeSerie) result.nfeSerie = storeExtra.nfeSerie
    if (storeExtra.nfeEnvironment) result.nfeEnvironment = storeExtra.nfeEnvironment
    if (storeExtra.csc) result.csc = storeExtra.csc
    if (storeExtra.cscId) result.cscId = storeExtra.cscId

    // store-specified certificate filename (preferred)
    if (storeExtra.certFilename) {
      const sp = path.join(base, 'secure', 'certs', String(storeExtra.certFilename))
      try { if (fs.existsSync(sp)) { result.certPath = sp; result.certExists = true; result.source = 'store' } } catch (e) { /* ignore */ }
    }

    // also allow common store certificate filename patterns if explicit filename not present
    if (!result.certPath) {
      const candidates = [
        path.join(base, 'secure', 'certs', `${order.storeId}.pfx`),
        path.join(base, 'secure', 'certs', `store-${order.storeId}.pfx`),
      ]
      for (const c of candidates) {
        try { if (fs.existsSync(c)) { result.certPath = c; result.certExists = true; result.source = 'store'; break } } catch (e) { /* ignore */ }
      }
    }
  }

  // If we didn't set a store cert and company cert exists, keep company cert as source
  if (!result.certPath && result.certExists === false && companyExtra.certFilename) {
    const cp = path.join(base, 'secure', 'certs', String(companyExtra.certFilename))
    try { if (fs.existsSync(cp)) { result.certPath = cp; result.certExists = true; result.source = 'company' } } catch (e) { /* ignore */ }
  }

  // attach encrypted password where present (store first, then company); do not expose decrypted password here
  if (order.storeId) {
    try {
      const storeExtra = await loadSettings('store', order.storeId)
      if (storeExtra.certPasswordEnc) result.certPasswordEnc = storeExtra.certPasswordEnc
    } catch (e) {}
  }
  if (!result.certPasswordEnc && companyExtra.certPasswordEnc) result.certPasswordEnc = companyExtra.certPasswordEnc

  return result
}
