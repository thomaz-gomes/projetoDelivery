import express from 'express';
import { authMiddleware } from '../../auth.js';
import accountsRouter from './accounts.js';
import costCentersRouter from './costCenters.js';
import transactionsRouter from './transactions.js';
import cashFlowRouter from './cashFlow.js';
import gatewaysRouter from './gateways.js';
import ofxRouter from './ofx.js';
import reportsRouter from './reports.js';

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

export default financialRouter;
