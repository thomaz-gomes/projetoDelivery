import express from 'express';
import { authMiddleware } from '../../auth.js';
import { prisma } from '../../prisma.js';
import accountsRouter from './accounts.js';
import costCentersRouter from './costCenters.js';
import transactionsRouter from './transactions.js';
import cashFlowRouter from './cashFlow.js';
import gatewaysRouter from './gateways.js';
import ofxRouter from './ofx.js';
import reportsRouter from './reports.js';
import paymentMethodsRouter from './paymentMethods.js';

const financialRouter = express.Router();
financialRouter.use(authMiddleware);

// Sub-rotas do módulo financeiro
financialRouter.use('/accounts', accountsRouter);
financialRouter.use('/cost-centers', costCentersRouter);
financialRouter.use('/transactions', transactionsRouter);
financialRouter.use('/cash-flow', cashFlowRouter);
financialRouter.use('/gateways', gatewaysRouter);
financialRouter.use('/ofx', ofxRouter);
financialRouter.use('/reports', reportsRouter);
financialRouter.use('/payment-methods', paymentMethodsRouter);

// POST /financial/reconciliation/run — run reconciliation on demand
financialRouter.post('/reconciliation/run', async (req, res) => {
  try {
    const { runReconciliation } = await import('../../jobs/financialReconciliation.js');
    const results = await runReconciliation(req.user.companyId);
    res.json(results);
  } catch (e) {
    res.status(500).json({ message: 'Erro na reconciliação', error: e?.message });
  }
});

// GET /financial/health — financial health dashboard data
financialRouter.get('/health', async (req, res) => {
  try {
    const companyId = req.user.companyId;

    const [outOfSessionCount, failedBridges, lastLog] = await Promise.all([
      prisma.order.count({ where: { companyId, outOfSession: true, status: 'CONCLUIDO' } }),
      prisma.financialBridgeLog.count({ where: { companyId, status: 'FAILED', retryCount: { lt: 3 } } }),
      prisma.financialBridgeLog.findFirst({
        where: { companyId, status: { in: ['SUCCESS', 'RETRY_SUCCESS'] } },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
    ]);

    // Count orphan orders (CONCLUIDO without financial transaction)
    const concludedCount = await prisma.order.count({
      where: { companyId, status: 'CONCLUIDO', updatedAt: { lt: new Date(Date.now() - 5 * 60 * 1000) } },
    });
    const withTxCount = await prisma.financialTransaction.groupBy({
      by: ['sourceId'],
      where: { companyId, sourceType: 'ORDER' },
    });
    const orphanOrders = Math.max(0, concludedCount - withTxCount.length);

    res.json({
      orphanOrders,
      outOfSessionOrders: outOfSessionCount,
      pendingBridgeFailures: failedBridges,
      lastSuccessfulBridge: lastLog?.createdAt || null,
    });
  } catch (e) {
    res.status(500).json({ message: 'Erro ao buscar saúde financeira', error: e?.message });
  }
});

export default financialRouter;
