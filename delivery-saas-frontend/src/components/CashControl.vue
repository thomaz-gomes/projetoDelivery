<template>
  <div class="cash-control d-inline-block ms-2">
    <button class="btn btn-outline-secondary btn-sm" @click="openCash">Abrir Caixa</button>
    <button class="btn btn-outline-secondary btn-sm ms-1" @click="movement">Retirada/Reforço</button>
    <button class="btn btn-outline-secondary btn-sm ms-1" @click="partialSummary">Resumo Parcial</button>
    <button class="btn btn-outline-danger btn-sm ms-1" @click="closeCash">Fechar Caixa</button>
  </div>
</template>

<script setup>
import Swal from 'sweetalert2';
import api from '../api';
import { ref, createApp, h } from 'vue';
import CurrencyInput from './CurrencyInput.vue';
import { formatCurrency, formatAmount } from '../utils/formatters.js';

const loading = ref(false);

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
    Swal.fire('OK', 'Caixa aberto', 'success');
  } catch (e) {
    console.error(e);
    Swal.fire('Erro', e?.response?.data?.message || 'Falha ao abrir caixa', 'error');
  } finally { loading.value = false }
}

async function movement() {
  const { value: form } = await Swal.fire({
    title: 'Movimento de caixa',
    html: `<label>Tipo (retirada/retirada|reforco)</label><input id="swal-mv-type" class="swal2-input" placeholder="retirada|reinforce">\n<label>Valor</label><input id="swal-mv-amount" inputmode="decimal" class="swal2-input" value="0,00">\n<label>Descrição</label><textarea id="swal-mv-note" class="swal2-textarea"></textarea>`,
    didOpen: () => {
      const el = document.getElementById('swal-mv-amount');
      if (el) {
        el.addEventListener('focus', () => { el.value = el.value.replace(',', '.'); el.select(); });
        el.addEventListener('blur', () => { const n = parseFloat(el.value.replace(',', '.')) || 0; el.value = formatAmount(n); });
      }
    },
    preConfirm: () => {
      const type = document.getElementById('swal-mv-type').value || 'retirada';
      const amount = parseFloat(document.getElementById('swal-mv-amount').value.replace(',', '.')) || 0;
      const note = document.getElementById('swal-mv-note').value || '';
      return { type, amount, note };
    },
    showCancelButton: true,
    confirmButtonText: 'Salvar'
  });
  if (!form) return;
  try {
    const { data } = await api.post('/cash/movement', form);
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
    if (!session) { Swal.close(); return Swal.fire('Nenhum caixa aberto', '', 'info'); }

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
  } catch (e) {
    console.error('Failed to reconcile balance', e);
    Swal.fire('Erro', e?.response?.data?.message || 'Falha ao registrar movimento de reconciliação', 'error');
  }
}

