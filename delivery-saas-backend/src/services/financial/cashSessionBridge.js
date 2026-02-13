import { prisma } from '../../prisma.js';
import { getEnabledModules } from '../../modules.js';

/**
 * Bridge: Caixa → Módulo Financeiro
 *
 * Chamado quando uma sessão de caixa é fechada.
 * Cria FinancialTransaction para quebras/sobras e CashFlowEntry para movimentações.
 */
export async function createFinancialEntriesForCashSession(session) {
  try {
    // 1. Verificar se módulo FINANCIAL está ativo
    const enabledModules = await getEnabledModules(session.companyId);
    if (!enabledModules.includes('financial')) return;

    // 2. Verificar se já existem lançamentos para esta sessão
    const existing = await prisma.financialTransaction.findFirst({
      where: { companyId: session.companyId, sourceType: 'CASH_SESSION', sourceId: session.id },
    });
    if (existing) return;

    // 3. Garantir centros de custo para quebras/sobras
    await ensureCashCostCenters(session.companyId);

    // 4. Buscar conta padrão tipo CASH
    const defaultAccount = await prisma.financialAccount.findFirst({
      where: { companyId: session.companyId, isDefault: true, isActive: true },
    });

    const differences = session.differences || {};
    const closedAt = session.closedAt || new Date();

    // 5. Criar transação para cada diferença não-zero
    for (const [method, diff] of Object.entries(differences)) {
      if (Math.abs(Number(diff)) < 0.01) continue;

      const isBreak = Number(diff) < 0;
      const amount = Math.abs(Number(diff));

      const breakCC = await prisma.costCenter.findFirst({
        where: { companyId: session.companyId, code: { contains: '4.08' } },
      });
      const surplusCC = await prisma.costCenter.findFirst({
        where: { companyId: session.companyId, code: { contains: '5.01' } },
      });

      await prisma.financialTransaction.create({
        data: {
          companyId: session.companyId,
          type: isBreak ? 'PAYABLE' : 'RECEIVABLE',
          status: 'PAID',
          description: `${isBreak ? 'Quebra' : 'Sobra'} de caixa - ${method} - Sessão ${session.id.slice(0, 8)}`,
          accountId: defaultAccount?.id || null,
          costCenterId: isBreak ? (breakCC?.id || null) : (surplusCC?.id || null),
          cashSessionId: session.id,
          grossAmount: amount,
          feeAmount: 0,
          netAmount: amount,
          dueDate: closedAt,
          paidAt: closedAt,
          issueDate: closedAt,
          sourceType: 'CASH_SESSION',
          sourceId: session.id,
        },
      });
    }

    // 6. Criar CashFlowEntry para movimentos (sangrias/reforços) - se conta financeira existir
    if (defaultAccount) {
      const movements = await prisma.cashMovement.findMany({
        where: { sessionId: session.id },
      });

      for (const mv of movements) {
        // Evitar duplicatas: verificar se já existe entry para este movimento
        const existingEntry = await prisma.cashFlowEntry.findFirst({
          where: { companyId: session.companyId, description: { contains: mv.id } },
        });
        if (existingEntry) continue;

        const isOutflow = mv.type === 'WITHDRAWAL';
        const balanceAfter = Number(defaultAccount.currentBalance) + (isOutflow ? -Number(mv.amount) : Number(mv.amount));

        await prisma.cashFlowEntry.create({
          data: {
            companyId: session.companyId,
            accountId: defaultAccount.id,
            type: isOutflow ? 'OUTFLOW' : 'INFLOW',
            amount: Number(mv.amount),
            balanceAfter,
            entryDate: mv.createdAt,
            description: `${isOutflow ? 'Sangria' : 'Reforço'} - ${mv.note || 'Sem descrição'} (${mv.id.slice(0, 8)})`,
            reconciled: true,
          },
        });
      }
    }

  } catch (e) {
    // Nunca bloquear o fechamento se o financeiro falhar
    console.error('createFinancialEntriesForCashSession error:', e);
  }
}

/**
 * Garante que os centros de custo para quebras/sobras existam.
 */
async function ensureCashCostCenters(companyId) {
  const centers = [
    { code: '4.08', name: 'Quebras de Caixa', dreGroup: 'OPEX' },
    { code: '5.01', name: 'Sobras de Caixa', dreGroup: 'FINANCIAL' },
  ];

  for (const c of centers) {
    const exists = await prisma.costCenter.findFirst({
      where: { companyId, code: c.code },
    });
    if (!exists) {
      await prisma.costCenter.create({
        data: { companyId, ...c, isActive: true },
      });
    }
  }
}
