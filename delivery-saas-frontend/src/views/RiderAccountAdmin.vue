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

function startEdit(tx) {
  if (!isAdmin.value) return;
  editingId.value = tx.id;
  editAmount.value = String(tx.amount || '');
  editNote.value = tx.note || '';
}

function cancelEdit() {
  editingId.value = null;
  editAmount.value = '';
  editNote.value = '';
}

async function saveEdit() {
  if (!isAdmin.value || !editingId.value) return;
  savingEdit.value = true;
  try {
    const payload = { amount: Number(editAmount.value), note: editNote.value };
    const { data } = await api.patch(`/riders/${riderId}/transactions/${editingId.value}`, payload);
    Swal.fire({ icon: 'success', text: 'Transação atualizada.' });
    // refresh list and balances
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
    const params = buildParams(true);
    params.full = true;
    const { data } = await api.get(`/riders/${riderId}/transactions`, { params });
    const items = data.items || [];
    let earnings = 0;
    let paid = 0;
    for (const t of items) {
      const amt = Number(t.amount || 0);
      if (amt >= 0) earnings += amt;
      else paid += Math.abs(amt);
    }
    periodEarnings.value = earnings;
    periodPaid.value = paid;
    periodBalance.value = earnings - paid;
  } catch (e) {
    console.error('Failed to compute period total', e);
    periodEarnings.value = 0;
    periodPaid.value = 0;
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
              <option value="DELIVERY_FEE">Delivery fee</option>
              <option value="DAILY_RATE">Daily rate</option>
              <option value="MANUAL_ADJUSTMENT">Manual adjustment</option>
            </SelectInput>
          </div>
          <div class="col-md-3 d-flex align-items-end">
            <button class="btn btn-primary w-100" @click="fetchTransactions" :disabled="loadingTx || !datesAreValid">
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

          <!-- Linha 2: Conta de saída + Pagar + Ações -->
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
            <div class="col-md-4 d-flex gap-2 align-items-end">
              <button class="btn btn-sm btn-outline-secondary" @click="exportCsv" :disabled="exporting || !datesAreValid">
                {{ exporting ? 'Exportando...' : 'Exportar CSV' }}
              </button>
              <button class="btn btn-sm btn-outline-secondary" @click="fetchBalance" :disabled="loading">Atualizar</button>
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
                <td>{{ formatDateWithOptionalTime(t.date) }}</td>
                <td>{{ t.type }}</td>
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
                    <span :class="{ 'text-primary': isAdmin }" @click="isAdmin ? startEdit(t) : null" style="cursor: pointer">{{ formatCurrency(Number(t.amount || 0)) }}</span>
                  </div>
                </td>
                <td>{{ t.order?.displayId || t.displayId || '—' }}</td>
                <td>{{ t.note || '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </main>
</template>

<style scoped>
.rider-account { overflow-x: hidden; }
.rider-account .phone-input { max-width: 180px; }
</style>
