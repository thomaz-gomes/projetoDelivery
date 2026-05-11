# Payment Method Discount Rules — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add per-payment-method discount rules that automatically discount the order when conditions match (schedule, allowed order types, toggles for coupon and cashback behavior).

**Architecture:** Extend `PaymentMethod` Prisma model with dedicated columns + JSON for schedule/orderTypes. A pure helper `evaluateDiscountRule(method, ctx)` is the single source of truth (used by backend cart/order flows). Frontend reuses the existing `AvailabilityScheduler` component and recalculates the cart preview on method change.

**Tech Stack:** Express.js, Prisma (PostgreSQL), node:test, Vue 3 (Composition API), Pinia, Bootstrap 5, SweetAlert2.

**Reference design:** [docs/plans/2026-05-10-payment-method-discount-rules-design.md](./2026-05-10-payment-method-discount-rules-design.md)

---

## Task 1: Extend Prisma schema with discount-rule fields

**Files:**
- Modify: `delivery-saas-backend/prisma/schema.prisma` (PaymentMethod model around line 1548, Order model around line 220)

**Step 1: Edit `PaymentMethod` model — add fields before the closing `}`:**

```prisma
  // Discount rule (per payment method)
  discountEnabled   Boolean  @default(false)
  discountPercent   Decimal? // mutually exclusive with discountFixed
  discountFixed     Decimal?
  ignoreCoupons     Boolean  @default(false)
  generatesCashback Boolean  @default(true)
  alwaysAvailable   Boolean  @default(true)
  schedule          Json?    // [{day:0..6, enabled, from:"HH:mm", to:"HH:mm"}]
  allowedOrderTypes Json?    // ["DELIVERY","BALCAO","TAKEOUT"] — null/[] = all
```

**Step 2: Edit `Order` model — add field:**

```prisma
  paymentDiscount   Decimal? // value frozen at order-creation time for audit
```

**Step 3: Sync to dev DB and regenerate client (Docker exec):**

```bash
docker compose exec backend npx prisma db push --skip-generate
docker compose exec backend npx prisma generate
```

Expected: "Your database is now in sync with your Prisma schema."

**Step 4: Commit**

```bash
git add delivery-saas-backend/prisma/schema.prisma
git commit -m "feat(payment-method): add discount-rule columns and Order.paymentDiscount"
```

---

## Task 2: Pure helper `evaluateDiscountRule` (TDD)

**Files:**
- Create: `delivery-saas-backend/src/utils/paymentDiscount.js`
- Create: `delivery-saas-backend/tests/paymentDiscount.test.mjs`

**Step 1: Write failing test file**

