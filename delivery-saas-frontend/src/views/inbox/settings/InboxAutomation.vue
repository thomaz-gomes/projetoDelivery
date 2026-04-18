<template>
  <div class="container py-4" style="max-width: 800px;">
    <h4 class="mb-4">Automações do Inbox</h4>

    <div class="mb-4">
      <label class="form-label">Loja</label>
      <SelectInput
        v-model="selectedStoreId"
        :options="storeOptions"
        optionValueKey="value"
        optionLabelKey="label"
        placeholder="Selecione uma loja"
        @update:modelValue="loadStore"
      />
    </div>

    <div v-if="selectedStoreId && currentStore">
      <!-- Out-of-hours -->
      <div class="card mb-3">
        <div class="card-body">
          <h6 class="card-title"><i class="bi bi-moon me-1"></i>Auto-resposta fora do horário</h6>
          <p class="small text-muted mb-2">Disparada quando o cliente envia mensagem fora do horário de funcionamento da loja.</p>
          <div class="mb-3">
            <label class="form-label">Resposta rápida</label>
            <SelectInput
              v-model="form.outOfHoursReplyId"
              :options="quickReplyOptions"
              optionValueKey="value"
              optionLabelKey="label"
              placeholder="— Desabilitado —"
            />
          </div>
          <div v-if="outOfHoursPreview" class="small bg-light rounded p-2 mb-3">
            <strong class="d-block mb-1">Preview:</strong>
            <span style="white-space: pre-wrap;">{{ outOfHoursPreview }}</span>
          </div>
          <BaseButton variant="primary" size="sm" :loading="saving" @click="saveOutOfHours">
            Salvar
          </BaseButton>
        </div>
      </div>

      <!-- Greeting -->
      <div class="card mb-3">
        <div class="card-body">
          <h6 class="card-title"><i class="bi bi-emoji-smile me-1"></i>Saudação automática</h6>
          <p class="small text-muted mb-2">Disparada na primeira mensagem do cliente após 6 horas de inatividade.</p>
          <div class="mb-3">
            <label class="form-label">Resposta rápida</label>
            <SelectInput
              v-model="form.greetingReplyId"
              :options="quickReplyOptions"
              optionValueKey="value"
              optionLabelKey="label"
              placeholder="— Desabilitado —"
            />
          </div>
          <div v-if="greetingPreview" class="small bg-light rounded p-2 mb-3">
            <strong class="d-block mb-1">Preview:</strong>
            <span style="white-space: pre-wrap;">{{ greetingPreview }}</span>
          </div>
          <BaseButton variant="primary" size="sm" :loading="saving" @click="saveGreeting">
            Salvar
          </BaseButton>
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
import SelectInput from '@/components/form/select/SelectInput.vue';
import BaseButton from '@/components/BaseButton.vue';

const inboxStore = useInboxStore();

const stores = ref([]);
const selectedStoreId = ref(null);

const currentStore = ref(null);
const quickReplies = computed(() => inboxStore.quickReplies || []);

const storeOptions = computed(() =>
  stores.value.map(s => ({ value: s.id, label: s.name }))
);

const quickReplyOptions = computed(() =>
  quickReplies.value.map(r => ({ value: r.id, label: r.title || r.shortcut }))
);
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

async function loadStore(val) {
  selectedStoreId.value = val || null;
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
      outOfHoursReplyId: form.value.outOfHoursReplyId || null,
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
      greetingReplyId: form.value.greetingReplyId || null,
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
