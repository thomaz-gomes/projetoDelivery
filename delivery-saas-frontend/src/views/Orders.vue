<script setup>
import { onMounted, ref, computed, onUnmounted, nextTick, watch } from 'vue';
import { normalizeOrderItems } from '../utils/orderUtils.js';
import { useOrdersStore } from '../stores/orders';
import { useAuthStore } from '../stores/auth';
import { useRouter } from 'vue-router';
import Swal from 'sweetalert2';
import { io } from 'socket.io-client';
import 'sweetalert2/dist/sweetalert2.min.css';
import printService from "../services/printService.js";
import PrinterStatus from '../components/PrinterStatus.vue';
import PrinterConfig from '../components/PrinterConfig.vue';
import POSOrderWizard from '../components/POSOrderWizard.vue';
import CashControl from '../components/CashControl.vue';

import api from '../api';
import { API_URL, SOCKET_URL } from '@/config';
import QRCode from 'qrcode';
import { formatCurrency, formatAmount } from '../utils/formatters.js';
import { formatDate, formatTime } from '../utils/dates'
import { createApp, h } from 'vue';
import CurrencyInput from '../components/CurrencyInput.vue';
import { bindLoading } from '../state/globalLoading.js';
import Sortable from 'sortablejs';
const store = useOrdersStore();
const auth = useAuthStore();
const router = useRouter();

// helper para formatar displayId com dois dígitos e garantir consistência
function padNumber(n) {
  if (n == null || n === '') return null;
  return String(n).toString().padStart(2, '0');
}

function formatDisplay(o) {
  if (!o) return '';
  if (o.displaySimple) return o.displaySimple;
  if (o.displayId !== undefined && o.displayId !== null) {
    const p = padNumber(o.displayId);
    return p ? p : String(o.displayId);
  }
  // fallback para id curto
  return o.id ? o.id.slice(0, 6) : '';
}

const loading = ref(false);
bindLoading(loading);
const socket = ref(null);
const sortableInstances = [];
const playSound = ref(true);
const selectedStatus = ref('TODOS');
const selectedRider = ref('TODOS');
const isMobile = ref(typeof window !== 'undefined' ? window.innerWidth < 768 : false);
const companyPaymentMethods = ref([]);
const statusFiltersMobile = computed(() => statusFilters.filter(s => s.value !== 'TODOS'));
// extra filters
const searchOrderNumber = ref('');
const searchCustomerName = ref('');
let audio = null;
const now = ref(Date.now());
// connection state for a dev-friendly badge (moved to module scope so computed can access it)
const connectionState = ref({ status: 'idle', since: Date.now(), url: null });
const showPrinterConfig = ref(false);
const showPdv = ref(false);
const newOrderPhone = ref('');
const pdvPreset = ref(null);

// atualiza 'now' a cada 30s para que durações sejam atualizadas na interface
let nowTimer = null;
let resizeHandler = null;

// =============================
// 🎧 Som de novo pedido
// =============================
function beep() {
  if (!playSound.value) return;
  if (!audio) audio = new Audio('/sounds/new-order.mp3');
  audio.currentTime = 0;
  audio.play().catch(() => {});
}

// =============================
// 🔔 Notificações do navegador
// =============================

async function requestNotificationPermission() {
  if (!("Notification" in window)) {
    console.warn("🔕 Este navegador não suporta notificações nativas.");
    return;
  }

  const permission = await Notification.requestPermission();
  if (permission === "granted") {
    console.log("✅ Permissão para notificações concedida.");
  } else {
    console.warn("🚫 Permissão de notificações negada ou não respondida.");
  }
}

/**
 * Exibe uma notificação nativa do navegador.
 * @param {object} pedido - Dados do pedido
 */
function showNotification(pedido) {
  if (!("Notification" in window)) return;
  if (Notification.permission !== "granted") return;

  const title = "Novo pedido recebido!";
  const options = {
    body: `${pedido.customerName || "Cliente"} — ${formatCurrency(pedido.total)}`,
    icon: "/icons/order.png", // você pode adicionar um ícone na pasta public/icons
    badge: "/icons/badge.png",
  };

  const notif = new Notification(title, options);

  notif.onclick = () => {
    window.focus();
    notif.close();
  };
}


