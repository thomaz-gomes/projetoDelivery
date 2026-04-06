<template>
  <div class="modal d-block" tabindex="-1" @click.self="$emit('close')">
    <div class="modal-dialog">
      <div class="modal-content">
        <div class="modal-header">
          <h5 class="modal-title">Atribuir atendente</h5>
          <button type="button" class="btn-close" @click="$emit('close')"></button>
        </div>
        <div class="modal-body">
          <!-- Loading -->
          <div v-if="loading" class="text-center py-3">
            <div class="spinner-border spinner-border-sm" role="status"></div>
          </div>

          <div v-else class="list-group">
            <!-- Remove assignment option -->
            <button
              type="button"
              class="list-group-item list-group-item-action text-danger"
              @click="assign(null)"
            >
              <i class="bi bi-x-circle me-2"></i>Remover atribuicao
            </button>

            <!-- Users -->
            <button
              v-for="user in users"
              :key="user.id"
              type="button"
              class="list-group-item list-group-item-action d-flex align-items-center"
              @click="assign(user.id)"
            >
              <i class="bi bi-person-fill me-2"></i>
              <div>
                <div class="fw-semibold">{{ user.name }}</div>
                <small class="text-muted">{{ user.email }}</small>
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
  <div class="modal-backdrop fade show"></div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import api from '@/api';
import { useInboxStore } from '@/stores/inbox';

const props = defineProps({
  conversation: { type: Object, default: null },
});

const emit = defineEmits(['close']);

const inboxStore = useInboxStore();
const users = ref([]);
const loading = ref(true);

onMounted(async () => {
  try {
    const { data } = await api.get('/users');
    users.value = Array.isArray(data) ? data : (data.users || []);
  } catch (err) {
    console.error('Failed to fetch users', err);
  } finally {
    loading.value = false;
  }
});

async function assign(userId) {
  if (!props.conversation) return;
  try {
    await inboxStore.updateConversation(props.conversation.id, { assignedUserId: userId });
    emit('close');
  } catch (err) {
    console.error('Failed to assign user', err);
  }
}
</script>
