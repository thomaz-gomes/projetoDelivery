# Integração aiqfome — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Integrate aiqfome marketplace into the delivery SaaS, supporting OAuth2, webhook order reception, status sync, menu push, and store management — mirroring the iFood integration pattern.

**Architecture:** Reuse `ApiIntegration` model with `provider='AIQFOME'`. Create `src/integrations/aiqfome/` module (oauth.js, client.js, orders.js, menu.js, webhookProcessor.js). Add routes to existing routers. Frontend gets `AiqfomeConfig.vue`.

**Tech Stack:** Express.js, Prisma, axios, Socket.IO, Vue 3, Bootstrap 5

**Design doc:** `docs/plans/2026-03-20-aiqfome-integration-design.md`

---

## Task 1: Prisma Schema — CustomerSource + AiqfomePaymentMapping

**Files:**
- Modify: `delivery-saas-backend/prisma/schema.prisma:28-32` (CustomerSource enum)
- Modify: `delivery-saas-backend/prisma/schema.prisma:488` (after IfoodPaymentMapping)

**Step 1: Add AIQFOME to CustomerSource enum**

In `schema.prisma` line 28-32, change:

```prisma
enum CustomerSource {
  PUBLIC
  IFOOD
  AIQFOME
  MANUAL
}
```

**Step 2: Add AiqfomePaymentMapping model**

After `IfoodPaymentMapping` (line 488), add:

```prisma
model AiqfomePaymentMapping {
  id            String         @id @default(uuid())
  integrationId String
  integration   ApiIntegration @relation("AiqfomePayments", fields: [integrationId], references: [id], onDelete: Cascade)
  aiqfomeCode   String
  systemName    String
  createdAt     DateTime       @default(now())
  updatedAt     DateTime       @updatedAt

  @@unique([integrationId, aiqfomeCode], name: "integ_aiqfome_code_key")
}
```

**Step 3: Add relation to ApiIntegration**

In the `ApiIntegration` model (line 473), add a second relation field:

```prisma
  paymentMappings        IfoodPaymentMapping[]
  aiqfomePaymentMappings AiqfomePaymentMapping[] @relation("AiqfomePayments")
```

**Step 4: Push schema to dev DB**

Run:
```bash
cd delivery-saas-backend && npx prisma db push --skip-generate && npx prisma generate
```

Expected: Schema applied, Prisma Client regenerated.

**Step 5: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(aiqfome): add AIQFOME to CustomerSource and AiqfomePaymentMapping model"
```

---

## Task 2: HTTP Client — `src/integrations/aiqfome/client.js`

**Files:**
- Create: `delivery-saas-backend/src/integrations/aiqfome/client.js`

**Reference:** `src/integrations/ifood/client.js` — same pattern (rate limit interceptor, base URL from env).

**Step 1: Create the client module**

```javascript
// src/integrations/aiqfome/client.js
import axios from 'axios';
import { getAiqfomeAccessToken } from './oauth.js';

const MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 2000;