// =============================
// 🧠 Lifecycle: iniciar conexões e dados
// =============================
onMounted(async () => {
  await requestNotificationPermission();

  try {
    await store.fetch();
    // ensure store names are hydrated when backend omitted the relation
    await hydrateMissingStores();
    await store.fetchRiders();
    // load company payment methods (admin endpoint)
    try {
      const cid = auth?.user?.companyId || null;
      if (cid) {
        const pmRes = await api.get(`/menu/payment-methods?companyId=${cid}`);
        companyPaymentMethods.value = Array.isArray(pmRes.data) ? pmRes.data : [];
      }
    } catch (e) {
      companyPaymentMethods.value = [{ code: 'CASH', name: 'Dinheiro' }];
    }
  } catch (e) {
    console.error(e);
    Swal.fire('Erro', 'Falha ao carregar pedidos/entregadores.', 'error');
  }

  // 🔌 Conectar ao servidor (tempo real)
  console.log('Socket connecting to SOCKET_URL:', SOCKET_URL);
  // Prefer websocket transport to avoid polling/upgrade flapping; increase reconnection patience
  socket.value = io(SOCKET_URL, {
    transports: ['websocket'],
    timeout: 30000,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    randomizationFactor: 0.2
  });

  // update connection state for a dev-friendly badge
  connectionState.value = { status: 'connecting', since: Date.now(), url: SOCKET_URL };

  socket.value.on('connect', () => {
    connectionState.value = { status: 'connected', since: Date.now(), url: SOCKET_URL };
    console.log('📡 Conectado ao servidor de pedidos.');
    // If user is logged in, identify this socket so backend can target it by companyId
    try {
      if (auth && auth.token) {
        try { socket.value.emit('identify', auth.token); } catch (e) { console.warn('Failed to emit identify', e); }
      }
    } catch (e) {}
  });
  // Debug: log any socket event to help identify what backend is emitting
  try {
    socket.value.onAny((event, ...args) => {
      try { console.debug('[socket:onAny]', event, args); } catch (e) {}
    });
  } catch (e) { /* some older socket builds may not support onAny; ignore */ }
  socket.value.on('disconnect', (reason) => {
    connectionState.value = { status: 'disconnected', reason: reason || 'unknown', since: Date.now(), url: SOCKET_URL };
    console.warn('⚠️ Desconectado do servidor de pedidos.', reason);
  });
  socket.value.on('connect_error', (err) => {
    connectionState.value = { status: 'error', reason: String(err || ''), since: Date.now(), url: SOCKET_URL };
    console.error('❌ Socket connect error', err);
  });
  socket.value.on('reconnect_attempt', (n) => {
    connectionState.value = { status: 'reconnecting', attempt: n, since: Date.now(), url: SOCKET_URL };
    console.log('🔁 Socket reconnect attempt', n);
  });

  // If other parts of the app notify that a user just logged in, send 'identify'
  const onAppUserLoggedIn = (ev) => {
    try {
      const t = ev && ev.detail && ev.detail.token;
      if (t && socket.value) {
        try { socket.value.emit('identify', t); } catch (e) {}
      }
    } catch (e) {}
  };
  try { window.addEventListener('app:user-logged-in', onAppUserLoggedIn); } catch (e) {}

  socket.value.on("novo-pedido", async (pedido) => {
    console.log("🆕 Novo pedido recebido via socket:", pedido);
    // se o payload do socket não trouxer displayId, buscar o pedido completo no backend
    let full = pedido;
    if (!full.displayId && full.id) {
      try {
        const { data } = await api.get(`/orders/${full.id}`);
        if (data) full = data;
      } catch (err) {
        console.warn('⚠️ Não foi possível obter pedido completo do backend, usando payload do socket.', err);
      }
    }

    // marca pedido como novo para aplicar animação de entrada
    full._isNew = true;
    // Evita duplicação: se o pedido já existir no store, substitui/atualiza em vez de inserir novamente.
    try {
      const existsIdx = store.orders.findIndex(o => o && o.id === full.id);
      if (existsIdx !== -1) {
        try { if (store.orders[existsIdx] && store.orders[existsIdx]._normalized) delete store.orders[existsIdx]._normalized; } catch(e) {}
        store.orders.splice(existsIdx, 1, full);
      } else {
        store.orders.unshift(full);
      }
    } catch (e) {
      try { store.orders.unshift(full); } catch (err) { console.warn('Failed to insert novo-pedido into store.orders', err); }
    }
    // hydrate store name for the newly arrived order if missing
    try { await hydrateMissingStore(full); } catch (e) {}
    // remove a marcação após a animação
    nextTick(() => setTimeout(() => {
      try {
        const idx = store.orders.findIndex(o => o && o.id === full.id);
        if (idx !== -1) store.orders[idx]._isNew = false;
      } catch (e) {}
    }, 900));
    beep();
    pulseButton();
    showNotification(full);

    try {
      // Only perform frontend automatic printing when the print route is set to 'agent'.
      // When using backend auto-printing (recommended), the backend will forward to agents
      // and emit `print-result` events back to the UI — avoid double-printing.
      try {
        const route = (printService && printService.getPrintRoute) ? printService.getPrintRoute() : null;
        if (route === 'agent') {
          await printService.enqueuePrint(full);
          console.log(`🖨️ Impressão automática (frontend->agent) enviada: ${formatDisplay(full)}`);
        } else {
          console.log(`🖨️ Frontend print skipped (route=${route}) — backend will handle auto-print.`);
        }
      } catch (e) {
        console.warn('printService check/print failed', e);
      }
    } catch (err) {
      console.error("⚠️ Falha ao imprimir automaticamente:", err);
    }

    Swal.fire({
      icon: "info",
      title: "Novo pedido recebido!",
      text: `${full.customerName || "Cliente"} - ${formatDisplay(full)}`,
      timer: 4000,
      toast: true,
      position: "top-end",
      showConfirmButton: false,
    });
  });

  // Listen for order update events from backend (support multiple event names used by integrations)
  async function handleOrderUpdateEvent(payload, eventName) {
    try {
      // Debug: log incoming payloads to help find event shapes
      try { console.debug('[socket] order update event', eventName || '', payload); } catch (e) {}

      // attempt to find an id from many possible shapes
      let id = null;
      if (!payload) id = null;
      else if (typeof payload === 'string' || typeof payload === 'number') id = payload;
      else {
        id = payload.id || payload.orderId || payload.order_id || payload._id || payload.data?.id || payload.order?.id || payload.payload?.order?.id || payload.orderId;
      }
      if (!id) return;
      // If the payload already contains the full order or status, merge optimistically to avoid extra roundtrip
      let updated = null;
      if (payload && (payload.order || payload.data || payload.payload || payload.status || payload.statusName)) {
        // try common locations for full order
        updated = payload.order || payload.data || payload.payload || null;
        // If we only have status, build a minimal updated object
        if (!updated && (payload.status || payload.statusName)) {
          updated = { id, status: payload.status || payload.statusName };
        }
      }

      // If we don't have a full updated object, fetch from store/api
      if (!updated) {
        try {
          updated = await store.fetchOne(id);
        } catch (e) {
          console.warn('Falha ao buscar pedido atualizado via store.fetchOne, tentando API direto', e);
          try {
            const { data } = await api.get(`/orders/${id}`);
            updated = data;
          } catch (err) {
            console.warn('Falha ao buscar pedido atualizado', err);
          }
        }
      }
      if (!updated) return;
      // ensure related store info hydrated if missing
      try { await hydrateMissingStore(updated); } catch (e) { /* ignore */ }

      const idx = store.orders.findIndex(o => o && o.id === updated.id);
      const old = idx !== -1 ? store.orders[idx] : null;
      if (idx !== -1) {
        // clear any cached normalized data so helpers recompute
        try { if (old && old._normalized) delete old._normalized; } catch (e) {}
        try { if (updated && updated._normalized) delete updated._normalized; } catch (e) {}

        // If updated contains only partial fields (like only status), merge into existing object to preserve other fields
        if (!updated.items && !updated.histories && (updated.status && old)) {
          // merge into a fresh object and ensure no stale _normalized remains
          const merged = Object.assign({}, old, updated);
          try { if (merged && merged._normalized) delete merged._normalized; } catch (e) {}
          store.orders.splice(idx, 1, merged);
        } else {
          // replace in-place to keep reactivity
          store.orders.splice(idx, 1, updated);
        }
      } else {
        // if not present, refresh full list to ensure ordering and filters match backend
        try {
          await store.fetch();
        } catch (e) {
          // final fallback: insert the item at top
          store.orders.unshift(updated);
        }
      }

      // re-init drag/drop to ensure DOM reflects any structural changes
      try { await nextTick(); initDragAndDrop(); } catch (e) { /* ignore */ }

      // notify only when status changed
      try {
        if (old && old.status !== updated.status) {
          Swal.fire({ icon: 'info', title: 'Pedido atualizado', text: `Pedido ${formatDisplay(updated)} mudou para ${updated.status}`, toast: true, position: 'top-end', timer: 3000, showConfirmButton: false });
          beep();
        }
      } catch (e) { /* ignore notify errors */ }
    } catch (e) {
      console.warn('Erro ao processar evento de pedido atualizado', e);
    }
  }

  // Register many common event names emitted by backend/integrations
  const orderUpdateEvents = ['pedido-atualizado', 'order-updated', 'order:updated', 'order-status-changed', 'pedido-status', 'update-order'];
  orderUpdateEvents.forEach(ev => socket.value.on(ev, (p) => handleOrderUpdateEvent(p, ev)));

  // Listen for print results emitted by backend so UI shows toast notifications
  socket.value.on('print-result', (payload) => {
    try {
      const oid = payload && (payload.orderId || payload.order && payload.order.id);
      const order = oid ? store.orders.find(o => o && o.id === oid) : null;
      const display = order ? formatDisplay(order) : (payload && payload.order && formatDisplay(payload.order)) || (oid ? String(oid).slice(0,6) : '');

      if (!payload || !payload.status) {
        // unknown payload
        return;
      }

      if (payload.status === 'printed') {
        Swal.fire({ icon: 'success', title: 'Impressão realizada', text: `Comanda ${display} impressa com sucesso.`, timer: 2500, toast: true, position: 'top-end', showConfirmButton: false });
      } else if (payload.status === 'queued') {
        Swal.fire({ icon: 'info', title: 'Pedido enfileirado', text: `Comanda ${display} foi enfileirada para impressão. Será processada em breve.`, timer: 3000, toast: true, position: 'top-end', showConfirmButton: false });
      } else if (payload.status === 'error' || payload.status === 'failed') {
        Swal.fire({ icon: 'error', title: 'Erro na impressão', text: `Falha ao imprimir comanda ${display}.`, timer: 4000, toast: true, position: 'top-end', showConfirmButton: false });
      } else {
        // fallback informational toast
        Swal.fire({ icon: 'info', title: 'Status de impressão', text: payload.message || `Status: ${payload.status}`, timer: 3000, toast: true, position: 'top-end', showConfirmButton: false });
      }
    } catch (e) {
      console.warn('Failed to handle print-result socket event', e);
    }
  });

  // Listen for agent token rotations (dev/admin action). When received, update
  // local storage and printService so frontend HTTP->agent calls keep working.
  socket.value.on('agent-token-rotated', async (payload) => {
    try {
      if (!payload || !payload.token) return;
      const token = payload.token;
      console.log('Received agent-token-rotated via socket; updating local token store.');
      try { localStorage.setItem('agentToken', token); } catch (e) {}
      try { await printService.setPrinterConfig({ agentToken: token }); } catch (e) { console.warn('Failed to apply rotated agent token to printService', e); }
    } catch (e) {
      console.warn('Failed to handle agent-token-rotated', e);
    }
  });

  socket.value.on('disconnect', () => {
    // keep connectionState in sync when disconnected via other paths
    connectionState.value = { status: 'disconnected', since: Date.now(), url: API_URL };
    console.warn('⚠️ Desconectado do servidor de pedidos.');
  });
  // init drag & drop after DOM rendered
  await nextTick();
  initDragAndDrop();
  // if mobile, default to Novos / Em preparo
  try {
    if (isMobile.value && selectedStatus.value === 'TODOS') selectedStatus.value = 'EM_PREPARO';
  } catch (e) {}
  // listen to resize to update mobile flag
  try {
    resizeHandler = () => { isMobile.value = window.innerWidth < 768 };
    window.addEventListener('resize', resizeHandler);
  } catch (e) {}
  // inicia atualização de tempo para durações
  nowTimer = setInterval(() => (now.value = Date.now()), 30 * 1000);
});

// expose connection state to template
const socketConnection = computed(() => socket.value ? connectionState.value : { status: 'idle', url: null });

// Portuguese labels for socket states (dev badge)
const socketStatusLabel = computed(() => {
  const s = (socketConnection.value && socketConnection.value.status) || 'idle';
  const map = {
    connecting: 'conectando',
    connected: 'conectado',
    disconnected: 'desconectado',
    error: 'erro',
    reconnecting: 'reconectando',
    idle: 'inativo'
  };
  return map[s] || s;
});

// re-init drag/drop when orders list changes
watch(() => store.orders.length, async () => {
  await nextTick();
  initDragAndDrop();
});

