# Orders Without Cash Session — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Orders accepted without an open cash register accumulate visually outside the kanban board, signaling the operator to open the cash register. When opened, a prompt links pending orders to the new session.

**Architecture:** Frontend-driven visibility: Orders.vue checks for an open cash session via a lightweight API call and filters `outOfSession` orders into a separate alert box. Backend marks `outOfSession: true` at order creation (not just completion). New endpoint `POST /cash/link-pending-orders` bulk-links orders when operator confirms.

**Tech Stack:** Vue 3, Bootstrap 5, Express.js, Prisma, Socket.IO, SweetAlert2

---

### Task 1: Backend — mark outOfSession at order creation (PDV)

**Files:**
- Modify: `delivery-saas-backend/src/routes/orders.js:1251-1284`

**Step 1: Add outOfSession check after PDV order creation**

After the `prisma.order.create()` call at line 1284, add a cash session check:

```javascript
// After line 1284 (after order create, before geocode)
// Check if there's an open cash session — mark outOfSession if not
try {
  const { findMatchingSession } = await import('../services/cash/sessionMatcher.js');
  const matchedSession = await findMatchingSession(created, req.user.id);
  if (matchedSession) {
    await prisma.order.update({ where: { id: created.id }, data: { cashSessionId: matchedSession.id, outOfSession: false } });
    created.cashSessionId = matchedSession.id;
    created.outOfSession = false;
  } else {
    await prisma.order.update({ where: { id: created.id }, data: { outOfSession: true } });
    created.outOfSession = true;
  }
} catch (e) { console.warn('[orders.create] cash session check failed:', e?.message); }
```

**Step 2: Commit**

```bash
git add delivery-saas-backend/src/routes/orders.js
git commit -m "feat(orders): mark outOfSession at PDV order creation"
```

---

### Task 2: Backend — mark outOfSession for external orders (fileWatcher + aiqfome)

**Files:**
- Modify: `delivery-saas-backend/src/fileWatcher.js:500-507`
- Modify: `delivery-saas-backend/src/integrations/aiqfome/webhookProcessor.js` (after order create)

**Step 1: Add cash session check in fileWatcher after order creation**

After the transactional order creation (line 506 `return { order: o, wasNew: true }`), add the outOfSession check. Since fileWatcher has no user context, pass `null` for userId:

```javascript
// After line 509 (const o = result.order;)
if (result.wasNew) {
  try {
    const { findMatchingSession } = await import('./services/cash/sessionMatcher.js');
    const matchedSession = await findMatchingSession(o, null);
    if (matchedSession) {
      await prisma.order.update({ where: { id: o.id }, data: { cashSessionId: matchedSession.id, outOfSession: false } });
    } else {
      await prisma.order.update({ where: { id: o.id }, data: { outOfSession: true } });
    }
  } catch (e) { console.warn('[fileWatcher] cash session check failed:', e?.message); }
}
```

**Step 2: Add same check in aiqfome webhookProcessor after order creation**

Same pattern — after `savedOrder` is created, check for matching session.

**Step 3: Commit**

```bash
git add delivery-saas-backend/src/fileWatcher.js delivery-saas-backend/src/integrations/aiqfome/webhookProcessor.js
git commit -m "feat(orders): mark outOfSession for external order sources"
```

---

### Task 3: Backend — new endpoint POST /cash/link-pending-orders

**Files:**
- Modify: `delivery-saas-backend/src/routes/cash.js` (add new route after the `/current` endpoint)

**Step 1: Add the endpoint**

```javascript
// POST /cash/link-pending-orders — bulk-link outOfSession orders to current session
cashRouter.post('/link-pending-orders', async (req, res) => {
  const { companyId, id: userId } = req.user;
  if (!companyId) return res.status(400).json({ message: 'Usuario sem empresa' });

  // Find user's current open session
  const session = await prisma.cashSession.findFirst({
    where: {
      companyId,
      status: 'OPEN',
      OR: [
        { ownerId: userId },
        { operators: { some: { userId } } },
      ],
    },
  });
  if (!session) return res.status(400).json({ message: 'Nenhuma sessao aberta' });

  // Find active orders marked outOfSession
  const result = await prisma.order.updateMany({
    where: {
      companyId,
      outOfSession: true,
      status: { notIn: ['CONCLUIDO', 'CANCELADO'] },
    },
    data: {
      cashSessionId: session.id,
      outOfSession: false,
    },
  });

  res.json({ linked: result.count, sessionId: session.id });
});
```

**Step 2: Commit**

```bash
git add delivery-saas-backend/src/routes/cash.js
git commit -m "feat(cash): add link-pending-orders endpoint"
```