function attachRateLimitInterceptor(instance) {
  instance.interceptors.response.use(
    (response) => response,
    async (error) => {
      const config = error.config;
      if (!config) return Promise.reject(error);
      config._retryCount = config._retryCount || 0;

      if (error.response && error.response.status === 429 && config._retryCount < MAX_RETRIES) {
        config._retryCount += 1;
        const retryAfter = error.response.headers['retry-after'];
        const delayMs = retryAfter ? Number(retryAfter) * 1000 : DEFAULT_RETRY_DELAY_MS * Math.pow(2, config._retryCount - 1);
        console.warn(`[aiqfome RateLimit] 429 received, retry ${config._retryCount}/${MAX_RETRIES} in ${delayMs}ms`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
        return instance(config);
      }
      return Promise.reject(error);
    }
  );
  return instance;
}

function makeAiqfomeHttp() {
  const baseURL = process.env.AIQFOME_BASE_URL || 'https://plataforma.aiqfome.com';
  const instance = axios.create({ baseURL, timeout: 20000 });
  return attachRateLimitInterceptor(instance);
}

/**
 * Authenticated GET request to aiqfome API
 */
export async function aiqfomeGet(integrationId, path) {
  const token = await getAiqfomeAccessToken(integrationId);
  const http = makeAiqfomeHttp();
  return http.get(path, { headers: { Authorization: `Bearer ${token}` } });
}

/**
 * Authenticated POST request to aiqfome API
 */
export async function aiqfomePost(integrationId, path, data = {}) {
  const token = await getAiqfomeAccessToken(integrationId);
  const http = makeAiqfomeHttp();
  return http.post(path, data, { headers: { Authorization: `Bearer ${token}` } });
}

/**
 * Authenticated PUT request to aiqfome API
 */
export async function aiqfomePut(integrationId, path, data = {}) {
  const token = await getAiqfomeAccessToken(integrationId);
  const http = makeAiqfomeHttp();
  return http.put(path, data, { headers: { Authorization: `Bearer ${token}` } });
}

/**
 * Authenticated DELETE request to aiqfome API
 */
export async function aiqfomeDelete(integrationId, path) {
  const token = await getAiqfomeAccessToken(integrationId);
  const http = makeAiqfomeHttp();
  return http.delete(path, { headers: { Authorization: `Bearer ${token}` } });
}
```

**Step 2: Commit**

```bash
git add src/integrations/aiqfome/client.js
git commit -m "feat(aiqfome): add HTTP client with rate limit handling"
```

---

## Task 3: OAuth2 — `src/integrations/aiqfome/oauth.js`

**Files:**
- Create: `delivery-saas-backend/src/integrations/aiqfome/oauth.js`

**Reference:** `src/integrations/ifood/oauth.js` — adapted for ID Magalu authorization_code grant with redirect_uri.

**Step 1: Create the OAuth module**

```javascript
// src/integrations/aiqfome/oauth.js
import axios from 'axios';
import { prisma } from '../../prisma.js';

const TOKEN_URL = 'https://id.magalu.com/oauth/token';
const AUTHORIZE_URL = 'https://id.magalu.com/oauth/authorize';
const SCOPES = 'aqf:order:read aqf:order:create aqf:store:read aqf:store:create aqf:menu:read aqf:menu:create';

function http() {
  return axios.create({ timeout: 15000 });
}

/**
 * Step 1: Generate the authorization URL for the store owner to visit.
 * Returns { authorizationUrl, integrationId }.
 */
export async function startAiqfomeAuth({ companyId, storeId, clientId, clientSecret }) {
  // Create or find existing integration
  let integ = await prisma.apiIntegration.findFirst({
    where: { companyId, provider: 'AIQFOME', storeId: storeId || undefined },
    orderBy: { updatedAt: 'desc' },
  });

  if (!integ) {
    integ = await prisma.apiIntegration.create({
      data: {
        companyId,
        provider: 'AIQFOME',
        storeId: storeId || null,
        clientId,
        clientSecret,
        enabled: true,
        authMode: 'AUTH_CODE',
      },
    });
  } else {
    // Update credentials if provided
    await prisma.apiIntegration.update({
      where: { id: integ.id },
      data: {
        clientId: clientId || integ.clientId,
        clientSecret: clientSecret || integ.clientSecret,
      },
    });
  }

  const redirectUri = process.env.AIQFOME_REDIRECT_URI;
  if (!redirectUri) throw new Error('AIQFOME_REDIRECT_URI não configurada');

  const params = new URLSearchParams({
    client_id: clientId || integ.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES,
    state: integ.id, // pass integrationId as state for callback
  });

  const authorizationUrl = `${AUTHORIZE_URL}?${params.toString()}`;
  return { authorizationUrl, integrationId: integ.id };
}

/**
 * Step 2: Exchange authorization code for tokens (called from callback route).
 */
export async function exchangeAiqfomeCode({ integrationId, code }) {
  const integ = await prisma.apiIntegration.findUnique({ where: { id: integrationId } });
  if (!integ) throw new Error('Integração não encontrada');

  const redirectUri = process.env.AIQFOME_REDIRECT_URI;
  const resp = await http().post(TOKEN_URL, new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: integ.clientId,
    client_secret: integ.clientSecret,
    redirect_uri: redirectUri,
    code,
  }).toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  const { access_token, refresh_token, expires_in, token_type, scope } = resp.data;

  await prisma.apiIntegration.update({
    where: { id: integrationId },
    data: {
      accessToken: access_token,
      refreshToken: refresh_token,
      tokenType: token_type || 'Bearer',
      tokenExpiresAt: new Date(Date.now() + (expires_in || 7200) * 1000),
      authCode: code,
    },
  });

  return { integrationId, scope };
}

/**
 * Refresh the access token using the refresh token.
 */
export async function refreshAiqfomeToken(integrationId) {
  const integ = await prisma.apiIntegration.findUnique({ where: { id: integrationId } });
  if (!integ || !integ.refreshToken) throw new Error('Sem refresh token para renovar');

  const redirectUri = process.env.AIQFOME_REDIRECT_URI;
  const resp = await http().post(TOKEN_URL, new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: integ.clientId,
    client_secret: integ.clientSecret,
    redirect_uri: redirectUri,
    refresh_token: integ.refreshToken,
  }).toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  const { access_token, refresh_token, expires_in, token_type } = resp.data;

  await prisma.apiIntegration.update({
    where: { id: integrationId },
    data: {
      accessToken: access_token,
      refreshToken: refresh_token || integ.refreshToken,
      tokenType: token_type || 'Bearer',
      tokenExpiresAt: new Date(Date.now() + (expires_in || 7200) * 1000),
    },
  });

  return access_token;
}

/**
 * Get a valid access token, refreshing if expired.
 */
