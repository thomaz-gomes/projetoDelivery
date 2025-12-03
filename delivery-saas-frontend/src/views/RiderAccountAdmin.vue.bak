<script setup>
// Full admin-facing Rider Account view: sidebar + date filters + pagar action
import { ref, onMounted, computed } from 'vue';
import { useRoute } from 'vue-router';
import api from '../api';
import { formatCurrency } from '../utils/formatters.js';
import { useAuthStore } from '../stores/auth';
import Sidebar from '../components/Sidebar.vue';
import Swal from 'sweetalert2';

const route = useRoute();
const riderId = route.params.id;
const rider = ref(null);

// inline edit
const editingId = ref(null);
const editAmount = ref('');
const editNote = ref('');
const savingEdit = ref(false);

// send PDF via WhatsApp
const phoneTo = ref('');
const sendingPdf = ref(false);
const useMockUrl = ref(true);
// compact UI toggle for phone input on small screens
const showPhoneInput = ref(false);

// paging & filters
const page = ref(1);
const pageSize = ref(25);
const total = ref(0);
const totalPages = ref(1);
const filters = ref({ from: '', to: '', type: '' });

// manual adjust form
const adj = ref({ amount: '', type: 'CREDIT', note: '' });
const adjusting = ref(false);

// page state and common refs
const auth = useAuthStore();
const error = ref('');
const success = ref('');
const loading = ref(false);
const balance = ref(0);
const transactions = ref([]);
const loadingTx = ref(false);
const exporting = ref(false);
const periodBalance = ref(0);

function parseDateInput(s) {
  if (!s) return null;
  const str = String(s).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  const parts = str.split('/').map(p => p.trim());
  if (parts.length === 3) {
    let [d, m, y] = parts;
    d = d.padStart(2, '0'); m = m.padStart(2, '0');
    if (y.length === 2) y = '20' + y;
    if (y.length === 4) return `${y}-${m}-${d}`;
  }
  return null;
}

function buildParams(omitPaging = false) {
  const params = {};
  if (!omitPaging) { params.page = page.value; params.pageSize = pageSize.value; }
  if (filters.value.from) { const parsed = parseDateInput(filters.value.from); if (parsed) params.from = parsed; }
  if (filters.value.to) { const parsed = parseDateInput(filters.value.to); if (parsed) params.to = parsed; }
  if (filters.value.type) params.type = filters.value.type;
  params.sort = 'desc';
  return params;
}

async function fetchRider() {
  try {
    const { data } = await api.get(`/riders/${riderId}`);
    rider.value = data;
    if (!phoneTo.value && data?.whatsapp) phoneTo.value = data.whatsapp;
  } catch (e) { console.error('fetchRider failed', e); }
}

async function fetchBalance() {
  loading.value = true; error.value = '';
  try { const { data: acct } = await api.get(`/riders/${riderId}/account`); balance.value = Number(acct.balance || 0); }
  catch (e) { console.error(e); error.value = e?.response?.data?.message || 'Falha ao carregar conta'; }
  finally { loading.value = false; }
}

async function fetchTransactions() {
  loadingTx.value = true; error.value = '';
  try {
    const { data } = await api.get(`/riders/${riderId}/transactions`, { params: buildParams(false) });
    transactions.value = data.items || [];
    total.value = data.total || 0; page.value = data.page || 1; pageSize.value = data.pageSize || pageSize.value; totalPages.value = data.totalPages || 1;
    await fetchPeriodFees();
  } catch (e) { console.error(e); error.value = e?.response?.data?.message || 'Falha ao carregar transações'; }
  finally { loadingTx.value = false; }
}

async function fetchPeriodFees() {
  try {
    const params = buildParams(true);
    params.full = true;
    const { data } = await api.get(`/riders/${riderId}/transactions`, { params });
    const items = data.items || [];
    const sum = items.reduce((acc, t) => acc + Number(t.amount || 0), 0);
    periodBalance.value = Number(sum || 0);
  } catch (e) {
    console.error('Failed to compute period total', e);
    periodBalance.value = 0;
  }
}

const dateValidationMessage = computed(() => {
  const from = filters.value.from;
  const to = filters.value.to;
  if (!from && !to) return '';
  if (from && !parseDateInput(from)) return 'Formato inválido em "De". Use yyyy-mm-dd';
  if (to && !parseDateInput(to)) return 'Formato inválido em "Até". Use yyyy-mm-dd';
  if (from && to) {
    if (new Date(from) > new Date(to)) return 'De não pode ser posterior a Até';
  }
  return '';
});

const datesAreValid = computed(() => !dateValidationMessage.value);

