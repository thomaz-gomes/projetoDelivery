<template>
  <div class="p-3">
    <div v-if="loading" class="text-center py-3">
      <div class="spinner-border spinner-border-sm"></div>
    </div>
    <div v-else-if="customer">
      <div class="mb-3">
        <input type="text" class="form-control form-control-sm fw-semibold" v-model="customer.fullName" @blur="save('fullName', customer.fullName)" placeholder="Nome do contato" />
      </div>
      <div class="mb-2 d-flex align-items-center gap-1">
        <i class="bi bi-whatsapp text-success"></i>
        <small class="text-muted">{{ customer.whatsapp }}</small>
      </div>
      <div class="mb-2">
        <label class="form-label small text-muted mb-0">CPF</label>
        <input type="text" class="form-control form-control-sm" v-model="customer.cpf" @blur="save('cpf', customer.cpf)" placeholder="000.000.000-00" />
      </div>
      <div class="mb-2">
        <label class="form-label small text-muted mb-0">Email</label>
        <input type="email" class="form-control form-control-sm" v-model="customer.email" @blur="save('email', customer.email)" />
      </div>
      <div class="mb-2">
        <label class="form-label small text-muted mb-0">Telefone 2</label>
        <input type="text" class="form-control form-control-sm" v-model="customer.phone" @blur="save('phone', customer.phone)" />
      </div>
      <div class="mt-3 small text-muted">
        <div>Cliente desde: {{ formatDate(customer.createdAt) }}</div>
        <div>Total gasto: R$ {{ Number(customer.totalSpent || 0).toFixed(2).replace('.', ',') }}</div>
        <div>Pedidos: {{ customer.orderCount || 0 }}</div>
      </div>
      <transition name="fade">
        <div v-if="saved" class="small text-success mt-1"><i class="bi bi-check"></i> Salvo</div>
      </transition>
    </div>
    <div v-else class="text-center text-muted py-3">
      <small>Sem cliente vinculado</small>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, computed } from 'vue';
import { useInboxStore } from '@/stores/inbox';

const props = defineProps({ customerId: String });
const inboxStore = useInboxStore();
const loading = ref(false);
const saved = ref(false);
let saveTimer = null;

const customer = computed(() => {
  if (!props.customerId) return null;
  return inboxStore.customerCache[props.customerId] || null;
});

watch(() => props.customerId, async (id) => {
  if (!id) return;
  if (inboxStore.customerCache[id]) return;
  loading.value = true;
  try { await inboxStore.fetchCustomer(id); } catch (e) { console.error(e); }
  finally { loading.value = false; }
}, { immediate: true });

async function save(field, value) {
  if (!props.customerId) return;
  try {
    await inboxStore.updateCustomerField(props.customerId, field, value);
    saved.value = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { saved.value = false; }, 2000);
  } catch (e) {
    console.error('Erro ao salvar:', e);
  }
}

function formatDate(d) {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('pt-BR');
}
</script>

<style scoped>
.fade-enter-active, .fade-leave-active { transition: opacity 0.3s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
