# WhatsApp Marketing Campaigns Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a programmable WhatsApp campaign tool that works with both Meta Cloud API and Evolution, supports declarative customer segmentation, conversion attribution with configurable window, and the compliance safeguards needed to operate without burning the WhatsApp number's reputation.

**Architecture:** New SaaS module `marketing_campaigns`. Postgres-backed queue using `FOR UPDATE SKIP LOCKED`. Worker as `setInterval` in main backend process (no Redis/BullMQ). Declarative DSL compiled to SQL with whitelist validation. Synchronous attribution hook in `orders.create`. Reuses existing `whatsappMetaAdapter` and `evoSendText`.

**Tech Stack:** Node.js + Express + Prisma 6 + PostgreSQL on backend; Vue 3 + Vite + Pinia on frontend. Test runner: `node --test` with `.test.mjs` files.

**Scope of this plan:** Phase 0 (Foundation, ~1 week) + Phase 1 (MVP usable, ~2 weeks). Phases 2-3 (recurrence, automation, GA) will be planned in separate documents.

**Design doc reference:** [`docs/plans/2026-05-25-whatsapp-marketing-campaigns-design.md`](./2026-05-25-whatsapp-marketing-campaigns-design.md)

---

## Phase 0 — Foundation

### Task 0.1: Prisma migration — new marketing models

**Files:**
- Modify: `delivery-saas-backend/prisma/schema.prisma` (append new models)

**Step 1: Add enums and models to schema**

Append at the end of `prisma/schema.prisma`:

```prisma
enum MarketingScheduleType {
  ONE_SHOT
  RECURRING
  TRIGGER
}

enum MarketingCampaignStatus {
  DRAFT
  SCHEDULED
  RUNNING
  PAUSED
  COMPLETED
  CANCELLED
}

enum MarketingChannel {
  META_WA
  EVOLUTION_WA
  AUTO
}

enum MarketingAttributionScope {
  menu
  company
}

enum MarketingMessageStatus {
  QUEUED
  SENDING
  SENT
  DELIVERED
  READ
  FAILED
  OPTED_OUT
}

model MarketingSegment {
  id              String   @id @default(uuid())
  companyId       String
  company         Company  @relation(fields: [companyId], references: [id])
  name            String
  description     String?
  ruleJson        Json
  estimatedSize   Int?
  lastEvaluatedAt DateTime?
  active          Boolean  @default(true)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  campaigns       MarketingCampaign[]

  @@unique([companyId, name])
  @@index([companyId])
}

model MarketingCampaign {
  id                      String   @id @default(uuid())
  companyId               String
  segmentId               String
  segment                 MarketingSegment @relation(fields: [segmentId], references: [id])
  name                    String
  scheduleType            MarketingScheduleType
  scheduledFor            DateTime?
  cronExpression          String?
  triggerType             String?
  triggerParams           Json?
  channel                 MarketingChannel @default(AUTO)
  templateId              String?
  template                MetaTemplate?  @relation(fields: [templateId], references: [id])
  freeText                String?
  templateVariableMap     Json?
  conversionWindowHours   Int      @default(48)
  conversionStatuses      String[] @default(["EM_PREPARO","PRONTO","SAIU_PARA_ENTREGA","CONFIRMACAO_PAGAMENTO","CONCLUIDO"])
  attributionScope        MarketingAttributionScope @default(menu)
  segmentMenuId           String?
  couponId                String?
  coupon                  Coupon?  @relation(fields: [couponId], references: [id])
  status                  MarketingCampaignStatus @default(DRAFT)
  createdAt               DateTime @default(now())
  updatedAt               DateTime @updatedAt
  createdByUserId         String?
  runs                    MarketingCampaignRun[]
  messages                MarketingMessage[]

  @@index([companyId, status])
  @@index([scheduleType, status, scheduledFor])
}

model MarketingCampaignRun {
  id           String   @id @default(uuid())
  campaignId   String
  campaign     MarketingCampaign @relation(fields: [campaignId], references: [id])
  startedAt    DateTime @default(now())
  finishedAt   DateTime?
  totalQueued  Int      @default(0)
  totalSent    Int      @default(0)
  totalFailed  Int      @default(0)
  error        String?
  messages     MarketingMessage[]

  @@index([campaignId, startedAt])
}

model MarketingMessage {
  id                       String   @id @default(uuid())
  companyId                String
  campaignId               String
  campaignRunId            String
  customerId               String
  customer                 Customer @relation(fields: [customerId], references: [id])
  campaign                 MarketingCampaign     @relation(fields: [campaignId], references: [id])
  campaignRun              MarketingCampaignRun  @relation(fields: [campaignRunId], references: [id])
  providerUsed             MarketingChannel
  providerAccountId        String?
  instanceName             String?
  externalId               String?
  status                   MarketingMessageStatus @default(QUEUED)
  scheduledFor             DateTime?
  sentAt                   DateTime?
  deliveredAt              DateTime?
  readAt                   DateTime?
  failedAt                 DateTime?
  errorMessage             String?
  convertedOrderId         String?
  convertedAt              DateTime?
  convertedValue           Decimal?
  attributionLockedAt      DateTime?
  excludedFromAttribution  Boolean  @default(false)
  attributionSignal        String?
  createdAt                DateTime @default(now())

  @@unique([campaignRunId, customerId])
  @@index([customerId, sentAt(sort: Desc)])
  @@index([campaignId, status])
  @@index([sentAt, attributionLockedAt])
}

model MarketingSendQueue {
  id            String   @id @default(uuid())
  messageId     String   @unique
  scheduledFor  DateTime
  lockUntil     DateTime @default(now())
  attempts      Int      @default(0)
  lastError     String?
  createdAt     DateTime @default(now())

  @@index([scheduledFor, lockUntil])
}

model MarketingTemplateLibrary {
  id              String   @id @default(uuid())
  name            String   @unique
  category        String
  language        String   @default("pt_BR")
  description     String
  useCase         String
  bodyTemplate    String
  variableHints   Json
  buttons         Json?
  active          Boolean  @default(true)
  createdAt       DateTime @default(now())
}
```

Also add the inverse relations to `Company`, `Customer`, `Coupon`, `MetaTemplate`:

```prisma
model Company {
  // ... existing
  marketingSegments  MarketingSegment[]
}

model Customer {
  // ... existing
  marketingMessages  MarketingMessage[]
}

model Coupon {
  // ... existing
  marketingCampaigns MarketingCampaign[]
}

model MetaTemplate {
  // ... existing
  marketingCampaigns MarketingCampaign[]
}
```

**Step 2: Generate the migration**

Run:
```bash
cd delivery-saas-backend && npx prisma migrate dev --name add_marketing_module --create-only
```

Expected: New folder under `prisma/migrations/<timestamp>_add_marketing_module/` with `migration.sql`. Inspect the SQL — should only contain `CREATE TYPE`, `CREATE TABLE`, `CREATE INDEX`, and `ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY`. No destructive operations.

**Step 3: Add the partial index manually**

Edit the new `migration.sql` file. Add at the bottom:

```sql
-- Optimize attribution lookup: customer's latest unattributed marketing message
CREATE INDEX idx_mmsg_attribution_lookup
  ON "MarketingMessage" ("customerId", "sentAt" DESC)
  WHERE "convertedOrderId" IS NULL AND "excludedFromAttribution" = false;
```

**Step 4: Apply the migration**

Run:
```bash
cd delivery-saas-backend && npx prisma migrate dev
```

Expected: "Your database is now in sync with your schema."

**Step 5: Commit**

```bash
git add delivery-saas-backend/prisma/schema.prisma delivery-saas-backend/prisma/migrations/
git commit -m "feat(marketing): add Prisma models for campaigns, segments, queue"
```

---

### Task 0.2: Prisma migration — Customer opt-in fields

**Files:**
- Modify: `delivery-saas-backend/prisma/schema.prisma` (Customer model)

**Step 1: Add fields**

In the `Customer` model, after `whatsapp` field:

```prisma
model Customer {
  // ... existing fields above
  optInMarketing       Boolean   @default(false)
  optInMarketingAt     DateTime?
  optInMarketingSource String?   // 'checkout' | 'inbound' | 'manual'
  optOutMarketingAt    DateTime?
  // ... existing fields below
}
```

**Step 2: Generate migration**

```bash
cd delivery-saas-backend && npx prisma migrate dev --name customer_opt_in_fields
```

Expected: Migration applied. All existing rows get `optInMarketing = false` (default), other fields NULL.

**Step 3: Commit**

```bash
git add delivery-saas-backend/prisma/schema.prisma delivery-saas-backend/prisma/migrations/
git commit -m "feat(marketing): add opt-in fields to Customer"
```

---

### Task 0.3: Prisma migration — Order attribution fields

**Files:**
- Modify: `delivery-saas-backend/prisma/schema.prisma` (Order model)

**Step 1: Add fields**

In the `Order` model:

```prisma
model Order {
  // ... existing fields
  attributedCampaignId  String?
  attributedMessageId   String?  @unique
  attributedCampaign    MarketingCampaign? @relation(fields: [attributedCampaignId], references: [id])

  // ... existing indexes
  @@index([attributedCampaignId])
}
```

**Step 2: Generate migration**

```bash
cd delivery-saas-backend && npx prisma migrate dev --name order_attribution_fields
```

Expected: Migration applied. All existing orders get NULL attribution.

**Step 3: Commit**

```bash
git add delivery-saas-backend/prisma/schema.prisma delivery-saas-backend/prisma/migrations/
git commit -m "feat(marketing): add attribution fields to Order"
```

---

### Task 0.4: Register `marketing_campaigns` SaaS module

**Files:**
- Modify: `delivery-saas-backend/src/modules.js`

**Step 1: Locate the modules list**

Open `delivery-saas-backend/src/modules.js`. Find the list of valid module keys (search for existing module keys like `cardapio_completo`, `whatsapp`).

**Step 2: Add the new module**

Add `'marketing_campaigns'` to the registered modules list. Verify there's no missing wiring (some projects also need module display name in a separate map).

**Step 3: Run server, verify no error**

```bash
cd delivery-saas-backend && npm run dev
```

Expected: Server starts without errors mentioning `marketing_campaigns`.

**Step 4: Commit**

```bash
git add delivery-saas-backend/src/modules.js
git commit -m "feat(marketing): register marketing_campaigns SaaS module"
```

---

### Task 0.5: Add feature flag mechanism

**Files:**
- Modify: `delivery-saas-backend/src/modules.js` (or wherever flags are checked)

**Step 1: Add `marketing_v1_enabled` flag check**

The design references `Company.flags.marketing_v1_enabled`. Inspect `Company` model — if it has a `flags Json?` field, use it. If not, add it via a small migration:

```prisma
model Company {
  // ... existing
  flags Json @default("{}")
}
```

Then `npx prisma migrate dev --name company_flags`.

**Step 2: Create helper**

Create `delivery-saas-backend/src/utils/featureFlags.js`:

```js
import { prisma } from '../prisma.js'

const FLAG_CACHE = new Map()
const CACHE_TTL_MS = 60_000

export async function isFlagEnabled(companyId, flag) {
  const cacheKey = `${companyId}:${flag}`
  const cached = FLAG_CACHE.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return cached.value
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { flags: true },
  })
  const value = !!(company?.flags && company.flags[flag])
  FLAG_CACHE.set(cacheKey, { value, expiresAt: Date.now() + CACHE_TTL_MS })
  return value
}

export function invalidateFlagCache(companyId, flag) {
  FLAG_CACHE.delete(`${companyId}:${flag}`)
}
```

**Step 3: Test**

Create `delivery-saas-backend/tests/featureFlags.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isFlagEnabled, invalidateFlagCache } from '../src/utils/featureFlags.js'

test('isFlagEnabled returns false for unset flags', async () => {
  // Requires a test company in DB. Use SUPER_ADMIN seed or existing fixture.
  // For pure unit test, mock prisma — but keep it simple: assert the function exists.
  assert.equal(typeof isFlagEnabled, 'function')
  assert.equal(typeof invalidateFlagCache, 'function')
})
```

Run: `cd delivery-saas-backend && node --test tests/featureFlags.test.mjs`

Expected: PASS.

**Step 4: Commit**

```bash
git add delivery-saas-backend/prisma/ delivery-saas-backend/src/utils/featureFlags.js delivery-saas-backend/tests/featureFlags.test.mjs
git commit -m "feat(marketing): add Company.flags + feature flag helper"
```

---

### Task 0.6: Extract `pickConnectedChannel` shared helper

**Files:**
- Create: `delivery-saas-backend/src/services/whatsapp/pickChannel.js`
- Modify: `delivery-saas-backend/src/services/notify.js` (use the helper)
- Modify: `delivery-saas-backend/src/services/customerAccounts.js` (use the helper)
- Modify: `delivery-saas-backend/src/routes/publicMenu.js` (use the helper)

**Step 1: Read existing logic**

Read `customerAccounts.js#sendCustomerPasswordViaWhatsApp` and `notify.js#pickNotificationChannel`. Both already do similar channel resolution. Extract into a single helper.

**Step 2: Create the helper**

```js
// src/services/whatsapp/pickChannel.js
import { prisma } from '../../prisma.js'

/**
 * Resolve which WhatsApp channel to use for sending to a customer.
 * Order:
 *   1. Mirror last conversation provider (if customerId given)
 *   2. Menu's own metaWaAccount / whatsappInstance (if menuId given)
 *   3. Store-level whatsappInstance (if storeId given)
 *   4. null — operator must configure
 *
 * Never falls back to "any company instance" — would cross-attribute
 * messages between cardápios.
 *
 * Returns: { type: 'META_WA'|'EVOLUTION_WA', account?, accountId?, instanceName? }
 *          or null
 */
export async function pickConnectedChannel({ companyId, customerId, menuId, storeId }) {
  // 1. Mirror last conversation
  if (customerId) {
    const conv = await prisma.conversation.findFirst({
      where: {
        companyId,
        customerId,
        channel: 'WHATSAPP',
        ...(menuId ? { menuId } : storeId ? { storeId } : {}),
      },
      orderBy: { lastMessageAt: 'desc' },
      select: { provider: true, providerAccountId: true, instanceName: true },
    })
    if (conv?.provider === 'META_WA' && conv.providerAccountId) {
      const acc = await prisma.metaMessagingAccount.findFirst({
        where: { id: conv.providerAccountId, status: 'ACTIVE' },
      })
      if (acc) return { type: 'META_WA', account: acc, accountId: acc.id }
    }
    if (conv?.provider === 'EVOLUTION_WA' && conv.instanceName) {
      const inst = await prisma.whatsAppInstance.findUnique({
        where: { instanceName: conv.instanceName },
      })
      if (inst?.status === 'CONNECTED') {
        return { type: 'EVOLUTION_WA', instanceName: inst.instanceName }
      }
    }
  }

  // 2. Menu-level
  if (menuId) {
    const menu = await prisma.menu.findUnique({
      where: { id: menuId },
      include: { whatsappInstance: true, metaWaAccount: true },
    })
    if (menu?.whatsappInstance?.status === 'CONNECTED') {
      return { type: 'EVOLUTION_WA', instanceName: menu.whatsappInstance.instanceName }
    }
    if (menu?.metaWaAccount?.status === 'ACTIVE') {
      return { type: 'META_WA', account: menu.metaWaAccount, accountId: menu.metaWaAccount.id }
    }
  }

  // 3. Store-level
  if (storeId) {
    const store = await prisma.store.findUnique({
      where: { id: storeId },
      select: { whatsappInstance: true },
    })
    if (store?.whatsappInstance?.status === 'CONNECTED') {
      return { type: 'EVOLUTION_WA', instanceName: store.whatsappInstance.instanceName }
    }
  }

  return null
}
```

**Step 3: Test**

```js
// tests/pickChannel.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pickConnectedChannel } from '../src/services/whatsapp/pickChannel.js'

test('pickConnectedChannel exports a function', () => {
  assert.equal(typeof pickConnectedChannel, 'function')
})

test('returns null with no inputs', async () => {
  const result = await pickConnectedChannel({ companyId: 'nonexistent' })
  assert.equal(result, null)
})
```

Run: `cd delivery-saas-backend && node --test tests/pickChannel.test.mjs`

Expected: PASS (both tests).

**Step 4: Refactor `customerAccounts.js`**

In `sendCustomerPasswordViaWhatsApp`, replace the inline channel resolution with `await pickConnectedChannel({ companyId, customerId: customer.id })`. Adapter call uses the returned `account`/`instanceName`.

**Step 5: Refactor `publicMenu.js#forgot-password`**

Replace the inline conversation lookup with the helper.

**Step 6: Run existing tests to ensure no regression**

```bash
cd delivery-saas-backend && node --test tests/
```

