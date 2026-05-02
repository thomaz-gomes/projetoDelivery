<template>
  <div class="cash-control d-inline-block ms-2" ref="container">
    <template v-if="currentSession">
        <button type="button" class="btn btn-secondary btn-sm" @click="toggleDropdown" :aria-expanded="showDropdown">
          <i class="bi bi-cash-coin"></i>
          <span class="d-none d-sm-inline">
            <span class="badge bg-success ms-1">{{ currentSession.label || 'Caixa' }}</span>
          </span>
          <small class="text-muted ms-1 d-none d-md-inline">{{ currentSession.channels?.join(', ') }}</small>
        </button>
        <ul v-show="showDropdown" class="dropdown-menu show" style="position:absolute;">
          <li><button class="dropdown-item" type="button" @click="onPartialSummary">Resumo Parcial</button></li>
          <li><button class="dropdown-item" type="button" @click="onMovement">Retirada/Reforço</button></li>
          <li><hr class="dropdown-divider"></li>
          <li><button class="dropdown-item text-danger" type="button" @click="onCloseCash">Fechar Caixa</button></li>
        </ul>
    </template>
    <template v-else>
      <button type="button" class="btn btn-outline-secondary btn-sm" @click="openCash">Abrir Caixa</button>
    </template>

    <!-- Wizard de Fechamento -->
    <CashClosingWizard
      :visible="showWizard"
      :session="currentSession"
      @close="showWizard = false"
      @completed="onWizardCompleted"
    />
  </div>
</template>

<script setup>
import Swal from 'sweetalert2';
import api from '../api';
import { ref, createApp, h, onMounted, onUnmounted } from 'vue';
import { io } from 'socket.io-client';
import { SOCKET_URL } from '@/config';
import CurrencyInput from './form/input/CurrencyInput.vue';
import CashClosingWizard from './CashClosingWizard.vue';
import { formatCurrency, formatAmount } from '../utils/formatters.js';

const loading = ref(false);
const currentSession = ref(null);
const container = ref(null);
const showDropdown = ref(false);
const showWizard = ref(false);

// Simple in-memory cache for /cash/summary/current to avoid repeated backend calls
let cashSummaryCache = { value: null, ts: 0 };
const CASH_SUMMARY_TTL = 5 * 1000; // 5 seconds
const CASH_SUMMARY_KEY = 'cashSummary_v1';

function invalidateCashSummary() {
  cashSummaryCache = { value: null, ts: 0 };
  try { sessionStorage.removeItem(CASH_SUMMARY_KEY); } catch (e) {}
}

async function fetchCashSummary(force = false) {
  const now = Date.now();
  // try sessionStorage first
  if (!force) {
    try {
      const raw = sessionStorage.getItem(CASH_SUMMARY_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.value && parsed.ts && (now - parsed.ts) < CASH_SUMMARY_TTL) {
          cashSummaryCache = { value: parsed.value, ts: parsed.ts };
          return cashSummaryCache.value;
        }
      }
    } catch (e) { /* ignore invalid cache */ }
    if (cashSummaryCache.value && (now - cashSummaryCache.ts) < CASH_SUMMARY_TTL) return cashSummaryCache.value;
  }

  const res = await api.get('/cash/summary/current');
  cashSummaryCache.value = res.data;
  cashSummaryCache.ts = Date.now();
  try { sessionStorage.setItem(CASH_SUMMARY_KEY, JSON.stringify({ value: res.data, ts: cashSummaryCache.ts })); } catch (e) {}
  return cashSummaryCache.value;
}

async function loadCurrentSession(force = false) {
  try {
    const { data } = await api.get('/cash/current');
    currentSession.value = data || null;
    return currentSession.value;
  } catch (e) {
    currentSession.value = null;
    return null;
  }
}

function normalizeMethod(name) {
  if (!name) return 'Outros';
  const s = String(name).toLowerCase();
  // Treat 'cash' and variations and Portuguese 'dinheiro' as the same
  if (s.includes('din') || s.includes('cash') || s.includes('money') || s.includes('dinheiro')) return 'Dinheiro';
  if (s.includes('pix')) return 'PIX';
  if (s.includes('card') || s.includes('cartao') || s.includes('credito') || s.includes('cred')) return 'Cartão';
  // fallback: capitalize original
  return String(name).trim();
}