async function closeCash() {
  try {
    const { data } = await api.get('/cash/current');
    if (!data) return Swal.fire('Nenhuma sessão de caixa aberta', '', 'info');

    // fetch server-side summary and use it instead of client-side aggregation
    const summary = await fetchCashSummary();
    let paymentsByMethod = (summary && summary.paymentsByMethod) ? summary.paymentsByMethod : {};
    const inRegisterByMethod = (summary && summary.inRegisterByMethod) ? summary.inRegisterByMethod : {};
    const totalWithdrawals = (summary && summary.totalWithdrawals) ? summary.totalWithdrawals : 0;
    const totalReinforcements = (summary && summary.totalReinforcements) ? summary.totalReinforcements : 0;

    Swal.close();
    // Build modal HTML: table-like layout. For each method show expected and input for 'Em caixa'
    let rows = [];
    const methods = Object.keys(inRegisterByMethod).length ? Object.keys(inRegisterByMethod) : (Object.keys(paymentsByMethod).length ? Object.keys(paymentsByMethod) : ['Dinheiro']);
    for (const m of methods) {
      const expectedNum = Number(inRegisterByMethod[m] || paymentsByMethod[m] || 0);
      const inputId = `close-in-${m.replace(/\s+/g, '_')}`;
      rows.push(`<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid #eee"><div style="flex:1">${m}</div><div style="flex:1;text-align:center">${formatCurrency(expectedNum)}</div><div style="flex:1;text-align:center"><input id="${inputId}" inputmode="decimal" class="swal2-input" value="${formatAmount(expectedNum)}" style="width:100px;margin:0 auto"></div></div>`);
    }

    // build html with a container where we'll mount a small Vue app that uses CurrencyInput
    const html = `
      <div style="text-align:center"><strong>Fechamento de Frente de Caixa</strong></div>
      <div style="margin-top:8px">Abertura: ${data.openedAt} &nbsp;&nbsp; Saldo registrado: ${formatCurrency(Number(data.balance||0))}</div>
      <div style="margin-top:12px"><div id="swal-vue-container">${rows.join('')}</div></div>
      <hr/>
      <div style="font-size:0.9rem">Abertura de caixa(+): ${formatCurrency(Number(data.openingAmount||0))}<br/>Totais em caixa: ${formatCurrency(Object.values(inRegisterByMethod).reduce((s,v)=>s+Number(v||0),0))}<br/>Retiradas(-): ${formatCurrency(Number(totalWithdrawals))}<br/>Reforços(+): ${formatCurrency(Number(totalReinforcements))}</div>
      <hr/>
      <label>Obs. Fechamento</label><textarea id="swal-close-note" class="swal2-textarea"></textarea>
    `;

    // prepare methods and expected values for the Vue app
    const methodsList = methods;
    const expectedMap = {};
    for (const m of methodsList) expectedMap[m] = Number(inRegisterByMethod[m] || paymentsByMethod[m] || 0);

    let vueInstance = null;
    let mountedAppRef = null;

    const result = await Swal.fire({
      title: 'Fechamento de Frente de Caixa',
      html,
      width: 900,
      showCancelButton: true,
      confirmButtonText: 'Fechar Frente de Caixa',
      cancelButtonText: 'Cancelar',
      focusConfirm: false,
      didOpen: () => {
        // mount a tiny Vue app inside the modal to render CurrencyInput components
        const App = {
          components: { CurrencyInput },
          data() {
            const entered = {};
            for (const m of methodsList) entered[m] = expectedMap[m] || 0;
            return { methods: methodsList, expected: expectedMap, entered };
          },
          methods: { formatCurrency, formatAmount },
          render() {
            const vm = this;
            return h('div', vm.methods.map((m) => {
              const expectedNum = vm.expected[m] || 0;
              return h('div', { style: 'display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid #eee' }, [
                h('div', { style: 'flex:1' }, String(m)),
                h('div', { style: 'flex:1;text-align:center' }, vm.formatCurrency(expectedNum)),
                h('div', { style: 'flex:1;text-align:center' }, [
                  h(CurrencyInput, { modelValue: vm.entered[m], 'onUpdate:modelValue': v => vm.entered[m] = v, inputClass: 'swal2-input', style: 'width:100px;margin:0 auto' })
                ])
              ]);
            }));
          }
        };

        try {
          const appRef = createApp(App);
          vueInstance = appRef.mount('#swal-vue-container');
          mountedAppRef = appRef;
        } catch (e) {
          // fallback: if mounting fails, keep the plain inputs (should not happen)
          console.error('Failed to mount Vue app inside Swal modal', e);
        }
      },
      preConfirm: () => {
        // collect entered values from the mounted Vue instance when present
        const entered = {};
        const diffs = {};
        if (vueInstance && vueInstance.entered) {
          for (const m of methodsList) {
            const num = Number(vueInstance.entered[m] || 0);
            entered[m] = num;
            const expected = Number(expectedMap[m] || 0);
            diffs[m] = Number((num - expected).toFixed(2));
          }
        } else {
          // fallback: read values from DOM inputs (string parsing)
          for (const m of methodsList) {
            const id = `close-in-${m.replace(/\s+/g, '_')}`;
            const v = document.getElementById(id) ? document.getElementById(id).value.replace(',', '.') : '0';
            const num = Number(v || 0);
            entered[m] = num;
            const expected = Number(expectedMap[m] || 0);
            diffs[m] = Number((num - expected).toFixed(2));
          }
        }
        const note = document.getElementById('swal-close-note') ? document.getElementById('swal-close-note').value : '';
        return { entered, diffs, note };
      }
    });

    // unmount the temporary Vue app if it was mounted
    try { if (mountedAppRef) mountedAppRef.unmount(); } catch (e) { /* ignore */ }

    if (!result || result.isDismissed) return;

    const { entered, diffs, note } = result.value || {};
    // Determine needed adjustment to stored balance based on counted cash (Dinheiro)
    const countedCash = Number(entered['Dinheiro'] || entered['Cash'] || entered['dinheiro'] || 0);
    const storedBalance = Number(data.balance || 0);
    const adjust = Math.round((countedCash - storedBalance) * 100);
    if (adjust !== 0) {
      const type = adjust > 0 ? 'reforco' : 'retirada';
      const amount = Math.abs(adjust) / 100;
      try {
        await api.post('/cash/movement', { type, amount, note: `Fechamento: ${note || ''}` });
        // invalidate cache so UI picks up updated session state
        invalidateCashSummary();
      } catch (e) { console.error('Failed to register closing adjustment', e); }
    }

    // finally close the session with a closing summary (include entered breakdown)
    const closingSummary = { note: note || '', counted: entered };
    try {
      await api.post('/cash/close', { closingSummary });
      Swal.fire('OK', 'Caixa fechado', 'success');
    } catch (e) { console.error(e); Swal.fire('Erro', e?.response?.data?.message || 'Falha ao fechar caixa', 'error') }
  } catch (e) { console.error(e); Swal.fire('Erro', 'Falha ao abrir modal de fechamento', 'error') }
}
</script>

<style scoped>
.cash-control .btn { font-size: 0.85rem; }
</style>