```js
// tests/paymentDiscount.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateDiscountRule } from '../src/utils/paymentDiscount.js';

const base = {
  isActive: true,
  discountEnabled: true,
  discountPercent: null,
  discountFixed: null,
  ignoreCoupons: false,
  generatesCashback: true,
  alwaysAvailable: true,
  schedule: null,
  allowedOrderTypes: null,
};

const ctx = (over = {}) => ({ orderType: 'DELIVERY', subtotal: 100, now: new Date('2026-05-10T13:00:00'), ...over });

test('disabled rule does not apply', () => {
  const r = evaluateDiscountRule({ ...base, discountEnabled: false }, ctx());
  assert.equal(r.applies, false);
  assert.equal(r.amount, 0);
});

test('inactive method does not apply', () => {
  const r = evaluateDiscountRule({ ...base, isActive: false }, ctx());
  assert.equal(r.applies, false);
});

test('percent discount on subtotal 100, 10% -> amount 10', () => {
  const r = evaluateDiscountRule({ ...base, discountPercent: 10 }, ctx());
  assert.equal(r.applies, true);
  assert.equal(r.amount, 10);
});

test('fixed discount 15 on subtotal 100 -> amount 15', () => {
  const r = evaluateDiscountRule({ ...base, discountFixed: 15 }, ctx());
  assert.equal(r.amount, 15);
});

test('fixed discount greater than subtotal is clamped', () => {
  const r = evaluateDiscountRule({ ...base, discountFixed: 200 }, ctx({ subtotal: 50 }));
  assert.equal(r.amount, 50);
});

test('percent rounded to 2 decimals', () => {
  const r = evaluateDiscountRule({ ...base, discountPercent: 7.5 }, ctx({ subtotal: 33.33 }));
  assert.equal(r.amount, 2.5); // 33.33 * 0.075 = 2.49975 → 2.5
});

test('schedule disabled day -> does not apply', () => {
  // 2026-05-10 is Sunday (day 0). Disable day 0.
  const sched = Array.from({ length: 7 }, (_, i) => ({ day: i, enabled: false, from: '00:00', to: '23:59' }));
  const r = evaluateDiscountRule(
    { ...base, alwaysAvailable: false, schedule: sched, discountPercent: 10 },
    ctx(),
  );
  assert.equal(r.applies, false);
});

test('schedule time inside window -> applies', () => {
  const sched = Array.from({ length: 7 }, (_, i) => ({ day: i, enabled: true, from: '11:00', to: '14:00' }));
  const r = evaluateDiscountRule(
    { ...base, alwaysAvailable: false, schedule: sched, discountPercent: 10 },
    ctx(),
  );
  assert.equal(r.applies, true);
});

test('schedule time before from -> does not apply', () => {
  const sched = Array.from({ length: 7 }, (_, i) => ({ day: i, enabled: true, from: '15:00', to: '18:00' }));
  const r = evaluateDiscountRule(
    { ...base, alwaysAvailable: false, schedule: sched, discountPercent: 10 },
    ctx(),
  );
  assert.equal(r.applies, false);
});

test('schedule with from > to (overnight) handles wrap', () => {
  const sched = Array.from({ length: 7 }, (_, i) => ({ day: i, enabled: true, from: '22:00', to: '02:00' }));
  const r = evaluateDiscountRule(
    { ...base, alwaysAvailable: false, schedule: sched, discountPercent: 10 },
    ctx({ now: new Date('2026-05-10T23:30:00') }),
  );
  assert.equal(r.applies, true);
});

test('allowedOrderTypes BALCAO matches INDOOR (synonym)', () => {
  const r = evaluateDiscountRule(
    { ...base, allowedOrderTypes: ['BALCAO'], discountPercent: 10 },
    ctx({ orderType: 'INDOOR' }),
  );
  assert.equal(r.applies, true);
});

test('allowedOrderTypes DELIVERY does not match PICKUP', () => {
  const r = evaluateDiscountRule(
    { ...base, allowedOrderTypes: ['DELIVERY'], discountPercent: 10 },
    ctx({ orderType: 'PICKUP' }),
  );
  assert.equal(r.applies, false);
});

test('allowedOrderTypes empty array applies to all', () => {
  const r = evaluateDiscountRule(
    { ...base, allowedOrderTypes: [], discountPercent: 10 },
    ctx({ orderType: 'PICKUP' }),
  );
  assert.equal(r.applies, true);
});

test('blocksCashback flips when generatesCashback=false and rule applies', () => {
  const r = evaluateDiscountRule(
    { ...base, generatesCashback: false, discountPercent: 10 },
    ctx(),
  );
  assert.equal(r.blocksCashback, true);
});

test('removesCoupon flips when ignoreCoupons=true and rule applies', () => {
  const r = evaluateDiscountRule(
    { ...base, ignoreCoupons: true, discountPercent: 10 },
    ctx(),
  );
  assert.equal(r.removesCoupon, true);
});
```

**Step 2: Run test, verify it fails**

```bash
docker compose exec backend node --test tests/paymentDiscount.test.mjs
```

Expected: FAIL — `Cannot find module '../src/utils/paymentDiscount.js'`.

**Step 3: Implement helper**