onUnmounted(() => {
  if (socket.value) {
    try { socket.value.offAny && socket.value.offAny(); } catch (e) {}
    socket.value.disconnect();
  }
  try { window.removeEventListener('app:user-logged-in', onAppUserLoggedIn); } catch (e) {}
  try { if (resizeHandler) window.removeEventListener('resize', resizeHandler); } catch (e) {}
  clearInterval(nowTimer);
  // destroy Sortable instances
  for (const s of sortableInstances) {
    try { s.destroy(); } catch (e) {}
  }
});

function onPrinterSaved(cfg){
  console.log('Printer configuration saved:', cfg);
  try {
    // persist config to the print service and attempt to apply immediately
    printService.setPrinterConfig(cfg).then(() => {
      console.log('Printer config persisted.');
    }).catch(e => console.warn('Failed to persist printer config via printService', e));
  } catch (e) {
    console.warn('Error applying printer config', e);
  }
}

// =============================
// 💡 Computed: aplicar filtros (inclui filtro de 24h)
// =============================
function getCreatedAt(o) {
  // tenta diferentes campos comuns
  const val = o.createdAt || o.created_at || o.created || o.createdAtTimestamp || o.created_at_timestamp;
  if (!val) return null;
  if (typeof val === 'number') return new Date(val);
  return new Date(val);
}

// Use shared date helpers from `src/utils/dates`:
// - formatDate(d) -> returns `dd/mm/YYYY`
// - formatTime(d) -> returns `HH:MM`

// use `formatCurrency` / `formatAmount` from `src/utils/formatters.js`

// Compute displayed total as sum(items + options) + delivery fee, robust to different payload shapes
function computeDisplayedTotal(o){
  try{
    const items = normalizeOrderItems(o) || [];
    let subtotal = 0;
    for(const it of items){
      const qty = Number(it.quantity || 1) || 1;
      const unit = Number(it.unitPrice || 0) || 0;
      // use extractItemOptions to support multiple option shapes (publicMenu checkout etc.)
      const opts = extractItemOptions(it) || [];
      let optsSum = 0;
      for (const opt of opts) {
        const p = Number(opt.price || 0) || 0;
        const oq = Number(opt.quantity || 1) || 1;
        // assume option price applies per product unit; quantity is option qty per product
        optsSum += p * oq;
      }
      subtotal += (unit * qty) + (optsSum * qty);
    }

    // detect delivery fee in common fields
    const d = Number(o.deliveryFee ?? o.delivery_fee ?? o.delivery?.fee ?? o.payload?.delivery?.deliveryFee ?? o.payload?.delivery?.fee ?? o.totalDeliveryFee ?? o.total_delivery_fee ?? 0) || 0;
    return subtotal + d;
  }catch(e){
    try { return Number(o.total || o.amount || 0) || 0; } catch(e2) { return 0; }
  }
}

// Normalize various option shapes to a common array of {name, price, quantity}
function extractItemOptions(it) {
  try {
    if (!it) return [];
    // Common locations: it.options, it.selectedOptions, it.selected
    let opts = it.options || it.selectedOptions || it.selected || [];

    // Some payloads use a single object under `option`
    if ((!Array.isArray(opts) || opts.length === 0) && it.option) {
      opts = Array.isArray(it.option) ? it.option : [it.option];
    }

    // Also support optionGroups with chosen options: { optionGroups: [ { selected: [...] } ] }
    if ((!Array.isArray(opts) || opts.length === 0) && Array.isArray(it.optionGroups)) {
      // flatten any selected arrays found in groups
      const byGroup = [];
      for (const g of it.optionGroups) {
        if (Array.isArray(g.selected)) byGroup.push(...g.selected);
        else if (Array.isArray(g.selectedOptions)) byGroup.push(...g.selectedOptions);
      }
      if (byGroup.length) opts = byGroup;
    }

    if (!Array.isArray(opts)) return [];

    const out = [];
    for (const o of opts) {
      if (!o) continue;
      // shape: { option: { name, price }, qty }
      if (o.option && (o.option.name || o.option.title || o.option.price !== undefined)) {
        out.push({
          name: o.option.name || o.option.title || '',
          price: Number(o.option.price ?? o.option.unitPrice ?? o.option.amount ?? 0) || 0,
          quantity: Number(o.qty ?? o.quantity ?? o.option.quantity ?? 1) || 1
        });
        continue;
      }
      // shape: { name, price, quantity }
      out.push({
        name: o.name || o.title || '' ,
        price: Number(o.price ?? o.unitPrice ?? o.amount ?? 0) || 0,
        quantity: Number(o.quantity ?? o.qty ?? 1) || 1
      });
    }
    return out;
  } catch (e) {
    return [];
  }
}

