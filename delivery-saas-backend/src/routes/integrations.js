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
// Create a new integration for a provider (allow multiple per provider)
integrationsRouter.post('/', requireRole('ADMIN'), async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { provider, clientId, clientSecret, merchantId, enabled, storeId, authMode } = req.body || {};
    if (!provider) return res.status(400).json({ message: 'provider é obrigatório' });

    // storeId is required: each integration must be bound to a specific store
    if (!storeId) return res.status(400).json({ message: 'storeId é obrigatório e deve pertencer à empresa' });
    // validate store belongs to company
    const store = await prisma.store.findFirst({ where: { id: storeId, companyId } });
    if (!store) return res.status(400).json({ message: 'storeId inválido ou não pertence à empresa' });

    const created = await prisma.apiIntegration.create({ data: {
      companyId,
      provider: String(provider).toUpperCase(),
      clientId: clientId || null,
      clientSecret: clientSecret || null,
      merchantId: merchantId || null,
      enabled: enabled ?? true,
      storeId: storeId,
      authMode: authMode || 'AUTH_CODE',
    } });
    res.status(201).json(created);
  } catch (e) {
    console.error('POST /integrations failed', e);
    res.status(500).json({ message: 'Erro ao criar integração', error: e.message });
  }
});

// Update an integration by id
integrationsRouter.put('/:id', requireRole('ADMIN'), async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.user.companyId;
    const body = req.body || {};
    const existing = await prisma.apiIntegration.findFirst({ where: { id, companyId } });
    if (!existing) return res.status(404).json({ message: 'Integração não encontrada' });
    // if storeId is provided, validate it belongs to the company
    if (body.storeId) {
      const st = await prisma.store.findFirst({ where: { id: body.storeId, companyId } });
      if (!st) return res.status(400).json({ message: 'storeId inválido ou não pertence à empresa' });
    }
    const updated = await prisma.apiIntegration.update({ where: { id }, data: {
      clientId: body.clientId ?? existing.clientId,
      clientSecret: body.clientSecret ?? existing.clientSecret,
      merchantId: body.merchantId ?? existing.merchantId,
      enabled: body.enabled ?? existing.enabled,
      storeId: body.storeId ?? existing.storeId,
      authMode: body.authMode ?? existing.authMode,
    } });
    res.json(updated);
  } catch (e) {
    console.error('PUT /integrations/:id failed', e);
    res.status(500).json({ message: 'Erro ao atualizar integração', error: e.message });
  }
});

// Delete integration by id
integrationsRouter.delete('/:id', requireRole('ADMIN'), async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.user.companyId;
    const existing = await prisma.apiIntegration.findFirst({ where: { id, companyId } });
    if (!existing) return res.status(404).json({ message: 'Integração não encontrada' });
    await prisma.apiIntegration.delete({ where: { id } });
    res.json({ ok: true });
  } catch (e) {
    console.error('DELETE /integrations/:id failed', e);
    res.status(500).json({ message: 'Erro ao remover integração', error: e.message });
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

// Buscar integração por id - evita conflito com rota /:provider
// Use a clear path `/by-id/:id` to avoid older path-to-regexp regex limitations.
integrationsRouter.get('/by-id/:id', requireRole('ADMIN'), async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.user.companyId;
    // basic UUID v4-ish validation
    if (!id || !/^[0-9a-fA-F-]{36}$/.test(id)) return res.status(400).json({ message: 'id inválido' });
    const integration = await prisma.apiIntegration.findFirst({ where: { id, companyId } });
    if (!integration) return res.status(404).json({ message: 'Integração não encontrada' });
    res.json(integration);
  } catch (e) {
    console.error('GET /integrations/:id failed', e);
    res.status(500).json({ message: 'Erro ao buscar integração', error: e.message });
  }
});

// Lista integrações por provider (ex: /integrations/IFOOD)
integrationsRouter.get('/:provider', requireRole('ADMIN'), async (req, res) => {
  try {
    const { provider } = req.params;
    const companyId = req.user.companyId;
    const rows = await prisma.apiIntegration.findMany({ where: { companyId, provider: provider.toUpperCase() }, orderBy: { createdAt: 'asc' } });
    res.json(rows || []);
  } catch (e) {
    res.status(500).json({ message: 'Erro ao buscar integrações', error: e.message });
  }
});
integrationsRouter.get('/ifood/status', requireRole('ADMIN'), async (req, res) => {
  const companyId = req.user.companyId;
  const i = await prisma.apiIntegration.findFirst({ where: { companyId, provider: 'IFOOD' }, orderBy: { updatedAt: 'desc' } });
  if (!i) return res.status(404).json({ message: 'sem integração' });
  res.json({
    enabled: i.enabled,
    hasTokens: !!i.accessToken,
    expiresAt: i.tokenExpiresAt,
    merchantId: i.merchantId || null,
    authMode: i.authMode,
  });
});

// unlink tokens for the most recently updated iFood integration (backwards compat)
integrationsRouter.post('/ifood/unlink', requireRole('ADMIN'), async (req, res) => {
  const companyId = req.user.companyId;
  const which = await prisma.apiIntegration.findFirst({ where: { companyId, provider: 'IFOOD' }, orderBy: { updatedAt: 'desc' } });
  if (!which) return res.status(404).json({ message: 'sem integração' });
  const i = await prisma.apiIntegration.update({ where: { id: which.id }, data: { accessToken: null, refreshToken: null, tokenExpiresAt: null, authCode: null, linkCode: null, codeVerifier: null } });
  res.json({ ok: true, integration: i });
});
// Note: individual deletion by id is supported via DELETE /integrations/:id (defined above)

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

// Provider-specific create, e.g. POST /integrations/IFOOD
integrationsRouter.post('/:provider', requireRole('ADMIN'), async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { provider } = req.params;
    const { clientId, clientSecret, merchantId, enabled, storeId, authMode } = req.body || {};
    if (!provider) return res.status(400).json({ message: 'provider é obrigatório' });

    if (!storeId) return res.status(400).json({ message: 'storeId é obrigatório e deve pertencer à empresa' });
    const store = await prisma.store.findFirst({ where: { id: storeId, companyId } });
    if (!store) return res.status(400).json({ message: 'storeId inválido ou não pertence à empresa' });

    const created = await prisma.apiIntegration.create({ data: {
      companyId,
      provider: String(provider).toUpperCase(),
      clientId: clientId || null,
      clientSecret: clientSecret || null,
      merchantId: merchantId || null,
      enabled: enabled ?? true,
      storeId: storeId,
      authMode: authMode || 'AUTH_CODE',
    } });
    res.status(201).json(created);
  } catch (e) {
    console.error('POST /integrations/:provider failed', e);
    res.status(500).json({ message: 'Erro ao criar integração', error: e.message });
  }
});