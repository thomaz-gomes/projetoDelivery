<template>
  <Teleport to="body">
    <div v-if="visible" class="csm-backdrop" @click.self="$emit('close')">
      <div class="csm-panel">

        <!-- Header -->
        <div class="csm-header">
          <div class="csm-header__left">
            <div class="csm-title">Fechamento de Frente de Caixa</div>
            <div class="csm-meta">
              <span>{{ formatDate(session.openedAt) }}</span>
              <span v-if="session.closedAt"> → {{ formatDate(session.closedAt) }}</span>
              <span v-else class="badge-open">Em aberto</span>
              <span v-if="closerName" class="csm-meta__closer">Fechado por {{ closerName }}</span>
            </div>
          </div>
          <div class="csm-header__right">
            <div class="csm-balance">
              <div class="csm-balance__label">Totais em caixa</div>
              <div class="csm-balance__value">{{ formatCurrency(totalInRegister) }}</div>
            </div>
            <div class="csm-header__actions">
              <button class="btn btn-sm btn-light" @click="printModal">Imprimir A4</button>
              <button class="btn btn-sm btn-light" @click="printSmall">Imprimir Rápida</button>
              <button class="btn btn-sm btn-outline-primary" @click="$emit('edit', session)">Editar fechamento</button>
              <button class="btn btn-sm btn-outline-secondary csm-close-btn" @click="$emit('close')">
                <i class="bi bi-x-lg"></i>
              </button>
            </div>
          </div>
        </div>

        <!-- Body -->
        <div class="csm-body" ref="bodyRef">

          <!-- Opening info row -->
          <div class="csm-info-bar">
            <span>Abertura(+): <strong class="text-success">{{ formatCurrency(openingAmount) }}</strong></span>
            <span>Vendas dinheiro(+): <strong class="text-success">{{ formatCurrency(cashSales) }}</strong></span>
            <span class="text-danger">Retiradas(-): <strong>{{ formatCurrency(totalWithdrawals) }}</strong>
              <a href="#" class="csm-link ms-1" @click.prevent="toggleMovements('WITHDRAWAL')">Ver</a>
              <a href="#" class="csm-link ms-1" @click.prevent="$emit('add-movement', 'withdrawal')">Incluir</a>
            </span>
            <span class="text-success">Reforços(+): <strong>{{ formatCurrency(totalReinforcements) }}</strong>
              <a href="#" class="csm-link ms-1" @click.prevent="toggleMovements('REINFORCEMENT')">Ver</a>
              <a href="#" class="csm-link ms-1" @click.prevent="$emit('add-movement', 'reinforcement')">Incluir</a>
            </span>
          </div>

          <!-- Movements inline list -->
          <div v-if="showMovementsType" class="csm-movements-inline">
            <div v-if="filteredMovements.length === 0" class="text-muted small px-3 py-2">Nenhuma movimentação.</div>
            <div v-for="mv in filteredMovements" :key="mv.id || mv.createdAt" class="csm-mv-item">
              <span class="csm-mv-date">{{ formatDateTime(mv.createdAt) }}</span>
              <span :class="mv.type === 'WITHDRAWAL' ? 'text-danger' : 'text-success'" class="csm-mv-amount">
                {{ mv.type === 'WITHDRAWAL' ? '−' : '+' }}{{ formatCurrency(mv.amount) }}
              </span>
              <span class="csm-mv-note">{{ mv.note || '' }}</span>
            </div>
          </div>

          <!-- Column headers -->
          <div class="csm-table-head">
            <span>Forma de pagamento</span>
            <span class="text-end">Esperado</span>
            <span class="text-center">Em caixa</span>
            <span class="text-end">Saldo</span>
          </div>

          <!-- Payment method rows -->
          <div v-if="loadingOrders" class="csm-loading">
            <span class="spinner-border spinner-border-sm me-2"></span>Carregando pedidos...
          </div>

          <div v-for="method in allMethods" :key="method" class="csm-row">
            <!-- Row header (clickable to expand) -->
            <div class="csm-row__head" @click="toggleMethod(method)">
              <div class="csm-row__name">
                <i class="bi me-1" :class="expanded.has(method) ? 'bi-chevron-down' : 'bi-chevron-right'"></i>
                {{ method }}
                <span class="csm-order-count">{{ orderCount(method) }} pedido{{ orderCount(method) !== 1 ? 's' : '' }}</span>
              </div>
              <div class="csm-row__expected text-end">{{ formatCurrency(expectedFor(method)) }}</div>
              <div class="csm-row__input" @click.stop>
                <input
                  type="text"
                  inputmode="decimal"
                  class="csm-input"
                  :value="declared[method] ?? formatAmount(expectedFor(method))"
                  @change="declared[method] = parseInput($event.target.value)"
                  @focus="$event.target.select()"
                />
              </div>
              <div class="csm-row__diff text-end" :class="diffClass(method)">
                {{ formatCurrency(diffFor(method)) }}
              </div>
            </div>

            <!-- Expanded orders list -->
            <Transition name="slide">
              <div v-if="expanded.has(method)" class="csm-row__orders">
                <div v-if="!ordersFor(method).length" class="csm-orders-empty">
                  Nenhum pedido identificado para este método nesta sessão.
                </div>
                <table v-else class="csm-orders-table">
                  <thead>
                    <tr>
                      <th>Pedido</th>
                      <th>Cliente</th>
                      <th class="text-end">Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="o in ordersFor(method)" :key="o.displayId">
                      <td class="text-muted">#{{ o.displayId }}</td>
                      <td>{{ o.customerName || '—' }}</td>
                      <td class="text-end">{{ formatCurrency(o.amount) }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </Transition>
          </div>

          <!-- Totals footer -->
          <div class="csm-totals">
            <span>TOTAL</span>
            <span class="text-end">{{ formatCurrency(totalExpected) }}</span>
            <span class="text-center">{{ formatCurrency(totalDeclared) }}</span>
            <span class="text-end" :class="totalDiff < 0 ? 'text-danger' : totalDiff > 0 ? 'text-primary' : 'text-success'">
              {{ formatCurrency(totalDiff) }}
            </span>
          </div>

          <!-- Obs -->
          <div class="csm-obs">
            <label class="fw-semibold small mb-1">Obs. Fechamento</label>
            <textarea v-model="closingNoteLocal" class="form-control form-control-sm" rows="3" maxlength="500"
              placeholder="Observações sobre o fechamento..."></textarea>
            <div class="text-end text-muted" style="font-size:0.72rem">{{ (closingNoteLocal||'').length }}/500</div>
          </div>
        </div>

        <!-- Footer -->
        <div class="csm-footer">
          <button class="btn btn-outline-secondary" @click="$emit('close')">Cancelar</button>
          <button v-if="session.status === 'OPEN'" class="btn btn-danger" @click="$emit('close-session', buildPayload())">
            <i class="bi bi-lock me-1"></i>Fechar Frente de Caixa
          </button>
          <button v-else class="btn btn-primary" @click="$emit('save', buildPayload())">
            <i class="bi bi-floppy me-1"></i>Salvar alterações
          </button>
        </div>

      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import api from '../api.js';
import { formatCurrency } from '../utils/formatters.js';

const props = defineProps({
  visible: { type: Boolean, default: false },
  session: { type: Object, default: null },
  usersMap: { type: Object, default: () => ({}) },
});

const emit = defineEmits(['close', 'edit', 'save', 'close-session', 'add-movement']);

const bodyRef = ref(null);
const loadingOrders = ref(false);
const ordersByMethod = ref({});
const declared = ref({});
const expanded = ref(new Set());
const showMovementsType = ref(null);
const closingNoteLocal = ref('');

// ── Derived from session prop ──────────────────────────────────────────

const summary = computed(() => props.session?.summary || {});
const openingAmount = computed(() => Number(props.session?.openingAmount || 0));
const cashSales = computed(() => Number(summary.value.paymentsByMethod?.['Dinheiro'] || 0));
const totalWithdrawals = computed(() => Number(summary.value.totalWithdrawals || 0));
const totalReinforcements = computed(() => Number(summary.value.totalReinforcements || 0));

const inRegisterByMethod = computed(() => summary.value.inRegisterByMethod || {});
const paymentsByMethod = computed(() => summary.value.paymentsByMethod || {});

const allMethods = computed(() => {
  const keys = new Set([
    ...Object.keys(inRegisterByMethod.value),
    ...Object.keys(paymentsByMethod.value),
    ...Object.keys(ordersByMethod.value),
  ]);
  // Dinheiro first, then alphabetical
  const rest = [...keys].filter(k => k !== 'Dinheiro').sort();
  return keys.has('Dinheiro') ? ['Dinheiro', ...rest] : rest;
});

const closerName = computed(() => {
  const id = props.session?.closedBy;
  return id ? (props.usersMap[id] || id) : '';
});

const totalInRegister = computed(() =>
  Object.values(inRegisterByMethod.value).reduce((s, v) => s + Number(v || 0), 0)
);

const totalExpected = computed(() =>
  allMethods.value.reduce((s, m) => s + expectedFor(m), 0)
);

const totalDeclared = computed(() =>
  allMethods.value.reduce((s, m) => s + (Number(declared.value[m] ?? expectedFor(m))), 0)
);

const totalDiff = computed(() => totalDeclared.value - totalExpected.value);

const movements = computed(() => props.session?.movements || []);

const filteredMovements = computed(() =>
  movements.value.filter(mv => mv.type === showMovementsType.value)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
);

// ── Helpers ────────────────────────────────────────────────────────────

function expectedFor(method) {
  return Number(inRegisterByMethod.value[method] ?? paymentsByMethod.value[method] ?? 0);
}

function diffFor(method) {
  const d = Number(declared.value[method] ?? expectedFor(method));
  return d - expectedFor(method);
}

function diffClass(method) {
  const d = diffFor(method);
  if (Math.abs(d) < 0.01) return 'text-success';
  return d > 0 ? 'text-primary' : 'text-danger';
}

function ordersFor(method) {
  return ordersByMethod.value[method] || [];
}

function orderCount(method) {
  return ordersFor(method).length;
}

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatDateTime(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatAmount(v) {
  return String(Number(v || 0).toFixed(2)).replace('.', ',');
}

function parseInput(v) {
  return Number(String(v).replace(',', '.')) || 0;
}

function toggleMethod(method) {
  if (expanded.value.has(method)) expanded.value.delete(method);
  else expanded.value.add(method);
}

function toggleMovements(type) {
  showMovementsType.value = showMovementsType.value === type ? null : type;
}

function buildPayload() {
  const declaredValues = {};
  for (const m of allMethods.value) {
    declaredValues[m] = Number(declared.value[m] ?? expectedFor(m));
  }
  return { declaredValues, closingNote: closingNoteLocal.value || null };
}

function printModal() {
  const w = window.open('', '_blank');
  const content = bodyRef.value?.innerHTML || '';
  w.document.write(`<html><head><title>Fechamento - ${props.session?.label || ''}</title>
    <style>body{font-family:Arial,sans-serif;padding:16px;font-size:13px}
    .csm-row__orders{display:block!important}
    </style></head><body>${content}</body></html>`);
  w.document.close(); w.focus(); w.print();
}

function printSmall() {
  const w = window.open('', '_blank');
  const content = bodyRef.value?.innerHTML || '';
  w.document.write(`<html><head><title>Fechamento - ${props.session?.label || ''}</title>
    <style>body{font-family:Arial,sans-serif;padding:8px;font-size:11px}
    </style></head><body>${content}</body></html>`);
  w.document.close(); w.focus(); w.print();
}

// ── Data fetching ──────────────────────────────────────────────────────

async function fetchOrders() {
  if (!props.session?.id) return;
  loadingOrders.value = true;
  try {
    const { data } = await api.get(`/cash/sessions/${props.session.id}/orders-by-method`);
    ordersByMethod.value = data || {};
  } catch (e) {
    console.warn('orders-by-method failed:', e?.response?.status, e?.message);
    ordersByMethod.value = {};
  } finally {
    loadingOrders.value = false;
  }
}

// ── Watchers ────────────────────────────────────────────────────────────

watch(() => props.visible, (v) => {
  if (v && props.session) {
    closingNoteLocal.value = props.session.closingNote || '';
    declared.value = {};
    expanded.value = new Set();
    showMovementsType.value = null;
    fetchOrders();
  }
}, { immediate: true });
</script>

<style scoped>
/* Backdrop */
.csm-backdrop {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.5);
  z-index: 1060;
  display: flex; align-items: flex-start; justify-content: center;
  overflow-y: auto;
  padding: 20px 0;
}

/* Panel */
.csm-panel {
  background: #fff;
  border-radius: 12px;
  width: 95%;
  max-width: 820px;
  display: flex; flex-direction: column;
  box-shadow: 0 8px 40px rgba(0,0,0,0.2);
  min-height: 0;
}

/* Header */
.csm-header {
  display: flex; justify-content: space-between; align-items: flex-start;
  gap: 16px;
  padding: 16px 20px;
  border-bottom: 1px solid #e9ecef;
  flex-wrap: wrap;
}
.csm-title { font-size: 1rem; font-weight: 700; }
.csm-meta { font-size: 0.8rem; color: #6c757d; margin-top: 2px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.csm-meta__closer::before { content: '·'; margin-right: 8px; }
.badge-open { background: #198754; color: #fff; font-size: 0.7rem; padding: 2px 6px; border-radius: 4px; }

.csm-header__right { display: flex; align-items: center; gap: 16px; flex-shrink: 0; }
.csm-balance__label { font-size: 0.8rem; color: #6c757d; text-align: right; }
.csm-balance__value { font-size: 1.3rem; font-weight: 700; color: #198754; }

.csm-header__actions { display: flex; flex-direction: column; gap: 6px; }
.csm-header__actions .btn { white-space: nowrap; }

/* Info bar */
.csm-info-bar {
  display: flex; gap: 16px; flex-wrap: wrap;
  padding: 10px 20px;
  background: #f8f9fa;
  border-bottom: 1px solid #e9ecef;
  font-size: 0.85rem;
}
.csm-link { font-size: 0.8rem; color: #0d6efd; text-decoration: none; }
.csm-link:hover { text-decoration: underline; }

/* Movements inline */
.csm-movements-inline {
  border-bottom: 1px solid #e9ecef;
  background: #fff8f0;
}
.csm-mv-item {
  display: flex; align-items: center; gap: 12px;
  padding: 6px 20px;
  font-size: 0.82rem;
  border-bottom: 1px dashed #f0e0cc;
}
.csm-mv-date { color: #6c757d; min-width: 140px; }
.csm-mv-amount { font-weight: 600; min-width: 90px; }
.csm-mv-note { flex: 1; color: #495057; }

/* Body */
.csm-body { flex: 1; overflow-y: auto; }

/* Table head */
.csm-table-head {
  display: grid; grid-template-columns: 1fr 140px 140px 110px;
  padding: 8px 20px;
  background: #f8f9fa;
  border-bottom: 1px solid #e9ecef;
  font-size: 0.72rem; font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.05em;
  color: #6c757d;
}

/* Payment row */
.csm-row { border-bottom: 1px solid #f0f0f0; }
.csm-row__head {
  display: grid; grid-template-columns: 1fr 140px 140px 110px;
  align-items: center;
  padding: 10px 20px;
  cursor: pointer;
  transition: background 0.15s;
}
.csm-row__head:hover { background: #f8f9fa; }

.csm-row__name { display: flex; align-items: center; gap: 6px; font-size: 0.9rem; }
.csm-order-count { font-size: 0.72rem; color: #6c757d; background: #e9ecef; padding: 1px 6px; border-radius: 10px; }

.csm-row__expected { font-size: 0.9rem; color: #495057; }
.csm-row__diff { font-size: 0.9rem; font-weight: 600; }

.csm-input {
  width: 120px; padding: 4px 8px;
  border: 1px solid #dee2e6; border-radius: 6px;
  font-size: 0.875rem; text-align: right;
  background: #fff;
  transition: border-color 0.15s;
}
.csm-input:focus { outline: none; border-color: #0d6efd; }

/* Orders panel */
.csm-row__orders {
  background: #f8f9fa;
  border-top: 1px solid #e9ecef;
  padding: 10px 20px 12px 40px;
}
.csm-orders-empty { font-size: 0.82rem; color: #adb5bd; }
.csm-orders-table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
.csm-orders-table th { padding: 4px 8px; text-align: left; font-size: 0.72rem; color: #6c757d; border-bottom: 1px solid #dee2e6; }
.csm-orders-table td { padding: 5px 8px; border-bottom: 1px solid #f0f0f0; }
.csm-orders-table tr:last-child td { border-bottom: none; }

/* Totals row */
.csm-totals {
  display: grid; grid-template-columns: 1fr 140px 140px 110px;
  padding: 12px 20px;
  background: #f8f9fa;
  border-top: 2px solid #dee2e6;
  font-weight: 700; font-size: 0.9rem;
}

/* Obs */
.csm-obs { padding: 16px 20px; border-top: 1px solid #e9ecef; }

/* Footer */
.csm-footer {
  display: flex; justify-content: flex-end; gap: 8px;
  padding: 12px 20px;
  border-top: 1px solid #e9ecef;
  background: #fff;
  border-radius: 0 0 12px 12px;
}

/* Loading state */
.csm-loading { padding: 16px 20px; color: #6c757d; font-size: 0.875rem; }

/* Slide transition */
.slide-enter-active, .slide-leave-active { transition: max-height 0.2s ease, opacity 0.15s; overflow: hidden; }
.slide-enter-from, .slide-leave-to { max-height: 0; opacity: 0; }
.slide-enter-to, .slide-leave-from { max-height: 600px; opacity: 1; }
</style>