```js
// src/utils/paymentDiscount.js
import { isTakeoutOrderType, TAKEOUT_TYPES } from './orderType.js';

function normalizeOrderType(t) {
  if (!t) return 'DELIVERY';
  const up = String(t).toUpperCase();
  if (up === 'DELIVERY') return 'DELIVERY';
  if (TAKEOUT_TYPES.includes(up)) {
    // collapse all takeout synonyms into TAKEOUT or BALCAO
    if (up === 'BALCAO' || up === 'BALCÃO' || up === 'INDOOR') return 'BALCAO';
    return 'TAKEOUT';
  }
  return up;
}

function hmToMin(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || ''));
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function isWithinSchedule(schedule, now) {
  if (!Array.isArray(schedule)) return false;
  const day = now.getDay(); // 0..6
  const slot = schedule[day];
  if (!slot || !slot.enabled) return false;
  const from = hmToMin(slot.from);
  const to = hmToMin(slot.to);
  if (from == null || to == null) return false;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  if (from <= to) return nowMin >= from && nowMin < to;
  // overnight window
  return nowMin >= from || nowMin < to;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

export function evaluateDiscountRule(method, ctx) {
  const result = { applies: false, amount: 0, removesCoupon: false, blocksCashback: false };
  if (!method || !method.isActive || !method.discountEnabled) return result;

  if (!method.alwaysAvailable) {
    if (!isWithinSchedule(method.schedule, ctx.now)) return result;
  }

  const allowed = Array.isArray(method.allowedOrderTypes) ? method.allowedOrderTypes : null;
  if (allowed && allowed.length > 0) {
    const want = normalizeOrderType(ctx.orderType);
    const ok = allowed.map((x) => normalizeOrderType(x)).includes(want);
    if (!ok) return result;
  }

  const sub = Number(ctx.subtotal) || 0;
  let amount = 0;
  if (method.discountPercent != null && method.discountPercent !== '') {
    amount = round2(sub * Number(method.discountPercent) / 100);
  } else if (method.discountFixed != null && method.discountFixed !== '') {
    amount = round2(Number(method.discountFixed));
  } else {
    return result; // rule on but no value configured
  }
  amount = Math.min(Math.max(amount, 0), sub);
  if (amount <= 0) return result;

  result.applies = true;
  result.amount = amount;
  result.removesCoupon = !!method.ignoreCoupons;
  result.blocksCashback = method.generatesCashback === false;
  return result;
}
```

**Step 4: Run test, verify it passes**

```bash
docker compose exec backend node --test tests/paymentDiscount.test.mjs
```

Expected: all tests PASS.

**Step 5: Commit**

```bash
git add delivery-saas-backend/src/utils/paymentDiscount.js delivery-saas-backend/tests/paymentDiscount.test.mjs
git commit -m "feat(payment-method): add evaluateDiscountRule helper with tests"
```

---

## Task 3: Backend CRUD — accept new fields with validation

**Files:**
- Modify: `delivery-saas-backend/src/routes/menu.js:921` (PM_EXTRA_FIELDS and POST/PATCH handlers)

**Step 1: Extend PM_EXTRA_FIELDS and add validator**

Replace the line `const PM_EXTRA_FIELDS = [...]` with:

```js
const PM_EXTRA_FIELDS = [
  'description','isOnline','noChange','paymentType','cardBrand','taxRate','fixedFee',
  'transferFormat','daysToReceive','accountId','intermediaryName','intermediaryCnpj','platformUserCode',
  'discountEnabled','discountPercent','discountFixed','ignoreCoupons','generatesCashback',
  'alwaysAvailable','schedule','allowedOrderTypes',
]

function validateDiscountRule(body) {
  if (!body || body.discountEnabled !== true) return null
  const hasPercent = body.discountPercent != null && body.discountPercent !== ''
  const hasFixed = body.discountFixed != null && body.discountFixed !== ''
  if (hasPercent && hasFixed) return 'Defina apenas um: percentual OU valor fixo'
  if (!hasPercent && !hasFixed) return 'Informe percentual ou valor fixo de desconto'
  if (hasPercent) {
    const p = Number(body.discountPercent)
    if (!Number.isFinite(p) || p <= 0 || p > 100) return 'Percentual deve ser entre 0 e 100'
  }
  if (hasFixed) {
    const v = Number(body.discountFixed)
    if (!Number.isFinite(v) || v <= 0) return 'Valor fixo deve ser positivo'
  }
  if (body.allowedOrderTypes != null && !Array.isArray(body.allowedOrderTypes)) {
    return 'allowedOrderTypes deve ser um array'
  }
  if (body.schedule != null && !Array.isArray(body.schedule)) {
    return 'schedule deve ser um array'
  }
  return null
}
```

**Step 2: Call validator in POST handler (line ~923)**

After `if (!name || !code) return res.status(400)...` add:

```js
const ruleErr = validateDiscountRule(req.body)
if (ruleErr) return res.status(400).json({ message: ruleErr })
```

