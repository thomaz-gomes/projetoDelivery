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
  fetchAndSaveMerchantName,
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

// Include shape for returning menu links with each integration. Keeps the
// payload light (menu id/name/storeId only) so the UI can render the
// "cardápios vinculados" section without an extra round-trip.
const integrationInclude = {
  menuLinks: {
    include: { menu: { select: { id: true, name: true, storeId: true } } },
  },
};

// Replaces the full set of menu links for an integration.
// `menuIds` is the authoritative list; `defaultMenuId` (if non-null) is
// marked as the routing default. All menus must belong to the integration's
// company. Pass `menuIds = []` to clear all links.
async function syncIntegrationMenus(integrationId, companyId, menuIds, defaultMenuId) {
  if (!Array.isArray(menuIds)) return;
  const uniqueIds = [...new Set(menuIds.filter(Boolean))];

  if (uniqueIds.length > 0) {
    const owned = await prisma.menu.findMany({
      where: { id: { in: uniqueIds }, store: { companyId } },
      select: { id: true },
    });
    if (owned.length !== uniqueIds.length) {
      const ownedSet = new Set(owned.map((m) => m.id));
      const orphan = uniqueIds.filter((id) => !ownedSet.has(id));
      throw new Error(`Cardápio(s) não pertencem à empresa: ${orphan.join(', ')}`);
    }
  }

  const effectiveDefault = defaultMenuId && uniqueIds.includes(defaultMenuId) ? defaultMenuId : null;

  await prisma.$transaction([
    prisma.apiIntegrationMenu.deleteMany({ where: { integrationId } }),
    ...uniqueIds.map((menuId) =>
      prisma.apiIntegrationMenu.create({
        data: { integrationId, menuId, isDefault: menuId === effectiveDefault },
      })
    ),
  ]);
}

// Salvar credenciais de um provider (ex.: IFOOD)
// Create a new integration for a provider (allow multiple per provider)
integrationsRouter.post('/', requireRole('ADMIN'), async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { provider, clientId, clientSecret, merchantId, merchantUuid, enabled, storeId, authMode, menuIds, defaultMenuId } = req.body || {};
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

    if (Array.isArray(menuIds)) {
      try {
        await syncIntegrationMenus(created.id, companyId, menuIds, defaultMenuId);
      } catch (e) {
        return res.status(400).json({ message: e.message });
      }
    }

    const full = await prisma.apiIntegration.findUnique({ where: { id: created.id }, include: integrationInclude });
    res.status(201).json(full);
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
    await prisma.apiIntegration.update({ where: { id }, data: {
      clientId: body.clientId ?? existing.clientId,
      clientSecret: body.clientSecret ?? existing.clientSecret,
      merchantId: body.merchantId ?? existing.merchantId,
      merchantUuid: body.merchantUuid ?? existing.merchantUuid,
      merchantName: body.merchantName !== undefined ? body.merchantName : existing.merchantName,
      enabled: body.enabled ?? existing.enabled,
      autoAccept: body.autoAccept ?? existing.autoAccept,
      storeId: body.storeId ?? existing.storeId,
      authMode: body.authMode ?? existing.authMode,
    } });

    if (Array.isArray(body.menuIds)) {
      try {
        await syncIntegrationMenus(id, companyId, body.menuIds, body.defaultMenuId);
      } catch (e) {
        return res.status(400).json({ message: e.message });
      }
    }

    const full = await prisma.apiIntegration.findUnique({ where: { id }, include: integrationInclude });
    console.log('[Integrations] updated integration:', { id: full.id, merchantId: full.merchantId, merchantUuid: full.merchantUuid, menus: full.menuLinks?.length });
    res.json(full);
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

// Sync merchant names from iFood for all integrations of the company
integrationsRouter.post('/ifood/sync-merchant-names', requireRole('ADMIN'), async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const integrations = await prisma.apiIntegration.findMany({
      where: { companyId, provider: 'IFOOD', accessToken: { not: null } },
    });
    const results = [];
    for (const integ of integrations) {
      try {
        const accessToken = await getIFoodAccessToken({ companyId, integrationId: integ.id });
        const name = await fetchAndSaveMerchantName(integ.id, accessToken, integ.merchantUuid);
        results.push({ id: integ.id, name: name || null, ok: true });
      } catch (e) {
        results.push({ id: integ.id, ok: false, error: e?.message });
      }
    }
    return res.json({ ok: true, results });
  } catch (e) {
    console.error('sync-merchant-names error:', e?.message);
    return res.status(500).json({ message: 'Erro ao sincronizar nomes', error: e?.message });
  }
});