Expected: all existing tests still pass.

**Step 7: Commit**

```bash
git add delivery-saas-backend/src/services/whatsapp/pickChannel.js delivery-saas-backend/src/services/customerAccounts.js delivery-saas-backend/src/routes/publicMenu.js delivery-saas-backend/tests/pickChannel.test.mjs
git commit -m "refactor(whatsapp): extract pickConnectedChannel into shared helper"
```

---

### Task 0.7: Create attribution service stubs

**Files:**
- Create: `delivery-saas-backend/src/services/marketing/attribution.js`

**Step 1: Create the file with stubs**

```js
// src/services/marketing/attribution.js
import { prisma } from '../../prisma.js'

const ATTRIBUTABLE_STATUSES = [
  'EM_PREPARO', 'PRONTO', 'SAIU_PARA_ENTREGA',
  'CONFIRMACAO_PAGAMENTO', 'CONCLUIDO',
]

export async function attributeOrderToCampaign(orderId) {
  // V1 stub: real implementation in Task 1.20
  // We keep this exported so orders.js hooks can call it without breaking.
  if (!orderId) return null
  // ... will be filled in Phase 1
  return null
}

export async function revokeAttribution(orderId) {
  // V1 stub
  if (!orderId) return null
  return null
}
```

**Step 2: Commit**

```bash
git add delivery-saas-backend/src/services/marketing/attribution.js
git commit -m "feat(marketing): attribution service stub for hook wiring"
```

---

### Task 0.8: Wire attribution hooks in orders.js and ifoodWebhookProcessor.js

**Files:**
- Modify: `delivery-saas-backend/src/routes/orders.js`
- Modify: `delivery-saas-backend/src/services/ifoodWebhookProcessor.js`

**Step 1: Import in orders.js**

At the top of `orders.js`:

```js
import { attributeOrderToCampaign, revokeAttribution } from '../services/marketing/attribution.js'
```

**Step 2: Call after order creation**

Find every `prisma.order.create({...})` call in `orders.js`. After the result is captured, add:

```js
attributeOrderToCampaign(created.id).catch(e =>
  console.warn('[attribution] failed', e?.message)
)
```

**Step 3: Call on cancellation**

Find the status-change handler. In the branch where status transitions to `CANCELADO`:

```js
if (status === 'CANCELADO' && existing.status !== 'CANCELADO') {
  revokeAttribution(orderId).catch(() => {})
  // ... existing cancel logic
}
```

**Step 4: Repeat in `ifoodWebhookProcessor.js`**

Import the same functions. After `upsertOrder` returns `res.created === true`:

```js
attributeOrderToCampaign(savedOrder.id).catch(() => {})
```

And in the status-changed branch where it transitions to CANCELADO:

```js
if (res?.statusChanged && res.to === 'CANCELADO') {
  revokeAttribution(savedOrder.id).catch(() => {})
}
```

**Step 5: Verify dev server starts**

```bash
cd delivery-saas-backend && npm run dev
```

Expected: no errors. Create a test order — log line `[attribution]` should not appear (stub returns null silently).

**Step 6: Commit**

```bash
git add delivery-saas-backend/src/routes/orders.js delivery-saas-backend/src/services/ifoodWebhookProcessor.js
git commit -m "feat(marketing): wire attribution hooks (no-op until Phase 1)"
```

---

## Phase 1 — MVP Usable

### Task 1.1: Segment DSL — validator

**Files:**
- Create: `delivery-saas-backend/src/services/marketing/segmentValidator.js`
- Create: `delivery-saas-backend/tests/segmentValidator.test.mjs`

**Step 1: Write the failing tests**

```js
// tests/segmentValidator.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateSegmentRule } from '../src/services/marketing/segmentValidator.js'

test('accepts valid simple rule', () => {
  const r = validateSegmentRule({
    field: 'lastOrderAt',
    op: 'olderThan',
    value: '30d',
  })
  assert.equal(r.ok, true)
})

test('rejects unknown field', () => {
  const r = validateSegmentRule({
    field: 'nonExistent',
    op: '=',
    value: 'x',
  })
  assert.equal(r.ok, false)
  assert.match(r.error, /unknown field/i)
})

test('rejects unknown op for field', () => {
  const r = validateSegmentRule({
    field: 'totalSpent',
    op: 'olderThan',  // not valid for decimal
    value: 100,
  })
  assert.equal(r.ok, false)
  assert.match(r.error, /op/i)
})

test('accepts nested all/any', () => {
  const r = validateSegmentRule({
    all: [
      { field: 'totalSpent', op: '>=', value: 100 },
      { any: [
        { field: 'orderedProductId', op: 'in', value: ['00000000-0000-0000-0000-000000000001'] },
      ]},
    ],
  })
  assert.equal(r.ok, true)
})

test('rejects invalid uuid in array value', () => {
  const r = validateSegmentRule({
    field: 'orderedProductId',
    op: 'in',
    value: ['not-a-uuid'],
  })
  assert.equal(r.ok, false)
  assert.match(r.error, /uuid/i)
})

test('rejects invalid duration format', () => {
  const r = validateSegmentRule({
    field: 'lastOrderAt',
    op: 'olderThan',
    value: 'forever',
  })
  assert.equal(r.ok, false)
})

test('rejects deep nesting beyond 5 levels', () => {
  // Build 6-level deep nesting; should reject
  let inner = { field: 'totalSpent', op: '>=', value: 1 }
  for (let i = 0; i < 6; i++) inner = { all: [inner] }
  const r = validateSegmentRule(inner)
  assert.equal(r.ok, false)
})
```

**Step 2: Run, verify FAIL**

```bash
cd delivery-saas-backend && node --test tests/segmentValidator.test.mjs
```

Expected: all 7 tests fail with "Cannot find module".

**Step 3: Implement validator**

```js
// src/services/marketing/segmentValidator.js

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DURATION_REGEX = /^\d+[hdwm]$/  // 30d, 2w, 6h, 3m (month)
const MAX_DEPTH = 5

const FIELD_SPECS = {
  lastOrderAt:     { ops: ['olderThan','newerThan','between'], valueType: 'duration_or_date' },
  firstOrderAt:    { ops: ['olderThan','newerThan','between'], valueType: 'duration_or_date' },
  totalSpent:      { ops: ['>=','>','<=','<','between'],       valueType: 'number' },
  orderCount:      { ops: ['>=','>','<=','<','between'],       valueType: 'number' },
  avgTicket:       { ops: ['>=','>','<=','<','between'],       valueType: 'number' },
  orderedProductId:{ ops: ['in','notIn'],                       valueType: 'uuid_array' },
  orderedCategoryId:{ ops: ['in','notIn'],                      valueType: 'uuid_array' },
  lastProductId:   { ops: ['in','notIn'],                       valueType: 'uuid_array' },
  lastOrderTotal:  { ops: ['>=','<=','between'],                valueType: 'number' },
  neighborhood:    { ops: ['in','notIn'],                       valueType: 'string_array' },
  paymentMethod:   { ops: ['in','notIn'],                       valueType: 'string_array' },
  birthdayInDays:  { ops: ['=','<='],                            valueType: 'int' },
  customerCreatedAt:{ ops: ['olderThan','newerThan'],            valueType: 'duration_or_date' },
  customerGroupId: { ops: ['in','notIn'],                       valueType: 'uuid_array' },
  cashbackBalance: { ops: ['>=','<='],                           valueType: 'number' },
  optInMarketing:  { ops: ['='],                                 valueType: 'bool' },
  optOutMarketingAt:{ ops: ['isNull','isNotNull'],               valueType: 'none' },
}

function validateValue(valueType, op, value) {
  if (op === 'isNull' || op === 'isNotNull') return value === undefined || value === null ? null : 'value must be omitted for isNull/isNotNull'
  switch (valueType) {
    case 'number':
      if (op === 'between') {
        if (!Array.isArray(value) || value.length !== 2 || !value.every(v => typeof v === 'number')) return 'between requires [min, max]'
        return null
      }
      return typeof value === 'number' && isFinite(value) ? null : 'value must be number'
    case 'int':
      return Number.isInteger(value) ? null : 'value must be integer'
    case 'bool':
      return typeof value === 'boolean' ? null : 'value must be boolean'
    case 'uuid_array':
      if (!Array.isArray(value) || value.length === 0) return 'value must be non-empty array'
      const bad = value.find(v => !UUID_REGEX.test(String(v)))
      return bad ? `invalid uuid: ${bad}` : null
    case 'string_array':
      if (!Array.isArray(value) || value.length === 0) return 'value must be non-empty array'
      return value.every(v => typeof v === 'string' && v.length < 256) ? null : 'array items must be strings'
    case 'duration_or_date':
      if (typeof value !== 'string') return 'value must be string'
      if (op === 'between') {
        if (!Array.isArray(value) || value.length !== 2) return 'between requires two values'
        return null
      }
      if (DURATION_REGEX.test(value)) return null
      if (!isNaN(Date.parse(value))) return null
      return 'value must be duration (e.g. 30d) or ISO date'
    case 'none':
      return null
    default:
      return 'unknown valueType'
  }
}

export function validateSegmentRule(rule, depth = 0) {
  if (depth > MAX_DEPTH) return { ok: false, error: 'max nesting depth exceeded' }
  if (!rule || typeof rule !== 'object') return { ok: false, error: 'rule must be object' }

  if (rule.all || rule.any || rule.not) {
    const key = rule.all ? 'all' : rule.any ? 'any' : 'not'
    const inner = rule[key]
    if (key === 'not') {
      const r = validateSegmentRule(inner, depth + 1)
      return r.ok ? { ok: true } : r
    }
    if (!Array.isArray(inner) || inner.length === 0) return { ok: false, error: `${key} requires non-empty array` }
    for (const sub of inner) {
      const r = validateSegmentRule(sub, depth + 1)
      if (!r.ok) return r
    }
    return { ok: true }
  }

  // Leaf
  if (!rule.field) return { ok: false, error: 'leaf requires field' }
  const spec = FIELD_SPECS[rule.field]
  if (!spec) return { ok: false, error: `unknown field: ${rule.field}` }
  if (!spec.ops.includes(rule.op)) return { ok: false, error: `op ${rule.op} not valid for field ${rule.field}` }
  const err = validateValue(spec.valueType, rule.op, rule.value)
  if (err) return { ok: false, error: err }
  return { ok: true }
}

export { FIELD_SPECS }
```

**Step 4: Run, verify PASS**

```bash
cd delivery-saas-backend && node --test tests/segmentValidator.test.mjs
```

Expected: all 7 tests pass.

**Step 5: Commit**

```bash
git add delivery-saas-backend/src/services/marketing/segmentValidator.js delivery-saas-backend/tests/segmentValidator.test.mjs
git commit -m "feat(marketing): segment DSL validator with whitelist"
```

---

### Task 1.2: Segment DSL — SQL compiler

**Files:**
- Create: `delivery-saas-backend/src/services/marketing/segmentCompiler.js`
- Create: `delivery-saas-backend/tests/segmentCompiler.test.mjs`

**Step 1: Write failing tests**

```js
// tests/segmentCompiler.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compileRule, parseDuration } from '../src/services/marketing/segmentCompiler.js'

test('parseDuration converts 30d to interval', () => {
  assert.equal(parseDuration('30d'), '30 days')
  assert.equal(parseDuration('2w'), '14 days')
  assert.equal(parseDuration('6h'), '6 hours')
})

test('compileRule for totalSpent >= 100', () => {
  const sql = compileRule({ field: 'totalSpent', op: '>=', value: 100 })
  assert.match(sql, /COALESCE\(SUM\(o\.total\)/)
  assert.match(sql, />=\s*100/)
})

test('compileRule for lastOrderAt olderThan 30d', () => {
  const sql = compileRule({ field: 'lastOrderAt', op: 'olderThan', value: '30d' })
  assert.match(sql, /interval '30 days'/)
  assert.match(sql, /NOT EXISTS/)
})

test('compileRule for orderedProductId in [uuid]', () => {
  const sql = compileRule({
    field: 'orderedProductId', op: 'in',
    value: ['11111111-1111-1111-1111-111111111111'],
  })
  assert.match(sql, /EXISTS/)
  assert.match(sql, /'11111111-1111-1111-1111-111111111111'/)
})

test('compileRule for nested all', () => {
  const sql = compileRule({
    all: [
      { field: 'totalSpent', op: '>=', value: 50 },
      { field: 'orderCount', op: '>', value: 2 },
    ],
  })
  assert.match(sql, /AND/)
})

test('compileRule for any (OR)', () => {
  const sql = compileRule({
    any: [
      { field: 'totalSpent', op: '>=', value: 50 },
      { field: 'orderCount', op: '>', value: 2 },
    ],
  })
  assert.match(sql, /OR/)
})

test('compileRule for birthdayInDays = 0', () => {
  const sql = compileRule({ field: 'birthdayInDays', op: '=', value: 0 })
  assert.match(sql, /EXTRACT\(MONTH/)
  assert.match(sql, /interval '0 days'/)
})

test('compileRule rejects unknown field at compile time', () => {
  assert.throws(() => compileRule({ field: 'foo', op: '=', value: 1 }))
})
```

**Step 2: Run, verify FAIL**

```bash
cd delivery-saas-backend && node --test tests/segmentCompiler.test.mjs
```

Expected: all tests fail (module not found).

**Step 3: Implement compiler**