**Step 3: Call validator in PATCH handler (line ~933)** — same pattern, but apply against merged body (`{ ...existing, ...req.body }`) so partial updates still validate correctly.

```js
const merged = { ...existing, ...req.body }
const ruleErr = validateDiscountRule(merged)
if (ruleErr) return res.status(400).json({ message: ruleErr })
```

**Step 4: Manual smoke test**

```bash
# Get a payment method id from the dev DB, then:
curl -X PATCH http://localhost:3000/menu/payment-methods/<id> \
  -H "Authorization: Bearer <jwt>" -H "Content-Type: application/json" \
  -d '{"discountEnabled":true,"discountPercent":5,"alwaysAvailable":true}'
```

Expected: 200 with updated row including new fields. Then:

```bash
curl -X PATCH .../payment-methods/<id> -d '{"discountEnabled":true,"discountPercent":5,"discountFixed":3}'
```

Expected: 400 "Defina apenas um".

**Step 5: Commit**

```bash
git add delivery-saas-backend/src/routes/menu.js
git commit -m "feat(payment-method): accept and validate discount-rule fields on CRUD"
```

---

## Task 4: Frontend — new "Desconto" tab in `PaymentMethodForm.vue`

**Files:**
- Modify: `delivery-saas-frontend/src/views/PaymentMethodForm.vue`

**Step 1: Import `AvailabilityScheduler`** (top of `<script setup>`):

```js
import AvailabilityScheduler from '../components/AvailabilityScheduler.vue'
```

**Step 2: Extend `defaultForm()`** (function around line 191):

```js
const defaultForm = () => ({
  id: null, name: '', description: '', code: '', isActive: true, isOnline: false,
  noChange: false, paymentType: '', cardBrand: '', taxRate: null, fixedFee: null,
  transferFormat: '', daysToReceive: null, accountId: '',
  intermediaryName: '', intermediaryCnpj: '', platformUserCode: '',
  config: {},
  // discount rule
  discountEnabled: false,
  discountType: 'percent', // UI-only toggle: 'percent' | 'fixed'
  discountPercent: null,
  discountFixed: null,
  ignoreCoupons: false,
  generatesCashback: true,
  alwaysAvailable: true,
  schedule: [],
  allowedOrderTypes: [],
})
```

**Step 3: Add tab in the `<ul class="nav nav-tabs">` block (around line 13)**:

```html
<li class="nav-item"><a class="nav-link" :class="{ active: tab === 'discount' }" href="#" @click.prevent="tab = 'discount'">Desconto</a></li>
```

**Step 4: Add the tab pane after the "Geral" tab content (before financial tab)**:

```html
<!-- TAB: Desconto -->
<div v-show="tab === 'discount'">
  <div class="form-check form-switch mb-3">
    <input class="form-check-input" type="checkbox" id="discountEnabled" v-model="form.discountEnabled" role="switch">
    <label class="form-check-label fw-semibold" for="discountEnabled">Habilitar regra de desconto</label>
    <div class="small text-muted">Aplica desconto automático no pedido ao selecionar este método</div>
  </div>

  <div v-if="form.discountEnabled">
    <div class="mb-3">
      <label class="form-label">Tipo de desconto</label>
      <div class="d-flex gap-3">
        <div class="form-check">
          <input class="form-check-input" type="radio" id="dtPercent" value="percent" v-model="form.discountType">
          <label class="form-check-label" for="dtPercent">Percentual (%)</label>
        </div>
        <div class="form-check">
          <input class="form-check-input" type="radio" id="dtFixed" value="fixed" v-model="form.discountType">
          <label class="form-check-label" for="dtFixed">Valor fixo (R$)</label>
        </div>
      </div>
    </div>

    <div class="mb-3 row">
      <div class="col-md-6" v-if="form.discountType === 'percent'">
        <label class="form-label">Percentual (%)</label>
        <input type="number" step="0.01" min="0" max="100" class="form-control" v-model.number="form.discountPercent" placeholder="Ex: 5">
      </div>
      <div class="col-md-6" v-else>
        <label class="form-label">Valor fixo (R$)</label>
        <input type="number" step="0.01" min="0" class="form-control" v-model.number="form.discountFixed" placeholder="Ex: 5.00">
      </div>
    </div>

    <div class="form-check form-switch mb-2">
      <input class="form-check-input" type="checkbox" id="ignoreCoupons" v-model="form.ignoreCoupons" role="switch">
      <label class="form-check-label" for="ignoreCoupons">Ignorar cupons ao selecionar este método</label>
    </div>

    <div class="form-check form-switch mb-3">
      <input class="form-check-input" type="checkbox" id="generatesCashback" v-model="form.generatesCashback" role="switch">
      <label class="form-check-label" for="generatesCashback">Gerar cashback</label>
      <div class="small text-muted">Quando desligado, pedidos pagos com este método não geram cashback</div>
    </div>

    <div class="mb-3">
      <label class="form-label fw-semibold">Tipos de pedido permitidos</label>
      <div class="small text-muted mb-2">Vazio = todos os tipos</div>
      <div class="d-flex gap-3 flex-wrap">
        <div class="form-check" v-for="t in orderTypeOptions" :key="t.value">
          <input class="form-check-input" type="checkbox" :id="`ot-${t.value}`" :value="t.value" v-model="form.allowedOrderTypes">
          <label class="form-check-label" :for="`ot-${t.value}`">{{ t.label }}</label>
        </div>
      </div>
    </div>

    <AvailabilityScheduler
      :always-available="form.alwaysAvailable"
      :schedule="form.schedule"
      @update:always-available="form.alwaysAvailable = $event"
      @update:schedule="form.schedule = $event"
    />
  </div>
</div>
```