---

### Task 4: Backend — count out-of-session orders endpoint

**Files:**
- Modify: `delivery-saas-backend/src/routes/cash.js`

**Step 1: Add a count endpoint (used by CashControl after opening)**

```javascript
// GET /cash/out-of-session-count — count active outOfSession orders
cashRouter.get('/out-of-session-count', async (req, res) => {
  const { companyId } = req.user;
  if (!companyId) return res.json({ count: 0 });

  const count = await prisma.order.count({
    where: {
      companyId,
      outOfSession: true,
      status: { notIn: ['CONCLUIDO', 'CANCELADO'] },
    },
  });

  res.json({ count });
});
```

**Step 2: Commit**

```bash
git add delivery-saas-backend/src/routes/cash.js
git commit -m "feat(cash): add out-of-session-count endpoint"
```

---

### Task 5: Frontend — add cash session awareness to Orders.vue

**Files:**
- Modify: `delivery-saas-frontend/src/views/Orders.vue`

**Step 1: Add hasCashSession ref and check on mount**

In the `<script setup>` section, near the other refs:

```javascript
const hasCashSession = ref(true); // assume open until checked
```

Add a function to check:

```javascript
async function checkCashSession() {
  try {
    const { data } = await api.get('/cash/current');
    hasCashSession.value = !!data;
  } catch {
    hasCashSession.value = false;
  }
}
```

Call it on mounted (alongside existing `store.fetch()`). Also listen for socket event `cash-session-changed` to refresh:

```javascript
// In the socket setup section, add:
socket.on('cash-session-changed', () => { checkCashSession(); });
```

**Step 2: Add noCashOrders computed**

After the `pendingOrders` computed (line 2562):

```javascript
const noCashOrders = computed(() => {
  if (hasCashSession.value) return [];
  return (store.orders || []).filter(o => {
    if (!o) return false;
    const status = (o.status || '').toUpperCase();
    return o.outOfSession === true
      && status !== 'CONCLUIDO'
      && status !== 'CANCELADO'
      && status !== 'PENDENTE_ACEITE';
  });
});
```

**Step 3: Exclude noCashOrders from kanban columns**

Modify the `columnOrders` function (line 2535) to exclude outOfSession orders when there's no cash session:

```javascript
function columnOrders(key) {
  const col = COLUMNS.find(c => c.key === key);
  const accepted = [key.toUpperCase(), ...(col && col.also ? col.also.map(s => s.toUpperCase()) : [])];
  try {
    return filteredOrders.value.filter((o) => {
      if (!o) return false;
      if (!hasCashSession.value && o.outOfSession) return false;
      return accepted.includes((o.status || '').toUpperCase());
    }).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  } catch (e) {
    // existing fallback...
  }
}
```

**Step 4: Commit**

```bash
git add delivery-saas-frontend/src/views/Orders.vue
git commit -m "feat(orders): add cash session awareness and noCashOrders filter"
```

---

### Task 6: Frontend — add "no cash" alert box to Orders.vue template

**Files:**
- Modify: `delivery-saas-frontend/src/views/Orders.vue` (template + style)

**Step 1: Add alert box template**

After the `pending-acceptance-box` section (after line 3363), add:

```html
<!-- Orders without cash session -->
<div v-if="noCashOrders.length > 0" class="no-cash-box mb-3">
  <div class="no-cash-header">
    <i class="bi bi-cash-coin"></i>
    <span class="fw-semibold">{{ noCashOrders.length }} pedido(s) sem caixa aberto</span>
    <span class="ms-2 small">Abra o caixa para movimentar estes pedidos</span>
  </div>
  <div v-for="o in noCashOrders" :key="'nc-'+o.id" class="no-cash-card">
    <div class="no-cash-card-info">
      <div class="fw-semibold">#{{ formatDisplay(o) }} - {{ o.customerName || 'Cliente' }}</div>
      <div class="small text-muted">
        <span :class="statusBadge(o.status)">{{ statusLabel(o.status) }}</span>
        <span v-if="normalizeOrder(o).channelLabel" class="ms-2 badge bg-light text-dark">{{ normalizeOrder(o).channelLabel }}</span>
      </div>
    </div>
    <div class="no-cash-card-total fw-bold">
      {{ formatCurrency(storeRevenue(o)) }}
    </div>
  </div>
</div>
```

**Step 2: Add CSS styles**

In the `<style>` section, after the `.pending-acceptance-box` styles:

