# Module Route Guard Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace hardcoded `SIMPLES_BLOCKED_PREFIXES` with declarative `meta.requiresModule` on each route, and a generic module guard in `router.beforeEach`.

**Architecture:** Each route declares its required module via `meta.requiresModule`. A single guard checks if the user has that module; if not, redirects to `/menu/menus` (cardápio simples) or `/orders` (others).

**Tech Stack:** Vue Router meta fields, Pinia modules store

**Design doc:** `docs/plans/2026-03-11-module-route-guard-design.md`

---

### Task 1: Add `requiresModule` to CARDAPIO_COMPLETO routes

**Files:**
- Modify: `delivery-saas-frontend/src/router.js:122-130,154-157,196,220-223`

**Step 1: Edit route definitions**

Add `requiresModule: 'CARDAPIO_COMPLETO'` to these routes' meta:

```js
{ path: '/', redirect: '/orders' },  // ← will handle in Task 3
{ path: '/orders', component: Orders, meta: { requiresAuth: true, requiresModule: 'CARDAPIO_COMPLETO' } },
{ path: '/orders/:id/receipt', component: Receipt, meta: { requiresAuth: true, requiresModule: 'CARDAPIO_COMPLETO' } },
{ path: '/customers', component: CustomersList, meta: { requiresAuth: true, requiresModule: 'CARDAPIO_COMPLETO' } },
{ path: '/customers/new', component: CustomerForm, meta: { requiresAuth: true, requiresModule: 'CARDAPIO_COMPLETO' } },
{ path: '/customers/:id', component: CustomerProfile, meta: { requiresAuth: true, requiresModule: 'CARDAPIO_COMPLETO' } },
{ path: '/customer-groups', component: CustomerGroupsList, meta: { requiresAuth: true, requiresModule: 'CARDAPIO_COMPLETO' } },
{ path: '/customer-groups/new', component: CustomerGroupForm, meta: { requiresAuth: true, requiresModule: 'CARDAPIO_COMPLETO' } },
{ path: '/customer-groups/:id', component: CustomerGroupForm, meta: { requiresAuth: true, requiresModule: 'CARDAPIO_COMPLETO' } },
{ path: '/settings/neighborhoods', component: Neighborhoods, meta: { requiresAuth: true, requiresModule: 'CARDAPIO_COMPLETO' } },
{ path: '/settings/meta-pixel', component: MetaPixelIntegration, meta: { requiresAuth: true, requiresModule: 'CARDAPIO_COMPLETO' } },
{ path: '/settings/ifood', component: IFoodIntegration, meta: { requiresModule: 'CARDAPIO_COMPLETO' } },
{ path: '/integrations', component: Integrations, meta: { requiresAuth: true, requiresModule: 'CARDAPIO_COMPLETO' } },
{ path: '/integrations/new', component: IntegrationForm, meta: { requiresAuth: true, requiresModule: 'CARDAPIO_COMPLETO' } },
{ path: '/integrations/:id', component: IntegrationForm, meta: { requiresAuth: true, requiresModule: 'CARDAPIO_COMPLETO' } },
{ path: '/menu/integration', component: IntegrationCodes, meta: { requiresAuth: true, requiresModule: 'CARDAPIO_COMPLETO' } },
{ path: '/sales', component: SalesHistory, meta: { requiresAuth: true, requiresModule: 'CARDAPIO_COMPLETO' } },
{ path: '/sales/:id', component: SaleDetails, meta: { requiresAuth: true, requiresModule: 'CARDAPIO_COMPLETO' } },
{ path: '/reports/cash-fronts', component: CashFronts, meta: { requiresAuth: true, requiresModule: 'CARDAPIO_COMPLETO' } },
{ path: '/reports/products', component: ProductsReport, meta: { requiresAuth: true, requiresModule: 'CARDAPIO_COMPLETO' } },
```

**Step 2: Commit**

```bash
git add delivery-saas-frontend/src/router.js
git commit -m "feat(router): add requiresModule CARDAPIO_COMPLETO to route metas"
```

---

### Task 2: Add `requiresModule` to all other module routes

**Files:**
- Modify: `delivery-saas-frontend/src/router.js`

**Step 1: Add RIDERS module to rider routes**

