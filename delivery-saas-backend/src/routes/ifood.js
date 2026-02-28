import express from 'express';
import { authMiddleware, requireRole } from '../auth.js';
import { requireModuleStrict } from '../modules.js';
import { ifoodPoll } from '../integrations/ifood/client.js';

export const ifoodRouter = express.Router();

// 🔒 Todas as rotas protegidas
ifoodRouter.use(authMiddleware);
ifoodRouter.use(requireModuleStrict('CARDAPIO_COMPLETO'));

/**
 * POST /ifood/poll
 * Executa o polling do iFood (GET /order/v1.0/events:polling)
 * - Retorna eventos e envia acknowledgment automaticamente.
 */
ifoodRouter.post('/poll', requireRole('ADMIN'), async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const result = await ifoodPoll(companyId);

    res.json({
      ok: true,
      count: result?.events?.length || 0,
      events: result?.events || [],
    });
  } catch (e) {
    console.error('Erro no polling iFood:', e.response?.data || e.message);
    res.status(500).json({
      message: 'Falha ao buscar eventos',
      error: e.response?.data || e.message,
    });
  }
});