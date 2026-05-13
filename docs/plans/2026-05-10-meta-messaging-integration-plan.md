# Meta Messaging Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Adicionar 3 novos transports de mensageria ao inbox (WhatsApp Meta Cloud, Facebook Messenger, Instagram Direct) operando em paralelo ao WhatsApp Evolution existente, com pipeline único de automações e UI unificada.

**Architecture:** Adapter pattern. 1 arquivo por transport em `src/messaging/adapters/`, interface comum (`parseInbound`, `sendMessage`, `verifyWebhook`). Router despacha por `(channel, provider)`. Pipeline único persiste mensagens e roda automações channel-agnostic. Tabela polimórfica `MetaMessagingAccount` cobre WA/FB/IG da Meta. Credenciais do Meta App no painel SUPER_ADMIN (não env vars).

**Tech Stack:** Express, Prisma, PostgreSQL, Socket.IO (backend); Vue 3, Pinia, Bootstrap 5 (frontend); Facebook Graph API v21.0; `node:test` + `node:assert/strict` para testes; Docker para dev.

**Design doc:** `docs/plans/2026-05-10-meta-messaging-integration-design.md`

---

## Pré-requisitos antes de iniciar

1. **Checar branch:** garantir que está em branch dedicado (não detached HEAD). Sugestão: `git checkout -b feat/meta-messaging-integration`
2. **Ler design doc** completo: `docs/plans/2026-05-10-meta-messaging-integration-design.md`
3. **Ler arquivos-chave** para entender baseline:
   - `delivery-saas-backend/prisma/schema.prisma` (modelos Conversation, Message, Menu, Customer, Settings, WhatsAppInstance, QuickReply, GreetingTimeRule)
   - `delivery-saas-backend/src/routes/webhookEvolution.js` (lógica de inbound atual)
   - `delivery-saas-backend/src/routes/inbox.js` (envio + listagem)
   - `delivery-saas-backend/src/services/notify.js` (Socket.IO emitters)
   - `delivery-saas-frontend/src/views/inbox/Inbox.vue` e componentes filhos
   - `delivery-saas-frontend/src/stores/inbox.js`
4. **Dev environment:** Docker Compose (`docker compose up -d`) — DB na porta 5433, backend 3000, frontend 5173.
5. **Test runner:** `node --test tests/<arquivo>.test.mjs` no diretório `delivery-saas-backend`.

---

## Convenções deste plano

- **Cada task = unidade atômica de commit.** Após cada task, rodar testes relevantes e commitar.
- **TDD onde aplicável:** funções puras (parsers, validators, helpers) sempre vêm com teste antes da implementação. Para integrações HTTP/DB/UI: smoke manual + verificação no DB.
- **Comandos:** assumir cwd em `d:/Users/gomes/Documents/GitHub/projetoDelivery` salvo indicação.
- **Após cada commit:** mark task como done.

---

# FASE 1 — Schema foundation

## Task 1: Adicionar `MessagingProvider` enum e tabela `MetaMessagingAccount`

**Files:**
- Modify: `delivery-saas-backend/prisma/schema.prisma`

**Step 1: Editar schema**

Adicionar ao final do arquivo (perto de outros enums):

```prisma
enum MessagingProvider {
  EVOLUTION_WA
  META_WA
  META_FB
  META_IG
}
```

Adicionar novo model (perto de WhatsAppInstance):

```prisma
model MetaMessagingAccount {
  id                  String   @id @default(uuid())
  companyId           String
  kind                MessagingProvider
  externalId          String
  displayName         String?
  accessToken         String   @db.Text
  refreshToken        String?  @db.Text
  tokenExpiresAt      DateTime?
  wabaId              String?
  fbPageId            String?
  webhookVerifyToken  String   @unique
  status              String   @default("ACTIVE")
  lastError           String?  @db.Text
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  company             Company  @relation(fields: [companyId], references: [id])
  menusAsMetaWa       Menu[]   @relation("MenuMetaWa")
  menusAsFb           Menu[]   @relation("MenuFb")
  menusAsIg           Menu[]   @relation("MenuIg")

  @@unique([companyId, kind, externalId])
  @@index([companyId])
}
```

Adicionar back-relation em `model Company`:
```prisma
metaMessagingAccounts MetaMessagingAccount[]
```

**Step 2: Aplicar no DB dev**

```bash
docker compose exec backend npx prisma db push --skip-generate
docker compose exec backend npx prisma generate
```

Expected: "Database is now in sync" sem erros.

**Step 3: Commit**

```bash
git add delivery-saas-backend/prisma/schema.prisma
git commit -m "feat(messaging): add MessagingProvider enum and MetaMessagingAccount model"
```

---

## Task 2: Adicionar `provider` + `providerAccountId` em `Conversation`

**Files:**
- Modify: `delivery-saas-backend/prisma/schema.prisma`

**Step 1: Editar `model Conversation`**

Adicionar campos (manter nullable inicialmente para não quebrar dados existentes; backfill em Task 11):

```prisma
provider            MessagingProvider?
providerAccountId   String?

@@index([companyId, channel, provider])
```

**Step 2: Aplicar**

```bash
docker compose exec backend npx prisma db push --skip-generate
docker compose exec backend npx prisma generate
```

**Step 3: Commit**

```bash
git add delivery-saas-backend/prisma/schema.prisma
git commit -m "feat(messaging): add provider + providerAccountId to Conversation"
```

---

## Task 3: Adicionar FKs de Meta accounts em `Menu`

**Files:**
- Modify: `delivery-saas-backend/prisma/schema.prisma`

**Step 1: Editar `model Menu`**

Adicionar perto de `whatsappInstanceId`:

```prisma
metaWaAccountId       String?
facebookAccountId     String?
instagramAccountId    String?

metaWaAccount         MetaMessagingAccount? @relation("MenuMetaWa", fields: [metaWaAccountId], references: [id])
facebookAccount       MetaMessagingAccount? @relation("MenuFb", fields: [facebookAccountId], references: [id])
instagramAccount      MetaMessagingAccount? @relation("MenuIg", fields: [instagramAccountId], references: [id])
```

**Step 2: Aplicar + commit**

```bash
docker compose exec backend npx prisma db push --skip-generate
docker compose exec backend npx prisma generate
git add delivery-saas-backend/prisma/schema.prisma
git commit -m "feat(messaging): link Menu to Meta WA/FB/IG accounts"
```

---

## Task 4: Adicionar `metaIdentities` em `Customer` e `metaTemplateId` em `QuickReply`

**Files:**
- Modify: `delivery-saas-backend/prisma/schema.prisma`

**Step 1: Editar models**

```prisma
model Customer {
  // ... existing
  metaIdentities  Json?
}

model QuickReply {
  // ... existing
  metaTemplateId  String?
}
```

**Step 2: Aplicar + commit**

```bash
docker compose exec backend npx prisma db push --skip-generate
docker compose exec backend npx prisma generate
git add delivery-saas-backend/prisma/schema.prisma
git commit -m "feat(messaging): add metaIdentities to Customer + metaTemplateId to QuickReply"
```

---

# FASE 2 — Adapter base & crypto

## Task 5: Helper de criptografia para tokens

**Files:**
- Create: `delivery-saas-backend/src/messaging/crypto.js`
- Create: `delivery-saas-backend/tests/messaging.crypto.test.mjs`

**Step 1: Escrever teste**

```js
// tests/messaging.crypto.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encrypt, decrypt } from '../src/messaging/crypto.js';

const KEY = 'a'.repeat(64); // 32 bytes hex
process.env.CERT_STORE_KEY = KEY;

test('encrypts and decrypts roundtrip', () => {
  const plain = 'EAAB...secrettoken...XYZ';
  const enc = encrypt(plain);
  assert.notEqual(enc, plain);
  assert.equal(decrypt(enc), plain);
});

test('encrypts produce different ciphertext each call (IV)', () => {
  const a = encrypt('same');
  const b = encrypt('same');
  assert.notEqual(a, b);
  assert.equal(decrypt(a), 'same');
  assert.equal(decrypt(b), 'same');
});

test('decrypt throws on tampered ciphertext', () => {
  const enc = encrypt('hello');
  const tampered = enc.slice(0, -2) + 'XX';
  assert.throws(() => decrypt(tampered));
});
```

**Step 2: Rodar para confirmar falha**

```bash
cd delivery-saas-backend && node --test tests/messaging.crypto.test.mjs
```
Expected: FAIL (módulo não existe).

**Step 3: Implementar**

```js
// src/messaging/crypto.js
import crypto from 'node:crypto';

const ALGO = 'aes-256-gcm';

function getKey() {
  const hex = process.env.CERT_STORE_KEY;
  if (!hex || hex.length !== 64) throw new Error('CERT_STORE_KEY must be 64 hex chars');
  return Buffer.from(hex, 'hex');
}

export function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join('.');
}

export function decrypt(payload) {
  const [ivB64, tagB64, encB64] = payload.split('.');
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const enc = Buffer.from(encB64, 'base64');
  const decipher = crypto.createDecipheriv(ALGO, getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}
```

**Step 4: Rodar testes**

```bash
node --test tests/messaging.crypto.test.mjs
```
Expected: 3 passing.

**Step 5: Commit**

```bash
git add delivery-saas-backend/src/messaging/crypto.js delivery-saas-backend/tests/messaging.crypto.test.mjs
git commit -m "feat(messaging): add AES-256-GCM crypto helper for tokens"
```

---

## Task 6: Definir contratos do adapter base

**Files:**
- Create: `delivery-saas-backend/src/messaging/adapters/base.adapter.js`

**Step 1: Implementar**

```js
// src/messaging/adapters/base.adapter.js
// Contrato comum. Não é classe; cada adapter exporta um objeto com este shape.

export const ADAPTER_INTERFACE = {
  provider: null,            // 'EVOLUTION_WA' | 'META_WA' | 'META_FB' | 'META_IG'
  channel: null,             // 'WHATSAPP' | 'FACEBOOK' | 'INSTAGRAM'

  async verifyWebhook(req, res) { throw new Error('not implemented'); },
  async parseInbound(payload, account) { throw new Error('not implemented'); },
  async sendMessage(account, to, content) { throw new Error('not implemented'); },
  async sendMedia(account, to, mediaUrl, type, caption) { throw new Error('not implemented'); },
  async resolveAccount(externalId, prisma) { throw new Error('not implemented'); },
  async downloadMedia(mediaId, account) { throw new Error('not implemented'); },
};

// Erros tipados que adapters podem lançar
export class MetaWindowExpiredError extends Error {
  constructor(channel) {
    super(`Meta 24h messaging window expired for ${channel}`);
    this.code = 'META_WINDOW_EXPIRED';
  }
}

export class MetaNotConfiguredError extends Error {
  constructor() {
    super('Meta App not configured in admin settings');
    this.code = 'META_NOT_CONFIGURED';
  }
}

export class MessagingError extends Error {
  constructor(message, code = 'MESSAGING_ERROR') {
    super(message);
    this.code = code;
  }
}

// Helper: shape canônico de mensagem normalizada
export function normalizedMessage({
  externalId, channel, provider, companyId, channelContactId,
  contactName = null, contactProfilePic = null,
  type, body = null, mediaUrl = null, mimeType = null,
  timestamp, raw,
}) {
  return {
    externalId, channel, provider, companyId, channelContactId,
    contactName, contactProfilePic,
    type, body, mediaUrl, mimeType,
    timestamp: timestamp instanceof Date ? timestamp : new Date(timestamp),
    raw,
  };
}
```

