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
  acknowledgeIFoodEvents,
  getIFoodOrderDetails,
  callIFoodAction,
} from '../integrations/ifood/orders.js';

import { ifoodPoll, ifoodAck } from '../integrations/ifood/client.js';
import { processIFoodWebhook } from '../services/ifoodWebhookProcessor.js';

export const integrationsRouter = express.Router();
integrationsRouter.use(authMiddleware);

// Salvar credenciais de um provider (ex.: IFOOD)
// Create a new integration for a provider (allow multiple per provider)
integrationsRouter.post('/', requireRole('ADMIN'), async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { provider, clientId, clientSecret, merchantId, merchantUuid, enabled, storeId, authMode } = req.body || {};
    console.log('[Integrations] POST /integrations payload:', { provider, clientId: !!clientId, clientSecret: !!clientSecret, merchantId, merchantUuid, enabled, storeId, authMode });
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
      merchantUuid: merchantUuid || null,
      enabled: enabled ?? true,
      storeId: storeId,
      authMode: authMode || 'AUTH_CODE',
    } });
    console.log('[Integrations] created integration:', { id: created.id, merchantId: created.merchantId, merchantUuid: created.merchantUuid });
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
    console.log('[Integrations] PUT /integrations payload:', body);
    const updated = await prisma.apiIntegration.update({ where: { id }, data: {
      clientId: body.clientId ?? existing.clientId,
      clientSecret: body.clientSecret ?? existing.clientSecret,
      merchantId: body.merchantId ?? existing.merchantId,
      merchantUuid: body.merchantUuid ?? existing.merchantUuid,
      enabled: body.enabled ?? existing.enabled,
      storeId: body.storeId ?? existing.storeId,
      authMode: body.authMode ?? existing.authMode,
    } });
    console.log('[Integrations] updated integration:', { id: updated.id, merchantId: updated.merchantId, merchantUuid: updated.merchantUuid });
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
    console.error('ifood/link/start error:', e?.response?.data ?? e?.message ?? e);
    // If the provider returned a structured error, forward it (with provider status)
    if (e?.response?.data) {
      return res.status(e.response.status || 502).json({ message: 'Falha ao iniciar vínculo (iFood)', providerError: e.response.data });
    }
    res.status(500).json({ message: 'Falha ao iniciar vínculo', error: e.message || String(e) });
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
    console.error('ifood/link/confirm error:', e?.response?.data ?? e?.message ?? e);
    if (e?.response?.data) {
      return res.status(e.response.status || 502).json({ message: 'Falha ao confirmar vínculo (iFood)', providerError: e.response.data });
    }
    res.status(500).json({ message: 'Falha ao confirmar vínculo', error: e?.message || String(e), details: null });
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
    merchantUuid: i.merchantUuid || null,
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
    const result = await ifoodPoll(companyId);
    const events = result?.events || [];

    // Persist events as WebhookEvent and process each to create/update orders
    const processed = [];
    for (const ev of events) {
      try {
        // upsert webhook event by provider event id
        const eventId = ev.id || ev.eventId || null;
        const we = await prisma.webhookEvent.upsert({
          where: { eventId: eventId || '' },
          update: { payload: ev, status: 'RECEIVED' },
          create: { provider: 'IFOOD', eventId: eventId || (ev.id || JSON.stringify(ev).slice(0,50)), payload: ev, status: 'RECEIVED' },
        });

        // process it (creates/upserts orders)
        await processIFoodWebhook(we.id);
        processed.push(we);
      } catch (e) {
        console.error('Erro ao persistir/processar evento iFood:', e?.message || e);
      }
    }

    // Send ACK for successfully processed events
    try {
      const ackEvents = events.map(e => ({ id: e.id }));
      if (ackEvents.length) await ifoodAck(companyId, events);
    } catch (e) {
      console.warn('Falha ao enviar ACK para iFood:', e?.message || e);
    }

    res.json({ ok: true, count: events.length, processed: processed.length, events });
  } catch (e) {
    console.error('Erro no polling iFood:', e.response?.data || e.message);
    res.status(500).json({ message: 'Falha ao buscar eventos', error: e.response?.data || e.message });
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
 *  ❌ Buscar motivos de cancelamento disponíveis para um pedido (obrigatório pela homologação)
 */
integrationsRouter.get('/ifood/orders/:id/cancellationReasons', requireRole('ADMIN'), async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const orderId = req.params.id;
    const { getIFoodAccessToken } = await import('../integrations/ifood/oauth.js');
    const axios = (await import('axios')).default;
    const token = await getIFoodAccessToken(companyId);
    const base = process.env.IFOOD_MERCHANT_BASE || 'https://merchant-api.ifood.com.br';
    const { data } = await axios.get(`${base}/order/v1.0/orders/${encodeURIComponent(orderId)}/cancellationReasons`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      timeout: 10000,
    });
    res.json(data);
  } catch (e) {
    console.error('Erro ao buscar motivos de cancelamento iFood:', e.response?.data || e.message);
    res.status(e.response?.status || 500).json({ message: 'Falha ao buscar motivos de cancelamento', error: e.response?.data || e.message });
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
// Accept both merchantId (numeric) and merchantUuid (UUID) from client
integrationsRouter.post('/:provider', requireRole('ADMIN'), async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { provider } = req.params;
    const { clientId, clientSecret, merchantId, merchantUuid, enabled, storeId, authMode } = req.body || {};
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
      merchantUuid: merchantUuid || null,
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

// Dev-only: expose some iFood-related env/debug info (safe: protected by ADMIN and disabled in production by default)
integrationsRouter.get('/ifood/debug', requireRole('ADMIN'), async (req, res) => {
  try {
    if (process.env.NODE_ENV === 'production' && process.env.ALLOW_IFOOD_DEBUG !== '1') {
      return res.status(403).json({ message: 'Not allowed in production' });
    }
    const companyId = req.user.companyId;
    const integration = await prisma.apiIntegration.findFirst({ where: { companyId, provider: 'IFOOD' }, orderBy: { updatedAt: 'desc' } });

    const mask = (s) => {
      if (!s) return null;
      // If operator explicitly allows full debug in non-prod, show full secret
      if (process.env.ALLOW_IFOOD_DEBUG_FULL === '1' && process.env.NODE_ENV !== 'production') return s;
      if (s.length <= 12) return s.replace(/./g, '*');
      return `${s.slice(0,6)}...${s.slice(-4)}`;
    };

    const envInfo = {
      IFOOD_CLIENT_ID: process.env.IFOOD_CLIENT_ID || null,
      IFOOD_CLIENT_SECRET: mask(process.env.IFOOD_CLIENT_SECRET || integration?.clientSecret || null),
      IFOOD_MERCHANT_ID: process.env.IFOOD_MERCHANT_ID || integration?.merchantId || null,
      IFOOD_BASE_URL: process.env.IFOOD_BASE_URL || null,
      ALLOW_IFOOD_DEBUG_FULL: process.env.ALLOW_IFOOD_DEBUG_FULL || null,
    };

    res.json({ ok: true, env: envInfo, integration: integration ? {
      id: integration.id,
      clientId: !!integration.clientId,
      clientSecret: !!integration.clientSecret,
      merchantId: integration.merchantId || null,
      hasToken: !!integration.accessToken,
      tokenExpiresAt: integration.tokenExpiresAt || null,
    } : null });
  } catch (e) {
    console.error('GET /integrations/ifood/debug error', e);
    res.status(500).json({ message: 'Erro ao obter debug iFood', error: e?.message || String(e) });
  }
});

// Dev-only: trigger a specific iFood action endpoint for testing from UI
integrationsRouter.post('/ifood/action', requireRole('ADMIN'), async (req, res) => {
  try {
    if (process.env.NODE_ENV === 'production' && process.env.ALLOW_IFOOD_DEBUG !== '1') {
      return res.status(403).json({ message: 'Not allowed in production' });
    }
    const companyId = req.user.companyId;
    const { orderId, action, extra } = req.body || {};
    if (!orderId || !action) return res.status(400).json({ message: 'orderId and action are required' });

    const r = await callIFoodAction(companyId, orderId, action, extra || {});
    res.json(r);
  } catch (e) {
    console.error('POST /integrations/ifood/action error', e?.response?.data ?? e?.message ?? e);
    if (e?.response?.data) return res.status(e.response.status || 502).json({ message: 'iFood error', providerError: e.response.data });
    res.status(500).json({ message: 'Failed to call iFood action', error: e?.message || String(e) });
  }
});