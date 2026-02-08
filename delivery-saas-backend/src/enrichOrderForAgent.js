/**
 * enrichOrderForAgent.js
 *
 * Enriquece o payload de um pedido com:
 *   1. Dados completos do DB (address, items, payload, customerName, etc.)
 *   2. Configurações de impressão (template, cópias, nome da impressora)
 *   3. Campos derivados (qrText, address) resolvidos para top-level
 *
 * Garante que o agente sempre receba todos os dados necessários para imprimir,
 * independente de qual code path originou a emissão (agentPrint, printQueue,
 * webhooks, emitirNovoPedido).
 */
import { prisma } from './prisma.js'

export async function enrichOrderForAgent(order) {
  if (!order) return order

  try {
    // 1. Se o order só tem id (dados parciais), buscar o registro completo do DB
    if (order.id && (!order.items || !Array.isArray(order.items) || order.items.length === 0)) {
      try {
        const full = await prisma.order.findUnique({
          where: { id: order.id },
          include: { items: true }
        })
        if (full) {
          // Mesclar: campos do DB como base, campos existentes no order como override
          const merged = Object.assign({}, full, order)
          // Preservar items do DB se o order não tinha
          if (!order.items || !Array.isArray(order.items) || order.items.length === 0) {
            merged.items = full.items
          }
          // Preservar payload do DB (mais completo) mesclando com eventuais campos extras
          if (full.payload && order.payload) {
            merged.payload = Object.assign({}, full.payload, order.payload)
          } else if (full.payload) {
            merged.payload = full.payload
          }
          Object.assign(order, merged)
        }
      } catch (e) {
        console.warn('enrichOrderForAgent: failed to load full order from DB:', e && e.message)
      }
    }

    // 2. Resolver companyId
    let companyId = order.companyId || (order.payload && order.payload.companyId) || null

    if (!companyId && order.storeId) {
      try {
        const store = await prisma.store.findUnique({
          where: { id: order.storeId },
          select: { companyId: true }
        })
        if (store) companyId = store.companyId
      } catch (e) { /* ignore */ }
    }

    // 3. Resolver qrText de payload.qrText para top-level (qrText não é campo do modelo Order)
    if (!order.qrText) {
      const p = order.payload || {}
      order.qrText = p.qrText || p.qr_text || null
    }

    // 4. Resolver address se ausente - buscar de payload.delivery.deliveryAddress
    if (!order.address || order.address === '-') {
      try {
        const p = order.payload || {}
        const da = (p.delivery && p.delivery.deliveryAddress) || p.deliveryAddress || null
        if (da && typeof da === 'object') {
          if (da.formattedAddress) {
            order.address = da.formattedAddress
          } else {
            const parts = []
            if (da.streetName || da.street || da.logradouro) parts.push(da.streetName || da.street || da.logradouro)
            if (da.streetNumber || da.number || da.numero) parts.push(da.streetNumber || da.number || da.numero)
            if (da.complement || da.complemento) parts.push(da.complement || da.complemento)
            if (da.neighborhood || da.bairro) parts.push(da.neighborhood || da.bairro)
            if (da.city || da.cidade) parts.push(da.city || da.cidade)
            if (parts.length) order.address = parts.join(', ')
          }
        }
        // Fallback: rawPayload.address
        if (!order.address || order.address === '-') {
          const raw = p.rawPayload && p.rawPayload.address
          if (raw && typeof raw === 'string') order.address = raw
          else if (raw && typeof raw === 'object') {
            if (raw.formattedAddress) order.address = raw.formattedAddress
            else {
              const rp = []
              if (raw.street || raw.logradouro) rp.push(raw.street || raw.logradouro)
              if (raw.number || raw.numero) rp.push(raw.number || raw.numero)
              if (raw.neighborhood || raw.bairro) rp.push(raw.neighborhood || raw.bairro)
              if (raw.city) rp.push(raw.city)
              if (rp.length) order.address = rp.join(', ')
            }
          }
        }
      } catch (e) { /* ignore */ }
    }

    if (!companyId) return order

    // 5. Buscar PrinterSetting da empresa
    const ps = await prisma.printerSetting.findUnique({
      where: { companyId }
    })

    if (ps) {
      order.receiptTemplate = ps.receiptTemplate || null
      order.copies = ps.copies || 1
      order.printerName = ps.printerName || null
      order.headerName = ps.headerName || null
      order.headerCity = ps.headerCity || null
      order.printerInterface = ps.interface || null
      order.printerType = ps.type || null
      order.paperWidth = ps.width || null
    }
  } catch (e) {
    console.warn('enrichOrderForAgent failed:', e && e.message)
  }

  return order
}