```js
{ path: '/riders', component: Riders, meta: { requiresAuth: true, requiresModule: 'RIDERS' } },
{ path: '/riders/new', component: RiderForm, meta: { requiresAuth: true, requiresModule: 'RIDERS' } },
{ path: '/riders/:id', component: RiderForm, meta: { requiresAuth: true, requiresModule: 'RIDERS' } },
{ path: '/riders/:id/account', component: RiderAccountAdmin, meta: { requiresAuth: true, role: 'ADMIN', requiresModule: 'RIDERS' } },
{ path: '/rider-adjustments', component: RiderAdjustments, meta: { requiresAuth: true, requiresModule: 'RIDERS' } },
{ path: '/riders/map', component: () => import('./views/RiderMap.vue'), meta: { requiresAuth: true, requiresModule: 'RIDERS' } },
{ path: '/settings/rider-tracking', component: () => import('./views/RiderTracking.vue'), meta: { requiresAuth: true, requiresModule: 'RIDERS' } },
```

**Step 2: Add AFFILIATES module**

```js
{ path: '/affiliates', component: AffiliateListing, meta: { requiresAuth: true, requiresModule: 'AFFILIATES' } },
{ path: '/affiliates/new', component: AffiliateCreate, meta: { requiresAuth: true, requiresModule: 'AFFILIATES' } },
{ path: '/affiliates/:id/edit', component: AffiliateEdit, meta: { requiresAuth: true, requiresModule: 'AFFILIATES' } },
{ path: '/affiliates/:id/sales/new', component: AffiliateSaleNew, meta: { requiresAuth: true, requiresModule: 'AFFILIATES' } },
{ path: '/affiliates/:id/payments/new', component: AffiliatePaymentNew, meta: { requiresAuth: true, requiresModule: 'AFFILIATES' } },
{ path: '/affiliates/:id/statement', component: AffiliateStatement, meta: { requiresAuth: true, requiresModule: 'AFFILIATES' } },
```

**Step 3: Add COUPONS module**

```js
{ path: '/coupons', component: CouponsList, meta: { requiresAuth: true, requiresModule: 'COUPONS' } },
{ path: '/coupons/new', component: CouponForm, meta: { requiresAuth: true, requiresModule: 'COUPONS' } },
{ path: '/coupons/:id/edit', component: CouponForm, meta: { requiresAuth: true, requiresModule: 'COUPONS' } },
```

**Step 4: Add CASHBACK module**

```js
{ path: '/settings/cashback', component: CashbackSettings, meta: { requiresAuth: true, requiresModule: 'CASHBACK' } },
```

**Step 5: Add STOCK module**

```js
{ path: '/ingredient-groups', component: IngredientGroups, meta: { requiresAuth: true, requiresModule: 'STOCK' } },
{ path: '/ingredient-groups/new', component: IngredientGroupForm, meta: { requiresAuth: true, requiresModule: 'STOCK' } },
{ path: '/ingredient-groups/:id/edit', component: IngredientGroupForm, meta: { requiresAuth: true, requiresModule: 'STOCK' } },
{ path: '/ingredients', component: Ingredients, meta: { requiresAuth: true, requiresModule: 'STOCK' } },
{ path: '/ingredients/new', component: IngredientForm, meta: { requiresAuth: true, requiresModule: 'STOCK' } },
{ path: '/ingredients/:id', component: IngredientForm, meta: { requiresAuth: true, requiresModule: 'STOCK' } },
{ path: '/technical-sheets', component: TechnicalSheets, meta: { requiresAuth: true, requiresModule: 'STOCK' } },
{ path: '/technical-sheets/:id/edit', component: TechnicalSheetEdit, meta: { requiresAuth: true, requiresModule: 'STOCK' } },
{ path: '/stock-movements', component: StockMovements, meta: { requiresAuth: true, requiresModule: 'STOCK' } },
{ path: '/stock-movements/new', component: StockMovementForm, meta: { requiresAuth: true, requiresModule: 'STOCK' } },
{ path: '/stock-movements/:id', component: StockMovementForm, meta: { requiresAuth: true, requiresModule: 'STOCK' } },
{ path: '/stock/purchase-imports', component: PurchaseImports, meta: { requiresAuth: true, requiresModule: 'STOCK' } },
```

**Step 6: Add FINANCIAL module**

```js
{ path: '/financial', component: FinancialDashboard, meta: { requiresAuth: true, role: 'ADMIN', requiresModule: 'FINANCIAL' } },
{ path: '/financial/accounts', component: FinancialAccounts, meta: { requiresAuth: true, role: 'ADMIN', requiresModule: 'FINANCIAL' } },
{ path: '/financial/transactions', component: FinancialTransactions, meta: { requiresAuth: true, role: 'ADMIN', requiresModule: 'FINANCIAL' } },
{ path: '/financial/cash-flow', component: FinancialCashFlow, meta: { requiresAuth: true, role: 'ADMIN', requiresModule: 'FINANCIAL' } },
{ path: '/financial/dre', component: FinancialDRE, meta: { requiresAuth: true, role: 'ADMIN', requiresModule: 'FINANCIAL' } },
{ path: '/financial/gateways', component: FinancialGateways, meta: { requiresAuth: true, role: 'ADMIN', requiresModule: 'FINANCIAL' } },
{ path: '/financial/ofx', component: FinancialOFX, meta: { requiresAuth: true, role: 'ADMIN', requiresModule: 'FINANCIAL' } },
{ path: '/financial/cost-centers', component: FinancialCostCenters, meta: { requiresAuth: true, role: 'ADMIN', requiresModule: 'FINANCIAL' } },
```

