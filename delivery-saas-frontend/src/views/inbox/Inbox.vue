<template>
  <div
    class="inbox-shell"
    :class="{ 'inbox-shell--mobile-active': inboxStore.activeConversationId }"
  >
    <!-- List panel: 340px wide, hide on mobile when chat is active -->
    <div
      class="inbox-shell__sidebar"
      :class="{ 'd-none d-md-flex': inboxStore.activeConversationId }"
    >
      <ConversationList @select="selectConversation" />
    </div>
    <!-- Chat + contact panel (shown when conversation selected) -->
    <template v-if="inboxStore.activeConversationId">
      <div
        class="inbox-shell__chat"
        :class="{ 'd-none d-md-flex': mobileTab !== 'chat' }"
        :key="'chat-' + inboxStore.activeConversationId"
      >
        <ChatPanel
          :conversation-id="inboxStore.activeConversationId"
          @back="inboxStore.activeConversationId = null"
          @toggle-panel="showContactPanel = !showContactPanel"
        />
      </div>
      <div
        v-if="showContactPanel || mobileTab === 'order'"
        class="inbox-shell__contact"
        :class="{
          'd-none d-md-flex': mobileTab !== 'order',
          'd-flex': mobileTab === 'order',
        }"
        :key="'contact-' + inboxStore.activeConversationId"
      >
        <ContactPanel :conversation-id="inboxStore.activeConversationId" />
      </div>

      <!-- Mobile bottom tab bar (Conversa ↔ Pedido) -->
      <nav class="inbox-mobile-tabs d-md-none">
        <button
          type="button"
          class="inbox-mobile-tabs__btn"
          :class="{ 'inbox-mobile-tabs__btn--active': mobileTab === 'chat' }"
          @click="mobileTab = 'chat'"
        >
          <i class="bi bi-chat-dots inbox-mobile-tabs__icon"></i>
          <span class="inbox-mobile-tabs__label">Conversa</span>
        </button>
        <button
          type="button"
          class="inbox-mobile-tabs__btn"
          :class="{ 'inbox-mobile-tabs__btn--active': mobileTab === 'order' }"
          @click="mobileTab = 'order'"
        >
          <span class="inbox-mobile-tabs__icon-wrap">
            <i class="bi bi-bag inbox-mobile-tabs__icon"></i>
            <span v-if="hasActiveOrder" class="inbox-mobile-tabs__dot"></span>
          </span>
          <span class="inbox-mobile-tabs__label">Pedido</span>
        </button>
      </nav>
    </template>
    <!-- Empty state on desktop (when no conversation selected) -->
    <template v-else>
      <div class="inbox-shell__empty d-none d-md-flex">
        <div class="text-center">
          <i class="bi bi-chat-left-dots inbox-shell__empty-icon"></i>
          <p class="mt-3 mb-0">Selecione uma conversa</p>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { io } from 'socket.io-client';
import { SOCKET_URL } from '@/config';
import { useInboxStore } from '@/stores/inbox';
import { useAuthStore } from '@/stores/auth';
import ConversationList from './ConversationList.vue';
import ChatPanel from './ChatPanel.vue';
import ContactPanel from './ContactPanel.vue';

const inboxStore = useInboxStore();
const authStore = useAuthStore();

const showContactPanel = ref(true);
const mobileTab = ref('chat');

const hasActiveOrder = computed(() => {
  const id = inboxStore.activeConversationId;
  if (!id) return false;
  return !!inboxStore.orderDrafts?.[id]?.active;
});

watch(
  () => inboxStore.activeConversationId,
  (id) => {
    if (id) mobileTab.value = 'chat';
  },
);

let socket = null;
let beepAudio = null;

async function selectConversation(conversationId) {
  inboxStore.activeConversationId = conversationId;
  mobileTab.value = 'chat';
  inboxStore.markAsRead(conversationId).catch(() => {});

  // Fetch customer data for contact panel
  const conv = inboxStore.conversations.find(c => c.id === conversationId);
  if (conv?.customerId && !inboxStore.customerCache[conv.customerId]) {
    inboxStore.fetchCustomer(conv.customerId).catch(() => {});
  }
}

function playBeep() {
  try {
    if (!beepAudio) {
      // Simple beep using AudioContext
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 600;
      gain.gain.value = 0.3;
      osc.start();
      osc.stop(ctx.currentTime + 0.2);
    }
  } catch (e) {
    // Audio not available
  }
}

function showNotification(message) {
  if (Notification.permission === 'granted') {
    new Notification('Nova mensagem', {
      body: message.body || 'Nova mensagem recebida',
      icon: '/favicon.ico',
    });
  }
}