**Step 5: Add `orderTypeOptions` constant in `<script setup>`**:

```js
const orderTypeOptions = [
  { value: 'DELIVERY', label: 'Delivery' },
  { value: 'BALCAO', label: 'Balcão' },
  { value: 'TAKEOUT', label: 'Retirada' },
]
```

**Step 6: Sync `discountType` when loading existing row** (after `form.value = { ...defaultForm(), ...d }` in `load()`):

```js
// derive UI toggle from persisted fields
if (d.discountFixed != null && (d.discountPercent == null || d.discountPercent === '')) {
  form.value.discountType = 'fixed'
} else {
  form.value.discountType = 'percent'
}
form.value.schedule = Array.isArray(d.schedule) ? d.schedule : []
form.value.allowedOrderTypes = Array.isArray(d.allowedOrderTypes) ? d.allowedOrderTypes : []
```

**Step 7: Update `save()` payload** — replace the `payload` object to include rule fields and clear the unused side:

```js
const ruleOn = !!form.value.discountEnabled
const usePercent = form.value.discountType === 'percent'
const payload = {
  // ... existing fields unchanged
  discountEnabled: ruleOn,
  discountPercent: ruleOn && usePercent && form.value.discountPercent != null && form.value.discountPercent !== ''
    ? Number(form.value.discountPercent) : null,
  discountFixed: ruleOn && !usePercent && form.value.discountFixed != null && form.value.discountFixed !== ''
    ? Number(form.value.discountFixed) : null,
  ignoreCoupons: !!form.value.ignoreCoupons,
  generatesCashback: form.value.generatesCashback !== false,
  alwaysAvailable: form.value.alwaysAvailable !== false,
  schedule: ruleOn && !form.value.alwaysAvailable ? form.value.schedule : null,
  allowedOrderTypes: Array.isArray(form.value.allowedOrderTypes) ? form.value.allowedOrderTypes : [],
}
```

**Step 8: Manual UI smoke test** — open `http://localhost:5173/settings/payment-methods/<id>`, switch to the new tab, toggle the switch, fill 5%, hit save. Confirm round-trip via reload.

**Step 9: Commit**

```bash
git add delivery-saas-frontend/src/views/PaymentMethodForm.vue
git commit -m "feat(payment-method): add Discount tab UI with rule fields"
```

---

## Task 5: Apply discount in order creation (publicCart + orders)

**Files:**
- Modify: `delivery-saas-backend/src/routes/publicCart.js` (or wherever public order is finalized — check `routes/orders.js` POST handler)
- Modify: `delivery-saas-backend/src/routes/orders.js`

> Sub-task before coding: open both files and locate the exact place where final `total` is computed and the Order is `prisma.order.create({...})`-d. Adjust line refs in your plan as you go.

**Step 1: Add a small loader near the order-creation site:**

```js
import { evaluateDiscountRule } from '../utils/paymentDiscount.js'
```

