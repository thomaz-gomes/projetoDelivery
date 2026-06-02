<template>
  <div class="conv-header">
    <!-- Back button (mobile) -->
    <button class="conv-header__back d-md-none" @click="$emit('back')" title="Voltar">
      <i class="bi bi-arrow-left"></i>
    </button>

    <!-- Avatar -->
    <div class="conv-header__avatar-wrap">
      <div class="conv-header__avatar" :style="{ backgroundColor: avatarColor }">{{ initials }}</div>
      <ChannelBadge
        v-if="conversation?.channel"
        :channel="conversation.channel"
        :provider="conversation.provider"
        class="conv-header__channel"
      />
    </div>

    <!-- Contact info -->
    <div class="conv-header__body">
      <div class="conv-header__top">
        <span class="conv-header__name">{{ displayName }}</span>
      </div>
      <div class="conv-header__sub">
        <TagChips
          v-if="conversation"
          :conversation-id="conversation.id"
          :tags="conversation.tags || []"
        />
        <span v-if="phoneDisplay" class="conv-header__phone">· {{ phoneDisplay }}</span>
      </div>
    </div>

    <!-- Menu / Store badge -->
    <span v-if="conversation?.menu?.name || conversation?.store?.name" class="conv-header__menu-badge">
      {{ conversation.menu?.name || conversation.store?.name }}
    </span>
    <span v-if="conversation?.assignedUser?.name" class="conv-header__user-badge">
      <i class="bi bi-person-fill"></i>{{ conversation.assignedUser.name }}
    </span>

    <!-- Actions -->
    <button class="conv-header__icon-btn" title="Painel de contato" @click="$emit('toggle-panel')">
      <i class="bi bi-layout-sidebar-reverse"></i>
    </button>
    <button class="conv-header__icon-btn" title="Atribuir" @click="showAssignUser = true">
      <i class="bi bi-person-check"></i>
    </button>
    <button
      v-if="conversation?.status === 'OPEN'"
      class="conv-header__icon-btn conv-header__icon-btn--danger"
      title="Fechar conversa"
      @click="toggleStatus"
    >
      <i class="bi bi-x-lg"></i>
    </button>
    <button
      v-else-if="conversation?.status === 'CLOSED'"
      class="conv-header__icon-btn conv-header__icon-btn--success"
      title="Reabrir conversa"
      @click="toggleStatus"
    >
      <i class="bi bi-arrow-counterclockwise"></i>
    </button>

    <!-- Modals -->
    <AssignUserModal
      v-if="showAssignUser"
      :conversation="conversation"
      @close="showAssignUser = false"
    />
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { useInboxStore } from '@/stores/inbox';
import AssignUserModal from './AssignUserModal.vue';
import TagChips from './TagChips.vue';
import ChannelBadge from '@/components/inbox/ChannelBadge.vue';

const props = defineProps({
  conversation: { type: Object, default: null },
});

defineEmits(['back', 'toggle-panel']);

const inboxStore = useInboxStore();
const showAssignUser = ref(false);

const AVATAR_COLORS = ['#3498db','#e74c3c','#2ecc71','#f39c12','#9b59b6','#1abc9c','#e67e22','#34495e','#16a085','#c0392b'];

const displayName = computed(() => {
  const c = props.conversation;
  if (!c) return '';
  return c.customer?.fullName || c.contactName || 'Não identificado';
});

const phoneDisplay = computed(() => {
  const phone = props.conversation?.channelContactId || '';
  if (!phone || phone === displayName.value) return '';
  return phone.startsWith('55') ? phone.slice(2) : phone;
});

const initials = computed(() => {
  const name = displayName.value || '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
});

const avatarColor = computed(() => {
  const name = displayName.value || '?';
  let hash = 0;
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
});

async function toggleStatus() {
  if (!props.conversation) return;
  const newStatus = props.conversation.status === 'OPEN' ? 'CLOSED' : 'OPEN';
  try {
    await inboxStore.updateConversation(props.conversation.id, { status: newStatus });
  } catch (err) {
    console.error('Failed to update conversation status', err);
  }
}
</script>

<style scoped>
.conv-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 18px;
  background: #fff;
  border-bottom: 1px solid #e9ecf1;
  min-height: 62px;
  flex-shrink: 0;
}

.conv-header__back {
  width: 38px;
  height: 38px;
  border: none;
  background: #f4f5f7;
  border-radius: 10px;
  color: #5a6373;
  font-size: 1.1rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.conv-header__back:hover { background: #e9ecf1; }

.conv-header__avatar-wrap {
  position: relative;
  flex-shrink: 0;
}
.conv-header__avatar {
  width: 42px;
  height: 42px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-weight: 700;
  font-size: 0.95rem;
}
.conv-header__channel {
  position: absolute;
  bottom: -1px;
  right: -1px;
  width: 17px;
  height: 17px;
  border: 2px solid #fff;
  box-sizing: content-box;
}

.conv-header__body {
  flex: 1;
  min-width: 0;
}
.conv-header__top {
  display: flex;
  align-items: center;
  gap: 6px;
}
.conv-header__name {
  font-weight: 700;
  font-size: 1rem;
  color: #1d2330;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.conv-header__sub {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 2px;
  font-size: 0.75rem;
  color: #929aa8;
}
.conv-header__phone { white-space: nowrap; }

.conv-header__menu-badge {
  display: inline-flex;
  align-items: center;
  height: 30px;
  padding: 0 13px;
  border-radius: 15px;
  background: rgba(43, 111, 224, 0.10);
  color: #2b6fe0;
  font-size: 0.78rem;
  font-weight: 700;
  white-space: nowrap;
  flex-shrink: 0;
}
.conv-header__user-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 30px;
  padding: 0 12px;
  border-radius: 15px;
  background: #f4f5f7;
  color: #5a6373;
  font-size: 0.78rem;
  font-weight: 600;
  white-space: nowrap;
  flex-shrink: 0;
}

.conv-header__icon-btn {
  width: 38px;
  height: 38px;
  border: none;
  background: #f4f5f7;
  border-radius: 10px;
  color: #5a6373;
  font-size: 1rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: background .12s;
}
.conv-header__icon-btn:hover { background: #e9ecf1; }
.conv-header__icon-btn--danger {
  background: #fdecec;
  color: #e23b3b;
}
.conv-header__icon-btn--danger:hover { background: #f9d8d8; }
.conv-header__icon-btn--success {
  background: rgba(137, 209, 54, 0.16);
  color: #6dae1e;
}
.conv-header__icon-btn--success:hover { background: rgba(137, 209, 54, 0.24); }

@media (max-width: 768px) {
  .conv-header { padding: 8px 12px; gap: 8px; }
  .conv-header__menu-badge,
  .conv-header__user-badge { display: none; }
}
</style>
