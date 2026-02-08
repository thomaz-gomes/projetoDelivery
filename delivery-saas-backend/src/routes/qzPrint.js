import express from 'express'
import { prisma } from '../prisma.js'

const router = express.Router()

// POST / - generate printable payload for QZ Tray
// body: { orderId }
router.post('/', async (req, res) => {
  try {
    const orderId = req.body && (req.body.orderId || req.body.id);
    if (!orderId) return res.status(400).json({ ok: false, message: 'orderId required' });

    let order = null;
    if (orderId) {
      order = await prisma.order.findUnique({ where: { id: orderId }, include: { items: true, store: true } });
    }
    // Allow development/testing clients to post a full `order` object when the
    // order isn't persisted in the database (e.g., `dev-test-*` orders).
    if (!order && req.body && req.body.order) {
      order = req.body.order;
    }
    if (!order) return res.status(404).json({ ok: false, message: 'Order not found' });

    // Minimal printable template (HTML). Frontend/QZ Tray can render this or convert to ESC/POS.
    const lines = [];
    lines.push(`<div style="font-family:monospace;">`);
    lines.push(`<h2>${order.store?.name || 'Loja'}</h2>`);
    lines.push(`<div><strong>Pedido:</strong> ${order.displayId || order.externalId}</div>`);
    lines.push(`<div><strong>Cliente:</strong> ${order.customerName || ''} ${order.customerPhone ? ' - ' + order.customerPhone : ''}</div>`);
    lines.push('<hr/>');
    for (const it of (order.items || [])) {
      lines.push(`<div>${it.quantity || 1} x ${it.name}  R$ ${Number(it.price||0).toFixed(2)}</div>`);
    }
    lines.push('<hr/>');
    lines.push(`<div><strong>Total:</strong> R$ ${Number(order.total||0).toFixed(2)}</div>`);
    if (order.payload && order.payload.note) lines.push(`<div><em>${order.payload.note}</em></div>`);
    lines.push('</div>');

    const html = lines.join('\n');

    return res.json({ ok: true, html, order: { id: order.id, externalId: order.externalId, displayId: order.displayId } });
  } catch (e) {
    console.error('POST /qz-print failed', e && e.message);
    return res.status(500).json({ ok: false, error: String(e && e.message) });
  }
})

export default router
