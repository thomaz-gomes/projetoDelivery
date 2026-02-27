/**
 * aiCredits.js — Endpoints REST para gestão de créditos de IA
 *
 * Rotas públicas (ADMIN):
 *   GET  /ai-credits/balance       — saldo atual da empresa
 *   GET  /ai-credits/transactions  — histórico paginado
 *   GET  /ai-credits/services      — catálogo de serviços e custos
 *
 * Rotas SUPER_ADMIN:
 *   POST /ai-credits/admin/reset/:companyId   — reset manual de uma empresa
 *   PUT  /ai-credits/admin/company/:companyId — ajustar saldo manualmente
 *   POST /ai-credits/admin/reset-all          — reset mensal de todas as empresas
 */

import express from 'express'
import { authMiddleware, requireRole } from '../auth.js'
import { prisma } from '../prisma.js'
import {
  getBalance,
  getTransactions,
  resetCompanyCredits,
  resetAllDueCredits,
  AI_SERVICE_COSTS,
} from '../services/aiCreditManager.js'

const router = express.Router()
router.use(authMiddleware)

// ─── ADMIN: consultas do próprio tenant ───────────────────────────────────────

/**
 * GET /ai-credits/balance
 * Retorna saldo atual, limite mensal e próxima data de reset.
 */
router.get('/balance', async (req, res) => {
  try {
    const companyId = req.user?.companyId
    if (!companyId) return res.status(401).json({ message: 'Não autenticado' })

    const { balance, monthlyLimit, lastReset } = await getBalance(companyId)

    // Calcula próxima data de reset (dia 1 do próximo mês)
    const now = new Date()
    const nextReset = new Date(now.getFullYear(), now.getMonth() + 1, 1)

    res.json({ balance, monthlyLimit, lastReset, nextReset })
  } catch (err) {
    console.error('[GET /ai-credits/balance]', err)
    res.status(500).json({ message: 'Erro interno' })
  }
})

/**
 * GET /ai-credits/transactions?page=1&limit=20
 * Histórico de transações da empresa, mais recentes primeiro.
 */
router.get('/transactions', async (req, res) => {
  try {
    const companyId = req.user?.companyId
    if (!companyId) return res.status(401).json({ message: 'Não autenticado' })

    const page = Math.max(1, parseInt(req.query.page) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20))

    const result = await getTransactions(companyId, page, limit)
    res.json(result)
  } catch (err) {
    console.error('[GET /ai-credits/transactions]', err)
    res.status(500).json({ message: 'Erro interno' })
  }
})

/**
 * GET /ai-credits/services
 * Catálogo de serviços de IA disponíveis com seus custos.
 * Prioriza registros do banco; complementa com constantes locais.
 */
router.get('/services', async (req, res) => {
  try {
    const dbServices = await prisma.aiCreditService.findMany({
      where: { isActive: true },
      orderBy: { key: 'asc' },
    })

    // Merge: banco tem prioridade sobre constantes locais
    const dbKeys = new Set(dbServices.map(s => s.key))
    const localServices = Object.entries(AI_SERVICE_COSTS)
      .filter(([key]) => !dbKeys.has(key))
      .map(([key, creditsPerUnit]) => ({ key, name: key, creditsPerUnit, isActive: true, fromLocal: true }))

    res.json([...dbServices, ...localServices])
  } catch (err) {
    console.error('[GET /ai-credits/services]', err)
    res.status(500).json({ message: 'Erro interno' })
  }
})

// ─── SUPER_ADMIN: gerenciamento ───────────────────────────────────────────────

/**
 * POST /ai-credits/admin/reset/:companyId
 * Reset manual dos créditos de uma empresa ao limite do plano.
 */
router.post('/admin/reset/:companyId', requireRole('SUPER_ADMIN'), async (req, res) => {
  try {
    const { companyId } = req.params
    const { monthlyLimit } = await resetCompanyCredits(companyId)
    res.json({ message: 'Créditos restaurados com sucesso', newBalance: monthlyLimit })
  } catch (err) {
    console.error('[POST /ai-credits/admin/reset]', err)
    res.status(err.statusCode || 500).json({ message: err.message })
  }
})

/**
 * PUT /ai-credits/admin/company/:companyId
 * Ajuste manual de saldo para uma empresa específica.
 * Body: { balance: number }
 */
router.put('/admin/company/:companyId', requireRole('SUPER_ADMIN'), async (req, res) => {
  try {
    const { companyId } = req.params
    const { balance } = req.body

    if (typeof balance !== 'number' || balance < 0) {
      return res.status(400).json({ message: 'balance deve ser um número >= 0' })
    }

    await prisma.company.update({
      where: { id: companyId },
      data: { aiCreditsBalance: Math.round(balance) },
    })

    res.json({ message: 'Saldo atualizado', newBalance: Math.round(balance) })
  } catch (err) {
    console.error('[PUT /ai-credits/admin/company]', err)
    res.status(500).json({ message: 'Erro interno' })
  }
})

/**
 * POST /ai-credits/admin/reset-all
 * Dispara o reset mensal para todas as empresas (equivalente ao cron).
 */
router.post('/admin/reset-all', requireRole('SUPER_ADMIN'), async (req, res) => {
  try {
    const result = await resetAllDueCredits()
    res.json({ message: 'Reset mensal concluído', ...result })
  } catch (err) {
    console.error('[POST /ai-credits/admin/reset-all]', err)
    res.status(500).json({ message: 'Erro interno' })
  }
})

export default router
