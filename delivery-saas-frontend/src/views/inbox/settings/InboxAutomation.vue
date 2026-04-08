<template>
  <div class="container py-4" style="max-width: 800px;">
    <h5 class="mb-3">Automações do Inbox</h5>

    <div class="mb-3">
      <label class="form-label small">Loja</label>
      <select v-model="selectedStoreId" @change="loadStore" class="form-select form-select-sm">
        <option :value="null">Selecione uma loja</option>
        <option v-for="s in stores" :key="s.id" :value="s.id">{{ s.name }}</option>
      </select>
    </div>

    <div v-if="selectedStoreId && currentStore">
      <!-- Out-of-hours -->
      <div class="card mb-3">
        <div class="card-body">
          <h6 class="card-title"><i class="bi bi-moon me-1"></i>Auto-resposta fora do horário</h6>
          <p class="small text-muted mb-2">Disparada quando o cliente envia mensagem fora do horário de funcionamento da loja.</p>
          <div class="mb-2">
            <label class="form-label small">Resposta rápida</label>
            <select v-model="form.outOfHoursReplyId" class="form-select form-select-sm">
              <option :value="null">— Desabilitado —</option>
              <option v-for="r in quickReplies" :key="r.id" :value="r.id">{{ r.title || r.shortcut }}</option>
            </select>
          </div>
          <div v-if="outOfHoursPreview" class="small bg-light rounded p-2 mb-2">
            <strong class="d-block mb-1">Preview:</strong>
            <span style="white-space: pre-wrap;">{{ outOfHoursPreview }}</span>
          </div>
          <button class="btn btn-sm btn-primary" @click="saveOutOfHours" :disabled="saving">
            {{ saving ? 'Salvando...' : 'Salvar' }}
          </button>
        </div>
      </div>

      <!-- Greeting -->
      <div class="card mb-3">
        <div class="card-body">
          <h6 class="card-title"><i class="bi bi-emoji-smile me-1"></i>Saudação automática</h6>
          <p class="small text-muted mb-2">Disparada na primeira mensagem do cliente após 6 horas de inatividade.</p>
          <div class="mb-2">
            <label class="form-label small">Resposta rápida</label>
            <select v-model="form.greetingReplyId" class="form-select form-select-sm">
              <option :value="null">— Desabilitado —</option>
              <option v-for="r in quickReplies" :key="r.id" :value="r.id">{{ r.title || r.shortcut }}</option>
            </select>
          </div>
          <div v-if="greetingPreview" class="small bg-light rounded p-2 mb-2">
            <strong class="d-block mb-1">Preview:</strong>
            <span style="white-space: pre-wrap;">{{ greetingPreview }}</span>
          </div>
          <button class="btn btn-sm btn-primary" @click="saveGreeting" :disabled="saving">
            {{ saving ? 'Salvando...' : 'Salvar' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import api from '@/api';
import { useInboxStore } from '@/stores/inbox';
import Swal from 'sweetalert2';

const inboxStore = useInboxStore();

const stores = ref([]);
const selectedStoreId = ref(null);
const currentStore = ref(null);
const quickReplies = computed(() => inboxStore.quickReplies || []);
const saving = ref(false);

const form = ref({
  outOfHoursReplyId: null,
  greetingReplyId: null,
});

const outOfHoursPreview = computed(() => {
  const r = quickReplies.value.find(q => q.id === form.value.outOfHoursReplyId);
  return r?.body || '';
});

const greetingPreview = computed(() => {
  const r = quickReplies.value.find(q => q.id === form.value.greetingReplyId);
  return r?.body || '';
});

async function loadStore() {
  if (!selectedStoreId.value) {
    currentStore.value = null;
    return;
  }
  try {
    const { data } = await api.get(`/stores/${selectedStoreId.value}`);
    currentStore.value = data;
    form.value.outOfHoursReplyId = data.outOfHoursReplyId || null;
    form.value.greetingReplyId = data.greetingReplyId || null;
  } catch (e) {
    Swal.fire('Erro', 'Falha ao carregar loja', 'error');
  }
}

async function saveOutOfHours() {
  saving.value = true;
  try {
    await api.patch(`/stores/${selectedStoreId.value}/inbox-automation`, {
      outOfHoursReplyId: form.value.outOfHoursReplyId,
    });
    Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: 'Salvo!', showConfirmButton: false, timer: 1500 });
  } catch (e) {
    Swal.fire('Erro', e.response?.data?.message || 'Falha ao salvar', 'error');
  } finally {
    saving.value = false;
  }
}

async function saveGreeting() {
  saving.value = true;
  try {
    await api.patch(`/stores/${selectedStoreId.value}/inbox-automation`, {
      greetingReplyId: form.value.greetingReplyId,
    });
    Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: 'Salvo!', showConfirmButton: false, timer: 1500 });
  } catch (e) {
    Swal.fire('Erro', e.response?.data?.message || 'Falha ao salvar', 'error');
  } finally {
    saving.value = false;
  }
}

onMounted(async () => {
  try {
    const { data } = await api.get('/stores');
    stores.value = Array.isArray(data) ? data : (data.stores || []);
  } catch (e) { stores.value = []; }
  if (!inboxStore.quickReplies?.length) {
    await inboxStore.fetchQuickReplies();
  }
});
</script>
