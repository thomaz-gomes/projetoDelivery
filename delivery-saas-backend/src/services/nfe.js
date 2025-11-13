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
