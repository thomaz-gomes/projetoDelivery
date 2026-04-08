<template>
  <div
    class="d-flex flex-column h-100 position-relative"
    @dragover.prevent="onDragOver"
    @drop.prevent="onDrop"
    @dragleave="onDragLeave"
  >
    <!-- Header -->
    <ConversationHeader
      :conversation="inboxStore.activeConversation"
      @back="$emit('back')"
      @toggle-panel="$emit('toggle-panel')"
    />

    <!-- Drag overlay -->
    <div v-if="isDragging" class="drag-overlay">
      <div class="text-center">
        <i class="bi bi-cloud-upload" style="font-size: 3rem;"></i>
        <p class="mt-2">Solte o arquivo aqui</p>
      </div>
    </div>

    <!-- Messages area -->
    <div
      ref="messagesContainer"
      class="flex-grow-1 overflow-auto px-3 py-2"
      style="background: #efeae2;"
      @scroll="onScroll"
    >
      <!-- Loading older -->
      <div v-if="loadingOlder" class="text-center py-2 small text-muted">
        <div class="spinner-border spinner-border-sm me-1" role="status"></div>
        Carregando mensagens antigas...
      </div>
      <div v-else-if="noMoreMessages && inboxStore.activeMessages.length > 0" class="text-center py-2 small text-muted">
        <i class="bi bi-check-circle me-1"></i>Início da conversa
      </div>

      <template v-for="(item, idx) in groupedItems" :key="idx">
        <div v-if="item.type === 'separator'" class="text-center my-3">
          <span class="badge bg-light text-dark">{{ item.label }}</span>
        </div>
        <ChatBubble
          v-else
          :message="item.message"
          :all-messages="inboxStore.activeMessages"
          @reply="onReply"
          @open-image="openLightbox"
        />
      </template>
    </div>

    <!-- Input -->
    <ChatInput
      :conversation-id="conversationId"
    />

    <!-- Lightbox -->
    <ImageLightbox v-if="lightboxSrc" :src="lightboxSrc" @close="lightboxSrc = null" />
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted } from 'vue';
import { useInboxStore } from '@/stores/inbox';
import ConversationHeader from './ConversationHeader.vue';
import ChatBubble from './ChatBubble.vue';
import ChatInput from './ChatInput.vue';
import ImageLightbox from './ImageLightbox.vue';

const props = defineProps({
  conversationId: { type: String, required: true },
});

defineEmits(['back', 'toggle-panel']);

const inboxStore = useInboxStore();
const messagesContainer = ref(null);
const loadingOlder = ref(false);
const noMoreMessages = ref(false);
const isDragging = ref(false);
const lightboxSrc = ref(null);
let oldestCursor = null;
let noMoreOlder = false;

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
  for (const msg of inboxStore.activeMessages) {
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
  inboxStore.setReplyTo?.(messageId);
}

function openLightbox(src) {
  lightboxSrc.value = src;
}

function onDragOver(e) {
  if (e.dataTransfer?.types?.includes('Files')) {
    isDragging.value = true;
  }
}

function onDragLeave(e) {
  if (e.currentTarget && !e.currentTarget.contains(e.relatedTarget)) {
    isDragging.value = false;
  }
}

function onDrop(e) {
  isDragging.value = false;
  const file = e.dataTransfer?.files?.[0];
  if (file) {
    window.dispatchEvent(new CustomEvent('inbox-drop-file', { detail: file }));
  }
}

async function loadMessages() {
  if (!inboxStore.messages[props.conversationId]) {
    const msgs = await inboxStore.fetchMessages(props.conversationId);
    if (msgs.length > 0) {
      oldestCursor = msgs[0].id;
    }
    noMoreOlder = msgs.length < 50;
    await nextTick();
    scrollToBottom();
  } else {
    await nextTick();
    scrollToBottom();
  }
}

function scrollToBottom() {
  if (messagesContainer.value) {
    messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
  }
}

async function onScroll() {
  if (!messagesContainer.value) return;
  if (
    messagesContainer.value.scrollTop < 200 &&
    !loadingOlder.value &&
    !noMoreMessages.value &&
    !noMoreOlder &&
    oldestCursor
  ) {
    loadingOlder.value = true;
    const prevHeight = messagesContainer.value.scrollHeight;
    try {
      const msgs = await inboxStore.fetchMessages(props.conversationId, oldestCursor);
      if (!msgs || msgs.length === 0) {
        noMoreMessages.value = true;
        noMoreOlder = true;
      } else {
        oldestCursor = msgs[0].id;
        if (msgs.length < 50) {
          noMoreOlder = true;
          noMoreMessages.value = true;
        }
      }
      await nextTick();
      if (messagesContainer.value) {
        const newHeight = messagesContainer.value.scrollHeight;
        messagesContainer.value.scrollTop = newHeight - prevHeight;
      }
    } finally {
      loadingOlder.value = false;
    }
  }
}

// Watch for new messages to scroll down
watch(
  () => inboxStore.activeMessages.length,
  async () => {
    await nextTick();
    if (messagesContainer.value) {
      const el = messagesContainer.value;
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 150;
      if (nearBottom) scrollToBottom();
    }
  }
);

// Watch conversation change
watch(
  () => props.conversationId,
  () => {
    oldestCursor = null;
    noMoreOlder = false;
    noMoreMessages.value = false;
    loadMessages();
  }
);

onMounted(() => {
  loadMessages();
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
