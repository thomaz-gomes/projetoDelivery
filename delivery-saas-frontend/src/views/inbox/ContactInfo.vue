<template>
  <div class="p-3">
    <div v-if="loading" class="text-center py-3">
      <div class="spinner-border spinner-border-sm"></div>
    </div>

    <!-- Customer found: show data -->
    <div v-else-if="customer">
      <!-- Name (editable) -->
      <div class="mb-2">
        <input type="text" class="form-control form-control-sm fw-semibold" v-model="customer.fullName" @blur="save('fullName', customer.fullName)" placeholder="Nome do contato" />
      </div>

      <!-- WhatsApp (read-only) -->
      <div class="mb-2 d-flex align-items-center gap-1">
        <i class="bi bi-whatsapp text-success"></i>
        <small class="text-muted">{{ formatPhone(customer.whatsapp) }}</small>
      </div>

      <!-- Classification badge -->
      <div v-if="customer.stats" class="mb-2">
        <span class="badge" :class="tierBadgeClass">
          {{ tierStars }} {{ customer.stats.label }}
        </span>
        <span v-if="customer.stats.favoriteItem" class="ms-1 small text-muted">
          <i class="bi bi-heart-fill text-danger" style="font-size: 0.6rem;"></i> {{ customer.stats.favoriteItem }}
        </span>
      </div>

      <!-- CPF, Email, Phone 2 -->
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

      <!-- Stats -->
      <div class="mt-2 small text-muted">
        <div>Cliente desde: {{ formatDate(customer.createdAt) }}</div>
        <div>Total gasto: R$ {{ Number(customer.stats?.totalSpent || 0).toFixed(2).replace('.', ',') }}</div>
        <div>Pedidos: {{ customer.stats?.totalOrders || 0 }}</div>
      </div>

      <transition name="fade">
        <div v-if="saved" class="small text-success mt-1"><i class="bi bi-check"></i> Salvo</div>
      </transition>
    </div>

    <!-- No customer: inline registration form -->
    <div v-else>
      <div class="fw-semibold small mb-2"><i class="bi bi-person-plus me-1"></i>Cadastrar cliente</div>
      <div class="mb-2">
        <label class="form-label small text-muted mb-0">Nome</label>
        <input type="text" class="form-control form-control-sm" v-model="newCustomer.fullName" placeholder="Nome do cliente" />
      </div>
      <div class="mb-2">
        <label class="form-label small text-muted mb-0">WhatsApp</label>
        <div class="d-flex align-items-center gap-1">
          <i class="bi bi-whatsapp text-success"></i>
          <input type="text" class="form-control form-control-sm bg-light" :value="formatPhone(phone)" readonly />
        </div>
      </div>
      <div class="mb-3">
        <label class="form-label small text-muted mb-0">CPF <span class="text-muted">(opcional)</span></label>
        <input type="text" class="form-control form-control-sm" v-model="newCustomer.cpf" placeholder="000.000.000-00" />
      </div>
      <button class="btn btn-sm btn-primary w-100" @click="createCustomer" :disabled="creating || !newCustomer.fullName.trim()">
        <span v-if="creating" class="spinner-border spinner-border-sm me-1"></span>
        {{ creating ? 'Cadastrando...' : 'Cadastrar' }}
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, computed } from 'vue';
import { useInboxStore } from '@/stores/inbox';
import api from '@/api';

const props = defineProps({
  customerId: String,
  phone: String,
  conversationId: String,
  contactName: String,
});

const inboxStore = useInboxStore();
const loading = ref(false);
const saved = ref(false);
const creating = ref(false);
let saveTimer = null;

const newCustomer = ref({ fullName: '', cpf: '' });

const customer = computed(() => {
  if (!props.customerId) return null;
  return inboxStore.customerCache[props.customerId] || null;
});

const tierBadgeClass = computed(() => {
  const tier = customer.value?.stats?.tier;
  const map = { vip: 'bg-success', fiel: 'bg-primary', regular: 'bg-warning text-dark', novo: 'bg-info', em_risco: 'bg-danger' };
  return map[tier] || 'bg-secondary';
});

const tierStars = computed(() => {
  const stars = customer.value?.stats?.stars || 0;
  return '\u2605'.repeat(stars) + '\u2606'.repeat(Math.max(0, 4 - stars));
});

function formatPhone(p) {
  if (!p) return '';
  return p.startsWith('55') ? p.slice(2) : p;
}

function formatDate(d) {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('pt-BR');
}

// Reset form when conversation changes + try to find customer by phone
watch(() => props.conversationId, async () => {
  newCustomer.value = { fullName: props.contactName || '', cpf: '' };

  // If no customerId, try to find by phone and auto-link
  if (!props.customerId && props.phone) {
    loading.value = true;
    try {
      await inboxStore.fetchCustomerByPhone(props.phone, props.conversationId);
    } catch (e) { /* ignore */ }
    finally { loading.value = false; }
  }
}, { immediate: true });

// Fetch customer data when customerId is set
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

async function createCustomer() {
  if (creating.value || !newCustomer.value.fullName.trim()) return;
  creating.value = true;
  try {
    const { data } = await api.post('/customers', {
      fullName: newCustomer.value.fullName.trim(),
      whatsapp: props.phone || '',
      cpf: newCustomer.value.cpf ? newCustomer.value.cpf.replace(/\D+/g, '') : null,
    });
    if (props.conversationId && data.id) {
      await inboxStore.linkCustomer(props.conversationId, data.id);
      await inboxStore.fetchCustomer(data.id);
    }
  } catch (e) {
    if (e.response?.status === 409) {
      // Customer exists — find by phone and link
      try {
        await inboxStore.fetchCustomerByPhone(props.phone, props.conversationId);
      } catch (linkErr) {
        console.error('Erro ao vincular cliente existente:', linkErr);
      }
    } else {
      console.error('Erro ao cadastrar cliente:', e);
    }
  } finally {
    creating.value = false;
  }
}
</script>

<style scoped>
.fade-enter-active, .fade-leave-active { transition: opacity 0.3s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
