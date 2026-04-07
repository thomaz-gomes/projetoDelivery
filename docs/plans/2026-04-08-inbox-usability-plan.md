# Inbox Usability Improvements — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add 13 usability improvements to the inbox: filters (mine/unread/store), media preview in list, hash-color avatars, day grouping, internal notes, tags, drag-drop/paste/lightbox, reply quote, copy text, image compression.

**Architecture:** Backend adds 4 new endpoints + filter params + Message.internal/authorUserId + Conversation.tags. Frontend adds 2 new components (ImageLightbox, TagChips), 1 utility (compressImage), and modifies existing inbox components.

**Tech Stack:** Express.js, Prisma/PostgreSQL, Vue 3 Composition API, Pinia, Bootstrap 5, native browser APIs (canvas, clipboard, drag-drop).

---

### Task 1: Prisma Schema — Internal Notes & Tags Fields

**Files:**
- Modify: `delivery-saas-backend/prisma/schema.prisma`

**Step 1: Add fields to Conversation, Message, User**

In `model Conversation`, add:
```prisma
  tags             String[]            @default([])
```

In `model Message`, add:
```prisma
  internal      Boolean   @default(false)
  authorUserId  String?
  authorUser    User?     @relation("MessageAuthor", fields: [authorUserId], references: [id])
```

In `model User`, add:
```prisma
  authoredMessages      Message[]      @relation("MessageAuthor")
```

**Step 2: Run prisma db push**

```bash
cd delivery-saas-backend && npx prisma db push
```

Expected: Schema synced.

**Step 3: Regenerate Prisma client**

```bash
cd delivery-saas-backend && npx prisma generate
```

**Step 4: Commit**

```bash
git add delivery-saas-backend/prisma/schema.prisma
git commit -m "feat(inbox): add Message.internal/authorUserId and Conversation.tags"
```

---

### Task 2: Backend — Filter params on GET /inbox/conversations

**Files:**
- Modify: `delivery-saas-backend/src/routes/inbox.js`

**Step 1: Update GET /inbox/conversations**

Find the existing handler and update the where clause to support `mine`, `unread`, and message body search:

```javascript
router.get('/conversations', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { storeId, status, search, cursor, mine, unread, limit: rawLimit } = req.query;
    const limit = Math.min(parseInt(rawLimit) || 50, 100);

    const where = { companyId };
    if (storeId) where.storeId = storeId;
    if (status) where.status = status.toUpperCase();
    if (mine === 'true' || mine === '1') where.assignedUserId = req.user.id;
    if (unread === 'true' || unread === '1') where.unreadCount = { gt: 0 };

    if (search) {
      where.OR = [
        { contactName: { contains: search, mode: 'insensitive' } },
        { channelContactId: { contains: search } },
        { customer: { fullName: { contains: search, mode: 'insensitive' } } },
        { messages: { some: { body: { contains: search, mode: 'insensitive' } } } },
      ];
    }
    if (cursor) where.lastMessageAt = { lt: new Date(cursor) };

    const conversations = await prisma.conversation.findMany({
      where,
      orderBy: { lastMessageAt: 'desc' },
      take: limit,
      include: {
        customer: { select: { id: true, fullName: true, whatsapp: true } },
        assignedUser: { select: { id: true, name: true } },
        store: { select: { id: true, name: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });

    res.json(conversations);
  } catch (e) {
    console.error('[inbox] Error listing conversations:', e);
    res.status(500).json({ message: 'Erro ao listar conversas', error: e.message });
  }
});
```

**Step 2: Commit**

```bash
git add delivery-saas-backend/src/routes/inbox.js
git commit -m "feat(inbox): add mine/unread/message-search filters to conversations endpoint"
```

---

### Task 3: Backend — Internal note endpoint

**Files:**
- Modify: `delivery-saas-backend/src/routes/inbox.js`

**Step 1: Add POST /conversations/:id/internal-note**

Add this endpoint after the existing send endpoint:

```javascript
router.post('/conversations/:id/internal-note', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { body } = req.body;
    if (!body || !body.trim()) return res.status(400).json({ message: 'body é obrigatório' });

    const conversation = await prisma.conversation.findFirst({
      where: { id: req.params.id, companyId },
    });
    if (!conversation) return res.status(404).json({ message: 'Conversa não encontrada' });

    const message = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: 'OUTBOUND',
        type: 'TEXT',
        body: body.trim(),
        internal: true,
        authorUserId: req.user.id,
        status: 'SENT',
      },
      include: {
        authorUser: { select: { id: true, name: true } },
      },
    });

    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: new Date() },
    });

    const io = req.app.get('io');
    if (io) {
      io.to(`company_${companyId}`).emit('inbox:new-message', {
        conversationId: conversation.id,
        message,
      });
    }

    res.status(201).json(message);
  } catch (e) {
    console.error('[inbox] Error creating internal note:', e);
    res.status(500).json({ message: 'Erro ao criar nota interna', error: e.message });
  }
});
```

**Step 2: Commit**

```bash
git add delivery-saas-backend/src/routes/inbox.js
git commit -m "feat(inbox): add internal note endpoint"
```

---

### Task 4: Backend — Tags endpoints

**Files:**
- Modify: `delivery-saas-backend/src/routes/inbox.js`

**Step 1: Add PATCH /conversations/:id/tags and GET /tags**