// Listar integrações
integrationsRouter.get('/', requireRole('ADMIN'), async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const integrations = await prisma.apiIntegration.findMany({ where: { companyId }, include: integrationInclude });
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
    const integration = await prisma.apiIntegration.findFirst({ where: { id, companyId }, include: integrationInclude });
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
    const rows = await prisma.apiIntegration.findMany({ where: { companyId, provider: provider.toUpperCase() }, orderBy: { createdAt: 'asc' }, include: integrationInclude });
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
    const { token, menuId, merchantId } = req.body;
    if (!token) return res.status(400).json({ message: 'Token do aiqbridge é obrigatório' });
    if (!menuId) return res.status(400).json({ message: 'Selecione um cardápio' });

    // Integração → cardápio → loja: o cardápio define a loja. Valida que pertence à empresa.
    const menu = await prisma.menu.findFirst({ where: { id: menuId, store: { companyId } }, select: { id: true, storeId: true } });
    if (!menu) return res.status(400).json({ message: 'Cardápio inválido ou não pertence à empresa' });

    // Cada cardápio pode ter UMA integração AIQFOME. Casa pelo vínculo do cardápio
    // (não por storeId) para não substituir a integração de outro cardápio da mesma loja.
    const existingLink = await prisma.apiIntegrationMenu.findFirst({
      where: { menuId: menu.id, integration: { companyId, provider: 'AIQFOME' } },
      select: { integrationId: true },
    });

    let integ;
    if (existingLink) {
      integ = await prisma.apiIntegration.update({
        where: { id: existingLink.integrationId },
        data: { accessToken: token, merchantId: merchantId || null, storeId: menu.storeId, enabled: true },
      });
    } else {
      integ = await prisma.apiIntegration.create({
        data: { companyId, provider: 'AIQFOME', accessToken: token, merchantId: merchantId || null, storeId: menu.storeId, enabled: true },
      });
    }
    // Garante o vínculo (1 cardápio default) sem tocar nas demais integrações.
    await syncIntegrationMenus(integ.id, companyId, [menu.id], menu.id);
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
    const { integrationId } = req.body || {};
    // Honra o integrationId (há várias integrações — uma por cardápio); só cai
    // para a mais recente quando nenhum id é informado.
    const which = integrationId
      ? await prisma.apiIntegration.findFirst({ where: { id: integrationId, companyId, provider: 'AIQFOME' } })
      : await prisma.apiIntegration.findFirst({ where: { companyId, provider: 'AIQFOME' }, orderBy: { updatedAt: 'desc' } });
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

// aiqbridge usa JWT (3 segmentos). Detecta token claramente inválido para dar
// uma mensagem clara em vez do "invalid_token: Not enough segments" cru da bridge.
function isLikelyJwt(t) { return typeof t === 'string' && t.trim().split('.').length === 3; }
const INVALID_TOKEN_MSG = 'Token aiqbridge inválido (não é um JWT). Reconecte colando o token do dashboard aiqbridge.';

// Resolve a integração aiqfome alvo: por id (preferido) ou a mais recente.
async function findAiqfomeIntegration(companyId, integrationId) {
  const select = { id: true, accessToken: true, merchantId: true };
  if (integrationId) return prisma.apiIntegration.findFirst({ where: { id: integrationId, companyId, provider: 'AIQFOME' }, select });
  return prisma.apiIntegration.findFirst({ where: { companyId, provider: 'AIQFOME' }, orderBy: { updatedAt: 'desc' }, select });
}

// Register the webhook URL with aiqbridge and capture the signing secret.
// aiqbridge returns secret_key only once (on registration); we persist it so
// the /webhooks/aiqfome handler can validate the X-Signature HMAC.
integrationsRouter.post('/aiqfome/webhook/config', requireRole('ADMIN'), async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { integrationId, webhookUrl } = req.body || {};

    const integ = await findAiqfomeIntegration(companyId, integrationId);
    if (!integ) return res.status(404).json({ message: 'sem integração aiqfome' });
    if (!integ.accessToken) return res.status(400).json({ message: 'Conecte o token do aiqbridge antes de configurar o webhook.' });
    if (!isLikelyJwt(integ.accessToken)) return res.status(400).json({ message: INVALID_TOKEN_MSG });

    // Frontend computes the public URL (app./api. domain aware). Validate it.
    const url = String(webhookUrl || '').trim();
    if (!/^https?:\/\/.+\/webhooks\/aiqfome$/.test(url)) {
      return res.status(400).json({ message: 'webhookUrl inválida (esperado https://.../webhooks/aiqfome)' });
    }

    const resp = await aiqfomePost(integ.id, '/ifood/order/v1.0/webhook/config', { webhook_url: url });
    let secret = resp?.secret_key || resp?.secretKey || resp?.secret || resp?.data?.secret_key || null;

    // O registro nem sempre ativa a entrega — garante enabled=true (best-effort).
    let enabled = null;
    try {
      await aiqfomePut(integ.id, '/ifood/order/v1.0/webhook/config/toggle?enabled=true', {});
      enabled = true;
    } catch (e) {
      console.warn('[aiqbridge webhook/config] toggle enable falhou:', e?.response?.data || e?.message);
    }

    // O POST normalmente NÃO retorna o secret_key — só o GET. Busca a config
    // registrada para capturar o secret, o merchant_id e o estado de ativação.
    let merchantFromCfg = null;
    try {
      const cfg = await aiqfomeGet(integ.id, '/ifood/order/v1.0/webhook/config');
      secret = secret || cfg?.secret_key || cfg?.secretKey || cfg?.secret || null;
      merchantFromCfg = cfg?.merchant_id || cfg?.merchantId || null;
      if (cfg?.is_active != null) enabled = !!cfg.is_active;
    } catch (e) {
      console.warn('[aiqbridge webhook/config] GET pós-registro falhou:', e?.response?.data || e?.message);
    }

    const merchantId = integ.merchantId || (merchantFromCfg != null ? String(merchantFromCfg) : null);
    // Tenta gravar o secret; se a coluna webhookSecret ainda não existir (migração
    // pendente), grava ao menos o merchantId para o roteamento funcionar.
    let secretStored = false;
    try {
      await prisma.apiIntegration.update({ where: { id: integ.id }, data: { webhookSecret: secret || null, merchantId } });
      secretStored = !!secret;
    } catch (e) {
      console.warn('[aiqbridge webhook/config] update c/ webhookSecret falhou (coluna ausente?), gravando só merchantId:', e?.message);
      await prisma.apiIntegration.update({ where: { id: integ.id }, data: { merchantId } }).catch(() => {});
    }

    res.json({ ok: true, registered: true, secretCaptured: secretStored, enabled, webhookUrl: url });
  } catch (e) {
    console.error('[aiqbridge webhook/config] error:', e?.response?.data || e?.message);
    res.status(500).json({ message: 'Falha ao registrar webhook no aiqbridge', error: e?.response?.data?.message || e?.message || String(e) });
  }
});