function humanDuration(ms) {
  if (ms == null || isNaN(ms)) return '-';
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) {
    return `${totalMinutes}m`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}:${String(minutes).padStart(2, '0')}`; // e.g. 1:05
}

function getStatusStart(o) {
  // procura último history onde to === current status
  const hs = (o.histories || []).slice().sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  for (let i = hs.length - 1; i >= 0; i--) {
    if (hs[i].to === o.status) return parseDate(hs[i].createdAt);
  }
  // fallback: se não achar, usa createdAt do pedido
  return getCreatedAt(o) || null;
}

function getOrderTotalDuration(o) {
  const created = getCreatedAt(o);
  if (!created) return '-';
  return humanDuration(now.value - created.getTime());
}

function getCreatedDurationDisplay(o) {
  const created = getCreatedAt(o);
  if (!created) return `${formatDateShort(null)} (-)`;
  return `${formatDate(created)} (${humanDuration(now.value - created.getTime())})`;
}

function getStatusStartDurationDisplay(o) {
  const start = getStatusStart(o);
  if (!start) return '';
  return `Desde ${formatTime(start)} (${humanDuration(now.value - start.getTime())})`;
}

function getPaymentMethod(o) {
  const p = o.payload?.payments;
  if (!p) return '—';
  // try structured methods
  const m = p.methods && p.methods[0];
  if (m) {
    if (m.method) return m.method + (m.card?.brand ? ` (${m.card.brand})` : '');
    if (m.type) return m.type;
  }
  // fallback: prepaid flag
  if (p.prepaid) return 'Pré-pago';
  return '—';
}

function getOrderNotes(o) {
  return o.payload?.notes || o.payload?.observations || o.payload?.additionalInfo?.notes || '';
}

// Normalize items from different integration payload shapes to a common structure
// normalizeOrderItems is shared from ../utils/orderUtils.js

// Normaliza um pedido inteiro para um shape consistente usado pela UI
function normalizeOrder(o){
  if(!o) return {};
  if (o._normalized) return o._normalized;

  const items = normalizeOrderItems(o);
  // payment method: try common places
  let paymentMethod = '—';
  if (o.payment && (o.payment.methodCode || o.payment.method)) {
    paymentMethod = o.payment.methodCode || o.payment.method || String(o.payment.amount || '');
  } else if (o.payload && o.payload.payment) {
    paymentMethod = o.payload.payment.methodCode || o.payload.payment.method || o.payload.payment.type || paymentMethod;
  } else if (o.payload && o.payload.payments && Array.isArray(o.payload.payments) && o.payload.payments[0]) {
    const m = o.payload.payments[0];
    paymentMethod = m.method || m.type || paymentMethod;
  } else {
    // fallback to existing helper
    try { paymentMethod = getPaymentMethod(o); } catch(e) {}
  }

  // coupon
  const couponCode = o.couponCode || (o.coupon && (o.coupon.code || o.couponId)) || (o.payload && o.payload.coupon && (o.payload.coupon.code || o.payload.couponId)) || null;
  const couponDiscount = Number(o.couponDiscount ?? o.coupon?.discountAmount ?? o.discountAmount ?? o.discount ?? o.payload?.coupon?.discountAmount ?? 0) || 0;
  // capture any customer-provided 'troco' (change) from common payload locations
  let paymentChange = null;
  try {
    if (o.payment && (o.payment.changeFor || o.payment.change_for || o.payment.change)) {
      paymentChange = Number((o.payment.changeFor ?? o.payment.change_for ?? o.payment.change) || 0) || null;
    } else if (o.payload && o.payload.payment && (o.payload.payment.changeFor || o.payload.payment.change_for || o.payload.payment.change)) {
      paymentChange = Number((o.payload.payment.changeFor ?? o.payload.payment.change_for ?? o.payload.payment.change) || 0) || null;
    } else if (o.payload && o.payload.payments && Array.isArray(o.payload.payments) && o.payload.payments[0] && (o.payload.payments[0].changeFor || o.payload.payments[0].change_for || o.payload.payments[0].change)) {
      paymentChange = Number((o.payload.payments[0].changeFor ?? o.payload.payments[0].change_for ?? o.payload.payments[0].change) || 0) || null;
    }
  } catch (e) { /* ignore */ }

  const total = Number(o.total ?? o.amount ?? (o.payment ? o.payment.amount : undefined) ?? 0) || 0;

  // build a robust address extraction checking many common payload shapes
  function extractAddress(o) {
    if (!o) return '';
    const a = o.address ||
      o.payload?.delivery?.deliveryAddress?.formattedAddress ||
      o.payload?.deliveryAddress?.formattedAddress ||
      o.payload?.delivery?.address?.formattedAddress ||
      o.payload?.delivery?.address ||
      o.payload?.order?.delivery?.address?.formattedAddress ||
      o.payload?.order?.delivery?.address ||
      o.payload?.shippingAddress?.formattedAddress ||
      o.payload?.shipping?.address?.formattedAddress ||
      o.payload?.delivery_address?.formatted_address ||
      o.payload?.rawPayload?.deliveryAddress?.formattedAddress ||
      o.payload?.rawPayload?.address?.formatted ||
      o.payload?.rawPayload?.address?.formattedAddress ||
      o.payload?.rawPayload?.address?.formatted_address ||
      o.rawPayload?.neighborhood ||
      (typeof o.rawPayload?.address === 'string' ? o.rawPayload.address : null) ||
      o.customer?.address?.formattedAddress ||
      '';
    return a;
  }

  const normalized = {
    id: o.id,
    display: formatDisplay(o),
    customerName: o.customerName || o.name || (o.customer && (o.customer.name || o.customer.fullName)) || '',
    customerPhone: o.customerPhone || o.contact || (o.customer && o.customer.contact) || '',
    address: extractAddress(o) || '',
    total,
    paymentMethod,
    // storeName and channelLabel: prefer explicit store name and a human-friendly channel label
    // prefer the related store name from the related store object, or from the
    // payload (public orders may include payload.store.name). Do NOT fallback to company.
    storeName: (function() {
      try {
        return (o.store && o.store.name) || (o.payload && o.payload.store && o.payload.store.name) || (o.payload && o.payload.rawPayload && o.payload.rawPayload.store && o.payload.rawPayload.store.name) || null;
      } catch (e) { return null; }
    })(),
    channelLabel: (function() {
      // try common locations for integration/channel/provider
      const raw = o.payload?.integration?.provider || o.payload?.provider || o.payload?.adapter || o.payload?.platform || o.payload?.source?.provider || o.payload?.channel || o.integration?.provider || o.adapter || o.payload?.source || null;

      function prettyChannel(p) {
        if (!p) return null;
        const s = String(p).trim();
        const up = s.toUpperCase();
        const map = {
          IFOOD: 'iFood',
          UBER: 'Uber',
          UBEREATS: 'UberEats',
          RAPPI: 'Rappi',
          PDV: 'PDV',
          POS: 'PDV',
          PUBLIC: 'Cardápio digital',
          WEB: 'Cardápio digital',
          MENU: 'Cardápio digital',
          'CARDAPIO_DIGITAL': 'Cardápio digital'
        };
        if (map[up]) return map[up];
        // fallback: title case a cleaned token
        const lower = s.toLowerCase();
        return lower.charAt(0).toUpperCase() + lower.slice(1);
      }

      // Prefer explicit payload hints (customerSource/public orders)
      if (!raw) {
        const src = (o.customerSource || (o.payload && o.payload.source) || null);
        if (src) {
          const guessed = prettyChannel(src);
          if (guessed) return guessed;
        }
      }

      return prettyChannel(raw);
    })(),
    couponCode,
    couponDiscount,
    paymentChange,
    items
  };

  // Do not cache normalization on the order object here because orders may be
  // updated in-place later (via socket or fetch) and we want the UI to reflect
  // the freshest address/payload. Keep this function idempotent and cheap.
  return normalized;
}

// If backend didn't include the related store object, fetch it by storeId as a fallback.
async function fetchStoreById(id) {
  if (!id) return null;
  try {
    const { data } = await api.get(`/stores/${id}`);
    return data;
  } catch (e) {
    // ignore failure, return null
    return null;
  }
}

async function hydrateMissingStore(o) {
  try {
    if (!o) return;
    if (o.store && o.store.name) return;
    if (!o.storeId) return;
    const s = await fetchStoreById(o.storeId);
    if (s) o.store = s;
  } catch (e) {
    // swallow
  }
}

async function hydrateMissingStores() {
  const toFetch = (store.orders || []).filter(o => o && o.storeId && (!o.store || !o.store.name));
  await Promise.all(toFetch.map(o => hydrateMissingStore(o)));
}

function reprintOrder(o) {
  printReceipt(o);
}

function sendWhatsAppAction(o) {
  console.log('Enviar WhatsApp para pedido', o.id);
  // stub: could open modal to send message
}

function markAsConcludedAction(o) {
  changeStatus(o, 'CONCLUIDO');
}

function cancelOrderAction(o) {
  changeStatus(o, 'CANCELADO');
}

// compute next status in the happy path pipeline
function getNextStatus(current) {
  const pipeline = ['EM_PREPARO', 'SAIU_PARA_ENTREGA', 'CONFIRMACAO_PAGAMENTO', 'CONCLUIDO'];
  const idx = pipeline.indexOf((current || '').toUpperCase());
  if (idx === -1) return null;
  if (idx === pipeline.length - 1) return null;
  return pipeline[idx + 1];
}

async function advanceStatus(order) {
  const next = getNextStatus(order.status);
  if (!next) return;
  // reuse existing changeStatus to preserve assign-modal behaviour for SAIU_PARA_ENTREGA
  await changeStatus(order, next);
}

const filteredOrders = computed(() => {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  return store.orders.filter((o) => {
    // filtro de status/entregador
    const statusMatch = selectedStatus.value === 'TODOS' || o.status === selectedStatus.value;
    // compare as strings to avoid numeric/string id mismatches
    const riderMatch = selectedRider.value === 'TODOS' || (o.rider && String(o.rider.id) === String(selectedRider.value));

    // order number filter (match display or id)
    const qOrder = String(searchOrderNumber.value || '').trim().toLowerCase();
    const display = String(formatDisplay(o) || '').toLowerCase();
    const idStr = String(o.id || '').toLowerCase();
    const orderNumberMatch = !qOrder || display.includes(qOrder) || idStr.includes(qOrder);

    // customer name filter
    const qName = String(searchCustomerName.value || '').trim().toLowerCase();
    const customerMatch = !qName || String(o.customerName || '').toLowerCase().includes(qName);

    if (!statusMatch || !riderMatch || !orderNumberMatch || !customerMatch) return false;

    // filtro: pedidos com mais de 24h não devem ser exibidos
    const created = getCreatedAt(o);
    if (created && (now - created.getTime() > dayMs)) return false;

    return true;
  });
});

// debug: log quando o filtro de entregador mudar (ajuda a depurar reatividade)
// debug: log changes in filters to help debugging filter behaviour
watch([selectedRider, searchOrderNumber, searchCustomerName, selectedStatus], ([rider, orderQ, nameQ, status]) => {
  try {
    const counts = COLUMNS.map(c => ({ key: c.key, count: columnOrders(c.key).length }));
    console.log('[debug] filters ->', { rider, orderQ, nameQ: nameQ, status, filtered: filteredOrders.value.length, columnCounts: counts });
  } catch (e) {
    console.log('[debug] filters changed', { rider, orderQ, nameQ: nameQ, status });
  }
});

// timeline UI state
const openTimeline = ref({});

function toggleTimeline(id) {
  openTimeline.value[id] = !openTimeline.value[id];
}

const STATUS_LABEL = {
  EM_PREPARO: 'Em preparo',
  SAIU_PARA_ENTREGA: 'Saiu para entrega',
  CONCLUIDO: 'Concluído',
  CONFIRMACAO_PAGAMENTO: 'Confirmação de pagamento',
  CANCELADO: 'Cancelado',
  INVOICE_AUTHORIZED: 'NFC-e Autorizada',
};

// columns to render (order matters)
const COLUMNS = [
  { key: 'EM_PREPARO', label: 'Novos / Em preparo' },
  { key: 'SAIU_PARA_ENTREGA', label: 'Saiu para entrega' },
  { key: 'CONFIRMACAO_PAGAMENTO', label: 'Confirmação de pagamento' },
  { key: 'CONCLUIDO', label: 'Concluído' }
];

function columnOrders(key) {
  // derive column items from the already-filteredOrders to keep filters consistent
  try {
    return filteredOrders.value.filter((o) => {
      if (!o) return false;
      return (o.status || '').toUpperCase() === (key || '').toUpperCase();
    });
  } catch (e) {
    // fallback: if filteredOrders isn't ready for some reason, filter raw store.orders
    const nowTs = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    return store.orders.filter((o) => {
      if (!o) return false;
      if ((o.status || '').toUpperCase() !== (key || '').toUpperCase()) return false;
      if (selectedRider.value !== 'TODOS' && o.rider && String(o.rider.id) !== String(selectedRider.value)) return false;
      const created = getCreatedAt(o);
      if (created && (nowTs - created.getTime() > dayMs)) return false;
      return true;
    });
  }
}

function initDragAndDrop(){
  // remove any existing instances
  for (const s of sortableInstances) try { s.destroy() } catch(e) {}
  sortableInstances.length = 0;

  const groups = document.querySelectorAll('.orders-column .list');
  groups.forEach((el) => {
    const s = Sortable.create(el, {
      group: 'orders',
      animation: 150,
      handle: '.card-body',
      fallbackOnBody: true,
      swapThreshold: 0.65,
      onAdd: function (evt) {
        const li = evt.item;
        const orderId = li.dataset.orderId;
  const toCol = evt.to.closest('.orders-column')?.getAttribute('data-status');
        if(!orderId || !toCol) return;
        // find order
        const order = store.orders.find(o => o.id === orderId) || { id: orderId };
        // confirmation for moving to concluded or canceled
        // call changeStatus which already handles assign modal for SAIU_PARA_ENTREGA
        (async () => {
          // Prevent skipping CONFIRMACAO_PAGAMENTO: if moving directly from delivery -> concluded,
          // redirect to CONFIRMACAO_PAGAMENTO instead.
          const fromCol = evt.from.closest('.orders-column')?.getAttribute('data-status');
          let targetCol = toCol;
          if (fromCol === 'SAIU_PARA_ENTREGA' && toCol === 'CONCLUIDO') {
            targetCol = 'CONFIRMACAO_PAGAMENTO';
          }

          if (targetCol === 'CONCLUIDO'){
            const conf = await Swal.fire({ title: 'Marcar como concluído?', text: 'Deseja marcar este pedido como CONCLUÍDO?', icon: 'question', showCancelButton: true, confirmButtonText: 'Sim', cancelButtonText: 'Cancelar' })
            if(!conf.isConfirmed){ evt.from.insertBefore(li, evt.from.children[evt.oldIndex] || null); return }
          }
          if (toCol === 'CANCELADO'){
            const conf = await Swal.fire({ title: 'Cancelar pedido?', text: 'Tem certeza que deseja cancelar este pedido?', icon: 'warning', showCancelButton: true, confirmButtonText: 'Sim, cancelar', cancelButtonText: 'Manter' })
            if(!conf.isConfirmed){ evt.from.insertBefore(li, evt.from.children[evt.oldIndex] || null); return }
          }
          await changeStatus(order, targetCol);
        })();
      }
    });
    sortableInstances.push(s);
  });
}

function buildTimeline(o) {
  const created = parseDate(getCreatedAt(o));
  const histories = (o.histories || []).slice().sort((a, b) => parseDate(a.createdAt) - parseDate(b.createdAt));

  const entries = [];
  if (histories.length === 0) {
    // ensure start is a Date (fallback to now)
    entries.push({ status: o.status, start: created || new Date(), end: null });
    return entries;
  }

  // Determine initial start time: prefer order.createdAt, else first history.createdAt
  let prevStatus = histories[0].to || o.status;
  let prevTime = created || parseDate(histories[0].createdAt) || new Date();

  for (let i = 1; i < histories.length; i++) {
    const h = histories[i];
    const t = parseDate(h.createdAt) || new Date();
    entries.push({ status: prevStatus, start: prevTime, end: t });
    prevStatus = h.to;
    prevTime = t;
  }

  // last entry - until now
  entries.push({ status: prevStatus, start: prevTime, end: null });
  return entries;
}

// =============================
// 🧭 Ações de interface
// =============================
function logout() {
  auth.logout();
  location.href = '/login';
}

async function printReceipt(order) {
    try {
      const res = await printService.enqueuePrint(order);
      console.log(`🧾 Impressão solicitada manualmente: ${formatDisplay(order)}`, res);
      if (res && res.status === 'printed') {
        Swal.fire({ icon: 'success', title: 'Impressão realizada', text: `Comanda ${formatDisplay(order)} impressa com sucesso.`, timer: 2500, toast: true, position: 'top-end', showConfirmButton: false });
      } else if (res && res.status === 'queued') {
        Swal.fire({ icon: 'info', title: 'Pedido enfileirado', text: `Comanda ${formatDisplay(order)} foi enfileirada para impressão. Será processada em breve.`, timer: 3000, toast: true, position: 'top-end', showConfirmButton: false });
      } else {
        Swal.fire({ icon: 'warning', title: 'Solicitação enviada', text: `Comanda ${formatDisplay(order)} enviada para processamento.`, timer: 2500, toast: true, position: 'top-end', showConfirmButton: false });
      }
    } catch (err) {
    console.error("❌ Erro ao imprimir manualmente:", err);
    Swal.fire({ icon: 'error', title: 'Erro ao imprimir', text: 'Falha ao imprimir comanda. Verifique a conexão com o agente de impressão ou consulte o log.', timer: 4000, toast: true, position: 'top-end', showConfirmButton: false });
  }
}

// Abre uma pré-visualização da comanda em nova aba com texto pré-formatado
function escapeHtml(unsafe) {
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function viewReceipt(order) {
  try {
    // 1) generate ticket QR on the server so token is fresh/unique
    let qrDataUrl = null;
    try {
      const { data: t } = await api.post(`/orders/${order.id}/tickets`);
      if (t && t.qrUrl) {
        qrDataUrl = await QRCode.toDataURL(t.qrUrl, { width: 220, margin: 2 });
      }
    } catch (e) {
      // ignore ticket generation failure and fallback to no-QR preview
      console.warn('Falha ao gerar ticket/QR para pré-visualização', e);
    }

    // use printService's formatter when available
    const text = (printService && printService.formatOrderText) ? printService.formatOrderText(order) : null;
    const content = text || (`Comanda: ${formatDisplay(order)}\n\n` + JSON.stringify(order, null, 2));

    // show QR and receipt directly in a modal (no separate page)
    try {
      let modalHtml = '';
      modalHtml += `<div style="max-width:520px;margin:0 auto;text-align:left"><div style="white-space:pre-wrap;font-family:monospace;margin-bottom:12px">${escapeHtml(content)}</div>`;
      if (qrDataUrl) {
        modalHtml += `<div style="display:flex;justify-content:center;margin-top:6px"><img src="${qrDataUrl}" alt="QR do pedido" style="width:220px;height:220px;object-fit:contain;border:0;border-radius:8px"/></div>`;
        // small tip for riders explaining how to claim the order
        modalHtml += `<div style="margin-top:8px;padding:10px;border-radius:8px;background:#f8f9fa;border:1px solid #e9ecef;color:#333;font-size:13px;text-align:center;">`;
        modalHtml += `<strong>Como o motoboy deve proceder:</strong><br/>Abra o app "Painel do Motoboy" e toque em <em>Ler pedido (QR)</em>. Aponte a câmera para este QR; ao escanear, o pedido será atribuído a você automaticamente.`;
        modalHtml += `</div>`;
        modalHtml += `<div style="text-align:center;font-size:12px;color:#666;margin-top:6px">Escaneie para despachar</div>`;
      }
      modalHtml += `</div>`;

      await Swal.fire({
        title: `Comanda ${escapeHtml(formatDisplay(order))}`,
        html: modalHtml,
        width: Math.min(window.innerWidth - 40, 560),
        showCloseButton: true,
        confirmButtonText: 'Fechar',
        focusConfirm: false,
      });
    } catch (e) {
      console.warn('Falha ao abrir modal de visualização, tentando abrir em nova aba', e);
      const w = window.open('', '_blank');
      if (!w) {
        Swal.fire('Bloqueado', 'Não foi possível abrir a janela de visualização (bloqueador de popups).', 'warning');
        return;
      }
      let html = `<!doctype html><html><head><meta charset="utf-8"><title>Comanda ${escapeHtml(formatDisplay(order))}</title>
        <style>body{font-family:monospace;white-space:pre-wrap;padding:16px} .qr-wrap{display:flex;justify-content:center;margin-top:12px} .receipt-box{max-width:520px;margin:0 auto}</style></head><body><div class="receipt-box"><pre>${escapeHtml(content)}</pre>`;
      if (qrDataUrl) {
        html += `<div class="qr-wrap"><img src="${qrDataUrl}" alt="QR do pedido" style="width:180px;height:180px;object-fit:contain;border:0;" /></div><div style="text-align:center;font-size:12px;color:#666;margin-top:6px;">Escaneie para despachar</div>`;
      }
      html += `</div></body></html>`;
      w.document.open();
      w.document.write(html);
      w.document.close();
    }
  } catch (e) {
    console.error('Erro ao abrir pré-visualização da comanda', e);
    Swal.fire('Erro', 'Falha ao gerar pré-visualização da comanda.', 'error');
  }
}

// Dev helper: send a canned test order to the print service
async function sendTestPrint() {
  const testOrder = {
    id: `dev-test-${Date.now()}`,
    displaySimple: 'TT',
    customerName: 'Cliente Teste',
    address: 'Rua Exemplo, 123',
    items: [
      { name: 'Pizza Margherita', quantity: 1, unitPrice: 29.9 },
      { name: 'Coca-Cola 350ml', quantity: 1, unitPrice: 6.5 }
    ],
    total: 36.4,
  };

  try {
    await printService.enqueuePrint(testOrder);
    Swal.fire({ icon: 'success', title: 'Enviado', text: 'Comanda de teste enfileirada para impressão.', timer: 2000, toast: true, position: 'top-end', showConfirmButton: false });
    console.log('🧾 Test print enqueued', testOrder);
  } catch (e) {
    console.error('❌ Falha ao enfileirar teste de impressão', e);
    Swal.fire({ icon: 'error', title: 'Erro', text: 'Falha ao enfileirar teste de impressão. Veja console.', timer: 4000, toast: true, position: 'top-end', showConfirmButton: false });
  }
}

async function openAssignModal(order) {
  const riders = (await store.fetchRiders()) || [];
  const options = riders.reduce((acc, r) => {
    acc[r.id] = `${r.name} — ${r.whatsapp || 'sem WhatsApp'}`;
    return acc;
  }, {});

  const { value: riderId } = await Swal.fire({
    title: 'Escolher entregador',
    input: 'select',
    inputOptions: options,
    inputPlaceholder: 'Selecione um entregador',
    showCancelButton: true,
    confirmButtonText: 'Atribuir',
    cancelButtonText: 'Cancelar',
  });

  if (riderId) {
    await store.assignOrder(order.id, { riderId, alsoSetStatus: true });
    await store.fetch();
    Swal.fire('OK', 'Pedido atribuído e notificado via WhatsApp.', 'success');
    return;
  }

  const { value: phone } = await Swal.fire({
    title: 'WhatsApp do entregador',
    input: 'text',
    inputPlaceholder: '5599999999999',
    showCancelButton: true,
    confirmButtonText: 'Atribuir via WhatsApp',
  });

  if (phone) {
    await store.assignOrder(order.id, { riderPhone: phone, alsoSetStatus: true });
    await store.fetch();
    Swal.fire('OK', 'Pedido atribuído e notificado via WhatsApp.', 'success');
  }
}

async function changeStatus(order, to) {
  try {
    if (to === 'SAIU_PARA_ENTREGA') {
      await openAssignModal(order);
      return;
    }
    // If moving from payment confirmation to concluded, show payment confirmation modal
    if (to === 'CONCLUIDO' && order && order.status === 'CONFIRMACAO_PAGAMENTO') {
      // Allow multiple payment methods with editable amounts.
      const orderTotal = Number(order.total || 0);
      const methods = (companyPaymentMethods.value && companyPaymentMethods.value.length) ? companyPaymentMethods.value : [{ code: 'CASH', name: 'Dinheiro' }];
      const pmOptionsHtml = methods.map(m => `<option value="${(m.code||m.name)}">${(m.name||m.code)}</option>`).join('');

      const html = `<div id="swal-pay-vue"></div>`;

      let vuePayApp = null;
      let mountedPayApp = null;

      const result = await Swal.fire({
        title: 'Confirmar pagamento',
        html,
        showCancelButton: true,
        focusConfirm: false,
        confirmButtonText: 'Confirmar',
        didOpen: () => {
          // mount a small Vue app to manage dynamic payment rows with CurrencyInput
          const App = {
            components: { CurrencyInput },
            data() {
              return {
                methods: methods,
                rows: [ { method: (methods[0] && (methods[0].code||methods[0].name)) || '', amount: orderTotal } ]
              };
            },
            methods: {
              add() { this.rows.push({ method: (this.methods[0] && (this.methods[0].code||this.methods[0].name)) || '', amount: 0 }); },
              remove(i) { this.rows.splice(i,1); },
              sum() { return this.rows.reduce((s,r) => s + (Number(r.amount)||0), 0); },
              remaining() { return Math.max(0, orderTotal - this.sum()); },
              formatCurrency
            },
            render() {
              const vm = this;
              return h('div', { style: 'text-align:left' }, [
                h('div', { style: 'margin-bottom:8px' }, [ h('strong', 'Pendente:'), ' ', h('span', vm.formatCurrency(vm.remaining())) ]),
                h('div', vm.rows.map((r, idx) => h('div', { key: idx, class: 'pay-row', style: 'display:flex;gap:8px;margin-bottom:8px;align-items:center' }, [
                  h('select', { class: 'form-select', style: 'flex:1', value: r.method, onInput: (e) => { vm.rows[idx].method = e.target.value } }, vm.methods.map(m => h('option', { value: (m.code||m.name) }, m.name || m.code))),
                  h(CurrencyInput, { modelValue: r.amount, 'onUpdate:modelValue': v => { vm.rows[idx].amount = v }, inputClass: 'form-control', style: 'width:120px' }),
                  h('button', { type: 'button', class: 'btn btn-sm btn-outline-danger', title: 'Remover', style: 'height:32px;padding:4px 8px', onClick: (e) => { e.preventDefault(); vm.remove(idx); } }, '×')
                ]))),
                h('div', { style: 'margin-top:8px' }, [ h('button', { type: 'button', class: 'btn btn-sm btn-secondary', onClick: (e) => { e.preventDefault(); vm.add(); } }, 'Adicionar forma') ])
              ]);
            }
          };

          try {
            const appRef = createApp(App);
            vuePayApp = appRef.mount('#swal-pay-vue');
            mountedPayApp = appRef;
          } catch (e) {
            console.error('Failed to mount payment Vue app inside Swal modal', e);
          }
        },
        preConfirm: () => {
          // collect values from mounted app
          const payments = [];
          let sum = 0;
          if (vuePayApp && vuePayApp.rows) {
            for (const r of vuePayApp.rows) {
              const method = r.method || null;
              const amount = Number(r.amount || 0);
              if (!method || !amount) continue;
              payments.push({ method, amount });
              sum += amount;
            }
          }
          if (payments.length === 0) {
            Swal.showValidationMessage('Informe ao menos uma forma de pagamento com valor.');
            return false;
          }
          if (sum > orderTotal + 0.001) {
            Swal.showValidationMessage('O total informado nas formas não pode ser maior que o total da comanda.');
            return false;
          }
          if (sum + 0.001 < orderTotal) {
            const remaining = Math.max(0, orderTotal - sum);
            Swal.showValidationMessage(`Ainda há ${formatCurrency(remaining)} pendente.`);
            return false;
          }
          return { payments };
        }
      });

      // unmount temporary Vue app if mounted
      try { if (mountedPayApp) mountedPayApp.unmount(); } catch (e) {}

      if (!result || result.isDismissed) return;
      const payments = (result.value && result.value.payments) || [];
      loading.value = true;
      await store.updateStatus(order.id, to, { payments });
      await store.fetch();
      return;
    }
    loading.value = true;
    await store.updateStatus(order.id, to);
    await store.fetch();
  } catch (e) {
    console.error(e);
    Swal.fire('Erro', 'Falha ao atualizar status.', 'error');
  } finally {
    loading.value = false;
  }
}

const statusActions = [
  { to: 'EM_PREPARO', label: 'Em preparo' },
  { to: 'SAIU_PARA_ENTREGA', label: 'Saiu p/ entrega' },
  { to: 'CONFIRMACAO_PAGAMENTO', label: 'Confirmação de pagamento' },
  { to: 'CONCLUIDO', label: 'Concluído' },
  { to: 'CANCELADO', label: 'Cancelar' },
];

const statusFilters = [
  { value: 'TODOS', label: 'Todos', color: 'secondary' },
  { value: 'EM_PREPARO', label: 'Em preparo', color: 'warning' },
  { value: 'SAIU_PARA_ENTREGA', label: 'Saiu p/ entrega', color: 'primary' },
  { value: 'CONFIRMACAO_PAGAMENTO', label: 'Confirmação de pagamento', color: 'info' },
  { value: 'CONCLUIDO', label: 'Concluído', color: 'success' },
  { value: 'CANCELADO', label: 'Cancelado', color: 'danger' },
  { value: 'INVOICE_AUTHORIZED', label: 'NFC-e aut.', color: 'info' },
];

// predefined WhatsApp messages for riders (placeholders — will be replaced later)
const riderWhatsAppMessages = {
  'msg1': 'Olá, seu pedido está a caminho.',
  'msg2': 'Olá, precisa de ajuda com o pedido?',
  'msg3': 'Pedido entregue. Obrigado!'
};

async function openWhatsAppToRider(order) {
  if (!order || !order.rider) {
    Swal.fire('Sem entregador', 'Este pedido não possui entregador atribuído.', 'info');
    return;
  }
  const phone = order.rider.whatsapp || order.rider.phone || order.rider.mobile;
  const opts = {};
  Object.keys(riderWhatsAppMessages).forEach((k) => { opts[k] = riderWhatsAppMessages[k]; });
  // build html with buttons for preview
  const choicesHtml = Object.keys(riderWhatsAppMessages).map(k => {
    const txt = String(riderWhatsAppMessages[k]).replace(/</g, '&lt;').replace(/>/g, '&gt;');
    // button full width, text aligned left so preview is easier to read
    return `<button type="button" data-key="${k}" data-txt="${encodeURIComponent(String(riderWhatsAppMessages[k]))}" class="wa-choose btn btn-outline-primary w-100 text-start mb-2">${txt}</button>`;
  }).join('');

  const html = `
    <div class="wa-choices">
      <div class="mb-2 small text-muted">Escolha uma mensagem:</div>
      <div id="wa_preview" class="wa-preview mb-2 small text-muted">(nenhuma mensagem selecionada)</div>
      <div>${choicesHtml}</div>
      <input type="hidden" id="wa_selected" />
    </div>
  `;

  const result = await Swal.fire({
    title: 'Enviar WhatsApp para ' + (order.rider.name || 'entregador'),
    html,
    showCancelButton: true,
    confirmButtonText: 'Enviar',
    focusConfirm: false,
    preConfirm: () => {
      const v = document.getElementById('wa_selected')?.value;
      if (!v) {
        Swal.showValidationMessage('Selecione uma mensagem');
      }
      return v;
    },
    didOpen: () => {
      const popup = Swal.getPopup();
      if (!popup) return;
      popup.querySelectorAll('.wa-choose').forEach((btn) => {
        btn.addEventListener('click', (ev) => {
          // mark selection
          popup.querySelectorAll('.wa-choose').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          const key = btn.getAttribute('data-key');
          const hid = popup.querySelector('#wa_selected');
          if (hid) hid.value = key;
          // update preview area with original text (decoded)
          const raw = btn.getAttribute('data-txt') || '';
          const decoded = decodeURIComponent(raw);
          const preview = popup.querySelector('#wa_preview');
          if (preview) preview.innerText = decoded;
        });
      });
    }
  });

  if (!result || !result.isConfirmed) return;
  const value = result.value;
  const text = riderWhatsAppMessages[value] || '';
  if (!phone) {
    Swal.fire('Sem número', 'O entregador não possui número de WhatsApp cadastrado.', 'warning');
    return;
  }
  // open WhatsApp Web with prefilled message
  const cleaned = String(phone).replace(/[^0-9]/g, '');
  const url = `https://wa.me/${encodeURIComponent(cleaned)}?text=${encodeURIComponent(text)}`;
  window.open(url, '_blank');
}

