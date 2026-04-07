# Inbox Automation & Performance Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add 6 inbox improvements: out-of-hours auto-reply, greeting after 6h inactivity, keyword→tag matching, sessionStorage cache, socket reconnect refetch, improved scroll-up pagination.

**Architecture:** Backend pipeline `runAutomations` runs after each inbound message in `webhookEvolution.js`. New `Store.outOfHoursReplyId` and `Store.greetingReplyId` FK fields reuse existing `QuickReply` model. Frontend caches store snapshot in `sessionStorage` (TTL 30min), refetches on socket reconnect, improves scroll-up UX.

**Tech Stack:** Express, Prisma, Socket.IO, Vue 3 Composition API, Pinia, sessionStorage, native browser APIs.

---

### Task 1: Prisma Schema — auto-reply FK fields

**Files:**
- Modify: `delivery-saas-backend/prisma/schema.prisma`

**Step 1: Add fields to Store model**

In `model Store`, add (alongside existing fields like `whatsappInstanceId`):

```prisma
  outOfHoursReplyId String?
  outOfHoursReply   QuickReply? @relation("StoreOutOfHoursReply", fields: [outOfHoursReplyId], references: [id])
  greetingReplyId   String?
  greetingReply     QuickReply? @relation("StoreGreetingReply", fields: [greetingReplyId], references: [id])
```

**Step 2: Add inverse relations to QuickReply model**

In `model QuickReply`, add:

```prisma
  storesOutOfHours Store[] @relation("StoreOutOfHoursReply")
  storesGreeting   Store[] @relation("StoreGreetingReply")
```

**Step 3: Run db push and generate**

```bash
cd delivery-saas-backend && npx prisma db push && npx prisma generate
```

Expected: success messages, no migration drift errors.

**Step 4: Commit**

```bash
git add delivery-saas-backend/prisma/schema.prisma
git commit -m "feat(inbox): add Store.outOfHoursReplyId and Store.greetingReplyId"
```

---

### Task 2: Backend — `runAutomations` pipeline in webhook

**Files:**
- Modify: `delivery-saas-backend/src/routes/webhookEvolution.js`

**Step 1: Add helpers near the top of the file (after imports, before router definition)**

```javascript
import { evoSendText } from '../wa.js';

function isStoreOpen(store) {
  if (!store) return true;
  if (store.alwaysOpen || store.open24Hours) return true;
  const schedule = store.weeklySchedule;
  if (!schedule || !Array.isArray(schedule)) return true;

  const tz = store.timezone || 'America/Sao_Paulo';
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: tz }));
  const dayOfWeek = now.getDay();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const hhmm = `${hh}:${mm}`;

  const today = schedule.find(s => Number(s.day) === dayOfWeek);
  if (!today || !today.enabled) return false;
  if (!today.from || !today.to) return true;
  return hhmm >= today.from && hhmm <= today.to;
}

async function sendAutoReply(conversation, instanceName, body) {
  if (!body || !body.trim()) return;
  try {
    await evoSendText({ instanceName, to: conversation.channelContactId, text: body });
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: 'OUTBOUND',
        type: 'TEXT',
        body: body.trim(),
        status: 'SENT',
      },
    });
  } catch (e) {
    console.warn('[auto-reply] send failed:', e.message);
  }
}

async function runAutomations(conversation, incomingMessage, storeId, instanceName) {
  if (!storeId) return;
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: {
      id: true,
      weeklySchedule: true,
      alwaysOpen: true,
      open24Hours: true,
      timezone: true,
      outOfHoursReply: { select: { body: true } },
      greetingReply: { select: { body: true } },
      company: { select: { evolutionEnabled: true } },
    },
  });
  if (!store || !store.company?.evolutionEnabled) return;

  // 1. Out-of-hours auto-reply
  if (store.outOfHoursReply && !isStoreOpen(store)) {
    await sendAutoReply(conversation, instanceName, store.outOfHoursReply.body);
    return; // skip greeting
  }

  // 2. Greeting after 6h of inactivity
  if (store.greetingReply) {
    const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);
    const recentInbound = await prisma.message.findFirst({
      where: {
        conversationId: conversation.id,
        direction: 'INBOUND',
        createdAt: { gte: sixHoursAgo, lt: incomingMessage.createdAt },
        id: { not: incomingMessage.id },
      },
      select: { id: true },
    });
    if (!recentInbound) {
      await sendAutoReply(conversation, instanceName, store.greetingReply.body);
    }
  }

  // 3. Keyword→tag matching (uses existing tags as keywords)
  try {
    const allTags = await prisma.$queryRaw`
      SELECT DISTINCT unnest(tags) as tag
      FROM "Conversation"
      WHERE "companyId" = ${conversation.companyId} AND array_length(tags, 1) > 0
    `;
    const bodyLower = String(incomingMessage.body || '').toLowerCase();
    if (bodyLower) {
      const matched = allTags
        .map(r => r.tag)
        .filter(t => t && bodyLower.includes(String(t).toLowerCase()));
      if (matched.length) {
        const currentTags = conversation.tags || [];
        const newTags = [...new Set([...currentTags, ...matched])];
        if (newTags.length !== currentTags.length) {
          await prisma.conversation.update({
            where: { id: conversation.id },
            data: { tags: newTags },
          });
        }
      }
    }
  } catch (e) {
    console.warn('[automation] keyword match failed:', e.message);
  }
}
```