**Step 2: Commit**

```bash
git add delivery-saas-backend/src/messaging/adapters/base.adapter.js
git commit -m "feat(messaging): define adapter interface and typed errors"
```

---

## Task 7: Implementar `inboundPipeline.js`

**Files:**
- Create: `delivery-saas-backend/src/messaging/inboundPipeline.js`

**Step 1: Implementar**

Esta task é grande porque centraliza a lógica de persistência+automação. Use como referência `delivery-saas-backend/src/routes/webhookEvolution.js` linhas ~420-598 (`processSingleMessage`) e ~261-346 (`runAutomations`).

```js
// src/messaging/inboundPipeline.js
import { prisma } from '../prisma.js';
import { emitirInboxNewMessage } from '../socketEmitters.js';
import { runAutomations } from './automations.js';

/**
 * Processa uma NormalizedMessage: dedup, upsert Customer, upsert Conversation,
 * persiste Message, roda automações, emite Socket.
 */
export async function process(msg) {
  // 1. Dedup por externalId + companyId
  const existing = await prisma.message.findFirst({
    where: { externalId: msg.externalId, conversation: { companyId: msg.companyId } },
    select: { id: true },
  });
  if (existing) return { skipped: true, reason: 'duplicate' };

  // 2. Buscar/criar Customer
  const customer = await resolveCustomer(msg);

  // 3. Buscar/criar Conversation
  const conversation = await resolveConversation(msg, customer);

  // 4. Persistir Message
  const message = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      direction: 'INBOUND',
      type: msg.type,
      body: msg.body,
      mediaUrl: msg.mediaUrl,
      mimeType: msg.mimeType,
      externalId: msg.externalId,
      status: 'DELIVERED',
      createdAt: msg.timestamp,
    },
  });

  // 5. Atualizar Conversation (lastMessageAt, unreadCount)
  await prisma.conversation.update({
    where: { id: conversation.id },
    data: {
      lastMessageAt: msg.timestamp,
      unreadCount: { increment: 1 },
    },
  });

  // 6. Rodar automações
  await runAutomations({ conversation, message, customer, normalizedMessage: msg });

  // 7. Emit Socket.IO
  await emitirInboxNewMessage({
    companyId: msg.companyId,
    conversation: { ...conversation, lastMessageAt: msg.timestamp },
    message,
  });

  return { skipped: false, messageId: message.id };
}

async function resolveCustomer(msg) {
  if (msg.channel === 'WHATSAPP') {
    // Lógica atual: matching por phone normalized
    return await resolveCustomerByPhone(msg);
  }
  // FB/IG: matching por metaIdentities
  return await resolveCustomerByMetaIdentity(msg);
}

async function resolveCustomerByPhone(msg) {
  const phone = msg.channelContactId;
  // (replicar lógica de variants do webhookEvolution.js L485-491)
  const variants = phoneVariants(phone);
  let customer = await prisma.customer.findFirst({
    where: { companyId: msg.companyId, whatsapp: { in: variants } },
  });
  if (!customer) {
    customer = await prisma.customer.create({
      data: {
        companyId: msg.companyId,
        whatsapp: phone,
        fullName: msg.contactName || phone,
      },
    });
  }
  return customer;
}

async function resolveCustomerByMetaIdentity(msg) {
  // Procurar Customer com metaIdentities contendo este externalId + provider
  const identity = { provider: msg.provider, externalId: msg.channelContactId };
  // Prisma não suporta filtro JSON contains array facilmente em todos drivers;
  // usar raw query ou buscar todos da company e filtrar em memória se baixa cardinalidade.
  const candidates = await prisma.customer.findMany({
    where: { companyId: msg.companyId, metaIdentities: { not: null } },
    select: { id: true, metaIdentities: true },
  });
  const found = candidates.find(c => {
    const ids = c.metaIdentities;
    if (!Array.isArray(ids)) return false;
    return ids.some(i => i.provider === identity.provider && i.externalId === identity.externalId);
  });
  if (found) return prisma.customer.findUnique({ where: { id: found.id } });

  return prisma.customer.create({
    data: {
      companyId: msg.companyId,
      fullName: msg.contactName || 'Cliente Meta',
      metaIdentities: [identity],
    },
  });
}

async function resolveConversation(msg, customer) {
  let conversation = await prisma.conversation.findFirst({
    where: {
      companyId: msg.companyId,
      channel: msg.channel,
      channelContactId: msg.channelContactId,
    },
  });
  if (conversation) {
    // Garantir provider se ainda não setado
    if (!conversation.provider) {
      conversation = await prisma.conversation.update({
        where: { id: conversation.id },
        data: { provider: msg.provider },
      });
    }
    return conversation;
  }
  // Resolver menuId via account (Meta) ou instance (Evolution) — fora desta função; default null
  return prisma.conversation.create({
    data: {
      companyId: msg.companyId,
      channel: msg.channel,
      provider: msg.provider,
      channelContactId: msg.channelContactId,
      customerId: customer?.id,
      status: 'OPEN',
      unreadCount: 0,
    },
  });
}

function phoneVariants(phone) {
  // Stub — em Task 9 movemos de webhookEvolution.js a este arquivo helper
  return [phone];
}
```

**Step 2: Notar dependência** — `automations.js` ainda não existe; será extraído em Task 8. `phoneVariants` também. Por ora, esses imports vão quebrar — OK, vamos consertar nas próximas tasks.

**Step 3: Commit**

```bash
git add delivery-saas-backend/src/messaging/inboundPipeline.js
git commit -m "feat(messaging): inbound pipeline skeleton (deps stubbed)"
```

---

## Task 8: Extrair `automations.js` de `webhookEvolution.js`

**Files:**
- Create: `delivery-saas-backend/src/messaging/automations.js`
- Modify: `delivery-saas-backend/src/routes/webhookEvolution.js`

**Step 1: Identificar lógica a mover**

Mover de `webhookEvolution.js`:
- Função `runAutomations()` (L261-346)
- Helpers: `findGreetingReply()`, `findOutOfHoursReply()`, `findRegisteredGreetingReply()`, `applyKeywordTags()` (se existirem)
- Lógica de "remind last order" (L95-227)

**Step 2: Criar arquivo novo**

```js
// src/messaging/automations.js
import { prisma } from '../prisma.js';

/**
 * Executa automações configuradas no Menu para a conversa.
 * Channel-agnostic: skipa remindLastOrder se canal ≠ WHATSAPP.
 */
export async function runAutomations({ conversation, message, customer, normalizedMessage }) {
  // Resolver Menu — via conversation.menuId ou via account/instance
  const menuId = conversation.menuId || await resolveMenuFromAccount(conversation);
  if (!menuId) return;
  const menu = await prisma.menu.findUnique({
    where: { id: menuId },
    include: { greetingTimeRules: { include: { quickReply: true } } },
  });
  if (!menu) return;

  // 1. Greeting por horário + cliente cadastrado
  await maybeSendGreeting({ conversation, message, customer, menu });

  // 2. Out-of-hours
  await maybeSendOutOfHours({ conversation, message, menu });

  // 3. Keyword tagging
  await applyKeywordTags({ conversation, message });

  // 4. Remind last order (WhatsApp only)
  if (conversation.channel === 'WHATSAPP') {
    await maybeRemindLastOrder({ conversation, message, customer, menu });
  }
}

// Implementações: copiar/adaptar de webhookEvolution.js
async function maybeSendGreeting({ conversation, message, customer, menu }) {
  // TODO: portar lógica de webhookEvolution.js
  // - Verificar se é primeira mensagem ou >6h sem msg
  // - Escolher greetingTimeRule por horário atual
  // - Se customer tem >=1 pedido CONCLUIDO → registeredGreetingReply
  // - Enviar via messaging/router.js sendOutbound()
}

async function maybeSendOutOfHours({ conversation, message, menu }) {
  // TODO: portar
}

async function applyKeywordTags({ conversation, message }) {
  // TODO: portar
}

async function maybeRemindLastOrder({ conversation, message, customer, menu }) {
  // TODO: portar
}

async function resolveMenuFromAccount(conversation) {
  // Buscar Menu cujo {whatsappInstanceId | metaWaAccountId | facebookAccountId | instagramAccountId}
  // == conversation.providerAccountId, depending on provider
  // TODO
  return null;
}
```

**Step 3: Plano de portagem incremental**

Para evitar refator gigante: nesta task, copie literalmente as funções de `webhookEvolution.js` para `automations.js`, ajustando imports. **Não remova de `webhookEvolution.js` ainda** — fará em Task 10.

**Step 4: Smoke test manual**

```bash
docker compose exec backend node -e "import('./src/messaging/automations.js').then(m => console.log(Object.keys(m)))"
```
Expected: `[ 'runAutomations' ]`

**Step 5: Commit**

```bash
git add delivery-saas-backend/src/messaging/automations.js
git commit -m "feat(messaging): extract runAutomations to messaging/automations.js"
```

---

## Task 9: Helper de phone variants

**Files:**
- Create: `delivery-saas-backend/src/messaging/phoneVariants.js`
- Create: `delivery-saas-backend/tests/messaging.phoneVariants.test.mjs`
- Modify: `delivery-saas-backend/src/messaging/inboundPipeline.js` (importar)

**Step 1: Teste**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { phoneVariants, normalizePhone } from '../src/messaging/phoneVariants.js';

test('phoneVariants: gera variantes com e sem 9', () => {
  const v = phoneVariants('5571999990000');
  assert.ok(v.includes('5571999990000'));
  assert.ok(v.includes('557199990000'));
});

test('normalizePhone: adiciona 55 se não tiver', () => {
  assert.equal(normalizePhone('71999990000'), '5571999990000');
});

test('normalizePhone: idempotente se já normalizado', () => {
  assert.equal(normalizePhone('5571999990000'), '5571999990000');
});
```

**Step 2: Implementar**

```js
// src/messaging/phoneVariants.js
export function normalizePhone(raw) {
  const digits = String(raw).replace(/\D/g, '');
  if (digits.startsWith('55')) return digits;
  return '55' + digits;
}

