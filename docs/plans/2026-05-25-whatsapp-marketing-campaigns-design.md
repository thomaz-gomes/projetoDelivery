# WhatsApp Marketing Campaigns — Design

**Date:** 2026-05-25
**Status:** Approved, ready for implementation planning
**Module key:** `marketing_campaigns` (new SaaS module)
**Scope:** V1 complete (ONE_SHOT + RECURRING + TRIGGER + retry queue + frequency cap + quiet hours + auto-pause)

## Goal

Build a programmable WhatsApp campaign tool that works with both Meta Cloud API (official) and Evolution (unofficial), within Meta's policies, supports declarative customer segmentation, conversion attribution with configurable window, and the safeguards needed to operate at scale without burning the WhatsApp number's reputation.

## Hard constraint that shapes everything

Meta divides conversations into two regions:
- **Inside the 24h window** (customer messaged us in the last 24h): we can send free-form text.
- **Outside the window**: we can only send Meta-approved templates.

Campaigns by definition target customers who haven't messaged recently, so **every campaign sent via Cloud API must use an approved template**. The template approval cycle is therefore a first-class concern.

Evolution doesn't have this restriction (it's WhatsApp Web protocol), but that's exactly why Meta forbids it for marketing. Using Evolution for mass sends is the fastest path to having the number banned. The system allows it (the operator might want it) but with strong safeguards: 1-15s random jitter between sends, explicit warnings in the UI, and auto-pause at 5% block-rate.

## Architecture overview

```
┌─────────────┐    ┌────────────┐    ┌────────────────┐    ┌──────────┐
│ Segments    │───→│ Campaigns  │───→│ SendQueue      │───→│ Adapters │
│ (DSL JSON)  │    │ (ONE_SHOT/ │    │ (PG, SKIP      │    │ Cloud +  │
│             │    │  RECURRING/│    │  LOCKED)       │    │ Evo (1-15│
│ avaliação   │    │  TRIGGER)  │    │                │    │ s jitter)│
│ on-demand   │    └────────────┘    └────────────────┘    └────┬─────┘
└─────────────┘                              │                  │
                                             ↓                  ↓
                                       MarketingMessage    Conversation
                                       + attribution       (inbox)
                                             ↑
                                             │
                                  Order.create() hook
                                  (atribuição síncrona)
```

**Components:**
- Backend Node/Express (same process as main app): REST routes + worker as `setInterval`
- PostgreSQL: new tables + new fields on Customer/Order
- Reuses existing `whatsappMetaAdapter` and `evoSendText`
- Frontend Vue: 3 new screens (campaigns list, campaign builder, campaign dashboard) + segments list + health dashboard
- Templates: create directly from panel via Graph API, plus shared library of pre-approved templates

**Flow:**
1. Operator creates segment (declarative rules over Customer/Order data)
2. Creates campaign → picks channel (Cloud+template or Evolution+free text) → schedules
3. Worker tick (every 30s) discovers eligible campaigns, re-evaluates segment, enqueues `SendQueue` rows
4. Worker drains queue respecting Evolution jitter + Meta rate limits
5. Each send creates a `MarketingMessage` row plus a `Conversation`/`Message` so it appears in the inbox
6. Meta/Evolution webhooks update `deliveredAt`/`readAt`
7. When the customer creates an order, a synchronous hook in `orders.create` looks up the most recent `MarketingMessage` within the campaign's conversion window — if found, connects the two

## Data model

### New models

