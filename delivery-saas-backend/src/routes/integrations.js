// src/routes/integrations.js
import express from 'express';
import { prisma } from '../prisma.js';
import { authMiddleware, requireRole } from '../auth.js';
import { requireModuleStrict } from '../modules.js';

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

import { saveAiqbridgeToken, clearAiqbridgeToken } from '../integrations/aiqfome/oauth.js';
import { syncMenuToAiqfome } from '../integrations/aiqfome/menu.js';
import { aiqfomeGet, aiqfomePost, aiqfomePut } from '../integrations/aiqfome/client.js';

export const integrationsRouter = express.Router();

// ───── aiqfome OAuth callback (NO auth — redirect from ID Magalu) ─────
// Exported separately so the main app can mount it outside of authMiddleware.
export const aiqfomeCallbackRouter = express.Router();
// Legacy OAuth callback — no longer used with aiqbridge (token-based auth)
aiqfomeCallbackRouter.get('/aiqfome/callback', async (req, res) => {
  try {
    const frontendUrl = process.env.PUBLIC_FRONTEND_URL || process.env.FRONTEND_URL || 'http://localhost:5173';
    return res.redirect(`${frontendUrl}/settings/integrations/aiqfome?info=Use+o+token+do+dashboard+aiqbridge`);
  } catch (e) {
    return res.status(200).send('aiqbridge usa token fixo — configure no painel');
  }
});


integrationsRouter.use(authMiddleware);
integrationsRouter.use(requireModuleStrict('CARDAPIO_COMPLETO'));

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
      autoAccept: body.autoAccept ?? existing.autoAccept,
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
        // Check if event was already processed (ACK failed on previous poll)
        const existingEvent = eventId ? await prisma.webhookEvent.findUnique({ where: { eventId } }) : null;
        if (existingEvent && existingEvent.status === 'PROCESSED') {
          console.log('[iFood Poll] skipping already-processed event:', eventId);
          processed.push(existingEvent);
          continue;
        }

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
 *  Responder a solicitacao de cancelamento do consumidor (Plataforma de Negociacao iFood)
 *  POST /integrations/ifood/orders/:id/cancellation-dispute
 *  Body: { action: 'ACCEPTED' | 'DENIED' }
 */
integrationsRouter.post('/ifood/orders/:id/cancellation-dispute', requireRole('ADMIN', 'ATTENDANT', 'STORE'), async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const orderId = req.params.id; // externalId do iFood
    const { action } = req.body || {};
    if (!action || !['ACCEPTED', 'DENIED'].includes(String(action).toUpperCase())) {
      return res.status(400).json({ message: 'action deve ser ACCEPTED ou DENIED' });
    }
    const { getIFoodAccessToken } = await import('../integrations/ifood/oauth.js');
    const axios = (await import('axios')).default;
    const token = await getIFoodAccessToken(companyId);
    const base = process.env.IFOOD_MERCHANT_BASE || 'https://merchant-api.ifood.com.br';
    const { data } = await axios.post(
      `${base}/order/v1.0/orders/${encodeURIComponent(orderId)}/cancellationDisputeResponse`,
      { status: String(action).toUpperCase() },
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, timeout: 10000 }
    );
    res.json({ ok: true, data });
  } catch (e) {
    console.error('Erro ao responder negociacao iFood:', e.response?.data || e.message);
    res.status(e.response?.status || 500).json({ message: 'Falha ao responder negociacao', error: e.response?.data || e.message });
  }
});

