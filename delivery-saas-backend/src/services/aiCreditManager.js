/**
 * aiCreditManager.js — Serviço centralizado de gestão de créditos de IA
 *
 * Uso em qualquer rota/módulo que consuma IA:
 *
 *   import { checkCredits, debitCredits } from '../services/aiCreditManager.js'
 *
 *   // 1. Verificar saldo antes de chamar a IA
 *   const check = await checkCredits(companyId, 'MEU_SERVICO', quantity)
 *   if (!check.ok) return res.status(402).json({ message: 'Créditos insuficientes', ...check })
 *
 *   // 2. Chamar a IA normalmente...
 *
 *   // 3. Debitar os créditos
 *   await debitCredits(companyId, 'MEU_SERVICO', quantity, { contexto: '...' }, userId)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * COMO REGISTRAR UM NOVO SERVIÇO DE IA:
 *
 *   1. Adicione a constante de custo abaixo (AI_SERVICE_COSTS)
 *   2. (Opcional) Insira um registro em AiCreditService no banco via seed/admin
 *   3. Use checkCredits() + debitCredits() no seu route/service
 *   4. O frontend lê o saldo via useAiCreditsStore().fetch() — sem mudanças necessárias
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { prisma } from '../prisma.js'

/**
 * Custo padrão por serviço (créditos por unidade).
 * Usado como fallback se o serviço não estiver cadastrado em AiCreditService no banco.
 */
export const AI_SERVICE_COSTS = {
  MENU_IMPORT_ITEM:      1, // por item de cardápio aplicado
  MENU_IMPORT_LINK:      5, // por importação de cardápio via link/URL com IA
  MENU_IMPORT_PHOTO:     5, // por foto analisada (visão/OCR)
  MENU_IMPORT_PLANILHA:  2, // por importação de cardápio via planilha (Excel/CSV)
  GENERATE_DESCRIPTION:  2, // por descrição gerada por IA
  OCR_PHOTO:             5, // por foto processada via OCR
  AI_STUDIO_ENHANCE:    10, // por aprimoramento de imagem no AI Studio (visão + geração)
}

// ─── Cache de custos de serviços lidos do banco ────────────────────────────────
let _serviceCostCache = null
let _serviceCostCacheTs = 0
const SERVICE_COST_CACHE_TTL = 60_000 // 60s

export function clearServiceCostCache() {
  _serviceCostCache = null
  _serviceCostCacheTs = 0
}

async function getServiceCostMap() {
  const now = Date.now()
  if (_serviceCostCache && now - _serviceCostCacheTs < SERVICE_COST_CACHE_TTL) {
    return _serviceCostCache
  }
  try {
    const rows = await prisma.aiCreditService.findMany({ where: { isActive: true } })
    const map = {}
    for (const row of rows) map[row.key] = row.creditsPerUnit
    _serviceCostCache = map
    _serviceCostCacheTs = now
    return map
  } catch {
    return {}
  }
}

async function getServiceCost(serviceKey) {
  const dbMap = await getServiceCostMap()
  if (dbMap[serviceKey] !== undefined) return dbMap[serviceKey]
  return AI_SERVICE_COSTS[serviceKey] ?? 1
}

/**
 * Retorna o saldo atual de créditos e o limite mensal do plano da empresa.
 *
 * Auto-inicialização: se a empresa nunca teve um reset (aiCreditsLastReset = null),
 * o saldo é imediatamente definido como o limite mensal do plano. Isso resolve
 * o caso de empresas criadas antes da implantação do sistema de créditos.
 */
export async function getBalance(companyId) {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: {
      aiCreditsBalance: true,
      aiCreditsLastReset: true,
      saasSubscription: {
        select: { plan: { select: { aiCreditsMonthlyLimit: true, unlimitedAiCredits: true } } },
      },
    },
  })

  const plan = company?.saasSubscription?.plan
  const monthlyLimit = plan?.aiCreditsMonthlyLimit ?? 100
  const unlimitedAiCredits = plan?.unlimitedAiCredits ?? false
  let balance = company?.aiCreditsBalance ?? 0
  let lastReset = company?.aiCreditsLastReset ?? null

  // Auto-inicializar: empresa que nunca teve reset recebe o limite do plano imediatamente.
  // Acontece com empresas existentes após a migração do sistema de créditos.
  if (!lastReset && !unlimitedAiCredits && company) {
    try {
      await prisma.company.update({
        where: { id: companyId },
        data: { aiCreditsBalance: monthlyLimit, aiCreditsLastReset: new Date() },
      })
      balance = monthlyLimit
      lastReset = new Date()
    } catch {
      // Silencioso: na pior das hipóteses, o saldo permanece em 0 nesta chamada
    }
  }

  return {
    balance,
    monthlyLimit,
    unlimitedAiCredits,
    lastReset,
  }
}

/**
 * Verifica se a empresa tem saldo suficiente para o serviço solicitado.
 * Não realiza débito.
 */
