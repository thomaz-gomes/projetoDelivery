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

const route = useRoute();
const riderId = route.params.id;
const rider = ref(null);

// inline edit foi substituído pelo modal "Editar lançamento" (openEditModal)

// auth + role helpers
const auth = useAuthStore();
const isAdmin = computed(() => {
  const role = String(auth.user?.role || '').toUpperCase();
  return role === 'ADMIN' || role === 'SUPER_ADMIN';
});

// send PDF via WhatsApp — telefone agora é coletado num Swal ao clicar
// no botão "Enviar PDF" (vê sendPdf()), pré-preenchido com rider.whatsapp.
const sendingPdf = ref(false);

// paging & filters
const page = ref(1);
const pageSize = ref(25);
const total = ref(0);
const totalPages = ref(1);
const filters = ref({ from: '', to: '', type: '' });

// financial accounts (loaded if module is active)
const financialAccounts = ref([]);
const selectedAccountId = ref('');
const financialAccountsLoaded = ref(false);
const costCenters = ref([]);

// "Novo Lançamento" modal — unifica 4 fluxos:
//   PAY        → pagar saldo do período           (POST /account/pay)
//   MANUAL     → crédito ou débito manual         (POST /account/adjust)
//   PAY_SINGLE → pagar uma linha do extrato       (POST /transactions/:txId/pay)
//   EDIT       → editar uma linha do extrato      (PATCH /transactions/:txId)
// Mesmo layout do modal de FinancialTransactions.vue para consistência visual.
const showLancamentoModal = ref(false);
const lancamentoMode = ref('PAY'); // 'PAY' | 'MANUAL' | 'PAY_SINGLE' | 'EDIT'
const lancamentoSaving = ref(false);
const lancamentoTx = ref(null);    // RiderTransaction sendo editada / paga (PAY_SINGLE e EDIT)
const lancamentoForm = ref({
  type: 'PAYABLE',          // 'PAYABLE' (A Pagar / Crédito) | 'RECEIVABLE' (A Receber / Débito)
  description: '',
  grossAmount: 0,
  accountId: '',
  costCenterId: '',
  dueDate: '',
  notes: '',
});

const lancamentoTitle = computed(() => {
  if (lancamentoMode.value === 'PAY') return 'Pagar período';
  if (lancamentoMode.value === 'PAY_SINGLE') return 'Pagar lançamento';
  if (lancamentoMode.value === 'EDIT') return 'Editar lançamento';
  if (lancamentoMode.value === 'MANUAL') {
    return lancamentoForm.value.type === 'RECEIVABLE' ? 'Débito manual' : 'Crédito manual';
  }
  return 'Novo lançamento';
});
const lancamentoCtaLabel = computed(() => {
  if (lancamentoMode.value === 'PAY') return 'Confirmar pagamento';
  if (lancamentoMode.value === 'PAY_SINGLE') return 'Pagar';
  if (lancamentoMode.value === 'EDIT') return 'Salvar alterações';
  if (lancamentoMode.value === 'MANUAL') {
    return lancamentoForm.value.type === 'RECEIVABLE' ? 'Aplicar débito' : 'Aplicar crédito';
  }
  return 'Salvar';
});
// Valor bruto é editável só em MANUAL e EDIT.
const lancamentoAmountDisabled = computed(() => ['PAY', 'PAY_SINGLE'].includes(lancamentoMode.value));
// Tipo é editável só em MANUAL.
const lancamentoTypeEditable = computed(() => lancamentoMode.value === 'MANUAL');

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

// Substituídas: startEdit/cancelEdit/saveEdit/payTransaction agora abrem o
// modal unificado com modos EDIT / PAY_SINGLE. As funções abaixo são
// thin wrappers ao redor de openLancamentoModal.

function openEditModal(tx) {
  if (!isAdmin.value || !tx?.id) return;
  if (tx.status === 'CANCELLED') return;
  lancamentoMode.value = 'EDIT';
  lancamentoTx.value = tx;
  const amt = Number(tx.amount || 0);
  lancamentoForm.value = {
    // Direção financeira derivada do sinal — só pra exibição. EDIT não muda Tipo.
    type: amt < 0 ? 'RECEIVABLE' : 'PAYABLE',
    description: tx.note || typeLabel(tx.type),
    grossAmount: Math.abs(amt),
    accountId: '',
    costCenterId: '',
    dueDate: tx.date ? new Date(tx.date).toISOString().slice(0, 10) : '',
    notes: tx.note || '',
  };
  showLancamentoModal.value = true;
}

