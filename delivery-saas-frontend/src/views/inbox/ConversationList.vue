<template>
  <div class="d-flex flex-column h-100">
    <!-- Header -->
    <div class="p-3 border-bottom">
      <h5 class="mb-2">Inbox</h5>
      <!-- Search -->
      <div class="input-group input-group-sm mb-2">
        <span class="input-group-text"><i class="bi bi-search"></i></span>
        <input
          type="text"
          class="form-control"
          placeholder="Buscar conversa..."
          v-model="searchText"
          @input="onSearchInput"
        />
      </div>
      <!-- Status filters -->
      <div class="btn-group btn-group-sm w-100" role="group">
        <button
          type="button"
          class="btn"
          :class="inboxStore.filters.status === 'OPEN' ? 'btn-success' : 'btn-outline-secondary'"
          @click="setStatus('OPEN')"
        >
          Abertas
        </button>
        <button
          type="button"
          class="btn"
          :class="inboxStore.filters.status === 'CLOSED' ? 'btn-success' : 'btn-outline-secondary'"
          @click="setStatus('CLOSED')"
        >
          Fechadas
        </button>
        <button
          type="button"
          class="btn"
          :class="!inboxStore.filters.status ? 'btn-success' : 'btn-outline-secondary'"
          @click="setStatus('')"
        >
          Todas
        </button>
      </div>
    </div>

    <!-- Conversation list -->
    <div class="flex-grow-1 overflow-auto">
      <!-- Loading -->
      <div v-if="inboxStore.loading" class="text-center p-4">
        <div class="spinner-border spinner-border-sm text-success" role="status"></div>
        <p class="text-muted small mt-2">Carregando...</p>
      </div>

      <!-- Empty state -->
      <div v-else-if="!inboxStore.conversations.length" class="text-center p-4 text-muted">
        <i class="bi bi-chat-left" style="font-size: 2rem;"></i>
        <p class="mt-2 small">Nenhuma conversa encontrada</p>
      </div>

      <!-- Items -->
      <ConversationItem
        v-for="conv in inboxStore.conversations"
        :key="conv.id"
        :conversation="conv"
        :active="conv.id === inboxStore.activeConversationId"
        @click="$emit('select', conv.id)"
      />
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { useInboxStore } from '@/stores/inbox';
import ConversationItem from './ConversationItem.vue';

defineEmits(['select']);

const inboxStore = useInboxStore();
const searchText = ref(inboxStore.filters.search || '');
let debounceTimer = null;

function onSearchInput() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    inboxStore.filters.search = searchText.value;
    inboxStore.fetchConversations();
  }, 400);
}

function setStatus(status) {
  inboxStore.filters.status = status;
  inboxStore.fetchConversations();
}
</script>
