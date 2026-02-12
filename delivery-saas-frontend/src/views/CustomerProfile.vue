<script setup>
import { ref, onMounted, computed, reactive } from 'vue';
import { formatCurrency, formatDate } from '../utils/formatters.js';
import { useRoute } from 'vue-router';
import { useCustomersStore } from '../stores/customers';
import BaseButton from '../components/BaseButton.vue';
import TextInput from '../components/form/input/TextInput.vue';
import Swal from 'sweetalert2';
import api from '../api';

const route = useRoute();
const store = useCustomersStore();

const activeTab = ref('dados');

// Orders pagination
const ordersPage = ref(1);
const ordersPerPage = 10;
const totalOrderPages = computed(() => Math.ceil(store.ordersTotal / ordersPerPage));

// Address edit modal
const editingAddress = ref(null);
const editForm = reactive({
  label: '', street: '', number: '', complement: '', neighborhood: '',
  reference: '', observation: '', city: '', state: '', postalCode: '',
});

// Order detail modal
const selectedOrder = ref(null);

onMounted(async () => {
  await store.get(route.params.id);
  await loadOrders(1);
  loadCashback();
});

const stats = computed(() => store.current?.stats || {});

const tierConfig = {
  em_risco: { color: '#dc3545', bg: 'rgba(220,53,69,0.1)', icon: 'bi-exclamation-triangle' },
  regular:  { color: '#ffc107', bg: 'rgba(255,193,7,0.1)',  icon: 'bi-person' },
  fiel:     { color: '#0d6efd', bg: 'rgba(13,110,253,0.1)', icon: 'bi-star' },
  vip:      { color: '#198754', bg: 'rgba(25,135,84,0.1)',   icon: 'bi-trophy' },
};

const currentTier = computed(() => tierConfig[stats.value.tier] || tierConfig.em_risco);

function starsHtml(stars) {
  return '\u2605'.repeat(stars || 0) + '\u2606'.repeat(4 - (stars || 0));
}

function statusLabel(s) {
  const map = { EM_PREPARO: 'Em preparo', SAIU_PARA_ENTREGA: 'Saiu p/ entrega', CONFIRMACAO_PAGAMENTO: 'Conf. pagamento', CONCLUIDO: 'Concluído', CANCELADO: 'Cancelado', INVOICE_AUTHORIZED: 'NF-e emitida' };
  return map[s] || s;
}

function statusColor(s) {
  const map = { EM_PREPARO: '#ffc107', SAIU_PARA_ENTREGA: '#0d6efd', CONFIRMACAO_PAGAMENTO: '#6f42c1', CONCLUIDO: '#198754', CANCELADO: '#dc3545', INVOICE_AUTHORIZED: '#0dcaf0' };
  return map[s] || '#6c757d';
}

// Address operations
async function setDefault(addressId) {
  try {
    await store.setDefaultAddress(store.current.id, addressId);
  } catch (e) {
    Swal.fire({ icon: 'error', text: e.response?.data?.message || 'Erro ao definir endereço padrão' });
  }
}

function openEditAddress(address) {
  editingAddress.value = address;
  Object.assign(editForm, {
    label: address.label || '',
    street: address.street || '',
    number: address.number || '',
    complement: address.complement || '',
    neighborhood: address.neighborhood || '',
    reference: address.reference || '',
    observation: address.observation || '',
    city: address.city || '',
    state: address.state || '',
    postalCode: address.postalCode || '',
  });
}

async function saveAddress() {
  try {
    await store.updateAddress(store.current.id, editingAddress.value.id, { ...editForm });
    editingAddress.value = null;
    Swal.fire({ icon: 'success', text: 'Endereço atualizado', timer: 1500, showConfirmButton: false });
  } catch (e) {
    Swal.fire({ icon: 'error', text: e.response?.data?.message || 'Erro ao salvar' });
  }
}

async function deleteAddress(address) {
  const r = await Swal.fire({
    title: 'Excluir endereço?',
    text: address.formatted || [address.street, address.number].filter(Boolean).join(', ') || 'Este endereço',
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: 'Excluir',
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#dc3545',
  });
  if (!r.isConfirmed) return;
  try {
    await store.deleteAddress(store.current.id, address.id);
    Swal.fire({ icon: 'success', text: 'Endereço removido', timer: 1500, showConfirmButton: false });
  } catch (e) {
    Swal.fire({ icon: 'error', text: e.response?.data?.message || 'Erro ao excluir' });
  }
}