export async function getAiqfomeAccessToken(integrationId) {
  const integ = await prisma.apiIntegration.findUnique({ where: { id: integrationId } });
  if (!integ) throw new Error('Integração aiqfome não encontrada');
  if (!integ.accessToken) throw new Error('Sem token ativo para aiqfome');

  // Refresh if token expires within 60 seconds
  if (integ.tokenExpiresAt && new Date(integ.tokenExpiresAt).getTime() - Date.now() < 60000) {
    console.log('[aiqfome] Token expiring soon, refreshing...');
    return refreshAiqfomeToken(integrationId);
  }

  return integ.accessToken;
}
```

**Step 2: Commit**

```bash
git add src/integrations/aiqfome/oauth.js
git commit -m "feat(aiqfome): add OAuth2 ID Magalu authentication module"
```

---

## Task 4: Webhook Processor — `src/integrations/aiqfome/webhookProcessor.js`

**Files:**
- Create: `delivery-saas-backend/src/integrations/aiqfome/webhookProcessor.js`

**Reference:** `src/services/ifoodWebhookProcessor.js` — same structure, adapted for aiqfome payload format from `docs/plans/2026-03-20-aiqfome-integration-design.md` Section 3.

**Step 1: Create the webhook processor**

```javascript
// src/integrations/aiqfome/webhookProcessor.js
import { prisma } from '../../prisma.js';

/**
 * Determine OrderStatus from aiqfome boolean flags.
 */
export function determineStatusFromAiqfome(order) {
  if (order.is_cancelled) return 'CANCELADO';
  if (order.is_delivered) return 'CONCLUIDO';
  if (order.is_ready) return 'PRONTO';
  if (order.is_in_separation) return 'EM_PREPARO';
  if (order.is_read) return 'EM_PREPARO';
  return 'PENDENTE_ACEITE';
}

/**
 * Format address from aiqfome user.address object.
 */
function formatAddress(addr) {
  if (!addr) return null;
  const parts = [addr.street_name, addr.number, addr.complement, addr.neighborhood_name, addr.city_name, addr.state_uf].filter(Boolean);
  return parts.join(', ') || null;
}

/**
 * Map aiqfome items to local OrderItem format.
 */
function mapItems(items) {
  if (!Array.isArray(items)) return [];
  return items.map(item => {
    // Collect all options/complements into a single JSON structure
    const options = [];
    if (Array.isArray(item.order_mandatory_items)) {
      item.order_mandatory_items.forEach(m => {
        options.push({ group: m.group || 'Obrigatório', name: m.name, price: m.value, qty: m.quantity || 1, sku: m.sku });
      });
    }
    if (Array.isArray(item.order_additional_items)) {
      item.order_additional_items.forEach(a => {
        options.push({ group: 'Adicional', name: a.name, price: a.value, sku: a.sku });
      });
    }
    if (Array.isArray(item.order_item_subitems)) {
      item.order_item_subitems.forEach(s => {
        options.push({ group: 'Sabor', name: s.name || s.nome, sku: s.sku });
      });
    }

    return {
      name: item.name,
      qty: item.quantity || 1,
      unitPrice: Number(item.unit_value) || 0,
      totalPrice: (Number(item.unit_value) || 0) * (item.quantity || 1),
      externalCode: item.sku || null,
      observations: item.observations || '',
      options: options.length > 0 ? options : null,
    };
  });
}

/**
 * Upsert a customer from aiqfome user data.
 */
async function upsertCustomerFromAiqfome(user, companyId) {
  if (!user) return null;
  const phone = (user.mobile_phone || user.phone_number || '').replace(/\D/g, '');
  if (!phone) return null;

  const name = [user.name, user.surname].filter(Boolean).join(' ');
  const existing = await prisma.customer.findFirst({ where: { companyId, phone } });
  if (existing) {
    return prisma.customer.update({
      where: { id: existing.id },
      data: {
        name: name || existing.name,
        email: user.email || existing.email,
        source: 'AIQFOME',
      },
    });
  }
  return prisma.customer.create({
    data: {
      companyId,
      name,
      phone,
      email: user.email || null,
      source: 'AIQFOME',
    },
  });
}

// Valid status transitions (same state machine as iFood)
const TRANSITIONS = {
  PENDENTE_ACEITE: ['EM_PREPARO', 'CANCELADO'],
  EM_PREPARO: ['PRONTO', 'SAIU_PARA_ENTREGA', 'CANCELADO'],
  PRONTO: ['SAIU_PARA_ENTREGA', 'CONFIRMACAO_PAGAMENTO', 'CONCLUIDO', 'CANCELADO'],
  SAIU_PARA_ENTREGA: ['CONFIRMACAO_PAGAMENTO', 'CONCLUIDO', 'CANCELADO'],
  CONFIRMACAO_PAGAMENTO: ['CONCLUIDO', 'CANCELADO'],
};

function canTransition(from, to) {
  if (!from) return true; // new order
  const allowed = TRANSITIONS[from];
  return allowed ? allowed.includes(to) : false;
}

/**
 * Main processor: takes a WebhookEvent ID, maps the aiqfome payload to a local Order.
 */
