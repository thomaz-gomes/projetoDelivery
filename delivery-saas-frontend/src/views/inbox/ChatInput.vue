<template>
  <div class="border-top bg-white p-2">
    <!-- File preview -->
    <div v-if="selectedFile" class="d-flex align-items-center gap-2 mb-2 p-2 bg-light rounded small">
      <i class="bi bi-file-earmark"></i>
      <span class="text-truncate">{{ selectedFile.name }}</span>
      <button class="btn btn-sm btn-close ms-auto" @click="clearFile"></button>
    </div>

    <!-- Quick reply shortcuts (one-click send) -->
    <div v-if="quickReplies.length" class="d-flex gap-1 mb-2 overflow-auto pb-1" style="scrollbar-width: thin;">
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

    <!-- Quick reply picker (when typing /) -->
    <QuickReplyPicker
      v-if="showQuickReplies"
      :filter="quickReplyFilter"
      @select="onQuickReplySelect"
    />

    <!-- Input row -->
    <div class="d-flex align-items-end gap-2">
      <!-- Attach -->
      <button class="btn btn-sm btn-light" @click="triggerFileInput" :disabled="sending">
        <i class="bi bi-paperclip" style="font-size: 1.2rem;"></i>
      </button>
      <input
        ref="fileInput"
        type="file"
        class="d-none"
        accept="image/*,.pdf,.doc,.docx"
        @change="onFileSelected"
      />

      <!-- Textarea -->
      <textarea
        ref="textareaRef"
        v-model="text"
        class="form-control form-control-sm"
        rows="1"
        placeholder="Digite uma mensagem..."
        style="max-height: 120px; resize: none;"
        @keydown="onKeydown"
        @input="autoResize"
      ></textarea>

      <!-- Send -->
      <button
        class="btn btn-sm btn-success"
        :disabled="(!text.trim() && !selectedFile) || sending"
        @click="send"
      >
        <i v-if="sending" class="bi bi-arrow-repeat spin"></i>
        <i v-else class="bi bi-send"></i>
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick } from 'vue';
import { useInboxStore } from '@/stores/inbox';
import QuickReplyPicker from './QuickReplyPicker.vue';

const props = defineProps({
  conversationId: { type: String, required: true },
});

const inboxStore = useInboxStore();
const text = ref('');
const selectedFile = ref(null);
const sending = ref(false);
const fileInput = ref(null);
const textareaRef = ref(null);

const showQuickReplies = computed(() => text.value.startsWith('/') && text.value.length > 0);
const quickReplyFilter = computed(() => text.value.slice(1));
const quickReplies = computed(() => inboxStore.quickReplies || []);

function triggerFileInput() {
  fileInput.value?.click();
}

function onFileSelected(e) {
  const f = e.target.files?.[0];
  if (f) selectedFile.value = f;
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
    const payload = {};
    if (selectedFile.value) {
      payload.type = selectedFile.value.type.startsWith('image/') ? 'IMAGE' : 'DOCUMENT';
      payload.mediaFile = selectedFile.value;
      if (body) payload.body = body;
    } else {
      payload.type = 'TEXT';
      payload.body = body;
    }
    await inboxStore.sendMessage(props.conversationId, payload);
    text.value = '';
    clearFile();
    nextTick(() => autoResize());
  } catch (err) {
    console.error('Failed to send message', err);
  } finally {
    sending.value = false;
  }
}

async function sendQuickReply(reply) {
  if (sending.value || !reply?.body) return;
  sending.value = true;
  try {
    await inboxStore.sendMessage(props.conversationId, {
      type: 'TEXT',
      body: reply.body,
    });
  } catch (err) {
    console.error('Failed to send quick reply', err);
  } finally {
    sending.value = false;
  }
}
</script>

<style scoped>
.spin {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