// Orders pagination
async function loadOrders(page = 1) {
  ordersPage.value = page;
  await store.fetchOrders(store.current.id, { skip: (page - 1) * ordersPerPage, take: ordersPerPage });
}

function orderDisplayId(o) {
  if (o.displaySimple != null) return String(o.displaySimple).padStart(2, '0');
  if (o.displayId != null) return String(o.displayId).padStart(2, '0');
  return o.id.slice(0, 6);
}

// Cashback
const cashbackEnabled = ref(false);
const cashbackLoading = ref(false);
const cashbackBalance = ref(0);
const cashbackTransactions = ref([]);
const manualCashbackAmount = ref('');
const manualCashbackDesc = ref('');

async function loadCashback() {
  if (!store.current?.id) return;
  cashbackLoading.value = true;
  try {
    const res = await api.get(`/cashback/wallet?clientId=${store.current.id}`);
    cashbackBalance.value = Number(res.data?.balance || 0);
    cashbackTransactions.value = Array.isArray(res.data?.transactions) ? res.data.transactions : [];
    cashbackEnabled.value = true;
  } catch (e) {
    cashbackEnabled.value = false;
  } finally {
    cashbackLoading.value = false;
  }
}

async function manualCredit() {
  const amount = Number(manualCashbackAmount.value);
  if (!(amount > 0)) return Swal.fire({ icon: 'warning', text: 'Informe um valor maior que 0' });
  try {
    await api.post('/cashback/credit', {
      clientId: store.current.id,
      amount,
      description: manualCashbackDesc.value || 'Crédito manual (admin)',
    });
    manualCashbackAmount.value = '';
    manualCashbackDesc.value = '';
    Swal.fire({ icon: 'success', text: 'Crédito adicionado', timer: 1500, showConfirmButton: false });
    await loadCashback();
  } catch (e) {
    Swal.fire({ icon: 'error', text: e.response?.data?.message || 'Erro ao creditar' });
  }
}

async function manualDebit() {
  const amount = Number(manualCashbackAmount.value);
  if (!(amount > 0)) return Swal.fire({ icon: 'warning', text: 'Informe um valor maior que 0' });
  if (amount > cashbackBalance.value) return Swal.fire({ icon: 'warning', text: 'Saldo insuficiente' });
  try {
    await api.post('/cashback/debit', {
      clientId: store.current.id,
      amount,
      description: manualCashbackDesc.value || 'Débito manual (admin)',
    });
    manualCashbackAmount.value = '';
    manualCashbackDesc.value = '';
    Swal.fire({ icon: 'success', text: 'Débito realizado', timer: 1500, showConfirmButton: false });
    await loadCashback();
  } catch (e) {
    Swal.fire({ icon: 'error', text: e.response?.data?.message || 'Erro ao debitar' });
  }
}
</script>