export function phoneVariants(phone) {
  const n = normalizePhone(phone);
  const out = new Set([n]);
  // BA/SP/etc: variantes com/sem 9
  // 55 + DDD(2) + numero
  if (n.length === 13) {
    // tem 9: tirar
    out.add(n.slice(0, 4) + n.slice(5));
  } else if (n.length === 12) {
    // não tem 9: adicionar
    out.add(n.slice(0, 4) + '9' + n.slice(4));
  }
  return Array.from(out);
}
```

**Step 3: Rodar testes**

```bash
cd delivery-saas-backend && node --test tests/messaging.phoneVariants.test.mjs
```

**Step 4: Atualizar import em inboundPipeline.js**

```js
import { phoneVariants } from './phoneVariants.js';
```

Remover stub interno.

**Step 5: Commit**

```bash
git add delivery-saas-backend/src/messaging/phoneVariants.js \
  delivery-saas-backend/tests/messaging.phoneVariants.test.mjs \
  delivery-saas-backend/src/messaging/inboundPipeline.js
git commit -m "feat(messaging): phone variants helper with tests"
```

---

# FASE 3 — Router e refactor Evolution

## Task 10: Implementar `router.js`

**Files:**
- Create: `delivery-saas-backend/src/messaging/router.js`

**Step 1: Implementar**

```js
// src/messaging/router.js
import { prisma } from '../prisma.js';
import * as inboundPipeline from './inboundPipeline.js';
import { MessagingError } from './adapters/base.adapter.js';

// Map provider → adapter module (lazy to avoid circular imports)
const adapterRegistry = new Map();

export function registerAdapter(provider, adapter) {
  adapterRegistry.set(provider, adapter);
}

export function getAdapter(provider) {
  const a = adapterRegistry.get(provider);
  if (!a) throw new MessagingError(`No adapter registered for ${provider}`, 'NO_ADAPTER');
  return a;
}

/**
 * Webhook → adapter.parseInbound → pipeline.process
 */
export async function routeInbound(provider, payload, account) {
  const adapter = getAdapter(provider);
  const messages = await adapter.parseInbound(payload, account);
  const results = [];
  for (const msg of messages) {
    try {
      const r = await inboundPipeline.process(msg);
      results.push({ ok: true, ...r });
    } catch (err) {
      console.error('[router.routeInbound] pipeline error', err);
      results.push({ ok: false, error: err.message });
    }
  }
  return results;
}

/**
 * Operador envia → resolve account → adapter.sendMessage → persist OUTBOUND
 */
export async function sendOutbound({ conversationId, content, userId }) {
  const conv = await prisma.conversation.findUnique({ where: { id: conversationId } });
  if (!conv) throw new MessagingError('Conversation not found', 'NOT_FOUND');
  if (!conv.provider) throw new MessagingError('Conversation has no provider set', 'NO_PROVIDER');

  const adapter = getAdapter(conv.provider);
  const account = await resolveAccount(conv);

  const result = await adapter.sendMessage(account, conv.channelContactId, content);

  const message = await prisma.message.create({
    data: {
      conversationId: conv.id,
      direction: 'OUTBOUND',
      type: content.type,
      body: content.text || null,
      mediaUrl: content.mediaUrl || null,
      mimeType: content.mimeType || null,
      externalId: result.externalId || null,
      status: result.status || 'SENT',
      authorUserId: userId || null,
    },
  });

  await prisma.conversation.update({
    where: { id: conv.id },
    data: { lastMessageAt: new Date() },
  });

  return message;
}

async function resolveAccount(conv) {
  if (conv.provider === 'EVOLUTION_WA') {
    return prisma.whatsAppInstance.findUnique({ where: { id: conv.providerAccountId } });
  }
  return prisma.metaMessagingAccount.findUnique({ where: { id: conv.providerAccountId } });
}
```

**Step 2: Commit**

```bash
git add delivery-saas-backend/src/messaging/router.js
git commit -m "feat(messaging): add router for inbound dispatch and outbound send"
```

---

## Task 11: Adapter `whatsappEvolution.adapter.js`

**Files:**
- Create: `delivery-saas-backend/src/messaging/adapters/whatsappEvolution.adapter.js`
- Create: `delivery-saas-backend/tests/messaging.adapters.whatsappEvolution.test.mjs`

**Step 1: Capturar 2-3 payloads reais de webhook**

Antes de codar: pegar logs reais de `webhookEvolution.js` em prod (ou simular pelo formato Evolution API conhecido) e salvar em:
- `tests/fixtures/evolution.text.json`
- `tests/fixtures/evolution.image.json`
- `tests/fixtures/evolution.audio.json`

**Step 2: Teste**

```js
// tests/messaging.adapters.whatsappEvolution.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import adapter from '../src/messaging/adapters/whatsappEvolution.adapter.js';

const loadFixture = (name) => JSON.parse(readFileSync(`./tests/fixtures/evolution.${name}.json`, 'utf8'));

const account = { id: 'inst-1', companyId: 'comp-1', instanceName: 'test' };

test('parseInbound TEXT', async () => {
  const payload = loadFixture('text');
  const msgs = await adapter.parseInbound(payload, account);
  assert.equal(msgs.length, 1);
  const m = msgs[0];
  assert.equal(m.channel, 'WHATSAPP');
  assert.equal(m.provider, 'EVOLUTION_WA');
  assert.equal(m.type, 'TEXT');
  assert.equal(m.companyId, 'comp-1');
  assert.ok(m.externalId);
  assert.ok(m.channelContactId);
});

test('parseInbound IMAGE includes mediaUrl + mimeType', async () => {
  const payload = loadFixture('image');
  const msgs = await adapter.parseInbound(payload, account);
  assert.equal(msgs[0].type, 'IMAGE');
  assert.ok(msgs[0].mediaUrl);
  assert.ok(msgs[0].mimeType);
});

test('parseInbound deduplicates by externalId in same payload', async () => {
  const payload = loadFixture('text');
  const msgs = await adapter.parseInbound(payload, account);
  const ids = msgs.map(m => m.externalId);
  assert.equal(new Set(ids).size, ids.length);
});
```

**Step 3: Implementar adapter**

```js
// src/messaging/adapters/whatsappEvolution.adapter.js
import { normalizedMessage } from './base.adapter.js';
import { normalizePhone } from '../phoneVariants.js';
import { prisma } from '../../prisma.js';
import axios from 'axios';

const adapter = {
  provider: 'EVOLUTION_WA',
  channel: 'WHATSAPP',

  async verifyWebhook(req, res) {
    // Evolution não exige handshake; responde 200
    res.sendStatus(200);
  },

  async parseInbound(payload, account) {
    // Adaptar de webhookEvolution.js handleMessagesUpsert
    const events = payload?.data?.messages || [payload?.data];
    return events.filter(Boolean).map(ev => {
      const remoteJid = ev.key?.remoteJid || '';
      const phone = normalizePhone(remoteJid.replace(/@s\.whatsapp\.net$/, ''));
      const type = mapType(ev.message);
      return normalizedMessage({
        externalId: ev.key?.id,
        channel: 'WHATSAPP',
        provider: 'EVOLUTION_WA',
        companyId: account.companyId,
        channelContactId: phone,
        contactName: ev.pushName || null,
        type,
        body: ev.message?.conversation || ev.message?.extendedTextMessage?.text || null,
        mediaUrl: extractMediaUrl(ev.message),
        mimeType: extractMimeType(ev.message),
        timestamp: new Date((ev.messageTimestamp || Date.now()/1000) * 1000),
        raw: ev,
      });
    });
  },

  async sendMessage(account, to, content) {
    // Adaptar de inbox.js (POST /conversations/:id/send → Evolution API)
    const url = `${process.env.EVOLUTION_API_URL}/message/sendText/${account.instanceName}`;
    const body = { number: to, text: content.text };
    const res = await axios.post(url, body, { headers: { apikey: process.env.EVOLUTION_API_KEY } });
    return { externalId: res.data?.key?.id, status: 'SENT' };
  },

  async sendMedia(account, to, mediaUrl, type, caption) {
    // TODO: portar lógica existente
  },

  async resolveAccount(externalId /* instance name */) {
    return prisma.whatsAppInstance.findFirst({ where: { instanceName: externalId } });
  },

  async downloadMedia(/* mediaId, account */) {
    // Evolution já entrega URL; sem download separado
    return null;
  },
};

function mapType(message) {
  if (message?.conversation || message?.extendedTextMessage) return 'TEXT';
  if (message?.imageMessage) return 'IMAGE';
  if (message?.audioMessage) return 'AUDIO';
  if (message?.videoMessage) return 'VIDEO';
  if (message?.documentMessage) return 'DOCUMENT';
  if (message?.stickerMessage) return 'STICKER';
  if (message?.locationMessage) return 'LOCATION';
  return 'TEXT';
}

function extractMediaUrl(message) {
  return message?.imageMessage?.url
      || message?.audioMessage?.url
      || message?.videoMessage?.url
      || message?.documentMessage?.url
      || null;
}

function extractMimeType(message) {
  return message?.imageMessage?.mimetype
      || message?.audioMessage?.mimetype
      || message?.videoMessage?.mimetype
      || message?.documentMessage?.mimetype
      || null;
}

export default adapter;
```

**Step 4: Rodar testes**

```bash
cd delivery-saas-backend && node --test tests/messaging.adapters.whatsappEvolution.test.mjs
```

**Step 5: Registrar adapter no router** — criar `src/messaging/index.js`:

```js
// src/messaging/index.js
import { registerAdapter } from './router.js';
import whatsappEvolution from './adapters/whatsappEvolution.adapter.js';

registerAdapter(whatsappEvolution.provider, whatsappEvolution);

export * from './router.js';
```

Importar em `src/server.js`:
```js
import './messaging/index.js';
```

**Step 6: Commit**

```bash
git add delivery-saas-backend/src/messaging/adapters/whatsappEvolution.adapter.js \
  delivery-saas-backend/src/messaging/index.js \
  delivery-saas-backend/src/server.js \
  delivery-saas-backend/tests/messaging.adapters.whatsappEvolution.test.mjs \
  delivery-saas-backend/tests/fixtures/evolution.*.json
git commit -m "feat(messaging): WhatsApp Evolution adapter with fixture-based tests"
```

---

## Task 12: Refatorar `webhookEvolution.js` para usar router

**Files:**
- Modify: `delivery-saas-backend/src/routes/webhookEvolution.js`

**Step 1: Backup do arquivo atual**

```bash
cp delivery-saas-backend/src/routes/webhookEvolution.js delivery-saas-backend/src/routes/webhookEvolution.js.bak
```
Manter `.bak` localmente até smoke test passar — não commitar.

**Step 2: Reescrever rota como thin handler**

```js
// src/routes/webhookEvolution.js
import express from 'express';
import { routeInbound } from '../messaging/router.js';
import whatsappEvolution from '../messaging/adapters/whatsappEvolution.adapter.js';

