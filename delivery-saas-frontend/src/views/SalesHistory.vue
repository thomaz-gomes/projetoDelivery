<template>
  <div class="container py-3">
    
    <div class="card mb-3">
      <div class="card-body">
        <div class="row g-2 align-items-end">
          <div class="col-12"><h3>Histórico de Vendas</h3>
</div>
          <div class="col-md-3">
            <label class="form-label">Data início</label>
            <DateInput v-model="filters.from" inputClass="form-control" />
          </div>
          <div class="col-md-3">
            <label class="form-label">Data fim</label>
            <DateInput v-model="filters.to" inputClass="form-control" />
          </div>
          <div class="col-md-3">
            <label class="form-label">Entregador</label>
            <SelectInput v-model="filters.riderId" :options="riderOptions" optionValueKey="id" optionLabelKey="name" placeholder="Todos" />
          </div>
          <div class="col-md-3 text-end">
            <button class="btn btn-primary me-2" @click="load">Buscar</button>
            <button class="btn btn-outline-secondary" @click="reset">Limpar</button>
          </div>
        </div>
      </div>
    </div>

    <ListCard :title="`Pedidos (${orders.length})`" :subtitle="orders.length ? `${orders.length} itens` : ''" :quickSearch="true" quickSearchPlaceholder="Buscar por pedido, endereço ou cliente" @quick-search="onQuickSearch" @quick-clear="onQuickClear">
      <template #default>
        <div class="table-responsive">
          <table class="table table-hover mb-0">
            <thead class="table-light">
              <tr>
                <th>Nº Pedido</th>
                <th>Endereço</th>
                <th>Cliente</th>
                <th>Data</th>
                <th>Entregador</th>
                <th>Pagamento</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="o in paginatedOrders" :key="o.id">
                <td>{{ formatOrderNumber(o) }}</td>
                <td>{{ formatAddress(o) }}</td>
                <td>{{ o.customerName || o.customer?.fullName || o.customer?.name || o.customer?.contact || '-' }}</td>
                <td>{{ formatDate(o.createdAt) }}</td>
                <td>{{ o.rider?.name || '-' }}</td>
                <td>{{ getPaymentMethod(o) || '-' }}</td>
                <td class="text-end">
                  <button class="btn btn-sm btn-outline-primary" @click="viewDetails(o)">Ver</button>
                </td>
              </tr>
              <tr v-if="displayed.length === 0">
                <td colspan="7" class="text-center py-4">Nenhum pedido encontrado para o período.</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Paginação -->
        <div v-if="totalPages > 1" class="d-flex justify-content-between align-items-center p-3 border-top">
          <div class="text-muted">
            Mostrando {{ (currentPage - 1) * itemsPerPage + 1 }} até {{ Math.min(currentPage * itemsPerPage, displayed.length) }} de {{ displayed.length }} pedidos
          </div>
          <nav>
            <ul class="pagination mb-0">
              <li class="page-item" :class="{ disabled: currentPage === 1 }">
                <button class="page-link" @click="currentPage = 1" :disabled="currentPage === 1">Primeira</button>
              </li>
              <li class="page-item" :class="{ disabled: currentPage === 1 }">
                <button class="page-link" @click="currentPage--" :disabled="currentPage === 1">Anterior</button>
              </li>
              <li 
                v-for="page in visiblePages" 
                :key="page" 
                class="page-item" 
                :class="{ active: currentPage === page }"
              >
                <button class="page-link" @click="currentPage = page">{{ page }}</button>
              </li>
              <li class="page-item" :class="{ disabled: currentPage === totalPages }">
                <button class="page-link" @click="currentPage++" :disabled="currentPage === totalPages">Próxima</button>
              </li>
              <li class="page-item" :class="{ disabled: currentPage === totalPages }">
                <button class="page-link" @click="currentPage = totalPages" :disabled="currentPage === totalPages">Última</button>
              </li>
            </ul>
          </nav>
        </div>
      </template>
    </ListCard>
  </div>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue';
import { useRouter } from 'vue-router';
import api from '../api';
import SelectInput from '../components/form/select/SelectInput.vue';
import { formatDate } from '../utils/dates.js';
import DateInput from '../components/form/date/DateInput.vue';
import ListCard from '../components/ListCard.vue';

const router = useRouter();
const orders = ref([]);
const q = ref('');
const currentPage = ref(1);
const itemsPerPage = ref(20);

const displayed = computed(() => {
  if(!q.value) return orders.value || []
  const term = q.value.toLowerCase()
  return (orders.value || []).filter(o => {
    const addr = formatAddress(o) || ''
    const customer = o.customerName || (o.customer && (o.customer.fullName || o.customer.name || o.customer.contact)) || ''
    const num = formatOrderNumber(o) || ''
    return (addr + ' ' + customer + ' ' + num).toLowerCase().includes(term)
  })
})

