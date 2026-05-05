# INVOICE_AUTHORIZED Parallel Status — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Stop overwriting `Order.status` to `INVOICE_AUTHORIZED` on NF-e authorization so orders stay in their kanban column; show a small "NFC-e" badge on the kanban card; migrate existing orders out of `INVOICE_AUTHORIZED`.

**Architecture:** The state "NF-e authorized" already lives in `order.payload.nfe.nProt` — we make that the sole source of truth and stop touching `status` in `saveNfeProtocol`. Existing rows are migrated via a one-shot Node.js script that uses Prisma. The frontend reads `order.payload?.nfe?.nProt` to render a badge in the kanban card.

**Tech Stack:** Node.js + Prisma (PostgreSQL), Vue 3 SFC, Bootstrap 5.

---

### Task 0: Create feature branch

**Files:** none (git only)

**Step 1: Verify clean working tree (only design doc may be staged)**

Run: `git status`
Expected: working tree clean OR untracked-only files. The design doc commit `1b9059a` is already on `main`.

**Step 2: Create branch from current `main`**

```bash
git checkout -b feat/invoice-authorized-parallel-status
```

Expected: `Switched to a new branch 'feat/invoice-authorized-parallel-status'`

**Step 3: Confirm branch**

Run: `git branch --show-current`
Expected: `feat/invoice-authorized-parallel-status`

---

### Task 1: Backend — stop overwriting `status` on NF-e authorization

**Files:**
- Modify: `delivery-saas-backend/src/services/nfe.js:49-50`

**Step 1: Inspect the current code**