const router = express.Router();

router.post('/webhook/evolution', async (req, res) => {
  try {
    const instanceName = req.body?.instance;
    const account = await whatsappEvolution.resolveAccount(instanceName);
    if (!account) {
      console.warn('[webhook/evolution] instance não reconhecida:', instanceName);
      return res.sendStatus(200);
    }
    await routeInbound('EVOLUTION_WA', req.body, account);
    res.sendStatus(200);
  } catch (err) {
    console.error('[webhook/evolution] erro:', err);
    res.sendStatus(500);
  }
});

export default router;
```

**Step 3: Smoke manual**

```bash
docker compose restart backend
# Enviar mensagem real no WhatsApp conectado via Evolution
# Verificar logs do container: deve aparecer log do pipeline
docker compose logs -f backend | grep -i 'inbox\|messaging'
# Abrir frontend inbox, verificar que mensagem chegou e automações dispararam
```

**Step 4: Commit + deletar backup**

```bash
git add delivery-saas-backend/src/routes/webhookEvolution.js
git commit -m "refactor(messaging): webhookEvolution thin handler delegating to router"
rm delivery-saas-backend/src/routes/webhookEvolution.js.bak
```

⚠ **Gate de regressão:** se smoke quebrar, reverter este commit e investigar via diff com `.bak`.

---

## Task 13: Backfill script para Conversations existentes

**Files:**
- Create: `delivery-saas-backend/scripts/backfill-conversation-provider.js`

**Step 1: Implementar**

```js
// scripts/backfill-conversation-provider.js
import { prisma } from '../src/prisma.js';

async function main() {
  const orphans = await prisma.conversation.findMany({
    where: { provider: null },
    include: { menu: { select: { whatsappInstanceId: true } } },
  });

  console.log(`Found ${orphans.length} conversations without provider`);
  let updated = 0;

  for (const conv of orphans) {
    if (conv.channel !== 'WHATSAPP') {
      console.warn(`Skipping non-WA conversation ${conv.id} (channel=${conv.channel})`);
      continue;
    }
    const instanceId = conv.menu?.whatsappInstanceId;
    if (!instanceId) {
      console.warn(`Conversation ${conv.id} has no menu/instance — leaving null`);
      continue;
    }
    await prisma.conversation.update({
      where: { id: conv.id },
      data: { provider: 'EVOLUTION_WA', providerAccountId: instanceId },
    });
    updated++;
  }

  console.log(`Updated ${updated} conversations`);
  await prisma.$disconnect();
}

main().catch(err => { console.error(err); process.exit(1); });
```

**Step 2: Rodar em dev**

```bash
docker compose exec backend node scripts/backfill-conversation-provider.js
```

**Step 3: Verificar**

```bash
docker compose exec backend node -e "
import('./src/prisma.js').then(async ({prisma}) => {
  const c = await prisma.conversation.count({ where: { channel: 'WHATSAPP', provider: null } });
  console.log('WA conversations sem provider:', c);
})
"
```
Expected: 0 (ou só órfãs sem menu).

**Step 4: Commit**

```bash
git add delivery-saas-backend/scripts/backfill-conversation-provider.js
git commit -m "feat(messaging): backfill script for existing Conversation.provider"
```

---

# FASE 4 — Meta config (SUPER_ADMIN)

## Task 14: Helper `metaConfig.js`

**Files:**
- Create: `delivery-saas-backend/src/services/metaConfig.js`
- Create: `delivery-saas-backend/tests/metaConfig.test.mjs`

**Step 1: Teste**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
// Skip: requires DB. Test the validation helpers if any pure ones exist.
test('mascaraSecret retorna últimos 4', async () => {
  const { mascaraSecret } = await import('../src/services/metaConfig.js');
  assert.equal(mascaraSecret('abcdefghij'), '***ghij');
  assert.equal(mascaraSecret('abc'), '***abc');
  assert.equal(mascaraSecret(''), '');
  assert.equal(mascaraSecret(null), '');
});
```

**Step 2: Implementar**

```js
// src/services/metaConfig.js
import { prisma } from '../prisma.js';
import { encrypt, decrypt } from '../messaging/crypto.js';
import crypto from 'node:crypto';
import { MetaNotConfiguredError } from '../messaging/adapters/base.adapter.js';

const KEYS = {
  APP_ID: 'META_APP_ID',
  APP_SECRET: 'META_APP_SECRET',
  GRAPH_VERSION: 'META_GRAPH_VERSION',
  WEBHOOK_BASE_URL: 'META_WEBHOOK_BASE_URL',
  WEBHOOK_VERIFY_TOKEN: 'META_WEBHOOK_VERIFY_TOKEN',
  APP_REVIEW_STATUS: 'META_APP_REVIEW_STATUS',
};

export function mascaraSecret(s) {
  if (!s) return '';
  if (s.length <= 4) return '***' + s;
  return '***' + s.slice(-4);
}

export async function getMetaConfig() {
  const rows = await prisma.settings.findMany({
    where: { key: { in: Object.values(KEYS) } },
  });
  const map = Object.fromEntries(rows.map(r => [r.key, r.value]));
  if (!map[KEYS.APP_ID] || !map[KEYS.APP_SECRET]) {
    throw new MetaNotConfiguredError();
  }
  return {
    appId: map[KEYS.APP_ID],
    appSecret: decrypt(map[KEYS.APP_SECRET]),
    graphVersion: map[KEYS.GRAPH_VERSION] || 'v21.0',
    webhookBaseUrl: map[KEYS.WEBHOOK_BASE_URL],
    webhookVerifyToken: map[KEYS.WEBHOOK_VERIFY_TOKEN],
    appReviewStatus: map[KEYS.APP_REVIEW_STATUS] || 'DEVELOPMENT',
  };
}

export async function setMetaConfig(input) {
  const updates = [];
  if (input.appId !== undefined) updates.push({ key: KEYS.APP_ID, value: input.appId });
  if (input.appSecret) updates.push({ key: KEYS.APP_SECRET, value: encrypt(input.appSecret) });
  if (input.graphVersion) updates.push({ key: KEYS.GRAPH_VERSION, value: input.graphVersion });
  if (input.webhookBaseUrl) updates.push({ key: KEYS.WEBHOOK_BASE_URL, value: input.webhookBaseUrl });
  if (input.appReviewStatus) updates.push({ key: KEYS.APP_REVIEW_STATUS, value: input.appReviewStatus });
  for (const u of updates) {
    await prisma.settings.upsert({
      where: { key: u.key }, create: u, update: { value: u.value },
    });
  }
}

export async function regenerateVerifyToken() {
  const token = crypto.randomBytes(32).toString('hex');
  await prisma.settings.upsert({
    where: { key: KEYS.WEBHOOK_VERIFY_TOKEN },
    create: { key: KEYS.WEBHOOK_VERIFY_TOKEN, value: token },
    update: { value: token },
  });
  return token;
}

export async function getMetaConfigMasked() {
  try {
    const cfg = await getMetaConfig();
    return { ...cfg, appSecret: mascaraSecret(cfg.appSecret) };
  } catch (e) {
    if (e.code === 'META_NOT_CONFIGURED') return null;
    throw e;
  }
}
```

**Step 3: Rodar teste + commit**

```bash
cd delivery-saas-backend && node --test tests/metaConfig.test.mjs
git add delivery-saas-backend/src/services/metaConfig.js \
  delivery-saas-backend/tests/metaConfig.test.mjs
git commit -m "feat(messaging): metaConfig service with crypto + mascaraSecret"
```

---

## Task 15: Rotas `adminMetaConfig.js`

**Files:**
- Create: `delivery-saas-backend/src/routes/adminMetaConfig.js`
- Modify: `delivery-saas-backend/src/server.js` (registrar rota)

**Step 1: Implementar**

```js
// src/routes/adminMetaConfig.js
import express from 'express';
import axios from 'axios';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { getMetaConfig, getMetaConfigMasked, setMetaConfig, regenerateVerifyToken } from '../services/metaConfig.js';

const router = express.Router();

router.use(requireAuth, requireRole(['SUPER_ADMIN']));

router.get('/admin/meta-config', async (req, res) => {
  const cfg = await getMetaConfigMasked();
  res.json(cfg || { configured: false });
});

router.put('/admin/meta-config', async (req, res) => {
  await setMetaConfig(req.body);
  res.json({ ok: true });
});

router.post('/admin/meta-config/test', async (req, res) => {
  try {
    const { appId, appSecret, graphVersion } = await getMetaConfig();
    const token = `${appId}|${appSecret}`;
    const r = await axios.get(`https://graph.facebook.com/${graphVersion}/${appId}`, {
      params: { access_token: token },
    });
    res.json({ ok: true, app: r.data });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.response?.data || e.message });
  }
});

router.post('/admin/meta-config/regenerate-verify-token', async (req, res) => {
  const token = await regenerateVerifyToken();
  res.json({ token });
});

export default router;
```

**Step 2: Registrar em server.js**

Buscar onde outras rotas admin são registradas e adicionar:
```js
import adminMetaConfigRouter from './routes/adminMetaConfig.js';
app.use(adminMetaConfigRouter);
```

**Step 3: Smoke**

```bash
docker compose restart backend
# Em outro terminal, logar como SUPER_ADMIN e testar:
curl -H "Authorization: Bearer <token>" http://localhost:3000/admin/meta-config
# Expected: {"configured": false}
curl -X PUT -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"appId":"123","appSecret":"abc","graphVersion":"v21.0","webhookBaseUrl":"https://test"}' \
  http://localhost:3000/admin/meta-config