```javascript
// Update conversation tags
router.patch('/conversations/:id/tags', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { tags } = req.body;
    if (!Array.isArray(tags)) return res.status(400).json({ message: 'tags deve ser array' });

    const conv = await prisma.conversation.findFirst({
      where: { id: req.params.id, companyId },
      select: { id: true },
    });
    if (!conv) return res.status(404).json({ message: 'Conversa não encontrada' });

    const cleanTags = tags
      .map(t => String(t).trim().toLowerCase())
      .filter(t => t.length > 0 && t.length < 30);
    const uniqueTags = [...new Set(cleanTags)];

    const updated = await prisma.conversation.update({
      where: { id: conv.id },
      data: { tags: uniqueTags },
    });

    const io = req.app.get('io');
    if (io) {
      io.to(`company_${companyId}`).emit('inbox:conversation-updated', { conversation: updated });
    }

    res.json(updated);
  } catch (e) {
    res.status(500).json({ message: 'Erro ao atualizar tags', error: e.message });
  }
});

// Get all unique tags for autocomplete (top 20 by usage)
router.get('/tags', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const result = await prisma.$queryRaw`
      SELECT unnest(tags) as tag, COUNT(*)::int as count
      FROM "Conversation"
      WHERE "companyId" = ${companyId} AND array_length(tags, 1) > 0
      GROUP BY tag
      ORDER BY count DESC
      LIMIT 20
    `;
    res.json(result);
  } catch (e) {
    res.status(500).json({ message: 'Erro ao buscar tags', error: e.message });
  }
});
```

**Step 2: Commit**

```bash
git add delivery-saas-backend/src/routes/inbox.js
git commit -m "feat(inbox): add tags update and autocomplete endpoints"
```

---

### Task 5: Backend — Quote/reply support in send endpoint

**Files:**
- Modify: `delivery-saas-backend/src/routes/inbox.js`
- Modify: `delivery-saas-backend/src/wa.js`

**Step 1: Update evoSendText to accept quoted parameter**

In `wa.js`, find `evoSendText` and add `quoted` to the destructured params:

```javascript
export async function evoSendText({ instanceName, to, text, quoted }) {
  const number = normalizePhone(to);
  if (!number) throw new Error('Telefone inválido');

  const body = { number, text };
  if (quoted) body.quoted = quoted;

  const attempts = [
    { url: '/message/sendText', body: { ...body, instanceName } },
    { url: `/message/sendText/${encodeURIComponent(instanceName)}`, body },
  ];

  let last;
  for (const a of attempts) {
    try {
      const { data } = await http.post(a.url, a.body);
      return data;
    } catch (e) {
      last = e;
      continue;
    }
  }
  throw last || new Error('Falha ao enviar mensagem (Evolution)');
}
```

**Step 2: Update POST /conversations/:id/send to support quotedMessageId**

Find the send endpoint and add quote handling:

```javascript
// Inside the send handler, before calling evoSendText:
const { type, body: textBody, quotedMessageId } = req.body;

// Build quoted payload if replying to a message
let quoted = null;
if (quotedMessageId) {
  const quotedMsg = await prisma.message.findFirst({
    where: { id: quotedMessageId, conversation: { companyId } },
    select: { externalId: true, body: true, type: true },
  });
  if (quotedMsg && quotedMsg.externalId) {
    quoted = {
      key: { id: quotedMsg.externalId, fromMe: false, remoteJid: `${conversation.channelContactId}@s.whatsapp.net` },
      message: { conversation: quotedMsg.body || '' },
    };
  }
}

// Then in the TEXT branch:
if (type === 'TEXT' || !type) {
  if (!textBody) return res.status(400).json({ message: 'body é obrigatório' });
  evoResult = await evoSendText({ instanceName, to, text: textBody, quoted });
}
```

And persist `quotedMessageId` when creating the Message:
```javascript
const message = await prisma.message.create({
  data: {
    // ... existing fields
    quotedMessageId: quotedMessageId || null,
  },
});
```

**Step 3: Commit**

```bash
git add delivery-saas-backend/src/routes/inbox.js delivery-saas-backend/src/wa.js
git commit -m "feat(inbox): support reply/quote via Evolution API"
```

---

### Task 6: Frontend — Pinia store updates

**Files:**
- Modify: `delivery-saas-frontend/src/stores/inbox.js`

**Step 1: Add new state fields**

In `state()`, add:
```javascript
  // ... existing
  filters: {
    storeId: null,
    status: 'OPEN',
    search: '',
    mine: false,
    unread: false,
  },
  replyToMessageId: null,
  internalMode: false,
  allTags: [],
```

**Step 2: Update fetchConversations to send new params**

```javascript
async fetchConversations() {
  this.loading = true;
  try {
    const params = {};
    if (this.filters.storeId) params.storeId = this.filters.storeId;
    if (this.filters.status) params.status = this.filters.status;
    if (this.filters.search) params.search = this.filters.search;
    if (this.filters.mine) params.mine = 'true';
    if (this.filters.unread) params.unread = 'true';
    const { data } = await api.get('/inbox/conversations', { params });
    this.conversations = Array.isArray(data) ? data : [];
    this.recalcUnread();
  } finally {
    this.loading = false;
  }
},
```

**Step 3: Add new actions**

```javascript
async sendInternalNote(conversationId, body) {
  const { data } = await api.post(`/inbox/conversations/${conversationId}/internal-note`, { body });
  return data;
},

async updateTags(conversationId, tags) {
  const { data } = await api.patch(`/inbox/conversations/${conversationId}/tags`, { tags });
  const idx = this.conversations.findIndex(c => c.id === conversationId);
  if (idx >= 0) this.conversations[idx] = { ...this.conversations[idx], tags: data.tags };
  return data;
},

async fetchAllTags() {
  try {
    const { data } = await api.get('/inbox/tags');
    this.allTags = Array.isArray(data) ? data : [];
  } catch (e) { this.allTags = []; }
},

setReplyTo(messageId) { this.replyToMessageId = messageId; },
clearReplyTo() { this.replyToMessageId = null; },
toggleInternalMode() { this.internalMode = !this.internalMode; },
```

**Step 4: Commit**

```bash
git add delivery-saas-frontend/src/stores/inbox.js
git commit -m "feat(inbox): extend store with filters, reply, internal mode, tags"
```

---

### Task 7: Frontend — Compress image utility

**Files:**
- Create: `delivery-saas-frontend/src/utils/compressImage.js`

