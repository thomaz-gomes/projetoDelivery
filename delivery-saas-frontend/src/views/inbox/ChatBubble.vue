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
      <!-- Quote preview -->
      <div v-if="quotedMessage" class="border-start border-3 border-secondary ps-2 mb-1 small text-muted" style="opacity: 0.85;">
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
