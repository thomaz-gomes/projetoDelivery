<template>
  <div class="d-flex flex-column h-100">
    <!-- Search -->
    <div class="p-2 border-bottom">
      <input
        type="text"
        v-model="searchInput"
        @input="onSearchInput"
        placeholder="Buscar contato ou mensagem..."
        class="form-control form-control-sm"
      />
    </div>

    <!-- Filter row 1: status -->
    <div class="d-flex gap-1 px-2 pt-2">
      <button
        v-for="opt in statusOptions"
        :key="opt.value"
        class="btn btn-sm flex-fill"
        :class="filters.status === opt.value ? 'btn-primary' : 'btn-outline-secondary'"
        @click="setStatus(opt.value)"
      >{{ opt.label }}</button>
    </div>

    <!-- Filter row 2: chips + store -->
    <div class="d-flex gap-1 px-2 py-2 align-items-center flex-wrap">
      <button
        class="btn btn-sm"
        :class="filters.mine ? 'btn-info text-white' : 'btn-outline-secondary'"
        @click="toggleMine"
      >
        <i class="bi bi-person"></i> Minhas
        <span v-if="mineCount" class="badge bg-light text-dark ms-1">{{ mineCount }}</span>
      </button>
      <button
        class="btn btn-sm"
        :class="filters.unread ? 'btn-success text-white' : 'btn-outline-secondary'"
        @click="toggleUnread"
      >
        <i class="bi bi-circle-fill" style="font-size: 0.5rem;"></i> Não lidas
        <span v-if="unreadCount" class="badge bg-light text-dark ms-1">{{ unreadCount }}</span>
      </button>
      <select v-model="filters.storeId" @change="onFiltersChange" class="form-select form-select-sm" style="width: auto;">
        <option :value="null">Todas as lojas</option>
        <option v-for="s in stores" :key="s.id" :value="s.id">{{ s.name }}</option>
      </select>
    </div>

    <!-- List -->
    <div class="flex-grow-1 overflow-auto">
      <div v-if="inboxStore.loading" class="text-center py-3 text-muted small">Carregando...</div>
      <ConversationItem
        v-for="conv in inboxStore.conversations"
        :key="conv.id"
        :conversation="conv"
        :selected="conv.id === inboxStore.activeConversationId"
        @click="selectConversation(conv.id)"
      />
      <div v-if="!inboxStore.loading && !inboxStore.conversations.length" class="text-center py-3 text-muted small">
        Nenhuma conversa
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useInboxStore } from '@/stores/inbox';
import { useAuthStore } from '@/stores/auth';
import api from '@/api';
import ConversationItem from './ConversationItem.vue';

const emit = defineEmits(['select']);

const inboxStore = useInboxStore();
const authStore = useAuthStore();
const filters = inboxStore.filters;

const searchInput = ref(filters.search);
const stores = ref([]);

const statusOptions = [
  { label: 'Abertas', value: 'OPEN' },
  { label: 'Fechadas', value: 'CLOSED' },
  { label: 'Todas', value: '' },
];

const mineCount = computed(() => {
  const userId = authStore.user?.id;
  if (!userId) return 0;
  return inboxStore.conversations.filter(c => c.assignedUserId === userId).length;
});

const unreadCount = computed(() => {
  return inboxStore.conversations.filter(c => (c.unreadCount || 0) > 0).length;
});

let searchTimer = null;
function onSearchInput() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    filters.search = searchInput.value;
    inboxStore.fetchConversations();
  }, 400);
}

function setStatus(value) {
  filters.status = value;
  inboxStore.fetchConversations();
}

function toggleMine() {
  filters.mine = !filters.mine;
  inboxStore.fetchConversations();
}

function toggleUnread() {
  filters.unread = !filters.unread;
  inboxStore.fetchConversations();
}

function onFiltersChange() {
  inboxStore.fetchConversations();
}

function selectConversation(id) {
  emit('select', id);
}

onMounted(async () => {
  try {
    const { data } = await api.get('/stores');
    stores.value = Array.isArray(data) ? data : (data.stores || []);
  } catch (e) { stores.value = []; }
});
</script>
