<template>
  <div
    class="d-flex align-items-center p-2 border-bottom"
    :class="{ 'bg-light': selected }"
    style="cursor: pointer;"
    @click="$emit('click')"
  >
    <!-- Avatar -->
    <div
      class="rounded-circle d-flex align-items-center justify-content-center text-white fw-semibold flex-shrink-0"
      :style="{ width: '40px', height: '40px', backgroundColor: avatarColor, fontSize: '0.9rem' }"
    >
      {{ initials }}
    </div>

    <!-- Content -->
    <div class="flex-grow-1 ms-2 min-width-0">
      <div class="d-flex justify-content-between align-items-baseline">
        <span class="fw-semibold text-truncate small">{{ displayName }}</span>
        <small class="text-muted flex-shrink-0 ms-1" style="font-size: 0.7rem;">{{ timeAgo }}</small>
      </div>
      <div class="d-flex justify-content-between align-items-center">
        <small class="text-muted text-truncate">{{ preview }}</small>
        <span v-if="conversation.unreadCount > 0" class="badge bg-success rounded-pill ms-1">{{ conversation.unreadCount }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  conversation: { type: Object, required: true },
  selected: { type: Boolean, default: false },
});

defineEmits(['click']);

const AVATAR_COLORS = ['#3498db','#e74c3c','#2ecc71','#f39c12','#9b59b6','#1abc9c','#e67e22','#34495e','#16a085','#c0392b'];

const displayName = computed(() => {
  return props.conversation.customer?.fullName
    || props.conversation.contactName
    || props.conversation.channelContactId
    || 'Sem nome';
});

const initials = computed(() => {
  const name = displayName.value || '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
});

const avatarColor = computed(() => {
  const name = displayName.value;
  let hash = 0;
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
});

const preview = computed(() => {
  const lastMsg = props.conversation.messages?.[0];
  if (!lastMsg) return '';
  if (lastMsg.internal) return '🔒 ' + (lastMsg.body || 'Nota interna');
  switch (lastMsg.type) {
    case 'IMAGE': return '📷 Foto' + (lastMsg.body ? ': ' + lastMsg.body : '');
    case 'AUDIO': return '🎤 Áudio';
    case 'VIDEO': return '📹 Vídeo' + (lastMsg.body ? ': ' + lastMsg.body : '');
    case 'DOCUMENT': return '📎 ' + (lastMsg.mediaFileName || 'Documento');
    case 'LOCATION': return '📍 Localização';
    case 'STICKER': return 'Sticker';
    default: return lastMsg.body || '';
  }
});

const timeAgo = computed(() => {
  const d = props.conversation.lastMessageAt;
  if (!d) return '';
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'agora';
  if (m < 60) return m + 'm';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h';
  return new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
});
</script>