# Expected: {"ok": true}
curl -H "Authorization: Bearer <token>" http://localhost:3000/admin/meta-config
# Expected: {..., "appSecret":"***abc"}
```

**Step 4: Commit**

```bash
git add delivery-saas-backend/src/routes/adminMetaConfig.js delivery-saas-backend/src/server.js
git commit -m "feat(messaging): admin routes for Meta App config (SUPER_ADMIN)"
```

---

## Task 16: Frontend `MetaPlatformConfig.vue`

**Files:**
- Create: `delivery-saas-frontend/src/views/admin/MetaPlatformConfig.vue`
- Modify: `delivery-saas-frontend/src/router.js` (rota nova com guard SUPER_ADMIN)
- Modify: menu de navegação admin (procurar componente que lista links admin)

**Step 1: Antes de começar UI:**

Consultar a skill `frontend-deliverywl` (sistema de design do projeto) para garantir consistência visual (Bootstrap 5, padrões de form, espaçamentos).

**Step 2: Implementar view**

Layout per design doc. Usar `<TextInput>` e `<SelectInput>` (não inputs HTML raw — convenção do projeto).

```vue
<!-- src/views/admin/MetaPlatformConfig.vue -->
<template>
  <div class="container py-4">
    <h2 class="mb-4">Configuração Meta (Plataforma)</h2>

    <div v-if="loading">Carregando...</div>
    <form v-else @submit.prevent="save">
      <div class="mb-3">
        <label class="form-label">Status</label>
        <div>
          <span :class="['badge', cfg.configured ? 'bg-success' : 'bg-secondary']">
            {{ cfg.configured ? 'Configurado' : 'Não configurado' }}
          </span>
          <button type="button" class="btn btn-sm btn-outline-primary ms-2" @click="testConnection">
            Testar conexão
          </button>
        </div>
      </div>

      <TextInput v-model="form.appId" label="Meta App ID" required />

      <div class="mb-3">
        <label class="form-label">Meta App Secret</label>
        <div class="input-group">
          <input v-model="form.appSecret" :type="showSecret ? 'text' : 'password'"
                 class="form-control" :placeholder="cfg.appSecret || ''" />
          <button type="button" class="btn btn-outline-secondary" @click="showSecret = !showSecret">
            {{ showSecret ? 'Esconder' : 'Mostrar' }}
          </button>
        </div>
        <small class="text-muted">Deixe em branco para manter o atual</small>
      </div>

      <SelectInput v-model="form.graphVersion" label="Graph API Version"
                   :options="['v21.0','v20.0','v19.0']" />

      <TextInput v-model="form.webhookBaseUrl" label="Webhook Base URL"
                 hint="Cole esta URL no painel Meta App > Webhooks" />

      <div class="mb-3">
        <label class="form-label">Webhook Verify Token</label>
        <div class="input-group">
          <input class="form-control" :value="cfg.webhookVerifyToken" readonly />
          <button type="button" class="btn btn-outline-secondary" @click="regenerateToken">
            Gerar novo
          </button>
        </div>
      </div>

      <SelectInput v-model="form.appReviewStatus" label="App Review Status"
                   :options="[{value:'DEVELOPMENT',label:'Development'},{value:'LIVE',label:'Live'}]" />
      <div v-if="form.appReviewStatus === 'DEVELOPMENT'" class="alert alert-warning">
        ⚠ Em Development, só usuários do app conseguem testar.
      </div>

      <button type="submit" class="btn btn-primary">Salvar</button>
    </form>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { api } from '@/api';
import TextInput from '@/components/TextInput.vue';
import SelectInput from '@/components/SelectInput.vue';

const loading = ref(true);
const showSecret = ref(false);
const cfg = ref({});
const form = ref({ appId: '', appSecret: '', graphVersion: 'v21.0', webhookBaseUrl: '', appReviewStatus: 'DEVELOPMENT' });

async function load() {
  const { data } = await api.get('/admin/meta-config');
  cfg.value = data || {};
  if (data?.configured !== false) {
    form.value = { ...form.value, ...data, appSecret: '' };
  }
  loading.value = false;
}

async function save() {
  const payload = { ...form.value };
  if (!payload.appSecret) delete payload.appSecret;
  await api.put('/admin/meta-config', payload);
  await load();
  alert('Salvo');
}

async function testConnection() {
  try {
    const { data } = await api.post('/admin/meta-config/test');
    alert(data.ok ? 'Conexão OK: ' + (data.app?.name || data.app?.id) : 'Erro: ' + JSON.stringify(data.error));
  } catch (e) {
    alert('Erro: ' + e.message);
  }
}

async function regenerateToken() {
  if (!confirm('Gerar novo token? O atual deixará de funcionar.')) return;
  const { data } = await api.post('/admin/meta-config/regenerate-verify-token');
  cfg.value.webhookVerifyToken = data.token;
}

onMounted(load);
</script>
```

**Step 3: Adicionar rota e link**

Em `router.js`:
```js
{
  path: '/admin/meta-config',
  component: () => import('@/views/admin/MetaPlatformConfig.vue'),
  meta: { requiresAuth: true, requiresRole: 'SUPER_ADMIN' },
}
```

Adicionar link no menu admin (procurar `AdminMenu.vue` ou similar).

**Step 4: Smoke manual no browser**

```
docker compose up -d
# Abrir http://localhost:5173/admin/meta-config como SUPER_ADMIN
# Preencher campos, salvar, recarregar — verificar que appSecret aparece mascarado
# Clicar "Testar conexão" — esperar erro (app fake) ou sucesso (app real)
```

**Step 5: Commit**

```bash
git add delivery-saas-frontend/src/views/admin/MetaPlatformConfig.vue \
  delivery-saas-frontend/src/router.js \
  delivery-saas-frontend/src/components/AdminMenu.vue
git commit -m "feat(messaging): SUPER_ADMIN UI for Meta App config"
```

---

# FASE 5 — WhatsApp Meta Cloud adapter

## Task 17: Webhook handler `webhookMeta.js` (handshake + signature)

**Files:**
- Create: `delivery-saas-backend/src/routes/webhookMeta.js`
- Modify: `delivery-saas-backend/src/server.js`

**Step 1: Implementar (sem dispatch ainda)**

```js
// src/routes/webhookMeta.js
import express from 'express';
import crypto from 'node:crypto';
import { getMetaConfig } from '../services/metaConfig.js';
import { prisma } from '../prisma.js';
import { routeInbound } from '../messaging/router.js';

const router = express.Router();

// IMPORTANT: este route precisa do body raw para validar assinatura.
// Configurar express.raw() apenas para essa rota.
router.get('/webhook/meta', async (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode !== 'subscribe') return res.sendStatus(400);

  // Aceita verify token global OU per-account
  const { webhookVerifyToken: globalToken } = await getMetaConfig().catch(() => ({}));
  if (token === globalToken) return res.status(200).send(challenge);

  const acc = await prisma.metaMessagingAccount.findUnique({ where: { webhookVerifyToken: token } });
  if (acc) return res.status(200).send(challenge);

  return res.sendStatus(403);
});

router.post('/webhook/meta',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    try {
      const sig = req.get('X-Hub-Signature-256') || '';
      const { appSecret } = await getMetaConfig();
      const expected = 'sha256=' + crypto.createHmac('sha256', appSecret).update(req.body).digest('hex');
      if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
        return res.sendStatus(403);
      }
      const payload = JSON.parse(req.body.toString('utf8'));
      await dispatchMeta(payload);
      res.sendStatus(200);
    } catch (err) {
      console.error('[webhook/meta]', err);
      res.sendStatus(500);
    }
  }
);

async function dispatchMeta(payload) {
  // Discriminar por payload.object
  const obj = payload.object;
  for (const entry of payload.entry || []) {
    let provider;
    if (obj === 'whatsapp_business_account') provider = 'META_WA';
    else if (obj === 'page') provider = 'META_FB';
    else if (obj === 'instagram') provider = 'META_IG';
    else continue;

    // Resolver account
    const externalId = obj === 'whatsapp_business_account'
      ? entry.changes?.[0]?.value?.metadata?.phone_number_id
      : entry.id;

    const account = await prisma.metaMessagingAccount.findFirst({
      where: { kind: provider, externalId },
    });
    if (!account) {
      console.warn('[webhook/meta] account não reconhecida:', { provider, externalId });
      continue;
    }
    await routeInbound(provider, entry, account);
  }
}

export default router;
```

**Step 2: Registrar em server.js**

```js
import webhookMetaRouter from './routes/webhookMeta.js';
app.use(webhookMetaRouter);
```

**Step 3: Smoke (handshake)**

```bash
docker compose restart backend
# Simular handshake
curl "http://localhost:3000/webhook/meta?hub.mode=subscribe&hub.verify_token=WRONG&hub.challenge=abc"
# Expected: 403
# Configurar token via admin, depois:
curl "http://localhost:3000/webhook/meta?hub.mode=subscribe&hub.verify_token=<token_real>&hub.challenge=abc"
# Expected: 200 "abc"
```

**Step 4: Commit**

```bash
git add delivery-saas-backend/src/routes/webhookMeta.js delivery-saas-backend/src/server.js
git commit -m "feat(messaging): Meta webhook with handshake and signature validation"
```

---

## Task 18: Adapter `whatsappMeta.adapter.js`

**Files:**
- Create: `delivery-saas-backend/src/messaging/adapters/whatsappMeta.adapter.js`
- Create: `delivery-saas-backend/tests/messaging.adapters.whatsappMeta.test.mjs`
- Create: `delivery-saas-backend/tests/fixtures/meta-wa.*.json` (text, image, audio)

**Step 1: Capturar fixtures** — formato Cloud API documentado em developers.facebook.com/docs/whatsapp/cloud-api/webhooks/payload-examples. Salvar 3 exemplos representativos.

**Step 2: Testes (similar a Evolution: TEXT, IMAGE, dedupe)**

**Step 3: Implementar adapter**

```js
// src/messaging/adapters/whatsappMeta.adapter.js
import axios from 'axios';
import { normalizedMessage, MetaWindowExpiredError } from './base.adapter.js';
import { decrypt } from '../crypto.js';
import { getMetaConfig } from '../../services/metaConfig.js';
import { prisma } from '../../prisma.js';

