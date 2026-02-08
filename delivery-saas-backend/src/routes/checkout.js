import express from 'express'
import { authMiddleware } from '../auth.js'
import * as cashbackSvc from '../services/cashback.js'
import { getEnabledModules } from '../modules.js'

const router = express.Router()
router.use(authMiddleware)

// POST /checkout/apply-cashback
// body: { clientId, amountRequested, orderId }
router.post('/apply-cashback', async (req, res) => {
  try {
    const companyId = req.user.companyId
    if(!companyId) return res.status(400).json({ message: 'Usuário sem empresa' })
    const { clientId, amountRequested, orderId } = req.body || {}
    if(!clientId) return res.status(400).json({ message: 'clientId é obrigatório' })
    const settings = await cashbackSvc.getSettings(companyId)
    if(!settings || !settings.enabled) return res.status(403).json({ message: 'Módulo de cashback desativado' })
    const modules = await getEnabledModules(companyId)
    if(!Array.isArray(modules) || !modules.map(m=>String(m).toLowerCase()).includes('cashback')) return res.status(403).json({ message: 'Módulo de cashback não permitido no plano' })

    const wallet = await cashbackSvc.getOrCreateWallet(companyId, clientId)
    const balance = Number(wallet.balance || 0)
    const minRedeem = Number(settings.minRedeemValue || 0)
    if(balance < minRedeem) return res.status(400).json({ message: 'Saldo abaixo do mínimo para resgate', balance, minRedeem })
    const useAmount = Math.min(Number(amountRequested || 0), balance)
    if(!(useAmount > 0)) return res.status(400).json({ message: 'amountRequested deve ser maior que zero' })

    // perform debit
    const debit = await cashbackSvc.debitWallet(companyId, clientId, useAmount, orderId || null, 'Uso de cashback no checkout')
    res.json({ applied: debit.amount, walletId: debit.walletId, remainingBalance: (balance - debit.amount) })
  } catch (e) {
    res.status(400).json({ message: 'Falha ao aplicar cashback', error: e?.message || String(e) })
  }
})

export default router