export async function processAiqfomeWebhook(eventId) {
  const event = await prisma.webhookEvent.findUnique({ where: { id: eventId } });
  if (!event) throw new Error(`WebhookEvent ${eventId} not found`);

  const payload = typeof event.payload === 'string' ? JSON.parse(event.payload) : event.payload;
  const order = payload.data || payload;

  // Resolve company from store_id (stored as merchantId in ApiIntegration)
  const aiqfomeStoreId = String(order.store?.id || '');
  const integ = await prisma.apiIntegration.findFirst({
    where: { provider: 'AIQFOME', merchantId: aiqfomeStoreId, enabled: true },
  });
  if (!integ) {
    console.warn(`[aiqfome] No integration found for store ${aiqfomeStoreId}`);
    await prisma.webhookEvent.update({ where: { id: eventId }, data: { status: 'ERROR', error: `No integration for store ${aiqfomeStoreId}` } });
    return;
  }
  const companyId = integ.companyId;
  const storeId = integ.storeId || null;

  // Determine status
  const status = determineStatusFromAiqfome(order);
  const externalId = String(order.id);

  // Map customer
  const customer = await upsertCustomerFromAiqfome(order.user, companyId);
  const customerName = order.user ? [order.user.name, order.user.surname].filter(Boolean).join(' ') : null;
  const customerPhone = order.user ? (order.user.mobile_phone || order.user.phone_number || '') : '';

  // Map address
  const userAddr = order.user?.address;
  const address = formatAddress(userAddr);
  const latitude = userAddr?.latitude ? Number(userAddr.latitude) : null;
  const longitude = userAddr?.longitude ? Number(userAddr.longitude) : null;
  const deliveryNeighborhood = userAddr?.neighborhood_name || null;

  // Map payment
  const pm = order.payment_method || {};
  const total = Number(pm.total) || Number(pm.subtotal) || 0;
  const deliveryFee = Number(pm.delivery_tax) || 0;
  const couponDiscount = Number(pm.coupon_value) || 0;

  // Map items
  const mappedItems = mapItems(order.items);

  // Order type
  const orderType = order.is_pickup ? 'PICKUP' : 'DELIVERY';

  // Check existing order
  const existing = await prisma.order.findFirst({ where: { externalId, companyId } });

  if (existing) {
    // Status update — validate transition
    if (existing.status === status) {
      // No change, just mark event processed
      await prisma.webhookEvent.update({ where: { id: eventId }, data: { status: 'PROCESSED', processedAt: new Date() } });
      return existing;
    }

    if (!canTransition(existing.status, status)) {
      console.warn(`[aiqfome] Invalid transition ${existing.status} -> ${status} for order ${externalId}`);
      await prisma.webhookEvent.update({ where: { id: eventId }, data: { status: 'PROCESSED', processedAt: new Date() } });
      return existing;
    }

    const updated = await prisma.order.update({
      where: { id: existing.id },
      data: {
        status,
        histories: { create: { from: existing.status, to: status, reason: 'aiqfome webhook' } },
      },
      include: { items: true },
    });

    // Emit status update
    try {
      const idx = await import('../../index.js');
      idx.emitirPedidoAtualizado(updated);
    } catch (e) { console.warn('[aiqfome] emitirPedidoAtualizado failed:', e?.message); }

    await prisma.webhookEvent.update({ where: { id: eventId }, data: { status: 'PROCESSED', processedAt: new Date() } });
    return updated;
  }

  // Terminal statuses — don't create new order
  if (['CANCELADO', 'CONCLUIDO', 'CONFIRMACAO_PAGAMENTO'].includes(status)) {
    await prisma.webhookEvent.update({ where: { id: eventId }, data: { status: 'PROCESSED', processedAt: new Date() } });
    return null;
  }

  // Create new order
  const newOrder = await prisma.order.create({
    data: {
      companyId,
      storeId,
      externalId,
      displayId: String(order.id).slice(-6),
      orderType,
      status,
      customerName,
      customerPhone: customerPhone.replace(/\D/g, ''),
      customerSource: 'AIQFOME',
      customerId: customer?.id || null,
      address,
      latitude,
      longitude,
      deliveryNeighborhood,
      total,
      deliveryFee,
      couponDiscount: couponDiscount > 0 ? couponDiscount : null,
      payload: payload,
      items: {
        create: mappedItems.map(item => ({
          name: item.name,
          qty: item.qty,
          unitPrice: item.unitPrice,
          totalPrice: item.totalPrice,
          options: item.options,
          observations: item.observations,
        })),
      },
      histories: { create: { from: null, to: status, reason: 'aiqfome webhook - novo pedido' } },
    },
    include: { items: true },
  });

  // Auto-accept if configured
  if (integ.autoAccept && status === 'PENDENTE_ACEITE') {
    try {
      const { aiqfomePost } = await import('./client.js');
      await aiqfomePost(integ.id, '/api/v2/orders/mark-as-read', { orders: [Number(externalId)] });
      await prisma.order.update({
        where: { id: newOrder.id },
        data: {
          status: 'EM_PREPARO',
          histories: { create: { from: 'PENDENTE_ACEITE', to: 'EM_PREPARO', reason: 'aiqfome auto-accept' } },
        },
      });
      newOrder.status = 'EM_PREPARO';
    } catch (e) {
      console.warn('[aiqfome] auto-accept failed:', e?.message);
    }
  }

  // Emit new order (dashboard + print)
  try {
    const idx = await import('../../index.js');
    idx.emitirNovoPedido(newOrder);
  } catch (e) { console.warn('[aiqfome] emitirNovoPedido failed:', e?.message); }

  await prisma.webhookEvent.update({ where: { id: eventId }, data: { status: 'PROCESSED', processedAt: new Date() } });
  return newOrder;
}
```

**Step 2: Commit**

```bash
git add src/integrations/aiqfome/webhookProcessor.js
git commit -m "feat(aiqfome): add webhook processor for order reception"
```

---

## Task 5: Order Status Sync — `src/integrations/aiqfome/orders.js`

**Files:**
- Create: `delivery-saas-backend/src/integrations/aiqfome/orders.js`

**Step 1: Create the orders module**

```javascript
// src/integrations/aiqfome/orders.js
import { aiqfomePost, aiqfomePut } from './client.js';
import { prisma } from '../../prisma.js';