**Step 1: Create utility**

```javascript
// Compress an image File client-side using canvas. Returns a new File or original.
export async function compressImage(file, opts = {}) {
  const { maxWidth = 1080, quality = 0.85, minSize = 200 * 1024 } = opts;
  if (!file || !file.type || !file.type.startsWith('image/')) return file;
  if (file.size < minSize) return file;

  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const img = await new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = reject;
    im.src = dataUrl;
  });

  const ratio = img.width > maxWidth ? maxWidth / img.width : 1;
  const w = Math.round(img.width * ratio);
  const h = Math.round(img.height * ratio);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  if (!blob) return file;

  // Create new File with same name but .jpg extension
  const newName = file.name.replace(/\.[^.]+$/, '') + '.jpg';
  return new File([blob], newName, { type: 'image/jpeg', lastModified: Date.now() });
}
```

**Step 2: Commit**

```bash
git add delivery-saas-frontend/src/utils/compressImage.js
git commit -m "feat(inbox): add client-side image compression utility"
```

---

### Task 8: Frontend — ConversationList filters UI

**Files:**
- Modify: `delivery-saas-frontend/src/views/inbox/ConversationList.vue`

**Step 1: Update template with 2-row filter layout**

Replace the existing filter section with:

```vue
<template>
  <div class="d-flex flex-column h-100">
    <!-- Search -->
    <div class="p-2 border-bottom">
      <input
        type="text"
        v-model="searchInput"
        @input="onSearchInput"
        placeholder="Buscar contato ou mensagem..."
        class="form-control form-control-sm"
      />
    </div>

    <!-- Filter row 1: status -->
    <div class="d-flex gap-1 px-2 pt-2">
      <button
        v-for="opt in statusOptions"
        :key="opt.value"
        class="btn btn-sm flex-fill"
        :class="filters.status === opt.value ? 'btn-primary' : 'btn-outline-secondary'"
        @click="setStatus(opt.value)"
      >{{ opt.label }}</button>
    </div>

    <!-- Filter row 2: chips + store -->
    <div class="d-flex gap-1 px-2 py-2 align-items-center flex-wrap">
      <button
        class="btn btn-sm"
        :class="filters.mine ? 'btn-info text-white' : 'btn-outline-secondary'"
        @click="toggleMine"
      >
        <i class="bi bi-person"></i> Minhas
        <span v-if="mineCount" class="badge bg-light text-dark ms-1">{{ mineCount }}</span>
      </button>
      <button
        class="btn btn-sm"
        :class="filters.unread ? 'btn-success text-white' : 'btn-outline-secondary'"
        @click="toggleUnread"
      >
        <i class="bi bi-circle-fill" style="font-size: 0.5rem;"></i> Não lidas
        <span v-if="unreadCount" class="badge bg-light text-dark ms-1">{{ unreadCount }}</span>
      </button>
      <select v-model="filters.storeId" @change="onFiltersChange" class="form-select form-select-sm" style="width: auto;">
        <option :value="null">Todas as lojas</option>
        <option v-for="s in stores" :key="s.id" :value="s.id">{{ s.name }}</option>
      </select>
    </div>

    <!-- List -->
    <div class="flex-grow-1 overflow-auto">
      <div v-if="inboxStore.loading" class="text-center py-3 text-muted small">Carregando...</div>
      <ConversationItem
        v-for="conv in inboxStore.conversations"
        :key="conv.id"
        :conversation="conv"
        :selected="conv.id === inboxStore.activeConversationId"
        @click="selectConversation(conv.id)"
      />
      <div v-if="!inboxStore.loading && !inboxStore.conversations.length" class="text-center py-3 text-muted small">
        Nenhuma conversa
      </div>
    </div>
  </div>
</template>
```

**Step 2: Update script setup**

```javascript
<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { useInboxStore } from '@/stores/inbox';
import { useAuthStore } from '@/stores/auth';
import api from '@/api';
import ConversationItem from './ConversationItem.vue';

const inboxStore = useInboxStore();
const authStore = useAuthStore();
const filters = inboxStore.filters;

const searchInput = ref(filters.search);
const stores = ref([]);

const statusOptions = [
  { label: 'Abertas', value: 'OPEN' },
  { label: 'Fechadas', value: 'CLOSED' },
  { label: 'Todas', value: '' },
];

const mineCount = computed(() => {
  const userId = authStore.user?.id;
  if (!userId) return 0;
  return inboxStore.conversations.filter(c => c.assignedUserId === userId).length;
});

const unreadCount = computed(() => {
  return inboxStore.conversations.filter(c => (c.unreadCount || 0) > 0).length;
});

let searchTimer = null;
function onSearchInput() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    filters.search = searchInput.value;
    inboxStore.fetchConversations();
  }, 400);
}

function setStatus(value) {
  filters.status = value;
  inboxStore.fetchConversations();
}

function toggleMine() {
  filters.mine = !filters.mine;
  inboxStore.fetchConversations();
}

function toggleUnread() {
  filters.unread = !filters.unread;
  inboxStore.fetchConversations();
}

function onFiltersChange() {
  inboxStore.fetchConversations();
}

function selectConversation(id) {
  inboxStore.activeConversationId = id;
  inboxStore.markAsRead(id).catch(() => {});
}

onMounted(async () => {
  try {
    const { data } = await api.get('/stores');
    stores.value = Array.isArray(data) ? data : [];
  } catch (e) { stores.value = []; }
});
</script>
```

**Step 3: Commit**

```bash
git add delivery-saas-frontend/src/views/inbox/ConversationList.vue
git commit -m "feat(inbox): add mine/unread/store filters with 2-row layout"
```

---

### Task 9: Frontend — ConversationItem with avatar + media preview

**Files:**
- Modify: `delivery-saas-frontend/src/views/inbox/ConversationItem.vue`

**Step 1: Add color hash and media preview**

Replace the script setup and avatar template:

