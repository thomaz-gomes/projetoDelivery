import { prisma } from '../prisma.js';
import { createFinancialEntriesForOrder } from '../services/financial/orderFinancialBridge.js';

/**
 * Detects orphan orders (CONCLUIDO without FinancialTransaction) and retries failed bridges.
 * Runs every 1h via setInterval or on-demand via endpoint.
 */
export async function runReconciliation(companyId = null) {
  const results = { orphansFound: 0, orphansFixed: 0, retriesAttempted: 0, retriesFixed: 0 };

  try {
    const companyFilter = companyId ? { companyId } : {};
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);

    // 1. Find CONCLUIDO orders without a financial transaction
    const allConcluidos = await prisma.order.findMany({
      where: {
        ...companyFilter,
        status: 'CONCLUIDO',
        updatedAt: { lt: fiveMinAgo },
      },
      select: { id: true, companyId: true },
    });

    const existingTxSourceIds = await prisma.financialTransaction.findMany({
      where: {
        ...companyFilter,
        sourceType: 'ORDER',
        sourceId: { in: allConcluidos.map(o => o.id) },
      },
      select: { sourceId: true },
    });

    const coveredIds = new Set(existingTxSourceIds.map(t => t.sourceId));
    const orphans = allConcluidos.filter(o => !coveredIds.has(o.id));
    results.orphansFound = orphans.length;

    for (const orphan of orphans) {
      try {
        const fullOrder = await prisma.order.findUnique({
          where: { id: orphan.id },
          include: { items: true },
        });
        if (fullOrder) {
          await createFinancialEntriesForOrder(fullOrder);
          results.orphansFixed++;
        }
      } catch (e) {
        console.error(`[reconciliation] Failed to fix orphan ${orphan.id}:`, e.message);
      }
    }

    // 2. Retry failed bridges (max 3 attempts)
    const failedLogs = await prisma.financialBridgeLog.findMany({
      where: {
        ...companyFilter,
        status: 'FAILED',
        retryCount: { lt: 3 },
      },
    });

    results.retriesAttempted = failedLogs.length;

    for (const log of failedLogs) {
      try {
        if (log.sourceType === 'ORDER') {
          const order = await prisma.order.findUnique({
            where: { id: log.sourceId },
            include: { items: true },
          });
          if (order && order.status === 'CONCLUIDO') {
            await createFinancialEntriesForOrder(order);
            await prisma.financialBridgeLog.update({
              where: { id: log.id },
              data: { status: 'RETRY_SUCCESS', resolvedAt: new Date() },
            });
            results.retriesFixed++;
            continue;
          }
        }
        await prisma.financialBridgeLog.update({
          where: { id: log.id },
          data: { retryCount: { increment: 1 } },
        });
      } catch (e) {
        await prisma.financialBridgeLog.update({
          where: { id: log.id },
          data: { retryCount: { increment: 1 }, errorMessage: e.message },
        }).catch(() => {});
      }
    }

    console.log('[reconciliation] Results:', results);
    return results;
  } catch (e) {
    console.error('[reconciliation] Error:', e);
    return { ...results, error: e.message };
  }
}

let intervalId = null;
let reconciling = false;

export function startReconciliationJob() {
  if (intervalId) return;
  intervalId = setInterval(async () => {
    if (reconciling) {
      console.log('[reconciliation] Skipping — previous run still in progress');
      return;
    }
    reconciling = true;
    try {
      await runReconciliation();
    } finally {
      reconciling = false;
    }
  }, 60 * 60 * 1000);
  console.log('[reconciliation] Job started — runs every 1h');
}