const adapter = {
  provider: 'META_WA',
  channel: 'WHATSAPP',

  // Handshake é feito globalmente em webhookMeta.js
  async verifyWebhook(req, res) { res.sendStatus(200); },

  async parseInbound(entry, account) {
    const out = [];
    for (const change of entry.changes || []) {
      const value = change.value || {};
      const contacts = value.contacts || [];
      const messages = value.messages || [];
      const contactByWaId = Object.fromEntries(contacts.map(c => [c.wa_id, c]));
      for (const m of messages) {
        const contact = contactByWaId[m.from] || {};
        out.push(normalizedMessage({
          externalId: m.id,
          channel: 'WHATSAPP',
          provider: 'META_WA',
          companyId: account.companyId,
          channelContactId: '55' + m.from.replace(/^55/, ''), // normalizar
          contactName: contact.profile?.name,
          type: mapType(m),
          body: m.text?.body || m.interactive?.body?.text || null,
          mediaUrl: null, // resolvido em downloadMedia (Meta exige token)
          mimeType: m.image?.mime_type || m.audio?.mime_type || m.video?.mime_type || m.document?.mime_type,
          timestamp: new Date(parseInt(m.timestamp, 10) * 1000),
          raw: m,
        }));
      }
    }
    return out;
  },

  async sendMessage(account, to, content) {
    const { graphVersion } = await getMetaConfig();
    const token = decrypt(account.accessToken);
    const url = `https://graph.facebook.com/${graphVersion}/${account.externalId}/messages`;

    let body;
    if (content.type === 'TEXT') {
      body = { messaging_product: 'whatsapp', to, type: 'text', text: { body: content.text } };
    } else {
      // mídia: type mapeado
      const type = content.type.toLowerCase();
      body = {
        messaging_product: 'whatsapp', to, type,
        [type]: { link: content.mediaUrl, caption: content.text || undefined },
      };
    }

    try {
      const r = await axios.post(url, body, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return { externalId: r.data?.messages?.[0]?.id, status: 'SENT' };
    } catch (err) {
      const code = err.response?.data?.error?.code;
      // Meta 131047 = re-engagement (fora 24h)
      if (code === 131047 || code === 131051) throw new MetaWindowExpiredError('WHATSAPP');
      throw err;
    }
  },

  async sendMedia(account, to, mediaUrl, type, caption) {
    return this.sendMessage(account, to, { type: type.toUpperCase(), mediaUrl, text: caption });
  },

  async resolveAccount(externalId) {
    return prisma.metaMessagingAccount.findFirst({
      where: { kind: 'META_WA', externalId },
    });
  },

  async downloadMedia(mediaId, account) {
    const { graphVersion } = await getMetaConfig();
    const token = decrypt(account.accessToken);
    const meta = await axios.get(`https://graph.facebook.com/${graphVersion}/${mediaId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const bin = await axios.get(meta.data.url, {
      headers: { Authorization: `Bearer ${token}` },
      responseType: 'arraybuffer',
    });
    return { buffer: Buffer.from(bin.data), mimeType: meta.data.mime_type };
  },
};

function mapType(m) {
  if (m.text) return 'TEXT';
  if (m.image) return 'IMAGE';
  if (m.audio) return 'AUDIO';
  if (m.video) return 'VIDEO';
  if (m.document) return 'DOCUMENT';
  if (m.sticker) return 'STICKER';
  if (m.location) return 'LOCATION';
  if (m.interactive) return 'TEXT';
  return 'TEXT';
}

export default adapter;
```

**Step 4: Registrar no `messaging/index.js`**

```js
import whatsappMeta from './adapters/whatsappMeta.adapter.js';
registerAdapter(whatsappMeta.provider, whatsappMeta);
```

**Step 5: Rodar testes + commit**

```bash
cd delivery-saas-backend && node --test tests/messaging.adapters.whatsappMeta.test.mjs
git add delivery-saas-backend/src/messaging/adapters/whatsappMeta.adapter.js \
  delivery-saas-backend/src/messaging/index.js \
  delivery-saas-backend/tests/messaging.adapters.whatsappMeta.test.mjs \
  delivery-saas-backend/tests/fixtures/meta-wa.*.json
git commit -m "feat(messaging): WhatsApp Meta Cloud adapter"
```

---

## Task 19: OAuth routes `metaOauth.js`

**Files:**
- Create: `delivery-saas-backend/src/routes/metaOauth.js`
- Modify: `delivery-saas-backend/src/server.js`

**Step 1: Implementar**

```js
// src/routes/metaOauth.js
import express from 'express';
import axios from 'axios';
import crypto from 'node:crypto';
import { requireAuth } from '../middleware/auth.js';
import { getMetaConfig } from '../services/metaConfig.js';
import { encrypt } from '../messaging/crypto.js';
import { prisma } from '../prisma.js';

const router = express.Router();
const stateCache = new Map(); // simple in-memory; produção pode usar Redis

router.get('/auth/meta/start', requireAuth, async (req, res) => {
  const { appId, webhookBaseUrl } = await getMetaConfig();
  const state = crypto.randomBytes(16).toString('hex');
  stateCache.set(state, { userId: req.user.id, companyId: req.user.companyId, ts: Date.now() });

  const scopes = [
    'pages_messaging','pages_show_list','pages_manage_metadata',
    'instagram_basic','instagram_manage_messages',
    'whatsapp_business_messaging','whatsapp_business_management',
    'business_management',
  ].join(',');

  const redirectUri = `${webhookBaseUrl.replace(/\/webhook\/meta$/, '')}/auth/meta/callback`;
  const url = `https://www.facebook.com/v21.0/dialog/oauth?` + new URLSearchParams({
    client_id: appId, redirect_uri: redirectUri, scope: scopes, state, response_type: 'code',
  });
  res.json({ url });
});

router.get('/auth/meta/callback', async (req, res) => {
  const { code, state } = req.query;
  const stateData = stateCache.get(state);
  if (!stateData) return res.status(400).send('Invalid state');
  stateCache.delete(state);

  const { appId, appSecret, graphVersion, webhookBaseUrl } = await getMetaConfig();
  const redirectUri = `${webhookBaseUrl.replace(/\/webhook\/meta$/, '')}/auth/meta/callback`;

  // 1. code → short-lived token
  const shortRes = await axios.get(`https://graph.facebook.com/${graphVersion}/oauth/access_token`, {
    params: { client_id: appId, client_secret: appSecret, redirect_uri: redirectUri, code },
  });
  const shortToken = shortRes.data.access_token;

  // 2. short → long-lived (60d)
  const longRes = await axios.get(`https://graph.facebook.com/${graphVersion}/oauth/access_token`, {
    params: { grant_type: 'fb_exchange_token', client_id: appId, client_secret: appSecret, fb_exchange_token: shortToken },
  });
  const longToken = longRes.data.access_token;
  const expiresIn = longRes.data.expires_in;

  // 3. Listar accounts disponíveis: Pages, WABAs, IG
  const accounts = await listAvailableAccounts(longToken, graphVersion);

  // Salvar long token temporariamente associado ao usuário, em sessão segura;
  // simples: devolver pro frontend, frontend manda PUT /auth/meta/connect com seleção
  const tempKey = crypto.randomBytes(16).toString('hex');
  stateCache.set(tempKey, { ...stateData, longToken, expiresIn, accounts });

  // Redirect para tela de seleção no frontend
  res.redirect(`/settings/meta-integrations?temp=${tempKey}`);
});

router.get('/auth/meta/accounts', requireAuth, async (req, res) => {
  const data = stateCache.get(req.query.temp);
  if (!data) return res.status(404).json({ error: 'expired' });
  res.json({ accounts: data.accounts, expiresIn: data.expiresIn });
});

router.post('/auth/meta/connect', requireAuth, async (req, res) => {
  const { temp, selections } = req.body;
  // selections: [{ kind, externalId, menuId? }, ...]
  const data = stateCache.get(temp);
  if (!data || data.companyId !== req.user.companyId) return res.status(400).json({ error: 'invalid' });

  const created = [];
  for (const sel of selections) {
    const verifyToken = crypto.randomBytes(32).toString('hex');
    const acc = await prisma.metaMessagingAccount.upsert({
      where: { companyId_kind_externalId: { companyId: req.user.companyId, kind: sel.kind, externalId: sel.externalId } },
      create: {
        companyId: req.user.companyId, kind: sel.kind, externalId: sel.externalId,
        displayName: sel.displayName, accessToken: encrypt(data.longToken),
        tokenExpiresAt: new Date(Date.now() + data.expiresIn * 1000),
        wabaId: sel.wabaId, fbPageId: sel.fbPageId,
        webhookVerifyToken: verifyToken,
      },
      update: {
        displayName: sel.displayName, accessToken: encrypt(data.longToken),
        tokenExpiresAt: new Date(Date.now() + data.expiresIn * 1000),
        status: 'ACTIVE', lastError: null,
      },
    });
    if (sel.menuId) {
      const field = sel.kind === 'META_WA' ? 'metaWaAccountId'
                  : sel.kind === 'META_FB' ? 'facebookAccountId'
                  : 'instagramAccountId';
      await prisma.menu.update({ where: { id: sel.menuId }, data: { [field]: acc.id } });
    }
    // Subscribe webhook
    await subscribeWebhook(acc, data.longToken);
    created.push(acc.id);
  }
  stateCache.delete(temp);
  res.json({ created });
});

async function listAvailableAccounts(token, version) {
  const out = { pages: [], igAccounts: [], waNumbers: [] };

  // Pages
  const pagesRes = await axios.get(`https://graph.facebook.com/${version}/me/accounts`, {
    params: { access_token: token, fields: 'id,name,access_token' },
  });
  out.pages = pagesRes.data.data;

  // IG vinculadas a cada Page
  for (const p of out.pages) {
    try {
      const ig = await axios.get(`https://graph.facebook.com/${version}/${p.id}`, {
        params: { access_token: p.access_token, fields: 'instagram_business_account{id,username}' },
      });
      if (ig.data.instagram_business_account) {
        out.igAccounts.push({ ...ig.data.instagram_business_account, fbPageId: p.id });
      }
    } catch (e) { /* skip */ }
  }

  // WABAs e phone numbers
  try {
    const biz = await axios.get(`https://graph.facebook.com/${version}/me/businesses`, {
      params: { access_token: token },
    });
    for (const b of biz.data.data || []) {
      const wabas = await axios.get(`https://graph.facebook.com/${version}/${b.id}/owned_whatsapp_business_accounts`, {
        params: { access_token: token },
      });
      for (const w of wabas.data.data || []) {
        const numbers = await axios.get(`https://graph.facebook.com/${version}/${w.id}/phone_numbers`, {
          params: { access_token: token },
        });
        for (const n of numbers.data.data || []) {
          out.waNumbers.push({ phoneNumberId: n.id, displayPhoneNumber: n.display_phone_number, wabaId: w.id });
        }
      }
    }
  } catch (e) { /* skip se sem acesso a businesses */ }

  return out;
}

async function subscribeWebhook(account, token) {
  const { graphVersion } = await getMetaConfig();
  if (account.kind === 'META_FB' || account.kind === 'META_IG') {
    // Subscribe Page (cobre tanto FB messaging quanto IG messaging se IG vinculada)
    const pageId = account.kind === 'META_FB' ? account.externalId : account.fbPageId;
    await axios.post(`https://graph.facebook.com/${graphVersion}/${pageId}/subscribed_apps`, null, {
      params: {
        access_token: token,
        subscribed_fields: account.kind === 'META_FB' ? 'messages,messaging_postbacks' : 'messages',
      },
    });
  } else if (account.kind === 'META_WA') {
    // Register phone number
    await axios.post(`https://graph.facebook.com/${graphVersion}/${account.externalId}/register`, {
      messaging_product: 'whatsapp', pin: '000000', // pin de 2FA — pedir ao usuário no UI futuramente
    }, { headers: { Authorization: `Bearer ${token}` } });
  }
}

export default router;
```

**Step 2: Registrar em server.js**

```js
import metaOauthRouter from './routes/metaOauth.js';
app.use(metaOauthRouter);
```

**Step 3: Smoke (apenas /start, callback exige Meta real)**

```bash
docker compose restart backend
curl -H "Authorization: Bearer <token>" http://localhost:3000/auth/meta/start
# Expected: {"url": "https://www.facebook.com/v21.0/dialog/oauth?..."}
```

**Step 4: Commit**

```bash
git add delivery-saas-backend/src/routes/metaOauth.js delivery-saas-backend/src/server.js
git commit -m "feat(messaging): OAuth flow for Meta accounts (Pages, IG, WABA)"
```

---

## Task 20: Cron de refresh de tokens

**Files:**
- Create: `delivery-saas-backend/scripts/cron/refreshMetaTokens.js`
- Modify: setup do cron (CronJob existente ou doc para o ops rodar)

**Step 1: Implementar**

```js
// scripts/cron/refreshMetaTokens.js
import axios from 'axios';
import { prisma } from '../../src/prisma.js';
import { getMetaConfig } from '../../src/services/metaConfig.js';
import { encrypt, decrypt } from '../../src/messaging/crypto.js';