```vue
<template>
  <div
    class="d-flex align-items-center p-2 border-bottom cursor-pointer"
    :class="{ 'bg-light': selected }"
    style="cursor: pointer;"
    @click="$emit('click')"
  >
    <!-- Avatar -->
    <div
      class="rounded-circle d-flex align-items-center justify-content-center text-white fw-semibold flex-shrink-0"
      :style="{ width: '40px', height: '40px', backgroundColor: avatarColor, fontSize: '0.9rem' }"
    >
      {{ initials }}
    </div>

    <!-- Content -->
    <div class="flex-grow-1 ms-2 min-width-0">
      <div class="d-flex justify-content-between align-items-baseline">
        <span class="fw-semibold text-truncate small">{{ displayName }}</span>
        <small class="text-muted flex-shrink-0 ms-1" style="font-size: 0.7rem;">{{ timeAgo }}</small>
      </div>
      <div class="d-flex justify-content-between align-items-center">
        <small class="text-muted text-truncate">{{ preview }}</small>
        <span v-if="conversation.unreadCount > 0" class="badge bg-success rounded-pill ms-1">{{ conversation.unreadCount }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  conversation: { type: Object, required: true },
  selected: { type: Boolean, default: false },
});

defineEmits(['click']);

const AVATAR_COLORS = ['#3498db','#e74c3c','#2ecc71','#f39c12','#9b59b6','#1abc9c','#e67e22','#34495e','#16a085','#c0392b'];

const displayName = computed(() => {
  return props.conversation.customer?.fullName
    || props.conversation.contactName
    || props.conversation.channelContactId
    || 'Sem nome';
});

const initials = computed(() => {
  const name = displayName.value || '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
});

const avatarColor = computed(() => {
  const name = displayName.value;
  let hash = 0;
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
});

const preview = computed(() => {
  const lastMsg = props.conversation.messages?.[0];
  if (!lastMsg) return '';
  if (lastMsg.internal) return '🔒 ' + (lastMsg.body || 'Nota interna');
  switch (lastMsg.type) {
    case 'IMAGE': return '📷 Foto' + (lastMsg.body ? ': ' + lastMsg.body : '');
    case 'AUDIO': return '🎤 Áudio';
    case 'VIDEO': return '📹 Vídeo' + (lastMsg.body ? ': ' + lastMsg.body : '');
    case 'DOCUMENT': return '📎 ' + (lastMsg.mediaFileName || 'Documento');
    case 'LOCATION': return '📍 Localização';
    case 'STICKER': return 'Sticker';
    default: return lastMsg.body || '';
  }
});

const timeAgo = computed(() => {
  const d = props.conversation.lastMessageAt;
  if (!d) return '';
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'agora';
  if (m < 60) return m + 'm';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h';
  return new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
});
</script>
```

**Step 2: Commit**

```bash
git add delivery-saas-frontend/src/views/inbox/ConversationItem.vue
git commit -m "feat(inbox): add hash-color avatar and media preview to conversation list"
```

---

### Task 10: Frontend — ChatBubble with internal note + reply + copy

**Files:**
- Modify: `delivery-saas-frontend/src/views/inbox/ChatBubble.vue`

**Step 1: Update template**

Wrap the existing bubble in a hover-aware container, add internal note style, quote preview, and action buttons.

```vue
<template>
  <!-- Internal note: full-width yellow card -->
  <div v-if="message.internal" class="my-2 px-3">
    <div class="bg-warning-subtle border border-warning rounded p-2">
      <div class="d-flex align-items-center gap-1 mb-1">
        <i class="bi bi-lock-fill text-warning"></i>
        <small class="fw-semibold text-warning-emphasis">Nota interna</small>
        <small v-if="message.authorUser?.name" class="text-muted ms-1">· {{ message.authorUser.name }}</small>
        <small class="text-muted ms-auto" style="font-size: 0.7rem;">{{ formattedTime }}</small>
      </div>
      <div style="white-space: pre-wrap; font-size: 0.85rem;">{{ message.body }}</div>
    </div>
  </div>

  <!-- Normal message -->
  <div v-else
    class="d-flex mb-2 message-wrapper"
    :class="isOutbound ? 'justify-content-end' : 'justify-content-start'"
  >
    <div class="rounded-3 px-3 py-2 position-relative bubble"
      :class="isOutbound ? 'bg-success-subtle' : 'bg-white'"
      style="max-width: 75%; min-width: 80px; word-wrap: break-word;"
    >
      <!-- Quote preview (when this message is a reply) -->
      <div v-if="quotedMessage" class="border-start border-3 border-secondary ps-2 mb-1 small text-muted" style="opacity: 0.8;">
        <div class="fw-semibold" style="font-size: 0.7rem;">{{ quotedAuthorLabel }}</div>
        <div class="text-truncate">{{ quotedPreview }}</div>
      </div>

      <!-- TEXT -->
      <div v-if="message.type === 'TEXT'" style="white-space: pre-wrap;">{{ message.body }}</div>

      <!-- IMAGE -->
      <div v-else-if="message.type === 'IMAGE'">
        <img
          :src="resolvedMediaUrl"
          class="img-fluid rounded"
          style="max-height: 300px; cursor: pointer;"
          @click="$emit('open-image', resolvedMediaUrl)"
        />
        <div v-if="message.body" class="mt-1 small" style="white-space: pre-wrap;">{{ message.body }}</div>
      </div>

      <!-- AUDIO -->
      <div v-else-if="message.type === 'AUDIO'">
        <AudioPlayer :src="resolvedMediaUrl" />
      </div>

      <!-- VIDEO -->
      <div v-else-if="message.type === 'VIDEO'">
        <video :src="resolvedMediaUrl" controls class="rounded" style="max-width: 100%; max-height: 300px;"></video>
        <div v-if="message.body" class="mt-1 small" style="white-space: pre-wrap;">{{ message.body }}</div>
      </div>

      <!-- DOCUMENT -->
      <div v-else-if="message.type === 'DOCUMENT'">
        <a :href="resolvedMediaUrl" target="_blank" class="text-decoration-none">
          <i class="bi bi-file-earmark me-1"></i>
          {{ message.mediaFileName || message.body || 'Documento' }}
        </a>
      </div>

      <!-- LOCATION -->
      <div v-else-if="message.type === 'LOCATION'">
        <i class="bi bi-geo-alt me-1"></i>{{ message.body || 'Localização' }}
      </div>

      <!-- STICKER -->
      <div v-else-if="message.type === 'STICKER'">
        <img :src="resolvedMediaUrl" style="max-width: 150px; max-height: 150px;" />
      </div>

      <!-- Time + status -->
      <div class="d-flex align-items-center justify-content-end gap-1 mt-1">
        <small class="text-muted" style="font-size: 0.7rem;">{{ formattedTime }}</small>
        <i v-if="isOutbound" class="bi" :class="statusIcon" style="font-size: 0.7rem;"></i>
      </div>

      <!-- Hover actions -->
      <div class="message-actions">
        <button class="btn btn-sm btn-light p-1 me-1" title="Responder" @click="$emit('reply', message.id)">
          <i class="bi bi-reply" style="font-size: 0.8rem;"></i>
        </button>
        <button v-if="message.body" class="btn btn-sm btn-light p-1" title="Copiar texto" @click="copyText">
          <i class="bi bi-clipboard" style="font-size: 0.8rem;"></i>
        </button>
      </div>
    </div>
  </div>
</template>
```