```prisma
model MarketingSegment {
  id              String   @id @default(uuid())
  companyId       String
  company         Company  @relation(fields: [companyId], references: [id])
  name            String
  description     String?
  ruleJson        Json     // declarative DSL
  estimatedSize   Int?     // cached count
  lastEvaluatedAt DateTime?
  active          Boolean  @default(true)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  campaigns       MarketingCampaign[]

  @@unique([companyId, name])
  @@index([companyId])
}

enum MarketingScheduleType { ONE_SHOT  RECURRING  TRIGGER }
enum MarketingCampaignStatus { DRAFT  SCHEDULED  RUNNING  PAUSED  COMPLETED  CANCELLED }
enum MarketingChannel { META_WA  EVOLUTION_WA  AUTO }
enum MarketingAttributionScope { menu  company }

model MarketingCampaign {
  id                      String   @id @default(uuid())
  companyId               String
  segmentId               String
  segment                 MarketingSegment @relation(fields: [segmentId], references: [id])
  name                    String
  scheduleType            MarketingScheduleType
  scheduledFor            DateTime?      // ONE_SHOT
  cronExpression          String?        // RECURRING
  triggerType             String?        // 'BIRTHDAY' | 'POST_ORDER_DAY_X' | ...
  triggerParams           Json?
  channel                 MarketingChannel @default(AUTO)
  templateId              String?        // FK MetaTemplate (Cloud)
  template                MetaTemplate?  @relation(fields: [templateId], references: [id])
  freeText                String?        // Evolution
  templateVariableMap     Json?
  conversionWindowHours   Int      @default(48)
  conversionStatuses      String[] @default(['EM_PREPARO','PRONTO','SAIU_PARA_ENTREGA','CONFIRMACAO_PAGAMENTO','CONCLUIDO'])
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

enum MarketingMessageStatus { QUEUED  SENDING  SENT  DELIVERED  READ  FAILED  OPTED_OUT }

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
  externalId               String?     // wamid (Cloud) or Evolution id
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
  attributionSignal        String?  // 'STRONG' (coupon used) | 'WEAK' (window only)
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

### Changes to existing models

```prisma
model Customer {
  // ...
  optInMarketing       Boolean   @default(false)
  optInMarketingAt     DateTime?
  optInMarketingSource String?   // 'checkout' | 'inbound' | 'manual'
  optOutMarketingAt    DateTime?
}

model Order {
  // ...
  attributedCampaignId  String?
  attributedMessageId   String?  @unique
  attributedCampaign    MarketingCampaign? @relation(fields: [attributedCampaignId], references: [id])
}

