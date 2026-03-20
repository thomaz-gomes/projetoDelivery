import express from 'express'
import { prisma } from '../prisma.js'

export const publicTrackingRouter = express.Router()

// POST /public/tracking/events — batch insert menu events (no auth required)
publicTrackingRouter.post('/events', async (req, res) => {
  try {
    const events = req.body.events
    if (!Array.isArray(events) || events.length === 0) {
      return res.status(400).json({ message: 'events array required' })
    }

    // Limit batch size to prevent abuse
    const batch = events.slice(0, 50)

    const validTypes = ['VISIT', 'ITEM_VIEW', 'ADD_TO_CART', 'CHECKOUT_START', 'ORDER_COMPLETE']

    const records = []
    for (const evt of batch) {
      if (!evt.menuId || !evt.sessionId || !evt.companyId || !validTypes.includes(evt.eventType)) continue
      records.push({
        companyId: evt.companyId,
        menuId: evt.menuId,
        sessionId: evt.sessionId,
        customerId: evt.customerId || null,
        eventType: evt.eventType,
        productId: evt.productId || null,
        metadata: evt.metadata || null,
      })
    }

    if (records.length > 0) {
      await prisma.menuEvent.createMany({ data: records })
    }

    res.json({ ok: true, count: records.length })
  } catch (e) {
    console.error('POST /public/tracking/events error:', e)
    res.status(500).json({ message: 'Erro ao registrar eventos' })
  }
})
