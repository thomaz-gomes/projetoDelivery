import express from 'express'
import { evaluateCartDiscounts } from '../services/customerGroups.js'
import { resolvePublicCustomerFromReq } from './publicHelpers.js'
import { normalizePhone } from '../services/customers.js'
import { prisma } from '../prisma.js'

const router = express.Router({ mergeParams: true })

// POST /public/:companyId/cart/discounts
router.post('/discounts', async (req, res) => {
  const companyId = req.params.companyId
  const cart = req.body || {}
  try {
    // try to resolve customer from request (Authorization / cookies / headers)
    let customer = await resolvePublicCustomerFromReq(req, companyId)
    // allow client to pass a phone number in the body for guest flows
    const phoneRaw = req.body && (req.body.customerPhone || (req.body.customer && req.body.customer.contact))
    if (!customer && phoneRaw) {
      try {
        const phone = normalizePhone(phoneRaw)
        if (phone) {
          customer = await prisma.customer.findFirst({ where: { companyId, OR: [{ whatsapp: phone }, { phone }] } })
        }
      } catch (e) { /* ignore */ }
    }
    const customerId = customer ? customer.id : null
    const result = await evaluateCartDiscounts(companyId, cart, customerId)
    res.json(result)
  } catch (e) {
    console.error('Failed to evaluate discounts', e)
    res.status(500).json({ message: 'Failed to evaluate discounts' })
  }
})

export default router