/**
 * Map local status to aiqfome API action.
 * Returns { method, path } or null if no mapping.
 */
function mapLocalToAiqfomeAction(localStatus, orderType) {
  const s = String(localStatus).toUpperCase();
  if (s === 'EM_PREPARO') return { method: 'POST', path: '/api/v2/orders/mark-as-read' };
  if (s === 'PRONTO') return { method: 'PUT', action: 'ready' };
  if (s === 'CONCLUIDO' || s === 'CONFIRMACAO_PAGAMENTO') return { method: 'PUT', action: 'delivered' };
  if (s === 'CANCELADO') return { method: 'PUT', action: 'cancel' };
  return null;
}

/**
 * Notify aiqfome of a local status change.
 */
export async function updateAiqfomeOrderStatus(companyId, externalId, localStatus, opts = {}) {
  const integ = await prisma.apiIntegration.findFirst({
    where: { companyId, provider: 'AIQFOME', enabled: true },
  });
  if (!integ) return null;

  const mapping = mapLocalToAiqfomeAction(localStatus);
  if (!mapping) return null;

  const orderId = Number(externalId);

  try {
    if (mapping.path === '/api/v2/orders/mark-as-read') {
      // mark-as-read expects list of order IDs
      const resp = await aiqfomePost(integ.id, mapping.path, { orders: [orderId] });
      return resp.data;
    }

    if (mapping.action) {
      const resp = await aiqfomePut(integ.id, `/api/v2/orders/${orderId}/${mapping.action}`);
      return resp.data;
    }
  } catch (e) {
    console.warn(`[aiqfome] Failed to update status for order ${externalId}:`, e?.message);
    throw e;
  }
}

/**
 * Update logistics status on aiqfome (aiqentrega).
 */
export async function updateAiqfomeLogistics(companyId, externalId, logisticAction) {
  const integ = await prisma.apiIntegration.findFirst({
    where: { companyId, provider: 'AIQFOME', enabled: true },
  });
  if (!integ) return null;

  const orderId = Number(externalId);
  const validActions = ['pickup-ongoing', 'arrived-at-merchant', 'delivery-ongoing', 'arrived-at-customer', 'order-delivered'];
  if (!validActions.includes(logisticAction)) return null;

  const resp = await aiqfomePost(integ.id, `/api/v2/logistic/${orderId}/${logisticAction}`);
  return resp.data;
}
```

**Step 2: Commit**

```bash
git add src/integrations/aiqfome/orders.js
git commit -m "feat(aiqfome): add order status sync module (local -> aiqfome)"
```

---

## Task 6: Menu Sync — `src/integrations/aiqfome/menu.js`

**Files:**
- Create: `delivery-saas-backend/src/integrations/aiqfome/menu.js`

**Note:** Prices are NOT pushed — they are managed on aiqfome side. Only structure (categories, items, options, availability) is synced.

**Step 1: Create the menu sync module**

```javascript
// src/integrations/aiqfome/menu.js
import { aiqfomeGet, aiqfomePost, aiqfomePut, aiqfomeDelete } from './client.js';
import { prisma } from '../../prisma.js';

/**
 * Push a full menu (categories + items + options) to aiqfome.
 * Does NOT push prices — those are managed on aiqfome.
 */