// Inspeciona a config de webhook registrada no aiqbridge (URL + enabled).
// Diagnóstico: confirma se a bridge está apontando para a URL certa e ativa.
integrationsRouter.get('/aiqfome/webhook/config', requireRole('ADMIN'), async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const integ = await findAiqfomeIntegration(companyId, req.query.integrationId);
    if (!integ) return res.status(404).json({ message: 'sem integração aiqfome' });
    if (!integ.accessToken) return res.status(400).json({ message: 'Conecte o token do aiqbridge primeiro.' });
    if (!isLikelyJwt(integ.accessToken)) return res.status(400).json({ message: INVALID_TOKEN_MSG });

    const config = await aiqfomeGet(integ.id, '/ifood/order/v1.0/webhook/config');
    res.json({ ok: true, config, hasSecret: !!config?.secret_key });
  } catch (e) {
    console.error('[aiqbridge webhook/config GET] error:', e?.response?.data || e?.message);
    res.status(500).json({ message: 'Falha ao consultar webhook no aiqbridge', error: e?.response?.data?.message || e?.message || String(e) });
  }
});

// Dispara um evento de teste sintético: a bridge faz POST na nossa URL de webhook.
// Use para confirmar a entrega ponta-a-ponta sem precisar de um pedido real.
integrationsRouter.post('/aiqfome/webhook/test', requireRole('ADMIN'), async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const integ = await findAiqfomeIntegration(companyId, req.body?.integrationId);
    if (!integ) return res.status(404).json({ message: 'sem integração aiqfome' });
    if (!integ.accessToken) return res.status(400).json({ message: 'Conecte o token do aiqbridge primeiro.' });
    if (!isLikelyJwt(integ.accessToken)) return res.status(400).json({ message: INVALID_TOKEN_MSG });

    const result = await aiqfomePost(integ.id, '/ifood/order/v1.0/webhook/config/test', {});
    res.json({ ok: true, result });
  } catch (e) {
    console.error('[aiqbridge webhook/test] error:', e?.response?.data || e?.message);
    res.status(500).json({ message: 'Falha ao disparar evento de teste no aiqbridge', error: e?.response?.data?.message || e?.message || String(e) });
  }
});