async function openCash() {
  console.debug('CashControl: openCash clicked');

  // Fetch stores and last session in parallel
  let suggested = '0,00';
  let stores = [];
  try {
    const [sessionsRes, storesRes] = await Promise.all([
      api.get('/cash/sessions').catch(() => ({ data: [] })),
      api.get('/stores').catch(() => ({ data: [] })),
    ]);
    stores = Array.isArray(storesRes.data) ? storesRes.data : [];
    const sessions = Array.isArray(sessionsRes.data) ? sessionsRes.data : [];
    if (sessions.length) {
      const closed = sessions.find(s => s.closedAt) || sessions[0];
      if (closed && closed.closingSummary && closed.closingSummary.counted) {
        const counted = closed.closingSummary.counted;
        let found = null;
        for (const k of Object.keys(counted || {})) {
          const kl = String(k).toLowerCase();
          if (kl.includes('din') || kl.includes('cash') || kl.includes('money')) { found = counted[k]; break; }
        }
        if (found == null) {
          const candidates = ['Dinheiro','dinheiro','CASH','cash','Cash','DINHEIRO'];
          for (const c of candidates) { if (counted[c] != null) { found = counted[c]; break; } }
        }
        if (found != null) suggested = formatAmount(found || 0);
      }
    }
  } catch (e) { /* ignore errors */ }

  // Build stores checkboxes HTML
  const storesHtml = stores.map(s =>
    `<div class="form-check"><input class="form-check-input store-check" type="checkbox" value="${s.id}" checked><label class="form-check-label">${s.name || s.id}</label></div>`
  ).join('');
  const showStoresSection = stores.length > 1;

  const { value: formValues } = await Swal.fire({
    title: 'Abertura de frente de caixa',
    html: `
      <div class="mb-3 text-start">
        <label class="form-label fw-bold">Nome do Caixa</label>
        <input type="text" class="form-control" id="swal-label" value="Caixa">
      </div>
      <div class="mb-3 text-start">
        <label class="form-label fw-bold">Canais</label>
        <div class="d-flex flex-wrap gap-2">
          <div class="form-check"><input class="form-check-input channel-check" type="checkbox" value="BALCAO" checked><label class="form-check-label">Balcão</label></div>
          <div class="form-check"><input class="form-check-input channel-check" type="checkbox" value="IFOOD" checked><label class="form-check-label">iFood</label></div>
          <div class="form-check"><input class="form-check-input channel-check" type="checkbox" value="AIQFOME" checked><label class="form-check-label">Aiqfome</label></div>
          <div class="form-check"><input class="form-check-input channel-check" type="checkbox" value="WHATSAPP" checked><label class="form-check-label">WhatsApp</label></div>
        </div>
      </div>
      <div class="mb-3 text-start" id="swal-stores-section" style="${showStoresSection ? '' : 'display:none'}">
        <label class="form-label fw-bold">Lojas</label>
        <div class="d-flex flex-wrap gap-2" id="swal-stores">${storesHtml}</div>
      </div>
      <div class="mb-3 text-start">
        <label class="form-label fw-bold">Valor em dinheiro</label>
        <input id="swal-open-amount" inputmode="decimal" class="form-control" value="${suggested}">
      </div>
      <div class="mb-3 text-start">
        <label class="form-label fw-bold">Observações</label>
        <textarea id="swal-open-note" class="form-control" rows="2"></textarea>
      </div>`,
    focusConfirm: false,
    width: 500,
    didOpen: () => {
      const el = document.getElementById('swal-open-amount');
      if (el) {
        el.addEventListener('focus', () => { el.value = el.value.replace(',', '.'); el.select(); });
        el.addEventListener('blur', () => { const n = parseFloat(el.value.replace(',', '.')) || 0; el.value = formatAmount(n); });
      }
    },
    preConfirm: () => {
      const label = (document.getElementById('swal-label')?.value || 'Caixa').trim();
      const channels = [...document.querySelectorAll('.channel-check:checked')].map(el => el.value);
      const storeIds = [...document.querySelectorAll('.store-check:checked')].map(el => el.value);
      const openingAmount = parseFloat(document.getElementById('swal-open-amount').value.replace(',', '.')) || 0;
      const note = document.getElementById('swal-open-note').value || '';
      if (!channels.length) {
        Swal.showValidationMessage('Selecione pelo menos um canal');
        return false;
      }
      return { openingAmount, note, label, channels, storeIds };
    },
    showCancelButton: true,
    confirmButtonText: 'Salvar',
    cancelButtonText: 'Cancelar'
  });
  if (!formValues) return;
  loading.value = true;
  try {
    const { data } = await api.post('/cash/open', formValues);
    await loadCurrentSession(true);
    invalidateCashSummary();

    // Check for out-of-session orders and offer to link them
    try {
      const { data: oosData } = await api.get('/cash/out-of-session-count');
      if (oosData.count > 0) {
        const result = await Swal.fire({
          title: 'Pedidos fora do caixa',
          text: `Há ${oosData.count} pedido(s) que entraram sem caixa aberto. Deseja vinculá-los a esta sessão?`,
          icon: 'question',
          showCancelButton: true,
          confirmButtonText: 'Sim, vincular',
          cancelButtonText: 'Não',
        });
        if (result.isConfirmed) {
          await api.post('/cash/link-pending-orders');
          Swal.fire({ icon: 'success', text: `${oosData.count} pedido(s) vinculado(s) ao caixa`, timer: 2000, showConfirmButton: false });
        }
      } else {
        Swal.fire({ icon: 'success', text: 'Caixa aberto', timer: 1500, showConfirmButton: false });
      }
    } catch (e) {
      Swal.fire({ icon: 'success', text: 'Caixa aberto', timer: 1500, showConfirmButton: false });
    }

    // Notify Orders.vue to refresh
    window.dispatchEvent(new CustomEvent('cash-session-opened'));
  } catch (e) {
    console.error(e);
    Swal.fire('Erro', e?.response?.data?.message || 'Falha ao abrir caixa', 'error');
  } finally { loading.value = false }
}

