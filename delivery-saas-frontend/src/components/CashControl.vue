<template>
  <div class="cash-control d-inline-block ms-2" ref="container">
    <template v-if="currentSession">
      <div class="btn-group">
        <button type="button" class="btn btn-outline-secondary btn-sm" @click="toggleDropdown" :aria-expanded="showDropdown">
          Caixa aberto
        </button>
        <ul v-show="showDropdown" class="dropdown-menu show" style="position:absolute;">
          <li><button class="dropdown-item" type="button" @click="onPartialSummary">Resumo Parcial</button></li>
          <li><button class="dropdown-item" type="button" @click="onMovement">Retirada/Reforço</button></li>
          <li><hr class="dropdown-divider"></li>
          <li><button class="dropdown-item text-danger" type="button" @click="onCloseCash">Fechar Caixa</button></li>
        </ul>
      </div>
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
  // try to prefill opening amount from last closed session counted cash
  let suggested = '0,00';
  try {
    const { data: sessions } = await api.get('/cash/sessions');
    if (Array.isArray(sessions) && sessions.length) {
      // find most recent closed session
      const closed = sessions.find(s => s.closedAt) || sessions[0];
      if (closed && closed.closingSummary && closed.closingSummary.counted) {
        const counted = closed.closingSummary.counted;
        // find a key matching cash/dinheiro
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
  } catch (e) { /* ignore errors and keep suggested 0,00 */ }

  const { value: formValues } = await Swal.fire({
    title: 'Abertura de frente de caixa',
    html: `<label>Valor em dinheiro</label><input id="swal-open-amount" inputmode="decimal" class="swal2-input" value="${suggested}">\n<label>Observações</label><textarea id="swal-open-note" class="swal2-textarea"></textarea>`,
    focusConfirm: false,
    didOpen: () => {
      const el = document.getElementById('swal-open-amount');
      if (el) {
        el.addEventListener('focus', () => { el.value = el.value.replace(',', '.'); el.select(); });
        el.addEventListener('blur', () => { const n = parseFloat(el.value.replace(',', '.')) || 0; el.value = formatAmount(n); });
      }
    },
    preConfirm: () => {
      const amount = parseFloat(document.getElementById('swal-open-amount').value.replace(',', '.')) || 0;
      const note = document.getElementById('swal-open-note').value || '';
      return { openingAmount: amount, note };
    },
    showCancelButton: true,
    confirmButtonText: 'Salvar',
    cancelButtonText: 'Cancelar'
  });
  if (!formValues) return;
  loading.value = true;
  try {
    const { data } = await api.post('/cash/open', formValues);
    // refresh current session state
    await loadCurrentSession(true);
    invalidateCashSummary();
    Swal.fire('OK', 'Caixa aberto', 'success');
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
    // show loading spinner while fetching session and summary
    Swal.fire({ title: 'Carregando resumo...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    const { data: session } = await api.get('/cash/current');
    if (!session) { Swal.close(); currentSession.value = null; return Swal.fire('Nenhum caixa aberto', '', 'info'); }

    // fetch precomputed summary from backend for the open session (cached)
    const summary = await fetchCashSummary();
    const paymentsByMethod = (summary && summary.paymentsByMethod) ? summary.paymentsByMethod : {};
    const inRegisterByMethod = (summary && summary.inRegisterByMethod) ? summary.inRegisterByMethod : {};
    const totalWithdrawals = (summary && summary.totalWithdrawals) ? summary.totalWithdrawals : 0;
    const totalReinforcements = (summary && summary.totalReinforcements) ? summary.totalReinforcements : 0;
    const expected = (summary && summary.expectedBalance) ? Number(summary.expectedBalance) : null;

    // build HTML using session + summary
    let parts = [];
    const storedBalance = Number(session.balance || 0);
    if (expected != null) parts.push(`<div><strong>Aberto há:</strong> ${session.openedAt}<br/><strong>Saldo (registro):</strong> ${formatCurrency(storedBalance)}</div>`);
    if (expected != null) parts.push(`<div><strong>Saldo (esperado incluindo recebimentos em dinheiro):</strong> ${formatCurrency(Number(expected||0))}</div>`);
    const diff = expected != null ? (Number(expected||0) - storedBalance) : 0;
    if (diff && Math.abs(diff) > 0.0001) parts.push(`<div style="color:crimson"><strong>Diferença:</strong> ${formatCurrency(diff)}</div>`);
    parts.push('<hr/>');
    parts.push('<div><strong>Valores em caixa por forma de pagamento</strong><ul>');
    if (!inRegisterByMethod || Object.keys(inRegisterByMethod).length === 0) parts.push('<li>Nenhum valor em caixa desde a abertura</li>');
    else {
      for (const [m, v] of Object.entries(inRegisterByMethod)) {
        parts.push(`<li>${m}: ${formatCurrency(Number(v||0))}</li>`);
      }
    }
    parts.push('</ul></div>');
    parts.push('<hr/>');
    parts.push('<div><strong>Movimentos de caixa</strong><ul>');
    parts.push(`<li>Retiradas: ${formatCurrency(Number(totalWithdrawals))}</li>`);
    parts.push(`<li>Reforços: ${formatCurrency(Number(totalReinforcements))}</li>`);
    parts.push('</ul></div>');

    Swal.close();
    const html = parts.join('\n');
    const swalResult = await Swal.fire({ title: 'Resumo parcial', html, width: 700, showCancelButton: diff && Math.abs(diff) > 0.0001, confirmButtonText: 'Reconciliar', cancelButtonText: 'OK' });
    if (swalResult && swalResult.isConfirmed && diff && Math.abs(diff) > 0.0001) {
      // user chose to reconcile: create a movement to adjust the stored balance
      await reconcileBalance(Math.round(diff * 100));
      // refresh the modal to show updated values
      await loadCurrentSession();
      await partialSummary();
    }
  } catch (e) { console.error(e); Swal.fire('Erro', 'Falha ao buscar resumo parcial', 'error') }
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

onMounted(() => {
  // initialize current session on mount
  loadCurrentSession().catch(() => {});
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
  });
});
</script>

<style scoped>
.cash-control .btn { font-size: 0.85rem; }
</style>