**Step 2: Right before the Order create, evaluate the rule (sketch — adapt to actual variable names):**

```js
let paymentDiscount = 0
let couponRemovedByPaymentRule = false
if (paymentMethodId) {
  const pm = await prisma.paymentMethod.findFirst({ where: { id: paymentMethodId, companyId } })
  const r = evaluateDiscountRule(pm, { orderType, subtotal, now: new Date() })
  if (r.applies) {
    paymentDiscount = r.amount
    if (r.removesCoupon && couponId) {
      couponId = null
      couponDiscount = 0
      couponRemovedByPaymentRule = true
    }
  }
}
const finalTotal = subtotal - couponDiscount - paymentDiscount + deliveryFee
```

**Step 3: Persist `paymentDiscount` in the `data:` passed to `prisma.order.create`:**

```js
data: {
  // ...existing fields
  paymentDiscount: paymentDiscount > 0 ? String(paymentDiscount) : null,
  total: String(finalTotal),
}
```

**Step 4: Include `paymentDiscount` + `couponRemovedByPaymentRule` in the response** so the frontend can show a toast/SweetAlert if a coupon was silently dropped.

**Step 5: Manual smoke test via POSTman / curl creating a public order with `paymentMethodId` pointing to a rule-enabled method; assert response total reflects the discount and DB row has `paymentDiscount` set.**

**Step 6: Commit**

```bash
git add delivery-saas-backend/src/routes/publicCart.js delivery-saas-backend/src/routes/orders.js
git commit -m "feat(orders): apply payment-method discount rule on creation"
```

---

## Task 6: Block cashback generation when rule says so

**Files:**
- Modify: `delivery-saas-backend/src/services/cashback.js` (around line 166)
- Modify: caller of `creditFromOrder` in `routes/orders.js`/`publicCart.js`

**Step 1: Add an optional skip path.** The cashback service is called from order finalization. Pass the `blocksCashback` flag through:

```js
// at the call site in orders.js / publicCart.js, immediately after order create:
if (r && r.applies && r.blocksCashback) {
  // skip cashback accrual entirely
} else {
  await cashbackService.creditFromOrder(/* existing args */)
}
```

Do not change `creditFromOrder` internals — gating at the caller is cleaner.

**Step 2: Add a regression smoke test (manual): create an order paid with a rule-enabled method where `generatesCashback=false`; verify no `CashbackTransaction` row was created.**

**Step 3: Commit**

```bash
git add delivery-saas-backend/src/routes/orders.js delivery-saas-backend/src/routes/publicCart.js
git commit -m "feat(cashback): respect payment-method generatesCashback=false flag"
```

---

## Task 7: Frontend public checkout — show discount + handle coupon conflict

**Files:**
- Modify: `delivery-saas-frontend/src/views/PublicMenu.vue` (cart panel + payment selection)

**Step 1: Add a `paymentDiscount` reactive ref and a function that recalculates on payment-method change.** Easiest path: extend the existing `evaluateCartDiscounts` preview endpoint OR call a new preview endpoint. Pragmatic approach for v1: keep client-side preview using the same `evaluateDiscountRule` ported, OR call a new preview endpoint:

```js
const paymentDiscount = ref(0)
async function recalcPaymentDiscount() {
  const pm = paymentMethods.value.find(m => m.id === selectedPaymentMethodId.value)
  if (!pm || !pm.discountEnabled) { paymentDiscount.value = 0; return }
  // call backend preview to keep logic in one place
  const res = await api.post(`/public/${companyId}/cart/payment-preview`, {
    paymentMethodId: pm.id,
    orderType: orderType.value,
    subtotal: subtotal.value,
  })
  paymentDiscount.value = Number(res.data?.amount || 0)
  if (res.data?.removesCoupon && couponApplied.value) {
    const ok = await Swal.fire({ icon: 'warning', title: 'Cupom não cumulativo',
      text: 'Este método de pagamento remove o cupom aplicado. Deseja continuar?',
      showCancelButton: true, confirmButtonText: 'Sim, manter método', cancelButtonText: 'Cancelar' })
    if (!ok.isConfirmed) {
      selectedPaymentMethodId.value = previousPaymentMethodId.value
      return recalcPaymentDiscount()
    }
    removeCoupon()
  }
}
watch(selectedPaymentMethodId, () => recalcPaymentDiscount())
watch(orderType, () => recalcPaymentDiscount())
```

