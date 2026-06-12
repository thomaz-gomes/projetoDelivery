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
      class="chat-canvas flex-grow-1 overflow-auto px-3 py-3"
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
        <div v-if="item.type === 'separator'" class="chat-date-sep">
          <span class="chat-date-sep__pill">{{ String(item.label).toUpperCase() }}</span>
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

    <!-- Meta 24h-window banner -->
    <div v-if="metaWindow.show" class="alert alert-warning mb-0 rounded-0 d-flex align-items-center gap-2 py-2 px-3" role="alert">
      <i class="bi bi-exclamation-triangle-fill flex-shrink-0"></i>
      <div class="flex-grow-1 small">{{ metaWindow.message }}</div>
      <button class="btn btn-sm btn-warning text-nowrap" @click="onSendTemplate">
        <i class="bi bi-file-earmark-text me-1"></i>Enviar template
      </button>
    </div>

    <!-- Input -->
    <ChatInput
      :conversation-id="conversationId"
      :disabled="metaWindow.show"
    />

    <!-- Lightbox -->
    <ImageLightbox v-if="lightboxSrc" :src="lightboxSrc" @close="lightboxSrc = null" />

    <!-- Template picker modal — reabre janela 24h da Meta -->
    <div v-if="templateModal.open" class="tpl-modal-backdrop" @click.self="closeTemplateModal">
      <div class="tpl-modal-card">
        <div class="tpl-modal-head">
          <h6 class="mb-0">
            <i class="bi bi-file-earmark-text me-1 text-info"></i>
            Enviar template aprovado
          </h6>
          <button class="btn-close" @click="closeTemplateModal"></button>
        </div>
        <div class="tpl-modal-body">
          <div v-if="templateModal.loading" class="text-center py-4">
            <div class="spinner-border text-primary"></div>
          </div>
          <div v-else-if="templateModal.error" class="alert alert-danger">
            {{ templateModal.error }}
          </div>
          <div v-else-if="!templateModal.list.length" class="alert alert-warning">
            Nenhum template aprovado encontrado.
            <router-link to="/settings/whatsapp-templates/new">Criar um agora →</router-link>
          </div>
          <template v-else>
            <div class="mb-3">
              <label class="form-label small fw-semibold">Template</label>
              <select v-model="templateModal.selectedId" class="form-select" @change="onTemplateChange">
                <option value="">Selecione um template...</option>
                <option v-for="t in templateModal.list" :key="t.id" :value="t.id">
                  {{ t.name }} <span v-if="t.language"> · {{ t.language }}</span>
                </option>
              </select>
            </div>
            <div v-if="selectedTemplate" class="mb-3">
              <div class="border rounded p-2 mb-2" style="background:#f6f8fa">
                <div class="small text-muted mb-1">Pré-visualização:</div>
                <div style="white-space:pre-wrap;font-size:0.92rem">{{ previewText }}</div>
              </div>
              <div v-if="templateModal.varCount > 0">
                <label class="form-label small fw-semibold">Variáveis</label>
                <div v-for="n in templateModal.varCount" :key="n" class="mb-2">
                  <div class="input-group input-group-sm">
                    <span class="input-group-text"><code v-text="'{{' + n + '}}'"></code></span>
                    <input
                      v-model="templateModal.values[n]"
                      class="form-control"
                      :placeholder="`Valor para a variável ${n}`"
                      @input="recalcPreview"
                    />
                  </div>
                </div>
              </div>
              <div v-else class="small text-muted fst-italic">Este template não tem variáveis.</div>
            </div>
          </template>
        </div>
        <div class="tpl-modal-foot">
          <button class="btn btn-outline-secondary" @click="closeTemplateModal" :disabled="templateModal.sending">
            Cancelar
          </button>
          <button class="btn btn-primary" @click="submitTemplate"
                  :disabled="!canSubmitTemplate || templateModal.sending">
            <span v-if="templateModal.sending" class="spinner-border spinner-border-sm me-1"></span>
            <i v-else class="bi bi-send me-1"></i>
            Enviar
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted } from 'vue';
import Swal from 'sweetalert2';
import { useInboxStore } from '@/stores/inbox';
import api from '@/api';
import ConversationHeader from './ConversationHeader.vue';
import ChatBubble from './ChatBubble.vue';
import ChatInput from './ChatInput.vue';
import ImageLightbox from './ImageLightbox.vue';

const META_PROVIDERS = ['META_WA', 'META_FB', 'META_IG'];
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

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

