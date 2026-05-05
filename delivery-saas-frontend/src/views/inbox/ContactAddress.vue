<template>
  <div class="p-3 border-top">
    <div class="d-flex align-items-center justify-content-between mb-2">
      <span class="fw-semibold small"><i class="bi bi-geo-alt me-1"></i>Endereço</span>
      <button class="btn btn-sm btn-outline-primary py-0 px-2" @click="openNew">+ Novo</button>
    </div>

    <!-- Saved addresses radio list with edit button -->
    <div v-if="addresses.length > 0" class="mb-2">
      <div v-for="addr in addresses" :key="addr.id" class="d-flex align-items-center gap-1">
        <div class="form-check small flex-grow-1 mb-0">
          <input class="form-check-input" type="radio" :value="addr.id" v-model="selectedAddrId" @change="selectAddress(addr)" :id="`addr-${addr.id}`" />
          <label class="form-check-label text-truncate" :for="`addr-${addr.id}`" style="max-width: 240px;">
            {{ addr.label ? addr.label + ' - ' : '' }}{{ addr.street || '' }}{{ addr.number ? ', ' + addr.number : '' }}{{ addr.neighborhood ? ' - ' + addr.neighborhood : '' }}
            <span v-if="!addr.number || !addr.neighborhood" class="badge bg-warning text-dark ms-1" title="Endereço incompleto">!</span>
          </label>
        </div>
        <button class="btn btn-sm btn-link p-0 text-muted" @click="openEdit(addr)" title="Editar endereço">
          <i class="bi bi-pencil" style="font-size: 0.75rem;"></i>
        </button>
      </div>
    </div>

    <!-- Address form (new or edit) -->
    <div v-if="showForm" class="border rounded p-2 mt-2 bg-light">
      <div class="d-flex justify-content-between align-items-center mb-2">
        <span class="small fw-semibold">{{ editingId ? 'Editar endereço' : 'Novo endereço' }}</span>
        <button class="btn btn-sm btn-link p-0 text-muted" @click="closeForm" title="Cancelar">
          <i class="bi bi-x-lg" style="font-size: 0.7rem;"></i>
        </button>
      </div>
      <div class="row g-2">
        <div class="col-8">
          <input type="text" class="form-control form-control-sm" v-model="form.street" placeholder="Rua *" :class="{ 'is-invalid': showErrors && !form.street }" />
        </div>
        <div class="col-4">
          <input type="text" class="form-control form-control-sm" v-model="form.number" placeholder="Nº *" :class="{ 'is-invalid': showErrors && !form.number }" />
        </div>
        <div class="col-12">
          <select class="form-select form-select-sm" v-model="form.neighborhood" :class="{ 'is-invalid': showErrors && !form.neighborhood }">
            <option value="">Bairro *</option>
            <option v-for="n in neighborhoods" :key="n.id" :value="n.name">{{ n.name }} - R$ {{ Number(n.deliveryFee || 0).toFixed(2).replace('.', ',') }}</option>
          </select>
        </div>
        <div class="col-12">
          <input type="text" class="form-control form-control-sm" v-model="form.complement" placeholder="Complemento" />
        </div>
        <div class="col-12">
          <input type="text" class="form-control form-control-sm" v-model="form.reference" placeholder="Referência" />
        </div>
        <div class="col-12">
          <input type="text" class="form-control form-control-sm" v-model="form.observation" placeholder="Observação" />
        </div>
        <div v-if="showErrors && !isFormValid" class="col-12">
          <div class="small text-danger">Preencha rua, número e bairro para salvar.</div>
        </div>
        <div class="col-12 d-flex gap-2">
          <button class="btn btn-sm btn-primary flex-grow-1" :disabled="saving" @click="saveAddress">
            <span v-if="saving" class="spinner-border spinner-border-sm me-1"></span>
            {{ editingId ? 'Atualizar endereço' : 'Salvar endereço' }}
          </button>
          <button class="btn btn-sm btn-outline-secondary" @click="closeForm">Cancelar</button>
        </div>
      </div>
    </div>

    <transition name="fade">
      <div v-if="saved" class="small text-success mt-1"><i class="bi bi-check"></i> Salvo</div>
    </transition>
  </div>