**Step 2: Add backend preview endpoint** in `publicCart.js`:

```js
router.post('/payment-preview', async (req, res) => {
  const companyId = req.params.companyId
  const { paymentMethodId, orderType, subtotal } = req.body || {}
  const pm = paymentMethodId ? await prisma.paymentMethod.findFirst({ where: { id: paymentMethodId, companyId } }) : null
  const { evaluateDiscountRule } = await import('../utils/paymentDiscount.js')
  const r = evaluateDiscountRule(pm, { orderType, subtotal: Number(subtotal) || 0, now: new Date() })
  res.json(r)
})
```

**Step 3: Render the discount row in the summary** (near `<div class="d-flex justify-content-between mb-1"><span>Entrega</span>...`):

```html
<div v-if="paymentDiscount > 0" class="d-flex justify-content-between mb-1 text-success">
  <span>Desconto pagamento</span><span>−{{ formatCurrency(paymentDiscount) }}</span>
</div>
```

**Step 4: Update grand total computation to subtract `paymentDiscount`.**

**Step 5: Manual UI smoke test** — open the public menu, add items, pick a rule-enabled method, confirm the discount line appears and total drops.

**Step 6: Commit**

```bash
git add delivery-saas-frontend/src/views/PublicMenu.vue delivery-saas-backend/src/routes/publicCart.js
git commit -m "feat(public-menu): preview and apply payment-method discount in checkout"
```

---

## Task 8: POS — same recalculation in `POSOrderWizard.vue`

**Files:**
- Modify: `delivery-saas-frontend/src/components/POSOrderWizard.vue`

**Step 1: Mirror Task 7 step 1 — but call an internal admin endpoint (the existing `/menu/payment-methods` returns full rows; can call `evaluateDiscountRule` client-side OR add `/menu/payment-preview` mirror).** Recommended: add `/menu/payment-preview` (auth required) reusing the same helper.

**Step 2: Add summary line and adjust totals exactly like the public flow.**

**Step 3: Commit**

```bash
git add delivery-saas-frontend/src/components/POSOrderWizard.vue delivery-saas-backend/src/routes/menu.js
git commit -m "feat(pos): apply payment-method discount on POSOrderWizard"
```

---

## Task 9: Final verification

**Step 1: Run all unit tests:**

```bash
docker compose exec backend npm test
```

Expected: all pass, including the new `paymentDiscount.test.mjs`.

**Step 2: End-to-end manual checklist:**

- [ ] Create a method "PIX 5%" with `discountEnabled=true, discountPercent=5, alwaysAvailable=true, allowedOrderTypes=[]` — saves OK
- [ ] Create a method "Dinheiro Balcão 10%" with `discountFixed=10, allowedOrderTypes=["BALCAO"]` — saves OK
- [ ] Public checkout, DELIVERY order, pick PIX → 5% off shown and applied to total
- [ ] Switch to Dinheiro Balcão → discount disappears (DELIVERY not in allowed list)
- [ ] Apply a coupon, then switch to a method with `ignoreCoupons=true` → SweetAlert appears; choosing "manter método" drops coupon
- [ ] Order is created — DB row has `paymentDiscount` populated
- [ ] Method with `generatesCashback=false` → no CashbackTransaction row created for that order
- [ ] Schedule restricted to 11-14h, current time 15h → discount not applied; current time 12h → applied

**Step 3: Confirm migration was applied to production schema before deploying:**

```bash
# On VPS
docker compose exec backend npx prisma db push
```

**Step 4: Final commit (changelog / docs only if needed) and merge plan complete.**

---

## Notes & gotchas

- **PaymentMethod.config (Json?) is untouched** — we use dedicated columns so existing config behavior is unchanged.
- **`now`** is constructed server-side at order creation; clients see a preview but the truth is server-side at the exact moment of `prisma.order.create`.
- **TAKEOUT_TYPES** in `src/utils/orderType.js` already includes BALCAO/INDOOR/PICKUP/RETIRADA — the helper collapses synonyms so the lojista sees only 3 options in the UI but matches all variants.
- **Don't change `creditFromOrder` internals** — gate at the caller. This keeps the cashback service single-responsibility.
- **DRY-test the helper**, not the route — route smoke tests via curl are sufficient.
