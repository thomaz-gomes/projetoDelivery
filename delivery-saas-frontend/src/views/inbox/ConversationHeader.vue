<template>
  <div class="d-flex align-items-center px-3 py-2 border-bottom bg-white" style="min-height: 56px;">
    <!-- Back button (mobile) -->
    <button class="btn btn-sm btn-light me-2 d-md-none" @click="$emit('back')">
      <i class="bi bi-arrow-left"></i>
    </button>

    <!-- Contact info -->
    <div class="flex-grow-1 min-width-0">
      <div class="d-flex align-items-center gap-1">
        <span class="fw-semibold text-truncate">{{ displayName }}</span>
        <i class="bi bi-whatsapp text-success" style="font-size: 0.85rem;"></i>
      </div>
      
      <TagChips
        v-if="conversation"
        :conversation-id="conversation.id"
        :tags="conversation.tags || []"
      />
    </div>

    <!-- Badges -->
    <div class="d-flex align-items-center gap-2 me-2">
      <span v-if="conversation?.store?.name" class="badge bg-info-subtle text-info small">
        {{ conversation.store.name }}
      </span>
      <span v-if="conversation?.assignedUser?.name" class="badge bg-secondary-subtle text-secondary small">
        <i class="bi bi-person-fill me-1"></i>{{ conversation.assignedUser.name }}
      </span>
    </div>

    <!-- Actions -->
    <div class="d-flex align-items-center gap-1">
      <!-- Toggle Contact Panel -->
      <button
        class="btn btn-sm btn-outline-secondary"
        title="Painel de contato"
        @click="$emit('toggle-panel')"
      >
        <i class="bi bi-layout-sidebar-reverse"></i>
      </button>

      <!-- Assign -->
      <button
        class="btn btn-sm btn-outline-secondary"
        title="Atribuir"
        @click="showAssignUser = true"
      >
        <i class="bi bi-person-check"></i>
      </button>

      <!-- Close / Reopen -->
      <button
        v-if="conversation?.status === 'OPEN'"
        class="btn btn-sm btn-outline-danger"
        title="Fechar conversa"
        @click="toggleStatus"
      >
        <i class="bi bi-x-circle"></i>
      </button>
      <button
        v-else-if="conversation?.status === 'CLOSED'"
        class="btn btn-sm btn-outline-success"
        title="Reabrir conversa"
        @click="toggleStatus"
      >
        <i class="bi bi-arrow-counterclockwise"></i>
      </button>
    </div>

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

const props = defineProps({
  conversation: { type: Object, default: null },
});

defineEmits(['back', 'toggle-panel']);

const inboxStore = useInboxStore();
const showAssignUser = ref(false);

const displayName = computed(() => {
  const c = props.conversation;
  if (!c) return '';
  return c.customer?.fullName || c.contactName || c.channelContactId || 'Desconhecido';
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