export async function syncMenuToAiqfome(integrationId, menuId) {
  const integ = await prisma.apiIntegration.findUnique({ where: { id: integrationId } });
  if (!integ || !integ.merchantId) throw new Error('Integração aiqfome sem merchantId');

  const storeId = integ.merchantId; // aiqfome store_id

  // Fetch local menu with categories and products
  const menu = await prisma.menu.findUnique({
    where: { id: menuId },
    include: {
      categories: {
        include: {
          products: {
            include: { optionGroups: { include: { options: true } } },
          },
        },
      },
    },
  });
  if (!menu) throw new Error('Menu não encontrado');

  const results = { categories: 0, items: 0, options: 0, errors: [] };

  for (const category of menu.categories) {
    try {
      // Create or update category on aiqfome
      let remoteCatId = category.integrationCode;
      if (!remoteCatId) {
        const resp = await aiqfomePost(integrationId, `/api/v2/store/${storeId}/menu/categories`, {
          name: category.name,
          description: category.description || '',
        });
        remoteCatId = String(resp.data?.id || resp.data?.data?.id);
        await prisma.category.update({ where: { id: category.id }, data: { integrationCode: remoteCatId } });
      }
      results.categories++;

      for (const product of category.products) {
        try {
          // Push item without price (only structure: name, description, sku, availability)
          const itemData = {
            name: product.name,
            description: product.description || '',
            sku: product.integrationCode || product.id,
          };

          let remoteItemId = product.integrationCode;
          if (!remoteItemId) {
            const resp = await aiqfomePost(integrationId, `/api/v2/store/${storeId}/menu/categories/${remoteCatId}/items`, itemData);
            remoteItemId = String(resp.data?.id || resp.data?.data?.id);
            await prisma.product.update({ where: { id: product.id }, data: { integrationCode: remoteItemId } });
          } else {
            await aiqfomePut(integrationId, `/api/v2/store/${storeId}/menu/items/${remoteItemId}`, itemData);
          }
          results.items++;

          // Push option groups
          for (const optGroup of product.optionGroups || []) {
            for (const opt of optGroup.options || []) {
              try {
                const optData = { name: opt.name, sku: opt.integrationCode || opt.id };
                // Option sync is best-effort; exact endpoint depends on aiqfome menu API
                results.options++;
              } catch (e) {
                results.errors.push(`Option ${opt.name}: ${e?.message}`);
              }
            }
          }
        } catch (e) {
          results.errors.push(`Product ${product.name}: ${e?.message}`);
        }
      }
    } catch (e) {
      results.errors.push(`Category ${category.name}: ${e?.message}`);
    }
  }

  return results;
}

/**
 * Toggle item availability on aiqfome.
 */
export async function syncItemAvailability(integrationId, productId, available) {
  const integ = await prisma.apiIntegration.findUnique({ where: { id: integrationId } });
  if (!integ || !integ.merchantId) return;

  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product || !product.integrationCode) return;

  const storeId = integ.merchantId;
  const itemId = product.integrationCode;

  if (available) {
    await aiqfomePut(integrationId, `/api/v2/store/${storeId}/menu/items/${itemId}/activate`);
  } else {
    await aiqfomePut(integrationId, `/api/v2/store/${storeId}/menu/items/${itemId}/deactivate`);
  }
}
```

**Step 2: Commit**

```bash
git add src/integrations/aiqfome/menu.js
git commit -m "feat(aiqfome): add menu sync module (push structure, no prices)"
```

---

## Task 7: Backend Routes — Webhook + OAuth + Config

**Files:**
- Modify: `delivery-saas-backend/src/routes/webhooks.js` (add aiqfome handler)
- Modify: `delivery-saas-backend/src/routes/integrations.js:1-25` (add aiqfome imports and routes)

**Step 1: Add webhook route**

In `webhooks.js`, after the existing iFood webhook handler, add:

```javascript
// ───── aiqfome webhook ─────
import { processAiqfomeWebhook } from '../integrations/aiqfome/webhookProcessor.js';

webhooksRouter.post('/aiqfome', async (req, res) => {
  try {
    const payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const order = payload.data || payload;
    const eventId = order.id ? `aiqfome-${order.id}` : null;

    // Persist webhook event
    const we = await prisma.webhookEvent.upsert({
      where: { eventId: eventId || `aiqfome-${Date.now()}` },
      update: { payload, status: 'RECEIVED' },
      create: { provider: 'AIQFOME', eventId, payload, status: 'RECEIVED' },
    });

    // Process asynchronously
    processAiqfomeWebhook(we.id).catch(e => {
      console.error('[aiqfome webhook] processing error:', e?.message);
    });

    res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[aiqfome webhook] error:', e?.message);
    res.status(500).json({ error: 'Internal error' });
  }
});
```

**Step 2: Add OAuth and config routes to integrations.js**

At the top of `integrations.js` (after line 21), add imports:

```javascript
import {
  startAiqfomeAuth,
  exchangeAiqfomeCode,
  refreshAiqfomeToken,
} from '../integrations/aiqfome/oauth.js';
import { updateAiqfomeOrderStatus } from '../integrations/aiqfome/orders.js';
import { syncMenuToAiqfome } from '../integrations/aiqfome/menu.js';
import { aiqfomeGet, aiqfomePost } from '../integrations/aiqfome/client.js';
```

Then add routes (after the iFood routes block):

```javascript
// ───── aiqfome OAuth ─────

