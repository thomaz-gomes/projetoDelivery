<template>
  <div class="d-flex flex-column h-100" style="min-height: 0;">
    <!-- Search + Store filter -->
    <div class="p-2 border-bottom d-flex gap-2 position-relative">
      <div class="flex-grow-1 position-relative">
        <input
          type="text"
          v-model="searchInput"
          @input="onSearchInput"
          @focus="onSearchFocus"
          @blur="onSearchBlur"
          placeholder="Buscar contato por nome ou número..."
          class="form-control form-control-sm"
        />
        <!-- Search results dropdown -->
        <div
          v-if="searchOpen && (searchResults.length > 0 || searchLoading || searchError)"
          class="search-dropdown"
        >
          <div v-if="searchLoading" class="search-dropdown__hint">Buscando...</div>
          <div v-else-if="searchError" class="search-dropdown__hint text-danger">{{ searchError }}</div>
          <template v-else>
            <button
              v-for="(r, i) in searchResults"
              :key="r.type === 'contact' ? r.customer.id : 'new-' + i"
              type="button"
              class="search-dropdown__item"
              @mousedown.prevent="onPickResult(r)"
            >
              <template v-if="r.type === 'contact'">
                <div class="d-flex justify-content-between align-items-start">
                  <div class="me-2 text-truncate">
                    <div class="fw-semibold text-truncate">{{ r.customer.fullName || r.customer.whatsapp || '—' }}</div>
                    <div class="small text-muted text-truncate">
                      <i class="bi bi-whatsapp me-1"></i>{{ r.customer.whatsapp || '—' }}
                    </div>
                  </div>
                  <span v-if="r.conversation" class="badge bg-success-subtle text-success-emphasis flex-shrink-0">Conversa</span>
                  <span v-else class="badge bg-light text-muted flex-shrink-0">Nova</span>
                </div>
              </template>
              <template v-else>
                <div class="d-flex align-items-center gap-2">
                  <i class="bi bi-plus-circle text-success"></i>
                  <span>Iniciar conversa com <strong>{{ r.whatsapp }}</strong></span>
                </div>
              </template>
            </button>
          </template>
        </div>
      </div>
      <select v-model="filters.storeId" @change="onFiltersChange" class="form-select form-select-sm" style="width: auto; max-width: 140px;">
        <option :value="null">Todas as lojas</option>
        <option v-for="s in stores" :key="s.id" :value="s.id">{{ s.name }}</option>
      </select>
    </div>

    <!-- Filter row 0: channel chips -->
    <div class="d-flex gap-1 px-2 pt-2 flex-wrap">
      <button
        v-for="opt in channelOptions"
        :key="opt.value ?? 'all'"
        class="btn btn-sm"
        :class="filters.channel === opt.value ? 'btn-primary' : 'btn-outline-secondary'"
        @click="setChannel(opt.value)"
      >
        <i v-if="opt.icon" :class="['bi', opt.icon, 'me-1']"></i>{{ opt.label }}
      </button>
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

    <!-- Filter row 2: chips -->
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
    </div>

    <!-- List -->
    <div class="flex-grow-1 overflow-auto" style="min-height: 0;">
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
import Swal from 'sweetalert2';
import ConversationItem from './ConversationItem.vue';

const emit = defineEmits(['select']);

const inboxStore = useInboxStore();
const authStore = useAuthStore();
const filters = inboxStore.filters;

const searchInput = ref('');
const stores = ref([]);
const searchOpen = ref(false);
const searchLoading = ref(false);
const searchError = ref('');
const searchResults = ref([]);
let searchToken = 0;

const statusOptions = [
  { label: 'Abertas', value: 'OPEN' },
  { label: 'Fechadas', value: 'CLOSED' },
  { label: 'Todas', value: '' },
];

const channelOptions = [
  { label: 'Todos', value: null, icon: null },
  { label: 'WhatsApp', value: 'WHATSAPP', icon: 'bi-whatsapp' },
  { label: 'Messenger', value: 'FACEBOOK', icon: 'bi-messenger' },
  { label: 'Instagram', value: 'INSTAGRAM', icon: 'bi-instagram' },
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
  const q = (searchInput.value || '').trim();
  if (!q) {
    searchResults.value = [];
    searchError.value = '';
    searchLoading.value = false;
    return;
  }
  searchLoading.value = true;
  searchError.value = '';
  searchOpen.value = true;
  searchTimer = setTimeout(async () => {
    const myToken = ++searchToken;
    try {
      const data = await inboxStore.searchContacts(q);
      if (myToken !== searchToken) return; // stale
      searchResults.value = data;
    } catch (e) {
      if (myToken !== searchToken) return;
      searchError.value = e?.response?.data?.message || 'Falha ao buscar contatos';
      searchResults.value = [];
    } finally {
      if (myToken === searchToken) searchLoading.value = false;
    }
  }, 300);
}