**Step 2: Call runAutomations from handleMessagesUpsert**

Find where the message is created (after `prisma.message.create({ data: { ... } })` and after `io.emit`). Add right before the final `}` of the inbound branch:

```javascript
// Run automations pipeline (best-effort, non-blocking on errors)
if (direction === 'INBOUND' && type === 'TEXT' && conversation.storeId) {
  runAutomations(updatedConversation, message, conversation.storeId, instanceName).catch(e =>
    console.warn('[automations] failed:', e.message)
  );
}
```

**IMPORTANT:** Read the existing `handleMessagesUpsert` function carefully to find the exact insertion point — it should run AFTER the conversation is updated (so `updatedConversation` is in scope) and AFTER socket emit (so it doesn't block the user-facing notification).

**Step 3: Commit**

```bash
git add delivery-saas-backend/src/routes/webhookEvolution.js
git commit -m "feat(inbox): add automation pipeline (out-of-hours, greeting, keywords)"
```

---

### Task 3: Backend — endpoint to configure store automation

**Files:**
- Modify: `delivery-saas-backend/src/routes/stores.js`

**Step 1: Add PATCH /stores/:id/inbox-automation endpoint**

Find the existing stores router (look for `storesRouter.patch` or similar). Add this endpoint:

```javascript
storesRouter.patch('/:id/inbox-automation', requireRole('ADMIN'), async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { id } = req.params;
    const store = await prisma.store.findFirst({
      where: { id, companyId },
      select: { id: true },
    });
    if (!store) return res.status(404).json({ message: 'Loja não encontrada' });

    const { outOfHoursReplyId, greetingReplyId } = req.body || {};
    const data = {};
    if (outOfHoursReplyId !== undefined) {
      // Validate FK if not null
      if (outOfHoursReplyId) {
        const exists = await prisma.quickReply.findFirst({
          where: { id: outOfHoursReplyId, companyId },
          select: { id: true },
        });
        if (!exists) return res.status(400).json({ message: 'outOfHoursReplyId inválido' });
      }
      data.outOfHoursReplyId = outOfHoursReplyId || null;
    }
    if (greetingReplyId !== undefined) {
      if (greetingReplyId) {
        const exists = await prisma.quickReply.findFirst({
          where: { id: greetingReplyId, companyId },
          select: { id: true },
        });
        if (!exists) return res.status(400).json({ message: 'greetingReplyId inválido' });
      }
      data.greetingReplyId = greetingReplyId || null;
    }

    const updated = await prisma.store.update({
      where: { id: store.id },
      data,
      select: {
        id: true,
        outOfHoursReplyId: true,
        greetingReplyId: true,
      },
    });
    res.json(updated);
  } catch (e) {
    console.error('[stores] inbox-automation error:', e);
    res.status(500).json({ message: 'Erro ao salvar automação', error: e.message });
  }
});
```

**Step 2: Add to GET /stores/:id (or list) — include the new fields**

Find any select on Store and add `outOfHoursReplyId` and `greetingReplyId` if needed for the frontend to load current state. If `select` is not used (full record returned), no change needed.

**Step 3: Commit**

```bash
git add delivery-saas-backend/src/routes/stores.js
git commit -m "feat(inbox): add PATCH /stores/:id/inbox-automation endpoint"
```

---

### Task 4: Frontend — sessionStorage cache in store

**Files:**
- Modify: `delivery-saas-frontend/src/stores/inbox.js`

**Step 1: Add cache actions**

Add these actions alongside the existing ones:

```javascript
saveToSessionStorage() {
  try {
    const snapshot = {
      conversations: this.conversations,
      activeConversationId: this.activeConversationId,
      activeMessages: this.activeConversationId ? (this.messages[this.activeConversationId] || null) : null,
      savedAt: Date.now(),
    };
    sessionStorage.setItem('inbox-cache', JSON.stringify(snapshot));
  } catch (e) { /* quota or serialization issues — ignore */ }
},

restoreFromSessionStorage() {
  try {
    const raw = sessionStorage.getItem('inbox-cache');
    if (!raw) return false;
    const snap = JSON.parse(raw);
    if (!snap || !snap.savedAt) return false;
    // Expire after 30 minutes
    if (Date.now() - snap.savedAt > 30 * 60 * 1000) {
      sessionStorage.removeItem('inbox-cache');
      return false;
    }
    this.conversations = Array.isArray(snap.conversations) ? snap.conversations : [];
    this.activeConversationId = snap.activeConversationId || null;
    if (snap.activeConversationId && Array.isArray(snap.activeMessages)) {
      this.messages = { [snap.activeConversationId]: snap.activeMessages };
    }
    this.recalcUnread();
    return true;
  } catch (e) {
    return false;
  }
},
```

**Step 2: Commit**

```bash
git add delivery-saas-frontend/src/stores/inbox.js
git commit -m "feat(inbox): add sessionStorage cache actions"
```

---

### Task 5: Frontend — Inbox.vue cache restore + reconnect handler

**Files:**
- Modify: `delivery-saas-frontend/src/views/inbox/Inbox.vue`

**Step 1: Update onMounted to restore from cache first**

Find the `onMounted` block. Replace the initial fetch sequence:

```javascript
onMounted(async () => {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }

  // Restore from sessionStorage if available
  const restored = inboxStore.restoreFromSessionStorage();
  if (!restored) {
    inboxStore.fetchConversations();
  } else {
    // Refresh in background to get any updates while restoring instantly
    inboxStore.fetchConversations().catch(() => {});
  }
  inboxStore.fetchQuickReplies();

  // Persist snapshot on changes (debounced)
  let saveTimer = null;
  watch(
    () => [inboxStore.conversations, inboxStore.activeConversationId, inboxStore.messages],
    () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => inboxStore.saveToSessionStorage(), 500);
    },
    { deep: true }
  );

  // Socket.IO setup ...
  socket = io(SOCKET_URL, { ... });
  // ... rest of socket logic stays the same
});
```

**Step 2: Add reconnect handler near other socket.on listeners**

```javascript
socket.on('reconnect', async () => {
  console.log('[inbox] socket reconnected — refetching');
  try {
    await inboxStore.fetchConversations();
    if (inboxStore.activeConversationId) {
      // Force fresh load of active conversation messages
      delete inboxStore.messages[inboxStore.activeConversationId];
      await inboxStore.fetchMessages(inboxStore.activeConversationId);
    }
  } catch (e) {
    console.warn('[inbox] refetch on reconnect failed', e);
  }
});
```

**Step 3: Add `watch` import**

In the `<script setup>` imports, add `watch` if not already there:

```javascript
import { ref, onMounted, onUnmounted, watch } from 'vue';
```

**Step 4: Commit**

```bash
git add delivery-saas-frontend/src/views/inbox/Inbox.vue
git commit -m "feat(inbox): restore from sessionStorage and refetch on socket reconnect"
```

---

### Task 6: Frontend — improved scroll-up in ChatPanel

**Files:**
- Modify: `delivery-saas-frontend/src/views/inbox/ChatPanel.vue`

**Step 1: Add noMoreMessages state and update logic**

Find the existing `loadingOlder` ref and add:

```javascript
const noMoreMessages = ref(false);
```

Update `onScroll`:

```javascript
function onScroll() {
  if (
    messagesContainer.value &&
    messagesContainer.value.scrollTop < 200 &&
    !loadingOlder.value &&
    !noMoreMessages.value
  ) {
    loadOlder();
  }
}
```

Update `loadOlder` to set `noMoreMessages`:

```javascript
async function loadOlder() {
  const msgs = messages.value;
  if (!msgs.length) return;
  const oldest = msgs[0];
  loadingOlder.value = true;
  try {
    const prevHeight = messagesContainer.value?.scrollHeight || 0;
    const older = await inboxStore.fetchMessages(props.conversationId, oldest.createdAt);
    if (!older || older.length === 0) {
      noMoreMessages.value = true;
    }
    await nextTick();
    if (messagesContainer.value) {
      messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight - prevHeight;
    }
  } finally {
    loadingOlder.value = false;
  }
}
```

**Step 2: Reset noMoreMessages when conversation changes**

Add a watch:

```javascript
watch(() => props.conversationId, () => {
  noMoreMessages.value = false;
});
```

**Step 3: Update template — replace existing loadingOlder block**

Find:
```vue
<div v-if="loadingOlder" class="text-center py-2">
  <div class="spinner-border spinner-border-sm text-secondary"></div>
</div>
```

Replace with:
```vue
<div v-if="loadingOlder" class="text-center py-2 small text-muted">
  <div class="spinner-border spinner-border-sm me-1"></div>
  Carregando mensagens antigas...
</div>
<div v-else-if="noMoreMessages && messages.length > 0" class="text-center py-2 small text-muted">
  <i class="bi bi-check-circle me-1"></i>Início da conversa
</div>
```

**Step 4: Commit**

```bash
git add delivery-saas-frontend/src/views/inbox/ChatPanel.vue
git commit -m "feat(inbox): improve scroll-up with 200px threshold and end-of-history indicator"
```

---

### Task 7: Frontend — InboxAutomation settings view

**Files:**
- Create: `delivery-saas-frontend/src/views/inbox/settings/InboxAutomation.vue`
- Modify: `delivery-saas-frontend/src/router.js`
- Modify: `delivery-saas-frontend/src/config/nav.js`

**Step 1: Create InboxAutomation.vue**

```vue
<template>
  <div class="container py-4" style="max-width: 800px;">
    <h5 class="mb-3">Automações do Inbox</h5>

    <div class="mb-3">
      <label class="form-label small">Loja</label>
      <select v-model="selectedStoreId" @change="loadStore" class="form-select form-select-sm">
        <option :value="null">Selecione uma loja</option>
        <option v-for="s in stores" :key="s.id" :value="s.id">{{ s.name }}</option>
      </select>
    </div>

    <div v-if="selectedStoreId && currentStore">
      <!-- Out-of-hours -->
      <div class="card mb-3">
        <div class="card-body">
          <h6 class="card-title"><i class="bi bi-moon me-1"></i>Auto-resposta fora do horário</h6>
          <p class="small text-muted mb-2">Disparada quando o cliente envia mensagem fora do horário de funcionamento da loja.</p>
          <div class="mb-2">
            <label class="form-label small">Resposta rápida</label>
            <select v-model="form.outOfHoursReplyId" class="form-select form-select-sm">
              <option :value="null">— Desabilitado —</option>
              <option v-for="r in quickReplies" :key="r.id" :value="r.id">{{ r.title || r.shortcut }}</option>
            </select>
          </div>
          <div v-if="outOfHoursPreview" class="small bg-light rounded p-2 mb-2">
            <strong class="d-block mb-1">Preview:</strong>
            <span style="white-space: pre-wrap;">{{ outOfHoursPreview }}</span>
          </div>
          <button class="btn btn-sm btn-primary" @click="saveOutOfHours" :disabled="saving">
            {{ saving ? 'Salvando...' : 'Salvar' }}
          </button>
        </div>
      </div>

      <!-- Greeting -->
      <div class="card mb-3">
        <div class="card-body">
          <h6 class="card-title"><i class="bi bi-emoji-smile me-1"></i>Saudação automática</h6>
          <p class="small text-muted mb-2">Disparada na primeira mensagem do cliente após 6 horas de inatividade.</p>
          <div class="mb-2">
            <label class="form-label small">Resposta rápida</label>
            <select v-model="form.greetingReplyId" class="form-select form-select-sm">
              <option :value="null">— Desabilitado —</option>
              <option v-for="r in quickReplies" :key="r.id" :value="r.id">{{ r.title || r.shortcut }}</option>
            </select>
          </div>
          <div v-if="greetingPreview" class="small bg-light rounded p-2 mb-2">
            <strong class="d-block mb-1">Preview:</strong>
            <span style="white-space: pre-wrap;">{{ greetingPreview }}</span>
          </div>
          <button class="btn btn-sm btn-primary" @click="saveGreeting" :disabled="saving">
            {{ saving ? 'Salvando...' : 'Salvar' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import api from '@/api';
import { useInboxStore } from '@/stores/inbox';
import Swal from 'sweetalert2';

const inboxStore = useInboxStore();

const stores = ref([]);
const selectedStoreId = ref(null);
const currentStore = ref(null);
const quickReplies = computed(() => inboxStore.quickReplies || []);
const saving = ref(false);

const form = ref({
  outOfHoursReplyId: null,
  greetingReplyId: null,
});

const outOfHoursPreview = computed(() => {
  const r = quickReplies.value.find(q => q.id === form.value.outOfHoursReplyId);
  return r?.body || '';
});

const greetingPreview = computed(() => {
  const r = quickReplies.value.find(q => q.id === form.value.greetingReplyId);
  return r?.body || '';
});

async function loadStore() {
  if (!selectedStoreId.value) {
    currentStore.value = null;
    return;
  }
  try {
    const { data } = await api.get(`/stores/${selectedStoreId.value}`);
    currentStore.value = data;
    form.value.outOfHoursReplyId = data.outOfHoursReplyId || null;
    form.value.greetingReplyId = data.greetingReplyId || null;
  } catch (e) {
    Swal.fire('Erro', 'Falha ao carregar loja', 'error');
  }
}

async function saveOutOfHours() {
  saving.value = true;
  try {
    await api.patch(`/stores/${selectedStoreId.value}/inbox-automation`, {
      outOfHoursReplyId: form.value.outOfHoursReplyId,
    });
    Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: 'Salvo!', showConfirmButton: false, timer: 1500 });
  } catch (e) {
    Swal.fire('Erro', e.response?.data?.message || 'Falha ao salvar', 'error');
  } finally {
    saving.value = false;
  }
}

async function saveGreeting() {
  saving.value = true;
  try {
    await api.patch(`/stores/${selectedStoreId.value}/inbox-automation`, {
      greetingReplyId: form.value.greetingReplyId,
    });
    Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: 'Salvo!', showConfirmButton: false, timer: 1500 });
  } catch (e) {
    Swal.fire('Erro', e.response?.data?.message || 'Falha ao salvar', 'error');
  } finally {
    saving.value = false;
  }
}

onMounted(async () => {
  try {
    const { data } = await api.get('/stores');
    stores.value = Array.isArray(data) ? data : (data.stores || []);
  } catch (e) { stores.value = []; }
  if (!inboxStore.quickReplies?.length) {
    await inboxStore.fetchQuickReplies();
  }
});
</script>
```

**Step 2: Add route in router.js**

Add the lazy import near other inbox imports:
```javascript
const InboxAutomation = () => import('./views/inbox/settings/InboxAutomation.vue');
```

Add the route:
```javascript
{ path: '/inbox/automation', component: InboxAutomation, meta: { requiresAuth: true, requiresModule: 'WHATSAPP' } },
```

**Step 3: Add nav entry in config/nav.js**

In the "Configurações" children, add (next to "Respostas Rápidas"):
```javascript
{ name: 'Automações Inbox', to: '/inbox/automation', icon: 'bi bi-robot', moduleKey: 'whatsapp', lockable: true },
```

**Step 4: Commit**

```bash
git add delivery-saas-frontend/src/views/inbox/settings/InboxAutomation.vue delivery-saas-frontend/src/router.js delivery-saas-frontend/src/config/nav.js
git commit -m "feat(inbox): add InboxAutomation settings view with route and nav"
```

---

### Task 8: Build verification + push

**Step 1: Build frontend**

```bash
cd delivery-saas-frontend && npx vite build 2>&1 | tail -10
```

Expected: `built in Xs` with no errors.

**Step 2: Verify backend module loads**

```bash
cd delivery-saas-backend && node -e "import('./src/routes/webhookEvolution.js').then(() => console.log('OK')).catch(e => { console.error(e.message); process.exit(1) })"
```

Expected: `OK`.

**Step 3: Push**

```bash
git push origin main
```