**Step 2: Update script**

```vue
<script setup>
import { computed } from 'vue';
import { API_URL } from '@/config';
import AudioPlayer from './AudioPlayer.vue';

const props = defineProps({
  message: { type: Object, required: true },
  allMessages: { type: Array, default: () => [] },
});

defineEmits(['reply', 'open-image']);

const isOutbound = computed(() => props.message.direction === 'OUTBOUND');

const resolvedMediaUrl = computed(() => {
  const url = props.message.mediaUrl;
  if (!url) return null;
  if (url.startsWith('http')) return url;
  return `${API_URL}${url.startsWith('/') ? '' : '/'}${url}`;
});

const quotedMessage = computed(() => {
  if (!props.message.quotedMessageId) return null;
  return props.allMessages.find(m => m.id === props.message.quotedMessageId) || null;
});

const quotedAuthorLabel = computed(() => {
  const q = quotedMessage.value;
  if (!q) return '';
  return q.direction === 'OUTBOUND' ? 'Você' : 'Cliente';
});

const quotedPreview = computed(() => {
  const q = quotedMessage.value;
  if (!q) return '';
  if (q.type === 'IMAGE') return '📷 Foto';
  if (q.type === 'AUDIO') return '🎤 Áudio';
  if (q.type === 'DOCUMENT') return '📎 Documento';
  return q.body || '';
});

const formattedTime = computed(() => {
  const d = new Date(props.message.createdAt);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
});

const statusIcon = computed(() => {
  const s = props.message.status;
  if (s === 'PENDING') return 'bi-clock text-muted';
  if (s === 'SENT') return 'bi-check text-muted';
  if (s === 'DELIVERED') return 'bi-check-all text-muted';
  if (s === 'READ') return 'bi-check-all text-primary';
  if (s === 'FAILED') return 'bi-exclamation-circle text-danger';
  return 'bi-clock text-muted';
});

async function copyText() {
  try {
    await navigator.clipboard.writeText(props.message.body || '');
  } catch (e) { console.warn('Failed to copy', e); }
}
</script>

<style scoped>
.message-wrapper { position: relative; }
.bubble { position: relative; }
.message-actions {
  position: absolute;
  top: -8px;
  right: 8px;
  display: none;
  background: white;
  border: 1px solid #dee2e6;
  border-radius: 12px;
  padding: 2px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}
.message-wrapper:hover .message-actions { display: flex; }
</style>
```

**Step 3: Commit**

```bash
git add delivery-saas-frontend/src/views/inbox/ChatBubble.vue
git commit -m "feat(inbox): add internal note rendering, reply/quote, copy actions"
```

---

### Task 11: Frontend — ChatPanel with day grouping + drag/drop + lightbox

**Files:**
- Modify: `delivery-saas-frontend/src/views/inbox/ChatPanel.vue`
- Create: `delivery-saas-frontend/src/views/inbox/ImageLightbox.vue`

**Step 1: Create ImageLightbox.vue**

```vue
<template>
  <div v-if="src" class="lightbox-overlay" @click.self="$emit('close')">
    <button class="btn-close-lightbox" @click="$emit('close')">
      <i class="bi bi-x-lg"></i>
    </button>
    <img :src="src" class="lightbox-image" />
  </div>
</template>

<script setup>
import { onMounted, onUnmounted } from 'vue';

const props = defineProps({ src: String });
const emit = defineEmits(['close']);

function onKey(e) {
  if (e.key === 'Escape') emit('close');
}

onMounted(() => window.addEventListener('keydown', onKey));
onUnmounted(() => window.removeEventListener('keydown', onKey));
</script>

<style scoped>
.lightbox-overlay {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0,0,0,0.85);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}
.lightbox-image {
  max-width: 90vw;
  max-height: 90vh;
  object-fit: contain;
}
.btn-close-lightbox {
  position: absolute;
  top: 20px;
  right: 20px;
  background: white;
  border: none;
  border-radius: 50%;
  width: 40px;
  height: 40px;
  cursor: pointer;
}
</style>
```

**Step 2: Update ChatPanel template with grouped messages, drag area, lightbox**

