<template>
  <div class="chat-input" :class="{ 'chat-input--internal': inboxStore.internalMode }">
    <!-- Reply preview -->
    <div v-if="replyToMessage" class="chat-input__reply">
      <div class="flex-grow-1 small">
        <div class="fw-semibold" style="font-size: 0.7rem;">Respondendo a {{ replyAuthorLabel }}</div>
        <div class="text-truncate text-muted">{{ replyPreview }}</div>
      </div>
      <button class="btn btn-sm btn-close" @click="clearReply"></button>
    </div>

    <!-- File preview -->
    <div v-if="selectedFile" class="chat-input__file">
      <i class="bi bi-file-earmark"></i>
      <span class="text-truncate">{{ selectedFile.name }}</span>
      <span v-if="compressing" class="text-muted">(comprimindo...)</span>
      <button class="btn btn-sm btn-close ms-auto" @click="clearFile"></button>
    </div>

    <!-- Quick reply chips row (filtradas pelo cardapio da conversa) -->
    <div
      v-if="visibleQuickReplies.length && !inboxStore.internalMode && !disabled"
      class="chat-input__qreplies qreplies"
    >
      <button
        v-for="reply in visibleQuickReplies"
        :key="reply.id"
        class="qchip"
        :disabled="sending"
        :title="reply.body || reply.mediaFileName || reply.title"
        @click="sendQuickReply(reply)"
      >
        <i class="bi" :class="reply.mediaUrl ? 'bi-paperclip qchip__icon--accent' : 'bi-lightning-charge-fill qchip__icon--accent'"></i>
        <span>{{ reply.title || reply.shortcut }}</span>
      </button>
    </div>

    <!-- Quick reply picker (typing /) -->
    <QuickReplyPicker v-if="showQuickReplies" :filter="quickReplyFilter" :replies="visibleQuickReplies" @select="onQuickReplySelect" />

    <!-- Input row -->
    <div class="chat-input__row">
      <!-- Internal mode toggle -->
      <button
        class="chat-input__icon-btn"
        :class="{ 'chat-input__icon-btn--active-warn': inboxStore.internalMode }"
        :title="inboxStore.internalMode ? 'Modo nota interna ativo' : 'Ativar nota interna'"
        :disabled="disabled"
        @click="inboxStore.toggleInternalMode()"
      >
        <i class="bi bi-lock-fill"></i>
      </button>

      <!-- Attach -->
      <button
        class="chat-input__icon-btn"
        :disabled="disabled || sending || inboxStore.internalMode"
        title="Anexar arquivo"
        @click="triggerFileInput"
      >
        <i class="bi bi-paperclip"></i>
      </button>
      <input ref="fileInput" type="file" class="d-none" accept="image/*,.pdf,.doc,.docx" @change="onFileSelected" />

      <!-- Pill textarea -->
      <div class="chat-input__pill">
        <textarea
          ref="textareaRef"
          v-model="text"
          rows="1"
          :placeholder="disabled ? 'Envio livre indisponível para esta conversa' : (inboxStore.internalMode ? 'Escrever nota interna (não enviada ao cliente)…' : 'Digite uma mensagem…')"
          :disabled="disabled"
          @keydown="onKeydown"
          @input="autoResize"
          @paste="onPaste"
        ></textarea>
      </div>

      <!-- Send (circular) -->
      <button
        class="chat-input__send"
        :class="{ 'chat-input__send--warn': inboxStore.internalMode }"
        :disabled="disabled || (!text.trim() && !selectedFile) || sending"
        :title="inboxStore.internalMode ? 'Salvar nota interna' : 'Enviar mensagem'"
        @click="send"
      >
        <i v-if="sending" class="bi bi-arrow-repeat spin"></i>
        <i v-else class="bi" :class="inboxStore.internalMode ? 'bi-lock-fill' : 'bi-send-fill'"></i>
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue';
import { useInboxStore } from '@/stores/inbox';
import { compressImage } from '@/utils/compressImage';
import Swal from 'sweetalert2';
import QuickReplyPicker from './QuickReplyPicker.vue';

const props = defineProps({
  conversationId: { type: String, required: true },
  disabled: { type: Boolean, default: false },
});

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