model MetaTemplate {
  // ...
  createdViaApp     Boolean   @default(false)
  submittedByUserId String?
  submittedAt       DateTime?
  rejectionReason   String?
  lastSyncedAt      DateTime?
}
```

### Why Postgres queue, not Redis

`MarketingSendQueue` uses `FOR UPDATE SKIP LOCKED` (Postgres ≥9.5). Handles tens of thousands of jobs without Redis/BullMQ. Advantages: zero new infrastructure, atomic transactions with `MarketingMessage`, simpler deploys. Trade-off: at >100k jobs/day Redis becomes worthwhile, but that's far from current scale.

### Migrations (3 separate)

1. `add_marketing_module` — all new models + enums
2. `customer_opt_in_fields` — Customer fields
3. `order_attribution_fields` — Order fields

Separated so each can be reverted independently if production has issues.

## Segment DSL

### JSON shape

```json
{
  "version": 1,
  "menuId": "menu-lanchao",
  "rule": {
    "all": [
      { "field": "lastOrderAt", "op": "olderThan", "value": "30d" },
      { "field": "totalSpent", "op": ">=", "value": 100 },
      { "any": [
        { "field": "orderedProductId", "op": "in", "value": ["prod-x"] },
        { "field": "orderedCategoryId", "op": "in", "value": ["cat-z"] }
      ]},
      { "field": "optInMarketing", "op": "=", "value": true }
    ]
  }
}
```

### Vocabulary (V1)

| Field | Type | Ops |
|---|---|---|
| `lastOrderAt` | datetime | `olderThan`, `newerThan`, `between` |
| `firstOrderAt` | datetime | same |
| `totalSpent` | decimal | `>=`, `>`, `<=`, `<`, `between` |
| `orderCount` | int | same |
| `avgTicket` | decimal | same |
| `orderedProductId` | uuid[] | `in`, `notIn` |
| `orderedCategoryId` | uuid[] | `in`, `notIn` |
| `lastProductId` | uuid[] | `in`, `notIn` |
| `lastOrderTotal` | decimal | `>=`, `<=`, `between` |
| `neighborhood` | string[] | `in`, `notIn` |
| `paymentMethod` | string[] | `in`, `notIn` |
| `birthdayInDays` | int | `=`, `<=` |
| `customerCreatedAt` | datetime | `olderThan`, `newerThan` |
| `customerGroupId` | uuid[] | `in`, `notIn` |
| `cashbackBalance` | decimal | `>=`, `<=` |
| `optInMarketing` | bool | `=` (auto-injected) |
| `optOutMarketingAt` | datetime | `isNull`, `isNotNull` (auto-injected) |

### Compiler

Translates `ruleJson` → SQL `EXISTS`/`NOT EXISTS` subqueries against Customer. `optInMarketing = true` and `optOutMarketingAt IS NULL` are always injected. All input is whitelist-validated (operators, field names, value formats) before reaching SQL — no injection surface.

### Performance

- Partial index on `MarketingMessage(customerId, sentAt DESC) WHERE convertedOrderId IS NULL AND excludedFromAttribution = false` — accelerates attribution lookup
- `EXISTS` subqueries instead of JOINs — Postgres planner handles variable cardinality better
- Target: <200ms for 50k customers + 200k orders — fast enough for live count in the builder

## Campaign builder UX

Four-step wizard:

**Step 1 — Audience.** Choose existing saved segment OR build new one inline. Live count refreshes with 500ms debounce. Cannot proceed if audience = 0.

**Step 2 — Message.** Channel (Cloud / Evolution / Auto), template selection (Cloud) or free text (Evolution), variable mapping, optional attached coupon (auto-expires with conversion window). **Preview with real customer is mandatory** — "Next" button gated by interaction with preview.

**Step 3 — Schedule.** ONE_SHOT (now/scheduled), RECURRING (cron), TRIGGER (birthday, post-order day X). Conversion window in hours, attribution scope (menu/company). Quiet hours range (default 8h-21h, company timezone).

**Step 4 — Review.** Checklist of compliance gates passed, audience preview, cost estimate (Cloud only), tier of the phone number. For audiences > 500: typing test to confirm exact count.

### State machine

```
DRAFT ──(save)──► DRAFT
DRAFT ──(activate)──► SCHEDULED ──(scheduledFor reached)──► RUNNING
RUNNING ──(queue empty)──► COMPLETED        (ONE_SHOT)
RUNNING ──(operator)──► PAUSED ──(operator)──► RUNNING
RUNNING ──(auto block-rate>5%)──► PAUSED + notify operator
SCHEDULED/RUNNING ──(operator)──► CANCELLED  (irreversible)
```

## Worker / Sender

Runs as `setInterval(tick, 30_000)` in the main backend process. Migrate to separate process if volume justifies later.

### Tick 1 — Discover work

- ONE_SHOT campaigns with `scheduledFor <= now AND status = SCHEDULED` → enqueue run
- RECURRING campaigns with cron expression matching now → check dedupe (no run in last 5min), enqueue
- TRIGGER campaigns matching their trigger condition → enqueue

### `enqueueRun(campaign)` pipeline

1. Re-evaluate segment (never uses cache — always fresh)
2. For RECURRING: subtract customers already reached by this campaign
3. Apply frequency cap (max 2 marketing messages per customer per 7-day rolling window)
4. Create `MarketingCampaignRun` + `MarketingMessage` rows + `MarketingSendQueue` jobs in single transaction
5. Compute send slots respecting quiet hours + jitter
6. For ONE_SHOT, set campaign status to RUNNING

### Send slot computation

- **Cloud API:** ~5 sends/sec baseline, throttle down if Meta's `X-Business-Use-Case-Usage` header exceeds 80%
- **Evolution:** random 1-15s jitter between sends (mimics human cadence)
- **Quiet hours:** if slot falls outside 8h-21h company-timezone, push to next 8h

### Tick 2 — Drain queue

Pick up to 50 jobs via `FOR UPDATE SKIP LOCKED`, set `lockUntil = now + 5min`, process each. Multiple worker instances would safely share work without dispute.

### `processSendJob` flow

1. Reload message + customer + campaign + template
2. Re-check: customer not opted out, campaign still RUNNING
3. Resolve channel (AUTO mirrors customer's last conversation provider)
4. Render text/template payload
5. Call adapter (Cloud or Evolution)
6. On success: update message status, persist to Conversation (inbox visibility), remove job
7. On error: see retry policy below

### Retry policy

| Scenario | Action |
|---|---|
| 4xx (invalid template, blocked phone, opt-out) | Permanent fail, no retry |
| 429 (rate limit) | Exponential backoff: 30s, 2min, 10min, then give up |
| 5xx Meta | Retry 3x with backoff |
| Network/timeout | Retry 3x with backoff |
| Evolution 404 endpoint | Fall through 3 endpoints (existing logic) |

### Tick 3 — Housekeeping

- Close attribution windows: messages where `sentAt + windowHours < now` → `attributionLockedAt = now`
- Finalize completed runs: when no QUEUED/SENDING messages remain, set `finishedAt` and rollup totals
- Auto-pause unhealthy campaigns: block-rate (FAILED+OPTED_OUT)/total > 5% in last 24h (min 50 sends) → PAUSED + notify operator

### Idempotency

- `MarketingMessage @@unique([campaignRunId, customerId])` — never sends 2x in same run
- `MarketingSendQueue.messageId @unique` — never enqueued 2x

## Attribution

### Model

Last-touch within the campaign's conversion window.

### Trigger points (synchronous, no cron)

- `orders.js POST /` after creation: `attributeOrderToCampaign(created.id)`
- `ifoodWebhookProcessor.upsertOrder` after `res.created`: same call
- Status transition to `CANCELADO`: `revokeAttribution(orderId)`

### Function `attributeOrderToCampaign(orderId)`

1. Load order (companyId, customerId, menuId, total, status, couponId)
2. Skip if status not in attributable list (`EM_PREPARO` and beyond)
3. Skip if order already has `attributedCampaignId`
4. Query for the latest `MarketingMessage` where:
   - `customerId` matches
   - `companyId` matches
   - `sentAt + campaign.conversionWindowHours > now`
   - not yet converted
   - not excluded (opt-out mid-window)
5. Apply scope guard: if `attributionScope = 'menu'`, order.menuId must match `campaign.segmentMenuId`
6. Determine signal: `STRONG` if `campaign.couponId` set AND `order.couponId` matches; else `WEAK`
7. Transaction: update message + update order

### `revokeAttribution(orderId)` — on cancellation

Reverses the link: nulls `convertedOrderId`, `convertedAt`, `convertedValue`, `attributionSignal` on the message; nulls `attributedCampaignId`, `attributedMessageId` on the order.

### Edge cases (decided)

| Case | Behavior |
|---|---|
| Customer received pizza campaign, ordered only drink | Attributes (WEAK signal) |
| Customer received from menu A, ordered from menu B | Default: no attribution (scope=menu). Operator can override per campaign |
| Customer received 2 campaigns within 6h, then bought | Last-touch: the most recent message sent before the order |
| Customer replied "PARAR" and then bought | No attribution (`excludedFromAttribution = true` set on opt-out) |
| Order cancelled after attribution | Reversed |
| Window closed, then bought | No attribution (window is hard) |
| Coupon from campaign was used in order | STRONG signal — causally stronger metric |

### Statistical honesty

V1 reports **attributed conversion**, not **causal conversion**. Without A/B grouping, we can't know how many of those orders would have happened anyway. Dashboard makes the distinction explicit. A/B testing with control group is V2.

## Compliance

### Opt-in (3 mechanisms)

1. **Checkbox at public checkout** (default unchecked, LGPD-compliant). Stored as `optInMarketingSource: 'checkout'`.
2. **Auto opt-in for active customers**: when customer sends inbound message, set `optInMarketing = true` with source `inbound`. Respects existing opt-out.
3. **Manual marking by operator** in CustomerProfile.vue, source `manual` with optional note.

### Opt-out (3 mechanisms)

1. **Inbound keywords** auto-detection: `PARAR`, `STOP`, `SAIR`, `CANCELAR`, `DESCADASTRAR`, `PARE`. Hook in both Evolution and Meta webhooks. On match:
   - Set `optOutMarketingAt = now`, `optInMarketing = false`
   - Mark all in-flight `MarketingMessage` for this customer as `excludedFromAttribution = true`
   - Auto-reply confirming opt-out (still sends, but utility message inside service window)
2. **Cancel button in template**: all marketing templates include a button that pre-fills WhatsApp with "PARAR".
3. **Manual unmarking by operator**.

### Frequency cap

Default: 2 marketing messages per customer per 7-day rolling window. Applied at enqueue, not send. Run summary shows how many were skipped due to cap.

### Quiet hours

Default 8h-21h company-timezone. `nextValidSlot()` pushes pre-8h slots to 8h same day, post-21h slots to 8h next day. Operator can narrow further but not widen (no night sends by design).

### Auto-pause

Block-rate > 5% in last 24h (FAILED + OPTED_OUT divided by total sends, minimum 50 sends for statistical relevance) → campaign automatically set to PAUSED, operator notified via in-app badge.

### Audit (LGPD)

- `MarketingMessage` rows are immutable audit log
- `/customers/:id/marketing-audit` endpoint returns all marketing messages received by a customer
- `/companies/:id/marketing-audit-export?from=&to=` exports CSV for compliance reporting

### Pre-flight checks (Step 4 of builder)

- Template selected and APPROVED (Cloud only)
- Audience > 0
- Evolution + audience > 50 → warning
- Audience > 500 → typing-test confirmation
- Errors block activation; warnings/confirms just require extra interaction

## Template management

### What changes from today

Today's `/settings/whatsapp-templates` page only **syncs** from Business Manager. V1 adds:
- **Submission via Graph API** from inside the panel (`POST /<waba>/message_templates`)
- **Shared library** of pre-approved generic templates (seed)
- **Polling of submission status** every 5min for templates with `createdViaApp = true` and status in `PENDING`/`IN_APPEAL`

### Template creation UI

`/settings/whatsapp-templates/new` — wizard with:
- Account selection (which `MetaMessagingAccount`)
- Start from library OR blank
- Internal name (letters/digits/underscore, immutable after submit)
- Category (Marketing | Utility | Authentication)
- Language (default `pt_BR`)
- Header (optional, text/image/video)
- Body (required) with `{{1}}`, `{{2}}` variable insertion
- Footer (optional)
- Buttons (up to 3): URL, Phone, Quick Reply
- Live preview
- Submit for approval (or save draft)

### Backend endpoints

```
POST   /meta/templates                  - create + submit to Meta
GET    /meta/templates/library          - shared library
POST   /meta/templates/from-library     - clone from library
POST   /meta/templates/:id/resubmit     - resubmit after rejection
DELETE /meta/templates/:id              - soft delete
POST   /meta/templates/sync             - manual sync (existing)
```

### Variable mapping at campaign time

In Step 2 of campaign builder, each `{{N}}` of the selected template gets a source:
- `field`: from customer (`customer.firstName`, `customer.lastOrderTotal`, ...)
- `campaign`: from campaign config (`couponCode`, `conversionWindowHours`)
- `computed`: derived (e.g., `menu.url + '/' + customer.id`)

Stored in `MarketingCampaign.templateVariableMap`. Library templates ship with `variableHints` to pre-fill mapping.

### Library seed (5 starter templates)

| Name | Use case | Category |
|---|---|---|
| `reactivation_30d_with_coupon` | 30-day-no-order with attached coupon | Marketing |
| `reactivation_30d_no_coupon` | Same, no coupon | Marketing |
| `birthday_promo` | Birthday with % off | Marketing |
| `product_repeat_15d` | Repeat-purchase nudge after 15d | Marketing |
| `category_promotion` | Category-based promo with avg-ticket targeting | Marketing |

## Dashboard / Reporting

### Screens

1. `/marketing/campaigns` — list with status, last run, conversion rate, attributed revenue
2. `/marketing/campaigns/:id` — detail with tabs: Overview, Messages, Conversions, Settings
3. `/marketing/segments` — list of saved segments with size + last evaluated
4. `/marketing/health` — channel health: account status, tier usage, quality rating, 7-day stats

### Overview tab (per-campaign)

- Funnel: sent → delivered → read → converted (STRONG/WEAK breakdown) → opt-outs
- Metrics: attributed revenue, average ticket, estimated Meta cost, ROAS
- Health: 24h block-rate (with threshold warning), read rate
- Run history (last 30 runs)

### Notifications

In-app badges + optional email:
- Template approved/rejected
- Campaign auto-paused
- Phone number tier changed

### Permissions

| Action | Min role |
|---|---|
| View campaigns/segments | ATTENDANT |
| Create/edit segment | ADMIN |
| Create campaign (DRAFT) | ADMIN |
| Activate/pause/cancel | ADMIN |
| Create/submit template | ADMIN |
| Manual opt-in/out customer | ADMIN |

Module gating via `requireModule('marketing_campaigns')`.

### Menu integration

Under existing Marketing group in `nav.js`:
```js
{ name: 'Campanhas',       to: '/marketing/campaigns', moduleKey: 'marketing_campaigns', lockable: true },
{ name: 'Segmentos',       to: '/marketing/segments',  moduleKey: 'marketing_campaigns', lockable: true },
{ name: 'Saúde do canal',  to: '/marketing/health',    moduleKey: 'marketing_campaigns', lockable: true },
```

## Decisions log

| Decision | Choice | Why |
|---|---|---|
| V1 scope | Full V1 (ONE_SHOT + RECURRING + TRIGGER + retry + freq cap + quiet hours + auto-pause) | Production-ready first release; longer build but no second-class feeling |
| Billing model | Separate SaaS module `marketing_campaigns` | Allows add-on pricing and plan differentiation |
| Meta cost handling | Pass-through (customer pays Meta directly) | Simplest legally and financially; estimates shown in panel |
| Template creation | Submit via Graph API from panel + shared library | Best UX, doesn't require leaving the app for common cases |
| Mandatory safeguards | Preview required, > 500 typing test, auto-pause at 5% | Multiple options selected by operator |
| Evolution mass sending | Allowed but with 1-15s random jitter | Operator's call (custom override of recommendation) |
| Opt-in mechanisms | Checkbox + auto-on-inbound + manual | All three selected |
| DSL approach | JSON declarative + visual builder | Versionable, safe (no SQL injection), composable |
| Queue infrastructure | Postgres `FOR UPDATE SKIP LOCKED` | Reuses existing infra, sufficient for current scale |
| Attribution model | Last-touch within configurable window, STRONG/WEAK signal | Standard for transactional WhatsApp; coupon signal adds causal strength |
| Worker location | Same process as backend, `setInterval` | Simpler deploy, migrate to separate process if needed |

## Phased rollout

### Phase 0 — Foundation (1 week)

- 3 separate Prisma migrations (new models, Customer opt-in, Order attribution)
- Register `marketing_campaigns` SaaS module
- Extract `pickConnectedChannel` helper from `notify.js` (shared between forgot-password, account-create, marketing-send)
- Insert basic `attributeOrderToCampaign` hook in `orders.js` and `ifoodWebhookProcessor.js` (no worker yet)
- Feature flag (`Company.flags.marketing_v1_enabled = false` default)

### Phase 1 — MVP usable (2 weeks)

- DSL with 8 base fields and SQL compiler
- Segment builder with live preview + sample
- Campaign builder (ONE_SHOT only) with Cloud+template or Evolution
- Worker with Postgres queue, 1-15s Evolution jitter, retry policy
- Opt-in checkbox at checkout + auto-on-inbound + opt-out keywords
- Frequency cap + quiet hours
- Basic per-campaign dashboard (funnel + metrics)

**Beta:** 1 internal client (Burguer73 or Lanchão), feature-flagged. Close observation for 2 weeks.

### Phase 2 — Recurrence and automation (2 weeks)

- RECURRING with cron parser + run dedup
- TRIGGER (BIRTHDAY, POST_ORDER_DAY_X)
- Attached coupon + STRONG/WEAK attribution signal
- Templates: panel-based creation via Graph API + shared library seed
- Template status polling
- Auto-pause on block-rate
- Health dashboard

**Expanded beta:** 5 selected clients, toggled per `Company.flags`.

### Phase 3 — General Availability (1 week)

- Permissions finalized + module-guarded routes
- LGPD audit exports
- Operator notifications (in-app + optional email)
- Onboarding tour
- Help articles
- Feature flag removed; available to any plan that includes `marketing_campaigns`

### Phase 4+ (V2, post-GA)

- A/B testing with control group (causal metric)
- Multi-touch attribution (optional)
- Cashback boost per campaign
- AI-suggested segments and copy via Studio IA

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Operator uses Evolution for spam, number gets banned | UX educates on every Evolution selection; jitter 1-15s reduces detection; auto-pause at 5% block-rate |
| High-block-rate template tanks Meta quality rating | Auto-pause; pre-flight checks template history before activation |
| Poorly-built segment hits wrong audience | Mandatory preview + > 500 typing test |
| Send burst overloads main backend (shared-process worker) | Postgres queue absorbs; batch of 50 per tick; migrate worker to separate process in V2 if needed |
| Attributed conversion inflated (orders that would happen anyway) | STRONG/WEAK signal separates them; V2 adds A/B with control; limitation documented in dashboard |
| Meta cost surprises operator | Visible estimate in Step 4 + pass-through model (operator sees Meta bill directly) |
