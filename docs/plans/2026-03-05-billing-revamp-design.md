# Billing Revamp: Single Plan + Add-on Modules

**Date:** 2026-03-05
**Status:** Approved
**Approach:** Evolve current schema (Approach A)

## Overview

Replace the multi-plan billing system with a single basic plan + purchasable add-on modules. Each module becomes an independent subscription with its own pricing. AI credits shift from monthly-reset to initial-balance + purchasable credit packs.

## Requirements

- Single basic plan with configurable monthly/annual price
- Modules become purchasable add-ons with own monthly/annual pricing
- Self-service add-on store (admin) + Super Admin can also assign
- Pro-rated billing for mid-cycle add-on subscriptions
- Gateway-agnostic payment layer (Brazilian gateway TBD)
- AI credits: initial balance on basic plan subscription + purchasable credit packs
- Store UX: individual add-on pages per module + central marketplace page
- Auto-migration of existing companies to new model

## Data Model Changes

### Modified Models

**SaasPlan** — simplified to represent the single basic plan:
- Keep: id, name, price, isActive, isDefault, isSystem
- Rename `aiCreditsMonthlyLimit` to `aiCreditsInitialBalance` (one-time grant)
- `menuLimit`, `storeLimit`, `unlimitedMenus`, `unlimitedStores` — set to unlimited (keep columns)
- `unlimitedAiCredits` — no longer relevant (no monthly reset)
- Keep: `SaasPlanPrice[]` for monthly/annual pricing

**SaasPlanModule** — becomes legacy. Modules no longer tied to plans.

### New Models

```prisma
model SaasModulePrice {
  id        String     @id @default(uuid())
  moduleId  String
  module    SaasModule @relation(fields: [moduleId], references: [id])
  period    String     // MONTHLY, ANNUAL
  price     Decimal
  @@unique([moduleId, period])
}

model SaasModuleSubscription {
  id         String   @id @default(uuid())
  companyId  String
  company    Company  @relation(fields: [companyId], references: [id])
  moduleId   String
  module     SaasModule @relation(fields: [moduleId], references: [id])
  status     String   @default("ACTIVE") // ACTIVE, CANCELED, SUSPENDED
  period     String   // MONTHLY, ANNUAL
  startedAt  DateTime @default(now())
  nextDueAt  DateTime
  canceledAt DateTime?
  createdAt  DateTime @default(now())
  @@unique([companyId, moduleId])
}

model AiCreditPack {
  id        String   @id @default(uuid())
  name      String   // e.g., "100 Creditos", "500 Creditos"
  credits   Int
  price     Decimal
  isActive  Boolean  @default(true)
  sortOrder Int      @default(0)
  createdAt DateTime @default(now())
}

model AiCreditPurchase {
  id         String       @id @default(uuid())
  companyId  String
  company    Company      @relation(fields: [companyId], references: [id])
  packId     String
  pack       AiCreditPack @relation(fields: [packId], references: [id])
  credits    Int
  amount     Decimal
  paymentRef String?
  createdAt  DateTime     @default(now())
}

model SaasInvoiceItem {
  id          String      @id @default(uuid())
  invoiceId   String
  invoice     SaasInvoice @relation(fields: [invoiceId], references: [id])
  type        String      // PLAN, MODULE, CREDIT_PACK
  referenceId String      // planId, moduleId, or packId
  description String
  amount      Decimal
}

model SaasPayment {
  id         String       @id @default(uuid())
  companyId  String
  company    Company      @relation(fields: [companyId], references: [id])
  invoiceId  String?
  invoice    SaasInvoice? @relation(fields: [invoiceId], references: [id])
  amount     Decimal
  status     String       @default("PENDING") // PENDING, PROCESSING, PAID, FAILED, REFUNDED
  gateway    String       // asaas, mercadopago, manual
  gatewayRef String?
  method     String?      // PIX, BOLETO, CREDIT_CARD
  paidAt     DateTime?
  metadata   Json?
  createdAt  DateTime     @default(now())
}
```

## Backend API Changes

### Module Pricing (Super Admin)
- `GET /saas/modules` — include `prices[]` in response
- `PUT /saas/modules/:id` — accept `prices: [{ period, price }]`

### Module Subscriptions (Admin self-service)
- `GET /saas/module-subscriptions/me` — list company's active module subscriptions
- `POST /saas/module-subscriptions` — subscribe to a module (body: `{ moduleId, period }`)
  - Creates SaasModuleSubscription + pro-rated invoice + triggers payment
  - Activates module immediately or on payment confirmation
- `DELETE /saas/module-subscriptions/:moduleId` — cancel (effective at end of period)

### Module Store
- `GET /saas/store/modules` — available modules with pricing + subscription status

### AI Credit Packs (Super Admin)
- `GET /saas/credit-packs` — list all packs
- `POST /saas/credit-packs` — create
- `PUT /saas/credit-packs/:id` — update
- `DELETE /saas/credit-packs/:id` — delete

### AI Credit Purchase (Admin)
- `GET /saas/credit-packs/available` — list active packs
- `POST /saas/credit-packs/purchase` — purchase (body: `{ packId }`)

### Payment Webhook
- `POST /payment/webhook` — gateway callback
  - Updates SaasPayment.status
  - On success: activates subscription / adds credits / marks invoice paid

### Modified Logic
- `GET /saas/modules/me` — reads from SaasModuleSubscription (not SaasPlanModule)
- Invoice generation: 1 line for plan + 1 per active module subscription
- AI credits: remove monthly reset, grant initial balance on plan subscription

## Frontend Changes

### New Views
- **AddOnStore.vue** (`/store`) — central marketplace with module cards, pricing toggle, status badges
- **AddOnDetail.vue** (`/store/:moduleKey`) — individual add-on page with features, pricing, subscribe CTA
- **CreditPackStore.vue** (`/store/credits`) — credit pack purchase page with balance display

### Modified Components
- **Sidebar.vue** — locked items redirect to `/store/:moduleKey`; add "Loja" menu item; AiCreditsWidget gets "Comprar creditos" link
- **SaasPlans.vue** — simplified for single plan + module pricing + credit packs
- **SaasBilling.vue** — show invoice line items, active module subscriptions with cancel option

### Store Changes
- **modules.js** — `fetchEnabled()` reads from module subscriptions
- **saas.js** — `enabledModules` from subscriptions; add `moduleSubscriptions` state
- **New store** — available modules, pricing, credit packs, subscribe/purchase actions

## Migration Strategy

1. Create single basic plan with default pricing
2. Super Admin configures module prices (can default to R$0 initially)
3. Migration script:
   - For each company with active subscription:
     - Create SaasModuleSubscription per module from their current plan
     - Set status=ACTIVE, period=current period, nextDueAt=current nextDueAt
   - Update all SaasSubscription.planId to basic plan
   - Preserve current aiCreditsBalance (no one loses credits)
4. Clear SaasPlanModule entries (keep table for rollback safety)

## Error Handling

- **Payment failure on add-on**: module stays inactive until payment confirmed ("Pagamento pendente")
- **Payment failure on credit pack**: credits not added until payment confirmed
- **Subscription cancellation**: active until nextDueAt, deactivated by daily job
- **Invoice generation failure**: log, retry next run, notify Super Admin

## Testing Strategy

- Unit tests for pro-ration calculation
- Integration tests for module subscribe/cancel flow
- Migration script tested on dev DB copy before production
- Gateway webhook signature verification