<template>
  <div v-if="store.current" class="container py-4">
    <!-- Cabeçalho -->
    <div class="d-flex justify-content-between align-items-center mb-4 flex-wrap gap-2">
      <div class="d-flex align-items-center gap-3">
        <div class="profile-avatar" :style="{ background: currentTier.bg, color: currentTier.color }">
          {{ (store.current.fullName || '?')[0].toUpperCase() }}
        </div>
        <div>
          <h2 class="h4 fw-bold mb-0">{{ store.current.fullName }}</h2>
          <div class="d-flex align-items-center gap-2 mt-1">
            <span class="tier-stars" :style="{ color: currentTier.color }">{{ starsHtml(stats.stars) }}</span>
            <span class="badge tier-badge" :style="{ background: currentTier.bg, color: currentTier.color }">
              <i :class="'bi ' + currentTier.icon + ' me-1'"></i>{{ stats.label || 'Em Risco' }}
            </span>
          </div>
        </div>
      </div>
      <div class="d-flex gap-2">
        <BaseButton variant="outline" @click="$router.push('/customers')">
          <i class="bi bi-arrow-left me-1"></i> Voltar
        </BaseButton>
        <BaseButton variant="primary" @click="$router.push(`/customers/${store.current.id}/edit`)">
          <i class="bi bi-pencil me-1"></i> Editar
        </BaseButton>
        <BaseButton variant="success" @click="$router.push(`/customers/${store.current.id}/edit?addAddress=1`)">
          <i class="bi bi-geo-alt me-1"></i> Novo endereço
        </BaseButton>
      </div>
    </div>

    <!-- Cards de Indicadores -->
    <div class="row g-3 mb-4">
      <div class="col-md-3 col-6">
        <div class="stat-card" style="border-left: 4px solid #198754;">
          <div class="stat-label">Total gasto</div>
          <div class="stat-value text-success">{{ formatCurrency(stats.totalSpent || 0) }}</div>
          <div class="stat-sub">{{ stats.totalOrders || 0 }} pedidos concluídos</div>
        </div>
      </div>
      <div class="col-md-3 col-6">
        <div class="stat-card" style="border-left: 4px solid #0d6efd;">
          <div class="stat-label">Último pedido</div>
          <div class="stat-value text-primary">{{ formatDate(stats.lastOrderDate) }}</div>
          <div class="stat-sub">{{ store.current.orders?.length || 0 }} pedidos no total</div>
        </div>
      </div>
      <div class="col-md-3 col-6">
        <div class="stat-card" style="border-left: 4px solid #6f42c1;">
          <div class="stat-label">Item favorito</div>
          <div class="stat-value text-purple">{{ stats.favoriteItem || 'Nenhum' }}</div>
          <div class="stat-sub">Mais pedido pelo cliente</div>
        </div>
      </div>
      <div class="col-md-3 col-6">
        <div class="stat-card" :style="{ borderLeft: '4px solid ' + currentTier.color }">
          <div class="stat-label">Classificação</div>
          <div class="stat-value" :style="{ color: currentTier.color }">
            {{ starsHtml(stats.stars) }}
          </div>
          <div class="stat-sub">
            <span class="badge" :style="{ background: currentTier.bg, color: currentTier.color }">{{ stats.label || 'Em Risco' }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Tabs -->
    <ul class="nav nav-tabs mb-4">
      <li class="nav-item">
        <a class="nav-link" :class="{ active: activeTab === 'dados' }" href="#" @click.prevent="activeTab = 'dados'">
          <i class="bi bi-person-vcard me-1"></i> Dados / Endereços
        </a>
      </li>
      <li class="nav-item">
        <a class="nav-link" :class="{ active: activeTab === 'pedidos' }" href="#" @click.prevent="activeTab = 'pedidos'; loadOrders(1)">
          <i class="bi bi-bag me-1"></i> Pedidos
          <span class="badge bg-light text-dark ms-1">{{ store.ordersTotal }}</span>
        </a>
      </li>
      <li v-if="cashbackEnabled" class="nav-item">
        <a class="nav-link" :class="{ active: activeTab === 'cashback' }" href="#" @click.prevent="activeTab = 'cashback'; loadCashback()">
          <i class="bi bi-wallet2 me-1"></i> Cashback
        </a>
      </li>
    </ul>

    <!-- Tab: Dados / Endereços -->
    <div v-show="activeTab === 'dados'">
      <div class="row g-4">
        <div class="col-lg-6">
          <div class="card">
            <div class="card-header bg-white fw-semibold d-flex align-items-center gap-2">
              <i class="bi bi-person-vcard text-primary"></i> Dados do cliente
            </div>
            <div class="card-body">
              <div class="row g-3">
                <div class="col-sm-4">
                  <div class="info-label">CPF</div>
                  <div class="info-value">{{ store.current.cpf || '—' }}</div>
                </div>
                <div class="col-sm-4">
                  <div class="info-label">WhatsApp</div>
                  <div class="info-value">{{ store.current.whatsapp || '—' }}</div>
                </div>
                <div class="col-sm-4">
                  <div class="info-label">Telefone</div>
                  <div class="info-value">{{ store.current.phone || '—' }}</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="col-lg-6">
          <div class="card">
            <div class="card-header bg-white fw-semibold d-flex align-items-center justify-content-between">
              <div class="d-flex align-items-center gap-2">
                <i class="bi bi-geo-alt text-primary"></i> Endereços
                <span class="badge bg-light text-dark">{{ store.current.addresses?.length || 0 }}</span>
              </div>
            </div>
            <div class="card-body p-0">
              <div
                v-for="(a, i) in store.current.addresses"
                :key="a.id"
                class="address-item"
              >
                <div class="d-flex justify-content-between align-items-start">
                  <div class="d-flex gap-3 align-items-start flex-grow-1">
                    <div class="pt-1">
                      <input
                        type="radio"
                        class="form-check-input"
                        name="default-addr"
                        :checked="a.isDefault"
                        @change="setDefault(a.id)"
                        title="Definir como padrão"
                      />
                    </div>
                    <div>
                      <div class="fw-medium">
                        {{ a.label || 'Endereço ' + (i + 1) }}
                        <span v-if="a.isDefault" class="badge bg-success-subtle text-success ms-1">Padrão</span>
                      </div>
                      <div class="mt-1">
                        <div v-if="a.formatted && !a.street">{{ a.formatted }}</div>
                        <div v-else>
                          {{ [a.street, a.number].filter(Boolean).join(', ') }}
                          <span v-if="a.complement"> — {{ a.complement }}</span>
                        </div>
                      </div>
                      <div class="small text-muted mt-1">
                        <span v-if="a.neighborhood">{{ a.neighborhood }} — </span>
                        <span v-if="a.city || a.state">{{ [a.city, a.state].filter(Boolean).join('/') }}</span>
                        <span v-if="(a.postalCode || a.zip || a.postal_code)"> | CEP {{ a.postalCode || a.zip || a.postal_code }}</span>
                      </div>
                      <div v-if="a.reference" class="small text-muted">Ref: {{ a.reference }}</div>
                    </div>
                  </div>
                  <div class="d-flex gap-1">
                    <button class="btn btn-sm btn-outline-primary" @click="openEditAddress(a)" title="Editar">
                      <i class="bi bi-pencil"></i>
                    </button>
                    <button class="btn btn-sm btn-outline-danger" @click="deleteAddress(a)" title="Excluir">
                      <i class="bi bi-trash"></i>
                    </button>
                    <a v-if="a.latitude && a.longitude" :href="`https://www.google.com/maps?q=${a.latitude},${a.longitude}`" target="_blank" class="btn btn-sm btn-outline-secondary" title="Ver no mapa">
                      <i class="bi bi-geo-alt"></i>
                    </a>
                  </div>
                </div>
              </div>

              <div
                v-if="!store.current.addresses?.length"
                class="text-muted text-center py-4 small"
              >
                Nenhum endereço cadastrado.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Tab: Pedidos -->
    <div v-show="activeTab === 'pedidos'">
      <div class="card">
        <div class="card-header bg-white fw-semibold d-flex align-items-center justify-content-between">
          <div class="d-flex align-items-center gap-2">
            <i class="bi bi-bag text-primary"></i> Pedidos
            <span class="badge bg-light text-dark">{{ store.ordersTotal }}</span>
          </div>
        </div>
        <div class="card-body p-0">
          <div
            v-for="o in store.orders"
            :key="o.id"
            class="order-item order-item-clickable"
            @click="selectedOrder = o"
          >
            <div class="d-flex justify-content-between align-items-start">
              <div>
                <div class="fw-medium">#{{ orderDisplayId(o) }}</div>
                <div class="small text-muted">{{ formatDate(o.createdAt) }}</div>
                <div v-if="o.items?.length" class="small text-muted mt-1">
                  {{ o.items.map(i => `${i.quantity}x ${i.name}`).join(', ') }}
                </div>
              </div>
              <div class="text-end">
                <div class="fw-semibold">{{ formatCurrency(Number(o.total || 0)) }}</div>
                <span class="badge" :style="{ background: statusColor(o.status) + '1a', color: statusColor(o.status) }">
                  {{ statusLabel(o.status) }}
                </span>
              </div>
            </div>
          </div>

          <div v-if="!store.orders?.length && !store.ordersLoading" class="text-muted text-center py-4 small">
            Nenhum pedido encontrado.
          </div>
          <div v-if="store.ordersLoading" class="text-center py-4">
            <div class="spinner-border spinner-border-sm text-secondary"></div>
          </div>
        </div>

        <!-- Paginação -->
        <div v-if="totalOrderPages > 1" class="d-flex justify-content-between align-items-center p-3 border-top">
          <div class="text-muted small">
            Página {{ ordersPage }} de {{ totalOrderPages }} ({{ store.ordersTotal }} pedidos)
          </div>
          <nav>
            <ul class="pagination pagination-sm mb-0">
              <li class="page-item" :class="{ disabled: ordersPage === 1 }">
                <button class="page-link" @click="loadOrders(ordersPage - 1)" :disabled="ordersPage === 1">Anterior</button>
              </li>
              <li
                v-for="p in totalOrderPages"
                :key="p"
                class="page-item"
                :class="{ active: p === ordersPage }"
              >
                <button class="page-link" @click="loadOrders(p)">{{ p }}</button>
              </li>
              <li class="page-item" :class="{ disabled: ordersPage >= totalOrderPages }">
                <button class="page-link" @click="loadOrders(ordersPage + 1)" :disabled="ordersPage >= totalOrderPages">Próxima</button>
              </li>
            </ul>
          </nav>
        </div>
      </div>
    </div>

    <!-- Tab: Cashback -->
    <div v-show="activeTab === 'cashback'">
      <div class="row g-4">
        <div class="col-lg-5">
          <div class="card">
            <div class="card-header bg-white fw-semibold d-flex align-items-center gap-2">
              <i class="bi bi-wallet2 text-success"></i> Saldo de Cashback
            </div>
            <div class="card-body">
              <div v-if="cashbackLoading" class="text-center py-3"><div class="spinner-border spinner-border-sm text-secondary"></div></div>
              <div v-else>
                <div class="text-center mb-3">
                  <div class="small text-muted">Saldo atual</div>
                  <div class="fs-3 fw-bold text-success">{{ formatCurrency(cashbackBalance) }}</div>
                </div>
                <hr>
                <div class="small fw-semibold mb-2">Crédito / Débito manual</div>
                <div class="row g-2 mb-2">
                  <div class="col-12">
                    <TextInput label="Valor (R$)" v-model="manualCashbackAmount" type="number" step="0.01" min="0" inputClass="form-control" />
                  </div>
                  <div class="col-12">
                    <TextInput label="Descrição (opcional)" v-model="manualCashbackDesc" inputClass="form-control" />
                  </div>
                </div>
                <div class="d-flex gap-2">
                  <BaseButton variant="success" size="sm" @click="manualCredit">
                    <i class="bi bi-plus-circle me-1"></i> Creditar
                  </BaseButton>
                  <BaseButton variant="outline" size="sm" @click="manualDebit">
                    <i class="bi bi-dash-circle me-1"></i> Debitar
                  </BaseButton>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="col-lg-7">
          <div class="card">
            <div class="card-header bg-white fw-semibold d-flex align-items-center gap-2">
              <i class="bi bi-clock-history text-primary"></i> Histórico de Transações
              <span class="badge bg-light text-dark">{{ cashbackTransactions.length }}</span>
            </div>
            <div class="card-body p-0">
              <div v-if="cashbackLoading" class="text-center py-4"><div class="spinner-border spinner-border-sm text-secondary"></div></div>
              <div v-else-if="!cashbackTransactions.length" class="text-muted text-center py-4 small">
                Nenhuma transação de cashback encontrada.
              </div>
              <div v-else>
                <div
                  v-for="t in cashbackTransactions"
                  :key="t.id"
                  class="cashback-tx-item"
                >
                  <div class="d-flex justify-content-between align-items-start">
                    <div>
                      <div class="fw-medium">
                        <span :class="t.type === 'CREDIT' ? 'text-success' : 'text-danger'">
                          {{ t.type === 'CREDIT' ? 'Crédito' : 'Débito' }}
                        </span>
                      </div>
                      <div class="small text-muted">{{ t.description || '—' }}</div>
                      <div class="small text-muted">{{ formatDate(t.createdAt) }}</div>
                    </div>
                    <div class="text-end">
                      <div class="fw-semibold" :class="t.type === 'CREDIT' ? 'text-success' : 'text-danger'">
                        {{ t.type === 'CREDIT' ? '+' : '-' }}{{ formatCurrency(Number(t.amount || 0)) }}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Modal: Editar Endereço -->
    <div v-if="editingAddress" class="modal-overlay" @click.self="editingAddress = null">
      <div class="modal-box">
        <div class="d-flex justify-content-between align-items-center mb-3">
          <h5 class="mb-0">Editar Endereço</h5>
          <button class="btn-close" @click="editingAddress = null"></button>
        </div>
        <form @submit.prevent="saveAddress">
          <div class="row g-2">
            <div class="col-12">
              <TextInput label="Rótulo" v-model="editForm.label" placeholder="Casa, Trabalho..." inputClass="form-control" />
            </div>
            <div class="col-8">
              <TextInput label="Rua" v-model="editForm.street" inputClass="form-control" />
            </div>
            <div class="col-4">
              <TextInput label="Número" v-model="editForm.number" inputClass="form-control" />
            </div>
            <div class="col-6">
              <TextInput label="Complemento" v-model="editForm.complement" inputClass="form-control" />
            </div>
            <div class="col-6">
              <TextInput label="Bairro" v-model="editForm.neighborhood" inputClass="form-control" />
            </div>
            <div class="col-6">
              <TextInput label="Cidade" v-model="editForm.city" inputClass="form-control" />
            </div>
            <div class="col-3">
              <TextInput label="UF" v-model="editForm.state" maxlength="2" inputClass="form-control text-uppercase" />
            </div>
            <div class="col-3">
              <TextInput label="CEP" v-model="editForm.postalCode" inputClass="form-control" />
            </div>
            <div class="col-6">
              <TextInput label="Referência" v-model="editForm.reference" inputClass="form-control" />
            </div>
            <div class="col-6">
              <TextInput label="Observação" v-model="editForm.observation" inputClass="form-control" />
            </div>
          </div>
          <div class="d-flex justify-content-end gap-2 mt-3">
            <BaseButton variant="outline" type="button" @click="editingAddress = null">Cancelar</BaseButton>
            <BaseButton variant="primary" type="submit">Salvar</BaseButton>
          </div>
        </form>
      </div>
    </div>

    <!-- Modal: Detalhes do Pedido -->
    <div v-if="selectedOrder" class="modal-overlay" @click.self="selectedOrder = null">
      <div class="modal-box modal-box-lg">
        <div class="d-flex justify-content-between align-items-center mb-3">
          <h5 class="mb-0">Pedido #{{ orderDisplayId(selectedOrder) }}</h5>
          <button class="btn-close" @click="selectedOrder = null"></button>
        </div>

        <div class="row g-3 mb-3">
          <div class="col-sm-4">
            <div class="info-label">Data</div>
            <div class="info-value">{{ formatDate(selectedOrder.createdAt) }}</div>
          </div>
          <div class="col-sm-4">
            <div class="info-label">Status</div>
            <span class="badge" :style="{ background: statusColor(selectedOrder.status) + '1a', color: statusColor(selectedOrder.status) }">
              {{ statusLabel(selectedOrder.status) }}
            </span>
          </div>
          <div class="col-sm-4">
            <div class="info-label">Total</div>
            <div class="info-value fw-bold">{{ formatCurrency(Number(selectedOrder.total || 0)) }}</div>
          </div>
        </div>

        <div v-if="selectedOrder.address" class="mb-3">
          <div class="info-label">Endereço de entrega</div>
          <div class="info-value">{{ selectedOrder.address }}</div>
        </div>

        <div v-if="selectedOrder.orderType" class="mb-3">
          <div class="info-label">Tipo</div>
          <div class="info-value">{{ selectedOrder.orderType === 'delivery' ? 'Entrega' : selectedOrder.orderType === 'pickup' ? 'Retirada' : selectedOrder.orderType }}</div>
        </div>

        <div v-if="selectedOrder.couponCode" class="mb-3">
          <div class="info-label">Cupom</div>
          <div class="info-value">{{ selectedOrder.couponCode }} (-{{ formatCurrency(Number(selectedOrder.couponDiscount || 0)) }})</div>
        </div>

        <h6 class="fw-semibold mt-3">Itens</h6>
        <table class="table table-sm">
          <thead>
            <tr>
              <th>Qtd</th>
              <th>Item</th>
              <th class="text-end">Preço</th>
              <th class="text-end">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(item, idx) in selectedOrder.items" :key="idx">
              <td>{{ item.quantity }}</td>
              <td>
                {{ item.name }}
                <div v-if="item.notes" class="small text-muted">{{ item.notes }}</div>
              </td>
              <td class="text-end">{{ formatCurrency(Number(item.price || 0)) }}</td>
              <td class="text-end">{{ formatCurrency(Number(item.price || 0) * item.quantity) }}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr v-if="selectedOrder.deliveryFee">
              <td colspan="3" class="text-end text-muted">Taxa de entrega</td>
              <td class="text-end">{{ formatCurrency(Number(selectedOrder.deliveryFee || 0)) }}</td>
            </tr>
            <tr v-if="selectedOrder.couponDiscount">
              <td colspan="3" class="text-end text-muted">Desconto cupom</td>
              <td class="text-end text-danger">-{{ formatCurrency(Number(selectedOrder.couponDiscount || 0)) }}</td>
            </tr>
            <tr class="fw-bold">
              <td colspan="3" class="text-end">Total</td>
              <td class="text-end">{{ formatCurrency(Number(selectedOrder.total || 0)) }}</td>
            </tr>
          </tfoot>
        </table>

        <div class="text-end mt-3">
          <BaseButton variant="outline" @click="selectedOrder = null">Fechar</BaseButton>
        </div>
      </div>
    </div>
  </div>

  <div v-else class="container py-5 text-center text-muted">
    <div class="spinner-border text-secondary mb-3"></div>
    <p>Carregando dados do cliente...</p>
  </div>
</template>

<style scoped>
.profile-avatar {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 1.5rem;
  flex-shrink: 0;
}
.tier-stars {
  font-size: 1.05rem;
  letter-spacing: 1px;
}
.tier-badge {
  font-size: 0.75rem;
  font-weight: 600;
  padding: 3px 10px;
  border-radius: 12px;
}

/* Stat cards */
.stat-card {
  background: #fff;
  border: 1px solid #e9ecef;
  border-radius: 10px;
  padding: 16px 18px;
  height: 100%;
}
.stat-label {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #6c757d;
  margin-bottom: 4px;
}
.stat-value {
  font-size: 1.25rem;
  font-weight: 700;
  line-height: 1.3;
}
.stat-sub {
  font-size: 0.78rem;
  color: #adb5bd;
  margin-top: 4px;
}
.text-purple { color: #6f42c1; }

/* Info fields */
.info-label {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: #6c757d;
  margin-bottom: 2px;
}
.info-value {
  font-size: 0.95rem;
  font-weight: 500;
}

/* Address items */
.address-item {
  padding: 14px 18px;
  border-bottom: 1px solid #f0f0f0;
}
.address-item:last-child {
  border-bottom: none;
}
.address-item:hover {
  background: #f9fafb;
}

/* Order items */
.order-item {
  padding: 12px 18px;
  border-bottom: 1px solid #f0f0f0;
}
.order-item:last-child {
  border-bottom: none;
}
.order-item-clickable {
  cursor: pointer;
}
.order-item-clickable:hover {
  background: #f0f4ff;
}

/* Card headers */
.card-header {
  border-bottom: 1px solid #e9ecef;
  padding: 12px 18px;
}

/* Tabs */
.nav-tabs .nav-link.active {
  font-weight: 600;
}

/* Modal overlay */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1050;
}
.modal-box {
  background: #fff;
  border-radius: 12px;
  padding: 24px;
  width: 90%;
  max-width: 520px;
  max-height: 90vh;
  overflow-y: auto;
}
.modal-box-lg {
  max-width: 680px;
}

/* Cashback tx items */
.cashback-tx-item {
  padding: 12px 18px;
  border-bottom: 1px solid #f0f0f0;
}
.cashback-tx-item:last-child {
  border-bottom: none;
}
</style>