/**
 *  Confirmar eventos processados
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
// ── iFood Payment Method Mappings ──

// Default iFood payment codes with suggested PT-BR labels
const IFOOD_DEFAULT_CODES = [
  { ifoodCode: 'CASH', defaultName: 'Dinheiro' },
  { ifoodCode: 'CREDIT', defaultName: 'Crédito' },
  { ifoodCode: 'DEBIT', defaultName: 'Débito' },
  { ifoodCode: 'MEAL_VOUCHER', defaultName: 'Vale Refeição' },
  { ifoodCode: 'FOOD_VOUCHER', defaultName: 'Vale Alimentação' },
  { ifoodCode: 'PIX', defaultName: 'PIX' },
  { ifoodCode: 'WALLET', defaultName: 'Carteira Digital' },
  { ifoodCode: 'VOUCHER', defaultName: 'Voucher' },
  { ifoodCode: 'DELIVERY_FEE_VOUCHER', defaultName: 'Voucher Entrega' },
  { ifoodCode: 'DISCOUNT_VOUCHER', defaultName: 'Voucher Desconto' },
  { ifoodCode: 'OTHER', defaultName: 'Outros' },
  { ifoodCode: 'OTHER_VOUCHER', defaultName: 'Outro Voucher' },
  { ifoodCode: 'ONLINE', defaultName: 'Pagamento Online' },
];

// GET /integrations/ifood/:integrationId/payment-mappings
integrationsRouter.get('/ifood/:integrationId/payment-mappings', requireRole('ADMIN'), async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { integrationId } = req.params;
    const integ = await prisma.apiIntegration.findFirst({ where: { id: integrationId, companyId, provider: 'IFOOD' } });
    if (!integ) return res.status(404).json({ message: 'Integração não encontrada' });

    const mappings = await prisma.ifoodPaymentMapping.findMany({ where: { integrationId }, orderBy: { ifoodCode: 'asc' } });

    // Merge with defaults so frontend always shows all known codes
    const mapped = new Map(mappings.map(m => [m.ifoodCode, m]));
    const result = IFOOD_DEFAULT_CODES.map(d => {
      const existing = mapped.get(d.ifoodCode);
      return {
        ifoodCode: d.ifoodCode,
        defaultName: d.defaultName,
        systemName: existing ? existing.systemName : '',
        id: existing ? existing.id : null,
      };
    });
    // Include any extra mappings not in defaults (custom codes)
    for (const m of mappings) {
      if (!IFOOD_DEFAULT_CODES.find(d => d.ifoodCode === m.ifoodCode)) {
        result.push({ ifoodCode: m.ifoodCode, defaultName: m.ifoodCode, systemName: m.systemName, id: m.id });
      }
    }
    res.json(result);
  } catch (e) {
    console.error('GET payment-mappings error', e?.message);
    res.status(500).json({ message: 'Erro ao carregar mapeamentos' });
  }
});

// PUT /integrations/ifood/:integrationId/payment-mappings (bulk save)
integrationsRouter.put('/ifood/:integrationId/payment-mappings', requireRole('ADMIN'), async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { integrationId } = req.params;
    const integ = await prisma.apiIntegration.findFirst({ where: { id: integrationId, companyId, provider: 'IFOOD' } });
    if (!integ) return res.status(404).json({ message: 'Integração não encontrada' });

    const mappings = req.body?.mappings;
    if (!Array.isArray(mappings)) return res.status(400).json({ message: 'mappings deve ser um array' });

    // Upsert each mapping (only those with a non-empty systemName)
    const ops = [];
    for (const m of mappings) {
      if (!m.ifoodCode) continue;
      const code = String(m.ifoodCode).toUpperCase().trim();
      const name = String(m.systemName || '').trim();
      if (!name) {
        // Empty name = remove mapping
        ops.push(prisma.ifoodPaymentMapping.deleteMany({ where: { integrationId, ifoodCode: code } }));
      } else {
        ops.push(prisma.ifoodPaymentMapping.upsert({
          where: { integ_ifood_code_key: { integrationId, ifoodCode: code } },
          update: { systemName: name },
          create: { integrationId, ifoodCode: code, systemName: name },
        }));
      }
    }
    await prisma.$transaction(ops);

    res.json({ ok: true });
  } catch (e) {
    console.error('PUT payment-mappings error', e?.message);
    res.status(500).json({ message: 'Erro ao salvar mapeamentos' });
  }
});

// Helper: resolve payment label given companyId + iFood code + brand
// Exported so webhook processor and print template can use it
export async function resolveIfoodPaymentLabel(companyId, ifoodCode, brand) {
  if (!ifoodCode) return null;
  const code = String(ifoodCode).toUpperCase().trim();
  try {
    // Find any IFOOD integration for this company that has a mapping for this code
    const mapping = await prisma.ifoodPaymentMapping.findFirst({
      where: { ifoodCode: code, integration: { companyId, provider: 'IFOOD' } },
    });
    if (mapping?.systemName) {
      let label = mapping.systemName;
      if (brand) label += ` ${brand}`;
      return label;
    }
  } catch (e) { /* fallback */ }
  return null; // no mapping found, caller should use fallback
}

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

