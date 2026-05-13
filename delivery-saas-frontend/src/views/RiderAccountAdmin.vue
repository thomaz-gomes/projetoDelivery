<script setup>
// Full admin-facing Rider Account view: sidebar + date filters + pagar action
import { ref, onMounted, computed } from 'vue';
import { useRoute } from 'vue-router';
import api from '../api';
import { formatCurrency } from '../utils/formatters.js';
import { formatDateWithOptionalTime } from '../utils/dates.js';
import { useAuthStore } from '../stores/auth';
import Swal from 'sweetalert2';
import DateInput from '../components/form/date/DateInput.vue';
import SelectInput from '../components/form/select/SelectInput.vue';
import TextInput from '../components/form/input/TextInput.vue';
import BaseChart from '../components/BaseChart.vue';

const route = useRoute();
const riderId = route.params.id;
const rider = ref(null);

// inline edit
const editingId = ref(null);
const editAmount = ref('');
const editNote = ref('');
const savingEdit = ref(false);

// auth + role helpers
const auth = useAuthStore();
const isAdmin = computed(() => {
  const role = String(auth.user?.role || '').toUpperCase();
  return role === 'ADMIN' || role === 'SUPER_ADMIN';
});

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

// financial accounts (loaded if module is active)
const financialAccounts = ref([]);
const selectedAccountId = ref('');
const financialAccountsLoaded = ref(false);

// page state and common refs
const error = ref('');
const success = ref('');
const loading = ref(false);
const balance = ref(0);
const transactions = ref([]);
const loadingTx = ref(false);
const exporting = ref(false);
const periodBalance = ref(0);
const periodEarnings = ref(0);
const periodPaid = ref(0);
const periodDeliveries = ref(0);
const periodBonusTotal = ref(0);
const periodDailyRatesCount = ref(0);
const periodDailyRatesTotal = ref(0);

// Metrics card (KPIs + by-day chart) — fetched from /riders/:id/metrics
// alongside /transactions whenever the date/type filters change.
const metrics = ref({
  totalDeliveries: 0,
  avgDeliveryTimeMin: null,
  avgCostPerDelivery: 0,
  revenueGenerated: 0,
  earnings: 0,
  byDay: [],
});
const loadingMetrics = ref(false);

function typeLabel(type) {
  switch (type) {
    case 'DELIVERY_FEE': return 'Taxa de entrega';
    case 'DAILY_RATE': return 'Diária';
    case 'EARLY_CHECKIN_BONUS': return 'Bônus checkin';
    case 'MANUAL_ADJUSTMENT': return 'Ajuste manual';
    case 'GOAL_REWARD': return 'Recompensa meta';
    default: return type || '';
  }
}

function statusBadge(status) {
  switch (status) {
    case 'PAID': return { label: 'Pago', cls: 'bg-success' };
    case 'CANCELLED': return { label: 'Cancelado', cls: 'bg-secondary' };
    case 'PENDING':
    default: return { label: 'Pendente', cls: 'bg-warning text-dark' };
  }
}

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
    await Promise.all([fetchPeriodFees(), fetchMetrics()]);
  } catch (e) { console.error(e); error.value = e?.response?.data?.message || 'Falha ao carregar transações'; }
  finally { loadingTx.value = false; }
}

async function fetchMetrics() {
  loadingMetrics.value = true;
  try {
    const params = {};
    if (filters.value.from) { const p = parseDateInput(filters.value.from); if (p) params.from = p; }
    if (filters.value.to) { const p = parseDateInput(filters.value.to); if (p) params.to = p; }
    const { data } = await api.get(`/riders/${riderId}/metrics`, { params });
    metrics.value = {
      totalDeliveries: data.totalDeliveries || 0,
      avgDeliveryTimeMin: data.avgDeliveryTimeMin,
      avgCostPerDelivery: data.avgCostPerDelivery || 0,
      revenueGenerated: data.revenueGenerated || 0,
      earnings: data.earnings || 0,
      byDay: Array.isArray(data.byDay) ? data.byDay : [],
    };
  } catch (e) {
    console.warn('Failed to load rider metrics', e?.response?.data || e?.message);
  } finally { loadingMetrics.value = false; }
}

