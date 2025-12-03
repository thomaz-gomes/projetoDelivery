<template>
  <div class="container py-3">
    <h1 class="mb-3">Histórico de Vendas</h1>

    <div class="card mb-3">
      <div class="card-body">
        <div class="row g-2 align-items-end">
          <div class="col-md-3">
            <label class="form-label">Data início <small class="text-muted">(padrão: hoje)</small></label>
            <input type="date" class="form-control" v-model="filters.from" />
          </div>
          <div class="col-md-3">
            <label class="form-label">Data fim <small class="text-muted">(padrão: hoje)</small></label>
            <input type="date" class="form-control" v-model="filters.to" />
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

    <div class="card">
      <div class="card-body p-0">
        <table class="table table-hover mb-0">
          <thead class="table-light">
            <tr>
              <th>Nº Pedido</th>
              <th>Endereço</th>
              <th>Cliente</th>
              <th>Data / Hora</th>
              <th>Entregador</th>
              <th>Pagamento</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="o in orders" :key="o.id">
              <td>{{ formatOrderNumber(o) }}</td>
              <td>{{ formatAddress(o) }}</td>
              <td>{{ o.customer?.fullName || o.customer?.name || o.customer?.contact || '-' }}</td>
              <td>{{ formatDateTime(o.createdAt) }}</td>
              <td>{{ o.rider?.name || '-' }}</td>
              <td>{{ o.paymentMethod || o.payment?.method || '-' }}</td>
              <td class="text-end">
                <button class="btn btn-sm btn-outline-primary" @click="viewDetails(o)">Ver</button>
              </td>
            </tr>
            <tr v-if="orders.length === 0">
              <td colspan="7" class="text-center py-4">Nenhum pedido encontrado para o período.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import api from '../api';
import SelectInput from '../components/form/select/SelectInput.vue';

const router = useRouter();
const orders = ref([]);
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

function formatDateTime(s){
  if(!s) return '-';
  try{ return new Date(s).toLocaleString(); }catch(e){ return s }
}

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
</script>

<style scoped>
.card { overflow: hidden; }
</style>