// ══════════════════════════════════════════════════
// ───── aiqfome routes (authenticated) ─────
// ══════════════════════════════════════════════════

// Save aiqbridge token (replaces OAuth — just paste the token from aiqbridge dashboard)
integrationsRouter.post('/aiqfome/link/start', requireRole('ADMIN'), async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { token, storeId, merchantId } = req.body;
    if (!token) return res.status(400).json({ message: 'Token do aiqbridge é obrigatório' });
    const integ = await saveAiqbridgeToken({ companyId, storeId, token, merchantId });
    res.json({ ok: true, integrationId: integ.id });
  } catch (e) {
    console.error('[aiqbridge link/start] error:', e?.message ?? e);
    res.status(500).json({ message: 'Falha ao salvar token aiqbridge', error: e?.message || String(e) });
  }
});

// Unlink: clear token and disable integration
integrationsRouter.post('/aiqfome/unlink', requireRole('ADMIN'), async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const which = await prisma.apiIntegration.findFirst({ where: { companyId, provider: 'AIQFOME' }, orderBy: { updatedAt: 'desc' } });
    if (!which) return res.status(404).json({ message: 'sem integração aiqfome' });
    const i = await prisma.apiIntegration.update({
      where: { id: which.id },
      data: { accessToken: null, refreshToken: null, tokenExpiresAt: null, enabled: false },
    });
    res.json({ ok: true, integration: i });
  } catch (e) {
    console.error('[aiqfome unlink] error:', e?.message);
    res.status(500).json({ message: 'Falha ao desvincular aiqfome', error: e?.message || String(e) });
  }
});

// ── aiqfome Payment Method Mappings ──

const AIQFOME_DEFAULT_CODES = [
  { aiqfomeCode: 'CASH', defaultName: 'Dinheiro' },
  { aiqfomeCode: 'CREDIT', defaultName: 'Crédito' },
  { aiqfomeCode: 'DEBIT', defaultName: 'Débito' },
  { aiqfomeCode: 'MEAL_VOUCHER', defaultName: 'Vale Refeição' },
  { aiqfomeCode: 'FOOD_VOUCHER', defaultName: 'Vale Alimentação' },
  { aiqfomeCode: 'PIX', defaultName: 'PIX' },
  { aiqfomeCode: 'WALLET', defaultName: 'Carteira Digital' },
  { aiqfomeCode: 'OTHER', defaultName: 'Outros' },
  { aiqfomeCode: 'ONLINE', defaultName: 'Pagamento Online' },
];

