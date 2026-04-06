<template>
  <div
    class="d-flex align-items-center px-3 py-2 border-bottom cursor-pointer"
    :class="{ 'bg-light': active }"
    style="cursor: pointer;"
    @click="$emit('click')"
  >
    <!-- Avatar -->
    <div
      class="rounded-circle bg-success text-white d-flex align-items-center justify-content-center flex-shrink-0 me-3"
      style="width: 44px; height: 44px; font-size: 0.9rem; font-weight: 600;"
    >
      {{ initials }}
    </div>

    <!-- Content -->
    <div class="flex-grow-1 min-width-0">
      <div class="d-flex justify-content-between align-items-center">
        <span class="fw-semibold text-truncate" style="max-width: 180px;">{{ displayName }}</span>
        <small class="text-muted flex-shrink-0 ms-2">{{ timeAgo }}</small>
      </div>
      <div class="d-flex justify-content-between align-items-center">
        <small class="text-muted text-truncate" style="max-width: 220px;">{{ lastMessagePreview }}</small>
        <span
          v-if="conversation.unreadCount"
          class="badge bg-success rounded-pill ms-2 flex-shrink-0"
        >
          {{ conversation.unreadCount }}
        </span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  conversation: { type: Object, required: true },
  active: { type: Boolean, default: false },
});

defineEmits(['click']);

const displayName = computed(() => {
  const c = props.conversation;
  return c.customer?.fullName || c.contactName || c.channelContactId || 'Desconhecido';
});

const initials = computed(() => {
  const name = displayName.value;
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (name[0] || '?').toUpperCase();
});

const lastMessagePreview = computed(() => {
  const msgs = props.conversation.messages;
  if (!msgs || !msgs.length) return '';
  const last = msgs[msgs.length - 1] || msgs[0];
  if (last.type === 'TEXT') return last.body || '';
  const typeLabels = {
    IMAGE: 'Imagem',
    AUDIO: 'Audio',
    VIDEO: 'Video',
    DOCUMENT: 'Documento',
    LOCATION: 'Localizacao',
    STICKER: 'Sticker',
  };
  return '\uD83D\uDCCE ' + (typeLabels[last.type] || last.type);
});

const timeAgo = computed(() => {
  const msgs = props.conversation.messages;
  const dateStr = props.conversation.lastMessageAt
    || (msgs && msgs.length ? (msgs[msgs.length - 1] || msgs[0]).createdAt : null);
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now - date;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'agora';
  if (diffMin < 60) return diffMin + 'm';
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return diffH + 'h';
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return dd + '/' + mm;
});
</script>