// Meta 24h-window detection — for META_WA / META_FB / META_IG conversations
// Meta only allows free-form replies within 24h of the last inbound message.
// Outside that window, the operator must send an approved template.
const metaWindow = computed(() => {
  const conv = inboxStore.activeConversation;
  if (!conv) return { show: false, message: '' };
  if (!META_PROVIDERS.includes(conv.provider)) return { show: false, message: '' };

  const lastInboundAt = conv.lastInboundAt ? new Date(conv.lastInboundAt).getTime() : null;
  if (!lastInboundAt) {
    return {
      show: true,
      message: 'Aguardando primeira mensagem do cliente — Meta exige inbound antes de iniciar conversa.',
    };
  }
  const ageMs = Date.now() - lastInboundAt;
  if (ageMs > TWENTY_FOUR_HOURS_MS) {
    return {
      show: true,
      message: 'Janela de 24h expirada — Meta restringe envio livre. Use template aprovado.',
    };
  }
  return { show: false, message: '' };
});

// ─── Template picker (reabre janela 24h da Meta) ───────────────────────────
const templateModal = ref({
  open: false,
  loading: false,
  sending: false,
  error: '',
  list: [],
  selectedId: '',
  varCount: 0,
  values: {}, // { 1: 'Maria', 2: '#77' }
});
const previewText = ref('');

const selectedTemplate = computed(() => {
  return templateModal.value.list.find(t => t.id === templateModal.value.selectedId) || null;
});

function templateBodyText(t) {
  if (!t || !Array.isArray(t.components)) return '';
  const body = t.components.find(c => (c.type || '').toUpperCase() === 'BODY');
  return body?.text || '';
}

function countVars(text) {
  const matches = (text || '').match(/\{\{(\d+)\}\}/g) || [];
  return new Set(matches.map(m => Number(m.replace(/[{}]/g, '')))).size;
}

function recalcPreview() {
  const body = templateBodyText(selectedTemplate.value);
  previewText.value = body.replace(/\{\{(\d+)\}\}/g, (_, n) => {
    const v = templateModal.value.values[n];
    return v ? String(v) : `{{${n}}}`;
  });
}

function onTemplateChange() {
  const body = templateBodyText(selectedTemplate.value);
  templateModal.value.varCount = countVars(body);
  templateModal.value.values = {};
  recalcPreview();
}

const canSubmitTemplate = computed(() => {
  const m = templateModal.value;
  if (!m.selectedId) return false;
  for (let i = 1; i <= m.varCount; i++) {
    if (!m.values[i] || !String(m.values[i]).trim()) return false;
  }
  return true;
});

async function onSendTemplate() {
  templateModal.value.open = true;
  templateModal.value.loading = true;
  templateModal.value.error = '';
  templateModal.value.selectedId = '';
  templateModal.value.varCount = 0;
  templateModal.value.values = {};
  previewText.value = '';
  try {
    const { data } = await api.get('/meta/templates', { params: { status: 'APPROVED' } });
    templateModal.value.list = Array.isArray(data) ? data : [];
  } catch (e) {
    templateModal.value.error = e?.response?.data?.message || 'Falha ao carregar templates';
  } finally {
    templateModal.value.loading = false;
  }
}

function closeTemplateModal() {
  if (templateModal.value.sending) return;
  templateModal.value.open = false;
}

async function submitTemplate() {
  if (!canSubmitTemplate.value) return;
  templateModal.value.sending = true;
  try {
    await api.post(`/inbox/conversations/${props.conversationId}/send-template`, {
      templateId: templateModal.value.selectedId,
      variables: { ...templateModal.value.values },
    });
    templateModal.value.open = false;
    Swal.fire({
      icon: 'success',
      title: 'Template enviado',
      text: 'Quando o cliente responder, a janela de 24h reabre e você poderá enviar mensagens livres.',
      timer: 3500,
      showConfirmButton: false,
    });
  } catch (e) {
    Swal.fire({
      icon: 'error',
      title: 'Falha ao enviar',
      text: e?.response?.data?.message || 'Erro inesperado',
    });
  } finally {
    templateModal.value.sending = false;
  }
}

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
.chat-canvas {
  background: #ece4da;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.chat-date-sep {
  display: flex;
  justify-content: center;
  margin: 2px 0 6px;
}
.chat-date-sep__pill {
  background: rgba(255, 255, 255, 0.85);
  color: #5a6373;
  font-size: 0.72rem;
  font-weight: 600;
  padding: 4px 14px;
  border-radius: 10px;
  letter-spacing: 0.4px;
}

.drag-overlay {
  position: absolute;
  top: 62px;
  left: 0;
  right: 0;
  bottom: 80px;
  background: rgba(137, 209, 54, 0.10);
  border: 3px dashed var(--success, #89D136);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  pointer-events: none;
  color: #6dae1e;
}

.tpl-modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1080;
  padding: 1rem;
}
.tpl-modal-card {
  background: #fff;
  border-radius: 12px;
  width: 100%;
  max-width: 540px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 12px 32px rgba(0,0,0,0.25);
}
.tpl-modal-head {
  padding: 1rem 1.25rem;
  border-bottom: 1px solid #eef0f3;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.tpl-modal-body {
  padding: 1.25rem;
  overflow-y: auto;
  flex: 1 1 auto;
}
.tpl-modal-foot {
  padding: 0.75rem 1.25rem;
  border-top: 1px solid #eef0f3;
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}
</style>
