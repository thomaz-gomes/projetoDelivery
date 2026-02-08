import express from 'express'
import { authMiddleware, requireRole } from '../auth.js'
import * as cashbackSvc from '../services/cashback.js'

const router = express.Router()
router.use(authMiddleware)

// GET /cashback/settings
router.get('/settings', requireRole('ADMIN'), async (req, res) => {
  try {
    const companyId = req.user.companyId
    if(!companyId) return res.status(400).json({ message: 'Usuário sem empresa' })
    const s = await cashbackSvc.getSettings(companyId)
    res.json(s)
  } catch (e) {
    res.status(500).json({ message: 'Erro ao obter configurações', error: e?.message || String(e) })
  }
})

// PUT /cashback/settings
router.put('/settings', requireRole('ADMIN'), async (req, res) => {
  try {
    const companyId = req.user.companyId
    if(!companyId) return res.status(400).json({ message: 'Usuário sem empresa' })
    const { enabled, defaultPercent, minRedeemValue } = req.body || {}
    const data = {}
    if(enabled !== undefined) data.enabled = Boolean(enabled)
    if(defaultPercent !== undefined) data.defaultPercent = String(Number(defaultPercent || 0))
    if(minRedeemValue !== undefined) data.minRedeemValue = String(Number(minRedeemValue || 0))
    const updated = await cashbackSvc.upsertSettings(companyId, data)
    res.json(updated)
  } catch (e) {
    res.status(500).json({ message: 'Erro ao salvar configurações', error: e?.message || String(e) })
  }
})

// Product rules (ADMIN)
router.get('/product-rules', requireRole('ADMIN'), async (req, res) => {
  try {
    const companyId = req.user.companyId
    const rows = await cashbackSvc.listProductRules(companyId)
    res.json(rows)
  } catch (e) { res.status(500).json({ message: 'Erro', error: e?.message || String(e) }) }
})

router.post('/product-rules', requireRole('ADMIN'), async (req, res) => {
  try {
    const companyId = req.user.companyId
    const { productId, cashbackPercent } = req.body || {}
    if(!productId) return res.status(400).json({ message: 'productId é obrigatório' })
    const row = await cashbackSvc.addOrUpdateProductRule(companyId, productId, Number(cashbackPercent || 0))
    res.status(201).json(row)
  } catch (e) { res.status(400).json({ message: 'Falha ao salvar regra', error: e?.message || String(e) }) }
})

router.delete('/product-rules/:id', requireRole('ADMIN'), async (req, res) => {
  try {
    const companyId = req.user.companyId
    const { id } = req.params
    await cashbackSvc.removeProductRule(companyId, id)
    res.json({ ok: true })
  } catch (e) { res.status(400).json({ message: 'Falha ao remover', error: e?.message || String(e) }) }
})

// Wallet endpoints (customer or admin). For simplicity require auth; clientId must be provided
router.get('/wallet', async (req, res) => {
  try {
    const companyId = req.user.companyId
    let clientId = req.query.clientId || req.query.customerId || null
    if(!companyId) return res.status(400).json({ message: 'Usuário sem empresa' })

    // Only allow access to the wallet if the requester is the owner or an ADMIN
    const requesterRole = req.user && req.user.role ? String(req.user.role) : null
    const requesterId = req.user && (req.user.id || req.user.userId) ? String(req.user.id || req.user.userId) : null

    if(requesterRole !== 'ADMIN'){
      // non-admins may only request their own wallet; if clientId provided, it must match requester
      if(!requesterId) return res.status(403).json({ message: 'Forbidden' })

      // If the requester is a CustomerAccount (no role), try to map account -> customer
      let mappedCustomerId = null
      try {
        // try direct match (token may contain the customer id)
        if(requesterId) {
          const maybeCustomer = await prisma.customer.findUnique({ where: { id: requesterId } })
          if(maybeCustomer) mappedCustomerId = maybeCustomer.id
        }
      } catch(e){}

      try {
        // try CustomerAccount mapping: token may be CustomerAccount.id
        if(!mappedCustomerId) {
          const acct = await prisma.customerAccount.findUnique({ where: { id: requesterId } })
          if(acct) mappedCustomerId = acct.customerId
        }
      } catch(e){}

      // If clientId provided and does not match any mapping, forbid
      if(clientId && mappedCustomerId && String(clientId) !== String(mappedCustomerId)) return res.status(403).json({ message: 'Forbidden' })

      // If clientId not provided, prefer mappedCustomerId, otherwise require explicit clientId equal to requesterId
      if(!clientId) {
        if(mappedCustomerId) clientId = mappedCustomerId
        else clientId = requesterId
      }
    } else {
      // admin: require explicit clientId to view a user's wallet
      if(!clientId) return res.status(400).json({ message: 'clientId é obrigatório para admin' })
    }

    const w = await cashbackSvc.getWalletWithTransactions(companyId, clientId)
    res.json(w)
  } catch (e) { res.status(500).json({ message: 'Erro', error: e?.message || String(e) }) }
})

// Admin: credit (internal) - create explicit credit
router.post('/credit', requireRole('ADMIN'), async (req, res) => {
  try {
    const companyId = req.user.companyId
    const { clientId, amount, orderId, description } = req.body || {}
    if(!clientId || !amount) return res.status(400).json({ message: 'clientId e amount são obrigatórios' })
    const result = await cashbackSvc.creditWalletForOrder(companyId, clientId, { id: orderId || null, items: [], total: 0 }, description || 'Crédito manual')
    res.json(result)
  } catch (e) { res.status(400).json({ message: 'Falha ao creditar', error: e?.message || String(e) }) }
})

// Admin: debit (use of cashback)
router.post('/debit', requireRole('ADMIN'), async (req, res) => {
  try {
    const companyId = req.user.companyId
    const { clientId, amount, orderId, description } = req.body || {}
    if(!clientId || !amount) return res.status(400).json({ message: 'clientId e amount são obrigatórios' })
    const result = await cashbackSvc.debitWallet(companyId, clientId, Number(amount), orderId || null, description || 'Débito manual')
    res.json(result)
  } catch (e) { res.status(400).json({ message: 'Falha ao debitar', error: e?.message || String(e) }) }
})

export default router