const visibleQuickReplies = computed(() => {
  const conv = inboxStore.activeConversation;
  const menuId = conv?.menuId || conv?.menu?.id || null;
  return quickReplies.value.filter((r) => {
    const scoped = Array.isArray(r.menus) && r.menus.length > 0;
    if (!scoped) return true;
    if (!menuId) return false;
    return r.menus.some((m) => m.id === menuId);
  });
});

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
  if (reply.mediaUrl) {
    text.value = '';
    nextTick(() => autoResize());
    sendQuickReply(reply);
    return;
  }
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
  if (props.disabled) return;
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
    const detail = err?.response?.data?.message
      || err?.message
      || 'Não foi possível enviar a mensagem.';
    Swal.fire({
      icon: 'error',
      title: 'Falha ao enviar',
      text: detail,
      confirmButtonText: 'OK',
    });
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

function onDropFile(e) {
  if (e.detail) setFile(e.detail);
}

onMounted(() => window.addEventListener('inbox-drop-file', onDropFile));
onUnmounted(() => window.removeEventListener('inbox-drop-file', onDropFile));
</script>

<style scoped>
.chat-input {
  background: #fff;
  border-top: 1px solid #e9ecf1;
  padding: 0 0 10px;
  flex-shrink: 0;
}
.chat-input--internal { background: #fff8e1; }

.chat-input__reply,
.chat-input__file {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  margin: 8px 18px 0;
  background: #f4f5f7;
  border-radius: 8px;
  border-left: 3px solid var(--primary, #105784);
}
.chat-input__file { border-left-color: #929aa8; }

/* ── Quick replies row (horizontal scroll with slim visible scrollbar) ── */
.chat-input__qreplies {
  display: flex;
  flex-wrap: nowrap;
  gap: 8px;
  padding: 10px 18px 8px;
  overflow-x: auto;
  scrollbar-width: thin;
  scrollbar-color: #cfd5dd transparent;
}
.chat-input__qreplies::-webkit-scrollbar { height: 6px; }
.chat-input__qreplies::-webkit-scrollbar-thumb {
  background: #cfd5dd;
  border-radius: 3px;
}

.qchip {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 13px;
  border: 1px solid #e9ecf1;
  border-radius: 17px;
  background: #fff;
  color: #3a4150;
  font-size: 0.8rem;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
  transition: background .1s;
}
.qchip:hover { background: #f3f5f7; }
.qchip:disabled { opacity: 0.5; cursor: default; }
.qchip__icon--accent { color: #f3a712; font-size: 0.85rem; }

/* ── Input row ── */
.chat-input__row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 18px 0;
}

.chat-input__icon-btn {
  width: 40px;
  height: 40px;
  border: none;
  background: transparent;
  border-radius: 10px;
  color: #5a6373;
  font-size: 1.1rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: background .12s;
}
.chat-input__icon-btn:hover:not(:disabled) { background: #f0f2f5; }
.chat-input__icon-btn:disabled { opacity: 0.5; cursor: default; }
.chat-input__icon-btn--active-warn {
  background: #fff3c2;
  color: #b6850b;
}

.chat-input__pill {
  flex: 1;
  display: flex;
  align-items: center;
  min-height: 44px;
  padding: 8px 16px;
  background: #f4f5f7;
  border-radius: 22px;
}
.chat-input__pill textarea {
  flex: 1;
  border: none;
  background: transparent;
  outline: none;
  resize: none;
  font-family: inherit;
  font-size: 0.94rem;
  color: #1d2330;
  line-height: 1.4;
  max-height: 120px;
  padding: 0;
}
.chat-input__pill textarea::placeholder { color: #929aa8; }
.chat-input--internal .chat-input__pill { background: #fff3c2; }

.chat-input__send {
  width: 46px;
  height: 46px;
  border-radius: 50%;
  border: none;
  cursor: pointer;
  background: var(--success, #89D136);
  color: #fff;
  font-size: 1.15rem;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  box-shadow: 0 2px 6px rgba(109, 174, 30, 0.35);
  transition: background .12s, transform .08s;
}
.chat-input__send:hover:not(:disabled) { background: var(--success-dark, #6DAE1E); }
.chat-input__send:active:not(:disabled) { transform: scale(0.96); }
.chat-input__send:disabled {
  background: #cfd5dd;
  box-shadow: none;
  cursor: default;
}
.chat-input__send--warn {
  background: #f3a712;
  box-shadow: 0 2px 6px rgba(243, 167, 18, 0.35);
}
.chat-input__send--warn:hover:not(:disabled) { background: #d28e08; }

.spin { animation: spin 1s linear infinite; }
@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
</style>