export async function checkCredits(companyId, serviceKey, quantity = 1) {
  const costPerUnit = await getServiceCost(serviceKey)
  const totalCost = costPerUnit * Math.max(1, quantity)
  const { balance, monthlyLimit, unlimitedAiCredits, lastReset } = await getBalance(companyId)

  // Planos com créditos ilimitados sempre aprovam sem verificar saldo
  if (unlimitedAiCredits) {
    return { ok: true, balance, monthlyLimit, unlimitedAiCredits: true, lastReset, totalCost, costPerUnit, serviceKey, quantity }
  }

  return {
    ok: balance >= totalCost,
    balance,
    monthlyLimit,
    unlimitedAiCredits: false,
    lastReset,
    totalCost,
    costPerUnit,
    serviceKey,
    quantity,
  }
}

/**
 * Debita créditos da empresa de forma atômica.
 * Lança erro HTTP 402 se saldo insuficiente.
 *
 * @param {string} companyId
 * @param {string} serviceKey  - chave do serviço (ex: "MENU_IMPORT_ITEM")
 * @param {number} quantity    - quantidade de unidades consumidas
 * @param {object} metadata    - dados extras para auditoria (ex: { menuId, source })
 * @param {string} [userId]    - ID do usuário que disparou a ação (opcional)
 */
export async function debitCredits(companyId, serviceKey, quantity = 1, metadata = {}, userId = null) {
  const costPerUnit = await getServiceCost(serviceKey)
  const totalCost = costPerUnit * Math.max(1, quantity)

  // Verificar se o plano tem créditos ilimitados — registra uso sem debitar saldo
  const { unlimitedAiCredits, balance: currentBalance } = await getBalance(companyId)
  if (unlimitedAiCredits) {
    await prisma.aiCreditTransaction.create({
      data: {
        companyId, userId, serviceKey,
        creditsSpent: 0,          // sem débito real
        balanceBefore: currentBalance,
        balanceAfter: currentBalance,
        metadata: { ...metadata, unlimited: true },
      },
    })
    return { newBalance: currentBalance, spent: 0 }
  }

  // Operação atômica: verifica e debita no mesmo bloco de transação
  const [updatedCompany] = await prisma.$transaction(async (tx) => {
    const company = await tx.company.findUnique({
      where: { id: companyId },
      select: { aiCreditsBalance: true },
    })

    if (!company) {
      const err = new Error('Empresa não encontrada')
      err.statusCode = 404
      throw err
    }

    if (company.aiCreditsBalance < totalCost) {
      const err = new Error(
        `Créditos de IA insuficientes. Necessário: ${totalCost}, Disponível: ${company.aiCreditsBalance}`,
      )
      err.statusCode = 402
      err.balance = company.aiCreditsBalance
      err.required = totalCost
      throw err
    }

    const updated = await tx.company.update({
      where: { id: companyId },
      data: { aiCreditsBalance: { decrement: totalCost } },
      select: { aiCreditsBalance: true },
    })

    await tx.aiCreditTransaction.create({
      data: {
        companyId,
        userId,
        serviceKey,
        creditsSpent: totalCost,
        balanceBefore: company.aiCreditsBalance,
        balanceAfter: updated.aiCreditsBalance,
        metadata,
      },
    })

    return [updated]
  })

  return {
    newBalance: updatedCompany.aiCreditsBalance,
    spent: totalCost,
  }
}

/**
 * Restaura os créditos de uma empresa ao limite mensal do seu plano.
 * Atualiza a data do último reset.
 */
export async function resetCompanyCredits(companyId) {
  const { monthlyLimit } = await getBalance(companyId)

  await prisma.company.update({
    where: { id: companyId },
    data: {
      aiCreditsBalance: monthlyLimit,
      aiCreditsLastReset: new Date(),
    },
  })

  return { monthlyLimit }
}

/**
 * Restaura os créditos de TODAS as empresas para seus limites de plano.
 * Chamado pelo cron mensal.
 */
export async function resetAllDueCredits() {
  const companies = await prisma.company.findMany({
    select: {
      id: true,
      saasSubscription: { select: { plan: { select: { aiCreditsMonthlyLimit: true, unlimitedAiCredits: true } } } },
    },
  })

  let resetCount = 0
  for (const company of companies) {
    const plan = company.saasSubscription?.plan
    const limit = plan?.aiCreditsMonthlyLimit ?? 100
    const unlimited = plan?.unlimitedAiCredits ?? false
    await prisma.company.update({
      where: { id: company.id },
      // Empresas com plano ilimitado mantêm saldo em 0 (irrelevante); as demais são restauradas
      data: { aiCreditsBalance: unlimited ? 0 : limit, aiCreditsLastReset: new Date() },
    })
    resetCount++
  }

  console.log(`[AiCreditManager] Reset mensal concluído: ${resetCount} empresa(s) atualizadas`)
  return { resetCount }
}

/**
 * Retorna o histórico de transações de crédito paginado.
 */
export async function getTransactions(companyId, page = 1, limit = 20) {
  const skip = (page - 1) * limit
  const [transactions, total] = await Promise.all([
    prisma.aiCreditTransaction.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.aiCreditTransaction.count({ where: { companyId } }),
  ])

  return { transactions, total, page, limit, pages: Math.ceil(total / limit) }
}
