<template>
  <div class="modal d-block" tabindex="-1" @click.self="$emit('close')">
    <div class="modal-dialog">
      <div class="modal-content">
        <div class="modal-header">
          <h5 class="modal-title">Vincular cliente</h5>
          <button type="button" class="btn-close" @click="$emit('close')"></button>
        </div>
        <div class="modal-body">
          <!-- Search -->
          <div class="input-group mb-3">
            <span class="input-group-text"><i class="bi bi-search"></i></span>
            <input
              type="text"
              class="form-control"
              placeholder="Buscar por nome ou telefone..."
              v-model="search"
              @input="onSearch"
            />
          </div>

          <!-- Loading -->
          <div v-if="loading" class="text-center py-3">
            <div class="spinner-border spinner-border-sm" role="status"></div>
          </div>

          <!-- Results -->
          <div v-else-if="results.length" class="list-group">
            <button
              v-for="cust in results"
              :key="cust.id"
              type="button"
              class="list-group-item list-group-item-action d-flex align-items-center"
              @click="link(cust.id)"
            >
              <div>
                <div class="fw-semibold">{{ cust.fullName }}</div>
                <small class="text-muted">{{ cust.whatsapp || cust.phone || '' }}</small>
              </div>
            </button>
          </div>

          <!-- No results -->
          <div v-else-if="searched" class="text-center py-3 text-muted">
            <p class="mb-2">Nenhum cliente encontrado</p>
            <button class="btn btn-sm btn-outline-primary" @click="createNew">
              <i class="bi bi-plus me-1"></i>Cadastrar novo
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
import { useRouter } from 'vue-router';
import api from '@/api';
import { useInboxStore } from '@/stores/inbox';

const props = defineProps({
  conversation: { type: Object, default: null },
});

const emit = defineEmits(['close']);

const router = useRouter();
const inboxStore = useInboxStore();
const search = ref('');
const results = ref([]);
const loading = ref(false);
const searched = ref(false);
let debounceTimer = null;

onMounted(() => {
  // Auto-fill with phone from conversation
  const phone = props.conversation?.channelContactId || '';
  if (phone) {
    search.value = phone;
    doSearch();
  }
});

function onSearch() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(doSearch, 400);
}

async function doSearch() {
  const q = search.value.trim();
  if (!q) { results.value = []; searched.value = false; return; }
  loading.value = true;
  try {
    const { data } = await api.get('/customers', { params: { search: q, limit: 10 } });
    results.value = Array.isArray(data) ? data : (data.customers || []);
    searched.value = true;
  } catch (err) {
    console.error('Customer search failed', err);
    results.value = [];
  } finally {
    loading.value = false;
  }
}

async function link(customerId) {
  if (!props.conversation) return;
  try {
    await inboxStore.linkCustomer(props.conversation.id, customerId);
    emit('close');
  } catch (err) {
    console.error('Failed to link customer', err);
  }
}

function createNew() {
  const phone = props.conversation?.channelContactId || '';
  router.push({ path: '/customers/new', query: phone ? { whatsapp: phone } : {} });
  emit('close');
}
</script>
