<script setup>
import { ref, onMounted, computed } from 'vue';
import { bindLoading } from '../state/globalLoading.js';
import { useRoute } from 'vue-router';
import api from '../api';
import { useAuthStore } from '../stores/auth';

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

async function adjustAccount() {
  if (!adj.value.amount) return (error.value = 'Informe o valor');
  adjusting.value = true;
  error.value = '';
  try {
    const payload = { amount: adj.value.amount, type: adj.value.type, note: adj.value.note };
    await api.post(`/riders/${riderId}/account/adjust`, payload);
    // refresh
    await fetchBalance();
    await fetchTransactions();
    adj.value = { amount: '', type: 'CREDIT', note: '' };
  } catch (e) {
    console.error('Adjust failed', e);
    error.value = e?.response?.data?.message || 'Falha ao ajustar conta';
  } finally {
    adjusting.value = false;
  }
}

async function fetchBalance() {
  loading.value = true;
  error.value = '';
  try {
    const { data: acct } = await api.get(`/riders/${riderId}/account`);
    balance.value = Number(acct.balance || 0);
  } catch (e) {
    console.error(e);
    error.value = e?.response?.data?.message || 'Falha ao carregar conta';
  } finally {
    loading.value = false;
  }
}

async function fetchRider() {
  try {
    const { data } = await api.get(`/riders/${riderId}`);
    rider.value = data;
    // prefill phoneTo with rider.whatsapp unless user already typed something
    if (!phoneTo.value && data?.whatsapp) {
      phoneTo.value = data.whatsapp;
    }
  } catch (e) {
    console.error('fetchRider failed', e);
  }
}

function buildParams(omitPaging = false) {
  const params = {};
  if (!omitPaging) {
    params.page = page.value;
    params.pageSize = pageSize.value;
  }
  if (filters.value.from) {
    const parsed = parseDateInput(filters.value.from);
    if (parsed) params.from = parsed; // YYYY-MM-DD
  }
  if (filters.value.to) {
    const parsed = parseDateInput(filters.value.to);
    if (parsed) params.to = parsed; // YYYY-MM-DD
  }
  if (filters.value.type) params.type = filters.value.type;
  params.sort = 'desc';
  return params;
}

function parseDateInput(s) {
  if (!s) return null;
  const str = String(s).trim();
  // if ISO yyyy-mm-dd (from datepicker), accept directly
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  // accept dd/mm/yy or dd/mm/yyyy or d/m/yy
  const parts = str.split('/').map(p => p.trim());
  if (parts.length === 3) {
    let [d, m, y] = parts;
    if (!/^[0-9]+$/.test(d) || !/^[0-9]+$/.test(m) || !/^[0-9]+$/.test(y)) return null;
    d = d.padStart(2, '0');
    m = m.padStart(2, '0');
    if (y.length === 2) {
      y = '20' + y;
    }
    if (y.length === 4) return `${y}-${m}-${d}`;
  }
  return null;
}

const dateValidationMessage = computed(() => {
  const from = filters.value.from;
  const to = filters.value.to;
  if (!from && !to) return '';
  if (from && !parseDateInput(from)) return 'Formato inválido em "De". Use dd/mm/YY';
  if (to && !parseDateInput(to)) return 'Formato inválido em "Até". Use dd/mm/YY';
  const fromIso = from ? parseDateInput(from) : null;
  const toIso = to ? parseDateInput(to) : null;
  if (fromIso && toIso) {
    const f = new Date(fromIso);
    const t = new Date(toIso);
    if (f > t) return 'O campo "De" não pode ser posterior a "Até".';
  }
  return '';
});

const datesAreValid = computed(() => !dateValidationMessage.value);

async function fetchTransactions() {
  loadingTx.value = true;
  error.value = '';
  try {
    console.log('RiderAccount.fetchTransactions buildParams:', buildParams(false));
    const { data } = await api.get(`/riders/${riderId}/transactions`, { params: buildParams(false) });
    transactions.value = data.items || [];
    total.value = data.total || 0;
    page.value = data.page || 1;
    pageSize.value = data.pageSize || pageSize.value;
    totalPages.value = data.totalPages || 1;
    // update period total of delivery fees for current filters
    await fetchPeriodFees();
  } catch (e) {
    console.error(e);
    error.value = e?.response?.data?.message || 'Falha ao carregar transações';
  } finally {
    loadingTx.value = false;
  }
}