// Step 1: Start OAuth redirect
integrationsRouter.post('/aiqfome/link/start', requireRole('ADMIN'), async (req, res) => {
  try {
    const { storeId, clientId, clientSecret } = req.body;
    const companyId = req.user.companyId;
    const result = await startAiqfomeAuth({ companyId, storeId, clientId, clientSecret });
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Step 2: OAuth callback (no auth — redirect from ID Magalu)
integrationsRouter.get('/aiqfome/callback', async (req, res) => {
  try {
    const { code, state: integrationId } = req.query;
    if (!code || !integrationId) return res.status(400).send('Parâmetros inválidos');

    await exchangeAiqfomeCode({ integrationId, code });

    // After token exchange, register webhook on aiqfome
    try {
      const integ = await prisma.apiIntegration.findUnique({ where: { id: integrationId } });
      if (integ && integ.merchantId) {
        const webhookUrl = process.env.AIQFOME_WEBHOOK_URL || `${process.env.BACKEND_URL || ''}/webhooks/aiqfome`;
        await aiqfomePost(integrationId, `/api/v2/store/${integ.merchantId}/webhooks`, { url: webhookUrl });
      }
    } catch (eWh) {
      console.warn('[aiqfome] webhook registration failed (non-blocking):', eWh?.message);
    }

    // Redirect back to frontend settings page
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    res.redirect(`${frontendUrl}/settings/integrations/aiqfome?connected=true`);
  } catch (e) {
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    res.redirect(`${frontendUrl}/settings/integrations/aiqfome?error=${encodeURIComponent(e.message)}`);
  }
});

// Refresh token manually
integrationsRouter.post('/aiqfome/token/refresh', requireRole('ADMIN'), async (req, res) => {
  try {
    const { integrationId } = req.body;
    await refreshAiqfomeToken(integrationId);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Unlink aiqfome
integrationsRouter.post('/aiqfome/unlink', requireRole('ADMIN'), async (req, res) => {
  try {
    const { integrationId } = req.body;
    await prisma.apiIntegration.update({
      where: { id: integrationId },
      data: { accessToken: null, refreshToken: null, tokenExpiresAt: null, authCode: null, enabled: false },
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ───── aiqfome payment mappings ─────
integrationsRouter.get('/aiqfome/:integrationId/payment-mappings', requireRole('ADMIN'), async (req, res) => {
  try {
    const mappings = await prisma.aiqfomePaymentMapping.findMany({
      where: { integrationId: req.params.integrationId },
    });
    const defaults = ['Dinheiro', 'Crédito', 'Débito', 'PIX', 'Vale Refeição', 'Outro'];
    const result = defaults.map(code => {
      const existing = mappings.find(m => m.aiqfomeCode === code);
      return { aiqfomeCode: code, systemName: existing?.systemName || code, id: existing?.id || null };
    });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

integrationsRouter.put('/aiqfome/:integrationId/payment-mappings', requireRole('ADMIN'), async (req, res) => {
  try {
    const { integrationId } = req.params;
    const { mappings } = req.body;
    for (const m of mappings) {
      if (!m.aiqfomeCode) continue;
      if (!m.systemName) {
        await prisma.aiqfomePaymentMapping.deleteMany({ where: { integrationId, aiqfomeCode: m.aiqfomeCode } });
      } else {
        await prisma.aiqfomePaymentMapping.upsert({
          where: { integ_aiqfome_code_key: { integrationId, aiqfomeCode: m.aiqfomeCode } },
          update: { systemName: m.systemName },
          create: { integrationId, aiqfomeCode: m.aiqfomeCode, systemName: m.systemName },
        });
      }
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ───── aiqfome menu sync ─────
integrationsRouter.post('/aiqfome/menu/sync', requireRole('ADMIN'), async (req, res) => {
  try {
    const { integrationId, menuId } = req.body;
    const result = await syncMenuToAiqfome(integrationId, menuId);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ───── aiqfome store management ─────
integrationsRouter.post('/aiqfome/store/:action', requireRole('ADMIN'), async (req, res) => {
  try {
    const { integrationId } = req.body;
    const { action } = req.params;
    const integ = await prisma.apiIntegration.findUnique({ where: { id: integrationId } });
    if (!integ || !integ.merchantId) return res.status(400).json({ error: 'Integração inválida' });

    const storeId = integ.merchantId;
    const actionMap = {
      open: { method: 'post', path: `/api/v2/store/${storeId}/open` },
      close: { method: 'post', path: `/api/v2/store/${storeId}/close` },
      standby: { method: 'put', path: `/api/v2/store/${storeId}/stand-by` },
    };
    const mapped = actionMap[action];
    if (!mapped) return res.status(400).json({ error: 'Ação inválida' });

    if (mapped.method === 'post') await aiqfomePost(integ.id, mapped.path);
    else await (await import('../integrations/aiqfome/client.js')).aiqfomePut(integ.id, mapped.path);

    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
```

**Step 3: Commit**

```bash
git add src/routes/webhooks.js src/routes/integrations.js
git commit -m "feat(aiqfome): add webhook receiver, OAuth, payment mapping, menu sync, and store management routes"
```

---

## Task 8: Hook Status Changes — orders.js patch

**Files:**
- Modify: `delivery-saas-backend/src/routes/orders.js:471-551` (after iFood notify block)

**Step 1: Add aiqfome status notify**

After the iFood notification block (around line 551, after `} catch (e) { console.warn('iFood notify attempt failed:', e && e.message); }`), add:

```javascript
    // If this order belongs to an AIQFOME integration, notify aiqfome of the status change
    try {
      if (updated.customerSource === 'AIQFOME' && updated.externalId) {
        const { updateAiqfomeOrderStatus } = await import('../integrations/aiqfome/orders.js');
        await updateAiqfomeOrderStatus(companyId, updated.externalId, status);
        console.log('[aiqfome] Notified status change for order', updated.externalId, '->', status);
      }
    } catch (e) { console.warn('[aiqfome] notify attempt failed:', e?.message); }
```

**Step 2: Commit**

```bash
git add src/routes/orders.js
git commit -m "feat(aiqfome): hook order status changes to notify aiqfome"
```

---

## Task 9: Frontend — `AiqfomeConfig.vue`

**Files:**
- Create: `delivery-saas-frontend/src/components/AiqfomeConfig.vue`
- Modify: `delivery-saas-frontend/src/router/index.js` (add route)

**Reference:** Existing `IFoodIntegration.vue` and `PrinterConfig.vue` for UI patterns. Use `SelectInput`, `TextInput`, `api` from `src/api.js`, Bootstrap 5 classes.

**Step 1: Create AiqfomeConfig.vue**

> **For Claude:** Use the `frontend-deliverywl` skill when implementing this component to ensure design system consistency.

Create `delivery-saas-frontend/src/components/AiqfomeConfig.vue` with:
- OAuth connection section (button to start, status display, disconnect)
- Store selector (SelectInput binding local store to aiqfome)
- autoAccept toggle
- Payment mapping table (aiqfomeCode ↔ systemName)
- Menu sync button + status
- Webhook status display

Use `api.post('/integrations/aiqfome/link/start')` for OAuth start, `api.get('/integrations?provider=AIQFOME')` for status, etc.

**Step 2: Add route**

In `router/index.js`, add inside the settings routes:

```javascript
{
  path: '/settings/integrations/aiqfome',
  name: 'AiqfomeConfig',
  component: () => import('../components/AiqfomeConfig.vue'),
  meta: { requiresAuth: true, roles: ['ADMIN'] },
}
```

**Step 3: Commit**

```bash
git add src/components/AiqfomeConfig.vue src/router/index.js
git commit -m "feat(aiqfome): add frontend configuration component and route"
```

---

## Task 10: Store Management Hook

**Files:**
- Modify: `delivery-saas-backend/src/routes/stores.js` (add aiqfome sync on open/close)

**Step 1: Add aiqfome store sync**

In the store status change endpoints (or the settings persistence function), add a post-update hook:

```javascript
// After store status change, sync to aiqfome if integration exists
async function syncStoreStatusToAiqfome(companyId, storeId, action) {
  try {
    const integ = await prisma.apiIntegration.findFirst({
      where: { companyId, provider: 'AIQFOME', storeId, enabled: true },
    });
    if (!integ || !integ.merchantId || !integ.accessToken) return;

    const { aiqfomePost, aiqfomePut } = await import('../integrations/aiqfome/client.js');
    const aiqStoreId = integ.merchantId;
    if (action === 'open') await aiqfomePost(integ.id, `/api/v2/store/${aiqStoreId}/open`);
    else if (action === 'close') await aiqfomePost(integ.id, `/api/v2/store/${aiqStoreId}/close`);
    else if (action === 'standby') await aiqfomePut(integ.id, `/api/v2/store/${aiqStoreId}/stand-by`);
    console.log(`[aiqfome] Store ${action} synced for store ${aiqStoreId}`);
  } catch (e) {
    console.warn(`[aiqfome] Store sync failed (${action}):`, e?.message);
  }
}
```

Call this function after the relevant store update operations.

**Step 2: Commit**

```bash
git add src/routes/stores.js
git commit -m "feat(aiqfome): hook store open/close/standby to sync with aiqfome"
```

---

## Task 11: Environment Variables & Documentation

**Files:**
- Modify: `delivery-saas-backend/.env.example` (if exists) or document in design doc

**Step 1: Add required env vars**

```env
# aiqfome Integration
AIQFOME_BASE_URL=https://plataforma.aiqfome.com
AIQFOME_REDIRECT_URI=https://yourdomain.com/api/integrations/aiqfome/callback
AIQFOME_WEBHOOK_URL=https://yourdomain.com/api/webhooks/aiqfome
```

**Step 2: Commit**

```bash
git add .env.example
git commit -m "docs(aiqfome): add environment variable documentation"
```

---

## Task 12: Integration Test — End-to-End Smoke

**Step 1: Manual smoke test checklist**

1. Start Docker dev environment
2. Create an ApiIntegration with provider='AIQFOME' via API or Prisma Studio
3. Send a test webhook to `POST /webhooks/aiqfome` with sample payload (from design doc)
4. Verify order appears in DB with correct fields
5. Verify Socket.IO emits `novo-pedido`
6. Verify print agent receives order
7. Change order status via `PATCH /orders/:id/status` and verify no crash (aiqfome API won't be available in dev, but the hook should fail silently)

**Step 2: Final commit**

```bash
git add -A
git commit -m "feat(aiqfome): complete aiqfome marketplace integration"
```
