<template>
  <div
    class="d-flex mb-2"
    :class="isOutbound ? 'justify-content-end' : 'justify-content-start'"
  >
    <div
      class="rounded-3 px-3 py-2 position-relative"
      :class="isOutbound ? 'bg-success-subtle' : 'bg-white'"
      style="max-width: 75%; min-width: 80px; word-wrap: break-word;"
    >
      <!-- TEXT -->
      <div v-if="message.type === 'TEXT'" style="white-space: pre-wrap;">{{ message.body }}</div>

      <!-- IMAGE -->
      <div v-else-if="message.type === 'IMAGE'">
        <img
          :src="message.mediaUrl"
          class="img-fluid rounded cursor-pointer"
          style="max-height: 300px; cursor: pointer;"
          @click="openMedia(message.mediaUrl)"
        />
        <div v-if="message.body" class="mt-1 small" style="white-space: pre-wrap;">{{ message.body }}</div>
      </div>

      <!-- AUDIO -->
      <div v-else-if="message.type === 'AUDIO'">
        <AudioPlayer :src="message.mediaUrl" />
      </div>

      <!-- VIDEO -->
      <div v-else-if="message.type === 'VIDEO'">
        <video
          :src="message.mediaUrl"
          controls
          class="rounded"
          style="max-width: 100%; max-height: 300px;"
        ></video>
        <div v-if="message.body" class="mt-1 small" style="white-space: pre-wrap;">{{ message.body }}</div>
      </div>

      <!-- DOCUMENT -->
      <div v-else-if="message.type === 'DOCUMENT'">
        <a :href="message.mediaUrl" target="_blank" class="text-decoration-none">
          <i class="bi bi-file-earmark me-1"></i>
          {{ message.body || 'Documento' }}
        </a>
      </div>

      <!-- LOCATION -->
      <div v-else-if="message.type === 'LOCATION'">
        <a
          :href="`https://maps.google.com/?q=${message.latitude},${message.longitude}`"
          target="_blank"
          class="text-decoration-none"
        >
          <i class="bi bi-geo-alt me-1"></i> Ver no mapa
        </a>
      </div>

      <!-- STICKER -->
      <div v-else-if="message.type === 'STICKER'">
        <img
          :src="message.mediaUrl"
          style="max-width: 150px; max-height: 150px;"
        />
      </div>

      <!-- Fallback -->
      <div v-else>
        <span class="text-muted small">{{ message.type }}</span>
        <span v-if="message.body"> - {{ message.body }}</span>
      </div>

      <!-- Time + status -->
      <div class="d-flex align-items-center justify-content-end gap-1 mt-1">
        <small class="text-muted" style="font-size: 0.7rem;">{{ formattedTime }}</small>
        <i v-if="isOutbound" class="bi" :class="statusIcon" style="font-size: 0.7rem;"></i>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import AudioPlayer from './AudioPlayer.vue';

const props = defineProps({
  message: { type: Object, required: true },
});

const isOutbound = computed(() => props.message.direction === 'OUTBOUND');

const formattedTime = computed(() => {
  const d = new Date(props.message.createdAt);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return hh + ':' + mm;
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

function openMedia(url) {
  window.open(url, '_blank');
}
</script>
