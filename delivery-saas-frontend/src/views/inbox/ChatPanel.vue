<template>
  <div class="d-flex flex-column h-100">
    <!-- Header -->
    <ConversationHeader
      :conversation="inboxStore.activeConversation"
      @back="$emit('back')"
    />

    <!-- Messages area -->
    <div
      ref="messagesContainer"
      class="flex-grow-1 overflow-auto px-3 py-2"
      style="background: #efeae2;"
      @scroll="onScroll"
    >
      <!-- Loading older -->
      <div v-if="loadingOlder" class="text-center py-2">
        <div class="spinner-border spinner-border-sm text-secondary" role="status"></div>
      </div>

      <ChatBubble
        v-for="msg in inboxStore.activeMessages"
        :key="msg.id"
        :message="msg"
      />
    </div>

    <!-- Input -->
    <ChatInput
      :conversation-id="conversationId"
    />
  </div>
</template>

<script setup>
import { ref, watch, nextTick, onMounted } from 'vue';
import { useInboxStore } from '@/stores/inbox';
import ConversationHeader from './ConversationHeader.vue';
import ChatBubble from './ChatBubble.vue';
import ChatInput from './ChatInput.vue';

const props = defineProps({
  conversationId: { type: String, required: true },
});

defineEmits(['back']);

const inboxStore = useInboxStore();
const messagesContainer = ref(null);
const loadingOlder = ref(false);
let oldestCursor = null;
let noMoreOlder = false;

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
  if (messagesContainer.value.scrollTop < 50 && !loadingOlder.value && !noMoreOlder && oldestCursor) {
    loadingOlder.value = true;
    const prevHeight = messagesContainer.value.scrollHeight;
    try {
      const msgs = await inboxStore.fetchMessages(props.conversationId, oldestCursor);
      if (msgs.length > 0) {
        oldestCursor = msgs[0].id;
      }
      if (msgs.length < 50) noMoreOlder = true;
      await nextTick();
      // Maintain scroll position after prepending
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
    loadMessages();
  }
);

onMounted(() => {
  loadMessages();
});
</script>