```vue
<template>
  <div class="d-flex flex-column h-100" @dragover.prevent="onDragOver" @drop.prevent="onDrop" @dragleave="onDragLeave">
    <ConversationHeader :conversation="conversation" @back="$emit('back')" @toggle-panel="$emit('toggle-panel')" />

    <!-- Drag overlay -->
    <div v-if="isDragging" class="drag-overlay">
      <div class="text-center">
        <i class="bi bi-cloud-upload" style="font-size: 3rem;"></i>
        <p class="mt-2">Solte o arquivo aqui</p>
      </div>
    </div>

    <!-- Messages -->
    <div ref="messagesContainer" class="flex-grow-1 overflow-auto px-3 py-2" style="background: #efeae2;" @scroll="onScroll">
      <div v-if="loadingOlder" class="text-center py-2">
        <div class="spinner-border spinner-border-sm text-secondary"></div>
      </div>

      <template v-for="(item, idx) in groupedItems" :key="idx">
        <!-- Date separator -->
        <div v-if="item.type === 'separator'" class="text-center my-3">
          <span class="badge bg-light text-dark">{{ item.label }}</span>
        </div>
        <!-- Message -->
        <ChatBubble
          v-else
          :message="item.message"
          :all-messages="messages"
          @reply="onReply"
          @open-image="openLightbox"
        />
      </template>
    </div>

    <!-- Input -->
    <ChatInput :conversation-id="conversationId" @file-from-drop="handleDroppedFile" />

    <!-- Lightbox -->
    <ImageLightbox v-if="lightboxSrc" :src="lightboxSrc" @close="lightboxSrc = null" />
  </div>
</template>
```

**Step 3: Update ChatPanel script with grouping logic**

```vue
<script setup>
import { ref, computed, watch, nextTick, onMounted } from 'vue';
import { useInboxStore } from '@/stores/inbox';
import ConversationHeader from './ConversationHeader.vue';
import ChatBubble from './ChatBubble.vue';
import ChatInput from './ChatInput.vue';
import ImageLightbox from './ImageLightbox.vue';

const props = defineProps({ conversationId: { type: String, required: true } });
defineEmits(['back', 'toggle-panel']);

const inboxStore = useInboxStore();
const messagesContainer = ref(null);
const loadingOlder = ref(false);
const isDragging = ref(false);
const lightboxSrc = ref(null);
let dragCounter = 0;

const conversation = computed(() => inboxStore.conversations.find(c => c.id === props.conversationId) || null);
const messages = computed(() => inboxStore.messages[props.conversationId] || []);

function dayLabel(date) {
  const d = new Date(date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(d);
  target.setHours(0, 0, 0, 0);
  const diffDays = Math.floor((today - target) / 86400000);
  if (diffDays === 0) return 'Hoje';
  if (diffDays === 1) return 'Ontem';
  if (diffDays < 7) return d.toLocaleDateString('pt-BR', { weekday: 'long' });
  return d.toLocaleDateString('pt-BR');
}

const groupedItems = computed(() => {
  const items = [];
  let lastDate = null;
  for (const msg of messages.value) {
    const dateKey = new Date(msg.createdAt).toDateString();
    if (dateKey !== lastDate) {
      items.push({ type: 'separator', label: dayLabel(msg.createdAt) });
      lastDate = dateKey;
    }
    items.push({ type: 'message', message: msg });
  }
  return items;
});

function onReply(messageId) {
  inboxStore.setReplyTo(messageId);
}

function openLightbox(src) {
  lightboxSrc.value = src;
}

function onDragOver(e) {
  if (e.dataTransfer.types.includes('Files')) {
    isDragging.value = true;
  }
}

function onDragLeave() {
  dragCounter--;
  if (dragCounter <= 0) {
    isDragging.value = false;
    dragCounter = 0;
  }
}

function onDrop(e) {
  isDragging.value = false;
  dragCounter = 0;
  const file = e.dataTransfer.files?.[0];
  if (file) handleDroppedFile(file);
}

function handleDroppedFile(file) {
  // Forward to ChatInput via event bus or shared ref
  window.dispatchEvent(new CustomEvent('inbox-drop-file', { detail: file }));
}

function onScroll() {
  if (messagesContainer.value && messagesContainer.value.scrollTop < 100 && !loadingOlder.value) {
    loadOlder();
  }
}

async function loadOlder() {
  const msgs = messages.value;
  if (!msgs.length) return;
  const oldest = msgs[0];
  loadingOlder.value = true;
  try {
    const prevHeight = messagesContainer.value?.scrollHeight || 0;
    await inboxStore.fetchMessages(props.conversationId, oldest.createdAt);
    await nextTick();
    if (messagesContainer.value) {
      messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight - prevHeight;
    }
  } finally {
    loadingOlder.value = false;
  }
}

watch(() => messages.value.length, async () => {
  await nextTick();
  if (messagesContainer.value) {
    messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
  }
});

onMounted(async () => {
  if (!inboxStore.messages[props.conversationId]) {
    await inboxStore.fetchMessages(props.conversationId);
  }
  await nextTick();
  if (messagesContainer.value) {
    messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
  }
});
</script>

<style scoped>
.drag-overlay {
  position: absolute;
  top: 56px;
  left: 0;
  right: 0;
  bottom: 80px;
  background: rgba(13, 110, 253, 0.1);
  border: 3px dashed #0d6efd;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  pointer-events: none;
  color: #0d6efd;
}
</style>
```

**Step 4: Commit**

```bash
git add delivery-saas-frontend/src/views/inbox/ChatPanel.vue delivery-saas-frontend/src/views/inbox/ImageLightbox.vue
git commit -m "feat(inbox): add day grouping, drag-drop, image lightbox to chat panel"
```

---

### Task 12: Frontend — ChatInput with internal mode + reply preview + paste + compression

**Files:**
- Modify: `delivery-saas-frontend/src/views/inbox/ChatInput.vue`

**Step 1: Update template**

