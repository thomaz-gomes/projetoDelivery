# SaaS Error Logs Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a SaaS-admin-only error log screen that automatically captures backend errors, deduplicates them by fingerprint, and lets SUPER_ADMINs mark errors as resolved or delete them.

**Architecture:** New `ErrorLog` Prisma model. A `logError()` utility upserts by SHA-256 fingerprint of `message+route` so duplicates increment a counter instead of creating new rows. Hook into the existing Express error middleware at [delivery-saas-backend/src/index.js:449](../../delivery-saas-backend/src/index.js#L449) plus `process.on('uncaughtException'/'unhandledRejection')` in [server.js](../../delivery-saas-backend/src/server.js). Four endpoints under `/saas/error-logs` (existing auth pattern, `requireRole('SUPER_ADMIN')`). New Vue view `SaasErrorLogs.vue` using existing `<ListCard>`, `<BaseButton>`, `<BaseIconButton>` and SweetAlert2.

**Tech Stack:** Express, Prisma 6 (PostgreSQL), Vue 3 Composition API, Bootstrap 5, Bootstrap Icons, Axios, SweetAlert2, Node `crypto.createHash`.

**Reference design doc:** [docs/plans/2026-05-06-saas-error-logs-design.md](2026-05-06-saas-error-logs-design.md)

---

## Task 1: Add `ErrorLog` model to Prisma schema

**Files:**
- Modify: [delivery-saas-backend/prisma/schema.prisma](../../delivery-saas-backend/prisma/schema.prisma)

**Step 1: Add the model**

Append at the end of [delivery-saas-backend/prisma/schema.prisma](../../delivery-saas-backend/prisma/schema.prisma):

```prisma
model ErrorLog {
  id           Int       @id @default(autoincrement())
  fingerprint  String    @unique
  message      String    @db.Text
  stack        String?   @db.Text
  route        String?
  method       String?
  statusCode   Int?
  companyId    String?
  userId       String?
  occurrences  Int       @default(1)
  firstSeen    DateTime  @default(now())
  lastSeen     DateTime  @default(now())
  resolved     Boolean   @default(false)
  resolvedAt   DateTime?
  resolvedBy   String?
  company      Company?  @relation(fields: [companyId], references: [id], onDelete: SetNull)

  @@index([resolved, lastSeen])
  @@index([companyId])
}
```

**Step 2: Add the back-relation on `Company`**

In the `Company` model (around line 37–160), add:

```prisma
errorLogs    ErrorLog[]
```

**Step 3: Apply schema with `db push` (project convention — never `migrate dev`)**

Run inside the backend container or local backend folder:

```bash
docker compose exec backend npx prisma db push --skip-generate
docker compose exec backend npx prisma generate
```

Expected: "The database is now in sync with your Prisma schema." and "Generated Prisma Client".

**Step 4: Verify the table exists**

```bash
docker compose exec db psql -U postgres -d projetodelivery -c "\d \"ErrorLog\""
```

Expected: table with columns `id`, `fingerprint`, `message`, etc., plus the unique index on `fingerprint`.

**Step 5: Commit**

```bash
git add delivery-saas-backend/prisma/schema.prisma
git commit -m "feat(db): add ErrorLog model for SaaS error monitoring"
```

---

## Task 2: Implement `errorLogger.js` utility

**Files:**
- Create: `delivery-saas-backend/src/utils/errorLogger.js`

**Step 1: Write the utility**

```js
import crypto from 'crypto';
import { prisma } from '../db.js';

function fingerprintFor(message, route) {
  return crypto
    .createHash('sha256')
    .update(`${message || 'unknown'}::${route || 'unknown'}`)
    .digest('hex')
    .slice(0, 16);
}

export async function logError({ err, req = null }) {
  try {
    const message = (err && (err.message || String(err))) || 'unknown error';
    const stack = err && err.stack ? String(err.stack).slice(0, 8000) : null;
    const method = req?.method || null;
    const path = req?.originalUrl || req?.url || null;
    const route = method && path ? `${method} ${path.split('?')[0]}` : null;
    const statusCode = err?.status || err?.statusCode || null;
    const companyId = req?.user?.companyId || null;
    const userId = req?.user?.id || null;
    const fingerprint = fingerprintFor(message, route);
    const now = new Date();

    await prisma.errorLog.upsert({
      where: { fingerprint },
      create: {
        fingerprint,
        message: message.slice(0, 1000),
        stack,
        route,
        method,
        statusCode,
        companyId,
        userId,
      },
      update: {
        occurrences: { increment: 1 },
        lastSeen: now,
        resolved: false,
        resolvedAt: null,
        resolvedBy: null,
        // Update stack/statusCode on each occurrence so most-recent context wins.
        stack,
        statusCode,
      },
    });
  } catch (loggingErr) {
    console.error('errorLogger failed:', loggingErr && loggingErr.message);
  }
}

export { fingerprintFor };
```

**Step 2: Verify the prisma import path**

```bash
grep -n "export.*prisma" delivery-saas-backend/src/db.js
```

Expected: an exported `prisma` client. If `db.js` exports under a different name, adjust the import.

**Step 3: Quick smoke test of pure fingerprint function**

Create a temporary script `delivery-saas-backend/scripts/test-fingerprint.mjs`:

```js
import { fingerprintFor } from '../src/utils/errorLogger.js';
console.log(fingerprintFor('Cannot read prop x', 'GET /orders'));
console.log(fingerprintFor('Cannot read prop x', 'GET /orders'));
console.log(fingerprintFor('Cannot read prop x', 'POST /orders'));
```

Run: `docker compose exec backend node scripts/test-fingerprint.mjs`

Expected: first two hashes identical (16 hex chars), third different. Delete the script after.

**Step 4: Commit**

```bash
git add delivery-saas-backend/src/utils/errorLogger.js
git commit -m "feat(logging): add errorLogger utility with fingerprint-based dedup"
```

---

## Task 3: Wire `logError` into Express error middleware

**Files:**
- Modify: [delivery-saas-backend/src/index.js:449-459](../../delivery-saas-backend/src/index.js#L449)

**Step 1: Add the import** at the top of `index.js` near other utility imports:

```js
import { logError } from './utils/errorLogger.js';
```

**Step 2: Add `logError` call inside the existing global error handler**

Locate lines 449-459 and modify the handler from:

```js
app.use((err, req, res, _next) => {
  const origin = req.headers.origin;
  if (origin) { /* ... */ }
  console.error('Unhandled route error:', err);
  res.status(err.status || 500).json({ message: err.message || 'Internal Server Error' });
});
```

to:

```js
app.use((err, req, res, _next) => {
  const origin = req.headers.origin;
  if (origin) { /* ... unchanged ... */ }
  console.error('Unhandled route error:', err);
  logError({ err, req });
  res.status(err.status || 500).json({ message: err.message || 'Internal Server Error' });
});
```

**Step 3: Manual smoke test — force an error**

Add a temporary debug route just before the error handler:

```js
app.get('/debug/throw-error', (_req, _res) => { throw new Error('plan-task-3 smoke test'); });
```

Restart the backend. Visit `http://localhost:3000/debug/throw-error` twice.

```bash
docker compose exec db psql -U postgres -d projetodelivery -c \
  "SELECT id, message, route, occurrences FROM \"ErrorLog\" WHERE message LIKE 'plan-task-3%';"
```

Expected: one row with `occurrences = 2` and `route = 'GET /debug/throw-error'`.

**Step 4: Remove debug route, delete the test row**

```bash
docker compose exec db psql -U postgres -d projetodelivery -c \
  "DELETE FROM \"ErrorLog\" WHERE message LIKE 'plan-task-3%';"
```

**Step 5: Commit**

```bash
git add delivery-saas-backend/src/index.js
git commit -m "feat(logging): capture unhandled route errors into ErrorLog"
```

---

## Task 4: Capture process-level errors in `server.js`

**Files:**
- Modify: [delivery-saas-backend/src/server.js](../../delivery-saas-backend/src/server.js)

**Step 1: Add import near top of `server.js`**

```js
import { logError } from './utils/errorLogger.js';
```

**Step 2: Register handlers after server starts (or near other top-level setup)**

```js
process.on('uncaughtException', (err) => {
  console.error('uncaughtException:', err);
  logError({ err });
});

process.on('unhandledRejection', (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  console.error('unhandledRejection:', err);
  logError({ err });
});
```

Place these **before** the `try { ... } catch (e) { console.error('Startup error:', ...) }` block at the bottom so they're registered as early as possible.

**Step 3: Smoke test**

In a Node REPL inside the backend container (or via a temporary script):

```js
Promise.reject(new Error('plan-task-4 unhandled')); // do NOT await
```

Wait 1 second, then check:

```bash
docker compose exec db psql -U postgres -d projetodelivery -c \
  "SELECT message FROM \"ErrorLog\" WHERE message LIKE 'plan-task-4%';"
```

Expected: one row. Clean up afterwards with a `DELETE`.

**Step 4: Commit**

```bash
git add delivery-saas-backend/src/server.js
git commit -m "feat(logging): capture uncaughtException and unhandledRejection"
```

---

## Task 5: Add daily auto-purge of resolved logs in `server.js`

**Files:**
- Modify: [delivery-saas-backend/src/server.js](../../delivery-saas-backend/src/server.js)

**Step 1: Add purge function**

Near the bottom, alongside the other startup jobs (`startWatching`, `startIFoodPollingWorker`, etc.):

```js
import { prisma } from './db.js'; // confirm not already imported

async function purgeOldResolvedErrorLogs() {
  try {
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const { count } = await prisma.errorLog.deleteMany({
      where: { resolved: true, resolvedAt: { lt: cutoff } },
    });
    if (count > 0) console.log(`[errorLogs] purged ${count} old resolved logs`);
  } catch (e) {
    console.error('purgeOldResolvedErrorLogs failed:', e?.message);
  }
}

// Run once at startup (after a 1-min grace) and then every 24h.
setTimeout(purgeOldResolvedErrorLogs, 60 * 1000);
setInterval(purgeOldResolvedErrorLogs, 24 * 60 * 60 * 1000);
```

**Step 2: Restart backend and tail logs**

```bash
docker compose restart backend
docker compose logs -f backend | grep errorLogs
```

Expected: no errors. The log message only appears when there are actually resolved-and-old rows to purge — that's fine.

**Step 3: Commit**

```bash
git add delivery-saas-backend/src/server.js
git commit -m "feat(logging): daily purge of resolved error logs older than 90 days"
```

---

## Task 6: Backend endpoints for the error log UI

**Files:**
- Modify: [delivery-saas-backend/src/routes/saas.js](../../delivery-saas-backend/src/routes/saas.js)

**Step 1: Append endpoints at the end of `saas.js`**

```js
// -------- Error Logs (SUPER_ADMIN) --------
saasRouter.get('/error-logs', requireRole('SUPER_ADMIN'), async (req, res) => {
  try {
    const status = req.query.status || 'open'; // 'open' | 'resolved' | 'all'
    const q = (req.query.q || '').trim();
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = 50;

    const where = {};
    if (status === 'open') where.resolved = false;
    else if (status === 'resolved') where.resolved = true;
    if (q) {
      where.OR = [
        { message: { contains: q, mode: 'insensitive' } },
        { route: { contains: q, mode: 'insensitive' } },
      ];
    }

    const [rows, total, openCount] = await Promise.all([
      prisma.errorLog.findMany({
        where,
        orderBy: { lastSeen: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { company: { select: { id: true, name: true } } },
      }),
      prisma.errorLog.count({ where }),
      prisma.errorLog.count({ where: { resolved: false } }),
    ]);

    res.json({ rows, total, page, pageSize, openCount });
  } catch (e) {
    console.error('GET /saas/error-logs error:', e);
    res.status(500).json({ message: 'Erro ao listar logs' });
  }
});

saasRouter.patch('/error-logs/:id/resolve', requireRole('SUPER_ADMIN'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const current = await prisma.errorLog.findUnique({ where: { id } });
    if (!current) return res.status(404).json({ message: 'Log não encontrado' });
    const nextResolved = !current.resolved;
    const updated = await prisma.errorLog.update({
      where: { id },
      data: {
        resolved: nextResolved,
        resolvedAt: nextResolved ? new Date() : null,
        resolvedBy: nextResolved ? req.user?.id || null : null,
      },
    });
    res.json(updated);
  } catch (e) {
    console.error('PATCH /saas/error-logs/:id/resolve error:', e);
    res.status(500).json({ message: 'Erro ao atualizar log' });
  }
});

saasRouter.delete('/error-logs/:id', requireRole('SUPER_ADMIN'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    await prisma.errorLog.delete({ where: { id } });
    res.json({ ok: true });
  } catch (e) {
    if (e?.code === 'P2025') return res.status(404).json({ message: 'Log não encontrado' });
    console.error('DELETE /saas/error-logs/:id error:', e);
    res.status(500).json({ message: 'Erro ao apagar log' });
  }
});

saasRouter.post('/error-logs/purge-resolved', requireRole('SUPER_ADMIN'), async (_req, res) => {
  try {
    const { count } = await prisma.errorLog.deleteMany({ where: { resolved: true } });
    res.json({ count });
  } catch (e) {
    console.error('POST /saas/error-logs/purge-resolved error:', e);
    res.status(500).json({ message: 'Erro ao limpar logs solucionados' });
  }
});
```

**Step 2: Confirm `prisma` is already imported in `saas.js`**

```bash
grep -n "from.*prisma\|import.*prisma" delivery-saas-backend/src/routes/saas.js
```

If not, add `import { prisma } from '../db.js';` at the top.

**Step 3: Manual API smoke test using curl**

After restart, log in as SUPER_ADMIN, grab the JWT, then:

```bash
# List
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/saas/error-logs?status=all
# Resolve toggle
curl -X PATCH -H "Authorization: Bearer $TOKEN" http://localhost:3000/saas/error-logs/1/resolve
# Delete
curl -X DELETE -H "Authorization: Bearer $TOKEN" http://localhost:3000/saas/error-logs/1
```

Also confirm 403 with an ADMIN-only token.

**Step 4: Commit**

```bash
git add delivery-saas-backend/src/routes/saas.js
git commit -m "feat(saas): add error-logs CRUD endpoints (SUPER_ADMIN)"
```

---

## Task 7: Build `SaasErrorLogs.vue`

**Files:**
- Create: `delivery-saas-frontend/src/views/SaasErrorLogs.vue`

> **Skill reminder:** consult @frontend-deliverywl while writing this — use `<ListCard>`, `<BaseButton>`, `<BaseIconButton>`, `nav-tabs` segment pills, SweetAlert2 confirmations, and CSS variables (no hardcoded hex).

**Step 1: Write the component**

```vue
<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import Swal from 'sweetalert2'
import api from '../api'
import ListCard from '../components/ListCard.vue'
import BaseButton from '../components/BaseButton.vue'
import BaseIconButton from '../components/BaseIconButton.vue'

const rows = ref([])
const total = ref(0)
const openCount = ref(0)
const loading = ref(false)
const status = ref('open')      // 'open' | 'resolved' | 'all'
const search = ref('')
const page = ref(1)
const expanded = ref(new Set())
let pollHandle = null

const hasResolved = computed(() => rows.value.some(r => r.resolved))

async function load() {
  loading.value = true
  try {
    const { data } = await api.get('/saas/error-logs', {
      params: { status: status.value, q: search.value, page: page.value },
    })
    rows.value = data.rows || []
    total.value = data.total || 0
    openCount.value = data.openCount || 0
  } catch (e) {
    Swal.fire({ icon: 'error', text: e?.response?.data?.message || 'Erro ao carregar logs' })
  } finally {
    loading.value = false
  }
}

function onSearch(value) { search.value = value; page.value = 1; load() }
function setStatus(s) { status.value = s; page.value = 1; load() }
function toggleExpand(id) {
  if (expanded.value.has(id)) expanded.value.delete(id)
  else expanded.value.add(id)
}

async function toggleResolve(row) {
  const action = row.resolved ? 'Reabrir este log?' : 'Marcar como solucionado?'
  const result = await Swal.fire({
    title: action, icon: 'question',
    showCancelButton: true, confirmButtonText: 'Confirmar', cancelButtonText: 'Cancelar',
  })
  if (!result.isConfirmed) return
  try {
    await api.patch(`/saas/error-logs/${row.id}/resolve`)
    await load()
  } catch (e) {
    Swal.fire({ icon: 'error', text: e?.response?.data?.message || 'Erro ao atualizar' })
  }
}

async function removeRow(row) {
  const result = await Swal.fire({
    title: 'Apagar este log?', text: 'Esta acao e irreversivel.',
    icon: 'warning', showCancelButton: true,
    confirmButtonText: 'Apagar', cancelButtonText: 'Cancelar',
    confirmButtonColor: '#dc3545',
  })
  if (!result.isConfirmed) return
  try {
    await api.delete(`/saas/error-logs/${row.id}`)
    await load()
  } catch (e) {
    Swal.fire({ icon: 'error', text: e?.response?.data?.message || 'Erro ao apagar' })
  }
}

async function purgeResolved() {
  const result = await Swal.fire({
    title: 'Limpar todos os solucionados?',
    text: 'Todos os logs marcados como solucionados serao apagados.',
    icon: 'warning', showCancelButton: true,
    confirmButtonText: 'Limpar', cancelButtonText: 'Cancelar',
    confirmButtonColor: '#dc3545',
  })
  if (!result.isConfirmed) return
  try {
    const { data } = await api.post('/saas/error-logs/purge-resolved')
    Swal.fire({ icon: 'success', text: `${data.count} log(s) removido(s)`, timer: 1500, showConfirmButton: false })
    await load()
  } catch (e) {
    Swal.fire({ icon: 'error', text: e?.response?.data?.message || 'Erro ao limpar' })
  }
}

function formatRelative(iso) {
  const diffMs = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diffMs / 60000)
  if (m < 1) return 'agora'
  if (m < 60) return `há ${m} min`
  const h = Math.floor(m / 60)
  if (h < 24) return `há ${h}h`
  const d = Math.floor(h / 24)
  return `há ${d}d`
}

onMounted(() => {
  load()
  pollHandle = setInterval(load, 30000)
})
onBeforeUnmount(() => { if (pollHandle) clearInterval(pollHandle) })
</script>

<template>
  <div class="container py-3">
    <ListCard
      :title="`Logs de erro (${total})`"
      subtitle="Erros do sistema agrupados por tipo"
      icon="bi-exclamation-triangle"
      quick-search
      quick-search-placeholder="Buscar por mensagem ou rota..."
      @quick-search="onSearch"
    >
      <template #actions>
        <BaseButton variant="outline" size="sm" @click="load">
          <i class="bi-arrow-clockwise me-1"></i> Atualizar
        </BaseButton>
        <BaseButton variant="danger" size="sm" :disabled="!hasResolved" @click="purgeResolved">
          <i class="bi-trash me-1"></i> Limpar solucionados
        </BaseButton>
      </template>

      <template #filters>
        <ul class="nav nav-tabs mb-0">
          <li class="nav-item">
            <a class="nav-link" :class="{ active: status === 'open' }" href="#"
               @click.prevent="setStatus('open')">
              Abertos ({{ openCount }})
            </a>
          </li>
          <li class="nav-item">
            <a class="nav-link" :class="{ active: status === 'resolved' }" href="#"
               @click.prevent="setStatus('resolved')">
              Solucionados
            </a>
          </li>
          <li class="nav-item">
            <a class="nav-link" :class="{ active: status === 'all' }" href="#"
               @click.prevent="setStatus('all')">
              Todos
            </a>
          </li>
        </ul>
      </template>

      <div v-if="loading && rows.length === 0" class="text-center text-muted py-5">
        Carregando...
      </div>

      <div v-else-if="rows.length === 0 && status === 'open'" class="text-center py-5">
        <i class="bi-shield-check display-4 text-success"></i>
        <p class="text-muted mt-3 mb-0">Nenhum erro registrado — sistema operando normalmente.</p>
      </div>

      <div v-else-if="rows.length === 0" class="text-center text-muted py-5">
        Nenhum log encontrado.
      </div>

      <div v-else class="table-responsive">
        <table class="table table-hover align-middle">
          <thead>
            <tr>
              <th style="width:40px"></th>
              <th>Última ocorrência</th>
              <th>Mensagem</th>
              <th>Rota</th>
              <th>Empresa</th>
              <th>Status</th>
              <th class="text-end">Ações</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="row in rows" :key="row.id">
              <tr>
                <td>
                  <BaseIconButton color="ghost" :title="expanded.has(row.id) ? 'Recolher' : 'Expandir'"
                                  @click="toggleExpand(row.id)">
                    <i :class="expanded.has(row.id) ? 'bi-chevron-down' : 'bi-chevron-right'"></i>
                  </BaseIconButton>
                </td>
                <td><small>{{ formatRelative(row.lastSeen) }}</small></td>
                <td>
                  <div class="fw-medium">{{ row.message.slice(0, 80) }}{{ row.message.length > 80 ? '…' : '' }}</div>
                  <span v-if="row.occurrences > 1" class="badge bg-light text-dark mt-1">
                    ×{{ row.occurrences }} ocorrências
                  </span>
                </td>
                <td><code class="small">{{ row.route || '—' }}</code></td>
                <td>{{ row.company?.name || '—' }}</td>
                <td>
                  <span class="badge" :class="row.resolved ? 'bg-success' : 'bg-danger'">
                    {{ row.resolved ? 'Solucionado' : 'Aberto' }}
                  </span>
                </td>
                <td class="text-end">
                  <BaseIconButton color="success"
                                  :title="row.resolved ? 'Reabrir' : 'Marcar como solucionado'"
                                  @click="toggleResolve(row)">
                    <i :class="row.resolved ? 'bi-arrow-counterclockwise' : 'bi-check-circle'"></i>
                  </BaseIconButton>
                  <BaseIconButton color="danger" title="Apagar" @click="removeRow(row)">
                    <i class="bi-trash"></i>
                  </BaseIconButton>
                </td>
              </tr>
              <tr v-if="expanded.has(row.id)">
                <td colspan="7">
                  <div class="px-3 py-2">
                    <div class="row mb-2">
                      <div class="col-md-4">
                        <small class="text-muted d-block">Primeira ocorrência</small>
                        <span>{{ new Date(row.firstSeen).toLocaleString() }}</span>
                      </div>
                      <div class="col-md-4">
                        <small class="text-muted d-block">Status code</small>
                        <span>{{ row.statusCode || '—' }}</span>
                      </div>
                      <div class="col-md-4">
                        <small class="text-muted d-block">Usuário</small>
                        <span>{{ row.userId || '—' }}</span>
                      </div>
                    </div>
                    <small class="text-muted d-block mb-1">Stack trace</small>
                    <pre class="small p-3 rounded mb-0" style="background:var(--bg-zebra); white-space:pre-wrap;">{{ row.stack || 'Sem stack trace' }}</pre>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </ListCard>
  </div>
</template>
```

**Step 2: Quick visual smoke test**

Start frontend dev server, log in as SUPER_ADMIN, navigate to `/saas/error-logs` (route added in Task 8). Verify:
- Empty state with shield icon when no errors.
- Tabs switch correctly.
- Forcing an error (temporary debug route) makes it appear within 30s of polling.

**Step 3: Commit**

```bash
git add delivery-saas-frontend/src/views/SaasErrorLogs.vue
git commit -m "feat(saas): add SaasErrorLogs view"
```

---

## Task 8: Wire route + breadcrumb in router

**Files:**
- Modify: [delivery-saas-frontend/src/router.js](../../delivery-saas-frontend/src/router.js)

**Step 1: Add the import** alongside the other Saas views:

```js
import SaasErrorLogs from './views/SaasErrorLogs.vue'
```

**Step 2: Add the route** near the other `/saas/*` routes (around line 280):

```js
,{ path: '/saas/error-logs', component: SaasErrorLogs, meta: { requiresAuth: true, role: 'SUPER_ADMIN' } }
```

**Step 3: Add the breadcrumb** in the breadcrumb table around line 510:

```js
['/saas/error-logs', 'Logs de erro'],
```

**Step 4: Manual test**

Reload frontend. Navigate directly to `/saas/error-logs` — page renders with header.
Log out, log in as ADMIN, try to visit — should redirect away (existing role guard at line 422).

**Step 5: Commit**

```bash
git add delivery-saas-frontend/src/router.js
git commit -m "feat(saas): add /saas/error-logs route"
```

---

## Task 9: Add stat tile to SaaS dashboard

**Files:**
- Modify: [delivery-saas-frontend/src/views/SaasAdmin.vue](../../delivery-saas-frontend/src/views/SaasAdmin.vue)

**Step 1: Add ref + fetch in `load()`**

In the `<script setup>` block, add:

```js
const errorLogsOpen = ref(0)
```

In the `Promise.all` inside `load()`, add a new entry:

```js
api.get('/saas/error-logs', { params: { status: 'open', page: 1 } }).catch(() => ({ data: { openCount: 0 } }))
```

After destructuring the result, set:

```js
errorLogsOpen.value = eRes.data?.openCount || 0
```

(Adjust the destructure variable name to match — e.g., `[cRes, pRes, mRes, iRes, eRes]`.)

**Step 2: Add the stat tile**

In the `stats` computed array, append:

```js
{ label: 'Logs de erro', value: errorLogsOpen.value,
  icon: 'bi-exclamation-triangle',
  color: errorLogsOpen.value > 0 ? 'danger' : 'success',
  to: '/saas/error-logs', sub: 'em aberto' },
```

**Step 3: Verify visually**

Reload `/saas`. New tile appears with red styling when there are open errors, green when zero. Clicking navigates to `/saas/error-logs`.

**Step 4: Commit**

```bash
git add delivery-saas-frontend/src/views/SaasAdmin.vue
git commit -m "feat(saas): show open error count tile in dashboard"
```

---

## Task 10: Final end-to-end verification

**Step 1: Restart full stack**

```bash
docker compose restart backend frontend
```

**Step 2: Run the manual test matrix**

Log in as SUPER_ADMIN. For each, confirm expected behavior:

| Scenario | Expected |
|---|---|
| Add temporary `app.get('/debug/throw1', () => { throw new Error('e2e test') })`. Hit it 3 times. | One row with `×3 ocorrências`, `route='GET /debug/throw1'`, status "Aberto". |
| Click "Marcar como solucionado". | Confirmation dialog → row disappears from "Abertos" tab, appears in "Solucionados". |
| Hit `/debug/throw1` again. | Row re-opens (back in "Abertos" tab), `occurrences=4`. |
| Click expand chevron. | Stack trace, firstSeen, statusCode visible. |
| Click "Apagar" → confirm. | Row removed. |
| Mark another error as solucionado, then click "Limpar solucionados". | Confirmation → row count of resolved goes to 0. |
| Login as ADMIN, navigate to `/saas/error-logs`. | Redirected away (no permission). |
| `curl` GET `/saas/error-logs` with ADMIN token. | 403. |
| Empty "Abertos" tab. | Shield icon + "Nenhum erro registrado" message. |

**Step 3: Remove the debug route, clean test rows**

```bash
docker compose exec db psql -U postgres -d projetodelivery -c \
  "DELETE FROM \"ErrorLog\" WHERE message LIKE 'e2e test%';"
```

**Step 4: Final commit (if any cleanup needed)**

If everything passed cleanly with no follow-up changes, this task ends without a commit.

---

## Out of scope (do not implement)

- Frontend (browser) error capture
- Logging info/warn/debug events
- Email/Slack notifications
- CSV/JSON export
- Advanced filters (date range, severity, company picker)
- Trend charts