</template>

<script setup>
import { ref, watch, computed, onMounted } from 'vue';
import { useInboxStore } from '@/stores/inbox';
import api from '@/api';

const props = defineProps({ customerId: String });
const emit = defineEmits(['address-selected']);
const inboxStore = useInboxStore();

const neighborhoods = ref([]);
const selectedAddrId = ref(null);
const showForm = ref(false);
const editingId = ref(null);   // null = creating new; truthy = editing existing
const showErrors = ref(false);
const saving = ref(false);
const saved = ref(false);
let saveTimer = null;

const emptyForm = () => ({ street: '', number: '', neighborhood: '', complement: '', reference: '', observation: '' });
const form = ref(emptyForm());

const addresses = computed(() => {
  if (!props.customerId) return [];
  const cust = inboxStore.customerCache[props.customerId];
  return cust?.addresses || [];
});

const isFormValid = computed(() => Boolean(form.value.street && form.value.number && form.value.neighborhood));

// Watch customerId to select default address
watch(() => props.customerId, () => {
  const addrs = addresses.value;
  if (addrs.length > 0) {
    const def = addrs.find(a => a.isDefault) || addrs[0];
    selectAddress(def);
  } else {
    showForm.value = false;
  }
}, { immediate: true });

onMounted(async () => {
  try {
    const { data } = await api.get('/neighborhoods');
    neighborhoods.value = Array.isArray(data) ? data : [];
  } catch (e) { console.warn('Failed to load neighborhoods:', e); }
});

function selectAddress(addr) {
  selectedAddrId.value = addr.id;
  showForm.value = false;
  editingId.value = null;
  showErrors.value = false;
  form.value = {
    street: addr.street || '',
    number: addr.number || '',
    neighborhood: addr.neighborhood || '',
    complement: addr.complement || '',
    reference: addr.reference || '',
    observation: addr.observation || '',
  };
  emit('address-selected', { ...form.value, id: addr.id });
}

function openNew() {
  editingId.value = null;
  showErrors.value = false;
  form.value = emptyForm();
  showForm.value = true;
}

function openEdit(addr) {
  editingId.value = addr.id;
  showErrors.value = false;
  form.value = {
    street: addr.street || '',
    number: addr.number || '',
    neighborhood: addr.neighborhood || '',
    complement: addr.complement || '',
    reference: addr.reference || '',
    observation: addr.observation || '',
  };
  showForm.value = true;
}

function closeForm() {
  showForm.value = false;
  editingId.value = null;
  showErrors.value = false;
  // Restore form to currently-selected address (if any) so we don't leave stale values
  if (selectedAddrId.value) {
    const sel = addresses.value.find(a => a.id === selectedAddrId.value);
    if (sel) form.value = {
      street: sel.street || '',
      number: sel.number || '',
      neighborhood: sel.neighborhood || '',
      complement: sel.complement || '',
      reference: sel.reference || '',
      observation: sel.observation || '',
    };
  }
}

async function saveAddress() {
  if (!props.customerId) return;
  if (!isFormValid.value) {
    showErrors.value = true;
    return;
  }
  saving.value = true;
  try {
    if (editingId.value) {
      // Update each field on the existing address
      for (const field of ['street', 'number', 'neighborhood', 'complement', 'reference', 'observation']) {
        await inboxStore.updateAddressField(props.customerId, editingId.value, field, form.value[field]);
      }
      selectedAddrId.value = editingId.value;
      emit('address-selected', { ...form.value, id: editingId.value });
    } else {
      const data = await inboxStore.createAddress(props.customerId, { ...form.value });
      selectedAddrId.value = data.id;
      emit('address-selected', { ...form.value, id: data.id });
    }
    showForm.value = false;
    editingId.value = null;
    showErrors.value = false;
    saved.value = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { saved.value = false; }, 2000);
  } catch (e) {
    console.error('Erro ao salvar endereço:', e);
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped>
.fade-enter-active, .fade-leave-active { transition: opacity 0.3s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