```vue
<template>
  <div class="border-top bg-white p-2" :class="{ 'bg-warning-subtle': inboxStore.internalMode }">
    <!-- Reply preview -->
    <div v-if="replyToMessage" class="d-flex align-items-center mb-2 p-2 bg-light rounded border-start border-3 border-primary">
      <div class="flex-grow-1 small">
        <div class="fw-semibold" style="font-size: 0.7rem;">Respondendo a {{ replyAuthorLabel }}</div>
        <div class="text-truncate text-muted">{{ replyPreview }}</div>
      </div>
      <button class="btn btn-sm btn-close" @click="clearReply"></button>
    </div>

    <!-- File preview -->
    <div v-if="selectedFile" class="d-flex align-items-center gap-2 mb-2 p-2 bg-light rounded small">
      <i class="bi bi-file-earmark"></i>
      <span class="text-truncate">{{ selectedFile.name }}</span>
      <span v-if="compressing" class="text-muted">(comprimindo...)</span>
      <button class="btn btn-sm btn-close ms-auto" @click="clearFile"></button>
    </div>

    <!-- Quick reply chips -->
    <div v-if="quickReplies.length && !inboxStore.internalMode" class="d-flex gap-1 mb-2 overflow-auto pb-1" style="scrollbar-width: thin;">
      <button
        v-for="reply in quickReplies"
        :key="reply.id"
        class="btn btn-sm btn-outline-secondary text-nowrap"
        style="font-size: 0.75rem; flex-shrink: 0;"
        :disabled="sending"
        :title="reply.body"
        @click="sendQuickReply(reply)"
      >
        <i class="bi bi-lightning-charge me-1"></i>{{ reply.title || reply.shortcut }}
      </button>
    </div>

    <!-- Quick reply picker (typing /) -->
    <QuickReplyPicker v-if="showQuickReplies" :filter="quickReplyFilter" @select="onQuickReplySelect" />

    <!-- Input row -->
    <div class="d-flex align-items-end gap-2">
      <!-- Internal mode toggle -->
      <button
        class="btn btn-sm"
        :class="inboxStore.internalMode ? 'btn-warning' : 'btn-light'"
        :title="inboxStore.internalMode ? 'Modo nota interna ativo' : 'Ativar nota interna'"
        @click="inboxStore.toggleInternalMode()"
      >
        <i class="bi bi-lock"></i>
      </button>

      <!-- Attach -->
      <button class="btn btn-sm btn-light" @click="triggerFileInput" :disabled="sending || inboxStore.internalMode">
        <i class="bi bi-paperclip" style="font-size: 1.2rem;"></i>
      </button>
      <input ref="fileInput" type="file" class="d-none" accept="image/*,.pdf,.doc,.docx" @change="onFileSelected" />

      <!-- Textarea -->
      <textarea
        ref="textareaRef"
        v-model="text"
        class="form-control form-control-sm"
        rows="1"
        :placeholder="inboxStore.internalMode ? 'Escrever nota interna (não enviada ao cliente)...' : 'Digite uma mensagem...'"
        style="max-height: 120px; resize: none;"
        @keydown="onKeydown"
        @input="autoResize"
        @paste="onPaste"
      ></textarea>

      <!-- Send -->
      <button class="btn btn-sm" :class="inboxStore.internalMode ? 'btn-warning' : 'btn-success'"
        :disabled="(!text.trim() && !selectedFile) || sending"
        @click="send"
      >
        <i v-if="sending" class="bi bi-arrow-repeat spin"></i>
        <i v-else class="bi" :class="inboxStore.internalMode ? 'bi-lock-fill' : 'bi-send'"></i>
      </button>
    </div>
  </div>
</template>
```

**Step 2: Update script**

```vue
<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue';
import { useInboxStore } from '@/stores/inbox';
import { compressImage } from '@/utils/compressImage';
import QuickReplyPicker from './QuickReplyPicker.vue';

const props = defineProps({ conversationId: { type: String, required: true } });

const inboxStore = useInboxStore();
const text = ref('');
const selectedFile = ref(null);
const sending = ref(false);
const compressing = ref(false);
const fileInput = ref(null);
const textareaRef = ref(null);

const showQuickReplies = computed(() => text.value.startsWith('/') && text.value.length > 0);
const quickReplyFilter = computed(() => text.value.slice(1));
const quickReplies = computed(() => inboxStore.quickReplies || []);

const replyToMessage = computed(() => {
  if (!inboxStore.replyToMessageId) return null;
  const msgs = inboxStore.messages[props.conversationId] || [];
  return msgs.find(m => m.id === inboxStore.replyToMessageId) || null;
});

const replyAuthorLabel = computed(() => {
  const m = replyToMessage.value;
  if (!m) return '';
  return m.direction === 'OUTBOUND' ? 'Você' : 'Cliente';
});

const replyPreview = computed(() => {
  const m = replyToMessage.value;
  if (!m) return '';
  if (m.type === 'IMAGE') return '📷 Foto';
  if (m.type === 'AUDIO') return '🎤 Áudio';
  return m.body || '';
});

function clearReply() { inboxStore.clearReplyTo(); }
function triggerFileInput() { fileInput.value?.click(); }

async function setFile(file) {
  if (!file) return;
  if (file.type?.startsWith('image/')) {
    compressing.value = true;
    try {
      selectedFile.value = await compressImage(file);
    } finally {
      compressing.value = false;
    }
  } else {
    selectedFile.value = file;
  }
}

function onFileSelected(e) {
  const f = e.target.files?.[0];
  if (f) setFile(f);
}

function clearFile() {
  selectedFile.value = null;
  if (fileInput.value) fileInput.value.value = '';
}

function onQuickReplySelect(reply) {
  text.value = reply.body || '';
  nextTick(() => autoResize());
}

function onKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    send();
  }
}

function onPaste(e) {
  const items = e.clipboardData?.items || [];
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) {
        setFile(file);
        e.preventDefault();
        return;
      }
    }
  }
}

function autoResize() {
  const el = textareaRef.value;
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

async function send() {
  const body = text.value.trim();
  if (!body && !selectedFile.value) return;
  sending.value = true;
  try {
    if (inboxStore.internalMode) {
      await inboxStore.sendInternalNote(props.conversationId, body);
    } else {
      const payload = {};
      if (selectedFile.value) {
        payload.type = selectedFile.value.type.startsWith('image/') ? 'IMAGE' : 'DOCUMENT';
        payload.mediaFile = selectedFile.value;
        if (body) payload.body = body;
      } else {
        payload.type = 'TEXT';
        payload.body = body;
      }
      if (inboxStore.replyToMessageId) {
        payload.quotedMessageId = inboxStore.replyToMessageId;
      }
      await inboxStore.sendMessage(props.conversationId, payload);
    }
    text.value = '';
    clearFile();
    inboxStore.clearReplyTo();
    nextTick(() => autoResize());
  } catch (err) {
    console.error('Failed to send', err);
  } finally {
    sending.value = false;
  }
}

async function sendQuickReply(reply) {
  if (sending.value || !reply?.body) return;
  sending.value = true;
  try {
    await inboxStore.sendMessage(props.conversationId, { type: 'TEXT', body: reply.body });
  } catch (err) {
    console.error('Failed to send quick reply', err);
  } finally {
    sending.value = false;
  }
}

// Listen for files dropped on ChatPanel
function onDropFile(e) {
  if (e.detail) setFile(e.detail);
}

onMounted(() => window.addEventListener('inbox-drop-file', onDropFile));
onUnmounted(() => window.removeEventListener('inbox-drop-file', onDropFile));
</script>

<style scoped>
.spin { animation: spin 1s linear infinite; }
@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
</style>
```