function onSearchFocus() {
  if (searchInput.value.trim()) searchOpen.value = true;
}

function onSearchBlur() {
  // Delay so click on a result (mousedown) registers before the dropdown closes.
  setTimeout(() => { searchOpen.value = false; }, 150);
}

// Pergunta ao operador qual integração WhatsApp deve conduzir o chat.
// Comportamento adaptativo:
//   - Nenhuma integração configurada → alerta e retorna null (aborta)
//   - 1 integração → retorna ela sem perguntar (UX limpa quando não há ambiguidade)
//   - 2+ integrações → mostra Swal com select pra escolher
// Retorna { provider, accountId, displayName } ou null se cancelado/sem opção.
async function pickIntegration() {
  let integrations = [];
  try {
    integrations = await inboxStore.fetchWhatsappIntegrations();
  } catch (e) {
    await Swal.fire({ icon: 'error', text: 'Erro ao carregar integrações: ' + (e?.message || e) });
    return null;
  }
  if (!integrations.length) {
    await Swal.fire({
      icon: 'warning',
      title: 'Nenhuma integração WhatsApp configurada',
      text: 'Cadastre uma instância Evolution ou conecte uma conta Meta WhatsApp Cloud antes de iniciar conversas.',
    });
    return null;
  }
  if (integrations.length === 1) return integrations[0];

  const inputOptions = {};
  for (const i of integrations) {
    const providerLabel = i.provider === 'META_WA' ? 'Meta Cloud' : 'Evolution';
    const menuLabel = i.menu ? ` · ${i.menu.name}` : '';
    inputOptions[i.accountId] = `${i.displayName} — ${providerLabel}${menuLabel}`;
  }
  const { value, isConfirmed } = await Swal.fire({
    title: 'Qual integração?',
    text: 'Selecione qual número WhatsApp vai conduzir esta conversa.',
    input: 'select',
    inputOptions,
    inputPlaceholder: 'Escolha um número...',
    showCancelButton: true,
    confirmButtonText: 'Iniciar',
    cancelButtonText: 'Cancelar',
    inputValidator: (v) => !v && 'Selecione uma integração',
  });
  if (!isConfirmed) return null;
  return integrations.find(i => i.accountId === value) || null;
}

async function onPickResult(r) {
  try {
    if (r.type === 'contact' && r.conversation) {
      // Conversa existente — abre direto. Quando estava CLOSED/arquivada, o
      // start-conversation server-side reabre. Passa providerAccountId pra
      // garantir que a MESMA conversa é reaberta (e não cria-se outra em
      // outra integração).
      const inStore = inboxStore.conversations.some(c => c.id === r.conversation.id);
      let convId = r.conversation.id;
      if (!inStore || r.conversation.status !== 'OPEN') {
        const conv = await inboxStore.startConversation({
          customerId: r.customer.id,
          providerAccountId: r.conversation.providerAccountId || undefined,
        });
        convId = conv?.id || convId;
      }
      emit('select', convId);
    } else if (r.type === 'contact') {
      // Cliente existente sem conversa — pergunta integração antes de criar.
      const integration = await pickIntegration();
      if (!integration) return;
      const conv = await inboxStore.startConversation({
        customerId: r.customer.id,
        providerAccountId: integration.accountId,
      });
      if (conv?.id) emit('select', conv.id);
    } else if (r.type === 'new-number') {
      // Novo número — pergunta integração antes de criar Customer + conversa.
      const integration = await pickIntegration();
      if (!integration) return;
      const conv = await inboxStore.startConversation({
        whatsapp: r.whatsapp,
        providerAccountId: integration.accountId,
      });
      if (conv?.id) emit('select', conv.id);
    }
  } finally {
    searchInput.value = '';
    searchResults.value = [];
    searchOpen.value = false;
  }
}

function setStatus(value) {
  filters.status = value;
  inboxStore.fetchConversations();
}

function setChannel(value) {
  inboxStore.setChannelFilter(value);
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

<style scoped>
.search-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  margin-top: 4px;
  background: #fff;
  border: 1px solid #dee2e6;
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
  max-height: 320px;
  overflow-y: auto;
  z-index: 1050;
}
.search-dropdown__item {
  display: block;
  width: 100%;
  text-align: left;
  padding: 8px 10px;
  background: transparent;
  border: 0;
  border-bottom: 1px solid #f1f3f5;
}
.search-dropdown__item:last-child { border-bottom: 0; }
.search-dropdown__item:hover { background: #f8f9fa; }
.search-dropdown__hint {
  padding: 10px 12px;
  font-size: 0.85rem;
  color: #6c757d;
}
</style>