// Lista os últimos webhooks aiqfome recebidos + status de processamento.
// Diagnóstico: mostra se o evento chegou e por que (não) virou pedido.
integrationsRouter.get('/aiqfome/webhook/events', requireRole('ADMIN'), async (req, res) => {
  try {
    const events = await prisma.webhookEvent.findMany({
      where: { provider: 'AIQFOME' },
      orderBy: { receivedAt: 'desc' },
      take: 20,
      select: { id: true, eventId: true, status: true, error: true, receivedAt: true, processedAt: true, payload: true },
    });
    const rows = events.map(e => ({
      eventId: e.eventId,
      status: e.status,           // RECEIVED | PROCESSED | ERROR
      error: e.error || null,
      receivedAt: e.receivedAt,
      processedAt: e.processedAt,
      event: e.payload?.event || e.payload?.code || e.payload?.fullCode || null,
      orderId: e.payload?.order_id || e.payload?.orderId || e.payload?.id || null,
      merchantId: e.payload?.merchant_id || e.payload?.merchantId || null,
      payload: e.payload || null,
    }));
    res.json({ ok: true, events: rows });
  } catch (e) {
    console.error('[aiqbridge webhook/events] error:', e?.message);
    res.status(500).json({ message: 'Falha ao listar eventos', error: e?.message || String(e) });
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

    const { integrationId } = req.body || {};
    const integration = integrationId
      ? await prisma.apiIntegration.findFirst({ where: { id: integrationId, companyId, provider: 'AIQFOME', enabled: true } })
      : await prisma.apiIntegration.findFirst({ where: { companyId, provider: 'AIQFOME', enabled: true }, orderBy: { updatedAt: 'desc' } });
    if (!integration) return res.status(404).json({ message: 'sem integração aiqfome ativa' });

    // aiqbridge uses iFood-compatible merchant status endpoint
    const statusMap = { open: 'OPEN', close: 'CLOSE', standby: 'STANDBY' };
    const data = await aiqfomePost(integration.id, '/ifood/merchant/v1.0/merchant/status', { operation: statusMap[action] });
    res.json({ ok: true, data });
  } catch (e) {
    console.error('[aiqbridge store/:action] error:', e?.message);
    res.status(500).json({ message: 'Falha ao alterar status da loja', error: e?.message || String(e) });
  }
});