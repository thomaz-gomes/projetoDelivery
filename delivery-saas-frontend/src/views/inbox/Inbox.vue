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
import { ref, onMounted, onUnmounted } from 'vue';
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

  // Fetch initial data
  inboxStore.fetchConversations();
  inboxStore.fetchQuickReplies();

  // Socket.IO connection
  socket = io(SOCKET_URL, {
    transports: ['polling', 'websocket'],
    reconnectionAttempts: Infinity,
    reconnectionDelay: 2000,
    timeout: 30000,
  });

  socket.on('connect', () => {
    // Identify with auth token
    const token = authStore.token || localStorage.getItem('token');
    if (token) {
      socket.emit('identify', { token });
    }
  });

  socket.on('inbox:new-message', (payload) => {
    inboxStore.handleNewMessage(payload);
    if (payload.message && payload.message.direction === 'INBOUND') {
      playBeep();
      showNotification(payload.message);
    }
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
