<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { formatCurrency } from '../utils/formatters.js';
import { formatDateWithOptionalTime } from '../utils/dates.js';
import api from '../api';
import { useAuthStore } from '../stores/auth';

const route = useRoute();
const auth = useAuthStore();

const loading = ref(false);
const error = ref('');
const transactions = ref([]);
const periodBalance = ref(0);
const periodDeliveries = ref(0);
const periodBonusTotal = ref(0);
const periodDailyRatesCount = ref(0);
const periodDailyRatesTotal = ref(0);

// Pagination — first 10 per page like a typical mobile statement.
const page = ref(1);
const pageSize = ref(10);
const total = ref(0);
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)));
const paginationStart = computed(() => total.value === 0 ? 0 : (page.value - 1) * pageSize.value + 1);
const paginationEnd = computed(() => Math.min(page.value * pageSize.value, total.value));

const filters = ref({ from: '', to: '' });

function riderStatusBadge(status) {
  switch (status) {
    case 'PAID': return { label: 'Pago', cls: 'bg-success' };
    case 'CANCELLED': return { label: 'Cancelado', cls: 'bg-secondary' };
    case 'PENDING':
    default: return { label: 'Pendente', cls: 'bg-warning text-dark' };
  }
}

// Bank-statement convention: positive = green credit, negative = red debit.
// Returns the text class + the sign-adjusted amount string.
function amountDisplay(amount) {
  const n = Number(amount || 0);
  if (n > 0) return { cls: 'text-success', text: `+ ${formatCurrency(n)}` };
  if (n < 0) return { cls: 'text-danger', text: `- ${formatCurrency(Math.abs(n))}` };
  return { cls: 'text-muted', text: formatCurrency(0) };
}

function translateNote(note) {
  if (!note) return '';
  const translations = {
    'Daily rate': 'Diária',
    'Manual debit': 'Débito manual',
    'Manual credit': 'Crédito manual'
  };
  if (translations[note]) return translations[note];
  if (note.startsWith('Delivery fee for neighborhood')) {
    return note.replace('Delivery fee for neighborhood', 'Taxa de entrega para bairro').replace('unknown', 'desconhecido');
  }
  return note;
}

function paramsForPage() {
  const p = { page: page.value, pageSize: pageSize.value, sort: 'desc' };
  if (filters.value.from) p.from = filters.value.from;
  if (filters.value.to) p.to = filters.value.to;
  return p;
}

async function fetchTransactions() {
  loading.value = true; error.value = '';
  try {
    if (!auth.user && localStorage.getItem('token')) {
      try {
        const { data } = await api.get('/auth/me');
        if (data && data.user) auth.user = data.user;
      } catch (e) { /* ignore */ }
    }
    const base = route.params.id ? `/riders/${route.params.id}` : (auth.user?.riderId ? `/riders/${auth.user.riderId}` : '/riders/me');

    // Account meta — used for the period balance kpi above the list.
    const { data: acct } = await api.get(`${base}/account`);
    periodBalance.value = Number(acct.periodTotal || acct.balance || 0);

    // Paginated list for the rendering.
    const { data } = await api.get(`${base}/transactions`, { params: paramsForPage() });
    transactions.value = data.items || [];
    total.value = Number(data.total || 0);
    // If the server reports fewer pages than the cursor sits on (e.g. user
    // shrank the date range), snap back to the last available page.
    if (page.value > totalPages.value) {
      page.value = totalPages.value;
      // re-fetch with the corrected page so the visible list matches.
      return fetchTransactions();
    }

    // Period metrics — full pull so we don't undercount across pages.
    try {
      const p = { full: true };
      if (filters.value.from) p.from = filters.value.from;
      if (filters.value.to) p.to = filters.value.to;
      const { data: all } = await api.get(`${base}/transactions`, { params: p });
      const items = all.items || [];
      let balance = 0;
      let deliveries = 0;
      let bonusTotal = 0;
      let dailyRatesCount = 0;
      let dailyRatesTotal = 0;
      for (const t of items) {
        const amt = Number(t.amount || 0);
        balance += amt;
        if (t.type === 'DELIVERY_FEE') deliveries++;
        if (t.type === 'EARLY_CHECKIN_BONUS' || t.type === 'GOAL_REWARD') bonusTotal += amt;
        if (t.type === 'DAILY_RATE') { dailyRatesCount++; dailyRatesTotal += amt; }
      }
      if (filters.value.from || filters.value.to) periodBalance.value = balance;
      periodDeliveries.value = deliveries;
      periodBonusTotal.value = bonusTotal;
      periodDailyRatesCount.value = dailyRatesCount;
      periodDailyRatesTotal.value = dailyRatesTotal;
    } catch (e) { console.warn('period metrics failed', e); }
  } catch (e) {
    console.error('fetchTransactions failed', e);
    error.value = e?.response?.data?.message || 'Falha ao carregar extrato';
  } finally { loading.value = false; }
}

function goToPage(p) {
  const target = Math.max(1, Math.min(p, totalPages.value));
  if (target === page.value) return;
  page.value = target;
  fetchTransactions();
}

