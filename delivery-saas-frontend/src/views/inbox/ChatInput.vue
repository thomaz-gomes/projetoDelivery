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
        :title="reply.body || reply.mediaFileName || reply.title"
        @click="sendQuickReply(reply)"
      >
        <i class="bi" :class="reply.mediaUrl ? 'bi-paperclip' : 'bi-lightning-charge'"></i>
        <span class="ms-1">{{ reply.title || reply.shortcut }}</span>
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
  // If the quick reply has media, send it directly (media can't be previewed in textarea)
  if (reply.mediaUrl) {
    text.value = '';
    nextTick(() => autoResize());
    sendQuickReply(reply);
    return;
  }
  // Text-only: fill the input so the operator can edit before sending
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
  if (sending.value || !reply?.id) return;
  sending.value = true;
  try {
    await inboxStore.sendQuickReplyById(props.conversationId, reply.id);
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
