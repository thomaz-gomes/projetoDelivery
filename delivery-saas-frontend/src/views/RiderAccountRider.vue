<script setup>
import { ref, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { formatCurrency } from '../utils/formatters.js';
import { formatDateWithOptionalTime } from '../utils/dates.js';
import api from '../api';
import { useAuthStore } from '../stores/auth';

const route = useRoute();
const auth = useAuthStore();
// if route provides an id we show that rider, otherwise use the logged-in rider ("me")
const riderBase = route.params.id ? `/riders/${route.params.id}` : '/riders/me';

const loading = ref(false);
const error = ref('');
const transactions = ref([]);
const periodBalance = ref(0);

const filters = ref({ from: '', to: '' });

function paramsForSummary() {
  const p = { page: 1, pageSize: 10, sort: 'desc' };
  if (filters.value.from) p.from = filters.value.from;
  if (filters.value.to) p.to = filters.value.to;
  return p;
}

async function fetchSummary() {
  loading.value = true; error.value = '';
  try {
    // ensure auth.user is populated when token exists
    if (!auth.user && localStorage.getItem('token')) {
      try {
        const { data } = await api.get('/auth/me');
        if (data && data.user) auth.user = data.user;
      } catch (e) { /* ignore */ }
    }

    // determine which rider endpoint to use: explicit route param > auth.user.riderId > /riders/me
    const base = route.params.id ? `/riders/${route.params.id}` : (auth.user?.riderId ? `/riders/${auth.user.riderId}` : '/riders/me');

    const { data: acct } = await api.get(`${base}/account`);
    // prefer backend-provided period total when available
    periodBalance.value = Number(acct.periodTotal || acct.balance || 0);
    const { data } = await api.get(`${base}/transactions`, { params: paramsForSummary() });
    transactions.value = data.items || [];
    // compute periodBalance client-side when date filters are provided
    if (filters.value.from || filters.value.to) {
      try {
        const p = { full: true };
        if (filters.value.from) p.from = filters.value.from;
        if (filters.value.to) p.to = filters.value.to;
        const { data: all } = await api.get(`${base}/transactions`, { params: p });
        const items = all.items || [];
        periodBalance.value = items.reduce((acc, t) => acc + Number(t.amount || 0), 0);
      } catch (e) { console.warn('period sum failed', e); }
    }
  } catch (e) {
    console.error('fetchSummary failed', e);
    error.value = e?.response?.data?.message || 'Falha ao carregar resumo';
  } finally { loading.value = false; }
}

onMounted(() => { fetchSummary(); });
</script>

<template>
  <div class="p-3 rider-account-rider">
    <div class="d-flex justify-content-between align-items-center mb-3">
      <h3 class="h5 m-0">Meu extrato</h3>
      <div class="small text-muted">{{ auth.user?.name || '' }}</div>
    </div>

    <div v-if="error" class="alert alert-danger">{{ error }}</div>

    <div class="card mb-3 p-3">
      <div class="small text-muted">Saldo no período</div>
      <div class="h4 mb-2">{{ formatCurrency(periodBalance) }}</div>
      <div class="small text-muted">Últimas transações</div>
      <ul class="list-group list-group-flush mt-2">
        <li v-for="t in transactions" :key="t.id" class="list-group-item py-2 d-flex justify-content-between align-items-center">
          <div>
            <div class="small text-muted">{{ formatDateWithOptionalTime(t.date) }}</div>
            <div>{{ t.order?.displayId || t.displayId || '—' }} — {{ t.note || '' }}</div>
          </div>
          <div class="fw-bold">{{ formatCurrency(Number(t.amount || 0)) }}</div>
        </li>
        <li v-if="transactions.length === 0" class="list-group-item text-center text-muted py-3">Nenhuma transação recente</li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.rider-account-rider .h4 { font-size: 1.15rem; }
.rider-account-rider .list-group-item { font-size: 0.95rem; }
</style>
