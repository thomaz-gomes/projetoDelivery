<template>
  <div class="container py-3">
    <h1 class="mb-3">Histórico de Vendas</h1>

    <div class="card mb-3">
      <div class="card-body">
        <div class="row g-2 align-items-end">
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
              <tr v-for="o in displayed" :key="o.id">
                <td>{{ formatOrderNumber(o) }}</td>
                <td>{{ formatAddress(o) }}</td>
                <td>{{ o.customer?.fullName || o.customer?.name || o.customer?.contact || '-' }}</td>
                <td>{{ formatDate(o.createdAt) }}</td>
                <td>{{ o.rider?.name || '-' }}</td>
                <td>{{ o.paymentMethod || o.payment?.method || '-' }}</td>
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

const router = useRouter();
const orders = ref([]);
const q = ref('')

const displayed = computed(() => {
  if(!q.value) return orders.value || []
  const term = q.value.toLowerCase()
  return (orders.value || []).filter(o => {
    const addr = formatAddress(o) || ''
    const customer = (o.customer && (o.customer.fullName || o.customer.name || o.customer.contact)) || ''
    const num = formatOrderNumber(o) || ''
    return (addr + ' ' + customer + ' ' + num).toLowerCase().includes(term)
  })
})
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
  const a = o.address || o.deliveryAddress || o.customerAddress;
  if(!a) return o.addressText || '-';
  return [a.street, a.number, a.complement, a.city].filter(Boolean).join(', ');
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

function reset(){ filters.value = { from: today, to: today, riderId: '' }; orders.value = []; }

function viewDetails(o){
  router.push({ path: `/sales/${o.id}` });
}

onMounted(()=>{ loadRiders(); load(); });

function onQuickSearch(val){ q.value = val }
function onQuickClear(){ q.value = '' }
</script>

<style scoped>
.card { overflow: hidden; }
</style>