**Step 3: Commit**

```bash
git add delivery-saas-frontend/src/views/inbox/ChatInput.vue
git commit -m "feat(inbox): add internal mode, reply preview, paste, compression to chat input"
```

---

### Task 13: Frontend — TagChips component + ConversationHeader integration

**Files:**
- Create: `delivery-saas-frontend/src/views/inbox/TagChips.vue`
- Modify: `delivery-saas-frontend/src/views/inbox/ConversationHeader.vue`

**Step 1: Create TagChips.vue**

```vue
<template>
  <div class="d-flex align-items-center gap-1 flex-wrap">
    <span
      v-for="tag in tags"
      :key="tag"
      class="badge d-flex align-items-center gap-1"
      :style="{ backgroundColor: colorForTag(tag), color: 'white', fontSize: '0.7rem' }"
    >
      {{ tag }}
      <i class="bi bi-x" style="cursor: pointer;" @click="removeTag(tag)"></i>
    </span>
    <div v-if="adding">
      <input
        ref="inputRef"
        v-model="newTag"
        type="text"
        list="tag-suggestions"
        class="form-control form-control-sm"
        style="width: 100px; font-size: 0.7rem;"
        @keydown.enter.prevent="addTag"
        @keydown.esc="cancelAdd"
        @blur="addTag"
      />
      <datalist id="tag-suggestions">
        <option v-for="t in inboxStore.allTags" :key="t.tag" :value="t.tag" />
      </datalist>
    </div>
    <button v-else class="btn btn-sm p-0 text-muted" style="font-size: 0.7rem;" @click="startAdd">
      <i class="bi bi-plus"></i> tag
    </button>
  </div>
</template>

<script setup>
import { ref, nextTick, onMounted } from 'vue';
import { useInboxStore } from '@/stores/inbox';

const props = defineProps({
  conversationId: { type: String, required: true },
  tags: { type: Array, default: () => [] },
});

const inboxStore = useInboxStore();
const adding = ref(false);
const newTag = ref('');
const inputRef = ref(null);

const TAG_COLORS = ['#e74c3c','#3498db','#2ecc71','#f39c12','#9b59b6','#1abc9c','#e67e22','#34495e'];
function colorForTag(tag) {
  let hash = 0;
  for (const c of tag) hash = (hash * 31 + c.charCodeAt(0)) | 0;
  return TAG_COLORS[Math.abs(hash) % TAG_COLORS.length];
}

function startAdd() {
  adding.value = true;
  nextTick(() => inputRef.value?.focus());
}

function cancelAdd() {
  adding.value = false;
  newTag.value = '';
}

async function addTag() {
  const t = newTag.value.trim().toLowerCase();
  if (t && !props.tags.includes(t)) {
    const updated = [...props.tags, t];
    await inboxStore.updateTags(props.conversationId, updated);
  }
  cancelAdd();
}

async function removeTag(tag) {
  const updated = props.tags.filter(t => t !== tag);
  await inboxStore.updateTags(props.conversationId, updated);
}

onMounted(() => {
  if (!inboxStore.allTags.length) inboxStore.fetchAllTags();
});
</script>
```

**Step 2: Update ConversationHeader.vue to include TagChips**

Add `<TagChips>` below the contact name row:

```vue
<!-- Inside the existing contact info div, after the channelContactId small -->
<TagChips
  v-if="conversation"
  :conversation-id="conversation.id"
  :tags="conversation.tags || []"
/>
```

And import:
```javascript
import TagChips from './TagChips.vue';
```

**Step 3: Commit**

```bash
git add delivery-saas-frontend/src/views/inbox/TagChips.vue delivery-saas-frontend/src/views/inbox/ConversationHeader.vue
git commit -m "feat(inbox): add tag chips with autocomplete to conversation header"
```

---

### Task 14: Build verification

**Step 1: Build frontend**

```bash
cd delivery-saas-frontend && npx vite build 2>&1 | tail -20
```

Expected: `built in Xs` with no errors.

**Step 2: Verify backend imports**

```bash
cd delivery-saas-backend && node -e "import('./src/routes/inbox.js').then(() => console.log('OK'))"
```

Expected: `OK`.

**Step 3: Push if all good**

```bash
git push origin main
```
