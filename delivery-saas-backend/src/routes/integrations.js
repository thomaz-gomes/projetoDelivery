// src/routes/integrations.js
import express from 'express';
import { prisma } from '../prisma.js';
import { authMiddleware, requireRole } from '../auth.js';

import {
  startDistributedAuth,          // novo: userCode + verificationUrlComplete
  exchangeAuthorizationCode,     // troca authorizationCode + verifier por tokens
  refreshAccessToken,            // renova tokens
  getIFoodAccessToken,           // garante accessToken válido
} from '../integrations/ifood/oauth.js';

import {
  pollIFoodEvents,
  acknowledgeIFoodEvents,
  getIFoodOrderDetails,
} from '../integrations/ifood/orders.js';

export const integrationsRouter = express.Router();
integrationsRouter.use(authMiddleware);

// Salvar credenciais de um provider (ex.: IFOOD)
integrationsRouter.post('/:provider', requireRole('ADMIN'), async (req, res) => {
  try {
    const { provider } = req.params;
    const { clientId, clientSecret, merchantId, enabled } = req.body || {};
    const companyId = req.user.companyId;

    const integration = await prisma.apiIntegration.upsert({
      where: { companyId_provider: { companyId, provider: provider.toUpperCase() } },
      update: { clientId, clientSecret, merchantId, enabled },
      create: {
        companyId,
        provider: provider.toUpperCase(),
        clientId,
        clientSecret,
        merchantId,
        enabled: enabled ?? true,
        authMode: 'AUTH_CODE',
      },
    });

    res.json(integration);
  } catch (e) {
    res.status(500).json({ message: 'Erro ao salvar integração', error: e.message });
  }
});

// Iniciar vínculo (App Distribuído): userCode + verificationUrlComplete
integrationsRouter.post('/ifood/link/start', requireRole('ADMIN'), async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const r = await startDistributedAuth({ companyId });
    res.json(r); // { userCode, codeVerifier, verificationUrlComplete, integration }
  } catch (e) {
    console.error('ifood/link/start error:', e);
    res.status(500).json({ message: 'Falha ao iniciar vínculo', error: e.message });
  }
});

// Confirmar vínculo com authorizationCode
integrationsRouter.post('/ifood/link/confirm', requireRole('ADMIN'), async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { authorizationCode } = req.body || {};
    if (!authorizationCode) return res.status(400).json({ message: 'authorizationCode é obrigatório' });

    const r = await exchangeAuthorizationCode({ companyId, authorizationCode });
    res.json(r);
  } catch (e) {
    console.error('ifood/link/confirm error:', e?.response?.data ?? e);
    res.status(500).json({ message: 'Falha ao confirmar vínculo', error: e?.message || String(e), details: e?.response?.data ?? null });
  }
});

// Refresh manual (se precisar)
integrationsRouter.post('/ifood/token/refresh', requireRole('ADMIN'), async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const r = await refreshAccessToken({ companyId });
    res.json(r);
  } catch (e) {
    console.error('ifood/token/refresh error:', e?.response?.data ?? e);
    res.status(500).json({ message: 'Falha ao renovar token', error: e?.message || String(e), details: e?.response?.data ?? null });
  }
});

// Listar integrações
integrationsRouter.get('/', requireRole('ADMIN'), async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const integrations = await prisma.apiIntegration.findMany({ where: { companyId } });
    res.json(integrations);
  } catch (e) {
    res.status(500).json({ message: 'Erro ao listar integrações', error: e.message });
  }
});

// Detalhe de uma integração
integrationsRouter.get('/:provider', requireRole('ADMIN'), async (req, res) => {
  try {
    const { provider } = req.params;
    const companyId = req.user.companyId;
    const integration = await prisma.apiIntegration.findUnique({
      where: { companyId_provider: { companyId, provider: provider.toUpperCase() } },
    });
    if (!integration) return res.status(404).json({ message: 'Integração não encontrada' });
    res.json(integration);
  } catch (e) {
    res.status(500).json({ message: 'Erro ao buscar integração', error: e.message });
  }
});
integrationsRouter.get('/ifood/status', requireRole('ADMIN'), async (req, res) => {
  const companyId = req.user.companyId;
  const i = await prisma.apiIntegration.findUnique({
    where: { companyId_provider: { companyId, provider: 'IFOOD' } },
  });
  if (!i) return res.status(404).json({ message: 'sem integração' });
  res.json({
    enabled: i.enabled,
    hasTokens: !!i.accessToken,
    expiresAt: i.tokenExpiresAt,
    merchantId: i.merchantId || null,
    authMode: i.authMode,
  });
});

integrationsRouter.post('/ifood/unlink', requireRole('ADMIN'), async (req, res) => {
  const companyId = req.user.companyId;
  const i = await prisma.apiIntegration.update({
    where: { companyId_provider: { companyId, provider: 'IFOOD' } },
    data: {
      accessToken: null, refreshToken: null, tokenExpiresAt: null,
      authCode: null, linkCode: null, codeVerifier: null,
    },
  });
  res.json({ ok: true, integration: i });
});
// Remover integração
integrationsRouter.delete('/:provider', requireRole('ADMIN'), async (req, res) => {
  try {
    const { provider } = req.params;
    const companyId = req.user.companyId;
    await prisma.apiIntegration.delete({
      where: { companyId_provider: { companyId, provider: provider.toUpperCase() } },
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ message: 'Erro ao remover integração', error: e.message });
  }
});

/**
 *  🔁 Poll de pedidos (busca eventos)
 */
integrationsRouter.post('/ifood/poll', requireRole('ADMIN'), async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const events = await pollIFoodEvents(companyId);
    res.json({ ok: true, count: events.length, events });
  } catch (e) {
    console.error('Erro no polling iFood:', e.response?.data || e.message);
    res.status(500).json({ message: 'Falha ao buscar eventos', error: e.message });
  }
});

/**
 *  📦 Buscar detalhes de um pedido
 */
integrationsRouter.get('/ifood/orders/:id', requireRole('ADMIN'), async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const order = await getIFoodOrderDetails(companyId, req.params.id);
    res.json(order);
  } catch (e) {
    console.error('Erro ao buscar pedido iFood:', e.response?.data || e.message);
    res.status(500).json({ message: 'Falha ao buscar pedido', error: e.message });
  }
});

/**
 *  ✅ Confirmar eventos processados
 */
integrationsRouter.post('/ifood/ack', requireRole('ADMIN'), async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { events } = req.body || {};
    const r = await acknowledgeIFoodEvents(companyId, events);
    res.json(r);
  } catch (e) {
    res.status(500).json({ message: 'Falha ao confirmar eventos', error: e.message });
  }
});