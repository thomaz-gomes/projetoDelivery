<template>
  <div class="p-4">
    <h2 class="h4 mb-3">Movimentações de Estoque</h2>
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
          <div class="col-md-3 text-end">
            <button class="btn btn-primary me-2" @click="load">Buscar</button>
            <button class="btn btn-outline-secondary" @click="reset">Limpar</button>
          </div>
          <div class="col-md-3 text-end">
            <button class="btn btn-primary" @click="goNew">Novo Lançamento</button>
          </div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="table-responsive">
        <table class="table table-hover mb-0">
          <thead>
            <tr><th>Data</th><th>Descrição</th><th>Quantidade</th><th>Tipo</th><th>Valor</th><th></th></tr>
          </thead>
          <tbody>
            <tr v-for="row in paged" :key="row.uid">
              <td>{{ formatDate(row.movement.createdAt) }}</td>
              <td>{{ row.item.ingredient ? row.item.ingredient.description : row.item.ingredientId }}</td>
              <td>{{ Number(row.item.quantity || 0) }}</td>
              <td>{{ row.movement.type === 'OUT' ? 'Saída' : 'Entrada' }}</td>
              <td>{{ formatCurrency(row.signedValue) }}</td>
              <td><button class="btn btn-sm btn-outline-secondary" @click="view(row.movement)">Ver</button></td>
            </tr>
            <tr v-if="!paged.length"><td colspan="6" class="text-center text-muted py-4">Nenhuma movimentação.</td></tr>
          </tbody>
        </table>
        <div class="d-flex justify-content-between align-items-center mt-2">
          <div class="text-muted">Mostrando {{ startIndex }} - {{ endIndex }} de {{ filtered.length }}</div>
          <div class="d-flex gap-2 align-items-center">
            <label class="mb-0">Por página</label>
            <select class="form-select form-select-sm" v-model.number="perPage">
              <option :value="10">10</option>
              <option :value="25">25</option>
              <option :value="50">50</option>
            </select>
            <button class="btn btn-sm btn-outline-secondary" :disabled="page<=1" @click="page--">Anterior</button>
            <button class="btn btn-sm btn-outline-secondary" :disabled="page>=totalPages" @click="page++">Próxima</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue';
import DateInput from '../components/form/date/DateInput.vue';
import { useRouter } from 'vue-router';
import api from '../api';

const router = useRouter();
const list = ref([]);

const rows = computed(() => {
  // flatten movements into one row per stockMovementItem
  return list.value.reduce((acc, m) => {
    const items = Array.isArray(m.items) ? m.items : [];
    for (const it of items) {
      const signed = (String((m.type || '').toUpperCase()) === 'OUT' ? -1 : 1) * Number(it.quantity || 0);
      acc.push({ uid: `${m.id}:${it.id || it.ingredientId}`, movement: m, item: it, signedValue: signed });
    }
    return acc;
  }, []);
});

// default filters empty = load all
const filters = ref({ from: '', to: '' });
const page = ref(1);
const perPage = ref(10);

const filtered = computed(() => {
  const all = rows.value;
  if (!filters.value.from && !filters.value.to) return all;
  const from = filters.value.from ? new Date(filters.value.from) : null;
  const to = filters.value.to ? new Date(filters.value.to) : null;
  return all.filter(r => {
    const d = new Date(r.movement.createdAt);
    if (from && d < from) return false;
    if (to) {
      // include entire day for 'to' by setting time to end of day
      const end = new Date(to.getFullYear(), to.getMonth(), to.getDate(), 23, 59, 59, 999);
      if (d > end) return false;
    }
    return true;
  });
});

const totalPages = computed(() => Math.max(1, Math.ceil(filtered.value.length / perPage.value)));

const paged = computed(() => {
  if (page.value > totalPages.value) page.value = totalPages.value;
  const start = (page.value - 1) * perPage.value;
  return filtered.value.slice(start, start + perPage.value);
});

const startIndex = computed(() => filtered.value.length === 0 ? 0 : (page.value - 1) * perPage.value + 1);
const endIndex = computed(() => Math.min(filtered.value.length, page.value * perPage.value));


async function load(){
  try{
    // fetch all movements and apply client-side filters to avoid server-side date-format mismatches
    const { data } = await api.get('/stock-movements');
    list.value = Array.isArray(data) ? data : (data?.items || data?.movements || data) || [];
  }catch(e){
    console.error('load stock movements failed', e?.message || e);
    list.value = [];
  }
}

function reset(){ filters.value = { from: '', to: '' }; list.value = []; }

function formatCurrency(n){
  const num = Number(n || 0);
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(num);
}

function formatDate(d){ try{ return new Date(d).toLocaleString(); }catch(e){ return d; } }



function goNew(){ router.push('/stock-movements/new'); }
function view(m){ router.push(`/stock-movements/${m.id}`); }

onMounted(load);
</script>