// Chart.js dataset for the "Entregas por dia" bar chart. Uses a short
// dd/MM label so 31 days fit comfortably; tooltip shows the full ISO date
// with the count + revenue.
const deliveriesChartData = computed(() => {
  const labels = metrics.value.byDay.map((d) => {
    const [, m, dd] = d.day.split('-');
    return `${dd}/${m}`;
  });
  return {
    labels,
    datasets: [
      {
        label: 'Entregas',
        data: metrics.value.byDay.map((d) => d.deliveries || 0),
        backgroundColor: 'rgba(13, 110, 253, 0.6)',
        borderColor: 'rgba(13, 110, 253, 1)',
        borderWidth: 1,
        borderRadius: 4,
      },
    ],
  };
});

const deliveriesChartOptions = computed(() => ({
  plugins: {
    legend: { display: false },
    tooltip: {
      callbacks: {
        title: (items) => {
          const idx = items?.[0]?.dataIndex;
          const day = metrics.value.byDay?.[idx]?.day;
          return day || '';
        },
        afterLabel: (item) => {
          const idx = item?.dataIndex;
          const b = metrics.value.byDay?.[idx];
          if (!b) return '';
          return `Receita: ${formatCurrency(b.revenue || 0)}`;
        },
      },
    },
  },
  scales: {
    y: { beginAtZero: true, ticks: { precision: 0 } },
  },
}));

function formatMinutes(min) {
  if (min == null) return '—';
  const m = Math.round(min);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r === 0 ? `${h}h` : `${h}h ${r}min`;
}

// Pagination helpers — back-end already paginates the transactions list;
// these just drive the navigation buttons and the page-size selector below
// the table.
const paginationStart = computed(() => total.value === 0 ? 0 : (page.value - 1) * pageSize.value + 1);
const paginationEnd = computed(() => Math.min(page.value * pageSize.value, total.value));

function goToPage(n) {
  const target = Math.max(1, Math.min(Number(n) || 1, totalPages.value));
  if (target === page.value) return;
  page.value = target;
  fetchTransactions();
}

function changePageSize() {
  // Reset to page 1 whenever the page size changes so the user does not land
  // on a now-empty tail page.
  page.value = 1;
  fetchTransactions();
}

// "Buscar" applies the date/type filters — also reset to page 1 so the
// user does not land on a stale tail page when the filtered total shrinks.
function searchTransactions() {
  page.value = 1;
  fetchTransactions();
}

function startEdit(tx) {
  if (!isAdmin.value) return;
  editingId.value = tx.id;
  editAmount.value = String(tx.amount ?? '');
  editNote.value = tx.note || '';
}

function cancelEdit() {
  editingId.value = null;
  editAmount.value = '';
  editNote.value = '';
}

async function cancelTransaction(tx) {
  if (!isAdmin.value || !tx?.id) return;
  if (tx.status === 'PAID') {
    Swal.fire({ icon: 'warning', text: 'Esta transação já foi paga. Estorne o pagamento antes de cancelá-la.' });
    return;
  }
  if (tx.status === 'CANCELLED') return;
  const confirmation = await Swal.fire({
    title: 'Cancelar transação?',
    text: `Esta ação reverte o valor de ${formatCurrency(Number(tx.amount || 0))} no saldo do entregador.`,
    icon: 'warning',
    input: 'text',
    inputLabel: 'Motivo (opcional)',
    inputPlaceholder: 'Ex: cobrança duplicada, pedido cancelado...',
    showCancelButton: true,
    confirmButtonText: 'Cancelar transação',
    cancelButtonText: 'Voltar',
    confirmButtonColor: '#dc3545',
  });
  if (!confirmation.isConfirmed) return;
  try {
    await api.post(`/riders/${riderId}/transactions/${tx.id}/cancel`, { reason: confirmation.value || null });
    Swal.fire({ icon: 'success', toast: true, position: 'top-end', timer: 1800, showConfirmButton: false, text: 'Transação cancelada.' });
    await fetchBalance();
    await fetchTransactions();
  } catch (e) {
    console.error('cancelTransaction failed', e);
    Swal.fire({ icon: 'error', text: e?.response?.data?.message || 'Falha ao cancelar transação' });
  }
}