**Step 7: Add FISCAL module**

```js
{ path: '/nfe/emissao', component: NfeEmissao, meta: { requiresAuth: true, role: 'ADMIN', requiresModule: 'FISCAL' } },
{ path: '/relatorios/nfe-emissoes', component: NfeEmissoesRelatorio, meta: { requiresAuth: true, role: ['ADMIN', 'SUPER_ADMIN'], requiresModule: 'FISCAL' } },
{ path: '/settings/dados-fiscais', component: DadosFiscaisSettings, meta: { requiresAuth: true, requiresModule: 'FISCAL' } },
{ path: '/settings/dados-fiscais/new', component: DadosFiscaisForm, meta: { requiresAuth: true, requiresModule: 'FISCAL' } },
{ path: '/settings/dados-fiscais/:id', component: DadosFiscaisForm, meta: { requiresAuth: true, requiresModule: 'FISCAL' } },
```

**Step 8: Add WHATSAPP module**

```js
{ path: '/settings/whatsapp', component: WhatsAppConnect, meta: { requiresAuth: true, requiresModule: 'WHATSAPP' } },
```

**Step 9: Commit**

```bash
git add delivery-saas-frontend/src/router.js
git commit -m "feat(router): add requiresModule to RIDERS, AFFILIATES, COUPONS, CASHBACK, STOCK, FINANCIAL, FISCAL, WHATSAPP routes"
```

---

### Task 3: Replace hardcoded guard with dynamic module guard

**Files:**
- Modify: `delivery-saas-frontend/src/router.js:294-318`

**Step 1: Remove the `SIMPLES_BLOCKED_PREFIXES` block (lines 294-318) and replace with:**

```js
  // Module guard: block routes requiring a module the user doesn't have
  if (token && to.meta.requiresModule) {
    const auth = useAuthStore()
    const userRole = String(auth.user?.role || '').toUpperCase()
    if (userRole === 'ADMIN') {
      const { useModulesStore } = await import('./stores/modules')
      const modules = useModulesStore()
      if (!modules.enabled.length) {
        try { await modules.fetchEnabled() } catch {}
      }
      if (!modules.has(to.meta.requiresModule)) {
        const isSimples = modules.has('CARDAPIO_SIMPLES') && !modules.has('CARDAPIO_COMPLETO')
        return { path: isSimples ? '/menu/menus' : '/orders' }
      }
    }
  }
```

**Step 2: Make `/` redirect dynamic**

Replace `{ path: '/', redirect: '/orders' }` with:

```js
{ path: '/', component: null, beforeEnter: async () => {
    const token = localStorage.getItem('token')
    if (!token) return { path: '/login' }
    const { useModulesStore } = await import('./stores/modules')
    const modules = useModulesStore()
    if (!modules.enabled.length) {
      try { await modules.fetchEnabled() } catch {}
    }
    const isSimples = modules.has('CARDAPIO_SIMPLES') && !modules.has('CARDAPIO_COMPLETO')
    return { path: isSimples ? '/menu/menus' : '/orders' }
  }
},
```

**Step 3: Commit**

```bash
git add delivery-saas-frontend/src/router.js
git commit -m "feat(router): replace hardcoded SIMPLES_BLOCKED_PREFIXES with dynamic requiresModule guard"
```

---

### Task 4: Verify the build compiles

**Step 1: Run the dev build**

```bash
cd delivery-saas-frontend && npm run build
```

Expected: Build succeeds with no errors.

**Step 2: Commit if any fixes needed**

---

### Task 5: Manual smoke test checklist

Test these scenarios in the browser:

1. **CARDAPIO_SIMPLES user** → login → lands on `/menu/menus`
2. **CARDAPIO_SIMPLES user** → navigate to `/orders` → redirected to `/menu/menus`
3. **CARDAPIO_SIMPLES user** → navigate to `/riders` → redirected to `/menu/menus`
4. **CARDAPIO_COMPLETO user** → login → lands on `/orders`
5. **CARDAPIO_COMPLETO user without STOCK** → navigate to `/ingredients` → redirected to `/orders`
6. **CARDAPIO_COMPLETO user with STOCK** → navigate to `/ingredients` → access granted
7. **SUPER_ADMIN** → navigate to any route → access granted (not affected by module guard)