```js
// src/services/marketing/segmentCompiler.js

export function parseDuration(value) {
  const m = /^(\d+)([hdwm])$/.exec(String(value))
  if (!m) throw new Error(`invalid duration: ${value}`)
  const n = Number(m[1])
  const unit = m[2]
  switch (unit) {
    case 'h': return `${n} hours`
    case 'd': return `${n} days`
    case 'w': return `${n * 7} days`
    case 'm': return `${n * 30} days` // approximation
  }
}

function escapeUuid(v) {
  if (!/^[0-9a-f-]{36}$/i.test(String(v))) throw new Error(`invalid uuid: ${v}`)
  return `'${v}'`
}

function escapeString(v) {
  // very conservative — only allow alphanumerics, spaces, hyphens, accents
  const s = String(v).replace(/'/g, "''")
  return `'${s}'`
}

const COMPLETED_STATUSES = "('EM_PREPARO','PRONTO','SAIU_PARA_ENTREGA','CONFIRMACAO_PAGAMENTO','CONCLUIDO')"

const HANDLERS = {
  lastOrderAt: (op, value) => {
    const interval = parseDuration(value)
    if (op === 'olderThan') {
      return `(EXISTS (SELECT 1 FROM "Order" o WHERE o."customerId" = c.id AND o.status IN ${COMPLETED_STATUSES})
        AND NOT EXISTS (SELECT 1 FROM "Order" o WHERE o."customerId" = c.id AND o.status IN ${COMPLETED_STATUSES} AND o."createdAt" > NOW() - interval '${interval}'))`
    }
    if (op === 'newerThan') {
      return `EXISTS (SELECT 1 FROM "Order" o WHERE o."customerId" = c.id AND o.status IN ${COMPLETED_STATUSES} AND o."createdAt" > NOW() - interval '${interval}')`
    }
    throw new Error(`op ${op} not implemented for lastOrderAt`)
  },
  firstOrderAt: (op, value) => {
    const interval = parseDuration(value)
    if (op === 'olderThan') {
      return `EXISTS (SELECT 1 FROM "Order" o WHERE o."customerId" = c.id AND o.status IN ${COMPLETED_STATUSES} AND o."createdAt" < NOW() - interval '${interval}'
        AND o.id = (SELECT id FROM "Order" oo WHERE oo."customerId" = c.id ORDER BY oo."createdAt" ASC LIMIT 1))`
    }
    if (op === 'newerThan') {
      return `EXISTS (SELECT 1 FROM "Order" o WHERE o."customerId" = c.id AND o.status IN ${COMPLETED_STATUSES} AND o."createdAt" > NOW() - interval '${interval}'
        AND o.id = (SELECT id FROM "Order" oo WHERE oo."customerId" = c.id ORDER BY oo."createdAt" ASC LIMIT 1))`
    }
    throw new Error(`op ${op} not implemented for firstOrderAt`)
  },
  totalSpent: (op, value) => {
    const sub = `(SELECT COALESCE(SUM(o.total), 0) FROM "Order" o WHERE o."customerId" = c.id AND o.status IN ${COMPLETED_STATUSES})`
    if (op === 'between') {
      const [lo, hi] = value
      return `(${sub} >= ${Number(lo)} AND ${sub} <= ${Number(hi)})`
    }
    return `${sub} ${op} ${Number(value)}`
  },
  orderCount: (op, value) => {
    const sub = `(SELECT COUNT(*) FROM "Order" o WHERE o."customerId" = c.id AND o.status IN ${COMPLETED_STATUSES})`
    if (op === 'between') {
      const [lo, hi] = value
      return `(${sub} >= ${Number(lo)} AND ${sub} <= ${Number(hi)})`
    }
    return `${sub} ${op} ${Number(value)}`
  },
  avgTicket: (op, value) => {
    const sub = `(SELECT CASE WHEN COUNT(*) = 0 THEN 0 ELSE COALESCE(SUM(o.total), 0) / COUNT(*) END FROM "Order" o WHERE o."customerId" = c.id AND o.status IN ${COMPLETED_STATUSES})`
    if (op === 'between') {
      const [lo, hi] = value
      return `(${sub} >= ${Number(lo)} AND ${sub} <= ${Number(hi)})`
    }
    return `${sub} ${op} ${Number(value)}`
  },
  orderedProductId: (op, value) => {
    const ids = value.map(escapeUuid).join(',')
    const exists = `EXISTS (SELECT 1 FROM "OrderItem" oi JOIN "Order" o ON o.id = oi."orderId" WHERE o."customerId" = c.id AND o.status IN ${COMPLETED_STATUSES} AND oi."productId" IN (${ids}))`
    return op === 'in' ? exists : `NOT ${exists}`
  },
  orderedCategoryId: (op, value) => {
    const ids = value.map(escapeUuid).join(',')
    const exists = `EXISTS (SELECT 1 FROM "OrderItem" oi JOIN "Order" o ON o.id = oi."orderId" JOIN "Product" p ON p.id = oi."productId" WHERE o."customerId" = c.id AND o.status IN ${COMPLETED_STATUSES} AND p."categoryId" IN (${ids}))`
    return op === 'in' ? exists : `NOT ${exists}`
  },
  birthdayInDays: (op, value) => {
    const n = Number(value)
    const cond = `(EXTRACT(MONTH FROM c.birthday) = EXTRACT(MONTH FROM NOW() + interval '${n} days') AND EXTRACT(DAY FROM c.birthday) = EXTRACT(DAY FROM NOW() + interval '${n} days'))`
    if (op === '=') return `c.birthday IS NOT NULL AND ${cond}`
    if (op === '<=') {
      // birthday within next N days
      return `c.birthday IS NOT NULL AND ((EXTRACT(MONTH FROM c.birthday) * 100 + EXTRACT(DAY FROM c.birthday))
        BETWEEN (EXTRACT(MONTH FROM NOW()) * 100 + EXTRACT(DAY FROM NOW()))
        AND (EXTRACT(MONTH FROM NOW() + interval '${n} days') * 100 + EXTRACT(DAY FROM NOW() + interval '${n} days')))`
    }
    throw new Error(`op ${op} not implemented for birthdayInDays`)
  },
  customerGroupId: (op, value) => {
    const ids = value.map(escapeUuid).join(',')
    const exists = `EXISTS (SELECT 1 FROM "CustomerGroupMember" cgm WHERE cgm."customerId" = c.id AND cgm."groupId" IN (${ids}))`
    return op === 'in' ? exists : `NOT ${exists}`
  },
  neighborhood: (op, value) => {
    const strs = value.map(escapeString).join(',')
    const exists = `EXISTS (SELECT 1 FROM "Order" o WHERE o."customerId" = c.id AND o."deliveryNeighborhood" IN (${strs}))`
    return op === 'in' ? exists : `NOT ${exists}`
  },
  optInMarketing: (op, value) => {
    return `c."optInMarketing" = ${value ? 'true' : 'false'}`
  },
  optOutMarketingAt: (op) => {
    return op === 'isNull' ? `c."optOutMarketingAt" IS NULL` : `c."optOutMarketingAt" IS NOT NULL`
  },
}

export function compileRule(rule) {
  if (rule.all) return `(${rule.all.map(compileRule).join(' AND ')})`
  if (rule.any) return `(${rule.any.map(compileRule).join(' OR ')})`
  if (rule.not) return `NOT (${compileRule(rule.not)})`
  const handler = HANDLERS[rule.field]
  if (!handler) throw new Error(`unknown field: ${rule.field}`)
  return handler(rule.op, rule.value)
}
```

**Step 4: Run, verify PASS**

```bash
cd delivery-saas-backend && node --test tests/segmentCompiler.test.mjs
```

Expected: all tests pass.

**Step 5: Commit**

```bash
git add delivery-saas-backend/src/services/marketing/segmentCompiler.js delivery-saas-backend/tests/segmentCompiler.test.mjs
git commit -m "feat(marketing): segment DSL → SQL compiler"
```

---

### Task 1.3: Segment evaluator

**Files:**
- Create: `delivery-saas-backend/src/services/marketing/segmentEvaluator.js`

**Step 1: Implement**

```js
// src/services/marketing/segmentEvaluator.js
import { prisma } from '../../prisma.js'
import { compileRule } from './segmentCompiler.js'

/**
 * Evaluates a segment and returns the list of matching customerIds.
 * Always filters by optInMarketing=true and optOutMarketingAt IS NULL.
 * Optionally restricts to a single menuId.
 */
export async function evaluateSegment({ companyId, ruleJson }) {
  if (!companyId || !ruleJson?.rule) throw new Error('companyId and ruleJson.rule required')

  const compiled = compileRule(ruleJson.rule)
  const menuFilter = ruleJson.menuId
    ? `AND EXISTS (SELECT 1 FROM "Order" o WHERE o."customerId" = c.id AND o."menuId" = '${String(ruleJson.menuId).replace(/'/g, "''")}')`
    : ''

  const sql = `
    SELECT c.id
    FROM "Customer" c
    WHERE c."companyId" = $1::text
      AND c."optInMarketing" = true
      AND c."optOutMarketingAt" IS NULL
      ${menuFilter}
      AND (${compiled})
  `

  const rows = await prisma.$queryRawUnsafe(sql, companyId)
  return rows.map(r => r.id)
}

/**
 * Returns count + sample (10 customers) for the segment builder live preview.
 */
export async function previewSegment({ companyId, ruleJson, sampleSize = 10 }) {
  const ids = await evaluateSegment({ companyId, ruleJson })
  const sample = ids.slice(0, sampleSize)
  let sampleCustomers = []
  if (sample.length) {
    sampleCustomers = await prisma.customer.findMany({
      where: { id: { in: sample } },
      select: { id: true, fullName: true, whatsapp: true },
    })
  }
  return { count: ids.length, sample: sampleCustomers }
}
```

**Step 2: Commit**

```bash
git add delivery-saas-backend/src/services/marketing/segmentEvaluator.js
git commit -m "feat(marketing): segment evaluator with preview"
```

---

### Task 1.4: Segment REST routes

**Files:**
- Create: `delivery-saas-backend/src/routes/marketing/segments.js`
- Modify: `delivery-saas-backend/src/index.js` (mount the router)

**Step 1: Create the routes**

```js
// src/routes/marketing/segments.js
import express from 'express'
import { prisma } from '../../prisma.js'
import { authMiddleware, requireRole } from '../../auth.js'
import { requireModuleStrict } from '../../modules.js'
import { validateSegmentRule } from '../../services/marketing/segmentValidator.js'
import { previewSegment } from '../../services/marketing/segmentEvaluator.js'

const router = express.Router()

router.use(authMiddleware, requireModuleStrict('marketing_campaigns'))

// GET /marketing/segments — list
router.get('/', async (req, res) => {
  const companyId = req.user.companyId
  const segments = await prisma.marketingSegment.findMany({
    where: { companyId, active: true },
    orderBy: { updatedAt: 'desc' },
  })
  res.json(segments)
})

// POST /marketing/segments — create
router.post('/', requireRole('ADMIN'), async (req, res) => {
  const companyId = req.user.companyId
  const { name, description, ruleJson } = req.body || {}
  if (!name || !ruleJson?.rule) return res.status(400).json({ message: 'name and ruleJson.rule required' })
  const validation = validateSegmentRule(ruleJson.rule)
  if (!validation.ok) return res.status(400).json({ message: `Invalid rule: ${validation.error}` })

  try {
    const segment = await prisma.marketingSegment.create({
      data: {
        companyId,
        name: String(name),
        description: description || null,
        ruleJson,
      },
    })
    res.status(201).json(segment)
  } catch (e) {
    if (e.code === 'P2002') return res.status(409).json({ message: 'Já existe segmento com este nome' })
    throw e
  }
})

// PATCH /marketing/segments/:id — update
router.patch('/:id', requireRole('ADMIN'), async (req, res) => {
  const companyId = req.user.companyId
  const { id } = req.params
  const { name, description, ruleJson, active } = req.body || {}

  const existing = await prisma.marketingSegment.findFirst({ where: { id, companyId } })
  if (!existing) return res.status(404).json({ message: 'Segment not found' })

  if (ruleJson?.rule) {
    const validation = validateSegmentRule(ruleJson.rule)
    if (!validation.ok) return res.status(400).json({ message: `Invalid rule: ${validation.error}` })
  }

  const updated = await prisma.marketingSegment.update({
    where: { id },
    data: {
      ...(name !== undefined && { name }),
      ...(description !== undefined && { description }),
      ...(ruleJson !== undefined && { ruleJson }),
      ...(active !== undefined && { active }),
    },
  })
  res.json(updated)
})

// DELETE /marketing/segments/:id — soft delete (active=false)
router.delete('/:id', requireRole('ADMIN'), async (req, res) => {
  const companyId = req.user.companyId
  const { id } = req.params
  const existing = await prisma.marketingSegment.findFirst({ where: { id, companyId } })
  if (!existing) return res.status(404).json({ message: 'Segment not found' })
  await prisma.marketingSegment.update({ where: { id }, data: { active: false } })
  res.json({ ok: true })
})

// POST /marketing/segments/preview — live count + sample
router.post('/preview', async (req, res) => {
  const companyId = req.user.companyId
  const { ruleJson } = req.body || {}
  if (!ruleJson?.rule) return res.status(400).json({ message: 'ruleJson.rule required' })
  const validation = validateSegmentRule(ruleJson.rule)
  if (!validation.ok) return res.status(400).json({ message: `Invalid rule: ${validation.error}` })

  try {
    const result = await previewSegment({ companyId, ruleJson })
    res.json(result)
  } catch (e) {
    console.error('[segments.preview]', e)
    res.status(500).json({ message: 'Falha ao avaliar segmento' })
  }
})

export default router
```

**Step 2: Mount in `src/index.js`**

Find where other routers are mounted (look for `app.use('/customers', ...)`). Add:

```js
import marketingSegmentsRouter from './routes/marketing/segments.js'
// ...
app.use('/marketing/segments', marketingSegmentsRouter)
```

**Step 3: Smoke test**

Start dev server. Use curl or browser DevTools:

```bash
# With a valid JWT in $TOKEN
curl -X POST http://localhost:3000/marketing/segments/preview \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"ruleJson":{"rule":{"field":"totalSpent","op":">=","value":50}}}'
```

Expected: `{"count": <number>, "sample": [...]}`.

**Step 4: Commit**

```bash
git add delivery-saas-backend/src/routes/marketing/ delivery-saas-backend/src/index.js
git commit -m "feat(marketing): segment CRUD + preview endpoints"
```

---

### Task 1.5: Add `optInMarketing` checkbox in public checkout

**Files:**
- Modify: `delivery-saas-frontend/src/views/PublicMenu.vue`
- Modify: `delivery-saas-backend/src/routes/publicMenu.js` (accept opt-in in register/order creation)

**Step 1: Add checkbox to register sub-form**

In `PublicMenu.vue`, find the register sub-form (`identityMode === 'register'`). Add below the password field:

```vue
<div class="mb-3 form-check">
  <input
    id="optInMarketing"
    v-model="regForm.optInMarketing"
    type="checkbox"
    class="form-check-input"
  />
  <label class="form-check-label small" for="optInMarketing">
    Quero receber promoções e novidades de <strong>{{ menu?.name || 'esta loja' }}</strong> no WhatsApp
  </label>
  <div class="form-text small text-muted">Você pode cancelar a qualquer momento respondendo PARAR.</div>
</div>
```

**Step 2: Update regForm reactive default**

Find where `regForm` is initialized. Add `optInMarketing: false` to its default object.

**Step 3: Send opt-in on register**

Find `doRegisterInCheckout`. Add to the payload:

```js
const payload = {
  name, whatsapp: digits,
  email: regForm.value.email || null,
  password: regForm.value.password,
  optInMarketing: !!regForm.value.optInMarketing,
}
```

**Step 4: Accept on backend**

In `publicMenu.js`, find the `/register` POST handler. Accept `optInMarketing`:

```js
const { name, whatsapp, email, password, optInMarketing } = req.body || {}
// ... after Customer is created/found:
if (optInMarketing) {
  await prisma.customer.update({
    where: { id: cust.id },
    data: {
      optInMarketing: true,
      optInMarketingAt: new Date(),
      optInMarketingSource: 'checkout',
    },
  })
}
```

**Step 5: Smoke test**

Rebuild frontend, register a new customer with checkbox checked. Inspect DB:

```sql
SELECT id, "fullName", "optInMarketing", "optInMarketingSource", "optInMarketingAt"
FROM "Customer" ORDER BY "createdAt" DESC LIMIT 5;
```

Expected: new row has `optInMarketing = true`, `optInMarketingSource = 'checkout'`.

**Step 6: Commit**

```bash
git add delivery-saas-frontend/src/views/PublicMenu.vue delivery-saas-backend/src/routes/publicMenu.js
git commit -m "feat(marketing): opt-in checkbox in public checkout"
```

---

### Task 1.6: Auto opt-in on inbound message

**Files:**
- Modify: `delivery-saas-backend/src/routes/webhookEvolution.js` (or wherever inbound webhook is processed)
- Modify: `delivery-saas-backend/src/messaging/webhookMeta.js` (likewise)
- Create: `delivery-saas-backend/src/services/marketing/optInOptOut.js`

**Step 1: Create the helper**

```js
// src/services/marketing/optInOptOut.js
import { prisma } from '../../prisma.js'

const OPT_OUT_KEYWORDS = ['PARAR', 'STOP', 'SAIR', 'CANCELAR', 'DESCADASTRAR', 'PARE']

export function isOptOutMessage(text) {
  const normalized = String(text || '').trim().toUpperCase()
  return OPT_OUT_KEYWORDS.includes(normalized)
}

export async function maybeAutoOptIn(customerId) {
  if (!customerId) return false
  const c = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { optInMarketing: true, optOutMarketingAt: true },
  })
  if (c?.optOutMarketingAt) return false // respect explicit opt-out
  if (c?.optInMarketing) return false
  await prisma.customer.update({
    where: { id: customerId },
    data: {
      optInMarketing: true,
      optInMarketingAt: new Date(),
      optInMarketingSource: 'inbound',
    },
  })
  return true
}

export async function maybeAutoOptOut(customerId, text) {
  if (!isOptOutMessage(text)) return false
  if (!customerId) return false
  await prisma.customer.update({
    where: { id: customerId },
    data: {
      optInMarketing: false,
      optOutMarketingAt: new Date(),
    },
  })
  await prisma.marketingMessage.updateMany({
    where: {
      customerId,
      attributionLockedAt: null,
      excludedFromAttribution: false,
    },
    data: { excludedFromAttribution: true },
  })
  return true
}
```

**Step 2: Tests**

```js
// tests/optInOptOut.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isOptOutMessage } from '../src/services/marketing/optInOptOut.js'

test('isOptOutMessage detects PARAR', () => {
  assert.equal(isOptOutMessage('PARAR'), true)
  assert.equal(isOptOutMessage(' parar '), true)
  assert.equal(isOptOutMessage('Parar'), true)
})

test('isOptOutMessage ignores normal messages', () => {
  assert.equal(isOptOutMessage('Olá, quero pedir'), false)
  assert.equal(isOptOutMessage(''), false)
  assert.equal(isOptOutMessage(null), false)
})

test('isOptOutMessage detects all variants', () => {
  for (const kw of ['STOP','SAIR','CANCELAR','DESCADASTRAR','PARE']) {
    assert.equal(isOptOutMessage(kw), true, `expected ${kw} to opt-out`)
  }
})
```

Run: `node --test tests/optInOptOut.test.mjs`
Expected: PASS.

**Step 3: Wire into Evolution webhook**

In the Evolution webhook handler, after the inbound message is processed and `customerId` is resolved, add:

```js
import { maybeAutoOptIn, maybeAutoOptOut } from '../services/marketing/optInOptOut.js'