async function saveEdit() {
  if (!isAdmin.value || !editingId.value) return;
  savingEdit.value = true;
  try {
    const rawAmount = String(editAmount.value).trim().replace(',', '.');
    const parsedAmount = Number(rawAmount);
    if (rawAmount === '' || isNaN(parsedAmount)) {
      Swal.fire({ icon: 'error', text: 'Informe um valor numérico válido (ex: 3.50 ou 3,50).' });
      return;
    }
    const payload = { amount: parsedAmount, note: editNote.value };
    const { data } = await api.patch(`/riders/${riderId}/transactions/${editingId.value}`, payload);
    Swal.fire({ icon: 'success', text: 'Transação atualizada.' });
    await fetchBalance();
    await fetchTransactions();
    cancelEdit();
  } catch (e) {
    console.error('saveEdit failed', e);
    Swal.fire({ icon: 'error', text: e?.response?.data?.message || 'Falha ao salvar alteração' });
  } finally {
    savingEdit.value = false;
  }
}

async function fetchPeriodFees() {
  try {
    // Period totals must ignore the type filter — balance always reflects all transaction types.
    const params = buildParams(true);
    delete params.type;
    params.full = true;
    const { data } = await api.get(`/riders/${riderId}/transactions`, { params });
    const items = data.items || [];
    let earnings = 0;
    let paidOut = 0;
    let pendingInPeriod = 0;
    let deliveries = 0;
    let bonusTotal = 0;
    let dailyRatesCount = 0;
    let dailyRatesTotal = 0;
    for (const t of items) {
      const amt = Number(t.amount || 0);
      // Cancelled rows are reversed — they don't count anywhere.
      if (t.status === 'CANCELLED') continue;
      // Mirror backend /account/pay: it pays the sum of all PENDING rows in the
      // period, regardless of sign. Keeping the same calculation here ensures
      // the PAGAR button label matches what will actually be settled.
      if (t.status === 'PENDING') pendingInPeriod += amt;
      if (amt > 0) {
        // Positive amounts = earnings (delivery fees, daily rates, bonuses, manual credits).
        earnings += amt;
        if (t.type === 'DELIVERY_FEE') deliveries++;
        if (t.type === 'EARLY_CHECKIN_BONUS' || t.type === 'GOAL_REWARD') bonusTotal += amt;
        if (t.type === 'DAILY_RATE') { dailyRatesCount++; dailyRatesTotal += amt; }
      } else if (amt < 0 && t.status === 'PAID') {
        // Negative PAID rows = payment offsets created by /account/pay (cash outflow).
        // Sum the absolute value as money actually paid out during the period.
        paidOut += -amt;
      }
    }
    periodEarnings.value = earnings;
    periodPaid.value = paidOut;
    // "Valor a pagar" must match what the PAGAR button will actually settle
    // (backend /account/pay sums PENDING rows in the period), not earnings - paidOut,
    // because payments made in the period may have settled fees from earlier periods.
    periodBalance.value = pendingInPeriod;
    periodDeliveries.value = deliveries;
    periodBonusTotal.value = bonusTotal;
    periodDailyRatesCount.value = dailyRatesCount;
    periodDailyRatesTotal.value = dailyRatesTotal;
  } catch (e) {
    console.error('Failed to compute period total', e);
    periodEarnings.value = 0;
    periodPaid.value = 0;
    periodBalance.value = 0;
    periodDeliveries.value = 0;
    periodBonusTotal.value = 0;
    periodDailyRatesCount.value = 0;
    periodDailyRatesTotal.value = 0;
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
  if (periodBalance.value <= 0) return Swal.fire({ icon: 'info', text: periodBalance.value === 0 ? 'Saldo no período é R$ 0,00. Nada a pagar.' : 'Valor já pago excede os ganhos neste período.' });

  const from = filters.value.from || null;
  const to = filters.value.to || null;
  const acctName = financialAccounts.value.find(a => a.id === selectedAccountId.value)?.name || null;
  const acctLine = acctName ? `<br><b>Conta de saída:</b> ${acctName}` : '';
  const paidLine = periodPaid.value > 0 ? `<br><small class="text-muted">Já pago neste período: ${formatCurrency(periodPaid.value)}</small>` : '';

  const res = await Swal.fire({
    title: 'Confirmar pagamento',
    html: `<b>Ganho no período:</b> ${formatCurrency(periodEarnings.value)}`
      + paidLine
      + `<br><b style="font-size:1.1em">Valor a pagar: ${formatCurrency(periodBalance.value)}</b>`
      + `<br><b>Período:</b> ${from || 'início'} → ${to || 'hoje'}`
      + acctLine,
    icon: 'question',
    showCancelButton: true,
    confirmButtonText: `Pagar ${formatCurrency(periodBalance.value)}`,
    cancelButtonText: 'Cancelar'
  });
  if (!res.isConfirmed) return;
  try {
    const payload = { from, to, accountId: selectedAccountId.value || null };
    const { data } = await api.post(`/riders/${riderId}/account/pay`, payload);
    const totalPaid = Number(data?.total || 0);
    const txId = data?.tx?.id;
    const msg = data?.message || 'Pagamento registrado.';
    const details = `Total pago: <b>${formatCurrency(totalPaid)}</b>` + (txId ? `<br>ID transação: <code>${txId}</code>` : '');
    await Swal.fire({ icon: 'success', title: msg, html: details });
    await fetchBalance();
    await fetchTransactions();
    await fetchPeriodFees();
  } catch (e) {
    console.error('pagarPeriodo failed', e);
    Swal.fire({ icon: 'error', text: e?.response?.data?.message || 'Falha ao registrar pagamento' });
  }
}

async function backfillBonuses() {
  if (!isAdmin.value) return;
  const confirmation = await Swal.fire({
    title: 'Recalcular bônus de check-in?',
    html: 'Gera bônus retroativos para entregas que ficaram sem bônus porque o check-in foi feito depois delas.<br><br>Operação <b>idempotente</b>: bônus já existentes são preservados.',
    icon: 'question',
    showCancelButton: true,
    confirmButtonText: 'Recalcular',
    cancelButtonText: 'Cancelar',
  });
  if (!confirmation.isConfirmed) return;
  try {
    const { data } = await api.post(`/riders/${riderId}/account/backfill-bonuses`);
    await Swal.fire({
      icon: 'success',
      title: 'Bônus recalculados',
      html: `
        <div style="text-align:left">
          Dias processados: <b>${data.daysProcessed || 0}</b><br>
          Bônus criados agora: <b>${data.bonusesCreated || 0}</b><br>
          Total de bônus no período: <b>${data.bonusesAfter || 0}</b>
        </div>
      `,
    });
    await fetchBalance();
    await fetchTransactions();
    await fetchPeriodFees();
  } catch (e) {
    console.error('backfillBonuses failed', e);
    Swal.fire({ icon: 'error', text: e?.response?.data?.message || 'Falha ao recalcular bônus' });
  }
}

async function backfillStatus() {
  if (!isAdmin.value) return;
  const confirmation = await Swal.fire({
    title: 'Reconciliar histórico?',
    html: 'Isso vai casar pagamentos antigos (linhas <code>MANUAL_ADJUSTMENT</code> negativas) com as taxas/bônus pendentes mais antigos e marcá-los como <b>Pago</b>.<br><br>Operação <b>idempotente</b>: rodar de novo só completa o que faltou.<br><br>Não afeta saldo (não cria novas linhas).',
    icon: 'question',
    showCancelButton: true,
    confirmButtonText: 'Reconciliar',
    cancelButtonText: 'Cancelar',
  });
  if (!confirmation.isConfirmed) return;
  try {
    const { data } = await api.post(`/riders/${riderId}/account/backfill-status`);
    await Swal.fire({
      icon: 'success',
      title: 'Reconciliação concluída',
      html: `
        <div style="text-align:left">
          <b>${data.txMarkedPaid || 0}</b> linha(s) marcada(s) como Pago<br>
          <b>${data.settlementsMarkedPaid || 0}</b> pagamento(s) histórico(s) flipado(s) pra Pago<br>
          Total casado: <b>${formatCurrency(data.totalSettled || 0)}</b><br>
          Pendentes restantes: <b>${data.pendingPositivesRemaining || 0}</b>
        </div>
      `,
    });
    await fetchBalance();
    await fetchTransactions();
    await fetchPeriodFees();
  } catch (e) {
    console.error('backfillStatus failed', e);
    Swal.fire({ icon: 'error', text: e?.response?.data?.message || 'Falha ao reconciliar' });
  }
}

async function dedupDailyRates() {
  const from = filters.value.from || null;
  const to = filters.value.to || null;

  const { data: preview } = await api.post(`/riders/${riderId}/dedup-daily-rates`, { dryRun: true, startDate: from, endDate: to });
  if (preview.duplicatesFound === 0) {
    return Swal.fire({ icon: 'success', text: 'Nenhuma diária duplicada encontrada no período.' });
  }

  const dayList = preview.duplicates.map(d => `• ${d.day} (R$ ${Number(d.amount).toFixed(2).replace('.', ',')})`).join('<br>');
  const confirm = await Swal.fire({
    title: `${preview.duplicatesFound} diária(s) duplicada(s)`,
    html: `Serão removidas:<br>${dayList}`,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: 'Remover duplicatas',
    cancelButtonText: 'Cancelar',
  });
  if (!confirm.isConfirmed) return;

  await api.post(`/riders/${riderId}/dedup-daily-rates`, { dryRun: false, startDate: from, endDate: to });
  await fetchBalance();
  await fetchTransactions();
  Swal.fire({ icon: 'success', text: `${preview.duplicatesFound} diária(s) duplicada(s) removida(s).` });
}

async function fetchFinancialAccounts() {
  try {
    const { data } = await api.get('/financial/accounts');
    financialAccounts.value = Array.isArray(data) ? data.filter(a => a.isActive !== false) : [];
    financialAccountsLoaded.value = true;
    // Pre-select default account
    const def = financialAccounts.value.find(a => a.isDefault);
    if (def) selectedAccountId.value = def.id;
  } catch (e) {
    // Module not active or no accounts — just ignore
    financialAccounts.value = [];
    financialAccountsLoaded.value = false;
  }
}

function normalizePhoneForSend(v) {
  if (!v) return null;
  let digits = String(v).replace(/\D+/g, '');
  if (!digits) return null;
  digits = digits.replace(/^0+/, '');
  if (!digits.startsWith('55')) digits = '55' + digits;
  return '+' + digits;
}

async function sendPdf() {
  if (!phoneTo.value) return (error.value = 'Informe o telefone destino');
  sendingPdf.value = true; error.value = '';
  try {
    const normalized = normalizePhoneForSend(phoneTo.value);
    if (!normalized) return (error.value = 'Telefone inválido');
    phoneTo.value = normalized;
    const payload = { phone: phoneTo.value, from: filters.value.from || undefined, to: filters.value.to || undefined, type: filters.value.type || undefined };
    const { data } = await api.post(`/riders/${riderId}/account/send-report`, payload);
    success.value = data?.url ? `Relatório gerado. URL: ${data.url}` : 'Relatório enviado com sucesso.';
    setTimeout(() => (success.value = ''), 8000);
  } catch (e) {
    console.error('sendPdf failed', e);
    error.value = e?.response?.data?.message || 'Falha ao enviar relatório';
  } finally { sendingPdf.value = false; }
}

async function exportCsv() {
  exporting.value = true;
  try {
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
  } finally { exporting.value = false; }
}

onMounted(async () => { await fetchRider(); await fetchBalance(); await fetchTransactions(); await fetchFinancialAccounts(); });

</script>

<template>
  <main class="p-4 rider-account">
      <div class="d-flex justify-content-between align-items-center mb-3">
        <h2 class="h4 m-0">Extrato do entregador (Admin)</h2>
        <div>
          <button class="btn btn-outline-secondary btn-sm" @click="$router.back()">Voltar</button>
        </div>
      </div>

      <div v-if="error" class="alert alert-danger">{{ error }}</div>
      <div v-if="success" class="alert alert-success">{{ success }}</div>

      <!-- Filtros -->
      <div class="card mb-3 p-3">
        <div class="row g-2 align-items-end">
          <div class="col-md-3">
            <label class="form-label small">De</label>
            <DateInput v-model="filters.from" inputClass="form-control" />
          </div>
          <div class="col-md-3">
            <label class="form-label small">Até</label>
            <DateInput v-model="filters.to" inputClass="form-control" />
          </div>
          <div class="col-md-3">
            <label class="form-label small">Tipo</label>
            <SelectInput v-model="filters.type">
              <option value="">Todos</option>
              <option value="DELIVERY_FEE">Taxa de entrega</option>
              <option value="DAILY_RATE">Diária</option>
              <option value="EARLY_CHECKIN_BONUS">Bônus checkin</option>
              <option value="MANUAL_ADJUSTMENT">Ajuste manual</option>
              <option value="GOAL_REWARD">Recompensa meta</option>
            </SelectInput>
          </div>
          <div class="col-md-3 d-flex align-items-end">
            <button class="btn btn-primary w-100" @click="searchTransactions" :disabled="loadingTx || !datesAreValid">
              {{ loadingTx ? 'Buscando...' : 'Buscar' }}
            </button>
          </div>
        </div>
        <div v-if="dateValidationMessage" class="mt-2 text-danger small">{{ dateValidationMessage }}</div>
      </div>

      <!-- Resumo financeiro do período -->
      <div class="card mb-3">
        <div class="card-body">
          <!-- Linha 1: Ganhos / Pago / A pagar -->
          <div class="row g-3 mb-3">
            <div class="col-md-4">
              <div class="border rounded p-3 text-center">
                <div class="small text-muted">Valor ganho no período</div>
                <div class="h4 mb-0 text-success">{{ formatCurrency(periodEarnings) }}</div>
              </div>
            </div>
            <div class="col-md-4">
              <div class="border rounded p-3 text-center">
                <div class="small text-muted">Valor já pago no período</div>
                <div class="h4 mb-0" :class="periodPaid > 0 ? 'text-danger' : ''">{{ formatCurrency(periodPaid) }}</div>
              </div>
            </div>
            <div class="col-md-4">
              <div class="border rounded p-3 text-center" :class="periodBalance > 0 ? 'border-success' : ''">
                <div class="small text-muted fw-semibold">Valor a pagar</div>
                <div class="h4 mb-0 fw-bold" :class="periodBalance > 0 ? 'text-success' : periodBalance < 0 ? 'text-danger' : ''">
                  {{ formatCurrency(periodBalance) }}
                </div>
              </div>
            </div>
          </div>

          <!-- Linha 2: Métricas do período -->
          <div class="row g-3 mb-3">
            <div class="col-6 col-md-3">
              <div class="border rounded p-3 text-center">
                <div class="small text-muted">Entregas</div>
                <div class="h4 mb-0">{{ periodDeliveries }}</div>
              </div>
            </div>
            <div class="col-6 col-md-3">
              <div class="border rounded p-3 text-center">
                <div class="small text-muted">Total bônus</div>
                <div class="h4 mb-0 text-info">{{ formatCurrency(periodBonusTotal) }}</div>
              </div>
            </div>
            <div class="col-6 col-md-3">
              <div class="border rounded p-3 text-center">
                <div class="small text-muted">Diárias</div>
                <div class="h4 mb-0">{{ periodDailyRatesCount }}</div>
              </div>
            </div>
            <div class="col-6 col-md-3">
              <div class="border rounded p-3 text-center">
                <div class="small text-muted">Total diárias</div>
                <div class="h4 mb-0">{{ formatCurrency(periodDailyRatesTotal) }}</div>
              </div>
            </div>
          </div>

          <!-- Linha 3: Conta de saída + Pagar + Ações -->
          <div class="row align-items-end g-3">
            <!-- Conta de saída -->
            <div class="col-md-4" v-if="financialAccounts.length > 0">
              <label class="form-label small mb-1">Conta de saída</label>
              <SelectInput
                v-model="selectedAccountId"
                :options="financialAccounts.map(a => ({ value: a.id, label: a.name }))"
                placeholder="Selecione a conta..."
              />
            </div>
            <div class="col-md-4" v-else-if="financialAccountsLoaded">
              <label class="form-label small mb-1">Conta de saída</label>
              <div class="text-muted small p-2 border rounded bg-light">
                Nenhuma conta cadastrada.
                <router-link to="/financial/accounts">Cadastrar</router-link>
              </div>
            </div>

            <!-- Botão Pagar -->
            <div class="col-md-4 d-flex align-items-end">
              <button
                class="btn btn-success w-100 py-2"
                @click="pagarPeriodo"
                :disabled="!datesAreValid || periodBalance <= 0"
              >
                PAGAR {{ periodBalance > 0 ? formatCurrency(periodBalance) : '' }}
              </button>
            </div>

            <!-- Ações secundárias -->
            <div class="col-md-4 d-flex gap-2 align-items-end flex-wrap">
              <button class="btn btn-sm btn-outline-secondary" @click="exportCsv" :disabled="exporting || !datesAreValid">
                {{ exporting ? 'Exportando...' : 'Exportar CSV' }}
              </button>
              <button class="btn btn-sm btn-outline-secondary" @click="fetchBalance" :disabled="loading">Atualizar</button>
              <button class="btn btn-sm btn-outline-warning" @click="dedupDailyRates" :disabled="!isAdmin" title="Remove diárias duplicadas no mesmo dia">
                Corrigir diárias
              </button>
              <button class="btn btn-sm btn-outline-primary" @click="backfillStatus" :disabled="!isAdmin" title="Marca como Pago as taxas que já foram quitadas por pagamentos antigos">
                Reconciliar histórico
              </button>
              <button class="btn btn-sm btn-outline-success" @click="backfillBonuses" :disabled="!isAdmin" title="Gera bônus de check-in retroativos para entregas anteriores ao horário do check-in">
                Recalcular bônus
              </button>
            </div>
          </div>

          <!-- WhatsApp PDF (linha separada) -->
          <div class="d-none d-md-flex align-items-center gap-2 mt-3 pt-3 border-top">
            <TextInput v-model="phoneTo" placeholder="+5511999999999" inputClass="form-control form-control-sm phone-input" />
            <button class="btn btn-sm btn-success" @click="sendPdf" :disabled="sendingPdf || !datesAreValid">
              {{ sendingPdf ? 'Enviando...' : 'Enviar PDF (WhatsApp)' }}
            </button>
          </div>
        </div>
      </div>

      <!-- Métricas operacionais do período (KPIs + entregas por dia) -->
      <div class="card mb-3">
        <div class="card-body">
          <div class="d-flex align-items-center justify-content-between mb-3">
            <h6 class="mb-0"><i class="bi bi-graph-up me-1"></i>Métricas do período</h6>
            <small v-if="loadingMetrics" class="text-muted">Atualizando...</small>
          </div>

          <div class="row g-3 mb-3">
            <div class="col-6 col-md-3">
              <div class="border rounded p-3 text-center">
                <div class="small text-muted">Entregas</div>
                <div class="h4 mb-0">{{ metrics.totalDeliveries }}</div>
              </div>
            </div>
            <div class="col-6 col-md-3">
              <div class="border rounded p-3 text-center">
                <div class="small text-muted">Tempo médio</div>
                <div class="h4 mb-0" :title="metrics.avgDeliveryTimeMin != null ? `${metrics.avgDeliveryTimeMin} min de SAIU para CONFIRMAÇÃO` : 'Nenhuma entrega com horários completos'">
                  {{ formatMinutes(metrics.avgDeliveryTimeMin) }}
                </div>
              </div>
            </div>
            <div class="col-6 col-md-3">
              <div class="border rounded p-3 text-center">
                <div class="small text-muted">Custo médio / entrega</div>
                <div class="h4 mb-0 text-warning">{{ formatCurrency(metrics.avgCostPerDelivery) }}</div>
              </div>
            </div>
            <div class="col-6 col-md-3">
              <div class="border rounded p-3 text-center">
                <div class="small text-muted">Receita gerada</div>
                <div class="h4 mb-0 text-success" :title="'Soma do total dos pedidos entregues por este motoboy'">
                  {{ formatCurrency(metrics.revenueGenerated) }}
                </div>
              </div>
            </div>
          </div>

          <div v-if="metrics.byDay && metrics.byDay.length > 0">
            <div class="small text-muted mb-2">Entregas por dia</div>
            <BaseChart type="bar" :data="deliveriesChartData" :options="deliveriesChartOptions" height="220px" />
          </div>
          <div v-else-if="!loadingMetrics" class="text-center text-muted small py-3">
            Sem entregas no período selecionado.
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
                <th>Status</th>
                <th>Pedido</th>
                <th>Observação</th>
                <th v-if="isAdmin" class="text-end">Ações</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="!loadingTx && transactions.length === 0">
                <td :colspan="isAdmin ? 7 : 6" class="text-center text-muted py-4">Nenhuma transação no período.</td>
              </tr>
              <tr v-for="t in transactions" :key="t.id" :class="{ 'text-muted': t.status === 'CANCELLED' }">
                <td>{{ formatDateWithOptionalTime(t.date) }}</td>
                <td>{{ typeLabel(t.type) }}</td>
                <td>
                  <div v-if="isAdmin && editingId === t.id" class="d-flex gap-2 align-items-center">
                    <input class="form-control form-control-sm" v-model="editAmount" style="width:110px" />
                    <input class="form-control form-control-sm" v-model="editNote" placeholder="Observação" />
                    <div class="btn-group">
                      <button class="btn btn-sm btn-success" @click="saveEdit" :disabled="savingEdit">{{ savingEdit ? 'Salvando...' : 'Salvar' }}</button>
                      <button class="btn btn-sm btn-outline-secondary" @click="cancelEdit">Cancelar</button>
                    </div>
                  </div>
                  <div v-else>
                    <span
                      :class="{ 'text-primary': isAdmin && t.status !== 'CANCELLED', 'text-decoration-line-through': t.status === 'CANCELLED' }"
                      @click="isAdmin && t.status !== 'CANCELLED' ? startEdit(t) : null"
                      :style="{ cursor: isAdmin && t.status !== 'CANCELLED' ? 'pointer' : 'default' }"
                    >{{ formatCurrency(Number(t.amount || 0)) }}</span>
                  </div>
                </td>
                <td>
                  <span class="badge" :class="statusBadge(t.status).cls" :title="t.status === 'PAID' && t.paidAt ? `Pago em ${formatDateWithOptionalTime(t.paidAt)}` : (t.status === 'CANCELLED' && t.cancelReason ? t.cancelReason : null)">
                    {{ statusBadge(t.status).label }}
                  </span>
                </td>
                <td>{{ t.order?.displaySimple ? `#${t.order.displaySimple}` : (t.order?.displayId || '—') }}</td>
                <td>{{ t.note || '—' }}</td>
                <td v-if="isAdmin" class="text-end">
                  <button
                    v-if="t.status === 'PENDING'"
                    class="btn btn-sm btn-outline-danger"
                    @click="cancelTransaction(t)"
                    title="Cancelar transação (reverte saldo)"
                  >
                    <i class="bi bi-x-circle"></i>
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Pagination footer (always visible when there is data — backend already
             paginates, just exposing controls and a page-size selector). -->
        <div v-if="total > 0" class="d-flex flex-wrap align-items-center justify-content-between gap-2 p-2 border-top">
          <small class="text-muted">
            Mostrando {{ paginationStart }}–{{ paginationEnd }} de {{ total }}
          </small>
          <div class="d-flex align-items-center gap-1">
            <button class="btn btn-sm btn-outline-secondary" :disabled="page <= 1 || loadingTx" @click="goToPage(1)" title="Primeira">
              <i class="bi bi-chevron-double-left"></i>
            </button>
            <button class="btn btn-sm btn-outline-secondary" :disabled="page <= 1 || loadingTx" @click="goToPage(page - 1)" title="Anterior">
              <i class="bi bi-chevron-left"></i>
            </button>
            <span class="small px-2">Página {{ page }} de {{ totalPages }}</span>
            <button class="btn btn-sm btn-outline-secondary" :disabled="page >= totalPages || loadingTx" @click="goToPage(page + 1)" title="Próxima">
              <i class="bi bi-chevron-right"></i>
            </button>
            <button class="btn btn-sm btn-outline-secondary" :disabled="page >= totalPages || loadingTx" @click="goToPage(totalPages)" title="Última">
              <i class="bi bi-chevron-double-right"></i>
            </button>
            <select class="form-select form-select-sm ms-2" style="width:auto" v-model.number="pageSize" @change="changePageSize" :disabled="loadingTx">
              <option :value="25">25 / pág.</option>
              <option :value="50">50 / pág.</option>
              <option :value="100">100 / pág.</option>
              <option :value="200">200 / pág.</option>
            </select>
          </div>
        </div>
      </div>
    </main>
</template>

<style scoped>
.rider-account { overflow-x: hidden; }
.rider-account .phone-input { max-width: 180px; }
</style>
