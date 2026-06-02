<template>
  <button
    type="button"
    class="conv-row"
    :class="{ 'conv-row--active': selected, 'conv-row--unread': conversation.unreadCount > 0 }"
    @click="$emit('click')"
  >
    <!-- Avatar with channel badge overlay -->
    <div class="conv-row__avatar-wrap">
      <div
        class="conv-row__avatar"
        :style="{ backgroundColor: avatarColor }"
      >
        {{ initials }}
      </div>
      <ChannelBadge
        v-if="conversation.channel"
        :channel="conversation.channel"
        :provider="conversation.provider"
        class="conv-row__channel"
      />
    </div>

    <!-- Content -->
    <div class="conv-row__body">
      <div class="conv-row__top">
        <span class="conv-row__name">{{ displayName }}</span>
        <span class="conv-row__time">{{ timeAgo }}</span>
      </div>
      <div v-if="phoneDisplay" class="conv-row__phone">{{ phoneDisplay }}</div>
      <div class="conv-row__bottom">
        <span class="conv-row__preview">{{ preview }}</span>
        <span v-if="conversation.unreadCount > 0" class="conv-row__badge">{{ conversation.unreadCount }}</span>
      </div>
    </div>
  </button>
</template>

<script setup>
import { computed } from 'vue';
import ChannelBadge from '@/components/inbox/ChannelBadge.vue';

const props = defineProps({
  conversation: { type: Object, required: true },
  selected: { type: Boolean, default: false },
});

defineEmits(['click']);

const AVATAR_COLORS = ['#3498db','#e74c3c','#2ecc71','#f39c12','#9b59b6','#1abc9c','#e67e22','#34495e','#16a085','#c0392b'];

const displayName = computed(() => {
  return props.conversation.customer?.fullName
    || props.conversation.contactName
    || 'Não identificado';
});

const phoneDisplay = computed(() => {
  const phone = props.conversation.channelContactId || '';
  if (!phone) return '';
  if (displayName.value === phone) return '';
  return phone.startsWith('55') ? phone.slice(2) : phone;
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

<style scoped>
.conv-row {
  display: flex;
  align-items: center;
  gap: 11px;
  width: 100%;
  padding: 11px 16px;
  text-align: left;
  background: transparent;
  border: none;
  border-left: 3px solid transparent;
  border-bottom: 1px solid #f0f2f5;
  cursor: pointer;
  transition: background .1s;
}
.conv-row:hover { background: #f6f7f9; }
.conv-row:active { background: #eef0f3; }

.conv-row--active {
  background: rgba(137, 209, 54, 0.10);
  border-left-color: var(--success, #89D136);
}
.conv-row--active:hover { background: rgba(137, 209, 54, 0.14); }

.conv-row__avatar-wrap {
  position: relative;
  flex-shrink: 0;
}
.conv-row__avatar {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-weight: 700;
  font-size: 0.95rem;
}
.conv-row__channel {
  position: absolute;
  bottom: -1px;
  right: -1px;
  width: 18px;
  height: 18px;
  border: 2px solid #fff;
  box-sizing: content-box;
}
.conv-row__channel :deep(i) { font-size: 0.6rem; }

.conv-row__body {
  flex: 1;
  min-width: 0;
}
.conv-row__top {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.conv-row__name {
  font-weight: 600;
  font-size: 0.91rem;
  color: #1d2330;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.conv-row--unread .conv-row__name { font-weight: 700; }

.conv-row__time {
  font-size: 0.72rem;
  color: #929aa8;
  margin-left: auto;
  flex-shrink: 0;
}
.conv-row__phone {
  font-size: 0.72rem;
  color: #929aa8;
  margin: 1px 0 3px;
  line-height: 1.1;
}
.conv-row__bottom {
  display: flex;
  align-items: center;
  gap: 8px;
}
.conv-row__preview {
  flex: 1;
  min-width: 0;
  font-size: 0.81rem;
  color: #5a6373;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.conv-row--unread .conv-row__preview {
  color: #1d2330;
  font-weight: 600;
}
.conv-row__badge {
  flex-shrink: 0;
  background: var(--success, #89D136);
  color: #fff;
  font-size: 0.7rem;
  font-weight: 700;
  min-width: 18px;
  height: 18px;
  border-radius: 9px;
  padding: 0 5px;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
}
</style>