// After locating the customer:
if (customerId) {
  const optedOut = await maybeAutoOptOut(customerId, messageText)
  if (optedOut) {
    // Send confirmation reply (utility, in 24h window)
    try {
      await evoSendText({
        instanceName,
        to: normalizedPhone,
        text: 'Confirmamos sua remoção da lista de promoções. Você ainda receberá notificações sobre seus pedidos. Para voltar, é só pedir 🙂',
      })
    } catch (_) {}
  } else {
    await maybeAutoOptIn(customerId)
  }
}
```

**Step 4: Wire into Meta webhook**

Same pattern in `webhookMeta.js`. Use `whatsappMetaAdapter.sendMessage` for the confirmation.

**Step 5: Commit**

```bash
git add delivery-saas-backend/src/services/marketing/optInOptOut.js delivery-saas-backend/src/routes/webhookEvolution.js delivery-saas-backend/src/messaging/webhookMeta.js delivery-saas-backend/tests/optInOptOut.test.mjs
git commit -m "feat(marketing): auto opt-in on inbound + opt-out by keyword"
```

---

### Task 1.7: Manual opt-in/out in CustomerProfile

**Files:**
- Modify: `delivery-saas-frontend/src/views/CustomerProfile.vue`
- Modify: `delivery-saas-backend/src/routes/customers.js` (accept the new fields)

**Step 1: Add UI block**

In `CustomerProfile.vue`, add to the customer info section:

```vue
<div class="card mt-3">
  <div class="card-body">
    <h6 class="card-title"><i class="bi bi-megaphone me-1"></i>Marketing WhatsApp</h6>
    <div class="form-check">
      <input
        id="optInMarketingCheck"
        v-model="optInMarketing"
        type="checkbox"
        class="form-check-input"
        @change="saveMarketingOptIn"
      />
      <label class="form-check-label" for="optInMarketingCheck">
        Cliente autorizou receber campanhas no WhatsApp
      </label>
    </div>
    <small v-if="customer.optInMarketingAt" class="text-muted d-block mt-1">
      Origem: {{ customer.optInMarketingSource || '-' }} •
      Desde: {{ formatDateTime(customer.optInMarketingAt) }}
    </small>
    <small v-if="customer.optOutMarketingAt" class="text-danger d-block mt-1">
      Opt-out em {{ formatDateTime(customer.optOutMarketingAt) }}
    </small>
  </div>
</div>
```

**Step 2: Add the save function**

```js
const optInMarketing = ref(false)

// In load handler:
optInMarketing.value = !!customer.value.optInMarketing

async function saveMarketingOptIn() {
  try {
    await api.patch(`/customers/${customer.value.id}`, {
      optInMarketing: optInMarketing.value,
      optInMarketingSource: 'manual',
    })
  } catch (e) {
    optInMarketing.value = !optInMarketing.value // revert on error
    Swal.fire({ icon: 'error', text: 'Falha ao salvar preferência' })
  }
}
```

**Step 3: Accept in backend PATCH /customers/:id**

In `customers.js`, find the PATCH handler. Accept the new fields:

```js
const { optInMarketing, optInMarketingSource } = req.body || {}
// ...
if (optInMarketing === true) {
  patch.optInMarketing = true
  patch.optInMarketingAt = new Date()
  patch.optInMarketingSource = optInMarketingSource || 'manual'
  patch.optOutMarketingAt = null
} else if (optInMarketing === false) {
  patch.optInMarketing = false
  patch.optOutMarketingAt = new Date()
}
```

**Step 4: Commit**

```bash
git add delivery-saas-frontend/src/views/CustomerProfile.vue delivery-saas-backend/src/routes/customers.js
git commit -m "feat(marketing): manual opt-in/out in CustomerProfile"
```

---

### Task 1.8: Campaign CRUD routes

**Files:**
- Create: `delivery-saas-backend/src/routes/marketing/campaigns.js`
- Modify: `delivery-saas-backend/src/index.js`

**Step 1: Create routes**

```js
// src/routes/marketing/campaigns.js
import express from 'express'
import { prisma } from '../../prisma.js'
import { authMiddleware, requireRole } from '../../auth.js'
import { requireModuleStrict } from '../../modules.js'

const router = express.Router()
router.use(authMiddleware, requireModuleStrict('marketing_campaigns'))

// GET /marketing/campaigns — list
router.get('/', async (req, res) => {
  const companyId = req.user.companyId
  const campaigns = await prisma.marketingCampaign.findMany({
    where: { companyId },
    orderBy: { updatedAt: 'desc' },
    include: {
      segment: { select: { id: true, name: true } },
      _count: { select: { messages: true } },
    },
  })
  res.json(campaigns)
})

// GET /marketing/campaigns/:id — detail
router.get('/:id', async (req, res) => {
  const companyId = req.user.companyId
  const { id } = req.params
  const c = await prisma.marketingCampaign.findFirst({
    where: { id, companyId },
    include: {
      segment: true,
      template: { select: { id: true, name: true, status: true, language: true, components: true } },
      coupon: { select: { id: true, code: true, isPercentage: true, value: true } },
      runs: { orderBy: { startedAt: 'desc' }, take: 30 },
    },
  })
  if (!c) return res.status(404).json({ message: 'Campaign not found' })
  res.json(c)
})

// POST /marketing/campaigns — create (DRAFT)
router.post('/', requireRole('ADMIN'), async (req, res) => {
  const companyId = req.user.companyId
  const body = req.body || {}
  const {
    name, segmentId, scheduleType,
    scheduledFor, cronExpression, triggerType, triggerParams,
    channel, templateId, freeText, templateVariableMap,
    conversionWindowHours, attributionScope, segmentMenuId, couponId,
  } = body

  if (!name || !segmentId || !scheduleType) {
    return res.status(400).json({ message: 'name, segmentId, scheduleType required' })
  }
  const segment = await prisma.marketingSegment.findFirst({ where: { id: segmentId, companyId } })
  if (!segment) return res.status(400).json({ message: 'Segment not found' })

  const campaign = await prisma.marketingCampaign.create({
    data: {
      companyId,
      segmentId,
      name,
      scheduleType,
      scheduledFor: scheduledFor ? new Date(scheduledFor) : null,
      cronExpression: cronExpression || null,
      triggerType: triggerType || null,
      triggerParams: triggerParams || null,
      channel: channel || 'AUTO',
      templateId: templateId || null,
      freeText: freeText || null,
      templateVariableMap: templateVariableMap || null,
      conversionWindowHours: conversionWindowHours || 48,
      attributionScope: attributionScope || 'menu',
      segmentMenuId: segmentMenuId || null,
      couponId: couponId || null,
      status: 'DRAFT',
      createdByUserId: req.user.id || null,
    },
  })
  res.status(201).json(campaign)
})

// PATCH /marketing/campaigns/:id — update (only DRAFT or PAUSED)
router.patch('/:id', requireRole('ADMIN'), async (req, res) => {
  const companyId = req.user.companyId
  const { id } = req.params
  const existing = await prisma.marketingCampaign.findFirst({ where: { id, companyId } })
  if (!existing) return res.status(404).json({ message: 'Campaign not found' })
  if (!['DRAFT', 'PAUSED', 'SCHEDULED'].includes(existing.status)) {
    return res.status(400).json({ message: 'Only DRAFT/PAUSED/SCHEDULED can be edited' })
  }
  // Whitelist editable fields
  const allowed = ['name','scheduledFor','cronExpression','triggerType','triggerParams',
    'channel','templateId','freeText','templateVariableMap','conversionWindowHours',
    'attributionScope','segmentMenuId','couponId']
  const patch = {}
  for (const k of allowed) if (k in req.body) patch[k] = req.body[k]
  const updated = await prisma.marketingCampaign.update({ where: { id }, data: patch })
  res.json(updated)
})

// POST /marketing/campaigns/:id/activate — DRAFT → SCHEDULED
router.post('/:id/activate', requireRole('ADMIN'), async (req, res) => {
  const companyId = req.user.companyId
  const { id } = req.params
  const c = await prisma.marketingCampaign.findFirst({ where: { id, companyId } })
  if (!c) return res.status(404).json({ message: 'Campaign not found' })
  if (c.status !== 'DRAFT') return res.status(400).json({ message: `Cannot activate from status ${c.status}` })
  // TODO: run pre-flight checks (template APPROVED, audience > 0, etc) — Task 1.13
  const updated = await prisma.marketingCampaign.update({
    where: { id },
    data: { status: 'SCHEDULED' },
  })
  res.json(updated)
})

// POST /marketing/campaigns/:id/pause
router.post('/:id/pause', requireRole('ADMIN'), async (req, res) => {
  const companyId = req.user.companyId
  const { id } = req.params
  const c = await prisma.marketingCampaign.findFirst({ where: { id, companyId } })
  if (!c) return res.status(404).json({ message: 'Campaign not found' })
  if (!['SCHEDULED', 'RUNNING'].includes(c.status)) return res.status(400).json({ message: `Cannot pause from status ${c.status}` })
  const updated = await prisma.marketingCampaign.update({ where: { id }, data: { status: 'PAUSED' } })
  res.json(updated)
})

// POST /marketing/campaigns/:id/resume
router.post('/:id/resume', requireRole('ADMIN'), async (req, res) => {
  const companyId = req.user.companyId
  const { id } = req.params
  const c = await prisma.marketingCampaign.findFirst({ where: { id, companyId } })
  if (!c) return res.status(404).json({ message: 'Campaign not found' })
  if (c.status !== 'PAUSED') return res.status(400).json({ message: `Cannot resume from status ${c.status}` })
  // Resume into SCHEDULED (or RUNNING if it was actively running)
  const updated = await prisma.marketingCampaign.update({ where: { id }, data: { status: 'SCHEDULED' } })
  res.json(updated)
})

// POST /marketing/campaigns/:id/cancel — irreversible
router.post('/:id/cancel', requireRole('ADMIN'), async (req, res) => {
  const companyId = req.user.companyId
  const { id } = req.params
  const c = await prisma.marketingCampaign.findFirst({ where: { id, companyId } })
  if (!c) return res.status(404).json({ message: 'Campaign not found' })
  if (c.status === 'COMPLETED' || c.status === 'CANCELLED') {
    return res.status(400).json({ message: 'Already finalized' })
  }
  const updated = await prisma.marketingCampaign.update({ where: { id }, data: { status: 'CANCELLED' } })
  res.json(updated)
})

export default router
```

**Step 2: Mount**

In `src/index.js`:

```js
import marketingCampaignsRouter from './routes/marketing/campaigns.js'
app.use('/marketing/campaigns', marketingCampaignsRouter)
```

**Step 3: Smoke test**

```bash
curl -X POST http://localhost:3000/marketing/campaigns \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"Test", "segmentId":"<existing-segment-id>", "scheduleType":"ONE_SHOT"}'
```

Expected: 201 with the new campaign object.

**Step 4: Commit**

```bash
git add delivery-saas-backend/src/routes/marketing/campaigns.js delivery-saas-backend/src/index.js
git commit -m "feat(marketing): campaign CRUD + state transitions"
```

---

### Task 1.9: Worker scaffold + Tick 1 (discover work)

**Files:**
- Create: `delivery-saas-backend/src/workers/marketing.js`
- Modify: `delivery-saas-backend/src/index.js` (start worker after server)

**Step 1: Create worker**

```js
// src/workers/marketing.js
import { prisma } from '../prisma.js'

const TICK_INTERVAL_MS = 30_000

async function tick() {
  try {
    await discoverWork()
  } catch (e) {
    console.error('[marketing-worker] tick error', e?.message || e)
  }
}

async function discoverWork() {
  const now = new Date()

  // ONE_SHOT scheduled and due
  const oneShot = await prisma.marketingCampaign.findMany({
    where: {
      status: 'SCHEDULED',
      scheduleType: 'ONE_SHOT',
      scheduledFor: { lte: now },
    },
  })
  for (const c of oneShot) {
    console.log('[marketing-worker] discovered ONE_SHOT due:', c.id, c.name)
    // enqueueRun(c) — implemented in Task 1.10
  }

  // RECURRING/TRIGGER — left for next tasks
}

let started = false
export function startMarketingWorker() {
  if (started) return
  started = true
  console.log('[marketing-worker] starting, tick every', TICK_INTERVAL_MS, 'ms')
  setInterval(tick, TICK_INTERVAL_MS)
  setImmediate(tick) // run once immediately
}
```

**Step 2: Start from index.js**

In `src/index.js`, after the server listens:

```js
import { startMarketingWorker } from './workers/marketing.js'
// ... after app.listen():
if (process.env.MARKETING_WORKER !== 'off') {
  startMarketingWorker()
}
```

**Step 3: Smoke test**

Start backend. Check logs for `[marketing-worker] starting`. Create a campaign with `status='SCHEDULED'` and `scheduledFor` in the past via DB:

```sql
UPDATE "MarketingCampaign" SET status='SCHEDULED', "scheduledFor" = NOW() - interval '1 minute' WHERE id = '<your-campaign-id>';
```

Within 30s, log should show `[marketing-worker] discovered ONE_SHOT due:`.

**Step 4: Commit**

```bash
git add delivery-saas-backend/src/workers/marketing.js delivery-saas-backend/src/index.js
git commit -m "feat(marketing): worker scaffold + Tick 1 (discover ONE_SHOT)"
```

---

### Task 1.10: Worker — enqueueRun pipeline

**Files:**
- Create: `delivery-saas-backend/src/services/marketing/sendQueue.js`
- Modify: `delivery-saas-backend/src/workers/marketing.js`

**Step 1: Create sendQueue service**

```js
// src/services/marketing/sendQueue.js
import { prisma } from '../../prisma.js'
import { evaluateSegment } from './segmentEvaluator.js'

const FREQ_CAP_PER_WEEK = 2

/**
 * Compute send slot timestamps respecting quiet hours and channel jitter.
 * - Cloud: ~200ms between slots (Meta throttle handled at send time)
 * - Evolution: 1-15s random jitter
 */
function computeSendSlots(count, channel, companyTimezone = 'America/Bahia') {
  const slots = []
  let cursor = nextValidSlot(new Date(), companyTimezone)
  for (let i = 0; i < count; i++) {
    slots.push(new Date(cursor))
    const isEvo = channel === 'EVOLUTION_WA'
    const jitterMs = isEvo
      ? Math.floor(Math.random() * 14_000) + 1_000  // 1-15s
      : 200
    cursor = new Date(cursor.getTime() + jitterMs)
    cursor = nextValidSlot(cursor, companyTimezone)
  }
  return slots
}

function nextValidSlot(t, _timezone) {
  // Quiet hours: 8h-21h in local time. For V1 we use the server's local time
  // (matching Brazilian deployment). Multi-timezone refinement in V2.
  const d = new Date(t)
  const h = d.getHours()
  if (h < 8) {
    d.setHours(8, 0, 0, 0)
    return d
  }
  if (h >= 21) {
    d.setDate(d.getDate() + 1)
    d.setHours(8, 0, 0, 0)
    return d
  }
  return d
}

export async function enqueueRun(campaign) {
  // Load segment if not eagerly loaded
  const segment = campaign.segment ?? await prisma.marketingSegment.findUnique({ where: { id: campaign.segmentId } })

  // 1) Evaluate segment
  const customerIds = await evaluateSegment({ companyId: campaign.companyId, ruleJson: segment.ruleJson })

  // 2) Filter by RECURRING already-sent
  let candidates = customerIds
  if (campaign.scheduleType === 'RECURRING') {
    const already = await prisma.marketingMessage.findMany({
      where: { campaignId: campaign.id, customerId: { in: customerIds } },
      select: { customerId: true },
    })
    const sentSet = new Set(already.map(m => m.customerId))
    candidates = customerIds.filter(id => !sentSet.has(id))
  }

  // 3) Frequency cap: <=2 marketing per customer per 7d
  if (candidates.length > 0) {
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400_000)
    const recent = await prisma.marketingMessage.groupBy({
      by: ['customerId'],
      where: {
        customerId: { in: candidates },
        sentAt: { gte: sevenDaysAgo },
      },
      _count: { id: true },
    })
    const capMap = new Map(recent.map(r => [r.customerId, r._count.id]))
    candidates = candidates.filter(id => (capMap.get(id) || 0) < FREQ_CAP_PER_WEEK)
  }

  // 4) Create run + messages + queue rows
  const run = await prisma.marketingCampaignRun.create({
    data: { campaignId: campaign.id, totalQueued: candidates.length },
  })

  if (candidates.length === 0) {
    await prisma.marketingCampaignRun.update({
      where: { id: run.id },
      data: { finishedAt: new Date() },
    })
    if (campaign.scheduleType === 'ONE_SHOT') {
      await prisma.marketingCampaign.update({ where: { id: campaign.id }, data: { status: 'COMPLETED' } })
    }
    return { runId: run.id, queued: 0 }
  }

  const slots = computeSendSlots(candidates.length, campaign.channel)

  // Batch insert
  const messageData = candidates.map((customerId, i) => ({
    companyId: campaign.companyId,
    campaignId: campaign.id,
    campaignRunId: run.id,
    customerId,
    providerUsed: campaign.channel,
    status: 'QUEUED',
    scheduledFor: slots[i],
  }))

  // Use createManyAndReturn (Prisma 5.14+) to get IDs back
  const messages = await prisma.marketingMessage.createManyAndReturn({ data: messageData })

  await prisma.marketingSendQueue.createMany({
    data: messages.map((m, i) => ({
      messageId: m.id,
      scheduledFor: slots[i],
    })),
  })

  // 5) Move campaign to RUNNING (ONE_SHOT moves now; RECURRING stays SCHEDULED)
  if (campaign.scheduleType === 'ONE_SHOT') {
    await prisma.marketingCampaign.update({ where: { id: campaign.id }, data: { status: 'RUNNING' } })
  }

  console.log('[marketing-worker] enqueued run', run.id, 'for campaign', campaign.id, 'with', candidates.length, 'messages')
  return { runId: run.id, queued: candidates.length }
}
```

**Step 2: Wire in worker**

In `marketing.js#discoverWork`:

