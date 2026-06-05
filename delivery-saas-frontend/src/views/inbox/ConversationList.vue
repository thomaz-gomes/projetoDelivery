<template>
  <div class="inbox-list">
    <!-- Search + Lojas (side-by-side, like Chefiz) -->
    <div class="inbox-list__filters">
      <div class="inbox-list__search-wrap">
        <i class="bi bi-search inbox-list__search-icon"></i>
        <input
          type="text"
          v-model="searchInput"
          @input="onSearchInput"
          @focus="onSearchFocus"
          @blur="onSearchBlur"
          placeholder="Buscar contato"
          class="inbox-list__search-input"
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

      <div class="inbox-list__store-wrap">
        <select v-model="filters.storeId" @change="onFiltersChange" class="inbox-list__store-select">
          <option :value="null">Lojas</option>
          <option v-for="s in stores" :key="s.id" :value="s.id">{{ s.name }}</option>
        </select>
        <i class="bi bi-chevron-down inbox-list__store-caret"></i>
      </div>
    </div>

    <!-- Segmented status switcher -->
    <div class="inbox-list__segment-row">
      <div class="inbox-segment">
        <button
          v-for="opt in statusOptions"
          :key="opt.value"
          class="inbox-segment__btn"
          :class="{ 'inbox-segment__btn--active': filters.status === opt.value }"
          @click="setStatus(opt.value)"
        >{{ opt.label }}</button>
      </div>
    </div>

    <!-- Chips (channels + mine + unread, like Chefiz) -->
    <div class="inbox-list__chips qreplies">
      <button
        class="inbox-chip"
        :class="{ 'inbox-chip--active': filters.unread }"
        @click="toggleUnread"
      >
        <i class="bi bi-circle-fill" style="font-size: 0.5rem;"></i>
        Não lidas
        <span v-if="unreadCount" class="inbox-chip__count">{{ unreadCount }}</span>
      </button>
      <button
        class="inbox-chip"
        :class="{ 'inbox-chip--active': filters.mine }"
        @click="toggleMine"
      >
        <i class="bi bi-person"></i>
        Minhas
        <span v-if="mineCount" class="inbox-chip__count">{{ mineCount }}</span>
      </button>
      <button
        v-for="opt in channelOptions"
        :key="opt.value ?? 'all'"
        class="inbox-chip"
        :class="{ 'inbox-chip--active': filters.channel === opt.value }"
        @click="setChannel(opt.value)"
      >
        <i v-if="opt.icon" :class="['bi', opt.icon]"></i>{{ opt.label }}
      </button>
    </div>

    <!-- List -->
    <div class="inbox-list__items">
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
      if (myToken !== searchToken) return;
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
  setTimeout(() => { searchOpen.value = false; }, 150);
}

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
      const integration = await pickIntegration();
      if (!integration) return;
      const conv = await inboxStore.startConversation({
        customerId: r.customer.id,
        providerAccountId: integration.accountId,
      });
      if (conv?.id) emit('select', conv.id);
    } else if (r.type === 'new-number') {
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
.inbox-list {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: #fff;
}

/* ── Search + Lojas row ── */
.inbox-list__filters {
  display: flex;
  gap: 8px;
  padding: 14px 16px 8px;
  position: relative;
}
.inbox-list__search-wrap {
  flex: 1;
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 42px;
  background: #f4f5f7;
  border-radius: 11px;
  padding: 0 12px;
  min-width: 0;
}
.inbox-list__search-icon {
  color: #929aa8;
  font-size: 0.95rem;
  flex-shrink: 0;
}
.inbox-list__search-input {
  flex: 1;
  min-width: 0;
  border: none;
  background: transparent;
  outline: none;
  font-size: 0.875rem;
  color: #1d2330;
}
.inbox-list__search-input::placeholder { color: #929aa8; }

.inbox-list__store-wrap {
  position: relative;
  flex-shrink: 0;
}
.inbox-list__store-select {
  height: 42px;
  padding: 0 26px 0 12px;
  background: #f4f5f7;
  border: 1px solid #e9ecf1;
  border-radius: 11px;
  color: #5a6373;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  outline: none;
  appearance: none;
  -webkit-appearance: none;
  max-width: 130px;
}
.inbox-list__store-caret {
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 0.75rem;
  color: #5a6373;
  pointer-events: none;
}

/* ── Segmented status switcher ── */
.inbox-list__segment-row {
  padding: 0 16px 8px;
}
.inbox-segment {
  display: flex;
  background: #f4f5f7;
  border-radius: 11px;
  padding: 3px;
}
.inbox-segment__btn {
  flex: 1;
  height: 32px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: #5a6373;
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
  transition: background .15s;
}
.inbox-segment__btn--active {
  background: var(--success, #89D136);
  color: #fff;
  box-shadow: 0 1px 3px rgba(0,0,0,0.12);
}

/* ── Chips row ── */
.inbox-list__chips {
  display: flex;
  gap: 7px;
  padding: 0 16px 8px;
  overflow-x: auto;
}
.inbox-chip {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 30px;
  padding: 0 12px;
  border: 1px solid #e9ecf1;
  border-radius: 15px;
  background: #fff;
  color: #5a6373;
  font-size: 0.78rem;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: background .1s, border-color .1s;
}
.inbox-chip:hover { background: #f3f5f7; }
.inbox-chip--active {
  background: rgba(137, 209, 54, 0.14);
  border-color: var(--success, #89D136);
  color: #4a6f0d;
}
.inbox-chip__count {
  background: #e23b3b;
  color: #fff;
  font-size: 0.65rem;
  font-weight: 700;
  min-width: 16px;
  height: 16px;
  border-radius: 8px;
  padding: 0 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
}

/* ── List ── */
.inbox-list__items {
  flex: 1;
  overflow-y: auto;
  border-top: 1px solid #f0f2f5;
  min-height: 0;
}

/* ── Search dropdown (preserved layout) ── */
.search-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  background: #fff;
  border: 1px solid #e9ecf1;
  border-radius: 10px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
  max-height: 320px;
  overflow-y: auto;
  z-index: 1050;
}
.search-dropdown__item {
  display: block;
  width: 100%;
  text-align: left;
  padding: 10px 12px;
  background: transparent;
  border: 0;
  border-bottom: 1px solid #f0f2f5;
}
.search-dropdown__item:last-child { border-bottom: 0; }
.search-dropdown__item:hover { background: #f6f7f9; }
.search-dropdown__hint {
  padding: 10px 12px;
  font-size: 0.85rem;
  color: #6c757d;
}
</style>