function toggleDropdown() {
  console.debug('CashControl: toggleDropdown ->', showDropdown.value);
  showDropdown.value = !showDropdown.value;
}

function closeDropdown() {
  showDropdown.value = false;
}

function onPartialSummary() {
  closeDropdown();
  partialSummary();
}

function onMovement() {
  closeDropdown();
  movement();
}

function onCloseCash() {
  closeDropdown();
  closeCash();
}

async function movement() {
  // mount a small Vue app inside Swal to provide a proper select + CurrencyInput
  let vueInstance = null;
  let mountedAppRef = null;

  const html = `<div id="swal-mv-vue"></div>`;

  const result = await Swal.fire({
    title: 'Movimento de caixa',
    html,
    showCancelButton: true,
    confirmButtonText: 'Salvar',
    focusConfirm: false,
    didOpen: () => {
      const App = {
        components: { CurrencyInput },
        data() {
          return { type: 'retirada', amount: 0, note: '' };
        },
        methods: { formatAmount },
        mounted() {},
        render() {
          const vm = this;
          return h('div', { class: 'd-flex flex-column', style: 'text-align:left' }, [
            h('div', { style: 'margin-bottom:8px' }, [
              h('label', { style: 'display:block;margin-bottom:6px' }, 'Tipo'),
                // use onChange (native select event) and keep value in sync
                h('select', { class: 'form-select', value: vm.type, onChange: (e) => { vm.type = e.target.value }, onInput: (e) => { vm.type = e.target.value }, style: 'width:100%' }, [
                h('option', { value: 'retirada' }, 'Retirada'),
                h('option', { value: 'reforco' }, 'Reforço')
              ])
            ]),
            h('div', { style: 'margin-bottom:8px' }, [
              h('label', { style: 'display:block;margin-bottom:6px' }, 'Valor'),
              // ensure CurrencyInput receives class used by Swal2 and a stable initial value
              h(CurrencyInput, { modelValue: vm.amount ?? 0, 'onUpdate:modelValue': v => vm.amount = v, inputClass: 'w-100' })
            ]),
            h('div', { style: 'margin-bottom:6px' }, [
              h('label', { style: 'display:block;margin-bottom:6px' }, 'Descrição'),
              h('textarea', { class: 'form-control', value: vm.note, onInput: (e) => vm.note = e.target.value, style: 'min-height:80px' })
            ])
          ]);
        }
      };

      try {
        const appRef = createApp(App);
        vueInstance = appRef.mount('#swal-mv-vue');
        mountedAppRef = appRef;
      } catch (e) {
        console.error('Failed to mount movement Vue app inside Swal modal', e);
      }
    },
    preConfirm: () => {
      // collect values from mounted Vue instance
      if (vueInstance) {
        const t = vueInstance.type || 'retirada';
        const a = Number(vueInstance.amount || 0) || 0;
        const n = vueInstance.note || '';
        return { type: t, amount: a, note: n };
      }
      // fallback (shouldn't happen)
      const typeEl = document.querySelector('#swal-mv-vue select');
      const noteEl = document.querySelector('#swal-mv-vue textarea');
      const amountEl = document.querySelector('#swal-mv-vue input');
      const type = typeEl ? typeEl.value : 'retirada';
      const amount = amountEl ? Number(amountEl.value.replace(',', '.')) || 0 : 0;
      const note = noteEl ? noteEl.value : '';
      return { type, amount, note };
    }
  });

  // unmount app if mounted
  try { if (mountedAppRef) mountedAppRef.unmount(); } catch (e) {}

  if (!result || result.isDismissed) return;
  const form = result.value;
  try {
    const { data } = await api.post('/cash/movement', form);
    // refresh session info
    await loadCurrentSession();
    invalidateCashSummary();
    Swal.fire('OK', 'Movimento registrado', 'success');
  } catch (e) {
    console.error(e);
    Swal.fire('Erro', e?.response?.data?.message || 'Falha ao registrar movimento', 'error');
  }
}