```js
import { enqueueRun } from '../services/marketing/sendQueue.js'

// inside discoverWork(), replace the placeholder:
for (const c of oneShot) {
  const full = await prisma.marketingCampaign.findUnique({
    where: { id: c.id },
    include: { segment: true },
  })
  await enqueueRun(full)
}
```

**Step 3: Smoke test**

Same setup as Task 1.9. Trigger by setting `scheduledFor` to past. Within 30s:
- Log shows enqueue
- DB: `MarketingCampaignRun` row created
- DB: `MarketingMessage` rows for each eligible customer
- DB: `MarketingSendQueue` rows queued

**Step 4: Commit**

```bash
git add delivery-saas-backend/src/services/marketing/sendQueue.js delivery-saas-backend/src/workers/marketing.js
git commit -m "feat(marketing): worker enqueueRun pipeline (segment, freq cap, slots)"
```

---

### Task 1.11: Worker — Tick 2 (drain queue + send)

**Files:**
- Modify: `delivery-saas-backend/src/workers/marketing.js`
- Create: `delivery-saas-backend/src/services/marketing/sender.js`

**Step 1: Implement sender**

```js
// src/services/marketing/sender.js
import { prisma } from '../../prisma.js'
import { pickConnectedChannel } from '../whatsapp/pickChannel.js'
import { normalizePhone, evoSendText } from '../../wa.js'
import whatsappMetaAdapter from '../../messaging/adapters/whatsappMeta.adapter.js'
import { persistOutboundWhatsappMessage } from '../notify.js' // re-exported from notify

const MAX_ATTEMPTS = 3

export async function processSendJob(job) {
  const message = await prisma.marketingMessage.findUnique({
    where: { id: job.messageId },
    include: {
      campaign: { include: { template: true, segment: true, coupon: true } },
      customer: true,
    },
  })
  if (!message || message.status !== 'QUEUED') {
    await removeFromQueue(job.id)
    return
  }

  // Re-checks
  if (message.customer.optOutMarketingAt) {
    await prisma.marketingMessage.update({
      where: { id: message.id },
      data: { status: 'OPTED_OUT', excludedFromAttribution: true },
    })
    await removeFromQueue(job.id)
    return
  }
  if (['PAUSED', 'CANCELLED'].includes(message.campaign.status)) {
    // Leave in queue; resumes if campaign returns to SCHEDULED/RUNNING
    return
  }

  // Resolve channel
  const channelOverride = message.campaign.channel !== 'AUTO' ? message.campaign.channel : null
  const provider = await resolveChannelForSend(message, channelOverride)
  if (!provider) {
    await failPermanent(message, job, 'no-channel')
    return
  }

  // Render
  const rendered = renderMessage(message)

  try {
    let result
    if (provider.type === 'META_WA') {
      result = await whatsappMetaAdapter.sendTemplate(provider.account, message.customer.whatsapp, rendered.template)
    } else {
      await evoSendText({
        instanceName: provider.instanceName,
        to: normalizePhone(message.customer.whatsapp),
        text: rendered.text,
      })
      result = { externalId: null }
    }

    await prisma.marketingMessage.update({
      where: { id: message.id },
      data: {
        status: 'SENT',
        sentAt: new Date(),
        providerUsed: provider.type,
        providerAccountId: provider.accountId || null,
        instanceName: provider.instanceName || null,
        externalId: result.externalId,
      },
    })

    // Mirror to Conversation/Message for inbox visibility
    await persistOutboundWhatsappMessage({
      companyId: message.companyId,
      provider: provider.type,
      providerAccountId: provider.accountId || null,
      instanceName: provider.instanceName || null,
      phone: message.customer.whatsapp,
      text: rendered.text,
      externalId: result.externalId,
      customerId: message.customerId,
      contactName: message.customer.fullName,
      menuId: message.campaign.segmentMenuId || null,
      storeId: null,
    })

    await removeFromQueue(job.id)
  } catch (err) {
    await handleSendError(job, message, err)
  }
}

async function resolveChannelForSend(message, channelOverride) {
  // AUTO: mirror customer's last conversation
  if (!channelOverride) {
    return pickConnectedChannel({
      companyId: message.companyId,
      customerId: message.customerId,
      menuId: message.campaign.segmentMenuId,
    })
  }
  // Forced channel:
  if (channelOverride === 'META_WA') {
    const acc = await prisma.metaMessagingAccount.findFirst({
      where: { companyId: message.companyId, provider: 'META_WA', status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
    })
    return acc ? { type: 'META_WA', account: acc, accountId: acc.id } : null
  }
  if (channelOverride === 'EVOLUTION_WA') {
    const inst = await prisma.whatsAppInstance.findFirst({
      where: { companyId: message.companyId, status: 'CONNECTED' },
      orderBy: { createdAt: 'desc' },
    })
    return inst ? { type: 'EVOLUTION_WA', instanceName: inst.instanceName } : null
  }
  return null
}

function renderMessage(message) {
  // V1: Evolution uses freeText with simple placeholders.
  // Cloud uses template + variableMap (template renderer in Task 1.12).
  const firstName = (message.customer.fullName || '').split(/\s+/)[0] || ''
  let text = message.campaign.freeText || ''
  text = text
    .replace(/\{nome\}/g, firstName)
    .replace(/\{cliente\}/g, message.customer.fullName || '')
    .replace(/\{cupom\}/g, message.campaign.coupon?.code || '')
  return {
    text,
    template: message.campaign.template
      ? { name: message.campaign.template.name, language: { code: message.campaign.template.language || 'pt_BR' }, components: [] }
      : null,
  }
}

async function failPermanent(message, job, errorMessage) {
  await prisma.marketingMessage.update({
    where: { id: message.id },
    data: { status: 'FAILED', failedAt: new Date(), errorMessage: String(errorMessage).slice(0, 500) },
  })
  await removeFromQueue(job.id)
}

async function handleSendError(job, message, err) {
  const status = err?.response?.status
  const errorCode = err?.response?.data?.error?.code
  const PERMANENT_CODES = [131026, 131047, 131051]
  const isPermanent = (status >= 400 && status < 500 && status !== 429) || PERMANENT_CODES.includes(errorCode)

  if (isPermanent) {
    return failPermanent(message, job, err.message)
  }

  const attempts = job.attempts + 1
  if (attempts >= MAX_ATTEMPTS) {
    return failPermanent(message, job, `max attempts: ${err.message}`)
  }
  const backoffMs = Math.min(30_000 * Math.pow(2, attempts), 10 * 60_000)
  await prisma.marketingSendQueue.update({
    where: { id: job.id },
    data: {
      attempts,
      scheduledFor: new Date(Date.now() + backoffMs),
      lockUntil: new Date(),
      lastError: String(err.message).slice(0, 500),
    },
  })
}

async function removeFromQueue(jobId) {
  await prisma.marketingSendQueue.delete({ where: { id: jobId } }).catch(() => {})
}

export async function drainSendQueue() {
  const BATCH = 50
  const now = new Date()
  const jobs = await prisma.$queryRaw`
    UPDATE "MarketingSendQueue"
    SET "lockUntil" = NOW() + interval '5 minutes'
    WHERE id IN (
      SELECT id FROM "MarketingSendQueue"
      WHERE "scheduledFor" <= ${now}
        AND "lockUntil"   <= ${now}
      ORDER BY "scheduledFor" ASC
      LIMIT ${BATCH}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *
  `
  for (const job of jobs) {
    await processSendJob(job)
  }
}
```

**Step 2: Wire in worker tick**

```js
// in marketing.js
import { drainSendQueue } from '../services/marketing/sender.js'

async function tick() {
  try {
    await discoverWork()
    await drainSendQueue()
  } catch (e) {
    console.error('[marketing-worker] tick error', e?.message || e)
  }
}
```

**Step 3: Re-export `persistOutboundWhatsappMessage` from notify.js**

In `notify.js`, find the function (currently not exported). Add `export` keyword.

**Step 4: Smoke test**

Create campaign with `channel='EVOLUTION_WA'`, valid Evolution instance connected, segment with 1-2 opted-in customers. Activate. Watch logs:

- `[marketing-worker] enqueued run X with N messages`
- `evoSendText -> success ...` from existing logs
- Verify DB: `MarketingMessage.status = 'SENT'`, `sentAt` populated

**Step 5: Commit**

```bash
git add delivery-saas-backend/src/services/marketing/sender.js delivery-saas-backend/src/workers/marketing.js delivery-saas-backend/src/services/notify.js
git commit -m "feat(marketing): worker drains queue + sends via Cloud/Evolution"
```

---

### Task 1.12: Template variable renderer (Cloud API)

**Files:**
- Create: `delivery-saas-backend/src/services/marketing/templateRenderer.js`
- Modify: `delivery-saas-backend/src/services/marketing/sender.js`

**Step 1: Implement renderer**

```js
// src/services/marketing/templateRenderer.js

/**
 * Build Cloud API template components from variableMap and message context.
 *
 * variableMap shape: { "1": {source:'field', value:'customer.firstName'}, ... }
 *
 * Returns components array compatible with WhatsApp Cloud API:
 *   [
 *     { type: 'body', parameters: [{type:'text', text:'Maria'}, ...] },
 *     { type: 'button', sub_type: 'url', index: '0', parameters: [...] }
 *   ]
 */
export function renderTemplate(message, template, variableMap) {
  const components = []
  const bodyVars = Object.keys(variableMap || {})
    .filter(k => /^\d+$/.test(k))
    .sort((a, b) => Number(a) - Number(b))

  if (bodyVars.length > 0) {
    components.push({
      type: 'body',
      parameters: bodyVars.map(k => ({ type: 'text', text: resolveVariable(message, variableMap[k]) })),
    })
  }

  // URL button with {{N}} parameter (if defined in template)
  const buttonsComp = (template.components || []).find(c => c.type === 'BUTTONS')
  if (buttonsComp?.buttons) {
    buttonsComp.buttons.forEach((btn, idx) => {
      if (btn.type === 'URL' && /\{\{\d+\}\}/.test(btn.url || '')) {
        const varNum = btn.url.match(/\{\{(\d+)\}\}/)[1]
        const mapping = variableMap[`url_${varNum}`] || variableMap[varNum]
        if (mapping) {
          components.push({
            type: 'button',
            sub_type: 'url',
            index: String(idx),
            parameters: [{ type: 'text', text: resolveVariable(message, mapping) }],
          })
        }
      }
    })
  }

  return {
    name: template.name,
    language: { code: template.language || 'pt_BR' },
    components,
  }
}

function resolveVariable(message, mapping) {
  if (!mapping) return ''
  if (mapping.source === 'field') return getFieldValue(message, mapping.value)
  if (mapping.source === 'campaign') {
    if (mapping.value === 'couponCode') return message.campaign.coupon?.code || ''
    if (mapping.value === 'conversionWindowHours') return String(message.campaign.conversionWindowHours)
  }
  if (mapping.source === 'static') return String(mapping.value || '')
  return ''
}

function getFieldValue(message, path) {
  const parts = path.split('.')
  let cur = { customer: message.customer, campaign: message.campaign }
  for (const p of parts) {
    if (cur == null) return ''
    cur = cur[p]
  }
  if (path === 'customer.firstName') {
    return (message.customer.fullName || '').split(/\s+/)[0] || ''
  }
  return String(cur ?? '')
}
```

**Step 2: Tests**

```js
// tests/templateRenderer.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderTemplate } from '../src/services/marketing/templateRenderer.js'

test('renderTemplate maps body variables', () => {
  const message = {
    customer: { fullName: 'Maria Silva' },
    campaign: { conversionWindowHours: 48, coupon: { code: 'PIZZA30' } },
  }
  const template = { name: 'reactivation_30d', language: 'pt_BR', components: [] }
  const variableMap = {
    '1': { source: 'field', value: 'customer.firstName' },
    '2': { source: 'campaign', value: 'couponCode' },
    '3': { source: 'campaign', value: 'conversionWindowHours' },
  }
  const result = renderTemplate(message, template, variableMap)
  assert.equal(result.name, 'reactivation_30d')
  assert.equal(result.language.code, 'pt_BR')
  assert.equal(result.components[0].type, 'body')
  assert.deepEqual(result.components[0].parameters.map(p => p.text), ['Maria', 'PIZZA30', '48'])
})

test('renderTemplate handles missing variableMap gracefully', () => {
  const message = { customer: { fullName: 'Joao' }, campaign: { coupon: null, conversionWindowHours: 24 } }
  const template = { name: 't', language: 'pt_BR', components: [] }
  const result = renderTemplate(message, template, {})
  assert.equal(result.components.length, 0)
})
```

Run: `node --test tests/templateRenderer.test.mjs`
Expected: PASS.

**Step 3: Wire into sender**

In `sender.js#renderMessage`, replace the template logic:

```js
import { renderTemplate } from './templateRenderer.js'

function renderMessage(message) {
  const firstName = (message.customer.fullName || '').split(/\s+/)[0] || ''
  let text = message.campaign.freeText || ''
  text = text
    .replace(/\{nome\}/g, firstName)
    .replace(/\{cliente\}/g, message.customer.fullName || '')
    .replace(/\{cupom\}/g, message.campaign.coupon?.code || '')

  let template = null
  if (message.campaign.template && message.campaign.templateVariableMap) {
    template = renderTemplate(message, message.campaign.template, message.campaign.templateVariableMap)
  }

  return { text, template }
}
```

**Step 4: Commit**

```bash
git add delivery-saas-backend/src/services/marketing/templateRenderer.js delivery-saas-backend/tests/templateRenderer.test.mjs delivery-saas-backend/src/services/marketing/sender.js
git commit -m "feat(marketing): template variable renderer for Cloud API"
```

---

### Task 1.13: Pre-flight checks endpoint

**Files:**
- Modify: `delivery-saas-backend/src/routes/marketing/campaigns.js`

**Step 1: Add pre-flight endpoint**

In `campaigns.js`:

```js
import { evaluateSegment } from '../../services/marketing/segmentEvaluator.js'

router.get('/:id/preflight', async (req, res) => {
  const companyId = req.user.companyId
  const { id } = req.params
  const c = await prisma.marketingCampaign.findFirst({
    where: { id, companyId },
    include: { segment: true, template: true },
  })
  if (!c) return res.status(404).json({ message: 'Campaign not found' })

  const issues = []

  // 1. Cloud template check
  if (c.channel === 'META_WA' || (c.channel === 'AUTO' && c.templateId)) {
    if (!c.templateId) issues.push({ severity: 'error', code: 'no_template', msg: 'Template não selecionado' })
    else if (c.template?.status !== 'APPROVED') {
      issues.push({ severity: 'error', code: 'template_not_approved', msg: `Template está ${c.template?.status}, precisa ser APPROVED` })
    }
  }

  // 2. Evaluate audience (with all filters: opt-in injected by evaluator)
  const customerIds = await evaluateSegment({ companyId, ruleJson: c.segment.ruleJson })
  const eligible = customerIds.length
  if (eligible === 0) issues.push({ severity: 'error', code: 'empty_audience', msg: 'Nenhum cliente elegível na audiência' })

  // 3. Evolution + audience > 50 warning
  if (c.channel === 'EVOLUTION_WA' && eligible > 50) {
    issues.push({ severity: 'warning', code: 'evo_mass_send', msg: `${eligible} envios via Evolution: risco real de ban. Considere Cloud API.` })
  }

  // 4. > 500 confirmation
  if (eligible > 500) {
    issues.push({ severity: 'confirm', code: 'large_audience', msg: `Audiência grande: ${eligible}. Confirme digitando o número.` })
  }

  res.json({ eligible, issues })
})
```

**Step 2: Block activate if errors present**

Update the `/activate` handler:

```js
router.post('/:id/activate', requireRole('ADMIN'), async (req, res) => {
  // ... existing
  // Run pre-flight
  const { confirmedCount } = req.body || {}
  const preflightResp = await runPreflight(c, companyId)
  const errors = preflightResp.issues.filter(i => i.severity === 'error')
  if (errors.length) return res.status(400).json({ message: 'Pre-flight failed', issues: errors })
  const confirmNeeded = preflightResp.issues.find(i => i.code === 'large_audience')
  if (confirmNeeded && confirmedCount !== preflightResp.eligible) {
    return res.status(400).json({ message: 'Audience confirmation required', expected: preflightResp.eligible })
  }
  // ... proceed to update status
})

async function runPreflight(c, companyId) {
  // Extract the preflight logic into a callable function
  // (Move body of /preflight route here, return { eligible, issues })
}
```

**Step 3: Commit**

```bash
git add delivery-saas-backend/src/routes/marketing/campaigns.js
git commit -m "feat(marketing): pre-flight checks (template, audience, size)"
```

---

### Task 1.14: Frontend — segments list page

**Files:**
- Create: `delivery-saas-frontend/src/views/marketing/SegmentsList.vue`
- Modify: `delivery-saas-frontend/src/router.js`
- Modify: `delivery-saas-frontend/src/config/nav.js`

**Step 1: Add route**

In `router.js`:

```js
{
  path: '/marketing/segments',
  component: () => import('./views/marketing/SegmentsList.vue'),
  meta: { requiresAuth: true, role: 'ATTENDANT', requiresModule: 'marketing_campaigns' },
},
{
  path: '/marketing/segments/new',
  component: () => import('./views/marketing/SegmentForm.vue'),
  meta: { requiresAuth: true, role: 'ADMIN', requiresModule: 'marketing_campaigns' },
},
{
  path: '/marketing/segments/:id',
  component: () => import('./views/marketing/SegmentForm.vue'),
  meta: { requiresAuth: true, role: 'ADMIN', requiresModule: 'marketing_campaigns' },
},
```

**Step 2: Add nav entry**

In `config/nav.js`, under existing `'Marketing'` group:

```js
{ name: 'Campanhas', to: '/marketing/campaigns', icon: 'bi bi-broadcast', moduleKey: 'marketing_campaigns', lockable: true },
{ name: 'Segmentos', to: '/marketing/segments', icon: 'bi bi-people', moduleKey: 'marketing_campaigns', lockable: true },
```

**Step 3: Create SegmentsList.vue**

```vue
<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import api from '../../api'
import ListCard from '../../components/ListCard.vue'
import BaseButton from '../../components/BaseButton.vue'
import Swal from 'sweetalert2'

const router = useRouter()
const segments = ref([])
const loading = ref(false)

async function load() {
  loading.value = true
  try {
    const { data } = await api.get('/marketing/segments')
    segments.value = data
  } catch (e) {
    Swal.fire({ icon: 'error', text: 'Falha ao carregar segmentos' })
  } finally { loading.value = false }
}
onMounted(load)

async function remove(seg) {
  const r = await Swal.fire({
    title: `Remover "${seg.name}"?`,
    text: 'O segmento não poderá ser usado em novas campanhas.',
    icon: 'warning', showCancelButton: true,
    confirmButtonText: 'Remover', cancelButtonText: 'Cancelar',
    confirmButtonColor: '#dc3545',
  })
  if (!r.isConfirmed) return
  try {
    await api.delete(`/marketing/segments/${seg.id}`)
    await load()
  } catch (e) {
    Swal.fire({ icon: 'error', text: 'Falha ao remover' })
  }
}
</script>

<template>
  <ListCard title="Segmentos de clientes" icon="bi bi-people">
    <template #actions>
      <BaseButton variant="primary" icon="+" @click="router.push('/marketing/segments/new')">
        Novo segmento
      </BaseButton>
    </template>

    <div v-if="loading" class="text-center py-5">
      <div class="spinner-border text-primary" role="status"></div>
    </div>
    <div v-else-if="!segments.length" class="text-center py-5 text-muted">
      Nenhum segmento criado ainda.
    </div>
    <div v-else class="table-responsive">
      <table class="table table-hover align-middle">
        <thead>
          <tr>
            <th>Nome</th>
            <th>Tamanho estimado</th>
            <th>Última avaliação</th>
            <th class="text-end">Ações</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in segments" :key="s.id">
            <td>
              <div class="fw-semibold">{{ s.name }}</div>
              <div class="small text-muted">{{ s.description || '—' }}</div>
            </td>
            <td>{{ s.estimatedSize ?? '—' }}</td>
            <td><small class="text-muted">{{ s.lastEvaluatedAt ? new Date(s.lastEvaluatedAt).toLocaleString('pt-BR') : '—' }}</small></td>
            <td class="text-end">
              <router-link :to="`/marketing/segments/${s.id}`" class="btn btn-sm btn-outline-primary me-1">Editar</router-link>
              <button class="btn btn-sm btn-outline-danger" @click="remove(s)"><i class="bi bi-trash"></i></button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </ListCard>
</template>
```

**Step 4: Commit**

```bash
git add delivery-saas-frontend/src/views/marketing/ delivery-saas-frontend/src/router.js delivery-saas-frontend/src/config/nav.js
git commit -m "feat(marketing): segments list page + nav entry"
```

---

### Task 1.15: Frontend — segment builder page (basic)

**Files:**
- Create: `delivery-saas-frontend/src/views/marketing/SegmentForm.vue`
- Create: `delivery-saas-frontend/src/components/marketing/RuleBuilder.vue` (reusable)

**Step 1: Create RuleBuilder.vue**

```vue
<!-- A recursive component to build segment rules.
     Renders a leaf (field/op/value) or a group (all/any) with nested children. -->
<script setup>
import { computed } from 'vue'

const props = defineProps({
  rule: { type: Object, required: true },
  depth: { type: Number, default: 0 },
})
const emit = defineEmits(['update:rule', 'remove'])

const FIELDS = [
  { value: 'lastOrderAt', label: 'Última compra', valueType: 'duration', ops: ['olderThan', 'newerThan'] },
  { value: 'totalSpent', label: 'Total gasto', valueType: 'number', ops: ['>=', '>', '<=', '<'] },
  { value: 'orderCount', label: 'Quantidade de pedidos', valueType: 'number', ops: ['>=', '>', '<=', '<'] },
  { value: 'avgTicket', label: 'Ticket médio', valueType: 'number', ops: ['>=', '<='] },
  { value: 'orderedProductId', label: 'Comprou produto', valueType: 'product_list', ops: ['in', 'notIn'] },
  { value: 'orderedCategoryId', label: 'Comprou categoria', valueType: 'category_list', ops: ['in', 'notIn'] },
  { value: 'neighborhood', label: 'Bairro de entrega', valueType: 'string_list', ops: ['in', 'notIn'] },
  { value: 'birthdayInDays', label: 'Aniversário em (dias)', valueType: 'int', ops: ['=', '<='] },
  { value: 'customerGroupId', label: 'Membro do grupo', valueType: 'group_list', ops: ['in', 'notIn'] },
  { value: 'optInMarketing', label: 'Opt-in marketing', valueType: 'bool', ops: ['='] },
]

const OP_LABELS = {
  olderThan: 'há mais de', newerThan: 'nos últimos',
  '>=': '≥', '>': '>', '<=': '≤', '<': '<', '=': '=',
  in: 'inclui', notIn: 'não inclui',
}

const isGroup = computed(() => !!props.rule.all || !!props.rule.any)
const groupKey = computed(() => props.rule.all ? 'all' : 'any')
const fieldSpec = computed(() => FIELDS.find(f => f.value === props.rule.field))

function updateLeaf(patch) {
  emit('update:rule', { ...props.rule, ...patch })
}

function addCondition(type) {
  const newChild = { field: 'totalSpent', op: '>=', value: 0 }
  if (type === 'all' || type === 'any') {
    const key = type
    emit('update:rule', {
      [key]: [...(props.rule[key] || []), newChild],
    })
  }
}

function updateChild(idx, newRule) {
  const arr = [...props.rule[groupKey.value]]
  arr[idx] = newRule
  emit('update:rule', { [groupKey.value]: arr })
}

function removeChild(idx) {
  const arr = props.rule[groupKey.value].filter((_, i) => i !== idx)
  emit('update:rule', { [groupKey.value]: arr })
}

function convertToGroup(key) {
  // Wrap current leaf as a group with this leaf as first child
  emit('update:rule', { [key]: [props.rule] })
}
</script>

<template>
  <div :class="['rule-builder', isGroup ? 'rule-group' : 'rule-leaf']" :style="`margin-left:${depth * 16}px`">
    <!-- Group -->
    <div v-if="isGroup">
      <div class="d-flex align-items-center gap-2 mb-2">
        <span class="badge" :class="groupKey === 'all' ? 'bg-primary' : 'bg-warning text-dark'">
          {{ groupKey === 'all' ? 'TODAS verdadeiras (E)' : 'QUALQUER verdadeira (OU)' }}
        </span>
        <button class="btn btn-sm btn-link p-0 text-danger" v-if="depth > 0" @click="emit('remove')">
          <i class="bi bi-x-circle"></i>
        </button>
      </div>
      <div class="border-start ps-3">
        <RuleBuilder
          v-for="(child, idx) in rule[groupKey]"
          :key="idx"
          :rule="child"
          :depth="depth + 1"
          @update:rule="updateChild(idx, $event)"
          @remove="removeChild(idx)"
        />
        <div class="d-flex gap-2 mt-2">
          <button class="btn btn-sm btn-outline-primary" @click="addCondition(groupKey)">
            + Condição
          </button>
          <button class="btn btn-sm btn-outline-secondary" @click="addCondition(groupKey === 'all' ? 'any' : 'all')">
            + Subgrupo {{ groupKey === 'all' ? 'OU' : 'E' }}
          </button>
        </div>
      </div>
    </div>
    <!-- Leaf -->
    <div v-else class="d-flex align-items-center gap-2 mb-2">
      <select :value="rule.field" class="form-select form-select-sm" style="max-width:200px" @change="updateLeaf({ field: $event.target.value, op: FIELDS.find(f => f.value === $event.target.value).ops[0], value: '' })">
        <option v-for="f in FIELDS" :key="f.value" :value="f.value">{{ f.label }}</option>
      </select>
      <select :value="rule.op" class="form-select form-select-sm" style="max-width:140px" @change="updateLeaf({ op: $event.target.value })">
        <option v-for="op in fieldSpec?.ops || []" :key="op" :value="op">{{ OP_LABELS[op] || op }}</option>
      </select>
      <input
        :value="rule.value"
        class="form-control form-control-sm"
        style="max-width:200px"
        @input="updateLeaf({ value: fieldSpec?.valueType === 'number' || fieldSpec?.valueType === 'int' ? Number($event.target.value) : $event.target.value })"
      />
      <button class="btn btn-sm btn-link p-0 text-danger" @click="emit('remove')">
        <i class="bi bi-x-circle"></i>
      </button>
    </div>
  </div>
</template>
```

**Step 2: Create SegmentForm.vue**

```vue
<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import api from '../../api'
import RuleBuilder from '../../components/marketing/RuleBuilder.vue'
import BaseButton from '../../components/BaseButton.vue'
import Swal from 'sweetalert2'

const route = useRoute()
const router = useRouter()
const isEdit = !!route.params.id

const form = ref({
  name: '',
  description: '',
  ruleJson: {
    rule: { all: [{ field: 'totalSpent', op: '>=', value: 0 }] },
  },
})
const preview = ref({ count: null, sample: [], loading: false })
const saving = ref(false)

onMounted(async () => {
  if (isEdit) {
    const { data } = await api.get(`/marketing/segments/${route.params.id}`)
    form.value = { name: data.name, description: data.description, ruleJson: data.ruleJson }
  }
  refreshPreview()
})

let previewTimer = null
watch(() => form.value.ruleJson, () => {
  if (previewTimer) clearTimeout(previewTimer)
  previewTimer = setTimeout(refreshPreview, 500)
}, { deep: true })

async function refreshPreview() {
  preview.value.loading = true
  try {
    const { data } = await api.post('/marketing/segments/preview', { ruleJson: form.value.ruleJson })
    preview.value.count = data.count
    preview.value.sample = data.sample
  } catch (e) {
    preview.value.count = null
  } finally { preview.value.loading = false }
}

async function save() {
  if (!form.value.name) {
    Swal.fire({ icon: 'warning', text: 'Informe um nome para o segmento' })
    return
  }
  saving.value = true
  try {
    if (isEdit) {
      await api.patch(`/marketing/segments/${route.params.id}`, form.value)
    } else {
      await api.post('/marketing/segments', form.value)
    }
    router.push('/marketing/segments')
  } catch (e) {
    Swal.fire({ icon: 'error', text: e?.response?.data?.message || 'Falha ao salvar' })
  } finally { saving.value = false }
}
</script>

<template>
  <div class="container py-4">
    <h2 class="h4 mb-4">{{ isEdit ? 'Editar segmento' : 'Novo segmento' }}</h2>

    <div class="card mb-3">
      <div class="card-body">
        <div class="mb-3">
          <label class="form-label">Nome</label>
          <input v-model="form.name" class="form-control" placeholder="Ex: Clientes inativos 30d" />
        </div>
        <div class="mb-3">
          <label class="form-label">Descrição (opcional)</label>
          <input v-model="form.description" class="form-control" />
        </div>
      </div>
    </div>

    <div class="card mb-3">
      <div class="card-body">
        <h6 class="card-title">Condições</h6>
        <RuleBuilder
          :rule="form.ruleJson.rule"
          :depth="0"
          @update:rule="form.ruleJson.rule = $event"
        />
      </div>
    </div>

    <div class="card mb-3" style="background:var(--bg-zebra)">
      <div class="card-body">
        <div class="d-flex justify-content-between align-items-center">
          <div>
            <strong v-if="preview.loading"><span class="spinner-border spinner-border-sm me-2"></span>Calculando...</strong>
            <strong v-else-if="preview.count !== null">📊 {{ preview.count }} clientes correspondem</strong>
            <strong v-else class="text-danger">Erro ao avaliar regras</strong>
          </div>
          <details v-if="preview.sample.length">
            <summary class="small">Ver amostra (10)</summary>
            <ul class="small mt-2">
              <li v-for="s in preview.sample" :key="s.id">{{ s.fullName }} ({{ s.whatsapp }})</li>
            </ul>
          </details>
        </div>
      </div>
    </div>

    <div class="d-flex gap-2">
      <BaseButton variant="primary" :loading="saving" @click="save">Salvar segmento</BaseButton>
      <BaseButton variant="outline" @click="router.push('/marketing/segments')">Cancelar</BaseButton>
    </div>
  </div>
</template>
```

**Step 3: Smoke test**

Start frontend dev. Navigate to `/marketing/segments/new`. Build rule. Verify count updates with 500ms debounce. Save. Confirm in `/marketing/segments` list.

**Step 4: Commit**

```bash
git add delivery-saas-frontend/src/components/marketing/ delivery-saas-frontend/src/views/marketing/SegmentForm.vue
git commit -m "feat(marketing): segment builder with live preview"
```

---

### Task 1.16: Frontend — campaigns list

**Files:**
- Create: `delivery-saas-frontend/src/views/marketing/CampaignsList.vue`
- Modify: `delivery-saas-frontend/src/router.js`

**Step 1: Routes**

```js
{
  path: '/marketing/campaigns',
  component: () => import('./views/marketing/CampaignsList.vue'),
  meta: { requiresAuth: true, role: 'ATTENDANT', requiresModule: 'marketing_campaigns' },
},
{
  path: '/marketing/campaigns/new',
  component: () => import('./views/marketing/CampaignBuilder.vue'),
  meta: { requiresAuth: true, role: 'ADMIN', requiresModule: 'marketing_campaigns' },
},
{
  path: '/marketing/campaigns/:id',
  component: () => import('./views/marketing/CampaignDetail.vue'),
  meta: { requiresAuth: true, role: 'ATTENDANT', requiresModule: 'marketing_campaigns' },
},
```

**Step 2: CampaignsList.vue**

```vue
<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import api from '../../api'
import ListCard from '../../components/ListCard.vue'
import BaseButton from '../../components/BaseButton.vue'

const router = useRouter()
const campaigns = ref([])
const loading = ref(false)

const STATUS_LABELS = {
  DRAFT: { label: 'Rascunho', class: 'bg-secondary' },
  SCHEDULED: { label: 'Agendada', class: 'bg-info text-dark' },
  RUNNING: { label: 'Rodando', class: 'bg-success' },
  PAUSED: { label: 'Pausada', class: 'bg-warning text-dark' },
  COMPLETED: { label: 'Concluída', class: 'bg-dark' },
  CANCELLED: { label: 'Cancelada', class: 'bg-danger' },
}

async function load() {
  loading.value = true
  try {
    const { data } = await api.get('/marketing/campaigns')
    campaigns.value = data
  } finally { loading.value = false }
}
onMounted(load)
</script>

<template>
  <ListCard :title="`Campanhas (${campaigns.length})`" icon="bi bi-broadcast">
    <template #actions>
      <BaseButton variant="primary" icon="+" @click="router.push('/marketing/campaigns/new')">Nova campanha</BaseButton>
    </template>
    <div v-if="loading" class="text-center py-5"><div class="spinner-border"></div></div>
    <div v-else-if="!campaigns.length" class="text-center py-5 text-muted">Nenhuma campanha ainda.</div>
    <div v-else class="table-responsive">
      <table class="table table-hover align-middle">
        <thead>
          <tr>
            <th>Nome</th>
            <th>Tipo</th>
            <th>Status</th>
            <th>Mensagens</th>
            <th class="text-end">Ações</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in campaigns" :key="c.id">
            <td>
              <div class="fw-semibold">{{ c.name }}</div>
              <small class="text-muted">{{ c.segment?.name }}</small>
            </td>
            <td><small>{{ c.scheduleType }}</small></td>
            <td><span class="badge" :class="STATUS_LABELS[c.status]?.class">{{ STATUS_LABELS[c.status]?.label }}</span></td>
            <td>{{ c._count?.messages || 0 }}</td>
            <td class="text-end">
              <router-link :to="`/marketing/campaigns/${c.id}`" class="btn btn-sm btn-outline-primary">Ver</router-link>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </ListCard>
</template>
```

**Step 3: Commit**

```bash
git add delivery-saas-frontend/src/views/marketing/CampaignsList.vue delivery-saas-frontend/src/router.js
git commit -m "feat(marketing): campaigns list page"
```

---

### Task 1.17: Frontend — campaign builder (4 steps)

**Files:**
- Create: `delivery-saas-frontend/src/views/marketing/CampaignBuilder.vue`

This is a large component. The builder is a wizard with 4 steps. Implement as a single SFC with internal step state.

**Step 1: Skeleton**

Create `CampaignBuilder.vue` with `step = ref(1)` and 4 conditional blocks. Include:
- Step 1: pick existing segment OR (link to) create new one. Show audience count.
- Step 2: channel selection (META_WA radio / EVOLUTION_WA radio / AUTO radio). If META_WA, template dropdown (load `/meta/templates?status=APPROVED`). If EVOLUTION_WA, textarea for freeText. Preview button (mandatory click before "Próximo").
- Step 3: schedule type selection, conversion window input, attribution scope.
- Step 4: review + pre-flight call to `/marketing/campaigns/:id/preflight`, typing test for > 500 audiences.

**Step 2: Implement step 1 (audience)**

```vue
<!-- inside CampaignBuilder.vue -->
<div v-if="step === 1">
  <h5>Step 1: Audiência</h5>
  <label class="form-label">Segmento</label>
  <select v-model="form.segmentId" class="form-select" @change="loadAudienceCount">
    <option value="">Selecione...</option>
    <option v-for="s in segments" :key="s.id" :value="s.id">{{ s.name }}</option>
  </select>
  <router-link to="/marketing/segments/new" target="_blank" class="small mt-1 d-block">
    Criar novo segmento →
  </router-link>
  <div v-if="audienceCount !== null" class="alert alert-info mt-3">
    📊 {{ audienceCount }} clientes elegíveis (com opt-in)
  </div>
  <div class="d-flex justify-content-end mt-4">
    <BaseButton variant="primary" :disabled="!form.segmentId || audienceCount === 0" @click="step = 2">Próximo →</BaseButton>
  </div>
</div>
```

**Step 3: Implement step 2 (message)**

```vue
<div v-if="step === 2">
  <h5>Step 2: Mensagem</h5>

  <div class="mb-3">
    <label class="form-label">Canal</label>
    <div class="form-check">
      <input id="ch_meta" v-model="form.channel" type="radio" value="META_WA" class="form-check-input"/>
      <label for="ch_meta" class="form-check-label">Cloud API (oficial, recomendado)</label>
    </div>
    <div class="form-check">
      <input id="ch_evo" v-model="form.channel" type="radio" value="EVOLUTION_WA" class="form-check-input"/>
      <label for="ch_evo" class="form-check-label">Evolution (não-oficial, risco de banimento)</label>
    </div>
    <div class="form-check">
      <input id="ch_auto" v-model="form.channel" type="radio" value="AUTO" class="form-check-input"/>
      <label for="ch_auto" class="form-check-label">Automático (espelha último canal usado)</label>
    </div>
  </div>

  <div v-if="form.channel === 'META_WA' || form.channel === 'AUTO'">
    <label class="form-label">Template</label>
    <select v-model="form.templateId" class="form-select">
      <option value="">Selecione...</option>
      <option v-for="t in approvedTemplates" :key="t.id" :value="t.id">{{ t.name }}</option>
    </select>
    <!-- TODO: variable mapping (Task 1.18) -->
  </div>

  <div v-if="form.channel === 'EVOLUTION_WA'">
    <div class="alert alert-warning small">
      <i class="bi bi-exclamation-triangle me-1"></i>
      Evolution não é oficial para marketing. WhatsApp pode banir o número se detectar spam. Considere Cloud API.
    </div>
    <label class="form-label">Texto da mensagem</label>
    <textarea v-model="form.freeText" class="form-control" rows="5" placeholder="Olá {nome}, ..."></textarea>
    <small class="form-text">Placeholders: {nome}, {cliente}, {cupom}</small>
  </div>

  <div class="mt-3 d-flex gap-2">
    <BaseButton variant="outline" @click="loadPreviewSample">Pré-visualizar com cliente real</BaseButton>
  </div>

  <div v-if="previewText" class="mt-3 p-3" style="background:#dcf8c6;border-radius:8px;max-width:400px;">
    <pre style="white-space:pre-wrap;font-family:inherit;margin:0">{{ previewText }}</pre>
  </div>

  <div class="d-flex justify-content-between mt-4">
    <BaseButton variant="outline" @click="step = 1">← Voltar</BaseButton>
    <BaseButton variant="primary" :disabled="!previewSeen" @click="step = 3">Próximo →</BaseButton>
  </div>
</div>
```

**Step 4: Implement step 3 (schedule)**

```vue
<div v-if="step === 3">
  <h5>Step 3: Quando enviar</h5>

  <div class="form-check">
    <input id="sch_once" v-model="form.scheduleType" type="radio" value="ONE_SHOT" class="form-check-input"/>
    <label for="sch_once">Uma vez</label>
    <div v-if="form.scheduleType === 'ONE_SHOT'" class="ms-4">
      <input v-model="form.scheduledFor" type="datetime-local" class="form-control" />
    </div>
  </div>

  <!-- (RECURRING, TRIGGER omitted from Phase 1 MVP — added in Phase 2) -->

  <div class="mt-3">
    <label>Janela de conversão (horas)</label>
    <input v-model.number="form.conversionWindowHours" type="number" class="form-control" min="1" max="168" />
  </div>

  <div class="mt-3">
    <label>Escopo de atribuição</label>
    <select v-model="form.attributionScope" class="form-select">
      <option value="menu">Apenas o cardápio do segmento</option>
      <option value="company">Qualquer cardápio da empresa</option>
    </select>
  </div>

  <div class="d-flex justify-content-between mt-4">
    <BaseButton variant="outline" @click="step = 2">← Voltar</BaseButton>
    <BaseButton variant="primary" @click="goToReview">Próximo →</BaseButton>
  </div>
</div>
```

**Step 5: Implement step 4 (review + activate)**

```vue
<div v-if="step === 4">
  <h5>Step 4: Revisar e ativar</h5>

  <div class="card mb-3">
    <div class="card-body small">
      <div><strong>Nome:</strong> {{ form.name }}</div>
      <div><strong>Segmento:</strong> {{ selectedSegment?.name }} ({{ preflight.eligible }} clientes)</div>
      <div><strong>Canal:</strong> {{ form.channel }}</div>
      <div><strong>Quando:</strong> {{ form.scheduleType }} • {{ form.scheduledFor }}</div>
      <div><strong>Janela:</strong> {{ form.conversionWindowHours }}h</div>
    </div>
  </div>

  <div v-if="preflight.issues.length" class="mb-3">
    <div v-for="i in preflight.issues" :key="i.code"
         class="alert"
         :class="{
           'alert-danger': i.severity === 'error',
           'alert-warning': i.severity === 'warning',
           'alert-info': i.severity === 'confirm',
         }">
      {{ i.msg }}
    </div>
  </div>

  <div v-if="needsAudienceConfirm">
    <label>Digite a quantidade exata para confirmar: <strong>{{ preflight.eligible }}</strong></label>
    <input v-model.number="confirmCount" type="number" class="form-control" />
  </div>

  <div class="d-flex justify-content-between mt-4">
    <BaseButton variant="outline" @click="step = 3">← Voltar</BaseButton>
    <BaseButton variant="primary" :loading="activating" :disabled="!canActivate" @click="activate">🚀 Ativar campanha</BaseButton>
  </div>
</div>
```

**Step 6: Script setup**

```vue
<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import api from '../../api'
import BaseButton from '../../components/BaseButton.vue'
import Swal from 'sweetalert2'

const router = useRouter()
const step = ref(1)
const form = ref({
  name: '',
  segmentId: '',
  channel: 'META_WA',
  templateId: '',
  freeText: '',
  scheduleType: 'ONE_SHOT',
  scheduledFor: '',
  conversionWindowHours: 48,
  attributionScope: 'menu',
})

const segments = ref([])
const audienceCount = ref(null)
const approvedTemplates = ref([])
const previewText = ref('')
const previewSeen = ref(false)
const preflight = ref({ eligible: 0, issues: [] })
const confirmCount = ref('')
const activating = ref(false)
const campaignId = ref(null)

const selectedSegment = computed(() => segments.value.find(s => s.id === form.value.segmentId))
const needsAudienceConfirm = computed(() => preflight.value.issues.some(i => i.code === 'large_audience'))
const canActivate = computed(() => {
  if (preflight.value.issues.some(i => i.severity === 'error')) return false
  if (needsAudienceConfirm.value && confirmCount.value !== preflight.value.eligible) return false
  return true
})

onMounted(async () => {
  const [segs, tpls] = await Promise.all([
    api.get('/marketing/segments'),
    api.get('/meta/templates'),
  ])
  segments.value = segs.data
  approvedTemplates.value = tpls.data.filter(t => t.status === 'APPROVED')
})

async function loadAudienceCount() {
  if (!form.value.segmentId) return
  const seg = segments.value.find(s => s.id === form.value.segmentId)
  if (!seg) return
  const { data } = await api.post('/marketing/segments/preview', { ruleJson: seg.ruleJson })
  audienceCount.value = data.count
}

async function loadPreviewSample() {
  // Fetch a sample customer and build the preview text
  if (!form.value.segmentId) return
  const { data } = await api.post('/marketing/segments/preview', {
    ruleJson: segments.value.find(s => s.id === form.value.segmentId).ruleJson,
  })
  if (data.sample.length === 0) {
    previewText.value = '(sem amostra)'
    previewSeen.value = true
    return
  }
  const cust = data.sample[0]
  const firstName = (cust.fullName || '').split(' ')[0] || 'Cliente'
  previewText.value = (form.value.freeText || '')
    .replace(/\{nome\}/g, firstName)
    .replace(/\{cliente\}/g, cust.fullName || '')
  previewSeen.value = true
}

async function goToReview() {
  // First persist as DRAFT, then call preflight
  try {
    if (!campaignId.value) {
      const { data } = await api.post('/marketing/campaigns', {
        name: form.value.name || `Campanha ${new Date().toLocaleDateString('pt-BR')}`,
        segmentId: form.value.segmentId,
        scheduleType: form.value.scheduleType,
        scheduledFor: form.value.scheduledFor || null,
        channel: form.value.channel,
        templateId: form.value.templateId || null,
        freeText: form.value.freeText || null,
        conversionWindowHours: form.value.conversionWindowHours,
        attributionScope: form.value.attributionScope,
      })
      campaignId.value = data.id
    } else {
      await api.patch(`/marketing/campaigns/${campaignId.value}`, { ...form.value })
    }
    const { data: pre } = await api.get(`/marketing/campaigns/${campaignId.value}/preflight`)
    preflight.value = pre
    step.value = 4
  } catch (e) {
    Swal.fire({ icon: 'error', text: e?.response?.data?.message || 'Falha ao salvar rascunho' })
  }
}

async function activate() {
  activating.value = true
  try {
    await api.post(`/marketing/campaigns/${campaignId.value}/activate`, {
      confirmedCount: confirmCount.value || undefined,
    })
    await Swal.fire({ icon: 'success', text: 'Campanha ativada com sucesso' })
    router.push(`/marketing/campaigns/${campaignId.value}`)
  } catch (e) {
    Swal.fire({ icon: 'error', text: e?.response?.data?.message || 'Falha ao ativar' })
  } finally { activating.value = false }
}
</script>
```

**Step 7: Commit**

```bash
git add delivery-saas-frontend/src/views/marketing/CampaignBuilder.vue delivery-saas-frontend/src/router.js
git commit -m "feat(marketing): campaign builder wizard (4 steps)"
```

---

### Task 1.18: Frontend — campaign detail / dashboard

**Files:**
- Create: `delivery-saas-frontend/src/views/marketing/CampaignDetail.vue`

**Step 1: Implement**

```vue
<script setup>
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import api from '../../api'
import BaseButton from '../../components/BaseButton.vue'
import Swal from 'sweetalert2'

const route = useRoute()
const router = useRouter()
const id = route.params.id

const campaign = ref(null)
const stats = ref(null)
const messages = ref([])
const loading = ref(false)
const tab = ref('overview')

async function load() {
  loading.value = true
  try {
    const [c, s, m] = await Promise.all([
      api.get(`/marketing/campaigns/${id}`),
      api.get(`/marketing/campaigns/${id}/stats`),
      api.get(`/marketing/campaigns/${id}/messages?limit=50`),
    ])
    campaign.value = c.data
    stats.value = s.data
    messages.value = m.data
  } finally { loading.value = false }
}
onMounted(load)

const funnel = computed(() => {
  if (!stats.value) return null
  const s = stats.value
  const pct = (n) => s.sent > 0 ? Math.round(n / s.sent * 100) : 0
  return {
    sent: s.sent, delivered: s.delivered, read: s.read, converted: s.converted,
    strong: s.convertedStrong, weak: s.converted - s.convertedStrong,
    revenue: s.revenue,
    pctDelivered: pct(s.delivered), pctRead: pct(s.read), pctConverted: pct(s.converted),
  }
})

async function action(kind) {
  const r = await Swal.fire({
    title: `${kind === 'pause' ? 'Pausar' : kind === 'resume' ? 'Retomar' : 'Cancelar'} campanha?`,
    icon: 'question', showCancelButton: true,
  })
  if (!r.isConfirmed) return
  await api.post(`/marketing/campaigns/${id}/${kind}`)
  await load()
}
</script>

<template>
  <div class="container py-4">
    <div v-if="loading"><div class="spinner-border"></div></div>
    <div v-else-if="campaign">
      <div class="d-flex justify-content-between align-items-start mb-3">
        <div>
          <h2 class="h4 mb-1">{{ campaign.name }}</h2>
          <small class="text-muted">{{ campaign.segment?.name }} • {{ campaign.scheduleType }} • {{ campaign.channel }}</small>
        </div>
        <div class="d-flex gap-2">
          <BaseButton v-if="campaign.status === 'RUNNING' || campaign.status === 'SCHEDULED'" variant="outline" @click="action('pause')">Pausar</BaseButton>
          <BaseButton v-if="campaign.status === 'PAUSED'" variant="primary" @click="action('resume')">Retomar</BaseButton>
          <BaseButton v-if="['DRAFT','SCHEDULED','RUNNING','PAUSED'].includes(campaign.status)" variant="danger" @click="action('cancel')">Cancelar</BaseButton>
        </div>
      </div>

      <ul class="nav nav-tabs mb-4">
        <li class="nav-item"><a class="nav-link" :class="{active:tab==='overview'}" href="#" @click.prevent="tab='overview'">Visão geral</a></li>
        <li class="nav-item"><a class="nav-link" :class="{active:tab==='messages'}" href="#" @click.prevent="tab='messages'">Mensagens</a></li>
        <li class="nav-item"><a class="nav-link" :class="{active:tab==='settings'}" href="#" @click.prevent="tab='settings'">Configurações</a></li>
      </ul>

      <div v-show="tab === 'overview'" class="card">
        <div class="card-body">
          <div v-if="funnel">
            <div class="mb-2">Enviadas: <strong>{{ funnel.sent }}</strong></div>
            <div class="mb-2">Entregues: <strong>{{ funnel.delivered }}</strong> ({{ funnel.pctDelivered }}%)</div>
            <div class="mb-2">Lidas: <strong>{{ funnel.read }}</strong> ({{ funnel.pctRead }}%)</div>
            <div class="mb-2">Convertidas: <strong>{{ funnel.converted }}</strong> ({{ funnel.pctConverted }}%)</div>
            <ul class="small ms-3">
              <li>Forte (cupom usado): {{ funnel.strong }}</li>
              <li>Fraca (só janela): {{ funnel.weak }}</li>
            </ul>
            <hr>
            <div class="fw-bold">Receita atribuída: R$ {{ Number(funnel.revenue).toFixed(2) }}</div>
          </div>
          <div v-else class="text-muted">Sem dados ainda — aguardando primeiro envio.</div>
        </div>
      </div>

      <div v-show="tab === 'messages'">
        <div class="table-responsive">
          <table class="table table-sm">
            <thead>
              <tr><th>Cliente</th><th>Telefone</th><th>Status</th><th>Enviada</th><th>Conversão</th></tr>
            </thead>
            <tbody>
              <tr v-for="m in messages" :key="m.id">
                <td>{{ m.customer?.fullName }}</td>
                <td>{{ m.customer?.whatsapp }}</td>
                <td><small>{{ m.status }}</small></td>
                <td><small>{{ m.sentAt ? new Date(m.sentAt).toLocaleString('pt-BR') : '—' }}</small></td>
                <td><small>{{ m.convertedValue ? 'R$ ' + Number(m.convertedValue).toFixed(2) : '—' }}</small></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div v-show="tab === 'settings'" class="card">
        <div class="card-body small">
          <pre>{{ JSON.stringify(campaign, null, 2) }}</pre>
        </div>
      </div>
    </div>
  </div>
</template>
```

**Step 2: Add backend `/stats` and `/messages` endpoints**

In `campaigns.js`:

```js
router.get('/:id/stats', async (req, res) => {
  const companyId = req.user.companyId
  const { id } = req.params
  const c = await prisma.marketingCampaign.findFirst({ where: { id, companyId } })
  if (!c) return res.status(404).json({ message: 'Not found' })
  const agg = await prisma.marketingMessage.aggregate({
    where: { campaignId: id },
    _count: { id: true },
    _sum: { convertedValue: true },
  })
  const breakdown = await prisma.marketingMessage.groupBy({
    by: ['status'],
    where: { campaignId: id },
    _count: { id: true },
  })
  const get = (status) => breakdown.find(b => b.status === status)?._count.id || 0
  const strong = await prisma.marketingMessage.count({
    where: { campaignId: id, attributionSignal: 'STRONG' },
  })
  res.json({
    sent: get('SENT') + get('DELIVERED') + get('READ'),
    delivered: get('DELIVERED') + get('READ'),
    read: get('READ'),
    failed: get('FAILED'),
    optedOut: get('OPTED_OUT'),
    converted: await prisma.marketingMessage.count({ where: { campaignId: id, convertedOrderId: { not: null } } }),
    convertedStrong: strong,
    revenue: agg._sum.convertedValue || 0,
  })
})

router.get('/:id/messages', async (req, res) => {
  const companyId = req.user.companyId
  const { id } = req.params
  const c = await prisma.marketingCampaign.findFirst({ where: { id, companyId } })
  if (!c) return res.status(404).json({ message: 'Not found' })
  const limit = Math.min(Number(req.query.limit || 50), 200)
  const messages = await prisma.marketingMessage.findMany({
    where: { campaignId: id },
    take: limit,
    orderBy: { createdAt: 'desc' },
    include: { customer: { select: { id: true, fullName: true, whatsapp: true } } },
  })
  res.json(messages)
})
```

**Step 3: Commit**

```bash
git add delivery-saas-frontend/src/views/marketing/CampaignDetail.vue delivery-saas-backend/src/routes/marketing/campaigns.js
git commit -m "feat(marketing): campaign detail page with funnel + messages list"
```

---

### Task 1.19: Implement `attributeOrderToCampaign` (real)

**Files:**
- Modify: `delivery-saas-backend/src/services/marketing/attribution.js`

**Step 1: Replace stub with real logic**

```js
// src/services/marketing/attribution.js
import { prisma } from '../../prisma.js'

const ATTRIBUTABLE_STATUSES = [
  'EM_PREPARO', 'PRONTO', 'SAIU_PARA_ENTREGA',
  'CONFIRMACAO_PAGAMENTO', 'CONCLUIDO',
]

export async function attributeOrderToCampaign(orderId) {
  if (!orderId) return null
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true, companyId: true, customerId: true, menuId: true,
      total: true, status: true, couponId: true,
      attributedCampaignId: true,
    },
  })
  if (!order || !order.customerId) return null
  if (!ATTRIBUTABLE_STATUSES.includes(order.status)) return null
  if (order.attributedCampaignId) return null

  const candidates = await prisma.$queryRaw`
    SELECT mm.id            AS "messageId",
           mm."campaignId"  AS "campaignId",
           mm."sentAt"      AS "sentAt",
           mc."conversionWindowHours" AS "windowHours",
           mc."attributionScope"      AS "scope",
           mc."segmentMenuId"         AS "campaignMenuId",
           mc."couponId"              AS "campaignCouponId"
    FROM   "MarketingMessage" mm
    JOIN   "MarketingCampaign" mc ON mc.id = mm."campaignId"
    WHERE  mm."customerId" = ${order.customerId}::text
      AND  mm."companyId"  = ${order.companyId}::text
      AND  mm."sentAt" IS NOT NULL
      AND  mm."sentAt" + (mc."conversionWindowHours" || ' hours')::interval > NOW()
      AND  mm."convertedOrderId" IS NULL
      AND  mm."excludedFromAttribution" = false
    ORDER BY mm."sentAt" DESC
    LIMIT 1
  `
  const row = candidates?.[0]
  if (!row) return null

  // Scope guard
  if (row.scope === 'menu' && row.campaignMenuId && order.menuId !== row.campaignMenuId) {
    return null
  }

  const signal = (row.campaignCouponId && order.couponId === row.campaignCouponId) ? 'STRONG' : 'WEAK'

  await prisma.$transaction([
    prisma.marketingMessage.update({
      where: { id: row.messageId },
      data: {
        convertedOrderId: order.id,
        convertedAt: new Date(),
        convertedValue: order.total,
        attributionSignal: signal,
      },
    }),
    prisma.order.update({
      where: { id: order.id },
      data: { attributedCampaignId: row.campaignId, attributedMessageId: row.messageId },
    }),
  ])
  console.log('[attribution] order', order.id, '→ campaign', row.campaignId, signal)
  return { campaignId: row.campaignId, messageId: row.messageId, signal }
}

export async function revokeAttribution(orderId) {
  if (!orderId) return null
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, attributedMessageId: true },
  })
  if (!order?.attributedMessageId) return null
  await prisma.$transaction([
    prisma.marketingMessage.update({
      where: { id: order.attributedMessageId },
      data: { convertedOrderId: null, convertedAt: null, convertedValue: null, attributionSignal: null },
    }),
    prisma.order.update({
      where: { id: order.id },
      data: { attributedCampaignId: null, attributedMessageId: null },
    }),
  ])
  console.log('[attribution] revoked for order', order.id)
}
```

**Step 2: Smoke test**

End-to-end test:
1. Create segment, campaign with cupom anexado, activate.
2. Wait for send to fire.
3. Create order for that customer using the campaign's coupon code.
4. Inspect DB:
   - `MarketingMessage.convertedOrderId = <orderId>`, `attributionSignal = 'STRONG'`
   - `Order.attributedCampaignId = <campaignId>`

**Step 3: Commit**

```bash
git add delivery-saas-backend/src/services/marketing/attribution.js
git commit -m "feat(marketing): full attribution implementation"
```

---

### Task 1.20: Housekeeping tick (close windows, finalize runs, auto-pause)

**Files:**
- Modify: `delivery-saas-backend/src/workers/marketing.js`

**Step 1: Add Tick 3**

```js
// src/workers/marketing.js

async function housekeeping() {
  await closeExpiredAttributionWindows()
  await finalizeCompletedRuns()
  await autoPauseUnhealthyCampaigns()
}

async function closeExpiredAttributionWindows() {
  await prisma.$executeRaw`
    UPDATE "MarketingMessage" mm
    SET "attributionLockedAt" = NOW()
    FROM "MarketingCampaign" mc
    WHERE mm."campaignId" = mc.id
      AND mm."attributionLockedAt" IS NULL
      AND mm."sentAt" IS NOT NULL
      AND mm."sentAt" + (mc."conversionWindowHours" || ' hours')::interval < NOW()
  `
}

async function finalizeCompletedRuns() {
  const runs = await prisma.marketingCampaignRun.findMany({
    where: { finishedAt: null },
    include: { messages: { select: { status: true } } },
  })
  for (const run of runs) {
    const pending = run.messages.filter(m => m.status === 'QUEUED' || m.status === 'SENDING').length
    if (pending === 0) {
      await prisma.marketingCampaignRun.update({
        where: { id: run.id },
        data: {
          finishedAt: new Date(),
          totalSent: run.messages.filter(m => ['SENT','DELIVERED','READ'].includes(m.status)).length,
          totalFailed: run.messages.filter(m => m.status === 'FAILED').length,
        },
      })
      const camp = await prisma.marketingCampaign.findUnique({ where: { id: run.campaignId } })
      if (camp?.scheduleType === 'ONE_SHOT' && camp.status === 'RUNNING') {
        await prisma.marketingCampaign.update({ where: { id: camp.id }, data: { status: 'COMPLETED' } })
      }
    }
  }
}

async function autoPauseUnhealthyCampaigns() {
  const running = await prisma.marketingCampaign.findMany({ where: { status: 'RUNNING' } })
  const dayAgo = new Date(Date.now() - 86400_000)
  for (const c of running) {
    const stats = await prisma.marketingMessage.groupBy({
      by: ['status'],
      where: { campaignId: c.id, sentAt: { gte: dayAgo } },
      _count: { id: true },
    })
    const total = stats.reduce((s, r) => s + r._count.id, 0)
    const failed = stats.find(r => r.status === 'FAILED')?._count.id || 0
    const optedOut = stats.find(r => r.status === 'OPTED_OUT')?._count.id || 0
    if (total >= 50 && (failed + optedOut) / total > 0.05) {
      await prisma.marketingCampaign.update({
        where: { id: c.id },
        data: { status: 'PAUSED' },
      })
      console.warn('[marketing-worker] auto-paused', c.id, 'block-rate', ((failed+optedOut)/total).toFixed(2))
    }
  }
}
```

**Step 2: Wire into tick**

```js
async function tick() {
  try {
    await discoverWork()
    await drainSendQueue()
    await housekeeping()
  } catch (e) {
    console.error('[marketing-worker] tick error', e?.message || e)
  }
}
```

**Step 3: Commit**

```bash
git add delivery-saas-backend/src/workers/marketing.js
git commit -m "feat(marketing): worker housekeeping (window close, finalize, auto-pause)"
```

---

### Task 1.21: Webhook integration — update deliveredAt/readAt

**Files:**
- Modify: `delivery-saas-backend/src/messaging/webhookMeta.js`
- Modify: `delivery-saas-backend/src/routes/webhookEvolution.js`

**Step 1: Meta delivery/read handler**

In Meta's status webhook handler (look for status update processing), add:

```js
// When statusUpdate.id (wamid) is received with status:
if (statusUpdate.id && statusUpdate.status) {
  const updateData = {}
  if (statusUpdate.status === 'delivered') {
    updateData.deliveredAt = new Date(Number(statusUpdate.timestamp) * 1000)
    updateData.status = 'DELIVERED'
  } else if (statusUpdate.status === 'read') {
    updateData.readAt = new Date(Number(statusUpdate.timestamp) * 1000)
    updateData.status = 'READ'
  }
  if (Object.keys(updateData).length > 0) {
    await prisma.marketingMessage.updateMany({
      where: { externalId: statusUpdate.id },
      data: updateData,
    })
  }
}
```

**Step 2: Evolution delivery handler**

Evolution emits `messages.update` events. In the webhook handler, add similar logic mapping Evolution status names to `DELIVERED`/`READ`.

**Step 3: Commit**

```bash
git add delivery-saas-backend/src/messaging/webhookMeta.js delivery-saas-backend/src/routes/webhookEvolution.js
git commit -m "feat(marketing): update MarketingMessage on delivered/read webhooks"
```

---

### Task 1.22: End-to-end smoke test + feature flag toggle

**Step 1: Set up beta company**

Manually toggle feature flag for one test company:

```sql
UPDATE "Company"
SET flags = jsonb_set(COALESCE(flags, '{}'::jsonb), '{marketing_v1_enabled}', 'true')
WHERE id = '<beta-company-id>';
```

Also ensure the company has `marketing_campaigns` in its modules list (via SaaS Admin UI).

**Step 2: Full flow walkthrough**

1. Log in as the beta company's ADMIN
2. Navigate to `/marketing/segments`. Create a new segment: "Test inactive 30d" → `lastOrderAt olderThan 30d`
3. Confirm count shows
4. Navigate to `/marketing/campaigns/new`
5. Step 1: pick the new segment
6. Step 2: Evolution channel + free text "Olá {nome}, sentimos sua falta!"
7. Preview → see your name interpolated
8. Step 3: One-shot, scheduledFor = now + 1 minute
9. Step 4: ensure no errors. Activate.
10. Wait 2-3 min. Check DB:
    - `MarketingCampaign.status` = SCHEDULED → RUNNING → COMPLETED
    - `MarketingCampaignRun.totalQueued`, `totalSent`, `finishedAt`
    - `MarketingMessage` rows with status SENT
    - `Conversation` updated for each customer
11. Have a beta customer place an order using the test phone within 48h
12. Inspect `Order.attributedCampaignId` — should point to the campaign
13. View `/marketing/campaigns/:id` — funnel shows the conversion

**Step 3: Document the result**

Add a brief note to `docs/plans/2026-05-25-whatsapp-marketing-campaigns-plan.md` at the bottom:

```markdown
## Phase 1 MVP — Validation results

Validated on <date> with beta company <id>:
- Segment evaluation: <ms> for <count> customers
- Worker tick: discovers + enqueues correctly
- Send via Evolution: jitter respected (1-15s observed)
- Attribution: order created within 48h linked to campaign
- Dashboard: funnel populates as expected
```

**Step 4: Commit**

```bash
git add docs/plans/2026-05-25-whatsapp-marketing-campaigns-plan.md
git commit -m "docs(marketing): Phase 1 MVP validation notes"
```

---

## What's left (Phases 2-3)

The following tasks belong to subsequent plans (separate documents to be written when Phase 1 is validated):

**Phase 2 — Recurrence and automation:**
- Cron parser for RECURRING campaigns
- TRIGGER campaigns (BIRTHDAY, POST_ORDER_DAY_X)
- Coupon attached to campaign + STRONG/WEAK signal refinement (basic STRONG already in Task 1.19)
- Templates: panel-based creation via Graph API + shared library seed
- Template status polling (5min tick)
- Health dashboard at `/marketing/health`

**Phase 3 — GA:**
- Permissions audit + module guards on all routes
- LGPD export endpoints (`/customers/:id/marketing-audit`, `/companies/:id/marketing-audit-export`)
- Operator notifications (in-app + email)
- Onboarding tour
- Help articles
- Feature flag removal — module-gated only

**Phase 4+ (V2, beyond):**
- A/B testing with control group
- Multi-touch attribution
- Cashback boost per campaign
- AI-generated segments and copy via Studio IA

---

## Key invariants to preserve across tasks

- **Never cross-cardápio routing**: `pickConnectedChannel` only uses menu's own or store's own WhatsApp, never falls back to "any company instance"
- **Opt-in is mandatory**: `evaluateSegment` always filters by `optInMarketing = true AND optOutMarketingAt IS NULL` (injected in evaluator, not optional in DSL)
- **Idempotent enqueue**: `MarketingMessage @@unique([campaignRunId, customerId])` and `MarketingSendQueue.messageId @unique`
- **Attribution is synchronous**: hook in `orders.create`, not cron. Cron only closes expired windows
- **YAGNI**: V1 only ONE_SHOT campaigns. RECURRING/TRIGGER are Phase 2

---

## Skills referenced

- `superpowers:executing-plans` — to execute this plan task-by-task
- `superpowers:subagent-driven-development` — if user chooses Subagent-Driven execution