```css
.no-cash-box {
  border: 2px solid #e65100;
  border-radius: 12px;
  background: #fff3e0;
  overflow: hidden;
  animation: no-cash-pulse 2s ease-in-out infinite;
}
.no-cash-header {
  background: #e65100;
  color: #fff;
  padding: 10px 16px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.95rem;
}
.no-cash-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-top: 1px solid #ffcc80;
}
.no-cash-card:first-of-type { border-top: none; }
.no-cash-card-info { flex: 1; min-width: 0; }
.no-cash-card-total { flex-shrink: 0; margin-left: 12px; }
@keyframes no-cash-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(230, 81, 0, 0.4); }
  50% { box-shadow: 0 0 12px 4px rgba(230, 81, 0, 0.25); }
}
```

**Step 3: Commit**

```bash
git add delivery-saas-frontend/src/views/Orders.vue
git commit -m "feat(orders): add visual alert box for orders without cash session"
```

---

### Task 7: Frontend — CashControl prompt to link orders after opening

**Files:**
- Modify: `delivery-saas-frontend/src/components/CashControl.vue:196-204`

**Step 1: After successful cash open, check for out-of-session orders**

Replace lines 196-204 in the `openCash()` function:

```javascript
  // (existing) if (!formValues) return;
  loading.value = true;
  try {
    const { data } = await api.post('/cash/open', formValues);
    await loadCurrentSession(true);
    invalidateCashSummary();

    // Check for out-of-session orders and offer to link them
    try {
      const { data: oosData } = await api.get('/cash/out-of-session-count');
      if (oosData.count > 0) {
        const result = await Swal.fire({
          title: 'Pedidos fora do caixa',
          text: `Ha ${oosData.count} pedido(s) que entraram sem caixa aberto. Deseja vincula-los a esta sessao?`,
          icon: 'question',
          showCancelButton: true,
          confirmButtonText: 'Sim, vincular',
          cancelButtonText: 'Nao',
        });
        if (result.isConfirmed) {
          await api.post('/cash/link-pending-orders');
          Swal.fire({ icon: 'success', text: `${oosData.count} pedido(s) vinculado(s) ao caixa`, timer: 2000, showConfirmButton: false });
        }
      } else {
        Swal.fire({ icon: 'success', text: 'Caixa aberto', timer: 1500, showConfirmButton: false });
      }
    } catch (e) {
      // If count check fails, just show normal success
      Swal.fire({ icon: 'success', text: 'Caixa aberto', timer: 1500, showConfirmButton: false });
    }
  } catch (e) {
    console.error(e);
    Swal.fire('Erro', e?.response?.data?.message || 'Falha ao abrir caixa', 'error');
  } finally { loading.value = false }
```

**Step 2: Emit custom event so Orders.vue can refresh**

After the link-pending-orders call succeeds, emit a DOM event:

```javascript
window.dispatchEvent(new CustomEvent('cash-session-opened'));
```

**Step 3: In Orders.vue, listen for this event and refresh**

```javascript
// In onMounted:
window.addEventListener('cash-session-opened', onCashSessionOpened);

// In onUnmounted:
window.removeEventListener('cash-session-opened', onCashSessionOpened);

function onCashSessionOpened() {
  hasCashSession.value = true;
  store.fetch(); // reload orders to get updated outOfSession flags
}
```

**Step 4: Commit**

```bash
git add delivery-saas-frontend/src/components/CashControl.vue delivery-saas-frontend/src/views/Orders.vue
git commit -m "feat(cash): prompt to link out-of-session orders when opening register"
```

---

### Task 8: Final integration — socket event for real-time sync

**Files:**
- Modify: `delivery-saas-backend/src/routes/cash.js` (in the open and link-pending endpoints)

**Step 1: Emit socket event after cash session opens and after linking orders**

In the `POST /cash/open` route, after creating the session, emit:

```javascript
try {
  const idx = await import('../index.js');
  idx.getIO().to(`company_${companyId}`).emit('cash-session-changed', { type: 'opened', sessionId: session.id });
} catch (e) {}
```

In the `POST /cash/link-pending-orders` route, after updating orders:

```javascript
try {
  const idx = await import('../index.js');
  idx.getIO().to(`company_${companyId}`).emit('cash-session-changed', { type: 'orders-linked', count: result.count });
} catch (e) {}
```

Also emit on close (if not already done).

**Step 2: Commit**

```bash
git add delivery-saas-backend/src/routes/cash.js
git commit -m "feat(cash): emit socket events for cash session changes"
```

---

### Task 9: Final commit and push

**Step 1: Verify all files**

```bash
git status
git log --oneline -10
```

**Step 2: Push to main**

```bash
git push origin main
```