function changePageSize() {
  page.value = 1;
  fetchTransactions();
}

onMounted(() => { fetchTransactions(); });
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
      <div class="h4 mb-3" :class="periodBalance < 0 ? 'text-danger' : (periodBalance > 0 ? 'text-success' : '')">
        {{ formatCurrency(periodBalance) }}
      </div>

      <div class="row g-2 mb-3">
        <div class="col-6">
          <div class="border rounded p-2 text-center">
            <div class="small text-muted">Entregas</div>
            <div class="fw-bold fs-5">{{ periodDeliveries }}</div>
          </div>
        </div>
        <div class="col-6">
          <div class="border rounded p-2 text-center">
            <div class="small text-muted">Total bônus</div>
            <div class="fw-bold fs-5 text-info">{{ formatCurrency(periodBonusTotal) }}</div>
          </div>
        </div>
        <div class="col-6">
          <div class="border rounded p-2 text-center">
            <div class="small text-muted">Nº diárias</div>
            <div class="fw-bold fs-5">{{ periodDailyRatesCount }}</div>
          </div>
        </div>
        <div class="col-6">
          <div class="border rounded p-2 text-center">
            <div class="small text-muted">Total diárias</div>
            <div class="fw-bold fs-5">{{ formatCurrency(periodDailyRatesTotal) }}</div>
          </div>
        </div>
      </div>

      <div class="d-flex justify-content-between align-items-center mb-2">
        <div class="small text-muted">Transações</div>
        <div v-if="loading" class="spinner-border spinner-border-sm text-secondary" role="status"></div>
      </div>

      <ul class="list-group list-group-flush">
        <li
          v-for="t in transactions"
          :key="t.id"
          class="list-group-item py-2 d-flex justify-content-between align-items-center gap-2 statement-row"
          :class="{ 'opacity-50': t.status === 'CANCELLED' }"
        >
          <div class="flex-grow-1 min-w-0">
            <div class="small text-muted d-flex align-items-center gap-2 mb-1">
              <span>{{ formatDateWithOptionalTime(t.date) }}</span>
              <span class="badge" :class="riderStatusBadge(t.status).cls" style="font-size:0.65rem">
                {{ riderStatusBadge(t.status).label }}
              </span>
            </div>
            <div class="text-truncate" :class="{ 'text-decoration-line-through': t.status === 'CANCELLED' }">
              {{ t.order?.displaySimple ? `#${t.order.displaySimple} — ` : '' }}{{ translateNote(t.note) || '—' }}
            </div>
          </div>
          <div
            class="fw-bold text-end flex-shrink-0"
            :class="[amountDisplay(t.amount).cls, { 'text-decoration-line-through': t.status === 'CANCELLED' }]"
          >
            {{ amountDisplay(t.amount).text }}
          </div>
        </li>
        <li v-if="!loading && transactions.length === 0" class="list-group-item text-center text-muted py-3">
          Nenhuma transação no período
        </li>
      </ul>

      <!-- Pagination footer — kept compact for mobile. Page-size selector is
           hidden on very narrow screens (riders mostly read on phones). -->
      <div v-if="total > 0" class="d-flex flex-wrap align-items-center justify-content-between gap-2 pt-2 mt-2 border-top">
        <small class="text-muted">
          {{ paginationStart }}–{{ paginationEnd }} de {{ total }}
        </small>
        <div class="d-flex align-items-center gap-1">
          <button class="btn btn-sm btn-outline-secondary" :disabled="page <= 1 || loading" @click="goToPage(1)" title="Primeira">
            <i class="bi bi-chevron-double-left"></i>
          </button>
          <button class="btn btn-sm btn-outline-secondary" :disabled="page <= 1 || loading" @click="goToPage(page - 1)" title="Anterior">
            <i class="bi bi-chevron-left"></i>
          </button>
          <span class="small px-2">{{ page }} / {{ totalPages }}</span>
          <button class="btn btn-sm btn-outline-secondary" :disabled="page >= totalPages || loading" @click="goToPage(page + 1)" title="Próxima">
            <i class="bi bi-chevron-right"></i>
          </button>
          <button class="btn btn-sm btn-outline-secondary" :disabled="page >= totalPages || loading" @click="goToPage(totalPages)" title="Última">
            <i class="bi bi-chevron-double-right"></i>
          </button>
          <select
            class="form-select form-select-sm ms-2 d-none d-sm-inline-block"
            style="width:auto"
            v-model.number="pageSize"
            @change="changePageSize"
            :disabled="loading"
          >
            <option :value="10">10/pág</option>
            <option :value="25">25/pág</option>
            <option :value="50">50/pág</option>
          </select>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.rider-account-rider .h4 { font-size: 1.15rem; }
.rider-account-rider .list-group-item { font-size: 0.95rem; }
.statement-row { transition: background-color 0.15s ease; }
.statement-row:hover { background-color: rgba(0,0,0,0.02); }
.min-w-0 { min-width: 0; }
</style>