Read [delivery-saas-backend/src/services/nfe.js:38-56](delivery-saas-backend/src/services/nfe.js#L38-L56). The block we change is exactly:

```javascript
  const newPayload = { ...oldPayload, nfe: nfeInfo }
  // update order payload and set status to INVOICE_AUTHORIZED
  await prisma.order.update({ where: { id: orderId }, data: { payload: newPayload, status: 'INVOICE_AUTHORIZED' } })
```

**Step 2: Apply the edit**

Replace those exact two lines (the comment + the update call) with:

```javascript
  const newPayload = { ...oldPayload, nfe: nfeInfo }
  // NF-e autorizada vira flag paralelo via payload.nfe — não sobrescrever status
  await prisma.order.update({ where: { id: orderId }, data: { payload: newPayload } })
```

Use the Edit tool with `old_string` covering both the comment and the `await prisma.order.update(...)` line so the match is unique.

**Step 3: Verify the file parses**

Run: `cd delivery-saas-backend && node --check src/services/nfe.js`
Expected: no output (exit code 0)

**Step 4: Verify no other backend code sets `INVOICE_AUTHORIZED`**

Run: `cd delivery-saas-backend && grep -rn "INVOICE_AUTHORIZED" src/`
Expected: zero matches in backend `src/` (the only writer was the line we just removed).

**Step 5: Commit**

```bash
git add delivery-saas-backend/src/services/nfe.js
git commit -m "fix(nfe): preservar status do pedido na autorização da NF-e

A informação de NF-e autorizada já vive em payload.nfe.nProt.
Sobrescrever status para INVOICE_AUTHORIZED tirava o pedido do
kanban e impedia vinculá-lo ao caixa."
```

---

### Task 2: Migration script for existing INVOICE_AUTHORIZED orders

**Files:**
- Create: `delivery-saas-backend/prisma/scripts/restore-invoice-authorized-status.js`

**Step 1: Create the directory and script**

Create the file with this exact content:

```javascript
'use strict'
/**
 * One-shot: restaura o status de pedidos cuja única razão para estarem em
 * INVOICE_AUTHORIZED foi a emissão da NF-e. Esses pedidos passam a CONCLUIDO,
 * que é o status mais provável antes da emissão.
 *
 * Uso (host):
 *   node prisma/scripts/restore-invoice-authorized-status.js
 *
 * Uso (Docker):
 *   docker compose exec backend node prisma/scripts/restore-invoice-authorized-status.js
 */
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

async function main() {
  const candidates = await prisma.order.findMany({
    where: { status: 'INVOICE_AUTHORIZED' },
    select: { id: true, displaySimple: true, payload: true },
  })

  const withNfe = candidates.filter((o) => o.payload && o.payload.nfe && o.payload.nfe.nProt)
  const withoutNfe = candidates.filter((o) => !(o.payload && o.payload.nfe && o.payload.nfe.nProt))

  console.log(`Encontrados: ${candidates.length} pedidos com status=INVOICE_AUTHORIZED`)
  console.log(`  com payload.nfe.nProt: ${withNfe.length} → migrar para CONCLUIDO`)
  console.log(`  sem payload.nfe.nProt: ${withoutNfe.length} → mantidos (caso atípico, revisar manualmente)`)

  if (withNfe.length === 0) {
    console.log('Nada a fazer.')
    return
  }

  const result = await prisma.order.updateMany({
    where: { id: { in: withNfe.map((o) => o.id) } },
    data: { status: 'CONCLUIDO' },
  })

  console.log(`Atualizados: ${result.count} pedidos para CONCLUIDO.`)
}

main()
  .catch((err) => {
    console.error('Falha na migração:', err)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
```

**Step 2: Verify the file parses**

Run: `cd delivery-saas-backend && node --check prisma/scripts/restore-invoice-authorized-status.js`
Expected: no output (exit code 0)

**Step 3: Dry-run sanity check (read-only count)**

Run a quick local read-only check via the Docker dev DB:

```bash
docker compose exec backend node -e "const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.order.count({where:{status:'INVOICE_AUTHORIZED'}}).then(c=>{console.log('count:',c);return p.\$disconnect()})"
```

Expected: prints a number (could be `0` in dev) and exits cleanly. We are not running the migration yet — just confirming Prisma connects and the enum value is recognized.

**Step 4: Commit**

```bash
git add delivery-saas-backend/prisma/scripts/restore-invoice-authorized-status.js
git commit -m "chore(nfe): script para restaurar status de pedidos com INVOICE_AUTHORIZED legado

Após a parada de sobrescrita do status, pedidos antigos seguem com
INVOICE_AUTHORIZED e ficam fora do kanban. O script os reverte para
CONCLUIDO quando há payload.nfe.nProt (caso esperado)."
```

---

### Task 3: Frontend — badge "NFC-e" no card do kanban

**Files:**
- Modify: `delivery-saas-frontend/src/views/Orders.vue:3573-3578`

**Step 1: Read the surrounding template**

Read [delivery-saas-frontend/src/views/Orders.vue:3565-3580](delivery-saas-frontend/src/views/Orders.vue#L3565-L3580). The target block is the `oc-title` span ending at line 3578.

**Step 2: Insert the badge after the tier badge**

Use Edit. `old_string`:

```html
                  <span class="oc-title">#{{ formatDisplay(o) }} - <span class="oc-customer-name">{{ o.customerName || 'Cliente' }}</span>
                    <span v-if="getCustomerStats(o)" class="ms-2">
                  
                      <span class="badge tier-badge" :style="{ background: tierBgColors[getCustomerStats(o).tier], color: tierColors[getCustomerStats(o).tier] }">{{ getCustomerStats(o).label }}</span>
                    </span>
                  </span>
```

`new_string`:

```html
                  <span class="oc-title">#{{ formatDisplay(o) }} - <span class="oc-customer-name">{{ o.customerName || 'Cliente' }}</span>
                    <span v-if="getCustomerStats(o)" class="ms-2">
                  
                      <span class="badge tier-badge" :style="{ background: tierBgColors[getCustomerStats(o).tier], color: tierColors[getCustomerStats(o).tier] }">{{ getCustomerStats(o).label }}</span>
                    </span>
                    <span v-if="o.payload?.nfe?.nProt" class="badge bg-info text-dark ms-2" title="NF-e autorizada">
                      <i class="bi bi-receipt-cutoff"></i> NFC-e
                    </span>
                  </span>
```

**Step 3: Visual verification**

Start the dev environment and open the kanban:

```bash
docker compose up -d
```

Wait for `frontend` to be ready (check `docker compose logs frontend | grep ready` or open the URL). Then:

1. Open `http://localhost:5173/orders` in a browser.
2. Find an order that has `payload.nfe.nProt` set (or use `psql` to set one for testing). Confirm a teal "NFC-e" badge appears next to the customer name.
3. Confirm orders without NF-e do **not** show the badge.

If you cannot test the UI in this environment, state explicitly: "UI not verified in browser — code-level review only."

**Step 4: Commit**

```bash
git add delivery-saas-frontend/src/views/Orders.vue
git commit -m "feat(orders): badge NFC-e no card do kanban quando há nota autorizada"
```

---

### Task 4: Frontend — limpar `INVOICE_AUTHORIZED` do filtro de status

**Files:**
- Modify: `delivery-saas-frontend/src/views/Orders.vue:3168`

**Step 1: Read the current list**

Read [delivery-saas-frontend/src/views/Orders.vue:3160-3170](delivery-saas-frontend/src/views/Orders.vue#L3160-L3170).

**Step 2: Remove the INVOICE_AUTHORIZED entry**

Use Edit. `old_string`:

```javascript
  { value: 'CANCELADO', label: 'Cancelado', color: 'danger' },
  { value: 'INVOICE_AUTHORIZED', label: 'NFC-e aut.', color: 'info' },
];
```

`new_string`:

```javascript
  { value: 'CANCELADO', label: 'Cancelado', color: 'danger' },
];
```

**Step 3: Confirm `STATUS_LABEL` and color maps still cover INVOICE_AUTHORIZED**

Run: `grep -n "INVOICE_AUTHORIZED" delivery-saas-frontend/src/views/Orders.vue`
Expected: only `STATUS_LABEL` line (~2657) — kept on purpose for any residual data.

**Step 4: Commit**

```bash
git add delivery-saas-frontend/src/views/Orders.vue
git commit -m "chore(orders): remove filtro INVOICE_AUTHORIZED (status agora é paralelo)"
```

---

### Task 5: End-to-end validation

**Files:** none (validation only)

**Step 1: Start the dev stack**

Run: `docker compose up -d`
Expected: `db`, `backend`, `frontend` all healthy. Verify with `docker compose ps`.

**Step 2: Run the legacy migration in dev**

Run: `docker compose exec backend node prisma/scripts/restore-invoice-authorized-status.js`
Expected: prints counts; exits 0. In a fresh dev DB, count is likely `0`.

**Step 3: Manual test — emit NF-e on a CONCLUIDO order**

In the UI:
1. Pick or create a `CONCLUIDO` order in homologation mode (the dev environment uses tpAmb=2).
2. Click "Emitir NF-e" and wait for SEFAZ authorization.
3. Confirm the order **stays in the Concluído column**.
4. Confirm the **NFC-e badge** appears on the card.
5. Confirm `payload.nfe.nProt` is populated (visible in the order detail panel).
6. Confirm the cash-session screen lists the order (it should, since `status === 'CONCLUIDO'`).

If you cannot run the SEFAZ flow, do a DB-level simulation instead: pick a CONCLUIDO order with a non-null `payload.nfe.nProt` and confirm the badge appears. Report which form of validation you ran.

**Step 4: Push the branch**

```bash
git push -u origin feat/invoice-authorized-parallel-status
```

**Step 5: Hand off**

Announce: "Implementação completa. Próximo passo: superpowers:finishing-a-development-branch para escolher entre merge direto, PR ou cleanup."

Use the **superpowers:finishing-a-development-branch** skill.