async function main() {
  const { appId, appSecret, graphVersion } = await getMetaConfig();
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  const accounts = await prisma.metaMessagingAccount.findMany({
    where: {
      status: 'ACTIVE',
      tokenExpiresAt: { lt: new Date(Date.now() + sevenDays) },
    },
  });
  console.log(`${accounts.length} tokens para renovar`);

  for (const acc of accounts) {
    try {
      const r = await axios.get(`https://graph.facebook.com/${graphVersion}/oauth/access_token`, {
        params: {
          grant_type: 'fb_exchange_token',
          client_id: appId, client_secret: appSecret,
          fb_exchange_token: decrypt(acc.accessToken),
        },
      });
      await prisma.metaMessagingAccount.update({
        where: { id: acc.id },
        data: {
          accessToken: encrypt(r.data.access_token),
          tokenExpiresAt: new Date(Date.now() + r.data.expires_in * 1000),
          lastError: null,
        },
      });
      console.log(`OK ${acc.id}`);
    } catch (e) {
      await prisma.metaMessagingAccount.update({
        where: { id: acc.id },
        data: { status: 'DISCONNECTED', lastError: e.response?.data?.error?.message || e.message },
      });
      console.error(`FAIL ${acc.id}`, e.message);
    }
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
```

**Step 2: Doc do agendamento**

Adicionar no `delivery-saas-backend/README.md` (ou doc de ops):
```
# Refresh diário Meta tokens
docker compose exec backend node scripts/cron/refreshMetaTokens.js
```

Configurar cronjob no host: `0 3 * * * docker compose exec -T backend node scripts/cron/refreshMetaTokens.js`

**Step 3: Commit**

```bash
git add delivery-saas-backend/scripts/cron/refreshMetaTokens.js
git commit -m "feat(messaging): daily cron to refresh Meta long-lived tokens"
```

---

# FASE 6 — Facebook Messenger adapter

## Task 21: Adapter `facebook.adapter.js`

**Files:**
- Create: `delivery-saas-backend/src/messaging/adapters/facebook.adapter.js`
- Create: `delivery-saas-backend/tests/messaging.adapters.facebook.test.mjs`
- Create: `delivery-saas-backend/tests/fixtures/meta-fb.*.json` (text, attachment_image)

**Step 1: Capturar fixtures** — formato `entry[].messaging[]` documentado em developers.facebook.com/docs/messenger-platform/reference/webhook-events/messages.

**Step 2: Teste + implementação (padrão dos anteriores)**

```js
// src/messaging/adapters/facebook.adapter.js
import axios from 'axios';
import { normalizedMessage, MetaWindowExpiredError } from './base.adapter.js';
import { decrypt } from '../crypto.js';
import { getMetaConfig } from '../../services/metaConfig.js';
import { prisma } from '../../prisma.js';

const adapter = {
  provider: 'META_FB',
  channel: 'FACEBOOK',

  async verifyWebhook(req, res) { res.sendStatus(200); },

  async parseInbound(entry, account) {
    const out = [];
    for (const ev of entry.messaging || []) {
      if (!ev.message || ev.message.is_echo) continue;
      const type = ev.message.attachments?.[0]?.type
        ? mapAttachmentType(ev.message.attachments[0].type)
        : 'TEXT';
      out.push(normalizedMessage({
        externalId: ev.message.mid,
        channel: 'FACEBOOK',
        provider: 'META_FB',
        companyId: account.companyId,
        channelContactId: ev.sender.id,
        contactName: null, // resolvido via Graph se quiser perfil
        type,
        body: ev.message.text || null,
        mediaUrl: ev.message.attachments?.[0]?.payload?.url || null,
        timestamp: new Date(ev.timestamp),
        raw: ev,
      }));
    }
    return out;
  },

  async sendMessage(account, to, content) {
    const { graphVersion } = await getMetaConfig();
    const token = decrypt(account.accessToken);
    const url = `https://graph.facebook.com/${graphVersion}/me/messages?access_token=${encodeURIComponent(token)}`;

    let body;
    if (content.type === 'TEXT') {
      body = { recipient: { id: to }, messaging_type: 'RESPONSE', message: { text: content.text } };
    } else {
      const attachType = content.type.toLowerCase();
      body = {
        recipient: { id: to }, messaging_type: 'RESPONSE',
        message: {
          attachment: { type: attachType, payload: { url: content.mediaUrl, is_reusable: false } },
        },
      };
    }
    try {
      const r = await axios.post(url, body);
      return { externalId: r.data.message_id, status: 'SENT' };
    } catch (err) {
      const code = err.response?.data?.error?.code;
      if (code === 10 || code === 2018278) throw new MetaWindowExpiredError('FACEBOOK');
      throw err;
    }
  },

  async sendMedia(account, to, mediaUrl, type, caption) {
    if (caption) await this.sendMessage(account, to, { type: 'TEXT', text: caption });
    return this.sendMessage(account, to, { type: type.toUpperCase(), mediaUrl });
  },

  async resolveAccount(externalId) {
    return prisma.metaMessagingAccount.findFirst({ where: { kind: 'META_FB', externalId } });
  },

  async downloadMedia() { return null; }, // FB entrega URL direto
};

function mapAttachmentType(t) {
  if (t === 'image') return 'IMAGE';
  if (t === 'audio') return 'AUDIO';
  if (t === 'video') return 'VIDEO';
  if (t === 'file') return 'DOCUMENT';
  return 'TEXT';
}

export default adapter;
```

**Step 3: Registrar + commit**

```bash
# adicionar registerAdapter em messaging/index.js
git add delivery-saas-backend/src/messaging/adapters/facebook.adapter.js \
  delivery-saas-backend/src/messaging/index.js \
  delivery-saas-backend/tests/messaging.adapters.facebook.test.mjs \
  delivery-saas-backend/tests/fixtures/meta-fb.*.json
git commit -m "feat(messaging): Facebook Messenger adapter"
```

---

# FASE 7 — Instagram adapter

## Task 22: Adapter `instagram.adapter.js`

**Files:**
- Create: `delivery-saas-backend/src/messaging/adapters/instagram.adapter.js`
- Create: `delivery-saas-backend/tests/messaging.adapters.instagram.test.mjs`
- Create: `delivery-saas-backend/tests/fixtures/meta-ig.*.json`

**Step 1: Adaptar do facebook adapter** — IG usa o mesmo formato `entry[].messaging[]`, com ressalvas:
- Sender ID é IG-scoped
- Mensagens podem ser `story_reply` ou `story_mention` (tratar como type TEXT + body especial)
- Endpoint de envio: `https://graph.facebook.com/v21.0/me/messages` mas autenticado pelo token da Page vinculada à IG Business

**Step 2: Implementar** (estrutura quase idêntica ao FB; trocar provider/channel; tratar story_reply)

```js
// src/messaging/adapters/instagram.adapter.js
import { normalizedMessage } from './base.adapter.js';
import facebook from './facebook.adapter.js';
import { prisma } from '../../prisma.js';

const adapter = {
  ...facebook,
  provider: 'META_IG',
  channel: 'INSTAGRAM',

  async parseInbound(entry, account) {
    const out = [];
    for (const ev of entry.messaging || []) {
      if (!ev.message || ev.message.is_echo) continue;
      let body = ev.message.text || null;
      // Story reply / mention
      if (ev.message.reply_to?.story) body = `[Story reply] ${body || ''}`.trim();
      const type = ev.message.attachments?.[0]?.type ? mapAttachmentType(ev.message.attachments[0].type) : 'TEXT';
      out.push(normalizedMessage({
        externalId: ev.message.mid,
        channel: 'INSTAGRAM',
        provider: 'META_IG',
        companyId: account.companyId,
        channelContactId: ev.sender.id,
        type, body,
        mediaUrl: ev.message.attachments?.[0]?.payload?.url || null,
        timestamp: new Date(ev.timestamp),
        raw: ev,
      }));
    }
    return out;
  },

  async resolveAccount(externalId) {
    return prisma.metaMessagingAccount.findFirst({ where: { kind: 'META_IG', externalId } });
  },
};

function mapAttachmentType(t) {
  if (t === 'image') return 'IMAGE';
  if (t === 'video') return 'VIDEO';
  if (t === 'audio') return 'AUDIO';
  if (t === 'share' || t === 'story_mention') return 'IMAGE';
  return 'TEXT';
}

export default adapter;
```

**Step 3: Registrar + commit**

```bash
git add delivery-saas-backend/src/messaging/adapters/instagram.adapter.js \
  delivery-saas-backend/src/messaging/index.js \
  delivery-saas-backend/tests/messaging.adapters.instagram.test.mjs \
  delivery-saas-backend/tests/fixtures/meta-ig.*.json
git commit -m "feat(messaging): Instagram Direct adapter (extends FB with story handling)"
```

---

# FASE 8 — Frontend (Inbox UI + Onboarding)

## Task 23: Badges de canal em `ConversationItem.vue`

**Files:**
- Modify: `delivery-saas-frontend/src/views/inbox/ConversationItem.vue`
- Create: `delivery-saas-frontend/src/components/inbox/ChannelBadge.vue`

**Step 1: Consultar skill `frontend-deliverywl`** para padrão de badges/cores.

**Step 2: Criar componente reutilizável**

```vue
<!-- src/components/inbox/ChannelBadge.vue -->
<template>
  <span :class="['channel-badge', `channel-${channel.toLowerCase()}`]" :title="tooltip">
    <i :class="iconClass"></i>
    <span class="visually-hidden">{{ channel }}</span>
  </span>
</template>

<script setup>
import { computed } from 'vue';
const props = defineProps({ channel: String, provider: String });

const iconClass = computed(() => ({
  WHATSAPP: 'bi bi-whatsapp',
  FACEBOOK: 'bi bi-messenger',
  INSTAGRAM: 'bi bi-instagram',
}[props.channel] || 'bi bi-chat'));

const tooltip = computed(() => {
  if (props.channel === 'WHATSAPP') {
    return props.provider === 'META_WA' ? 'WhatsApp (Meta Cloud)' : 'WhatsApp (Evolution)';
  }
  return { FACEBOOK: 'Messenger', INSTAGRAM: 'Instagram Direct' }[props.channel];
});
</script>

<style scoped>
.channel-badge { display: inline-flex; align-items: center; padding: 2px 6px; border-radius: 4px; font-size: 12px; color: #fff; }
.channel-whatsapp  { background: #25D366; }
.channel-facebook  { background: #0084FF; }
.channel-instagram { background: linear-gradient(45deg, #833AB4, #FD1D1D 50%, #FCB045); }
</style>
```

**Step 3: Usar em ConversationItem**

Adicionar `<ChannelBadge :channel="conversation.channel" :provider="conversation.provider" />` perto do nome do contato.

**Step 4: Smoke manual** — abrir inbox, ver badges renderizados.

**Step 5: Commit**

```bash
git add delivery-saas-frontend/src/components/inbox/ChannelBadge.vue \
  delivery-saas-frontend/src/views/inbox/ConversationItem.vue
git commit -m "feat(inbox): channel badges (WA/FB/IG) in conversation list"
```

---

## Task 24: Filtro por canal em `ConversationList.vue`

**Files:**
- Modify: `delivery-saas-frontend/src/views/inbox/ConversationList.vue`
- Modify: `delivery-saas-frontend/src/stores/inbox.js`
- Modify: `delivery-saas-backend/src/routes/inbox.js` (query param `channel`)

**Step 1: Backend** — adicionar filtro `channel` em `GET /conversations`:

```js
// dentro do handler
if (req.query.channel) where.channel = req.query.channel;
```

**Step 2: Store** — adicionar `channelFilter` ao state e enviar na request:

```js
// stores/inbox.js
state: () => ({ ..., channelFilter: null }),
actions: {
  async fetchConversations() {
    const params = { ..., channel: this.channelFilter };
    // ...
  }
}
```

**Step 3: UI chips** em ConversationList.vue:

```vue
<div class="channel-filter mb-2">
  <button v-for="opt in channelOpts" :key="opt.v"
          :class="['btn btn-sm', store.channelFilter === opt.v ? 'btn-primary' : 'btn-outline-secondary']"
          @click="setChannel(opt.v)">
    {{ opt.label }}
  </button>
</div>
```

```js
const channelOpts = [
  { v: null, label: 'Todos' },
  { v: 'WHATSAPP', label: 'WhatsApp' },
  { v: 'FACEBOOK', label: 'Messenger' },
  { v: 'INSTAGRAM', label: 'Instagram' },
];
function setChannel(v) { store.channelFilter = v; store.fetchConversations(); }
```

**Step 4: Smoke + commit**

```bash
git add delivery-saas-frontend/src/views/inbox/ConversationList.vue \
  delivery-saas-frontend/src/stores/inbox.js \
  delivery-saas-backend/src/routes/inbox.js
git commit -m "feat(inbox): channel filter chips (Todos/WA/FB/IG)"
```

---

## Task 25: Banner janela 24h + header de canal em `ChatPanel.vue`

**Files:**
- Modify: `delivery-saas-frontend/src/views/inbox/ChatPanel.vue`

**Step 1: Implementar**

```vue
<template>
  <div class="chat-panel">
    <header class="chat-header">
      <ChannelBadge :channel="conv.channel" :provider="conv.provider" />
      <strong>{{ conv.contact?.name || conv.channelContactId }}</strong>
    </header>

    <div v-if="windowExpired" class="alert alert-warning small mb-2">
      Janela de 24h expirada — Meta restringe envio livre. Use template aprovado.
    </div>

    <!-- ... messages list -->

    <textarea v-model="draft" :disabled="windowExpired" placeholder="Digite..." />
    <button :disabled="windowExpired" @click="send">Enviar</button>
    <button v-if="windowExpired" @click="openTemplateModal">Enviar template</button>
  </div>
</template>

<script setup>
import { computed } from 'vue';
// ...
const windowExpired = computed(() => {
  if (!['META_WA','META_FB','META_IG'].includes(conv.value.provider)) return false;
  const lastInbound = conv.value.lastInboundAt; // backend deve expor esse campo
  if (!lastInbound) return true;
  return Date.now() - new Date(lastInbound).getTime() > 24 * 3600 * 1000;
});
</script>
```

**Step 2: Backend exposição de `lastInboundAt`**

Em `GET /conversations` e `GET /conversations/:id`, incluir:
```js
const last = await prisma.message.findFirst({
  where: { conversationId: c.id, direction: 'INBOUND' },
  orderBy: { createdAt: 'desc' },
  select: { createdAt: true },
});
c.lastInboundAt = last?.createdAt;
```

**Step 3: Smoke + commit**

```bash
git add delivery-saas-frontend/src/views/inbox/ChatPanel.vue \
  delivery-saas-backend/src/routes/inbox.js
git commit -m "feat(inbox): 24h window banner + channel header for Meta conversations"
```

---

## Task 26: Tela `MetaIntegrations.vue` (cliente conecta contas)

**Files:**
- Create: `delivery-saas-frontend/src/views/settings/MetaIntegrations.vue`
- Modify: router

**Step 1: Implementar UI** (per design doc)

Fluxo:
1. Status atual (já conectado? mostrar contas; senão: botão "Conectar")
2. Botão "Conectar" → chama `GET /auth/meta/start` → abre URL do Facebook
3. Callback redireciona com `?temp=xxx` → carrega `GET /auth/meta/accounts?temp=xxx`
4. Lista checkboxes (Pages, IG, números WA) com dropdown de cardápio cada
5. Submit → `POST /auth/meta/connect`

Implementação seguindo design system (consultar `frontend-deliverywl`).

**Step 2: Warning de coexistência WA**

Quando usuário marca um WA Meta e o cardápio já tem `whatsappInstanceId` (Evolution), mostrar alerta inline com texto do design doc.

**Step 3: Smoke + commit**

```bash
git add delivery-saas-frontend/src/views/settings/MetaIntegrations.vue \
  delivery-saas-frontend/src/router.js \
  delivery-saas-frontend/src/views/settings/SettingsMenu.vue
git commit -m "feat(meta): client onboarding UI to connect Meta accounts"
```

---

# FASE 9 — Customer matching e ContactPanel

## Task 27: Atualizar `link-customer` para `metaIdentities`

**Files:**
- Modify: `delivery-saas-backend/src/routes/inbox.js`
- Modify: `delivery-saas-frontend/src/views/inbox/ContactPanel.vue`

**Step 1: Backend**

Em `POST /conversations/:id/link-customer`:

```js
const conv = await prisma.conversation.findUnique({ where: { id }, select: { channel: true, channelContactId: true } });
if (conv.channel === 'WHATSAPP') {
  // comportamento atual: atualizar Customer.whatsapp
} else {
  // adicionar identity ao Customer.metaIdentities
  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  const ids = Array.isArray(customer.metaIdentities) ? customer.metaIdentities : [];
  const provider = conv.provider; // META_FB | META_IG
  if (!ids.some(i => i.provider === provider && i.externalId === conv.channelContactId)) {
    ids.push({ provider, externalId: conv.channelContactId });
    await prisma.customer.update({ where: { id: customerId }, data: { metaIdentities: ids } });
  }
}
await prisma.conversation.update({ where: { id }, data: { customerId } });
```

**Step 2: Frontend** — sem mudança significativa, o ContactPanel já chama essa rota.

**Step 3: Commit**

```bash
git add delivery-saas-backend/src/routes/inbox.js
git commit -m "feat(messaging): link-customer supports Meta identities for FB/IG"
```

---

## Task 28: Verificação final integrada (smoke E2E)

**Não é commit** — checklist de validação manual antes de marcar a entrega como concluída:

- [ ] Login como SUPER_ADMIN, configurar Meta App (campos salvos, mascarados no GET)
- [ ] "Testar conexão" retorna OK com App ID/Secret válidos
- [ ] Login como cliente comum (não SUPER_ADMIN): `/admin/meta-config` retorna 403
- [ ] Cliente conecta conta Meta via OAuth (em modo dev usar Test User)
- [ ] Vincula 1 Page + 1 IG + 1 WA Cloud a 1 cardápio
- [ ] Envia mensagem do Test User para a Page → aparece no inbox com badge FB
- [ ] Operador responde → mensagem chega no Messenger
- [ ] Envia mensagem para IG → aparece com badge IG
- [ ] Envia mensagem para WA Cloud → aparece com badge WA + tooltip "Meta Cloud"
- [ ] Mensagem WhatsApp Evolution (cardápio antigo) continua funcionando, badge WA + tooltip "Evolution"
- [ ] Saudação por horário dispara automaticamente em todos os 4 transports
- [ ] Out-of-hours funciona em todos
- [ ] Tagging por keyword funciona em todos
- [ ] Remind last order só dispara em WhatsApp (Evolution + Meta), não em FB/IG
- [ ] Filtro por canal funciona corretamente
- [ ] Banner janela 24h aparece se última inbound > 24h em FB/IG/Meta WA
- [ ] Conversa existente WhatsApp tem `provider=EVOLUTION_WA` após backfill
- [ ] Webhook handshake retorna 200 com token correto, 403 com errado
- [ ] Webhook POST com signature inválida retorna 403
- [ ] Cron de refresh de tokens roda sem erro
- [ ] Documentar no README como configurar Meta App externamente (URL webhook, escopos)

---

## Pós-entrega: doc do operador

Adicionar/atualizar `docs/operacao/meta-integration.md` (criar pasta se não existir) com:
- Como o cliente final conecta sua conta Meta
- O que fazer quando aparece "DISCONNECTED" status
- Limitações da janela 24h
- Diferenças entre WA Evolution e WA Meta Cloud (custo, recursos, recomendação)

---

## Resumo de arquivos criados/modificados

**Backend criados:**
- `src/messaging/{crypto,inboundPipeline,automations,phoneVariants,router,index}.js`
- `src/messaging/adapters/{base,whatsappEvolution,whatsappMeta,facebook,instagram}.adapter.js`
- `src/services/metaConfig.js`
- `src/routes/{webhookMeta,metaOauth,adminMetaConfig}.js`
- `scripts/backfill-conversation-provider.js`
- `scripts/cron/refreshMetaTokens.js`
- `tests/messaging.*.test.mjs` + `tests/fixtures/{evolution,meta-wa,meta-fb,meta-ig}.*.json`

**Backend modificados:**
- `prisma/schema.prisma`
- `src/routes/webhookEvolution.js` (refator thin handler)
- `src/routes/inbox.js` (filtro channel + lastInboundAt + link-customer Meta)
- `src/server.js` (registrar rotas + import messaging/index)

**Frontend criados:**
- `src/views/admin/MetaPlatformConfig.vue`
- `src/views/settings/MetaIntegrations.vue`
- `src/components/inbox/ChannelBadge.vue`

**Frontend modificados:**
- `src/views/inbox/{ConversationItem,ConversationList,ChatPanel}.vue`
- `src/stores/inbox.js`
- `src/router.js`
- Menus de navegação (admin + settings)