onMounted(async () => {
  // Request notification permission
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }

  // Restore from sessionStorage if available (instant render)
  const restored = inboxStore.restoreFromSessionStorage();
  if (!restored) {
    inboxStore.fetchConversations();
  } else {
    // Still refresh in background to pick up any updates
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

  // Socket.IO connection — DO NOT pass token in handshake.auth because the
  // existing io.use middleware reserves auth.token for print agent authentication
  // and would reject a JWT here. Use socket.emit('identify', token) instead.
  socket = io(SOCKET_URL, {
    transports: ['polling', 'websocket'],
    reconnectionAttempts: Infinity,
    reconnectionDelay: 2000,
    timeout: 30000,
  });

  socket.on('connect', () => {
    console.log('[inbox] socket connected', socket.id);
    // Also emit identify as fallback (for backend versions that only listen here)
    const token = authStore.token || localStorage.getItem('token');
    if (token) {
      socket.emit('identify', token);
    }
  });

  socket.on('connect_error', (err) => {
    console.warn('[inbox] socket connect error:', err && err.message);
  });

  socket.on('disconnect', (reason) => {
    console.warn('[inbox] socket disconnected:', reason);
  });

  socket.on('reconnect', async () => {
    console.log('[inbox] socket reconnected — refetching');
    try {
      await inboxStore.fetchConversations();
      if (inboxStore.activeConversationId) {
        // Force fresh fetch (ignore local cache)
        delete inboxStore.messages[inboxStore.activeConversationId];
        await inboxStore.fetchMessages(inboxStore.activeConversationId);
      }
    } catch (e) {
      console.warn('[inbox] refetch on reconnect failed', e);
    }
  });

  // Track delivered message IDs to dedupe between room emit and broadcast fallback
  const seenMessageIds = new Set();
  function handleIncoming(payload) {
    const msgId = payload?.message?.id;
    if (msgId) {
      if (seenMessageIds.has(msgId)) return;
      seenMessageIds.add(msgId);
      // Cap set size to avoid memory growth
      if (seenMessageIds.size > 500) {
        const first = seenMessageIds.values().next().value;
        seenMessageIds.delete(first);
      }
    }
    inboxStore.handleNewMessage(payload);
    if (payload.message && payload.message.direction === 'INBOUND') {
      playBeep();
      showNotification(payload.message);
    }
  }

  socket.on('inbox:new-message', (payload) => {
    console.log('[inbox] received inbox:new-message', payload?.conversationId);
    handleIncoming(payload);
  });

  // Broadcast fallback: filter by companyId to ignore other companies
  socket.on('inbox:new-message:broadcast', (payload) => {
    const myCompanyId = authStore.user?.companyId;
    if (!myCompanyId || payload.companyId !== myCompanyId) return;
    console.log('[inbox] received inbox:new-message:broadcast (fallback)', payload?.conversationId);
    handleIncoming(payload);
  });

  socket.on('inbox:message-sent', (payload) => {
    inboxStore.handleMessageSent(payload);
  });

  socket.on('inbox:message-status', (payload) => {
    inboxStore.handleMessageStatus(payload);
  });

  socket.on('inbox:conversation-updated', (payload) => {
    inboxStore.handleConversationUpdated(payload);
  });
});

onUnmounted(() => {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
});
</script>
<style scoped>
/* Main content responsive padding */
.main-content { padding:0 !important; }

.inbox-shell {
  display: flex;
  height: 100%;
  overflow: hidden;
  background: #f4f5f7;
}

.inbox-shell__sidebar {
  width: 340px;
  min-width: 300px;
  flex-shrink: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: #fff;
  border-right: 1px solid #e9ecf1;
}

.inbox-shell__chat {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.inbox-shell__contact {
  width: 350px;
  min-width: 320px;
  flex-shrink: 0;
  flex-direction: column;
  background: #fff;
  border-left: 1px solid #e9ecf1;
}

.inbox-shell__empty {
  flex: 1;
  align-items: center;
  justify-content: center;
  color: #929aa8;
}
.inbox-shell__empty-icon {
  font-size: 3rem;
  color: #cfd5dd;
}

@media (max-width: 767.98px) {
  .inbox-shell__sidebar { width: 100%; min-width: 0; border-right: none; }

  /* When mobile-active, reserve bottom space for the tab bar */
  .inbox-shell--mobile-active { padding-bottom: 60px; }

  /* Mobile contact panel: full-width, no left border */
  .inbox-shell__contact {
    width: 100%;
    min-width: 0;
    border-left: none;
    flex: 1;
  }
}

/* ── Mobile bottom tabs (Conversa ↔ Pedido) ── */
.inbox-mobile-tabs {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 1030;
  display: flex;
  height: 60px;
  background: #fff;
  border-top: 1px solid #e9ecf1;
  box-shadow: 0 -2px 8px rgba(0, 0, 0, 0.04);
  padding-bottom: env(safe-area-inset-bottom, 0);
}
.inbox-mobile-tabs__btn {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  border: none;
  background: transparent;
  color: #929aa8;
  font-size: 0.72rem;
  font-weight: 600;
  cursor: pointer;
  transition: color .12s;
  position: relative;
}
.inbox-mobile-tabs__btn--active {
  color: var(--success, #89D136);
}
.inbox-mobile-tabs__btn--active::before {
  content: '';
  position: absolute;
  top: 0;
  left: 18%;
  right: 18%;
  height: 3px;
  border-radius: 0 0 3px 3px;
  background: var(--success, #89D136);
}
.inbox-mobile-tabs__icon { font-size: 1.25rem; line-height: 1; }
.inbox-mobile-tabs__label { line-height: 1; }
.inbox-mobile-tabs__icon-wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.inbox-mobile-tabs__dot {
  position: absolute;
  top: -2px;
  right: -4px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--success, #89D136);
  box-shadow: 0 0 0 2px #fff;
}
</style>