function openPaySingleModal(tx) {
  if (!isAdmin.value || !tx?.id) return;
  if (tx.status === 'PAID') {
    Swal.fire({ icon: 'info', text: 'Este lançamento já está pago.' });
    return;
  }
  if (tx.status === 'CANCELLED') return;
  const amt = Number(tx.amount || 0);
  if (amt <= 0) {
    Swal.fire({ icon: 'warning', text: 'Apenas lançamentos de valor positivo podem ser pagos individualmente.' });
    return;
  }
  lancamentoMode.value = 'PAY_SINGLE';
  lancamentoTx.value = tx;
  lancamentoForm.value = {
    type: 'PAYABLE',
    description: `Pagamento de ${typeLabel(tx.type)}${tx.note ? ' - ' + tx.note : ''}`,
    grossAmount: amt,
    accountId: selectedAccountId.value || '',
    costCenterId: '',
    dueDate: new Date().toISOString().slice(0, 10),
    notes: '',
  };
  showLancamentoModal.value = true;
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

// pagarPeriodo() foi substituído por openLancamentoModal('PAY') + saveLancamento()
// para alinhar a UX ao modal "Novo Lançamento" do módulo financeiro.

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
  if (!datesAreValid.value) {
    Swal.fire({ icon: 'error', text: dateValidationMessage.value });
    return;
  }

  // Pré-preenche com o WhatsApp do motoboy (formato BR limpo, sem +/55).
  // O usuário pode editar antes de enviar.
  const defaultPhone = rider.value?.whatsapp || '';

  const { value: input, isConfirmed } = await Swal.fire({
    title: 'Enviar PDF por WhatsApp',
    html: `<div class="text-muted small">Período: <b>${filters.value.from || 'início'}</b> → <b>${filters.value.to || 'hoje'}</b></div>`,
    input: 'tel',
    inputLabel: 'Telefone do destinatário',
    inputValue: defaultPhone,
    inputPlaceholder: '+5511999999999',
    showCancelButton: true,
    confirmButtonText: 'Enviar',
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#198754',
    inputValidator: (value) => {
      if (!value) return 'Informe o telefone';
      if (!normalizePhoneForSend(value)) return 'Telefone inválido';
      return null;
    },
  });
  if (!isConfirmed) return;

  const normalized = normalizePhoneForSend(input);
  sendingPdf.value = true;
  error.value = '';
  try {
    const payload = {
      phone: normalized,
      from: filters.value.from || undefined,
      to: filters.value.to || undefined,
      type: filters.value.type || undefined,
    };
    const { data } = await api.post(`/riders/${riderId}/account/send-report`, payload);
    const msg = data?.url ? `Relatório gerado. URL: ${data.url}` : 'Relatório enviado com sucesso.';
    Swal.fire({ icon: 'success', text: msg });
  } catch (e) {
    console.error('sendPdf failed', e);
    Swal.fire({ icon: 'error', text: e?.response?.data?.message || 'Falha ao enviar relatório' });
  } finally {
    sendingPdf.value = false;
  }
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

async function fetchCostCenters() {
  try {
    const { data } = await api.get('/financial/cost-centers', { params: { flat: 'true' } });
    costCenters.value = Array.isArray(data) ? data : [];
  } catch (e) {
    costCenters.value = [];
  }
}

// Abre o modal com pre-fill conforme o modo (PAY/MANUAL).
// Em MANUAL o usuário escolhe Tipo (A Pagar=crédito, A Receber=débito) dentro
// do modal — começa como PAYABLE/crédito por padrão.
function openLancamentoModal(mode) {
  lancamentoMode.value = mode;
  const isPay = mode === 'PAY';
  const fromTxt = filters.value.from || 'início';
  const toTxt = filters.value.to || 'hoje';

  let description = 'Lançamento manual';
  let grossAmount = 0;
  if (isPay) {
    if (!datesAreValid.value) {
      Swal.fire({ icon: 'error', text: dateValidationMessage.value });
      return;
    }
    if (periodBalance.value <= 0) {
      Swal.fire({
        icon: 'info',
        text: periodBalance.value === 0
          ? 'Saldo no período é R$ 0,00. Nada a pagar.'
          : 'Valor já pago excede os ganhos neste período.',
      });
      return;
    }
    description = `Pagamento de período ${fromTxt} → ${toTxt}`;
    grossAmount = Number(periodBalance.value || 0);
  }

  lancamentoForm.value = {
    type: 'PAYABLE',
    description,
    grossAmount,
    accountId: selectedAccountId.value || '',
    costCenterId: '',
    dueDate: new Date().toISOString().slice(0, 10),
    notes: '',
  };
  showLancamentoModal.value = true;
}

async function saveLancamento() {
  error.value = '';
  success.value = '';
  const val = Number(lancamentoForm.value.grossAmount || 0);
  if (!val || val <= 0) {
    Swal.fire({ icon: 'error', text: 'Informe um valor maior que zero.' });
    return;
  }

  lancamentoSaving.value = true;
  try {
    if (lancamentoMode.value === 'PAY') {
      const payload = {
        from: filters.value.from || null,
        to: filters.value.to || null,
        accountId: lancamentoForm.value.accountId || null,
      };
      const { data } = await api.post(`/riders/${riderId}/account/pay`, payload);
      const totalPaid = Number(data?.total || 0);
      const txId = data?.tx?.id;
      const msg = data?.message || 'Pagamento registrado.';
      const details = `Total pago: <b>${formatCurrency(totalPaid)}</b>`
        + (txId ? `<br>ID transação: <code>${txId}</code>` : '');
      showLancamentoModal.value = false;
      await Swal.fire({ icon: 'success', title: msg, html: details });
    } else if (lancamentoMode.value === 'PAY_SINGLE') {
      const txId = lancamentoTx.value?.id;
      if (!txId) throw new Error('Transação não selecionada');
      await api.post(`/riders/${riderId}/transactions/${txId}/pay`, {
        accountId: lancamentoForm.value.accountId || null,
      });
      showLancamentoModal.value = false;
      Swal.fire({ icon: 'success', toast: true, position: 'top-end', timer: 1800, showConfirmButton: false, text: 'Lançamento pago.' });
    } else if (lancamentoMode.value === 'EDIT') {
      const txId = lancamentoTx.value?.id;
      if (!txId) throw new Error('Transação não selecionada');
      // Backend PATCH aceita { amount, note }. Preserva o sinal original
      // (ex: ajustes negativos continuam negativos após edição).
      const originalAmount = Number(lancamentoTx.value.amount || 0);
      const signedAmount = originalAmount < 0 ? -val : val;
      await api.patch(`/riders/${riderId}/transactions/${txId}`, {
        amount: signedAmount,
        note: lancamentoForm.value.description || null,
        date: lancamentoForm.value.dueDate || undefined,
      });
      showLancamentoModal.value = false;
      success.value = 'Lançamento atualizado.';
      setTimeout(() => (success.value = ''), 4000);
    } else {
      // Em MANUAL, o tipo escolhido no modal (PAYABLE/RECEIVABLE) decide
      // se é CREDIT ou DEBIT no endpoint /account/adjust.
      const adjustType = lancamentoForm.value.type === 'RECEIVABLE' ? 'DEBIT' : 'CREDIT';
      const payload = {
        amount: val,
        type: adjustType,
        note: lancamentoForm.value.notes || lancamentoForm.value.description || undefined,
        accountId: lancamentoForm.value.accountId || undefined,
      };
      await api.post(`/riders/${riderId}/account/adjust`, payload);
      const verb = adjustType === 'DEBIT' ? 'Débito' : 'Crédito';
      showLancamentoModal.value = false;
      success.value = `${verb} aplicado com sucesso`
        + (lancamentoForm.value.accountId ? ' (registrado no financeiro).' : ' (pendente no financeiro).');
      setTimeout(() => (success.value = ''), 5000);
    }
    await fetchBalance();
    await fetchTransactions();
    await fetchPeriodFees();
  } catch (e) {
    console.error('saveLancamento failed', e);
    error.value = e?.response?.data?.message || 'Falha ao salvar lançamento';
    Swal.fire({ icon: 'error', text: error.value });
  } finally {
    lancamentoSaving.value = false;
  }
}

onMounted(async () => {
  await fetchRider();
  await fetchBalance();
  await fetchTransactions();
  await fetchFinancialAccounts();
  await fetchCostCenters();
});

</script>

<template>
  <main class="container p-4 rider-account">
      <div class="d-flex justify-content-between align-items-center mb-3">
        <h2 class="h4 m-0">
          Extrato do entregador
          <span v-if="rider?.name" class="text-primary"> — {{ rider.name }}</span>
          <span class="text-muted small ms-2">(Admin)</span>
        </h2>
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

          <!-- Linha única de ações: Conta de saída, Pagar, Crédito/Débito,
               Enviar PDF, Exportar CSV. Em telas estreitas o flex-wrap quebra.
               O telefone do destinatário do PDF é coletado num Swal ao clicar. -->
          <div class="d-flex flex-wrap gap-2 align-items-end">
            <div v-if="financialAccounts.length > 0" style="min-width: 220px; flex: 1 1 220px;">
              <SelectInput
                v-model="selectedAccountId"
                :options="financialAccounts.map(a => ({ value: a.id, label: a.name }))"
                placeholder="Conta de saída..."
              />
            </div>
            <button
              class="btn btn-success"
              @click="openLancamentoModal('PAY')"
              :disabled="!datesAreValid || periodBalance <= 0"
            >
              PAGAR {{ periodBalance > 0 ? formatCurrency(periodBalance) : '' }}
            </button>
            <button
              class="btn btn-outline-primary"
              v-if="isAdmin"
              @click="openLancamentoModal('MANUAL')"
            >
              <i class="bi bi-arrow-left-right me-1"></i> Crédito / Débito
            </button>
            <button
              class="btn btn-outline-success"
              @click="sendPdf"
              :disabled="sendingPdf || !datesAreValid"
            >
              <i class="bi bi-whatsapp me-1"></i>
              {{ sendingPdf ? 'Enviando...' : 'Enviar PDF' }}
            </button>
            <button
              class="btn btn-outline-secondary ms-auto"
              @click="exportCsv"
              :disabled="exporting || !datesAreValid"
            >
              <i class="bi bi-download me-1"></i>
              {{ exporting ? 'Exportando...' : 'Exportar CSV' }}
            </button>
          </div>
          <div v-if="financialAccountsLoaded && financialAccounts.length === 0" class="text-muted small mt-2">
            Nenhuma conta financeira cadastrada.
            <router-link to="/financial/accounts">Cadastrar</router-link>
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
                <th>Pago em</th>
                <th>Pedido</th>
                <th>Observação</th>
                <th v-if="isAdmin" class="text-end">Ações</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="!loadingTx && transactions.length === 0">
                <td :colspan="isAdmin ? 8 : 7" class="text-center text-muted py-4">Nenhuma transação no período.</td>
              </tr>
              <tr v-for="t in transactions" :key="t.id" :class="{ 'text-muted': t.status === 'CANCELLED' }">
                <td>{{ formatDateWithOptionalTime(t.date) }}</td>
                <td>{{ typeLabel(t.type) }}</td>
                <td>
                  <span
                    :class="{ 'text-primary': isAdmin && t.status !== 'CANCELLED', 'text-decoration-line-through': t.status === 'CANCELLED' }"
                    @click="isAdmin && t.status !== 'CANCELLED' ? openEditModal(t) : null"
                    :style="{ cursor: isAdmin && t.status !== 'CANCELLED' ? 'pointer' : 'default' }"
                  >{{ formatCurrency(Number(t.amount || 0)) }}</span>
                </td>
                <td>
                  <span class="badge" :class="statusBadge(t.status).cls" :title="t.status === 'PAID' && t.paidAt ? `Pago em ${formatDateWithOptionalTime(t.paidAt)}` : (t.status === 'CANCELLED' && t.cancelReason ? t.cancelReason : null)">
                    {{ statusBadge(t.status).label }}
                  </span>
                </td>
                <td>{{ t.paidAt ? formatDateWithOptionalTime(t.paidAt) : '—' }}</td>
                <td>{{ t.order?.displaySimple ? `#${t.order.displaySimple}` : (t.order?.displayId || '—') }}</td>
                <td>{{ t.note || '—' }}</td>
                <td v-if="isAdmin" class="text-end">
                  <div v-if="t.status === 'PENDING'" class="btn-group">
                    <button
                      class="btn btn-sm btn-outline-success"
                      @click="openPaySingleModal(t)"
                      :disabled="Number(t.amount || 0) <= 0"
                      title="Pagar lançamento individualmente"
                    >
                      <i class="bi bi-cash"></i>
                    </button>
                    <button
                      class="btn btn-sm btn-outline-primary"
                      @click="openEditModal(t)"
                      title="Editar lançamento"
                    >
                      <i class="bi bi-pencil"></i>
                    </button>
                    <button
                      class="btn btn-sm btn-outline-danger"
                      @click="cancelTransaction(t)"
                      title="Cancelar transação (reverte saldo)"
                    >
                      <i class="bi bi-x-circle"></i>
                    </button>
                  </div>
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

    <!-- Modal: lançamento financeiro do motoboy (Pagar / Crédito / Débito) -->
    <div v-if="showLancamentoModal" class="modal d-block" tabindex="-1" style="background: rgba(0,0,0,0.5)">
      <div class="modal-dialog modal-lg">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">{{ lancamentoTitle }}</h5>
            <button type="button" class="btn-close" @click="showLancamentoModal = false"></button>
          </div>
          <div class="modal-body">
            <div class="row g-3">
              <div class="col-md-6">
                <label class="form-label">Tipo</label>
                <SelectInput
                  v-if="lancamentoTypeEditable"
                  v-model="lancamentoForm.type"
                  :options="[
                    { value: 'PAYABLE', label: 'A Pagar (Crédito)' },
                    { value: 'RECEIVABLE', label: 'A Receber (Débito)' },
                  ]"
                />
                <input
                  v-else
                  type="text"
                  class="form-control bg-light"
                  :value="lancamentoForm.type === 'RECEIVABLE' ? 'A Receber' : 'A Pagar'"
                  disabled
                />
              </div>
              <div class="col-md-6">
                <label class="form-label">Descrição</label>
                <TextInput v-model="lancamentoForm.description" placeholder="Ex: Crédito manual" />
              </div>
              <div class="col-md-4">
                <label class="form-label">Valor Bruto (R$)</label>
                <input
                  type="number"
                  class="form-control"
                  v-model.number="lancamentoForm.grossAmount"
                  step="0.01"
                  min="0"
                  :disabled="lancamentoAmountDisabled"
                />
                <div v-if="lancamentoMode === 'PAY'" class="form-text small">
                  Calculado automaticamente a partir do saldo do período.
                </div>
                <div v-else-if="lancamentoMode === 'PAY_SINGLE'" class="form-text small">
                  Valor do lançamento selecionado no extrato.
                </div>
              </div>
              <div class="col-md-4">
                <label class="form-label">Conta</label>
                <SelectInput
                  v-model="lancamentoForm.accountId"
                  :options="financialAccounts.map(a => ({ value: a.id, label: a.name }))"
                  placeholder="Selecionar conta"
                />
              </div>
              <div class="col-md-4">
                <label class="form-label">Centro de Custo</label>
                <SelectInput
                  v-model="lancamentoForm.costCenterId"
                  :options="costCenters.map(c => ({ value: c.id, label: `${c.code} - ${c.name}` }))"
                  placeholder="Selecionar"
                />
              </div>
              <div class="col-md-4">
                <label class="form-label">Fornecedor</label>
                <input
                  type="text"
                  class="form-control bg-light"
                  :value="rider ? `Motoboy: ${rider.name}` : 'Motoboy'"
                  disabled
                />
              </div>
              <div class="col-md-4">
                <label class="form-label">Operadora (taxas)</label>
                <input type="text" class="form-control bg-light" value="Nenhuma (sem taxa)" disabled />
              </div>
              <div class="col-md-4">
                <label class="form-label">Forma de Pagamento</label>
                <input type="text" class="form-control bg-light" value="Nenhuma (avulso)" disabled />
              </div>
              <div class="col-md-6">
                <label class="form-label">Data de Emissão</label>
                <input type="date" class="form-control" v-model="lancamentoForm.dueDate" />
              </div>
              <div class="col-12">
                <label class="form-label">Observações</label>
                <textarea class="form-control" v-model="lancamentoForm.notes" rows="2"></textarea>
              </div>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" @click="showLancamentoModal = false">Cancelar</button>
            <button class="btn btn-primary" @click="saveLancamento" :disabled="lancamentoSaving">
              {{ lancamentoSaving ? 'Salvando...' : lancamentoCtaLabel }}
            </button>
          </div>
        </div>
      </div>
    </div>
</template>

<style scoped>
.rider-account { overflow-x: hidden; }
.rider-account .phone-input { max-width: 180px; }
</style>
