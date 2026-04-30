<template>
  <div class="p-3 border-top">
    <div class="d-flex align-items-center justify-content-between mb-2">
      <span class="fw-semibold small"><i class="bi bi-geo-alt me-1"></i>Endereco</span>
      <button class="btn btn-sm btn-outline-primary py-0 px-2" @click="toggleNewAddress">+ Novo</button>
    </div>

    <!-- Saved addresses radio list -->
    <div v-if="addresses.length > 0" class="mb-2">
      <div v-for="addr in addresses" :key="addr.id" class="form-check small">
        <input class="form-check-input" type="radio" :value="addr.id" v-model="selectedAddrId" @change="selectAddress(addr)" />
        <label class="form-check-label text-truncate" style="max-width: 280px;">
          {{ addr.label ? addr.label + ' - ' : '' }}{{ addr.street || '' }}{{ addr.number ? ', ' + addr.number : '' }}{{ addr.neighborhood ? ' - ' + addr.neighborhood : '' }}
        </label>
      </div>
    </div>

    <!-- Address form -->
    <div v-if="showForm" class="row g-2">
      <div class="col-8">
        <input type="text" class="form-control form-control-sm" v-model="form.street" @blur="saveField('street')" placeholder="Rua" />
      </div>
      <div class="col-4">
        <input type="text" class="form-control form-control-sm" v-model="form.number" @blur="saveField('number')" placeholder="Nr" />
      </div>
      <div class="col-12">
        <select class="form-select form-select-sm" v-model="form.neighborhood" @change="saveField('neighborhood')">
          <option value="">Bairro</option>
          <option v-for="n in neighborhoods" :key="n.id" :value="n.name">{{ n.name }} - R$ {{ Number(n.deliveryFee || 0).toFixed(2).replace('.', ',') }}</option>
        </select>
      </div>
      <div class="col-12">
        <input type="text" class="form-control form-control-sm" v-model="form.complement" @blur="saveField('complement')" placeholder="Complemento" />
      </div>
      <div class="col-12">
        <input type="text" class="form-control form-control-sm" v-model="form.reference" @blur="saveField('reference')" placeholder="Referencia" />
      </div>
      <div class="col-12">
        <input type="text" class="form-control form-control-sm" v-model="form.observation" @blur="saveField('observation')" placeholder="Observacao" />
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
const isNew = ref(false);
const showForm = ref(false);
const saved = ref(false);
let saveTimer = null;

const form = ref({ street: '', number: '', neighborhood: '', complement: '', reference: '', observation: '' });

const addresses = computed(() => {
  if (!props.customerId) return [];
  const cust = inboxStore.customerCache[props.customerId];
  return cust?.addresses || [];
});

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
  isNew.value = false;
  showForm.value = false;
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

function newAddress() {
  selectedAddrId.value = null;
  isNew.value = true;
  showForm.value = true;
  form.value = { street: '', number: '', neighborhood: '', complement: '', reference: '', observation: '' };
}

function toggleNewAddress() {
  if (showForm.value && isNew.value) {
    showForm.value = false;
  } else {
    newAddress();
  }
}

async function saveField(field) {
  if (!props.customerId) return;
  try {
    if (isNew.value) {
      // For new address, create once we have street and number
      if (form.value.street && form.value.number) {
        const data = await inboxStore.createAddress(props.customerId, { ...form.value });
        selectedAddrId.value = data.id;
        isNew.value = false;
        emit('address-selected', { ...form.value, id: data.id });
      }
    } else if (selectedAddrId.value) {
      await inboxStore.updateAddressField(props.customerId, selectedAddrId.value, field, form.value[field]);
      emit('address-selected', { ...form.value, id: selectedAddrId.value });
    }
    saved.value = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { saved.value = false; }, 2000);
  } catch (e) {
    console.error('Erro ao salvar endereco:', e);
  }
}
</script>

<style scoped>
.fade-enter-active, .fade-leave-active { transition: opacity 0.3s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