const totalPages = computed(() => {
  return Math.ceil(displayed.value.length / itemsPerPage.value);
});

const paginatedOrders = computed(() => {
  const start = (currentPage.value - 1) * itemsPerPage.value;
  const end = start + itemsPerPage.value;
  return displayed.value.slice(start, end);
});

const riders = ref([]);

// default date filter: today in YYYY-MM-DD (local) format
const today = (() => {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
})();

const filters = ref({ from: today, to: today, riderId: '' });

const riderOptions = ref([]);

// use shared formatDateTime from utils/dates.js

function padNumber(n){
  if (n == null || n === '') return null;
  return String(n).toString().padStart(2, '0');
}

function formatOrderNumber(o){
  if(!o) return '';
  if(o.displaySimple) return o.displaySimple;
  if(o.displayId !== undefined && o.displayId !== null) {
    const p = padNumber(o.displayId);
    return p ? p : String(o.displayId);
  }
  // prefer `number` when backend exposes the per-day number in that field
  if(o.number !== undefined && o.number !== null) return String(o.number);
  // fallback to a short id
  return o.id ? String(o.id).slice(0,6) : '';
}

function formatAddress(o){
  if(!o) return '-';
  const a = o.address || o.deliveryAddress || o.customerAddress || o.payload?.delivery?.deliveryAddress;
  if(!a) return o.addressText || '-';
  if (typeof a === 'string') return a || o.addressText || '-'
  const main = a.formatted || a.formattedAddress || [a.street || a.streetName, a.number || a.streetNumber].filter(Boolean).join(', ');
  const tail = []
  if(a.neighborhood) tail.push(a.neighborhood)
  if(a.complement) tail.push('Comp: ' + a.complement)
  if(a.reference) tail.push('Ref: ' + a.reference)
  if(a.observation) tail.push('Obs: ' + a.observation)
  if(a.city && !tail.includes(a.city)) tail.push(a.city)
  return [main, tail.filter(Boolean).join(' — ')].filter(Boolean).join(' | ')
}

function getPaymentMethod(o){
  if(!o) return ''
  try{
    const payment = o.payment || o.paymentMethod || o.payload?.payment || o.payload?.rawPayload?.payment
    if(!payment) return ''
    const method = (payment.method || payment.methodCode || payment.name || payment.type || '').toString()
    const labels = { 'PIX':'PIX', 'CREDIT_CARD':'Cartão de Crédito', 'DEBIT_CARD':'Cartão de Débito', 'CASH':'Dinheiro', 'MONEY':'Dinheiro', 'VOUCHER':'Vale', 'ONLINE':'Online', 'Dinheiro':'Dinheiro', 'Crédito':'Crédito' }
    return labels[method] || method || ''
  }catch(e){ return '' }
}

async function load(){
  try{
    const params = {};
    if(filters.value.from) params.from = filters.value.from;
    if(filters.value.to) params.to = filters.value.to;
    if(filters.value.riderId) params.riderId = filters.value.riderId;
    const { data } = await api.get('/orders', { params });
    orders.value = Array.isArray(data) ? data : (data?.orders || []);
  }catch(e){
    console.error('load orders failed', e?.message || e);
    orders.value = [];
  }
}

async function loadRiders(){
  try{
    const { data } = await api.get('/riders');
    riders.value = Array.isArray(data) ? data : (data?.riders || []);
    riderOptions.value = riders.value.map(r => ({ id: r.id, name: r.fullName || r.name }));
  }catch(e){
    riderOptions.value = [];
  }
}

function reset(){ 
  filters.value = { from: today, to: today, riderId: '' }; 
  orders.value = []; 
  currentPage.value = 1;
}

function viewDetails(o){
  router.push({ path: `/sales/${o.id}` });
}

const visiblePages = computed(() => {
  const pages = [];
  const total = totalPages.value;
  const current = currentPage.value;
  
  if (total <= 7) {
    for (let i = 1; i <= total; i++) {
      pages.push(i);
    }
  } else {
    if (current <= 4) {
      for (let i = 1; i <= 5; i++) pages.push(i);
      pages.push('...');
      pages.push(total);
    } else if (current >= total - 3) {
      pages.push(1);
      pages.push('...');
      for (let i = total - 4; i <= total; i++) pages.push(i);
    } else {
      pages.push(1);
      pages.push('...');
      for (let i = current - 1; i <= current + 1; i++) pages.push(i);
      pages.push('...');
      pages.push(total);
    }
  }
  
  return pages.filter(p => p !== '...' || pages.indexOf(p) === pages.lastIndexOf(p));
});

onMounted(()=>{ loadRiders(); load(); });

function onQuickSearch(val){ 
  q.value = val;
  currentPage.value = 1;
}

function onQuickClear(){ 
  q.value = '';
  currentPage.value = 1;
}
</script>

<style scoped>
.card { overflow: hidden; }
</style>