async function fetchPeriodFees() {
  try {
    // build params for full set inside date range (no type filter) and request JSON full set
    const params = buildParams(true);
    params.full = true;
    // do NOT set params.type here so the backend returns transactions of all types
    const { data } = await api.get(`/riders/${riderId}/transactions`, { params });
    const items = data.items || [];
    const sum = items.reduce((acc, t) => acc + Number(t.amount || 0), 0);
    periodBalance.value = Number(sum || 0);
  } catch (e) {
    console.error('Failed to compute period total', e);
    periodBalance.value = 0;
  }
}

function formatDateTime(d) {
  if (!d) return '';
  const dt = new Date(d);
  const dd = String(dt.getDate()).padStart(2, '0');
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const yy = String(dt.getFullYear()).slice(-2);
  const hh = String(dt.getHours()).padStart(2, '0');
  const min = String(dt.getMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${yy} ${hh}:${min}`;
}

// helpers para a numeração por dia
function padNumber(n) {
  // Format numeric display id as two digits (01, 02, ...). Keep '—' for null/empty.
  if (n == null || n === '') return '—';
  return String(n).padStart(2, '0');
}

function getTxDisplay(t) {
  // prefer persisted per-day displaySimple when available (might already be a padded string)
  if (t.order && t.order.displaySimple != null) return String(t.order.displaySimple).padStart(2, '0');
  if (t.displaySimple != null) return String(t.displaySimple).padStart(2, '0');
  // fallback to displayId (could be provided by integrator)
  if (t.order && t.order.displayId != null) return padNumber(t.order.displayId);
  if (t.displayId != null) return padNumber(t.displayId);
  return '—';
}

function txTypeLabel(type) {
  if (!type) return '—';
  switch (type) {
    case 'DELIVERY_FEE':
      return 'Taxa de entrega';
    case 'DAILY_RATE':
      return 'Diária';
    case 'MANUAL_ADJUSTMENT':
      return 'Ajuste manual';
    default:
      return String(type);
  }
}

function startEdit(t) {
  editingId.value = t.id;
  editAmount.value = String(Number(t.amount || 0).toFixed(2));
  editNote.value = t.note || '';
}

function cancelEdit() {
  editingId.value = null;
  editAmount.value = '';
  editNote.value = '';
}

async function saveEdit(riderIdParam, tx) {
  if (!editingId.value) return;
  savingEdit.value = true;
  try {
    const payload = { amount: Number(editAmount.value), note: editNote.value };
    const { data } = await api.patch(`/riders/${riderId}/transactions/${editingId.value}`, payload);
    // refresh
    await fetchBalance();
    await fetchTransactions();
    cancelEdit();
  } catch (e) {
    console.error('Save edit failed', e);
    error.value = e?.response?.data?.message || 'Falha ao salvar alteração';
  } finally {
    savingEdit.value = false;
  }
}

async function sendPdf() {
  if (!phoneTo.value) return (error.value = 'Informe o telefone destino');
  sendingPdf.value = true;
  error.value = '';
  try {
    // normalize phone client-side (strip non-digits, ensure country code 55)
    const normalized = normalizePhoneForSend(phoneTo.value);
    if (!normalized) return (error.value = 'Telefone inválido');
    phoneTo.value = normalized;
    const payload = { phone: phoneTo.value, from: filters.value.from || undefined, to: filters.value.to || undefined, type: filters.value.type || undefined };
    if (useMockUrl.value) {
      payload.mockMediaUrl = 'http://redemultilink.com.br/test/report.pdf';
    }
    const { data } = await api.post(`/riders/${riderId}/account/send-report`, payload);
    success.value = data?.url ? `Relatório gerado. URL: ${data.url}` : 'Relatório enviado com sucesso.';
    setTimeout(() => (success.value = ''), 8000);
  } catch (e) {
    console.error('sendPdf failed', e);
    error.value = e?.response?.data?.message || 'Falha ao enviar relatório';
  } finally {
    sendingPdf.value = false;
  }
}

function normalizePhoneForSend(v) {
  if (!v) return null;
  let digits = String(v).replace(/\D+/g, '');
  if (!digits) return null;
  // if starts with 0, remove leading zeros
  digits = digits.replace(/^0+/, '');
  if (!digits.startsWith('55')) {
    digits = '55' + digits;
  }
  return '+' + digits;
}

async function exportCsv() {
  exporting.value = true;
  try {
    // request CSV for the full filtered set (omit paging so backend returns full filtered list)
    const params = buildParams(true);
    params.format = 'csv';
    const resp = await api.get(`/riders/${riderId}/transactions`, { params, responseType: 'blob' });
    const blob = new Blob([resp.data], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rider-${riderId}-transactions.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  } catch (e) {
    console.error('Export failed', e);
    error.value = e?.response?.data?.message || 'Falha ao exportar CSV';
  } finally {
    exporting.value = false;
  }
}

function resetAndFetch() {
  page.value = 1;
  fetchTransactions();
}

onMounted(async () => {
  await fetchRider();
  await fetchBalance();
  await fetchTransactions();
});

function clearFilters() {
  filters.value.from = '';
  filters.value.to = '';
  filters.value.type = '';
  resetAndFetch();
}

function prevPage() {
  if (page.value > 1) {
    page.value = page.value - 1;
    fetchTransactions();
  }
}

function nextPage() {
  if (page.value < totalPages.value) {
    page.value = page.value + 1;
    fetchTransactions();
  }
}
</script>

<template>
  <div class="p-4 rider-account">
    <div class="d-flex justify-content-between align-items-center mb-3">
      <h2 class="h4 m-0">Extrato do entregador</h2>
      <div>
        <button class="btn btn-outline-secondary btn-sm" @click="$router.back()">Voltar</button>
      </div>
    </div>

  <div v-if="error" class="alert alert-danger">{{ error }}</div>
  <div v-if="success" class="alert alert-success">{{ success }}</div>

    <div class="card mb-3">
      <div class="card-body d-flex align-items-center justify-content-between flex-wrap gap-2">
          <div>
          <div class="small text-muted">Saldo no período</div>
          <div class="h3">R$ {{ periodBalance.toFixed(2) }}</div>
        </div>
        <div>
          <!-- full controls for md+ (desktop/tablet) -->
          <div class="d-none d-md-flex align-items-center gap-2">
            <button class="btn btn-sm btn-primary" @click="fetchBalance" :disabled="loading">Atualizar</button>
            <button class="btn btn-sm btn-outline-secondary" @click="exportCsv" :disabled="exporting || !datesAreValid">{{ exporting ? 'Exportando...' : 'Exportar CSV' }}</button>
            <input v-model="phoneTo" type="text" placeholder="+5511999999999" class="form-control form-control-sm phone-input" style="max-width:160px;" />
            <div class="form-check form-check-inline">
              <input class="form-check-input" type="checkbox" id="mockUrlCheckbox" v-model="useMockUrl" />
              <label class="form-check-label small text-muted" for="mockUrlCheckbox">Usar URL mockada</label>
            </div>
            <button class="btn btn-sm btn-success" @click="sendPdf" :disabled="sendingPdf || !datesAreValid">{{ sendingPdf ? 'Enviando...' : 'Enviar PDF (WhatsApp)' }}</button>
          </div>
          <!-- compact icon controls for small screens -->
          <div class="d-flex d-md-none align-items-center gap-2">
            <button class="btn btn-sm btn-primary" title="Atualizar" @click="fetchBalance" :disabled="loading"><i class="bi bi-arrow-clockwise"></i></button>
            <button class="btn btn-sm btn-outline-secondary" title="Exportar" @click="exportCsv" :disabled="exporting || !datesAreValid"><i class="bi bi-download"></i></button>
            <button class="btn btn-sm btn-success" title="Enviar" @click="sendPdf" :disabled="sendingPdf || !datesAreValid"><i class="bi bi-send"></i></button>
            <button class="btn btn-sm btn-outline-secondary" @click.prevent="showPhoneInput = !showPhoneInput" title="Telefone"><i class="bi bi-telephone"></i></button>
          </div>
          <div v-if="showPhoneInput" class="d-md-none mt-2">
            <input v-model="phoneTo" type="text" placeholder="+5511999999999" class="form-control form-control-sm" />
            <div class="form-check mt-1">
              <input class="form-check-input" type="checkbox" id="mockUrlCheckboxMobile" v-model="useMockUrl" />
              <label class="form-check-label small text-muted" for="mockUrlCheckboxMobile">Usar URL mockada</label>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="card mb-3 p-3">
      <div class="row g-2 align-items-end">
        <div class="col-md-3">
          <label class="form-label small">De</label>
          <input v-model="filters.from" type="date" class="form-control" title="Selecione a data (datepicker) ou digite dd/mm/YY" />
          
        </div>
        <div class="col-md-3">
          <label class="form-label small">Até</label>
          <input v-model="filters.to" type="date" class="form-control" title="Selecione a data (datepicker) ou digite dd/mm/YY" />
          
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
          <button class="btn btn-primary me-2" @click="resetAndFetch" :disabled="!datesAreValid || loadingTx">Buscar</button>
          <button class="btn btn-outline-secondary" @click="clearFilters">Limpar</button>
        </div>
      </div>
      <div v-if="dateValidationMessage" class="px-3 pt-2">
        <div class="text-danger small">{{ dateValidationMessage }}</div>
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
            <tr v-for="(t, idx) in transactions" :key="t.id">
              <td>{{ formatDateTime(t.date) }}</td>
              <td>{{ txTypeLabel(t.type) }}</td>
              <td>
                <div v-if="editingId !== t.id">
                  <span :class="{ 'text-danger': Number(t.amount || 0) < 0 }">R$ {{ Number(t.amount || 0).toFixed(2) }}</span>
                  <button class="btn btn-sm btn-link p-0 ms-2" title="Editar" @click="startEdit(t)">✎</button>
                </div>
                <div v-else>
                  <div class="d-flex gap-2 align-items-center flex-wrap">
                    <input class="form-control form-control-sm" style="max-width:110px; width:100%" v-model="editAmount" />
                    <button class="btn btn-sm btn-primary" :disabled="savingEdit" @click.prevent="saveEdit(riderId, t)">{{ savingEdit ? 'Salvando...' : 'Salvar' }}</button>
                    <button class="btn btn-sm btn-outline-secondary" @click.prevent="cancelEdit">Cancelar</button>
                  </div>
                </div>
              </td>
              <!-- Agora usamos o displayId do pedido (orders.displayId) fornecido pelo backend.
                   Preferimos t.order.displayId, mas também aceitamos t.displayId caso o payload traga no nível da transação. -->
              <td :title="t.orderId || ''">
                {{ getTxDisplay(t) }}
              </td>
              <td>
                <div v-if="editingId !== t.id">{{ t.note || '—' }}</div>
                <div v-else>
                  <input class="form-control form-control-sm" v-model="editNote" />
                </div>
              </td>
            </tr>
            <tr v-if="transactions.length === 0 && !loadingTx">
              <td colspan="5" class="text-center text-muted py-4">Nenhuma transação encontrada.</td>
            </tr>
            <tr v-if="loadingTx">
              <td colspan="5" class="text-center py-4">Carregando...</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="card-footer d-flex justify-content-between align-items-center">
        <div class="small text-muted">Total: {{ total }}</div>
        <div class="d-flex align-items-center gap-2">
          <button class="btn btn-sm btn-outline-secondary" :disabled="page<=1" @click="prevPage">Anterior</button>
          <div class="px-2">Página {{ page }} / {{ totalPages }}</div>
          <button class="btn btn-sm btn-outline-secondary" :disabled="page>=totalPages" @click="nextPage">Próxima</button>
        </div>
      </div>
    </div>

    <!-- Manual adjust (ADMIN only) -->
    <div v-if="auth.user?.role === 'ADMIN'" class="card mt-3">
      <div class="card-body">
        <h5 class="mb-3">Ajuste manual da conta</h5>
        <div class="row g-2 align-items-end">
          <div class="col-md-3">
            <label class="form-label small">Valor</label>
            <input v-model="adj.amount" type="number" step="0.01" class="form-control" placeholder="0.00" />
          </div>
          <div class="col-md-3">
            <label class="form-label small">Tipo</label>
            <select v-model="adj.type" class="form-select">
              <option value="CREDIT">Crédito</option>
              <option value="DEBIT">Débito</option>
            </select>
          </div>
          <div class="col-md-4">
            <label class="form-label small">Observação</label>
            <input v-model="adj.note" type="text" class="form-control" placeholder="Motivo" />
          </div>
          <div class="col-md-2">
            <button class="btn btn-success w-100" @click="adjustAccount" :disabled="adjusting">{{ adjusting ? 'Enviando...' : 'Aplicar' }}</button>
          </div>
        </div>
        <div v-if="error" class="text-danger small mt-2">{{ error }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Rider account responsive tweaks */
.rider-account { overflow-x: hidden; }
.rider-account .card-body.flex-wrap { gap: .5rem; }
.rider-account .phone-input { max-width: 180px; }
@media (max-width: 576px) {
  .rider-account { padding: 12px !important; }
  .rider-account .card { margin-bottom: 0.75rem; }
  .rider-account .table-responsive { font-size: 13px; }
}

/* small adjustments to inputs/buttons to avoid overflow */
.rider-account .form-control { min-width: 0; }
.rider-account .d-inline-flex { flex-wrap: wrap; }

/* compact layout tweaks */
.rider-account h2 { font-size: 1rem; }
.rider-account .card-body { padding: 0.65rem; }
.rider-account .card { margin-bottom: 0.6rem; }
.rider-account .table-sm td, .rider-account .table-sm th { padding: .35rem .5rem; }
.rider-account .table-responsive { font-size: 13px; }
@media (max-width: 576px) {
  .rider-account .h3 { font-size: 1.05rem; }
}
</style>