// =============================
// 🔊 Controle visual do botão de som (pulse)
// =============================
const soundButton = ref(null);

function toggleSound() {
  playSound.value = !playSound.value;
}

function openPdv(){
  try{
    pdvPreset.value = null;
  }catch(e){}
  showPdv.value = true;
}

function openBalcao(){
  // preset: client name 'Balcão', order type RETIRADA and skip address collection
  pdvPreset.value = { customerName: 'Balcão', orderType: 'RETIRADA', skipAddress: true };
  newOrderPhone.value = '';
  showPdv.value = true;
}

function handlePdvVisibleChange(v){
  if(!v){
    try{ newOrderPhone.value = ''; }catch(e){}
    try{ pdvPreset.value = null; }catch(e){}
  }
}

function onPdvCreated(created){
  try {
    if(!created) return;
    // Avoid duplicate insertion: the server also emits `novo-pedido` via socket.
    const exists = store.orders.find(o => o && o.id === created.id);
    if (exists) {
      // If already present, replace/update it to ensure latest data
      const idx = store.orders.findIndex(o => o && o.id === created.id);
      if (idx !== -1) {
        try { delete created._normalized; } catch(e){}
        store.orders.splice(idx, 1, created);
      }
    } else {
      try { created._isNew = true; } catch(e){}
      store.orders.unshift(created);
      setTimeout(()=>{ try{ created._isNew=false }catch(e){} },900);
    }
  } catch(e){ console.warn('Falha ao inserir pedido PDV localmente', e); }
  // close wizard after creation
  showPdv.value = false;
}