async function pagarPeriodo() {
  if (!datesAreValid.value) return Swal.fire({ icon: 'error', text: dateValidationMessage.value });
  const from = filters.value.from || null;
  const to = filters.value.to || null;
  const res = await Swal.fire({
    title: 'Confirmar pagamento',
    html: `Deseja dar baixa no saldo do entregador por este período?<br><b>Período:</b> ${from || '—'} → ${to || '—'}`,
    showCancelButton: true,
    confirmButtonText: 'Pagar',
    cancelButtonText: 'Cancelar'
  });
  if (!res.isConfirmed) return;
  try {
    const payload = { from, to };
    const { data } = await api.post(`/riders/${riderId}/account/pay`, payload);
    Swal.fire({ icon: 'success', text: data?.message || 'Pagamento registrado.' });
    // refresh
    await fetchBalance();
    await fetchTransactions();
    await fetchPeriodFees();
  } catch (e) {
    console.error('pagarPeriodo failed', e);
    Swal.fire({ icon: 'error', text: e?.response?.data?.message || 'Falha ao registrar pagamento' });
  }
}

onMounted(async () => { await fetchRider(); await fetchBalance(); await fetchTransactions(); });

</script>

<template>
  <div class="d-flex">
    <!-- Sidebar column -->
    <aside style="width:260px;min-width:220px;padding:0;border-right:1px solid rgba(0,0,0,0.05);background:#fff;">
      <Sidebar />
    </aside>
    <main class="flex-grow-1 p-4 rider-account">
      <div class="d-flex justify-content-between align-items-center mb-3">
        <h2 class="h4 m-0">Extrato do entregador (Admin)</h2>
        <div>
          <button class="btn btn-outline-secondary btn-sm" @click="$router.back()">Voltar</button>
        </div>
      </div>

      <div v-if="error" class="alert alert-danger">{{ error }}</div>
      <div v-if="success" class="alert alert-success">{{ success }}</div>

      <div class="card mb-3 p-3">
        <div class="row g-2 align-items-end">
          <div class="col-md-3">
            <label class="form-label small">De</label>
            <input v-model="filters.from" type="date" class="form-control" />
          </div>
          <div class="col-md-3">
            <label class="form-label small">Até</label>
            <input v-model="filters.to" type="date" class="form-control" />
          </div>
          <div class="col-md-3">
            <label class="form-label small">Tipo</label>
            <select v-model="filters.type" class="form-select">
              <option value="">Todos</option>
              <option value="DELIVERY_FEE">Delivery fee</option>
              <option value="DAILY_RATE">Daily rate</option>
              <option value="MANUAL_ADJUSTMENT">Manual adjustment</option>
            </select>
          </div>
          <div class="col-md-3 d-flex gap-2">
            <button class="btn btn-primary" @click="fetchTransactions" :disabled="loadingTx || !datesAreValid">Buscar</button>
            <button class="btn btn-outline-secondary" @click="fetchPeriodFees" :disabled="!datesAreValid">Calcular saldo</button>
            <button class="btn btn-success" @click="pagarPeriodo" :disabled="!datesAreValid">PAGAR</button>
          </div>
        </div>
        <div v-if="dateValidationMessage" class="mt-2 text-danger small">{{ dateValidationMessage }}</div>
      </div>

      <div class="card mb-3">
        <div class="card-body d-flex align-items-center justify-content-between flex-wrap gap-2">
          <div>
            <div class="small text-muted">Saldo no período</div>
            <div class="h3">{{ formatCurrency(periodBalance) }}</div>
          </div>
          <div>
            <div class="d-none d-md-flex align-items-center gap-2">
              <button class="btn btn-sm btn-primary" @click="fetchBalance" :disabled="loading">Atualizar</button>
              <button class="btn btn-sm btn-outline-secondary" @click="exportCsv" :disabled="exporting || !datesAreValid">{{ exporting ? 'Exportando...' : 'Exportar CSV' }}</button>
              <input v-model="phoneTo" type="text" placeholder="+5511999999999" class="form-control form-control-sm phone-input" style="max-width:160px;" />
              <button class="btn btn-sm btn-success" @click="sendPdf" :disabled="sendingPdf || !datesAreValid">{{ sendingPdf ? 'Enviando...' : 'Enviar PDF (WhatsApp)' }}</button>
            </div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="table-responsive">
          <table class="table table-sm mb-0">
            <thead class="table-light">
              <tr>
                <th>Data</th>
                <th>Tipo</th>
                <th>Valor</th>
                <th>Pedido</th>
                <th>Observação</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="t in transactions" :key="t.id">
                <td>{{ t.date }}</td>
                <td>{{ t.type }}</td>
                <td>{{ formatCurrency(Number(t.amount || 0)) }}</td>
                <td>{{ t.order?.displayId || t.displayId || '—' }}</td>
                <td>{{ t.note || '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </main>
  </div>
</template>

<style scoped>
.rider-account { overflow-x: hidden; }
.rider-account .phone-input { max-width: 180px; }
</style>