// GET /integrations/aiqfome/:integrationId/payment-mappings
integrationsRouter.get('/aiqfome/:integrationId/payment-mappings', requireRole('ADMIN'), async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { integrationId } = req.params;
    const integ = await prisma.apiIntegration.findFirst({ where: { id: integrationId, companyId, provider: 'AIQFOME' } });
    if (!integ) return res.status(404).json({ message: 'Integração não encontrada' });

    const mappings = await prisma.aiqfomePaymentMapping.findMany({ where: { integrationId }, orderBy: { aiqfomeCode: 'asc' } });

    // Merge with defaults so frontend always shows all known codes
    const mapped = new Map(mappings.map(m => [m.aiqfomeCode, m]));
    const result = AIQFOME_DEFAULT_CODES.map(d => {
      const existing = mapped.get(d.aiqfomeCode);
      return {
        aiqfomeCode: d.aiqfomeCode,
        defaultName: d.defaultName,
        systemName: existing ? existing.systemName : '',
        id: existing ? existing.id : null,
      };
    });
    // Include any extra mappings not in defaults (custom codes)
    for (const m of mappings) {
      if (!AIQFOME_DEFAULT_CODES.find(d => d.aiqfomeCode === m.aiqfomeCode)) {
        result.push({ aiqfomeCode: m.aiqfomeCode, defaultName: m.aiqfomeCode, systemName: m.systemName, id: m.id });
      }
    }
    res.json(result);
  } catch (e) {
    console.error('[aiqfome] GET payment-mappings error', e?.message);
    res.status(500).json({ message: 'Erro ao carregar mapeamentos' });
  }
});

// PUT /integrations/aiqfome/:integrationId/payment-mappings (bulk save)
integrationsRouter.put('/aiqfome/:integrationId/payment-mappings', requireRole('ADMIN'), async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { integrationId } = req.params;
    const integ = await prisma.apiIntegration.findFirst({ where: { id: integrationId, companyId, provider: 'AIQFOME' } });
    if (!integ) return res.status(404).json({ message: 'Integração não encontrada' });

    const mappings = req.body?.mappings;
    if (!Array.isArray(mappings)) return res.status(400).json({ message: 'mappings deve ser um array' });

    const ops = [];
    for (const m of mappings) {
      if (!m.aiqfomeCode) continue;
      const code = String(m.aiqfomeCode).toUpperCase().trim();
      const name = String(m.systemName || '').trim();
      if (!name) {
        ops.push(prisma.aiqfomePaymentMapping.deleteMany({ where: { integrationId, aiqfomeCode: code } }));
      } else {
        ops.push(prisma.aiqfomePaymentMapping.upsert({
          where: { integ_aiqfome_code_key: { integrationId, aiqfomeCode: code } },
          update: { systemName: name },
          create: { integrationId, aiqfomeCode: code, systemName: name },
        }));
      }
    }
    await prisma.$transaction(ops);

    res.json({ ok: true });
  } catch (e) {
    console.error('[aiqfome] PUT payment-mappings error', e?.message);
    res.status(500).json({ message: 'Erro ao salvar mapeamentos' });
  }
});

// Menu sync
integrationsRouter.post('/aiqfome/menu/sync', requireRole('ADMIN'), async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { integrationId, menuId } = req.body;
    if (!integrationId || !menuId) return res.status(400).json({ message: 'integrationId e menuId são obrigatórios' });
    const r = await syncMenuToAiqfome(integrationId, menuId);
    res.json(r);
  } catch (e) {
    console.error('[aiqfome menu/sync] error:', e?.message);
    res.status(500).json({ message: 'Falha ao sincronizar cardápio com aiqfome', error: e?.message || String(e) });
  }
});

// Store management via aiqbridge: open / close / standby
integrationsRouter.post('/aiqfome/store/:action', requireRole('ADMIN'), async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { action } = req.params;
    if (!['open', 'close', 'standby'].includes(action)) {
      return res.status(400).json({ message: 'action deve ser open, close ou standby' });
    }

    const integration = await prisma.apiIntegration.findFirst({
      where: { companyId, provider: 'AIQFOME', enabled: true },
      orderBy: { updatedAt: 'desc' },
    });
    if (!integration) return res.status(404).json({ message: 'sem integração aiqfome ativa' });

    // aiqbridge uses iFood-compatible merchant status endpoint
    const statusMap = { open: 'OPEN', close: 'CLOSED', standby: 'STANDBY' };
    const data = await aiqfomePost(integration.id, '/merchant/status', { status: statusMap[action] });
    res.json({ ok: true, data });
  } catch (e) {
    console.error('[aiqbridge store/:action] error:', e?.message);
    res.status(500).json({ message: 'Falha ao alterar status da loja', error: e?.message || String(e) });
  }
});