function pulseButton() {
  if (!soundButton.value) return;
  soundButton.value.classList.add('btn-pulse');
  setTimeout(() => soundButton.value?.classList.remove('btn-pulse'), 800);
}

// duplicate real-time handler removed (handled inside onMounted)

</script>

<template>
  <div>
  <div class="container-fluid p-4">
    <header class="d-flex flex-wrap align-items-center justify-content-between mb-4 gap-3">
      <div class="d-flex align-items-center">
        <h2 class="fs-4 fw-semibold m-0">Pedidos</h2>
        <!-- dev-only socket status badge -->
        <span v-if="socketConnection" class="ms-3 badge" :class="{
          'bg-success': socketConnection.status === 'connected',
          'bg-warning text-dark': socketConnection.status === 'reconnecting',
          'bg-danger': socketConnection.status === 'error' || socketConnection.status === 'disconnected',
          'bg-secondary': socketConnection.status === 'connecting' || socketConnection.status === 'idle'
        }">
          {{ 'Socket: ' + socketStatusLabel }}
          <small v-if="socketConnection.url" class="d-block text-truncate" style="max-width:200px;">{{ socketConnection.url.replace(/^https?:\/\//, '') }}</small>
        </span>
      </div>
      <PrinterWatcher />
      <PrinterStatus />
      <!-- Dev: quick test print button -->
      <div class="ms-2 d-flex gap-2 align-items-center">
        
        <!-- 🔊 Botão de som -->
        <button
          ref="soundButton"
          type="button"
          class="btn btn-sm"
          :class="playSound ? 'btn-primary' : 'btn-outline-secondary'"
          @click="toggleSound"
          title="Som de novos pedidos"
        >
          <i
            :class="playSound ? 'bi bi-volume-up-fill' : 'bi bi-volume-mute-fill'"
            class=""
          ></i>
        </button>

        <button type="button" class="btn btn-sm btn-outline-primary" @click="showPrinterConfig = true" title="Configurar impressora">
          <i class="bi bi-gear"></i>&nbsp;Configurar Impressora
        </button>
        <button type="button" class="btn btn-sm btn-outline-primary" @click="sendTestPrint" title="Enviar comanda de teste">
          <i class="bi bi-printer"></i>&nbsp;Teste Impressão
        </button>
        <CashControl />
      </div>
    </header>
    <PrinterConfig v-model:visible="showPrinterConfig" @saved="onPrinterSaved" />
    <POSOrderWizard v-model:visible="showPdv" :initialPhone="newOrderPhone" :preset="pdvPreset" @created="onPdvCreated" @update:visible="handlePdvVisibleChange" />

        <div class="row">
          <div class="col-sm-6">
              <div class="card mb-4" style="border:none;">
      <div class="card-body">
        <div class="d-flex align-items-center justify-content-between">
          <div>
            <h5 class="card-title mb-1">
             Novo Pedido
            </h5>
            
          </div>
        </div>
        <div class="d-flex gap-2 align-items-center">
         
          <div class="flex-grow-1" style="max-width: 500px;">
            <TextInput v-model="newOrderPhone" placeholder="Digite o telefone do cliente e comece um novo pedido." inputClass="form-control" />
          </div>
          <button type="button" class="btn btn-success" @click="openPdv">
            <i class="bi bi-arrow-right-circle"></i>
            Criar Pedido
          </button>

           <button type="button" class="btn btn-outline-secondary ms-2" @click="openBalcao" title="Pedido balcão">
            <i class="bi bi-shop"></i>
            &nbsp;Pedido balcão
          </button>
          
        </div>
        </div>
      </div>
    </div>

          <div class="col-sm-6">

              <div
      class="filters-bar card d-flex flex-wrap justify-content-between gap-3 mb-4" style="border:none;"
    >
    <div class="card-body">
      <div class="d-flex align-items-center justify-content-between">
          <div>
            <h5 class="card-title mb-1">
             Procurar pedido
            </h5>
            
          </div>
        </div>
  <!-- Filtros de status (visível apenas em dispositivos pequenos) -->
  <div class="btn-group flex-wrap d-flex d-md-none">
        <button
          v-for="s in statusFiltersMobile"
          :key="s.value"
          type="button"
          class="btn"
          :class="[
            selectedStatus === s.value ? `btn-${s.color}` : 'btn-outline-secondary',
          ]"
          @click="selectedStatus = s.value"
        >
          {{ s.label }}
        </button>
      </div>

      <!-- Filtros adicionais -->
      <div class="d-flex align-items-center gap-2">
        <SelectInput 
           v-model="selectedRider" 
          class="form-select form-select"
          style="min-width: 200px;"
        >
          <option value="TODOS">Todos os entregadores</option>
          <!-- normalize option values to strings to avoid type-mismatch when comparing ids -->
          <option v-for="r in store.riders" :key="r.id" :value="String(r.id)">
            {{ r.name }}
          </option>
        </SelectInput>

        <TextInput v-model="searchOrderNumber" placeholder="Nº pedido" inputClass="form-control form-control" />
        <TextInput v-model="searchCustomerName" placeholder="Nome do cliente" inputClass="form-control form-control" />

      </div>
    </div>
    
          </div>
          </div>
      
    </div>
    <!-- 🔍 Filtros + Som -->
    
    <!-- Orders board: columns with drag & drop -->
    <div v-if="store.orders && store.orders.length > 0" class="orders-board">
      <div class="boards d-flex gap-3 overflow-auto py-2">
        <div class="orders-column card" v-for="col in (isMobile ? COLUMNS.filter(c => c.key === selectedStatus) : COLUMNS)" :key="col.key" :data-status="col.key">
          <div class="card-header d-flex align-items-center justify-content-between">
            <div class="fw-semibold">{{ col.label }}</div>
            <div><span class="badge bg-secondary">{{ columnOrders(col.key).length }}</span></div>
          </div>
          <div class="list mt-2  p-2" style="min-height:120px">
            <div v-for="o in columnOrders(col.key)" :key="o.id" class="card mb-2 order-card" :class="{ 'fade-in': o._isNew }" :data-order-id="o.id">
              <div class="card-body p-2 d-flex align-items-start gap-2">
                <div class="flex-grow-1">
                  <div class="d-flex align-items-center justify-content-between">
                    <div class="w-100">
                          <div class="topOrder w-100 d-flex   align-items-center justify-content-between">
                            <div class="fw-semibold">#{{ formatDisplay(o) }} — {{ o.customerName || 'Cliente' }}</div>
                            <div class="storeName">
                               <div class="small text-muted">
                  {{ normalizeOrder(o).storeName ? (normalizeOrder(o).storeName + (normalizeOrder(o).channelLabel ? ' | ' + normalizeOrder(o).channelLabel : '')) : (normalizeOrder(o).channelLabel ? normalizeOrder(o).channelLabel : '—') }}
                </div>
                            </div>
                          </div>
                          <div class="text-muted small">{{ o.customerPhone || '' }}</div>
                          <div class="small text-muted mt-1 d-flex align-items-center">
                            <i class="bi bi-credit-card me-1"></i>
                            <span>
                              {{ normalizeOrder(o).paymentMethod }}
                              <span v-if="normalizeOrder(o).paymentChange" class="ms-2 text-muted">• Troco: {{ formatCurrency(normalizeOrder(o).paymentChange) }}</span>
                            </span>
                          </div>
                          <div class="mt-1 small text-muted d-flex align-items-center">
                            <i class="bi bi-person-badge me-1"></i>
                            <span v-if="o.rider">{{ o.rider.name }}</span>
                            <span v-else class="text-muted">—</span>
                            <button v-if="o.rider" class="btn btn-sm btn-link p-0 ms-2" @click.stop="openWhatsAppToRider(o)" title="WhatsApp do entregador">
                              <i class="bi bi-whatsapp text-success"></i>
                            </button>
                          </div>
                    </div>
                    <!-- status badge removed from card; column header indicates status -->
                  </div>
                  <div class="small text-muted mt-1">{{ normalizeOrder(o).address || '-' }}</div>
                  <div class="d-flex justify-content-between align-items-center mt-2">
                    <div class="small text-muted">{{ getCreatedDurationDisplay(o) }}</div>
                    <div class="fw-semibold text-success">{{ formatCurrency(computeDisplayedTotal(o)) }}</div>
                  </div>
                </div>
              </div>
              <div class="card-footer bg-transparent p-1 d-flex justify-content-between align-items-center">
                <div>
                        <button class="btn btn-sm btn-outline-secondary" @click="toggleTimeline(o.id)">Detalhes</button>
                </div>
               
                <div>
                  <button class="btn btn-sm btn-outline-secondary me-1" @click="viewReceipt(o)" title="Visualizar comanda"><i class="bi bi-eye"></i></button>
                  <button class="btn btn-sm btn-light me-1" @click="printReceipt(o)" title="Imprimir comanda"><i class="bi bi-printer"></i></button>
                  <button class="btn btn-sm btn-primary me-1" @click="advanceStatus(o)" :disabled="!getNextStatus(o.status) || !store.canTransition(o.status, getNextStatus(o.status)) || loading" title="Avançar status">
                    <i class="bi bi-arrow-right"></i>
                  </button>
                  
                </div>
              </div>
              <div v-if="openTimeline[o.id]" class="p-2 bg-light small border-top">
                <div class="fw-semibold">Itens</div>
                <ul class="mb-1">
                  <li v-for="it in normalizeOrderItems(o)" :key="it.id + it.name">
                    <div class="fw-semibold">{{ it.quantity || 1 }}x {{ it.name }} <span class="text-success ms-2">{{ formatCurrency(it.unitPrice || 0) }}</span></div>
                    <div v-if="extractItemOptions(it).length" class="small text-muted ms-3 mt-1">
                      <div v-for="(opt, idx) in extractItemOptions(it)" :key="(opt.name || idx) + idx">
                        <span v-if="opt.quantity">{{ opt.quantity }}x&nbsp;</span>{{ opt.name }}<span v-if="opt.price"> — {{ formatCurrency(opt.price) }}</span>
                      </div>
                    </div>
                  </li>
                </ul>
                <div v-if="normalizeOrder(o).couponCode || normalizeOrder(o).couponDiscount" class="mt-2 small">
                  <div v-if="normalizeOrder(o).couponCode"><strong>Cupom:</strong> {{ normalizeOrder(o).couponCode }}</div>
                  <div v-if="normalizeOrder(o).couponDiscount"><strong>Desconto:</strong> -{{ formatCurrency(normalizeOrder(o).couponDiscount) }}</div>
                </div>
                <div v-if="normalizeOrder(o).paymentChange" class="mt-2 small">
                  <strong>Troco:</strong> {{ formatCurrency(normalizeOrder(o).paymentChange) }}
                </div>
                <div v-if="getOrderNotes(o)" class="text-muted mt-2">{{ getOrderNotes(o) }}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div v-else class="text-center text-secondary py-5">
      <i class="bi bi-bag-x fs-1 d-block mb-2"></i>
      <p class="mb-0">Nenhum pedido encontrado.</p>
    </div>
    </div>
  </div>
</template>

<style scoped>
/* 🔄 Animação de "pulse" do botão de som */
@keyframes pulse {
  0% {
    transform: scale(1);
    box-shadow: 0 0 0 0 rgba(13, 110, 253, 0.4);
  }
  50% {
    transform: scale(1.08);
    box-shadow: 0 0 8px 4px rgba(13, 110, 253, 0.2);
  }
  100% {
    transform: scale(1);
    box-shadow: 0 0 0 0 rgba(13, 110, 253, 0);
  }
}

.btn-pulse {
  animation: pulse 0.8s ease;
}

/* Fade-in para novos pedidos */
@keyframes fadeInCard {
  from { opacity: 0; transform: translateY(-8px); }
  to { opacity: 1; transform: translateY(0); }
}

.fade-in {
  animation: fadeInCard 0.9s ease forwards;
}

/* Boards layout */
.orders-board .boards { padding: 8px 0; }
.orders-column {background-color: #E6E6E6; flex: 0 0 23.5%; }
.orders-column .list { max-height: 70vh; overflow:auto; }
.orders-column .card-header {
  background: #FFF;
  border: none;
}
.order-card { border: none;}
.orders-column .card-body { cursor: grab; }

/* responsive: horizontal scroll on small screens */
@media (max-width: 768px) {
  .orders-column { min-width: 260px; flex: 0 0 260px; }
  .orders-board .boards { padding-bottom: 12px; }
}

/* SweetAlert WA chooser styles */
.wa-choices .wa-preview {
  background: #fff;
  border: 1px solid #e9ecef;
  padding: 8px;
  border-radius: 6px;
  min-height: 44px;
  white-space: pre-wrap; /* preserve line breaks */
}
.wa-choose.active {
  background-color: #0d6efd !important;
  color: #fff !important;
}
.wa-choose { text-align: left; }
.order-card .card-body .small {
  font-size: 0.65rem;
}
</style>