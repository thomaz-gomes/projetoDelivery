<template>
  <div class="d-flex" style="height: calc(100vh - 56px); overflow: hidden;">
    <!-- List panel: 360px wide, hide on mobile when chat is active -->
    <div
      class="border-end bg-white d-flex flex-column"
      :class="{ 'd-none d-md-flex': inboxStore.activeConversationId }"
      style="width: 360px; min-width: 300px; flex-shrink: 0;"
    >
      <ConversationList @select="selectConversation" />
    </div>
    <!-- Chat panel: shown when conversation selected -->
    <div class="flex-grow-1 d-flex flex-column" v-if="inboxStore.activeConversationId">
      <ChatPanel
        :conversation-id="inboxStore.activeConversationId"
        @back="inboxStore.activeConversationId = null"
        @toggle-panel="showContactPanel = !showContactPanel"
      />
    </div>
    <!-- Empty state on desktop -->
    <div
      v-else
      class="flex-grow-1 d-none d-md-flex align-items-center justify-content-center text-muted"
    >
      <div class="text-center">
        <i class="bi bi-chat-left-dots" style="font-size: 3rem;"></i>
        <p class="mt-2">Selecione uma conversa</p>
      </div>
    </div>

    <!-- Contact panel (right side) -->
    <div
      v-if="inboxStore.activeConversationId && showContactPanel"
      class="border-start d-none d-md-flex flex-column"
      style="width: 350px; min-width: 320px; flex-shrink: 0;"
    >
      <ContactPanel :conversation-id="inboxStore.activeConversationId" />
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, watch } from 'vue';
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

let socket = null;
let beepAudio = null;

async function selectConversation(conversationId) {
  inboxStore.activeConversationId = conversationId;
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
</style>