async function partialSummary() {
  try {
    Swal.fire({ title: 'Carregando resumo...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    const { data: session } = await api.get('/cash/current');
    if (!session) { Swal.close(); currentSession.value = null; return Swal.fire('Nenhum caixa aberto', '', 'info'); }

    const summary = await fetchCashSummary(true);
    const paymentsByMethod = (summary && summary.paymentsByMethod) ? summary.paymentsByMethod : {};
    const inRegisterByMethod = (summary && summary.inRegisterByMethod) ? summary.inRegisterByMethod : {};
    const totalWithdrawals = Number((summary && summary.totalWithdrawals) ? summary.totalWithdrawals : 0);
    const totalReinforcements = Number((summary && summary.totalReinforcements) ? summary.totalReinforcements : 0);
    const expected = (summary && summary.expectedBalance) ? Number(summary.expectedBalance) : null;
    const storedBalance = Number(session.currentBalance ?? session.balance ?? 0);
    const diff = expected != null ? (Number(expected || 0) - storedBalance) : 0;
    const hasDiff = diff && Math.abs(diff) > 0.0001;
    const openingAmount = Number(summary?.openingAmount ?? session?.openingAmount ?? 0);

    const row = (label, value, isNegative = false, sublabel = '') => {
      const amount = Number(value || 0);
      const color = amount === 0 ? '#adb5bd' : (isNegative ? '#dc3545' : '#2d8a4e');
      const weight = amount !== 0 ? '600' : '400';
      const sub = sublabel ? `<div style="font-size:0.72rem;color:#adb5bd;margin-top:1px">${sublabel}</div>` : '';
      return `<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 12px;border-bottom:1px solid #f0f0f0">
        <div><span style="color:#495057;font-size:0.875rem">${label}</span>${sub}</div>
        <span style="color:${color};font-weight:${weight};font-size:0.875rem">${formatCurrency(amount)}</span>
      </div>`;
    };

    // Sales breakdown: show what was actually collected per method (no opening balance added)
    const salesRows = Object.keys(paymentsByMethod).length > 0
      ? Object.entries(paymentsByMethod).map(([m, v]) => row(m, v)).join('')
      : `<div style="color:#adb5bd;padding:10px 12px;font-size:0.875rem">Nenhum valor registrado</div>`;

    // Expected cash physically in the drawer = opening + cash sales + reinforcements - withdrawals
    const expectedCash = Number(inRegisterByMethod['Dinheiro'] || 0);
    const cashSales = Number(paymentsByMethod['Dinheiro'] || 0);
    const cashBalanceRow = row('Saldo em caixa (Dinheiro)', expectedCash, false,
      `${formatCurrency(openingAmount)} abertura + ${formatCurrency(cashSales)} vendas${totalReinforcements ? ' + ' + formatCurrency(totalReinforcements) + ' reforços' : ''}${totalWithdrawals ? ' − ' + formatCurrency(totalWithdrawals) + ' retiradas' : ''}`);

    const diffBanner = hasDiff ? `
      <div style="background:#fff3cd;border:1px solid #ffc107;border-radius:8px;padding:10px 14px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:center">
        <span style="font-size:0.85rem;font-weight:600;color:#856404">Diferença encontrada</span>
        <span style="font-weight:700;color:#dc3545">${formatCurrency(diff)}</span>
      </div>` : '';

    const sectionTitle = (label) =>
      `<div style="font-size:0.72rem;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:#adb5bd;padding:0 2px;margin-bottom:4px">${label}</div>`;

    const html = `<div style="text-align:left">
      ${diffBanner}
      <div style="margin-bottom:14px">
        ${sectionTitle('Abertura de caixa')}
        <div style="background:#f8f9fa;border-radius:8px;overflow:hidden">
          ${row('Troco inicial', openingAmount)}
        </div>
      </div>
      <div style="margin-bottom:14px">
        ${sectionTitle('Receita por forma de pagamento')}
        <div style="background:#f8f9fa;border-radius:8px;overflow:hidden">
          ${salesRows}
        </div>
      </div>
      <div style="margin-bottom:14px">
        ${sectionTitle('Saldo esperado em caixa')}
        <div style="background:#f8f9fa;border-radius:8px;overflow:hidden">
          ${cashBalanceRow}
        </div>
      </div>
      <div>
        ${sectionTitle('Movimentos de caixa')}
        <div style="background:#f8f9fa;border-radius:8px;overflow:hidden">
          ${row('Retiradas', totalWithdrawals, true)}
          <div style="border-bottom:none">${row('Reforços', totalReinforcements)}</div>
        </div>
      </div>
    </div>`;

    Swal.close();
    const swalResult = await Swal.fire({
      title: 'Resumo parcial',
      html,
      width: 460,
      confirmButtonText: 'Fechar',
      showDenyButton: hasDiff,
      denyButtonText: 'Reconciliar',
      denyButtonColor: '#6c757d',
    });

    if (swalResult && swalResult.isDenied && hasDiff) {
      await reconcileBalance(Math.round(diff * 100));
      await loadCurrentSession();
      await partialSummary();
    }
  } catch (e) { console.error(e); Swal.fire('Erro', 'Falha ao buscar resumo parcial', 'error'); }
}

async function reconcileBalance(diffCents) {
  try {
    const amount = Math.abs(diffCents) / 100;
    const type = diffCents > 0 ? 'reforco' : 'retirada';
    const note = `Reconciliação automática (esperado ${ formatAmount(diffCents/100) } vs registrado)`;
    await api.post('/cash/movement', { type, amount, note });
    Swal.fire('OK', 'Movimento de reconciliação registrado', 'success');
    await loadCurrentSession();
    invalidateCashSummary();
  } catch (e) {
    console.error('Failed to reconcile balance', e);
    Swal.fire('Erro', e?.response?.data?.message || 'Falha ao registrar movimento de reconciliação', 'error');
  }
}

function closeCash() {
  showWizard.value = true;
}

async function onWizardCompleted(data) {
  showWizard.value = false;
  await loadCurrentSession();
  invalidateCashSummary();
  Swal.fire('OK', 'Caixa fechado com sucesso!', 'success');
}

let cashSocket = null;

onMounted(() => {
  // initialize current session on mount
  loadCurrentSession().catch(() => {});

  // Socket.IO listeners for cash-related events
  const token = localStorage.getItem('token');
  if (token) {
    cashSocket = io(SOCKET_URL, {
      transports: ['polling', 'websocket'],
      auth: { token },
      reconnectionAttempts: Infinity,
      reconnectionDelay: 3000,
    });

    cashSocket.on('order:out-of-session', (data) => {
      Swal.fire({ icon: 'warning', title: 'Pedido fora da sessão', text: data?.message || 'Um pedido foi recebido mas não pertence à sessão de caixa atual.', toast: true, position: 'top-end', showConfirmButton: false, timer: 5000 });
    });

    cashSocket.on('order:reversed', (data) => {
      Swal.fire({ icon: 'info', title: 'Pedido estornado', text: data?.message || 'Um pedido foi estornado do caixa.', toast: true, position: 'top-end', showConfirmButton: false, timer: 5000 });
      invalidateCashSummary();
      loadCurrentSession().catch(() => {});
    });

    cashSocket.on('financial:bridge-error', (data) => {
      Swal.fire({ icon: 'error', title: 'Erro financeiro', text: data?.message || 'Erro ao registrar movimento financeiro.', toast: true, position: 'top-end', showConfirmButton: false, timer: 5000 });
    });
  }

  // close dropdown on outside click
  const outside = (ev) => {
    try {
      if (!container.value) return;
      if (!container.value.contains(ev.target)) closeDropdown();
    } catch (e) {}
  };
  document.addEventListener('click', outside);
  onUnmounted(() => {
    try { document.removeEventListener('click', outside); } catch (e) {}
    if (cashSocket) { cashSocket.disconnect(); cashSocket = null; }
  });
});
</script>

<style scoped>
.cash-control .btn { font-size: 0.85rem; }
</style>
