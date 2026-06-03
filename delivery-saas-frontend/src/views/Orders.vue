<script setup>
import { onMounted, ref, computed, onUnmounted, nextTick, watch } from 'vue';
import { normalizeOrderItems, storeRevenue, changeDue } from '../utils/orderUtils.js';
import { useOrdersStore } from '../stores/orders';
import { useAuthStore } from '../stores/auth';
import { useCustomersStore } from '../stores/customers';
import { useRouter } from 'vue-router';
import Swal from 'sweetalert2';
import { io } from 'socket.io-client';
import 'sweetalert2/dist/sweetalert2.min.css';
import printService from "../services/printService.js";
import { useModulesStore } from '../stores/modules.js';
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
import OrderTicketPreview from '../components/OrderTicketPreview.vue';
import CurrencyInput from '../components/form/input/CurrencyInput.vue';
import { bindLoading } from '../state/globalLoading.js';
import Sortable from 'sortablejs';
import ListGroup from '../components/form/list-group/ListGroup.vue';
const store = useOrdersStore();
const auth = useAuthStore();
const customersStore = useCustomersStore();
const modules = useModulesStore();
const router = useRouter();

// helper para formatar displayId com dois dígitos e garantir consistência
function padNumber(n) {
  if (n == null || n === '') return null;
  return String(n).toString().padStart(2, '0');
}

const tierColors = {
  em_risco: '#dc3545',
  regular: '#ffc107',
  fiel: '#0d6efd',
  vip: '#198754',
  novo: '#0d6efd',
};

const tierBgColors = {
  em_risco: 'rgba(220,53,69,0.1)',
  regular: 'rgba(255,193,7,0.1)',
  fiel: 'rgba(13,110,253,0.1)',
  vip: 'rgba(25,135,84,0.1)',
  novo: 'rgba(13,110,253,0.06)',
};

function starsHtml(stars) {
  try { return '★'.repeat(stars||0) + '☆'.repeat(Math.max(0, 4 - (stars||0))); } catch(e) { return ''; }
}

function getCustomerStats(o) {
  try {
    if (!o) return null;
    // try direct customer id first
    const cid = o.customerId || o.customer?.id || o.customerIdString || null;
    if (cid) {
      const found = (customersStore.list || []).find(c => String(c.id) === String(cid));
      if (found && found.stats) return found.stats;
    }
    // try by phone
    const phone = (o.customerPhone || o.contact || o.payload?.customer?.phone || '').replace(/\D/g,'');
    if (phone) {
      const found = (customersStore.list || []).find(c => (c.whatsapp||c.phone||'').replace(/\D/g,'') === phone);
      if (found && found.stats) return found.stats;
    }
    // fallback by exact name match
    const name = (o.customerName || o.name || '').trim();
    if (name) {
      const found = (customersStore.list || []).find(c => (c.fullName||'').trim() === name);
      if (found && found.stats) return found.stats;
    }
    return null;
  } catch (e) { return null; }
}

// iFood Widget
const ifoodMerchantIds = ref([]);

// One-time listener that swallows the "No plugins has been initialized"
// (and similar buildFeatureEvent / minified `JSWq.l.*`) exceptions thrown
// from the iFood widget's own bundle (vendor.<hash>.esm.js, etc.). These
// fire async during widget bootstrap and bypass the script.onload
// try/catch — without this, every Orders page load logs a confusing red
// stack trace operators can't act on.
let ifoodErrorListenerInstalled = false;
function installIfoodErrorSwallower() {
  if (ifoodErrorListenerInstalled || typeof window === 'undefined') return;
  ifoodErrorListenerInstalled = true;
  window.addEventListener('error', (ev) => {
    const src = ev?.filename || ev?.target?.src || '';
    const msg = String(ev?.message || ev?.error?.message || '');
    const fromIfood = /widgets?\.ifood\.com\.br|\b(vendor|main|runtime)\.[a-f0-9]{12,20}\.esm\.js\b/.test(src);
    const matchesKnownMsg = /No plugins has been initialized|buildFeatureEvent/i.test(msg);
    if (fromIfood || (matchesKnownMsg && /esm\.js/.test(src))) {
      ev.preventDefault();
      ev.stopImmediatePropagation?.();
      console.warn('[ifood-widget] swallowed runtime error from widget bundle:', msg || ev);
    }
  }, true);
  window.addEventListener('unhandledrejection', (ev) => {
    const msg = String(ev?.reason?.message || ev?.reason || '');
    if (/No plugins has been initialized|buildFeatureEvent/i.test(msg)) {
      ev.preventDefault();
      console.warn('[ifood-widget] swallowed unhandled rejection from widget bundle:', msg);
    }
  });
}

function initIfoodWidget(merchantIds) {
  if (!merchantIds.length) return;
  installIfoodErrorSwallower();
  // remove any previous widget script
  const prev = document.getElementById('ifood-widget-script');
  if (prev) prev.remove();
  const script = document.createElement('script');
  script.id = 'ifood-widget-script';
  script.async = true;
  script.src = 'https://widgets.ifood.com.br/widget.js';
  // The widget bundle is webpack-built (vendor.<hash>.esm.js, etc.) and
  // throws "No plugins has been initialized" from buildFeatureEvent when
  // the merchantId is invalid or iFood's auth refused the embed. The error
  // bubbles up as an unhandled exception at page load and pollutes the
  // console. Swallow it locally — the widget either renders or it doesn't,
  // and our app's main flow (orders, riders, inbox) doesn't depend on it.
  script.onerror = (e) => {
    console.warn('[ifood-widget] script failed to load', e);
  };
  script.onload = () => {
    try {
      if (window.iFoodWidget && typeof window.iFoodWidget.init === 'function') {
        window.iFoodWidget.init({
          widgetId: '4314164a-666f-4032-b02a-9681ac7034d4',
          merchantIds,
        });
      }
    } catch (e) {
      console.warn('[ifood-widget] init failed', e);
    }
  };
  document.head.appendChild(script);
}

function destroyIfoodWidget() {
  const script = document.getElementById('ifood-widget-script');
  if (script) script.remove();
  // remove widget container and any other elements injected by the iFood script
  const container = document.getElementById('ifood-widget-container');
  if (container) container.remove();
  // iFood widget may inject iframes or divs with dynamic ids — remove any leftovers
  document.querySelectorAll('[id*="ifood-widget"], [class*="ifood-widget"], iframe[src*="ifood"]').forEach(el => el.remove());
  // clean up global reference so re-init works on next mount
  try { delete window.iFoodWidget; } catch (e) {}
}

function isIfoodOrder(o) {
  if (!o) return false;
  return (
    o.payload?.provider === 'IFOOD' ||
    o.payload?.order?.salesChannel === 'IFOOD' ||
    o.payload?.salesChannel === 'IFOOD' ||
    Boolean(o.payload?.order?.merchant || o.payload?.merchant)
  );
}

function hasCustomerWhatsApp(o) {
  if (!o) return false;
  const w = o.customer?.whatsapp;
  return !!(w && w.replace(/\D/g, '').length >= 10);
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
const selectedPaymentMethod = ref('TODOS');
const isMobile = ref(typeof window !== 'undefined' ? window.innerWidth < 768 : false);
const companyPaymentMethods = ref([]);
const ifoodPaymentMap = ref({}); // { CASH: 'Dinheiro', CREDIT: 'Visa Crédito', ... }
const statusFiltersMobile = computed(() => statusFilters.filter(s => s.value !== 'TODOS'));
// extra filters
const searchOrderNumber = ref('');
const searchCustomerName = ref('');
const filterEntrega = ref(true);
const filterRetirada = ref(true);
// Collapsible advanced filters on mobile (Chefiz Pedidos Mobile pattern):
// Entrega/Retirada toggles + the "Filtros" button stay visible; rider /
// payment / Nº pedido / Nome cliente collapse behind it.
const showAdvancedFilters = ref(false);
const activeAdvancedFiltersCount = computed(() => {
  let n = 0;
  if (selectedRider.value && selectedRider.value !== 'TODOS') n++;
  if (selectedPaymentMethod.value && selectedPaymentMethod.value !== 'TODOS') n++;
  if (searchOrderNumber.value && searchOrderNumber.value.trim()) n++;
  if (searchCustomerName.value && searchCustomerName.value.trim()) n++;
  return n;
});
let audio = null;
const now = ref(Date.now());
// connection state for a dev-friendly badge (moved to module scope so computed can access it)
const connectionState = ref({ status: 'idle', since: Date.now(), url: null });
const showPrinterConfig = ref(false);
// printer connectivity state for UI
const printerConnected = ref(false);
async function updatePrinterConnected(){
  try{
    if(printService && printService.checkConnectivity) {
      const ok = await printService.checkConnectivity();
      printerConnected.value = !!ok;
    } else {
      printerConnected.value = !!(printService && printService.isConnected && printService.isConnected());
    }
  }catch(e){ printerConnected.value = false }
}
// compute module gating flags
const printingEnabled = computed(() => modules.has('printing'));
const ridersEnabled = computed(() => {
  return modules.has('riders') || modules.has('rider') || modules.has('delivery') || modules.has('entregadores') || modules.has('motoboy') || modules.has('motoboys')
});
// Distinct payment methods from current orders for the filter dropdown
const availablePaymentMethods = computed(() => {
  const set = new Set();
  for (const o of store.orders) {
    const n = o._normalized || normalizeOrder(o);
    const pm = n.paymentMethod;
    if (pm && pm !== '—') set.add(pm);
  }
  return Array.from(set).sort();
});
const showPdv = ref(false);
const newOrderPhone = ref('');
const pdvPreset = ref(null);

// atualiza 'now' a cada 30s para que durações sejam atualizadas na interface
let nowTimer = null;
let resizeHandler = null;
let printerCheckInterval = null;

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
  // load enabled modules for this company to gate features
  try { await modules.fetchEnabled(); } catch (e) { /* ignore */ }

  // initialize printer connectivity state for the UI
  try { await updatePrinterConnected(); } catch(e){}
  try { printerCheckInterval = setInterval(() => { updatePrinterConnected().catch(()=>{}); }, 30000); } catch(e){}

  // If this is a SaaS Super Admin session, do not initialize restaurant listeners or fetching —
  // redirect the admin to the SaaS dashboard instead.
  try {
    if (auth.user && ['SUPER_ADMIN', 'MASTER'].includes(String(auth.user.role || '').toUpperCase())) {
      try { console.log('SUPER_ADMIN/MASTER detected — skipping Orders listeners and redirecting to /saas'); } catch(e){}
      try { router.replace('/saas'); } catch(e){}
      return;
    }

  } catch (e) { /* ignore detection errors */ }

  try {
    await store.fetch();
    checkCashSession();
    // ensure store names are hydrated when backend omitted the relation
    await hydrateMissingStores();
    if (ridersEnabled.value) await store.fetchRiders();
    // fetch customers list if empty so we can show customer classification badges
    try { if (!customersStore.list || customersStore.list.length === 0) { customersStore.fetch().catch(()=>{}); } } catch(e) {}
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
    // load iFood payment mappings (from all integrations)
    try {
      const integRes = await api.get('/integrations/ifood');
      const integs = Array.isArray(integRes.data) ? integRes.data : (integRes.data ? [integRes.data] : []);
      for (const integ of integs) {
        try {
          const mapRes = await api.get(`/integrations/ifood/${integ.id}/payment-mappings`);
          for (const m of (mapRes.data || [])) {
            if (m.systemName) ifoodPaymentMap.value[m.ifoodCode] = m.systemName;
          }
        } catch (e) { /* ignore per-integration errors */ }
      }
      // init iFood Widget with merchant UUIDs from loaded integrations.
      // Skip integrations that aren't enabled — the widget logs noisy
      // "No plugins has been initialized" errors when the merchant lookup
      // fails (e.g., disabled integration with stale merchant id).
      const ids = integs
        .filter(i => i.enabled !== false)
        .map(i => i.merchantUuid || i.merchantId)
        .filter(Boolean);
      ifoodMerchantIds.value = ids;
      initIfoodWidget(ids);
    } catch (e) { /* ignore */ }
  } catch (e) {
    console.error(e);
    const msg = ridersEnabled.value ? 'Falha ao carregar pedidos/entregadores.' : 'Falha ao carregar pedidos.';
    Swal.fire('Erro', msg, 'error');
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
  try { window.addEventListener('cash-session-opened', onCashSessionOpened); } catch (e) {}

  socket.value.on('cash-session-changed', (data) => {
    console.debug('[socket] cash-session-changed', data);
    checkCashSession();
    if (data?.type === 'orders-linked' || data?.type === 'closed') {
      store.fetch();
    }
  });

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
        if (printingEnabled.value && (route === 'agent' || route === 'qz' || route == null)) {
          await printService.enqueuePrint(full);
          console.log(`🖨️ Impressão automática (frontend->agent) enviada: ${formatDisplay(full)}`);
        } else {
          console.log(`🖨️ Frontend print skipped (module printing disabled or route=${route}).`);
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
          updated = { id, status: payload.status || payload.statusName, ...(payload.closedByIfoodCode ? { closedByIfoodCode: true } : {}) };
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

      // status change – no sound/alert needed; only new orders should notify
    } catch (e) {
      console.warn('Erro ao processar evento de pedido atualizado', e);
    }
  }

  // Register many common event names emitted by backend/integrations
  const orderUpdateEvents = ['pedido-atualizado', 'order-updated', 'order:updated', 'order-status-changed', 'pedido-status', 'update-order'];
  orderUpdateEvents.forEach(ev => socket.value.on(ev, (p) => handleOrderUpdateEvent(p, ev)));

  // Listen for iFood negotiation events (consumer cancellation requests)
  socket.value.on('ifood-negotiation', async (data) => {
    try {
      console.log('[ifood-negotiation] event received:', data);
      if (data.type === 'CONSUMER_CANCELLATION_REQUESTED') {
        beep();
        const display = data.displayId || (data.externalId ? data.externalId.slice(0, 8) : '??');
        const result = await Swal.fire({
          icon: 'warning',
          title: 'Cliente solicitou cancelamento',
          html: `<p>O cliente solicitou o cancelamento do pedido <strong>#${display}</strong> via iFood.</p><p class="text-muted small">Deseja aceitar ou recusar o cancelamento?</p>`,
          showCancelButton: true,
          showDenyButton: true,
          confirmButtonText: 'Aceitar cancelamento',
          denyButtonText: 'Recusar cancelamento',
          cancelButtonText: 'Decidir depois',
          confirmButtonColor: '#dc3545',
          denyButtonColor: '#198754',
        });
        if (result.isConfirmed || result.isDenied) {
          const action = result.isConfirmed ? 'ACCEPTED' : 'DENIED';
          try {
            await api.post(`/integrations/ifood/orders/${encodeURIComponent(data.externalId)}/cancellation-dispute`, { action });
            Swal.fire({ icon: 'success', text: action === 'ACCEPTED' ? 'Cancelamento aceito.' : 'Cancelamento recusado.', timer: 2000, showConfirmButton: false });
            if (action === 'ACCEPTED' && data.orderId) {
              // Update local order status
              const idx = store.orders.findIndex(o => o && o.id === data.orderId);
              if (idx !== -1) store.orders[idx].status = 'CANCELADO';
            }
          } catch (e) {
            console.error('Erro ao responder negociacao:', e);
            Swal.fire('Erro', 'Falha ao responder ao iFood.', 'error');
          }
        }
      }
    } catch (e) {
      console.error('[ifood-negotiation] handler error:', e);
    }
  });

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
  try { window.removeEventListener('cash-session-opened', onCashSessionOpened); } catch (e) {}
  try { if (resizeHandler) window.removeEventListener('resize', resizeHandler); } catch (e) {}
  clearInterval(nowTimer);
  try { clearInterval(printerCheckInterval); } catch(e){}
  // destroy Sortable instances
  for (const s of sortableInstances) {
    try { s.destroy(); } catch (e) {}
  }
  destroyIfoodWidget();
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
    // Prefer an explicit persisted total when available to avoid double-counting
    // scenarios where `item.price` already includes option values while `options`
    // are also present in the payload. Use available total/amount fields first.
    // Prefer explicit payment total from the persisted payload when present
    // (covers PDV and public flows where `payload.payment.amount` is authoritative)
    const paymentAmount = Number(
      o.payload?.payment?.amount ??
      o.payload?.rawPayload?.payment?.amount ??
      o.payload?.order?.total?.orderAmount ??
      o.payload?.total?.orderAmount ??
      o.total ??
      o.amount ??
      0
    ) || 0;
    if(paymentAmount > 0) return paymentAmount;
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

// Total of an item line: (unitPrice + sum of option prices per unit) * quantity
function itemLineTotal(it) {
  const qty = Number(it.quantity || 1) || 1;
  const unit = Number(it.unitPrice || it.price || 0) || 0;
  // opt.price from iFood subitems is already the line total per parent unit
  // (e.g. 4x Coca @R$5 = R$20), so do NOT multiply by opt.quantity again
  const optsPerUnit = extractItemOptions(it).reduce((s, o) => s + Number(o.price || 0), 0);
  return (unit + optsPerUnit) * qty;
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
          kind: o.kind || o.option.kind || 'addon',
          slotId: o.slotId || o.option.slotId || null,
          slotName: o.slotName || o.option.slotName || null,
          name: o.option.name || o.option.title || '',
          price: Number(o.option.price ?? o.option.unitPrice ?? o.option.amount ?? 0) || 0,
          quantity: Number(o.qty ?? o.quantity ?? o.option.quantity ?? 1) || 1
        });
        continue;
      }
      // shape: { name, price, quantity, kind?, slotName? }
      out.push({
        kind: o.kind || 'addon',
        slotId: o.slotId || null,
        slotName: o.slotName || null,
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

// Helper: resolve iFood payments object from the payload (handles both event-envelope and flat shapes)
const PAYMENT_METHOD_MAP = {
  'CASH': 'Dinheiro',
  'CREDIT': 'Crédito',
  'DEBIT': 'Débito',
  'MEAL_VOUCHER': 'Vale Refeição',
  'FOOD_VOUCHER': 'Vale Alimentação',
  'GIFT_CARD': 'Gift Card',
  'PIX': 'PIX',
  'PREPAID': 'Pré-pago',
  'ONLINE': 'Pagamento Online',
  'WALLET': 'Carteira Digital',
  'VOUCHER': 'Voucher',
  'DINHEIRO': 'Dinheiro',
  'CREDITO': 'Crédito',
  'DEBITO': 'Débito',
};

function translatePaymentMethod(raw, brand) {
  if (!raw) return '—';
  const upper = raw.toUpperCase().trim();
  // Priority 1: company's iFood payment mapping from DB
  const dbLabel = ifoodPaymentMap.value[upper];
  if (dbLabel) {
    let label = dbLabel;
    if (brand) label += ` ${brand}`;
    return label;
  }
  // Priority 2: static fallback map
  let label = PAYMENT_METHOD_MAP[upper] || null;
  if (!label) {
    for (const [key, val] of Object.entries(PAYMENT_METHOD_MAP)) {
      if (upper.startsWith(key)) {
        label = val;
        break;
      }
    }
  }
  if (!label) label = raw;
  if (brand) label += ` ${brand}`;
  return label;
}

function resolveIfoodPayments(o) {
  // iFood event payload wraps order: { order: { payments: { methods: [] } } }
  const fromOrder = o.payload?.order?.payments;
  if (fromOrder) return fromOrder;
  // Direct order payload (fetched via GET /orders/:id): { payments: { methods: [] } }
  const direct = o.payload?.payments;
  if (direct && !Array.isArray(direct)) return direct;
  return null;
}

function getPaymentMethod(o) {
  const p = resolveIfoodPayments(o);
  if (p) {
    const m = p.methods && p.methods[0];
    if (m) {
      if (m.method) return m.method + (m.card?.brand ? ` (${m.card.brand})` : '');
      if (m.type) return m.type;
    }
    if (p.prepaid) return 'Pré-pago';
  }
  return '—';
}

function getOrderNotes(o) {
  return o.payload?.order?.additionalInfo?.notes ||
    o.payload?.notes || o.payload?.observations || o.payload?.additionalInfo?.notes || '';
}

// Normalize items from different integration payload shapes to a common structure
// normalizeOrderItems is shared from ../utils/orderUtils.js

// Normaliza um pedido inteiro para um shape consistente usado pela UI
function normalizeOrder(o){
  if(!o) return {};
  if (o._normalized) return o._normalized;

  const items = normalizeOrderItems(o);
  // payment method: try common places
  // Priority: own payment field → iFood payments object (handles event-envelope and flat) → legacy array → PDV
  let paymentMethod = '—';
  // iFood first: payments is an object { methods: [], prepaid } at payload.order.payments or payload.payments
  const ifoodPay = resolveIfoodPayments(o);
  if (ifoodPay && (ifoodPay.methods?.length || ifoodPay.prepaid != null)) {
    const methods = ifoodPay.methods || [];
    if (methods.length > 0) {
      paymentMethod = methods.map(m => {
        let label = m._systemLabel || translatePaymentMethod(m.method || m.type || '', m.card?.brand);
        if (m.prepaid === true) label += ' (pago online)';
        else if (m.prepaid === false) label += ' (cobrar do cliente)';
        return label;
      }).filter(Boolean).join(' + ') || paymentMethod;
    } else if (ifoodPay.prepaid) {
      paymentMethod = 'Pré-pago (pago online)';
    }
  } else if (o.payment && (o.payment.methodCode || o.payment.method)) {
    paymentMethod = translatePaymentMethod(o.payment.methodCode || o.payment.method || String(o.payment.amount || ''), o.payment.card?.brand);
  } else if (o.payload && o.payload.payment) {
    paymentMethod = translatePaymentMethod(o.payload.payment.methodCode || o.payload.payment.method || o.payload.payment.type || paymentMethod, o.payload.payment.card?.brand);
  } else if (o.payload && o.payload.payments && Array.isArray(o.payload.payments) && o.payload.payments[0]) {
    const m = o.payload.payments[0];
    paymentMethod = translatePaymentMethod(m.method || m.type || paymentMethod, m.card?.brand);
  }

  // coupon
  const couponCode = o.couponCode || (o.coupon && (o.coupon.code || o.couponId)) || (o.payload && o.payload.coupon && (o.payload.coupon.code || o.payload.couponId)) ||
    o.payload?.order?.coupon?.code || null;
  const couponDiscount = Number(o.couponDiscount ?? o.coupon?.discountAmount ?? o.discountAmount ?? o.discount ?? o.payload?.coupon?.discountAmount ?? o.payload?.order?.total?.benefits ?? 0) || 0;

  // troco (change): iFood puts changeFor in payments.methods[i].changeFor (for CASH method)
  let paymentChange = null;
  try {
    if (o.payment && (o.payment.changeFor || o.payment.change_for || o.payment.change)) {
      paymentChange = Number((o.payment.changeFor ?? o.payment.change_for ?? o.payment.change) || 0) || null;
    } else if (o.payload && o.payload.payment && (o.payload.payment.changeFor || o.payload.payment.change_for || o.payload.payment.change)) {
      paymentChange = Number((o.payload.payment.changeFor ?? o.payload.payment.change_for ?? o.payload.payment.change) || 0) || null;
    } else {
      // iFood: changeFor is in payments.methods[].changeFor (cash method)
      const ifoodPay = resolveIfoodPayments(o);
      if (ifoodPay) {
        const cashMethod = (ifoodPay.methods || []).find(m =>
          (m.method || '').toUpperCase() === 'CASH' ||
          (m.method || '').toUpperCase() === 'DINHEIRO' ||
          (m.type || '').toUpperCase() === 'OFFLINE'
        );
        if (cashMethod?.changeFor) paymentChange = Number(cashMethod.changeFor) || null;
      } else if (o.payload && o.payload.payments && Array.isArray(o.payload.payments) && o.payload.payments[0] &&
        (o.payload.payments[0].changeFor || o.payload.payments[0].change_for || o.payload.payments[0].change)) {
        paymentChange = Number((o.payload.payments[0].changeFor ?? o.payload.payments[0].change_for ?? o.payload.payments[0].change) || 0) || null;
      }
    }
  } catch (e) { /* ignore */ }

  const total = Number(o.total ?? o.amount ?? (o.payment ? o.payment.amount : undefined) ?? 0) || 0;

  // build a robust address extraction checking many common payload shapes
  function extractAddress(o) {
    if (!o) return '';
    // helper to format address objects consistently
    const formatAddrObj = (addr) => {
      if (!addr) return '';
      const formatted = addr.formatted || addr.formattedAddress || addr.formatted_address || '';
      const street = addr.street || addr.streetName || '';
      const number = addr.number || addr.streetNumber || '';
      const complement = addr.complement || addr.complemento || '';
      const neighborhood = addr.neighborhood || '';
      const city = addr.city || '';
      const state = addr.state || addr.uf || '';
      const postalCode = addr.postalCode || addr.zip || addr.postal_code || '';
      const reference = addr.reference || addr.ref || '';
      const observation = addr.observation || addr.observacao || '';
      // Build from components when available (formatted may be just the street name)
      const baseParts = street || formatted;
      const base = [baseParts, number].filter(Boolean).join(', ');
      if (!base) return '';
      const tailParts = [neighborhood, city, state].filter(Boolean);
      if (postalCode) tailParts.push(postalCode);
      if (complement) tailParts.push('Comp: ' + complement);
      if (reference) tailParts.push('Ref: ' + reference);
      if (observation) tailParts.push('Obs: ' + observation);
      const tail = tailParts.filter(Boolean).join(' - ');
      return [base, tail].filter(Boolean).join(' | ');
    };

    // address could be a string or an object created by PDV wizard
    if (typeof o.address === 'string') return o.address;
    if (o.address && typeof o.address === 'object') return formatAddrObj(o.address);

    // customer attached addresses (created via PDV/customer book)
    if (o.customerAddress) {
      const ca = typeof o.customerAddress === 'string' ? o.customerAddress : formatAddrObj(o.customerAddress);
      if (ca) return ca;
    }
    if (o.customer && Array.isArray(o.customer.addresses) && o.customer.addresses.length) {
      // prefer default, else first
      const def = o.customer.addresses.find(a => a && a.isDefault) || o.customer.addresses[0];
      const ca = typeof def === 'string' ? def : formatAddrObj(def);
      if (ca) return ca;
    }
    if (o.customer && o.customer.address) {
      const ca = typeof o.customer.address === 'string' ? o.customer.address : formatAddrObj(o.customer.address);
      if (ca) return ca;
    }

    // payload shapes from integrators/backends
    // Try formatting known object shapes when formatted string is missing
    const fromPayloadObj = (
      formatAddrObj(o.payload?.rawPayload?.address) ||
      formatAddrObj(o.payload?.delivery?.deliveryAddress) ||
      formatAddrObj(o.payload?.order?.delivery?.address)
    );

    const a = fromPayloadObj ||
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
      (typeof o.rawPayload?.address === 'string' ? o.rawPayload.address : null) ||
      o.rawPayload?.neighborhood ||
      o.customer?.address?.formattedAddress ||
      '';
    return a || '';
  }

  // short address for cards: "Rua, número - Bairro"
  const shortAddress = (function() {
    try {
      // Try to extract structured address components
      const sources = [
        o.payload?.order?.delivery?.deliveryAddress,
        o.payload?.delivery?.deliveryAddress,
        o.payload?.rawPayload?.address,
        (typeof o.address === 'object' ? o.address : null),
        o.customerAddress,
      ];
      for (const a of sources) {
        if (!a || typeof a !== 'object') continue;
        const street = a.streetName || a.street || '';
        const number = a.streetNumber || a.number || '';
        const neighborhood = a.neighborhood || a.bairro || '';
        if (street) {
          const base = [street, number].filter(Boolean).join(', ');
          return neighborhood ? `${base} - ${neighborhood}` : base;
        }
      }
      // If order has deliveryNeighborhood from DB, append to address string
      const fullAddr = extractAddress(o) || '';
      if (o.deliveryNeighborhood && fullAddr && !fullAddr.includes(o.deliveryNeighborhood)) {
        // Truncate to main part and append neighborhood
        const mainPart = fullAddr.split('|')[0]?.trim() || fullAddr;
        return `${mainPart} - ${o.deliveryNeighborhood}`;
      }
      // Fallback: truncate full address
      return fullAddr.split('|')[0]?.trim() || fullAddr;
    } catch (e) { return extractAddress(o) || ''; }
  })();

  // Detect prepaid/online payment (iFood "PAGO")
  const isPrepaid = (function() {
    try {
      // iFood shape: payload.{order?.}payments = { methods, prepaid }
      const pay = resolveIfoodPayments(o);
      if (pay) {
        if (pay.prepaid === true) return true;
        const methods = pay.methods || [];
        if (methods.length > 0 && methods.every(m => m.prepaid === true || m.isOnline === true)) return true;
      }
      // POS / public shape: payload.payment = { methodCode, prepaid?, isOnline? }
      // Without this fallback, takeout orders paid online were getting routed
      // through CONFIRMACAO_PAGAMENTO instead of going straight to CONCLUIDO.
      const direct = o.payload?.payment;
      if (direct && (direct.prepaid === true || direct.isOnline === true)) return true;
      return false;
    } catch (e) { return false; }
  })();

  const normalized = {
    id: o.id,
    display: formatDisplay(o),
    customerName: o.customerName || o.name || (o.customer && (o.customer.name || o.customer.fullName)) || '',
    customerPhone: o.customerPhone || o.contact || (o.customer && o.customer.contact) || '',
    address: extractAddress(o) || '',
    shortAddress,
    // Structured address components for detail view
    addressDetails: (function() {
      try {
        const sources = [
          o.payload?.order?.delivery?.deliveryAddress,
          o.payload?.delivery?.deliveryAddress,
          o.payload?.rawPayload?.address,
          (typeof o.address === 'object' ? o.address : null),
          o.customerAddress,
          (o.customer && Array.isArray(o.customer.addresses) && o.customer.addresses.length
            ? (o.customer.addresses.find(a => a && a.isDefault) || o.customer.addresses[0])
            : null),
          o.customer?.address,
        ];
        for (const a of sources) {
          if (!a || typeof a !== 'object') continue;
          const street = a.streetName || a.street || '';
          if (!street) continue;
          return {
            street,
            number: a.streetNumber || a.number || '',
            complement: a.complement || a.complemento || '',
            neighborhood: a.neighborhood || a.bairro || '',
            city: a.city || '',
            state: a.state || a.uf || '',
            postalCode: a.postalCode || a.zip || a.postal_code || a.cep || '',
            reference: a.reference || a.ref || a.referencePoint || '',
            observation: a.observation || a.observacao || a.observations || '',
          };
        }
        return null;
      } catch (e) { return null; }
    })(),
    total,
    paymentMethod,
    isPrepaid,
    closedByIfoodCode: !!(o.closedByIfoodCode || o.payload?.closedByIfoodCode),
    // storeName: nome da "origem" do pedido. Ordem de precedência:
    //   1) merchant name vindo do payload iFood (marca cadastrada no iFood)
    //   2) merchantName cravado na ApiIntegration (set por admin/auto-sync)
    //   3) **menu.name** — o cardápio é a unidade de origem real do pedido.
    //      Vale tanto pra "Cardápio digital" quanto pra qualquer canal vinculado
    //      a um cardápio (iFood com integração-cardápio, PDV usando cardápio,
    //      etc). Nunca devolver loja se há cardápio: hierarquicamente o cardápio
    //      está abaixo da loja e identifica melhor o canal de venda.
    //   4) store.name — só quando o pedido genuinamente não tem cardápio (legado)
    storeName: (function() {
      try {
        const payloadMerchantName = o.payload?.order?.merchant?.name;
        if (payloadMerchantName) return payloadMerchantName;
        // O fallback de merchantName só é válido pra pedidos iFood. Sem o
        // gate por customerSource, um pedido do Cardápio Digital numa loja
        // que tem integração iFood acabava sendo etiquetado com o nome da
        // integração (ex: "Boulevard Foods") em vez do cardápio dele.
        if (o.customerSource === 'IFOOD' && Array.isArray(o.store?.apiIntegrations) && o.store.apiIntegrations.length) {
          const payloadMerchantId = o.payload?.merchantId || o.payload?.order?.merchant?.id;
          if (payloadMerchantId) {
            const matched = o.store.apiIntegrations.find(a =>
              a.merchantName && (a.merchantId === payloadMerchantId || a.merchantUuid === payloadMerchantId)
            );
            if (matched?.merchantName) return matched.merchantName;
          }
          const any = o.store.apiIntegrations.find(a => a.merchantName);
          if (any?.merchantName) return any.merchantName;
        }
        if (o.menu?.name) return o.menu.name;
        return (o.store && o.store.name) || null;
      } catch (e) { return null; }
    })(),
    channelLabel: (function() {
      // try common locations for integration/channel/provider
      const raw = o.payload?.integration?.provider || o.payload?.provider || o.payload?.adapter || o.payload?.platform || o.payload?.source?.provider || o.payload?.channel || o.integration?.provider || o.adapter || o.payload?.source || o.payload?.order?.salesChannel || o.payload?.salesChannel || null;

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
    items,
    // iFood-specific fields
    pickupCode: (function() {
      try {
        return o.payload?.order?.delivery?.pickupCode || o.payload?.delivery?.pickupCode || null;
      } catch (e) { return null; }
    })(),
    scheduledTime: (function() {
      try {
        const ord = o.payload?.order || o.payload || {};
        const timing = ord.orderTiming || null;
        if (timing !== 'SCHEDULED') return null;
        const dt = ord.schedule?.scheduledDateTimeStart
          || ord.schedule?.deliveryDateTimeStart
          || ord.scheduledDateTimeStart
          || ord.scheduledDeliveryDateTime
          || ord.delivery?.scheduledDateTimeStart
          || null;
        return dt ? new Date(dt) : null;
      } catch (e) { return null; }
    })(),
    documentNumber: (function() {
      try {
        return o.payload?.order?.customer?.documentNumber || o.payload?.customer?.documentNumber || null;
      } catch (e) { return null; }
    })(),
    deliveryObservations: (function() {
      try {
        return o.payload?.order?.delivery?.observations || o.payload?.delivery?.observations || null;
      } catch (e) { return null; }
    })(),
    couponSponsor: (function() {
      // Extract who subsidizes the discount: Loja, iFood, Indústria, Rede
      const sponsorLabels = { MERCHANT: 'Loja', IFOOD: 'iFood', EXTERNAL: 'Indústria', CHAIN: 'Rede' };
      try {
        const discounts = o.payload?.order?.benefits || o.payload?.order?.discounts || o.payload?.discounts || [];
        if (!Array.isArray(discounts) || discounts.length === 0) return null;
        const sponsors = new Set();
        discounts.forEach(d => {
          if (Array.isArray(d.sponsorshipValues)) {
            d.sponsorshipValues.forEach(sv => {
              if (Number(sv.value || sv.amount || 0) > 0 && sv.name) {
                sponsors.add(sponsorLabels[String(sv.name).toUpperCase()] || sv.name);
              }
            });
          } else if (d.source) {
            const key = String(d.source).toUpperCase();
            sponsors.add(sponsorLabels[key] || d.source);
          }
        });
        return sponsors.size > 0 ? Array.from(sponsors).join(' + ') : null;
      } catch (e) { return null; }
    })(),
    // iFood phone localizer: virtual extension code for customer→merchant calls
    phoneLocalizer: (function() {
      try {
        return o.payload?.order?.customer?.phone?.localizer ||
               o.payload?.customer?.phone?.localizer || null;
      } catch (e) { return null; }
    })(),
    ifoodConfirmationCode: o.customer?.ifoodConfirmationCode || null,
    subtotal: (function() {
      try {
        if (o.subtotal) return Number(o.subtotal);
        // iFood: use total.subTotal from payload (authoritative, avoids double-counting options)
        const ip = (o.payload?.order || o.payload || {});
        const ifoodSubTotal = ip.total?.subTotal;
        if (ifoodSubTotal != null && Number(ifoodSubTotal) > 0) return Number(ifoodSubTotal);
        return (items || []).reduce((s, it) => {
          const qty = Number(it.quantity || 1) || 1;
          const unit = Number(it.unitPrice || it.price || 0) || 0;
          let optsSum = 0;
          for (const opt of (it.options || [])) {
            optsSum += (Number(opt.price || 0) || 0) * (Number(opt.quantity || 1) || 1);
          }
          return s + (unit * qty) + (optsSum * qty);
        }, 0);
      } catch (e) { return 0; }
    })(),
    additionalFees: (function() {
      try {
        const ip = (o.payload?.order || o.payload || {});
        return Number(ip.total?.additionalFees ?? 0) || 0;
      } catch (e) { return 0; }
    })(),
    deliveryFee: Number(o.deliveryFee || 0),
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
function getNextStatus(current, order) {
  const c = (current || '').toUpperCase();
  // PRONTO advances to SAIU_PARA_ENTREGA (aguardando retirada / saiu)
  if (c === 'PRONTO') return 'SAIU_PARA_ENTREGA';
  // When payment is prepaid (PAGO online), skip CONFIRMACAO_PAGAMENTO and go straight to CONCLUIDO
  const norm = order ? normalizeOrder(order) : null;
  const prepaid = norm?.isPrepaid || false;
  const pipeline = prepaid
    ? ['EM_PREPARO', 'SAIU_PARA_ENTREGA', 'CONCLUIDO']
    : ['EM_PREPARO', 'SAIU_PARA_ENTREGA', 'CONFIRMACAO_PAGAMENTO', 'CONCLUIDO'];
  const idx = pipeline.indexOf(c);
  if (idx === -1) return null;
  if (idx === pipeline.length - 1) return null;
  return pipeline[idx + 1];
}

async function advanceStatus(order) {
  let next = getNextStatus(order.status, order);
  if (!next) return;
  // Takeout in PRONTO skips SAIU_PARA_ENTREGA (there's no rider on the way).
  // Prepaid takeout (pagamento online) also skips CONFIRMACAO_PAGAMENTO —
  // there's no in-person money to confirm, so close the order directly.
  if (isTakeoutOrder(order) && order.status === 'PRONTO' && next === 'SAIU_PARA_ENTREGA') {
    const norm = normalizeOrder(order);
    next = norm?.isPrepaid ? 'CONCLUIDO' : 'CONFIRMACAO_PAGAMENTO';
  }
  await changeStatus(order, next);
}

const filteredOrders = computed(() => {
  const now = Date.now();
  const dayMs = 12 * 60 * 60 * 1000;
  return store.orders.filter((o) => {
    // filtro de status/entregador
    const statusMatch = selectedStatus.value === 'TODOS' || o.status === selectedStatus.value;
    // compare as strings to avoid numeric/string id mismatches
    const riderMatch = !ridersEnabled.value || selectedRider.value === 'TODOS' || (o.rider && String(o.rider.id) === String(selectedRider.value));

    // order number filter (match display or id)
    const qOrder = String(searchOrderNumber.value || '').trim().toLowerCase();
    const display = String(formatDisplay(o) || '').toLowerCase();
    const idStr = String(o.id || '').toLowerCase();
    const orderNumberMatch = !qOrder || display.includes(qOrder) || idStr.includes(qOrder);

    // customer name filter
    const qName = String(searchCustomerName.value || '').trim().toLowerCase();
    const customerMatch = !qName || String(o.customerName || '').toLowerCase().includes(qName);

    // filtro por forma de pagamento
    const paymentMatch = selectedPaymentMethod.value === 'TODOS' || (() => {
      const n = o._normalized || normalizeOrder(o);
      return n.paymentMethod === selectedPaymentMethod.value;
    })();

    // filtro por tipo de pedido (entrega / retirada)
    const oType = getOrderType(o);
    const typeMatch = (oType === 'DELIVERY' && filterEntrega.value) || (oType === 'RETIRADA' && filterRetirada.value);

    if (!statusMatch || !riderMatch || !orderNumberMatch || !customerMatch || !typeMatch || !paymentMatch) return false;

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

// Details modal state
const selectedOrder = ref(null);
const detailsModalVisible = ref(false);
const detailsTab = ref('customer');
const selectedNormalized = computed(() => selectedOrder.value ? normalizeOrder(selectedOrder.value) : null);

// Assign rider modal state
const assignModalVisible = ref(false);
const assignModalOrder = ref(null);
const assignModalRiders = ref([]);
const assignSelectedRider = ref(null);
const assignOrderId = computed(() => (assignModalOrder && assignModalOrder.value && assignModalOrder.value.id) || null);

// Bulk assign state: when set, the assign modal operates on multiple orders
const bulkAssignOrders = ref([]);
const isBulkAssign = computed(() => bulkAssignOrders.value.length > 0);

// =============================
// Multi-select / bulk actions
// =============================
const selectedOrderIds = ref(new Set());

function getOrderType(o) {
  const raw = (o.orderType || o.payload?.orderType || '').toUpperCase();
  if (['RETIRADA', 'TAKEOUT', 'PICKUP', 'TAKE-OUT', 'PICK-UP', 'BALCAO', 'BALCÃO', 'INDOOR'].includes(raw)) return 'RETIRADA';
  if (raw === 'DELIVERY') return 'DELIVERY';
  // Fallback: detect by customer name pattern for PDV "balcão" orders
  const name = (o.customerName || '').toLowerCase();
  if (name.includes('balcão') || name.includes('balcao')) return 'RETIRADA';
  return 'DELIVERY';
}

const selectedOrdersList = computed(() => {
  return store.orders.filter(o => selectedOrderIds.value.has(o.id));
});

const selectionOrderType = computed(() => {
  const first = selectedOrdersList.value[0];
  return first ? getOrderType(first) : null;
});

const selectionStatus = computed(() => {
  const first = selectedOrdersList.value[0];
  return first ? first.status : null;
});

const allSameStatus = computed(() => {
  if (selectedOrdersList.value.length === 0) return true;
  return selectedOrdersList.value.every(o => o.status === selectionStatus.value);
});

function toggleOrderSelection(order) {
  const set = new Set(selectedOrderIds.value);

  if (set.has(order.id)) {
    set.delete(order.id);
    selectedOrderIds.value = set;
    return;
  }

  // Rule: CONFIRMACAO_PAGAMENTO cannot have >1 selected
  if (order.status === 'CONFIRMACAO_PAGAMENTO' && set.size > 0) {
    Swal.fire({ icon:'warning', title:'Seleção não permitida',
      text:'Pedidos em confirmação de pagamento não podem ser selecionados em massa.',
      timer:3000, toast:true, position:'top-end', showConfirmButton:false });
    return;
  }
  if (selectionStatus.value === 'CONFIRMACAO_PAGAMENTO' && set.size > 0) {
    Swal.fire({ icon:'warning', title:'Seleção não permitida',
      text:'Pedidos em confirmação de pagamento não podem ser selecionados em massa.',
      timer:3000, toast:true, position:'top-end', showConfirmButton:false });
    return;
  }

  // Rule: Cannot mix DELIVERY and RETIRADA
  const thisType = getOrderType(order);
  if (set.size > 0 && thisType !== selectionOrderType.value) {
    Swal.fire({ icon:'warning', title:'Tipos diferentes',
      text:'Não é possível selecionar pedidos de entrega e retirada juntos.',
      timer:3000, toast:true, position:'top-end', showConfirmButton:false });
    return;
  }

  set.add(order.id);
  selectedOrderIds.value = set;
}

function clearSelection() {
  selectedOrderIds.value = new Set();
}

function isOrderSelected(order) {
  return selectedOrderIds.value.has(order.id);
}

async function bulkAdvanceStatus() {
  if (!allSameStatus.value || selectedOrdersList.value.length === 0) return;
  const next = getNextStatus(selectionStatus.value);
  if (!next) return;

  // SAIU_PARA_ENTREGA with riders enabled and DELIVERY orders: open rider assignment modal
  if (next === 'SAIU_PARA_ENTREGA' && ridersEnabled.value && selectionOrderType.value !== 'RETIRADA') {
    const riders = (await store.fetchRiders()) || [];
    assignModalRiders.value = riders.map(r => ({ id: r.id, name: r.name, description: r.whatsapp || 'sem WhatsApp', whatsapp: r.whatsapp || '' }));
    assignSelectedRider.value = null;
    bulkAssignOrders.value = [...selectedOrdersList.value];
    assignModalOrder.value = null;
    try { Swal.close(); } catch(e) {}
    await nextTick();
    assignModalVisible.value = true;
    return;
  }

  // Compute per-order next status to respect isPrepaid (online payments skip CONFIRMACAO_PAGAMENTO)
  const uniqueDestinations = [...new Set(selectedOrdersList.value.map(o => getNextStatus(o.status, o)).filter(Boolean))];
  const destinationLabel = uniqueDestinations.map(s => STATUS_LABEL[s] || s).join(' / ');

  const conf = await Swal.fire({
    title: `Avançar ${selectedOrdersList.value.length} pedidos?`,
    text: `Mover para: ${destinationLabel}`,
    icon: 'question', showCancelButton: true,
    confirmButtonText: 'Sim, avançar', cancelButtonText: 'Cancelar'
  });
  if (!conf.isConfirmed) return;

  loading.value = true;
  let success = 0, fail = 0;
  for (const order of selectedOrdersList.value) {
    try {
      const orderNext = getNextStatus(order.status, order);
      if (!orderNext) { fail++; continue; }
      await store.updateStatus(order.id, orderNext);
      success++;
    } catch (e) {
      console.error(`Falha ao avançar pedido ${order.id}`, e);
      fail++;
    }
  }
  await store.fetch();
  loading.value = false;
  clearSelection();

  Swal.fire({
    icon: fail ? 'warning' : 'success',
    title: `${success} pedido(s) avançado(s)` + (fail ? `, ${fail} falha(s)` : ''),
    timer: 3000, toast: true, position: 'top-end', showConfirmButton: false
  });
}

async function bulkPrint() {
  if (selectedOrdersList.value.length === 0) return;
  for (const order of selectedOrdersList.value) {
    await printReceipt(order);
  }
  Swal.fire({
    icon: 'success', title: `${selectedOrdersList.value.length} comanda(s) enviada(s) para impressão`,
    timer: 3000, toast: true, position: 'top-end', showConfirmButton: false
  });
  clearSelection();
}

async function imprimirDanfe(order) {
  try {
    const { data } = await api.post('/agent-print', {
      id: order.id,
      storeId: order.storeId,
      fiscal: true,
    })
    if (data.ok) {
      Swal.fire({ icon: 'success', title: 'DANFE enviada para impressão', timer: 1500, showConfirmButton: false })
    } else {
      throw new Error(data.error || 'Falha ao enviar para impressão')
    }
  } catch (e) {
    const msg = (e.response && e.response.data && e.response.data.error) || e.message || 'Erro desconhecido'
    Swal.fire({ icon: 'error', title: 'Erro ao imprimir DANFE', text: msg })
  }
}

async function sendNfeEmail(order) {
  const { value: email, isConfirmed } = await Swal.fire({
    title: 'Enviar NF-e em PDF por e-mail',
    input: 'email',
    inputLabel: 'Endereço de e-mail',
    inputPlaceholder: 'cliente@exemplo.com',
    inputValue: order.customerEmail || '',
    showCancelButton: true,
    confirmButtonText: 'Enviar',
    cancelButtonText: 'Cancelar',
    inputValidator: (v) => !v ? 'Informe um e-mail' : null,
  })
  if (!isConfirmed || !email) return
  try {
    await api.post('/nfe/enviar-email', { orderId: order.id, email })
    Swal.fire({ icon: 'success', title: 'E-mail enviado', text: email, timer: 3000, toast: true, position: 'top-end', showConfirmButton: false })
  } catch (e) {
    Swal.fire({ icon: 'error', title: 'Erro ao enviar e-mail', text: e.response?.data?.error || e.message })
  }
}

async function downloadNfePdf(order) {
  try {
    const resp = await api.get(`/nfe/danfe-pdf/${order.id}`, { responseType: 'blob' })
    const cd = resp.headers['content-disposition'] || ''
    const match = cd.match(/filename="([^"]+)"/)
    const filename = match ? match[1] : `nfe-${order.displaySimple || order.id}.pdf`
    const url = URL.createObjectURL(new Blob([resp.data], { type: 'application/pdf' }))
    const a = document.createElement('a')
    a.href = url; a.download = filename
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    URL.revokeObjectURL(url)
  } catch (e) {
    Swal.fire({ icon: 'error', title: 'Erro ao baixar PDF', text: e.response?.data?.error || e.message })
  }
}

async function downloadNfeXml(order) {
  try {
    const resp = await api.get(`/nfe/xml-by-order/${order.id}`, { responseType: 'blob' })
    const cd = resp.headers['content-disposition'] || ''
    const match = cd.match(/filename="([^"]+)"/)
    const filename = match ? match[1] : `nfe-${order.displaySimple || order.id}.xml`
    const url = URL.createObjectURL(new Blob([resp.data], { type: 'application/xml' }))
    const a = document.createElement('a')
    a.href = url; a.download = filename
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    URL.revokeObjectURL(url)
  } catch (e) {
    Swal.fire({ icon: 'error', title: 'Erro ao baixar XML', text: e.response?.data?.error || e.message })
  }
}

async function emitirNfeOrder(order) {
  const r = await Swal.fire({
    title: 'Emitir NF-e?',
    text: `Pedido #${formatDisplay(order)}`,
    icon: 'question',
    showCancelButton: true,
    confirmButtonText: 'Emitir',
    cancelButtonText: 'Cancelar'
  })
  if (!r.isConfirmed) return
  try {
    const { data } = await api.post('/nfe/emit-from-order', { orderId: order.id })
    if (data.debugMode) {
      const debugResult = await Swal.fire({
        icon: 'info',
        title: 'Modo Debug — XML Gerado',
        html: 'NF-e <b>NÃO</b> foi transmitida ao SEFAZ.',
        showDenyButton: true,
        confirmButtonText: '🖨️ Imprimir DANFE',
        denyButtonText: '⬇️ Baixar XML',
        confirmButtonColor: '#0d6efd',
        denyButtonColor: '#6c757d',
      })
      if (debugResult.isConfirmed) {
        try {
          const resp = await api.post('/nfe/danfe-preview', { xml: data.xml, orderId: order.id }, { responseType: 'blob' })
          const url = URL.createObjectURL(new Blob([resp.data], { type: 'text/html' }))
          window.open(url, '_blank')
        } catch (e) {
          Swal.fire({ icon: 'error', title: 'Erro ao gerar DANFE', text: e.response?.data || e.message })
        }
      } else if (debugResult.isDenied) {
        const blob = new Blob([data.xml], { type: 'application/xml' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = data.filename || `nfe-${order.displaySimple || order.id}.xml`
        document.body.appendChild(a); a.click(); document.body.removeChild(a)
        URL.revokeObjectURL(url)
      }
      return
    }
    if (data.success) {
      // Patch order in store so button flips immediately without waiting for socket
      const nfeInfo = { nProt: data.nProt, cStat: data.cStat, xMotivo: data.xMotivo, authorizedAt: new Date().toISOString() }
      const patchOrder = (o) => o ? { ...o, payload: { ...(o.payload || {}), nfe: nfeInfo } } : o
      const idx = store.orders.findIndex(o => o && o.id === order.id)
      if (idx !== -1) store.orders.splice(idx, 1, patchOrder(store.orders[idx]))
      if (selectedOrder.value?.id === order.id) selectedOrder.value = patchOrder(selectedOrder.value)
      Swal.fire({ icon: 'success', title: 'NF-e Autorizada', text: `Protocolo: ${data.nProt} — enviando DANFE para impressão...`, toast: true, timer: 3000, position: 'top-end', showConfirmButton: false })
      // Auto-imprime a DANFE no agente fiscal logo após emissão bem-sucedida.
      // Operador faz "emitir + imprimir" em um único clique. Se falhar, o botão
      // do card permanece como "imprimir DANFE" para retry manual.
      try { await imprimirDanfe(patchOrder(order)) } catch (_) { /* erro já reportado por imprimirDanfe */ }
    } else {
      Swal.fire({ icon: 'error', title: 'Erro NF-e', text: data.xMotivo || data.error })
    }
  } catch (e) {
    Swal.fire({ icon: 'error', title: 'Erro ao emitir NF-e', text: e.response?.data?.error || e.message })
  }
}

async function sendIfoodChat(order) {
  if (!order.storeId) {
    Swal.fire({ icon: 'error', text: 'Pedido sem loja associada', toast: true, position: 'top-end', timer: 3000, showConfirmButton: false });
    return;
  }
  try {
    await api.post('/ifood-chat/send', { orderId: order.id, storeId: order.storeId });
    Swal.fire({ icon: 'success', text: 'Mensagem enviada no chat iFood', toast: true, position: 'top-end', timer: 2500, showConfirmButton: false });
  } catch (e) {
    console.error('sendIfoodChat failed', e);
    Swal.fire({ icon: 'error', text: 'Falha ao enviar mensagem: ' + (e.response?.data?.message || e.message), toast: true, position: 'top-end', timer: 4000, showConfirmButton: false });
  }
}

async function bulkEmitNfe() {
  const ids = [...selectedOrderIds.value]
  if (!ids.length) return
  const r = await Swal.fire({
    title: `Emitir NF-e para ${ids.length} pedido(s)?`,
    icon: 'question',
    showCancelButton: true,
    confirmButtonText: 'Emitir todos',
    cancelButtonText: 'Cancelar'
  })
  if (!r.isConfirmed) return
  try {
    const { data } = await api.post('/nfe/emit-from-order', { orderIds: ids })
    const ok = data.results.filter(r => r.success).length
    const fail = data.results.length - ok
    Swal.fire({
      icon: fail ? 'warning' : 'success',
      title: `${ok} emitida(s)${fail ? `, ${fail} erro(s)` : ''}`,
      timer: 5000, toast: true, position: 'top-end', showConfirmButton: false
    })
  } catch (e) {
    Swal.fire({ icon: 'error', title: 'Erro', text: e.response?.data?.error || e.message })
  }
  clearSelection()
}

// Clean stale selections when orders list changes
watch(() => store.orders.length, () => {
  const valid = new Set([...selectedOrderIds.value].filter(id => store.orders.some(o => o.id === id)));
  if (valid.size !== selectedOrderIds.value.size) selectedOrderIds.value = valid;
});

function openDetails(o) {
  selectedOrder.value = o;
  detailsTab.value = 'customer';
  detailsModalVisible.value = true;
}

function closeDetails() {
  detailsModalVisible.value = false;
  selectedOrder.value = null;
}

const orderEditable = computed(() => {
  if (!selectedOrder.value) return false;
  const s = selectedOrder.value.status;
  return s !== 'CONCLUIDO' && s !== 'CANCELADO';
});

async function saveOrderEdit(fields) {
  const o = selectedOrder.value;
  if (!o) return;
  try {
    loading.value = true;
    const updated = await store.updateOrder(o.id, fields);
    selectedOrder.value = updated;
    await store.fetch();
    Swal.fire({ icon: 'success', title: 'Pedido atualizado', timer: 2000, toast: true, position: 'top-end', showConfirmButton: false });
  } catch (e) {
    console.error(e);
    Swal.fire('Erro', 'Falha ao atualizar pedido.', 'error');
  } finally {
    loading.value = false;
  }
}

async function editCustomer() {
  const o = selectedOrder.value;
  if (!o) return;
  const currentNotes = getOrderNotes(o);
  const { value: form } = await Swal.fire({
    title: 'Editar cliente',
    html:
      `<div style="text-align:left">` +
      `<label class="form-label small fw-semibold">Nome</label>` +
      `<input id="swal-ec-name" class="form-control mb-2" value="${(o.customerName || '').replace(/"/g, '&quot;')}" />` +
      `<label class="form-label small fw-semibold">Telefone</label>` +
      `<input id="swal-ec-phone" class="form-control mb-2" value="${(o.customerPhone || '').replace(/"/g, '&quot;')}" />` +
      `<label class="form-label small fw-semibold">Observações</label>` +
      `<textarea id="swal-ec-notes" class="form-control" rows="2">${currentNotes.replace(/</g, '&lt;')}</textarea>` +
      `</div>`,
    showCancelButton: true, confirmButtonText: 'Salvar', cancelButtonText: 'Cancelar', focusConfirm: false,
    preConfirm: () => ({
      customerName: document.getElementById('swal-ec-name').value.trim(),
      customerPhone: document.getElementById('swal-ec-phone').value.trim(),
      notes: document.getElementById('swal-ec-notes').value.trim(),
    })
  });
  if (form) await saveOrderEdit(form);
}

async function editAddress() {
  const o = selectedOrder.value;
  if (!o) return;

  // Load saved addresses from customer relation (already included by backend)
  const customerAddresses = (o.customer && Array.isArray(o.customer.addresses)) ? o.customer.addresses : [];
  const customerId = o.customerId || (o.customer && o.customer.id) || null;

  // Load neighborhoods for the select dropdown
  let neighborhoodsList = [];
  try {
    const { data } = await api.get('/neighborhoods');
    neighborhoodsList = Array.isArray(data) ? data : [];
  } catch (e) { console.warn('Falha ao carregar bairros', e); }

  let vueApp = null;
  let mountedApp = null;

  const result = await Swal.fire({
    title: 'Endereço de entrega',
    html: '<div id="swal-addr-vue"></div>',
    width: 550,
    showCancelButton: true, confirmButtonText: 'Salvar', cancelButtonText: 'Cancelar', focusConfirm: false,
    didOpen: () => {
      const App = {
        data() {
          return {
            addresses: JSON.parse(JSON.stringify(customerAddresses)),
            selectedAddressId: null,
            showNewForm: customerAddresses.length === 0,
            neighborhoods: neighborhoodsList,
            form: { street: '', number: '', neighborhood: '', complement: '', reference: '', observation: '' },
          };
        },
        methods: {
          selectAddress(id) {
            this.selectedAddressId = id;
            this.showNewForm = false;
          },
          editAddress(id) {
            const a = this.addresses.find(x => x.id === id);
            if (!a) return;
            this.form = {
              street: a.street || a.formatted || '',
              number: a.number || '',
              neighborhood: a.neighborhood || '',
              complement: a.complement || '',
              reference: a.reference || '',
              observation: a.observation || '',
            };
            this.selectedAddressId = id;
            this.showNewForm = true;
          },
          toggleNewForm() {
            this.showNewForm = !this.showNewForm;
            if (this.showNewForm) {
              this.selectedAddressId = null;
              this.form = { street: '', number: '', neighborhood: '', complement: '', reference: '', observation: '' };
            }
          },
          getResult() {
            // If a saved address is selected (and form is hidden), return that address
            if (this.selectedAddressId && !this.showNewForm) {
              const addr = this.addresses.find(x => x.id === this.selectedAddressId);
              if (addr) return { source: 'saved', addressId: addr.id, addr };
            }
            // Otherwise return the form data
            if (!this.form.street) return null;
            return { source: 'form', form: { ...this.form } };
          }
        },
        render() {
          const vm = this;
          const children = [];

          // Saved addresses list
          if (vm.addresses.length > 0) {
            children.push(h('label', { class: 'form-label small fw-semibold' }, 'Endereços salvos'));
            children.push(h(ListGroup, {
              items: vm.addresses,
              itemKey: 'id',
              selectedId: vm.selectedAddressId,
              showActions: true,
              onSelect: (id) => vm.selectAddress(id),
              onEdit: (id) => vm.editAddress(id),
              onRemove: (id) => {
                vm.addresses = vm.addresses.filter(x => x.id !== id);
                if (vm.selectedAddressId === id) vm.selectedAddressId = null;
              },
            }));
          }

          // Toggle link
          children.push(h('div', { class: 'small mb-2' }, [
            h('a', {
              href: '#', style: 'text-decoration:none',
              onClick: (e) => { e.preventDefault(); vm.toggleNewForm(); }
            }, vm.showNewForm ? 'Ocultar formulário' : (vm.addresses.length > 0 ? '+ Cadastrar novo endereço' : ''))
          ]));

          // New/edit address form
          if (vm.showNewForm || vm.addresses.length === 0) {
            const formFields = [];
            // Street + Number row
            formFields.push(h('div', { style: 'display:flex;gap:8px;margin-bottom:8px' }, [
              h('div', { style: 'flex:2' }, [
                h('label', { class: 'form-label small mb-1' }, 'Rua'),
                h('input', { class: 'form-control form-control-sm', value: vm.form.street,
                  onInput: (e) => { vm.form.street = e.target.value; } })
              ]),
              h('div', { style: 'flex:0 0 80px' }, [
                h('label', { class: 'form-label small mb-1' }, 'Número'),
                h('input', { class: 'form-control form-control-sm', value: vm.form.number,
                  onInput: (e) => { vm.form.number = e.target.value; } })
              ])
            ]));
            // Neighborhood select
            formFields.push(h('div', { style: 'margin-bottom:8px' }, [
              h('label', { class: 'form-label small mb-1' }, 'Bairro'),
              h('select', { class: 'form-select form-select-sm', value: vm.form.neighborhood,
                onChange: (e) => { vm.form.neighborhood = e.target.value; }
              }, [
                h('option', { value: '' }, 'Selecione o bairro'),
                ...vm.neighborhoods.map(n =>
                  h('option', { key: n.id, value: n.name, selected: vm.form.neighborhood === n.name }, n.name)
                )
              ])
            ]));
            // Complement
            formFields.push(h('div', { style: 'margin-bottom:8px' }, [
              h('label', { class: 'form-label small mb-1' }, 'Complemento'),
              h('input', { class: 'form-control form-control-sm', value: vm.form.complement,
                onInput: (e) => { vm.form.complement = e.target.value; } })
            ]));
            // Reference
            formFields.push(h('div', { style: 'margin-bottom:8px' }, [
              h('label', { class: 'form-label small mb-1' }, 'Referência'),
              h('input', { class: 'form-control form-control-sm', value: vm.form.reference,
                onInput: (e) => { vm.form.reference = e.target.value; } })
            ]));
            // Observation
            formFields.push(h('div', { style: 'margin-bottom:4px' }, [
              h('label', { class: 'form-label small mb-1' }, 'Observação'),
              h('input', { class: 'form-control form-control-sm', value: vm.form.observation,
                onInput: (e) => { vm.form.observation = e.target.value; } })
            ]));

            children.push(h('div', {
              style: 'text-align:left;padding:12px;background:#f8f9fa;border-radius:8px;margin-bottom:8px'
            }, formFields));
          }

          return h('div', { style: 'text-align:left;max-height:450px;overflow:auto' }, children);
        }
      };
      try {
        mountedApp = createApp(App);
        vueApp = mountedApp.mount('#swal-addr-vue');
      } catch (e) { console.error('Failed to mount address editor', e); }
    },
    preConfirm: () => {
      if (!vueApp) return false;
      const result = vueApp.getResult();
      if (!result) { Swal.showValidationMessage('Selecione ou preencha um endereço'); return false; }
      return result;
    },
    willClose: () => {
      if (mountedApp) { try { mountedApp.unmount(); } catch(e){} }
    }
  });

  if (!result.isConfirmed || !result.value) return;
  const res = result.value;

  // Build formatted address string for the order
  let addressStr = '';
  let addrData = null;
  if (res.source === 'saved') {
    const a = res.addr;
    const parts = [a.street || a.formatted, a.number].filter(Boolean).join(', ');
    const tail = [a.neighborhood, a.complement ? 'Comp: ' + a.complement : '', a.reference ? 'Ref: ' + a.reference : ''].filter(Boolean).join(' - ');
    addressStr = [parts, tail].filter(Boolean).join(' | ');
  } else {
    const f = res.form;
    const parts = [f.street, f.number].filter(Boolean).join(', ');
    const tail = [f.neighborhood, f.complement ? 'Comp: ' + f.complement : '', f.reference ? 'Ref: ' + f.reference : ''].filter(Boolean).join(' - ');
    addressStr = [parts, tail].filter(Boolean).join(' | ');
    addrData = f;
  }

  // Save address to order
  await saveOrderEdit({ address: addressStr });

  // Persist new address to customer if it's a new form entry and we have a customerId
  if (res.source === 'form' && customerId && addrData && addrData.street) {
    try {
      await api.post(`/customers/${customerId}/addresses`, {
        street: addrData.street,
        number: addrData.number || null,
        neighborhood: addrData.neighborhood || null,
        complement: addrData.complement || null,
        reference: addrData.reference || null,
        observation: addrData.observation || null,
        formatted: addrData.street + (addrData.number ? ', ' + addrData.number : ''),
      });
    } catch (e) { console.warn('Falha ao salvar endereço no cadastro do cliente', e); }
  }
}

async function editItems(openItemIndex = null) {
  const o = selectedOrder.value;
  if (!o) return;
  const currentItems = normalizeOrderItems(o).map(it => ({
    name: it.name || '',
    quantity: Number(it.quantity) || 1,
    price: Number(it.unitPrice || it.price) || 0,
    productId: it.id || null,
    notes: it.notes || null,
    options: (it.options || (Array.isArray(it.addons) ? it.addons : [])).map(op => ({
      id: op.id || null, name: op.name || '', price: Number(op.price || 0), quantity: Number(op.quantity || op.qty || 1) || 1
    })),
  }));

  // Load menu for product catalog and option groups
  let menuCategories = [];
  try {
    const companyId = auth?.user?.companyId || null;
    if (companyId) {
      const params = o.storeId ? { storeId: o.storeId } : {};
      const resp = await api.get(`/public/${companyId}/menu`, { params });
      const data = resp.data || {};
      const rawCats = data.categories || [];
      const catsFiltered = rawCats.map(c => ({ ...c, products: (c.products || []).filter(p => p.isActive !== false) })).filter(c => c.isActive !== false);
      const uncategorizedFiltered = (data.uncategorized || []).filter(p => p.isActive !== false);
      menuCategories = [...catsFiltered, ...(uncategorizedFiltered.length ? [{ id: 'uncat', name: 'Outros', products: uncategorizedFiltered }] : [])];
      menuCategories.forEach(c => c.products.forEach(p => { if (p.price == null) p.price = Number(p.basePrice || 0); }));
    }
  } catch (e) { console.warn('Falha ao carregar menu para edição de itens', e); }

  let vueApp = null;
  let mountedApp = null;

  const result = await Swal.fire({
    title: ' ',
    html: '<div id="swal-items-vue"></div>',
    width: 700,
    showCancelButton: true, confirmButtonText: 'Salvar pedido', cancelButtonText: 'Cancelar', focusConfirm: false,
    customClass: { popup: 'swal-items-editor-popup' },
    didOpen: () => {
      const App = {
        data() {
          return {
            items: JSON.parse(JSON.stringify(currentItems)),
            categories: menuCategories,
            screen: 'cart', // 'cart' | 'catalog' | 'options'
            activeProduct: null,
            chosenOptions: [],
            optionQty: 1,
            editingIndex: null,
            requiredWarnings: {},
            startEditIdx: openItemIndex,
          };
        },
        created() {
          if (this.startEditIdx !== null) {
            this.editItem(this.startEditIdx);
          }
        },
        computed: {
          subtotal() {
            return this.items.reduce((s, it) => {
              const optsPerUnit = (it.options || []).reduce((so, op) => so + (Number(op.price || 0) * (Number(op.quantity || 1) || 1)), 0);
              return s + (Number(it.price || 0) + optsPerUnit) * (Number(it.quantity || 1) || 1);
            }, 0);
          },
          optionsTotal() {
            const base = Number(this.activeProduct?.price || 0) || 0;
            const optsSum = this.chosenOptions.reduce((s, o) => s + (Number(o.price || 0) * (Number(o.quantity || 1) || 1)), 0);
            return (base + optsSum) * (Number(this.optionQty) || 1);
          },
          flatMenuOptions() {
            if (!this.activeProduct || !this.activeProduct.optionGroups) return [];
            return this.activeProduct.optionGroups.reduce((acc, g) => acc.concat(g.options || []), []);
          }
        },
        methods: {
          fmt(v) { return formatCurrency(v); },
          // --- Cart methods ---
          removeItem(i) { this.items.splice(i, 1); },
          incQty(i) { this.items[i].quantity++; },
          decQty(i) { if (this.items[i].quantity > 1) this.items[i].quantity--; },
          openCatalog() { this.screen = 'catalog'; },
          // --- Catalog methods ---
          selectProduct(p) {
            this.activeProduct = JSON.parse(JSON.stringify(p));
            this.chosenOptions = [];
            this.optionQty = 1;
            this.editingIndex = null;
            this.requiredWarnings = {};
            this.screen = 'options';
          },
          backToCatalog() { this.screen = 'catalog'; this.activeProduct = null; },
          backToCart() { this.screen = 'cart'; this.activeProduct = null; },
          // --- Edit existing item ---
          editItem(idx) {
            const it = this.items[idx];
            if (!it) return;
            this.editingIndex = idx;
            this.optionQty = Number(it.quantity || 1);
            // find product in menu by productId or name
            let found = null;
            for (const c of this.categories) {
              if (it.productId) found = (c.products || []).find(p => String(p.id) === String(it.productId));
              if (!found) found = (c.products || []).find(p => String(p.name) === String(it.name));
              if (found) break;
            }
            if (found) {
              this.activeProduct = JSON.parse(JSON.stringify(found));
              // reconstruct chosen options from item's saved options
              const flatOpts = (found.optionGroups || []).reduce((acc, g) => acc.concat(g.options || []), []);
              this.chosenOptions = (it.options || []).map(o => {
                const qty = Number(o.quantity || 1) || 1;
                const match = flatOpts.find(po => (po.id && String(po.id) === String(o.id)) || String(po.name) === String(o.name));
                return match ? { ...match, quantity: qty } : { id: o.id, name: o.name, price: Number(o.price || 0), quantity: qty };
              });
            } else {
              // product not in menu - show with minimal data
              this.activeProduct = { name: it.name, price: it.price, optionGroups: [] };
              this.chosenOptions = (it.options || []).map(o => ({ ...o }));
            }
            this.requiredWarnings = {};
            this.screen = 'options';
          },
          // --- Options methods ---
          isOptionSelected(opt) {
            if (!opt) return false;
            const key = opt.id != null ? String(opt.id) : null;
            return this.chosenOptions.some(co => (key && co.id != null) ? String(co.id) === key : String(co.name) === String(opt.name));
          },
          qtyFor(groupId, optId) {
            const key = optId != null ? String(optId) : null;
            const found = this.chosenOptions.find(co => (key && co.id != null) ? String(co.id) === key : String(co.name) === String(optId));
            return found ? (Number(found.quantity) || 0) : 0;
          },
          selectRadio(group, opt) {
            const ids = (group.options || []).map(o => o.id != null ? String(o.id) : null);
            this.chosenOptions = this.chosenOptions.filter(co => {
              if (co.id != null && ids.includes(String(co.id))) return false;
              if ((group.options || []).some(o => String(o.name) === String(co.name))) return false;
              return true;
            });
            this.chosenOptions.push({ id: opt.id, name: opt.name, price: Number(opt.price || 0), quantity: 1 });
            this.requiredWarnings = {};
          },
          changeOptionQty(group, opt, delta) {
            const keyId = opt.id != null ? String(opt.id) : null;
            const idx = this.chosenOptions.findIndex(co => (keyId && co.id != null) ? String(co.id) === keyId : String(co.name) === String(opt.name));
            if (idx === -1) {
              if (delta > 0) this.chosenOptions.push({ id: opt.id, name: opt.name, price: Number(opt.price || 0), quantity: Math.max(1, delta) });
              return;
            }
            const next = (Number(this.chosenOptions[idx].quantity || 0)) + delta;
            if (next <= 0) this.chosenOptions.splice(idx, 1);
            else this.chosenOptions.splice(idx, 1, { ...this.chosenOptions[idx], quantity: next });
            this.requiredWarnings = {};
          },
          selectedCountForGroup(g) {
            const ids = (g.options || []).map(o => o.id != null ? String(o.id) : null);
            let cnt = 0;
            for (const co of this.chosenOptions) {
              if (co.id != null && ids.includes(String(co.id))) cnt += Number(co.quantity || 1) || 1;
              else if ((g.options || []).some(o => String(o.name) === String(co.name))) cnt += Number(co.quantity || 1) || 1;
            }
            return cnt;
          },
          validateOptionGroups() {
            this.requiredWarnings = {};
            const groups = this.activeProduct?.optionGroups || [];
            let ok = true;
            for (const g of groups) {
              const min = Number(g.min || 0) || 0;
              if (min > 0 && this.selectedCountForGroup(g) < min) {
                this.requiredWarnings[g.id] = true;
                ok = false;
              }
            }
            return ok;
          },
          confirmOptions() {
            if (!this.activeProduct) return;
            if (!this.validateOptionGroups()) return;
            const payload = {
              name: this.activeProduct.name,
              quantity: this.optionQty,
              price: Number(this.activeProduct.price || 0),
              productId: this.activeProduct.id || null,
              options: this.chosenOptions.map(o => ({ id: o.id, name: o.name, price: Number(o.price || 0), quantity: Number(o.quantity || 1) })),
            };
            if (this.editingIndex !== null) {
              this.items.splice(this.editingIndex, 1, payload);
            } else {
              this.items.push(payload);
            }
            this.editingIndex = null;
            this.activeProduct = null;
            this.chosenOptions = [];
            this.screen = 'cart';
          },
          removeChosenOption(i) { this.chosenOptions.splice(i, 1); },
        },
        render() {
          const vm = this;

          // ===== OPTIONS SCREEN =====
          if (vm.screen === 'options' && vm.activeProduct) {
            const groups = vm.activeProduct.optionGroups || [];
            const children = [];

            // Header
            children.push(h('div', { style: 'display:flex;justify-content:space-between;align-items:start;margin-bottom:12px' }, [
              h('div', [
                h('h6', { style: 'margin:0;font-weight:600' }, [
                  vm.activeProduct.name, ' ',
                  h('span', { class: 'text-muted small' }, vm.fmt(vm.activeProduct.price))
                ]),
                vm.activeProduct.description ? h('div', { class: 'small text-muted' }, vm.activeProduct.description) : null,
              ]),
            ]));

            // Quantity
            children.push(h('div', { style: 'margin-bottom:12px;display:flex;align-items:center;gap:8px' }, [
              h('label', { class: 'form-label small mb-0' }, 'Quantidade:'),
              h('div', { style: 'display:flex;align-items:center;gap:6px' }, [
                h('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary', onClick: (e) => { e.preventDefault(); if (vm.optionQty > 1) vm.optionQty--; } }, '-'),
                h('span', { class: 'fw-bold', style: 'min-width:24px;text-align:center' }, String(vm.optionQty)),
                h('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary', onClick: (e) => { e.preventDefault(); vm.optionQty++; } }, '+'),
              ])
            ]));

            // Option groups
            if (groups.length > 0) {
              children.push(h('div', { class: 'small fw-semibold mb-2' }, 'Opcionais'));
              children.push(h('div', { style: 'max-height:280px;overflow:auto' }, groups.map(g => {
                const isRadio = g.max === 1;
                const gChildren = [];
                // Group header
                gChildren.push(h('div', { style: 'display:flex;align-items:center;justify-content:space-between;margin-bottom:4px' }, [
                  h('div', { class: 'small text-muted' }, g.name),
                  vm.requiredWarnings[g.id] ? h('span', { class: 'badge bg-danger ms-2' }, 'OBRIGATÓRIO') : null,
                ]));
                // Options
                (g.options || []).forEach(opt => {
                  if (isRadio) {
                    gChildren.push(h('div', { style: 'display:flex;justify-content:space-between;align-items:center;padding:4px 0' }, [
                      h('div', [
                        h('span', { class: 'small' }, opt.name),
                        h('span', { class: 'small text-muted ms-1' }, Number(opt.price) > 0 ? vm.fmt(opt.price) : 'Grátis'),
                      ]),
                      h('input', { type: 'radio', name: 'grp-' + g.id, class: 'form-check-input', checked: vm.isOptionSelected(opt),
                        onChange: () => vm.selectRadio(g, opt) })
                    ]));
                  } else {
                    const qty = vm.qtyFor(g.id, opt.id);
                    gChildren.push(h('div', { style: 'display:flex;justify-content:space-between;align-items:center;padding:4px 0' }, [
                      h('div', [
                        h('span', { class: 'small' }, opt.name),
                        h('span', { class: 'small text-muted ms-1' }, Number(opt.price) > 0 ? vm.fmt(opt.price) : 'Grátis'),
                      ]),
                      qty === 0
                        ? h('button', { type: 'button', class: 'btn btn-sm btn-primary', onClick: (e) => { e.preventDefault(); vm.changeOptionQty(g, opt, 1); } }, '+')
                        : h('div', { style: 'display:flex;align-items:center;gap:6px' }, [
                            h('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary', onClick: (e) => { e.preventDefault(); vm.changeOptionQty(g, opt, -1); } }, '-'),
                            h('span', { class: 'fw-bold' }, String(qty)),
                            h('button', { type: 'button', class: 'btn btn-sm btn-primary', onClick: (e) => { e.preventDefault(); vm.changeOptionQty(g, opt, 1); } }, '+'),
                          ])
                    ]));
                  }
                });
                return h('div', { style: 'margin-bottom:12px;padding:8px;background:#f8f9fa;border-radius:8px' }, gChildren);
              })));
            }

            // Chosen options summary for items without groups in menu
            if (!groups.length && vm.chosenOptions.length > 0) {
              children.push(h('div', { class: 'small fw-semibold mb-2' }, 'Opcionais do item'));
              children.push(h('div', { style: 'margin-bottom:8px' }, vm.chosenOptions.map((opt, oi) =>
                h('div', { key: oi, style: 'display:flex;justify-content:space-between;align-items:center;padding:4px 0' }, [
                  h('span', { class: 'small' }, [(opt.quantity > 1 ? opt.quantity + 'x ' : ''), opt.name, ' ', h('span', { class: 'text-muted' }, '(' + vm.fmt(opt.price) + ')')]),
                  h('button', { type: 'button', class: 'btn btn-sm btn-outline-danger', onClick: (e) => { e.preventDefault(); vm.removeChosenOption(oi); } }, '×')
                ])
              )));
            }

            // Footer
            children.push(h('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-top:12px;padding-top:12px;border-top:1px solid #dee2e6' }, [
              h('div', { class: 'fw-semibold' }, 'Total: ' + vm.fmt(vm.optionsTotal)),
              h('div', { style: 'display:flex;gap:8px' }, [
                h('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary',
                  onClick: (e) => { e.preventDefault(); vm.editingIndex = null; vm.screen = (vm.startEditIdx === null && vm.categories.length) ? 'catalog' : 'cart'; } }, 'Voltar'),
                h('button', { type: 'button', class: 'btn btn-sm btn-success',
                  onClick: (e) => { e.preventDefault(); vm.confirmOptions(); } }, vm.editingIndex !== null ? 'Atualizar' : 'Adicionar'),
              ])
            ]));

            return h('div', { style: 'text-align:left' }, children);
          }

          // ===== CATALOG SCREEN =====
          if (vm.screen === 'catalog') {
            const catChildren = [];
            catChildren.push(h('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:12px' }, [
              h('h6', { style: 'margin:0;font-weight:600' }, 'Adicionar produto'),
              h('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary', onClick: (e) => { e.preventDefault(); vm.backToCart(); } }, 'Voltar'),
            ]));
            if (vm.categories.length === 0) {
              catChildren.push(h('div', { class: 'text-muted small' }, 'Menu não disponível. Adicione itens manualmente no carrinho.'));
            } else {
              catChildren.push(h('div', { style: 'max-height:380px;overflow:auto' }, vm.categories.map(cat =>
                h('div', { key: cat.id, style: 'margin-bottom:12px' }, [
                  h('div', { class: 'fw-semibold small mb-1' }, cat.name),
                  h('div', { style: 'display:flex;flex-direction:column;gap:4px' },
                    (cat.products || []).map(p =>
                      h('button', { type: 'button', class: 'btn btn-light btn-sm text-start', key: p.id,
                        style: 'display:flex;justify-content:space-between',
                        onClick: (e) => { e.preventDefault(); vm.selectProduct(p); }
                      }, [
                        h('span', p.name),
                        h('span', { class: 'text-muted' }, vm.fmt(p.price))
                      ])
                    )
                  )
                ])
              )));
            }
            return h('div', { style: 'text-align:left' }, catChildren);
          }

          // ===== CART SCREEN (default) =====
          const cartChildren = [];
          cartChildren.push(h('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:12px' }, [
            h('h6', { style: 'margin:0;font-weight:600' }, 'Itens do pedido'),
            h('span', { class: 'small text-muted' }, 'Subtotal: ' + vm.fmt(vm.subtotal)),
          ]));

          if (vm.items.length === 0) {
            cartChildren.push(h('div', { class: 'text-muted small mb-3' }, 'Nenhum item no pedido.'));
          } else {
            cartChildren.push(h('div', { style: 'max-height:340px;overflow:auto;margin-bottom:8px' }, vm.items.map((it, idx) => {
              const optsPerUnit = (it.options || []).reduce((s, op) => s + (Number(op.price || 0) * (Number(op.quantity || 1) || 1)), 0);
              const itemTotal = (Number(it.price || 0) + optsPerUnit) * Number(it.quantity || 1);
              return h('div', { key: idx, style: 'padding:10px;background:#f8f9fa;border-radius:8px;margin-bottom:8px' }, [
                // Name + total
                h('div', { style: 'display:flex;justify-content:space-between;align-items:center' }, [
                  h('div', [h('strong', it.quantity + 'x'), ' ', it.name]),
                  h('div', { class: 'fw-semibold' }, vm.fmt(itemTotal))
                ]),
                // Options list (combo slots indentados sem preço, addons como antes)
                (it.options && it.options.length) ? h('div', { class: 'small text-muted ms-3 mt-1' },
                  it.options.map((op, oi) => {
                    if (op && op.kind === 'combo_slot') {
                      const label = op.slotName ? (op.slotName + ': ') : '';
                      return h('div', { key: oi }, '  ' + label + (op.name || ''));
                    }
                    return h('div', { key: oi }, '+ ' + (Number(op.quantity || 1) > 1 ? op.quantity + 'x ' : '') + op.name + (Number(op.price) > 0 ? ' (' + vm.fmt(op.price) + ')' : ''));
                  })
                ) : null,
                // Action buttons
                h('div', { style: 'display:flex;gap:6px;margin-top:6px' }, [
                  h('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary', onClick: (e) => { e.preventDefault(); vm.incQty(idx); } }, '+1'),
                  h('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary', onClick: (e) => { e.preventDefault(); vm.decQty(idx); } }, '-1'),
                  h('button', { type: 'button', class: 'btn btn-sm btn-outline-primary', onClick: (e) => { e.preventDefault(); vm.editItem(idx); } }, 'Editar'),
                  h('button', { type: 'button', class: 'btn btn-sm btn-outline-danger', onClick: (e) => { e.preventDefault(); vm.removeItem(idx); } }, 'Remover'),
                ])
              ]);
            })));
          }

          // Add item buttons
          cartChildren.push(h('div', { style: 'display:flex;gap:8px' }, [
            vm.categories.length > 0
              ? h('button', { type: 'button', class: 'btn btn-sm btn-outline-primary',
                  onClick: (e) => { e.preventDefault(); vm.openCatalog(); } }, '+ Adicionar do cardápio')
              : null,
            h('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary',
              onClick: (e) => { e.preventDefault(); vm.items.push({ name: '', quantity: 1, price: 0, productId: null, options: [] }); } }, '+ Item manual'),
          ].filter(Boolean)));

          // Manual item edit (for items without productId - inline row)
          const lastItem = vm.items[vm.items.length - 1];
          if (lastItem && !lastItem.name && !lastItem.productId) {
            const li = vm.items.length - 1;
            cartChildren.push(h('div', { style: 'display:flex;gap:6px;align-items:center;margin-top:8px;padding:8px;background:#fff3cd;border-radius:8px' }, [
              h('input', { type: 'number', class: 'form-control form-control-sm', style: 'width:50px;flex-shrink:0', value: lastItem.quantity, min: 1,
                onInput: (e) => { vm.items[li].quantity = Number(e.target.value) || 1; } }),
              h('input', { class: 'form-control form-control-sm', style: 'flex:1', placeholder: 'Nome do item', value: lastItem.name,
                onInput: (e) => { vm.items[li].name = e.target.value; } }),
              h('input', { type: 'number', class: 'form-control form-control-sm', style: 'width:80px;flex-shrink:0', placeholder: 'Preço', value: lastItem.price, step: '0.01', min: 0,
                onInput: (e) => { vm.items[li].price = Number(e.target.value) || 0; } }),
            ]));
          }

          return h('div', { style: 'text-align:left' }, cartChildren);
        }
      };
      try {
        mountedApp = createApp(App);
        vueApp = mountedApp.mount('#swal-items-vue');
      } catch (e) { console.error('Failed to mount items editor', e); }
    },
    preConfirm: () => {
      if (!vueApp || !vueApp.items) return false;
      // Ensure we're on cart screen
      if (vueApp.screen !== 'cart') {
        Swal.showValidationMessage('Finalize a edição do item antes de salvar');
        return false;
      }
      const items = vueApp.items.filter(it => it.name && it.name.trim());
      if (items.length === 0) { Swal.showValidationMessage('Adicione ao menos um item'); return false; }
      return { items };
    },
    willClose: () => {
      if (mountedApp) { try { mountedApp.unmount(); } catch(e){} }
    }
  });

  if (result.isConfirmed && result.value) await saveOrderEdit(result.value);
}

async function editPayment() {
  const o = selectedOrder.value;
  if (!o) return;
  const n = normalizeOrder(o);
  const methods = (companyPaymentMethods.value && companyPaymentMethods.value.length) ? companyPaymentMethods.value : [{ code: 'CASH', name: 'Dinheiro' }];
  const currentMethod = n.paymentMethod || '';
  const currentChange = Number(n.paymentChange || 0);

  // Find initial method code matching currentMethod
  const initialCode = (() => {
    const match = methods.find(m => (m.code || m.name) === currentMethod || m.name === currentMethod);
    return match ? (match.code || match.name) : (methods[0] ? (methods[0].code || methods[0].name) : '');
  })();

  let vueApp = null;
  let mountedApp = null;

  const result = await Swal.fire({
    title: 'Editar pagamento',
    html: '<div id="swal-payment-vue"></div>',
    width: 450,
    showCancelButton: true, confirmButtonText: 'Salvar', cancelButtonText: 'Cancelar', focusConfirm: false,
    didOpen: () => {
      const App = {
        data() {
          return {
            methods,
            selectedMethod: initialCode,
            changeFor: currentChange,
          };
        },
        computed: {
          isCash() {
            const v = (this.selectedMethod || '').toUpperCase();
            return v === 'CASH' || v === 'DINHEIRO';
          }
        },
        methods: {
          getResult() {
            return {
              payment: {
                method: this.selectedMethod,
                methodCode: this.selectedMethod,
                changeFor: this.isCash ? (Number(this.changeFor) || null) : null,
              }
            };
          }
        },
        render() {
          const vm = this;
          const children = [];

          // Payment method select
          children.push(h('div', { style: 'margin-bottom:12px' }, [
            h('label', { class: 'form-label small fw-semibold mb-1' }, 'Forma de pagamento'),
            h('select', {
              class: 'form-select',
              value: vm.selectedMethod,
              onChange: (e) => { vm.selectedMethod = e.target.value; }
            }, vm.methods.map(m =>
              h('option', { key: m.code || m.name, value: m.code || m.name, selected: vm.selectedMethod === (m.code || m.name) }, m.name || m.code)
            ))
          ]));

          // Change (troco) - only for cash
          if (vm.isCash) {
            children.push(h('div', { style: 'margin-bottom:8px' }, [
              h('label', { class: 'form-label small fw-semibold mb-1' }, 'Troco para (R$)'),
              h('input', {
                type: 'number', step: '0.01', min: '0',
                class: 'form-control',
                value: vm.changeFor,
                onInput: (e) => { vm.changeFor = Number(e.target.value) || 0; }
              })
            ]));
          }

          return h('div', { style: 'text-align:left' }, children);
        }
      };
      try {
        mountedApp = createApp(App);
        vueApp = mountedApp.mount('#swal-payment-vue');
      } catch (e) { console.error('Failed to mount payment editor', e); }
    },
    preConfirm: () => {
      if (!vueApp) return false;
      return vueApp.getResult();
    },
    willClose: () => {
      if (mountedApp) { try { mountedApp.unmount(); } catch(e){} }
    }
  });

  if (result.isConfirmed && result.value) await saveOrderEdit(result.value);
}

function isTakeoutOrder(o) {
  if (!o) return false;
  const t = String(o.orderType || o.payload?.orderType || o.payload?.order?.orderType || o.payload?.type || '').toUpperCase();
  return ['TAKEOUT', 'PICKUP', 'TAKE-OUT', 'PICK-UP', 'BALCAO', 'BALCÃO', 'RETIRADA', 'INDOOR'].includes(t);
}

async function markReadyForPickup(o) {
  if (!o || o.status !== 'EM_PREPARO') return;
  const conf = await Swal.fire({
    title: 'Pronto para Retirada?',
    text: `Marcar pedido #${formatDisplay(o)} como pronto para o cliente retirar?`,
    icon: 'question',
    showCancelButton: true,
    confirmButtonText: 'Sim, está pronto',
    cancelButtonText: 'Cancelar'
  });
  if (!conf.isConfirmed) return;
  try {
    loading.value = true;
    await api.patch(`/orders/${o.id}/status`, { status: 'PRONTO' });
    o.status = 'PRONTO';
    Swal.fire({ icon: 'success', text: 'Pedido marcado como pronto!', timer: 1500, showConfirmButton: false });
  } catch (e) {
    console.error('markReadyForPickup error:', e);
    Swal.fire('Erro', 'Falha ao atualizar status.', 'error');
  } finally {
    loading.value = false;
  }
}

async function cancelOrderFromDetails() {
  if (!selectedOrder.value) return;
  const o = selectedOrder.value;
  if (o.status === 'CONCLUIDO' || o.status === 'CANCELADO') return;

  // For iFood orders, fetch available cancellation reasons (required for homologation)
  const externalId = o.externalId || o.payload?.orderId || o.payload?.order?.id || null;
  const isIfood = Boolean(externalId && (
    o.payload?.merchant || o.payload?.order?.merchant ||
    o.payload?.salesChannel === 'IFOOD' ||
    o.payload?.order?.salesChannel === 'IFOOD'
  ));
  let cancellationCode = null;

  if (isIfood && externalId) {
    let reasons = [];
    try {
      const { data } = await api.get(`/integrations/ifood/orders/${encodeURIComponent(externalId)}/cancellationReasons`);
      reasons = Array.isArray(data) ? data : [];
    } catch (e) {
      console.warn('Não foi possível carregar motivos de cancelamento iFood:', e?.response?.data || e?.message);
    }

    if (reasons.length > 0) {
      const options = reasons.map(r => `<option value="${r.cancelCode || r.code}">${r.description || r.cancelCode || r.code}</option>`).join('');
      const result = await Swal.fire({
        title: 'Motivo do cancelamento',
        html: `<p class="text-muted small mb-2">Selecione o motivo para cancelar o pedido iFood #${formatDisplay(o)}:</p><select id="swal-cancel-reason" class="form-select">${options}</select>`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Cancelar pedido',
        cancelButtonText: 'Manter',
        confirmButtonColor: '#dc3545',
        preConfirm: () => document.getElementById('swal-cancel-reason')?.value || null,
      });
      if (!result.isConfirmed) return;
      cancellationCode = result.value || null;
    } else {
      // Fallback: simple confirm if reasons couldn't be loaded
      const conf = await Swal.fire({
        title: 'Cancelar pedido iFood?',
        text: `Tem certeza que deseja cancelar o pedido #${formatDisplay(o)}?`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Sim, cancelar',
        cancelButtonText: 'Manter',
        confirmButtonColor: '#dc3545',
      });
      if (!conf.isConfirmed) return;
    }
  } else {
    const conf = await Swal.fire({
      title: 'Cancelar pedido?',
      text: `Tem certeza que deseja cancelar o pedido #${formatDisplay(o)}?`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sim, cancelar',
      cancelButtonText: 'Manter',
      confirmButtonColor: '#dc3545'
    });
    if (!conf.isConfirmed) return;
  }

  try {
    loading.value = true;
    const extra = cancellationCode ? { cancellationCode } : {};
    await store.updateStatus(o.id, 'CANCELADO', extra);
    await store.fetch();
    closeDetails();
    Swal.fire({ icon: 'success', title: 'Pedido cancelado', timer: 2000, toast: true, position: 'top-end', showConfirmButton: false });
  } catch (e) {
    console.error(e);
    Swal.fire('Erro', 'Falha ao cancelar pedido.', 'error');
  } finally {
    loading.value = false;
  }
}

const STATUS_LABEL = {
  PENDENTE_ACEITE: 'Pendente de aceite',
  EM_PREPARO: 'Em preparo',
  PRONTO: 'Pronto p/ retirada',
  SAIU_PARA_ENTREGA: 'Saiu para entrega',
  CONCLUIDO: 'Concluído',
  CONFIRMACAO_PAGAMENTO: 'Confirmação de pagamento',
  CANCELADO: 'Cancelado',
  INVOICE_AUTHORIZED: 'NFC-e Autorizada',
};

// columns to render (order matters)
const COLUMNS = [
  { key: 'EM_PREPARO', label: 'Novos / Em preparo' },
  { key: 'SAIU_PARA_ENTREGA', label: 'Entrega / Aguardando retirada', also: ['PRONTO'] },
  { key: 'CONFIRMACAO_PAGAMENTO', label: 'Confirmação de pagamento' },
  { key: 'CONCLUIDO', label: 'Concluído' }
];

function columnOrders(key) {
  // derive column items from the already-filteredOrders to keep filters consistent
  const col = COLUMNS.find(c => c.key === key);
  const accepted = [key.toUpperCase(), ...(col && col.also ? col.also.map(s => s.toUpperCase()) : [])];
  try {
    return filteredOrders.value.filter((o) => {
      if (!o) return false;
      if (!hasCashSession.value && o.outOfSession) return false;
      return accepted.includes((o.status || '').toUpperCase());
    }).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
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

// Pending orders (awaiting manual acceptance)
const pendingOrders = computed(() => {
  return (store.orders || []).filter(o => o && (o.status || '').toUpperCase() === 'PENDENTE_ACEITE');
});

// Cash session awareness
const hasCashSession = ref(true); // assume open until checked

async function checkCashSession() {
  try {
    const { data } = await api.get('/cash/current');
    hasCashSession.value = !!data;
  } catch {
    hasCashSession.value = false;
  }
}

const noCashOrders = computed(() => {
  if (hasCashSession.value) return [];
  return (store.orders || []).filter(o => {
    if (!o) return false;
    const status = (o.status || '').toUpperCase();
    return o.outOfSession === true
      && status !== 'CONCLUIDO'
      && status !== 'CANCELADO'
      && status !== 'PENDENTE_ACEITE';
  });
});

function onCashSessionOpened() {
  hasCashSession.value = true;
  store.fetch();
}

async function acceptPendingOrder(o) {
  try {
    o._accepting = true;
    await api.post(`/orders/${o.id}/accept`);
  } catch (e) {
    console.error('Accept failed:', e);
    Swal.fire({ icon: 'error', title: 'Erro ao aceitar', text: e?.response?.data?.message || e.message, toast: true, timer: 4000, position: 'top-end', showConfirmButton: false });
  } finally {
    o._accepting = false;
  }
}

async function rejectPendingOrder(o) {
  const r = await Swal.fire({
    title: 'Recusar pedido?',
    text: `#${formatDisplay(o)} - ${o.customerName || 'Cliente'}`,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: 'Recusar',
    cancelButtonText: 'Voltar',
    confirmButtonColor: '#dc3545',
  });
  if (!r.isConfirmed) return;
  try {
    o._accepting = true;
    await api.post(`/orders/${o.id}/reject`);
  } catch (e) {
    console.error('Reject failed:', e);
    Swal.fire({ icon: 'error', title: 'Erro ao recusar', text: e?.response?.data?.message || e.message, toast: true, timer: 4000, position: 'top-end', showConfirmButton: false });
  } finally {
    o._accepting = false;
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
    // 0) Fetch fresh order from backend to ensure latest payload data (including iFood details)
    try {
      const { data: freshOrder } = await api.get(`/orders/${order.id}`);
      if (freshOrder && freshOrder.id) order = freshOrder;
    } catch (_) { /* non-fatal: proceed with cached order */ }

    // 0b) Se o payload do iFood está incompleto (sem order.details), busca do iFood agora
    const hasIfoodId = order.externalId || order.payload?.orderId;
    const missingIfoodDetails = hasIfoodId && !order.payload?.order;
    if (missingIfoodDetails) {
      try {
        const { data: enriched } = await api.post(`/orders/${order.id}/refresh-ifood`);
        if (enriched && enriched.id) order = enriched;
      } catch (_) { /* non-fatal: continue with available data */ }
    }

    // 1) generate ticket QR on the server so token is fresh/unique
    let qrDataUrl = null;
    let ticketQrUrl = null;
    try {
      const { data: t } = await api.post(`/orders/${order.id}/tickets`);
      if (t && t.qrUrl) {
        ticketQrUrl = t.qrUrl;
        qrDataUrl = await QRCode.toDataURL(t.qrUrl, { width: 220, margin: 2 });
      }
    } catch (e) {
      // ignore ticket generation failure and fallback to no-QR preview
      console.warn('Falha ao gerar ticket/QR para pré-visualização', e);
    }

    // 2) Fetch printer settings BEFORE opening modal so the component renders immediately
    let printerSetting = null;
    try {
      const { data: agentData } = await api.get('/agent-setup');
      printerSetting = agentData.printerSetting || null;
    } catch (_) { /* sem configurações de impressora */ }

    // show QR and receipt using the Vue ticket component mounted inside the Swal modal
    try {
      // if server returned an explicit QR URL token, attach to order so component can build QR
      if (ticketQrUrl) order.url = ticketQrUrl;
      const rootId = `ticket-root-${Date.now()}`;
      let appInstance = null;
      await Swal.fire({
        title: `Comanda ${escapeHtml(formatDisplay(order))}`,
        html: `<div id="${rootId}" style="display:flex;justify-content:center"></div>`,
        width: Math.min(window.innerWidth - 40, 560),
        showCloseButton: true,
        didOpen: () => {
          try {
            const el = document.getElementById(rootId);
            if (el) {
              appInstance = createApp(OrderTicketPreview, { order, printerSetting });
              appInstance.mount(el);
            }
          } catch (err) {
            console.warn('Failed to mount OrderTicketPreview', err);
          }
        },
        willClose: () => {
          try { if (appInstance) appInstance.unmount(); } catch(e) {}
        },
        confirmButtonText: 'Fechar',
        focusConfirm: false,
      });
    } catch (e) {
      console.warn('Falha ao abrir componente de pré-visualização, tentando fallback', e);
      // fallback: open a plain new tab with textual preview
      const w = window.open('', '_blank');
      if (!w) {
        Swal.fire('Bloqueado', 'Não foi possível abrir a janela de visualização (bloqueador de popups).', 'warning');
        return;
      }
      const textFallback = (printService && printService.formatOrderText) ? printService.formatOrderText(order) : (`Comanda: ${formatDisplay(order)}\n\n` + JSON.stringify(order, null, 2));
      let html = `<!doctype html><html><head><meta charset="utf-8"><title>Comanda ${escapeHtml(formatDisplay(order))}</title>
        <style>body{font-family:monospace;white-space:pre-wrap;padding:16px} .qr-wrap{display:flex;justify-content:center;margin-top:12px} .receipt-box{max-width:520px;margin:0 auto}</style></head><body><div class="receipt-box"><pre>${escapeHtml(textFallback)}</pre>`;
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
  if (!printingEnabled.value) {
    Swal.fire({ icon: 'info', title: 'Impressão desabilitada no módulo', text: 'O módulo de impressão está desabilitado, mas será feita uma tentativa de envio ao agente/QZ.', timer: 3500, toast: true, position: 'top-end', showConfirmButton: false });
  }
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
  if (!ridersEnabled.value) {
    // Riders module disabled: do not show assignment modal
    return
  }
  // Fetch riders and open a Vue modal that uses ListGroup for selection
  const riders = (await store.fetchRiders()) || [];
  assignModalRiders.value = riders.map(r => ({ id: r.id, name: r.name, description: r.whatsapp || 'sem WhatsApp', whatsapp: r.whatsapp || '' }));
  assignSelectedRider.value = null;
  // Clear bulk state when opening for single order
  bulkAssignOrders.value = [];
  // store only the id to avoid references being lost; handlers only need the id
  assignModalOrder.value = order ? { id: order.id } : null;
  // Close any open SweetAlert modal to avoid overlays stacking
  try { Swal.close(); } catch(e) {}
  await nextTick();
  assignModalVisible.value = true;

  // Modal Vue opened; selection/dispatch handled inside the modal UI
}

// Change/assign rider from order details (no status change, no notification)
async function changeRider(order) {
  if (!order) return;
  const riders = (await store.fetchRiders()) || [];
  assignModalRiders.value = riders.map(r => ({ id: r.id, name: r.name, description: r.whatsapp || 'sem WhatsApp', whatsapp: r.whatsapp || '' }));
  assignSelectedRider.value = order.rider ? String(order.rider.id) : null;
  bulkAssignOrders.value = [];
  assignModalOrder.value = { id: order.id, _changeOnly: true };
  try { Swal.close(); } catch(e) {}
  await nextTick();
  assignModalVisible.value = true;
}

async function changeStatus(order, to) {
  try {
    if (to === 'SAIU_PARA_ENTREGA') {
      if (!ridersEnabled.value || isTakeoutOrder(order)) {
        // Riders module disabled or takeout order: just change status without asking for a rider
        await store.updateStatus(order.id, 'SAIU_PARA_ENTREGA')
        await store.fetch()
        return
      }
      await openAssignModal(order);
      return;
    }
    // If moving from payment confirmation to concluded, show payment confirmation modal
    if (to === 'CONCLUIDO' && order && order.status === 'CONFIRMACAO_PAGAMENTO') {
      // Allow multiple payment methods with editable amounts.
      const orderTotal = Number(order.total || 0);

      // Zero-value orders (bonifications, exchanges, etc.) skip payment modal
      if (orderTotal === 0) {
        await store.updateStatus(order.id, 'CONCLUIDO', { payment: { amount: 0 } });
        await store.fetch();
        return;
      }
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
  { to: 'PRONTO', label: 'Pronto p/ retirada' },
  { to: 'SAIU_PARA_ENTREGA', label: 'Saiu p/ entrega' },
  { to: 'CONFIRMACAO_PAGAMENTO', label: 'Confirmação de pagamento' },
  { to: 'CONCLUIDO', label: 'Concluído' },
  { to: 'CANCELADO', label: 'Cancelar' },
];

const statusFilters = [
  { value: 'TODOS', label: 'Todos', color: 'secondary' },
  { value: 'EM_PREPARO', label: 'Em preparo', color: 'warning' },
  { value: 'PRONTO', label: 'Pronto p/ retirada', color: 'info' },
  { value: 'SAIU_PARA_ENTREGA', label: 'Saiu p/ entrega', color: 'primary' },
  { value: 'CONFIRMACAO_PAGAMENTO', label: 'Confirmação de pagamento', color: 'info' },
  { value: 'CONCLUIDO', label: 'Concluído', color: 'success' },
  { value: 'CANCELADO', label: 'Cancelado', color: 'danger' },
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
  const html = `
    <div class="wa-choices">
      <div class="mb-2 small text-muted">Escolha uma mensagem:</div>
      <div id="wa_preview" class="wa-preview mb-2 small text-muted">(nenhuma mensagem selecionada)</div>
      <div id="wa_vue"></div>
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
      const mountEl = popup.querySelector('#wa_vue');
      if (!mountEl) return;
      const msgs = Object.keys(riderWhatsAppMessages).map(k => ({ key: k, text: String(riderWhatsAppMessages[k]) }));
      const App = {
        components: { ListGroup },
        data() { return { msgs, selected: null }; },
        template: `<div><ListGroup :items="msgs" itemKey="key" :selectedId="selected" :showActions="false" @select="onSelect"><template #primary="{ item }"><div class=\"small text-start\">{{ item.text }}</div></template></ListGroup></div>`,
        methods: {
          onSelect(v){
            this.selected = v;
            const hid = document.getElementById('wa_selected'); if(hid) hid.value = v;
            const preview = popup.querySelector('#wa_preview'); if(preview) preview.innerText = (riderWhatsAppMessages && riderWhatsAppMessages[v]) || '(nenhuma mensagem selecionada)';
            // visually mark active via ListGroup selected class
          }
        }
      };
      try{
        const vm = createApp({
          data(){ return { selected: null, msgs } },
          render() {
            return h(ListGroup, {
              items: this.msgs,
              itemKey: 'key',
              selectedId: this.selected,
              showActions: false,
              onSelect: (v) => this.onSelect(v)
            }, {
              primary: ({ item }) => h('div', { class: 'small text-start' }, item.text)
            });
          },
          methods: {
            onSelect(v){
              this.selected = v;
              const hid = document.getElementById('wa_selected'); if(hid) hid.value = v;
              const preview = popup.querySelector('#wa_preview'); if(preview) preview.innerText = (riderWhatsAppMessages && riderWhatsAppMessages[v]) || '(nenhuma mensagem selecionada)';
            }
          }
        }).mount(mountEl);
      }catch(e){ console.error('failed to mount wa list', e); }
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

async function openPdv(){
  try{
    pdvPreset.value = null;
  }catch(e){}
  // If a phone is provided, try to preload customer and if they have saved addresses,
  // open the PDV wizard directly on the address-selection step.
  try{
    const phone = String(newOrderPhone.value || '').replace(/\D/g,'');
    if (phone) {
      const res = await api.get(`/customers?q=${encodeURIComponent(phone)}`);
      const rows = res.data?.rows || [];
      const match = rows.find(c => {
        const d = String((c.whatsapp||c.phone||'')).replace(/\D/g,'');
        return d.length>0 && d.slice(-8) === phone.slice(-8);
      });
      if (match && Array.isArray(match.addresses) && match.addresses.length>0) {
        pdvPreset.value = { customerName: match.fullName || match.name || '', orderType: 'DELIVERY', autoStep: 2 };
      } else {
        pdvPreset.value = { orderType: 'DELIVERY' };
      }
    } else {
      pdvPreset.value = { orderType: 'DELIVERY' };
    }
  }catch(e){ pdvPreset.value = { orderType: 'DELIVERY' } }
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
    <!-- Unified Pedidos toolbar card — title + actions + Novo Pedido + filters all together -->
    <div class="orders-toolbar card mb-4" style="border:none;">
      <div class="card-body">

        <!-- Top row: title + sound + Impressora + Caixa -->
        <div class="orders-toolbar__top d-flex flex-wrap align-items-center gap-2 mb-3">
          <h2 class="fs-4 fw-semibold m-0 orders-toolbar__title" style="position:relative;">Pedidos
            <!-- dev-only socket status badge (hidden via CSS; ::after dot replaces it) -->
            <div style="position: absolute;width: 12px;height: 12px;border: 2px solid rgb(255, 255, 255);padding: 0px !important;right: -10px;bottom: 4px;" v-if="socketConnection" class="ms-3 badge" :class="{
              'bg-success': socketConnection.status === 'connected',
              'bg-warning text-dark': socketConnection.status === 'reconnecting',
              'bg-danger': socketConnection.status === 'error' || socketConnection.status === 'disconnected',
              'bg-secondary': socketConnection.status === 'connecting' || socketConnection.status === 'idle'
            }">
              <small v-if="socketConnection.url" class="d-block text-truncate" ></small>
            </div>
          </h2>
          <div class="flex-grow-1"></div>
          <!-- Sound -->
          <button
            ref="soundButton"
            type="button"
            class="btn btn-sm d-none d-sm-flex"
            :class="playSound ? 'btn-primary' : 'btn-outline-secondary'"
            @click="toggleSound"
            title="Som de novos pedidos"
          >
            <i :class="playSound ? 'bi bi-volume-up-fill' : 'bi bi-volume-mute-fill'"></i>
          </button>
          <!-- Impressora -->
          <button type="button" :class="['btn btn-sm', printerConnected ? 'btn-primary' : 'btn-outline-primary']" @click="showPrinterConfig = true" title="Configurar impressora">
            <i class="bi bi-printer"></i>&nbsp;Impressora
            <span v-if="printerConnected" class="badge bg-success ms-2" style="font-size:0.65rem; vertical-align:middle">Conectada</span>
          </button>
          <!-- Test print (dev) -->
          <button v-if="printingEnabled" type="button" class="btn btn-sm btn-outline-primary" @click="sendTestPrint" title="Enviar comanda de teste">
            <i class="bi bi-printer"></i>&nbsp;Teste Impressão
          </button>
          <!-- Caixa -->
          <CashControl />
        </div>

        <!-- Novo Pedido: phone input + Entrega/Balcão buttons -->
        <div class="orders-new-row d-flex flex-wrap align-items-center gap-2 mb-3">
          <div class="orders-new-input">
            <TextInput v-model="newOrderPhone" placeholder="Digite o telefone do cliente e comece um novo pedido." inputClass="form-control" />
          </div>
          <button type="button" class="orders-new-btn orders-new-btn--filled" @click="openPdv">
            <i class="bi bi-plus-lg"></i> Entrega
          </button>
          <button type="button" class="orders-new-btn orders-new-btn--outline" @click="openBalcao" title="Pedido balcão">
            <i class="bi bi-plus-lg"></i> Balcão
          </button>
        </div>

        <!-- Mobile-only status pills -->
        <div class="d-inline-flex gap-2 d-md-none pb-2 w-100 overflow-auto mb-3">
          <button
            v-for="s in statusFiltersMobile"
            :key="s.value"
            type="button"
            class="action-chip"
            :class="{ 'action-chip--active': selectedStatus === s.value }"
            @click="selectedStatus = s.value"
          >
            {{ s.label }}
          </button>
        </div>

        <!-- Filter row: Entrega/Retirada toggles + rider/payment/Nº/name -->
        <div
          class="orders-filter-row d-flex flex-wrap align-items-center gap-2"
          :class="{ 'orders-filter-row--expanded': showAdvancedFilters }"
        >
          <button
            type="button"
            class="orders-toggle"
            :class="{ 'orders-toggle--on': filterEntrega }"
            @click="filterEntrega = !filterEntrega"
          >
            <span class="orders-toggle__check"><i v-if="filterEntrega" class="bi bi-check-lg"></i></span>
            <i class="bi bi-bicycle orders-toggle__ic"></i>
            <span class="orders-toggle__label">Entrega</span>
          </button>
          <button
            type="button"
            class="orders-toggle"
            :class="{ 'orders-toggle--on': filterRetirada }"
            @click="filterRetirada = !filterRetirada"
          >
            <span class="orders-toggle__check"><i v-if="filterRetirada" class="bi bi-check-lg"></i></span>
            <i class="bi bi-bag orders-toggle__ic"></i>
            <span class="orders-toggle__label">Retirada</span>
          </button>
          <div class="flex-grow-1 d-md-none orders-spacer"></div>
          <button
            type="button"
            class="orders-filters-toggle d-md-none"
            :class="{ 'orders-filters-toggle--on': showAdvancedFilters || activeAdvancedFiltersCount }"
            :aria-expanded="showAdvancedFilters"
            title="Filtros avançados"
            @click="showAdvancedFilters = !showAdvancedFilters"
          >
            <i class="bi bi-funnel"></i>
            <span v-if="activeAdvancedFiltersCount" class="orders-filters-toggle__badge">{{ activeAdvancedFiltersCount }}</span>
            <i class="bi bi-chevron-down orders-filters-toggle__chev" :class="{ 'orders-filters-toggle__chev--open': showAdvancedFilters }"></i>
          </button>

          <template v-if="ridersEnabled">
            <div class="orders-adv-control">
              <SelectInput v-model="selectedRider" class="form-select">
                <option value="TODOS">Todos os entregadores</option>
                <option v-for="r in store.riders" :key="r.id" :value="String(r.id)">{{ r.name }}</option>
              </SelectInput>
            </div>
          </template>
          <div class="orders-adv-control">
            <SelectInput v-model="selectedPaymentMethod" class="form-select">
              <option value="TODOS">Todas as formas</option>
              <option v-for="pm in availablePaymentMethods" :key="pm" :value="pm">{{ pm }}</option>
            </SelectInput>
          </div>
          <div class="orders-adv-control orders-adv-control--num">
            <TextInput v-model="searchOrderNumber" placeholder="Nº pedido" inputClass="form-control" />
          </div>
          <div class="orders-adv-control orders-adv-control--name">
            <TextInput v-model="searchCustomerName" placeholder="Nome do cliente" inputClass="form-control" />
          </div>
        </div>
      </div>
    </div>

    <PrinterConfig v-model:visible="showPrinterConfig" @saved="onPrinterSaved" />
    <POSOrderWizard v-model:visible="showPdv" :initialPhone="newOrderPhone" :preset="pdvPreset" @created="onPdvCreated" @update:visible="handlePdvVisibleChange" />

    <!-- Pending acceptance box (iFood orders awaiting manual accept) -->
    <div v-if="pendingOrders.length > 0" class="pending-acceptance-box mb-3">
      <div class="pending-header">
        <i class="bi bi-bell-fill"></i>
        <span class="fw-semibold">{{ pendingOrders.length }} pedido(s) aguardando aceite</span>
      </div>
      <div v-for="o in pendingOrders" :key="o.id" class="pending-card">
        <div class="pending-card-info">
          <div class="fw-semibold">#{{ formatDisplay(o) }} - {{ o.customerName || 'Cliente' }}</div>
          <div class="small text-muted">
            {{ normalizeOrder(o).shortAddress || (normalizeOrder(o).address ? normalizeOrder(o).address.substring(0, 60) : '') }}
            <span v-if="normalizeOrder(o).channelLabel" class="ms-2 badge bg-light text-dark">{{ normalizeOrder(o).channelLabel }}</span>
          </div>
          <div class="small text-muted">
            {{ normalizeOrder(o).items?.length || 0 }} item(ns) · {{ formatCurrency(storeRevenue(o)) }}
          </div>
        </div>
        <div class="pending-card-actions">
          <button class="btn btn-success btn-sm" @click="acceptPendingOrder(o)" :disabled="o._accepting">
            <i class="bi bi-check-lg"></i> Aceitar
          </button>
          <button class="btn btn-outline-danger btn-sm" @click="rejectPendingOrder(o)" :disabled="o._accepting">
            <i class="bi bi-x-lg"></i> Recusar
          </button>
        </div>
      </div>
    </div>

    <!-- Orders without cash session -->
    <div v-if="noCashOrders.length > 0" class="no-cash-box mb-3">
      <div class="no-cash-header">
        <i class="bi bi-cash-coin"></i>
        <span class="fw-semibold">{{ noCashOrders.length }} pedido(s) sem caixa aberto</span>
        <span class="ms-2 small opacity-75">Abra o caixa para movimentar estes pedidos</span>
      </div>
      <div v-for="o in noCashOrders" :key="'nc-'+o.id" class="no-cash-card">
        <div class="no-cash-card-info">
          <div class="fw-semibold">#{{ formatDisplay(o) }} - {{ o.customerName || 'Cliente' }}</div>
          <div class="small text-muted">
            <span class="badge bg-secondary">{{ STATUS_LABEL[o.status] || o.status }}</span>
            <span v-if="normalizeOrder(o).channelLabel" class="ms-2 badge bg-light text-dark">{{ normalizeOrder(o).channelLabel }}</span>
          </div>
        </div>
        <div class="no-cash-card-total fw-bold">
          {{ formatCurrency(storeRevenue(o)) }}
        </div>
      </div>
    </div>

    <!-- Loading state: only during the initial fetch (no orders yet) so a
         refresh later doesn't blank the kanban. -->
    <div v-if="store.loading && (!store.orders || store.orders.length === 0)" class="text-center text-secondary py-5">
      <div class="spinner-border text-primary mb-2" role="status">
        <span class="visually-hidden">Carregando...</span>
      </div>
      <p class="mb-0">Carregando pedidos...</p>
    </div>

    <!-- Orders board: columns with drag & drop -->
    <div v-else-if="store.orders && store.orders.length > 0" class="orders-board">
      <div class="boards d-flex gap-3 overflow-auto justify-content-between">
        <div class="orders-column card" v-for="col in (isMobile ? COLUMNS.filter(c => c.key === selectedStatus) : COLUMNS)" :key="col.key" :data-status="col.key">
          <div class="card-header d-flex align-items-center justify-content-between">
            <div class="fw-semibold">{{ col.label }}</div>
            <div><span class="badge bg-secondary">{{ columnOrders(col.key).length }}</span></div>
          </div>
          <div class="list mt-2  p-2" style="min-height:120px">
            <div v-for="o in columnOrders(col.key)" :key="o.id" class="card card-body w-100 mb-2 order-card" :class="{ 'fade-in': o._isNew, 'selected': isOrderSelected(o) }" :data-order-id="o.id">
              <div class="card-body p-2">
                <!-- Row 1: checkbox + name + channel badge -->
                <div class="oc-header">
                  <label class="order-checkbox" @click.stop>
                    <input type="checkbox" :checked="isOrderSelected(o)" @change="toggleOrderSelection(o)" />
                    <span class="order-checkbox-mark"></span>
                  </label>
                  <span class="oc-title">#{{ formatDisplay(o) }} - <span class="oc-customer-name">{{ o.customerName || 'Cliente' }}</span>
                    <span v-if="getCustomerStats(o)" class="ms-2">

                      <span class="badge tier-badge" :style="{ background: tierBgColors[getCustomerStats(o).tier], color: tierColors[getCustomerStats(o).tier] }">{{ getCustomerStats(o).label }}</span>
                    </span>
                    <span v-if="o.payload?.nfe?.nProt" class="badge bg-info text-dark ms-2" title="NF-e autorizada">
                      <i class="bi bi-receipt-cutoff"></i> NFC-e
                    </span>
                  </span>
                  <span class="oc-channel">{{ normalizeOrder(o).storeName ? (normalizeOrder(o).storeName + (normalizeOrder(o).channelLabel ? ' | ' + normalizeOrder(o).channelLabel : '')) : (normalizeOrder(o).channelLabel || '—') }}</span>
                </div>
                <!-- Scheduled order banner -->
                <div v-if="normalizeOrder(o).scheduledTime" class="oc-scheduled-banner">
                  <i class="bi bi-clock-history"></i> Agendado: {{ new Date(normalizeOrder(o).scheduledTime).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) }} {{ new Date(normalizeOrder(o).scheduledTime).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) }}
                </div>
                <!-- Row 2: info chips -->
                <div class="oc-info">
                  <span v-if="o.customerPhone" class="oc-chip"><i class="bi bi-telephone"></i> {{ o.customerPhone }}</span>
                  <span v-if="normalizeOrder(o).phoneLocalizer" class="oc-chip oc-chip--ifood" title="Localizador do pedido iFood"><i class="bi bi-hash"></i> {{ normalizeOrder(o).phoneLocalizer }}</span>
                  <span v-if="normalizeOrder(o).ifoodConfirmationCode" class="oc-chip oc-chip--ifood" title="Código de confirmação iFood"><i class="bi bi-key"></i> {{ normalizeOrder(o).ifoodConfirmationCode }}</span>
                  <span class="oc-chip"><i class="bi bi-credit-card"></i> {{ normalizeOrder(o).paymentMethod }}<template v-if="normalizeOrder(o).paymentChange"> · Troco para: {{ formatCurrency(normalizeOrder(o).paymentChange) }}<template v-if="changeDue(o) > 0"> ({{ formatCurrency(changeDue(o)) }})</template></template></span>
                  <span
                    v-if="!normalizeOrder(o).isPrepaid && Number(o.total || 0) > 0"
                    class="oc-chip oc-chip--collect"
                    title="Valor que o motoboy deve receber do cliente"
                  >
                    <i class="bi bi-cash-coin"></i> Cobrar {{ formatCurrency(Number(o.total || 0)) }}
                  </span>
                  <template v-if="ridersEnabled">
                    <span class="oc-chip">
                      <i class="bi bi-person-badge"></i> {{ o.rider ? o.rider.name : '—' }}
                      <button v-if="o.rider" class="btn btn-link p-0 ms-1 oc-wa-btn" @click.stop="openWhatsAppToRider(o)" title="WhatsApp"><i class="bi bi-whatsapp text-success"></i></button>
                    </span>
                  </template>
                </div>
                <!-- Row 3: address (truncated) -->
                <div class="oc-address" :title="normalizeOrder(o).address || '-'">{{ normalizeOrder(o).shortAddress || normalizeOrder(o).address || '-' }}</div>

                <!-- Row 4: time + total + actions -->
                 <div class="d-flex justify-content-between">
                  <span class="oc-time">{{ getCreatedDurationDisplay(o) }}</span>
                  <span class="text-end">
                    <span class="oc-total">{{ formatCurrency(storeRevenue(o)) }}</span>
                  </span></div>
                <div class="oc-footer">
                  <span v-if="isIfoodOrder(o)" title="Pedido iFood">
                    <img src="https://logodownload.org/wp-content/uploads/2017/05/ifood-logo-0.png" alt="iFood" style="width:24px;height:24px;object-fit:contain;margin-right:4px;vertical-align:-2px;" />
                    <span v-if="o.status === 'CONCLUIDO' && normalizeOrder(o).closedByIfoodCode" class="badge bg-success ms-1" style="font-size:0.65rem;">com código</span>
                  </span>
                  <div class="oc-actions">
                    <button class="btn btn-sm btn-outline-secondary" @click.stop="openDetails(o)" title="Detalhes"><i class="bi bi-list-ul"></i></button>
                    <button class="btn btn-sm btn-outline-secondary" @click="viewReceipt(o)" title="Visualizar comanda"><i class="bi bi-eye"></i></button>
                    <button class="btn btn-sm btn-outline-secondary" @click="printReceipt(o)" title="Imprimir comanda"><i class="bi bi-printer"></i></button>
                    <button v-if="o.payload?.nfe?.nProt" class="btn btn-sm btn-success" @click.stop="imprimirDanfe(o)" title="Imprimir cupom fiscal"><i class="bi bi-printer"></i></button>
                    <button v-else-if="o.status !== 'CANCELADO'" class="btn btn-sm btn-outline-success" @click.stop="emitirNfeOrder(o)" title="Emitir NF-e"><i class="bi bi-receipt"></i></button>
                    <button v-if="isIfoodOrder(o) && o.status !== 'CONCLUIDO' && o.status !== 'CANCELADO'" class="btn btn-sm btn-outline-danger" @click.stop="sendIfoodChat(o)" title="Enviar mensagem no chat iFood"><i class="bi bi-chat-dots"></i></button>
                    <button v-if="o.status === 'EM_PREPARO' && isTakeoutOrder(o)" class="btn btn-sm btn-info text-white" @click.stop="markReadyForPickup(o)" :disabled="loading" title="Pronto para Retirada">
                      <i class="bi bi-bag-check"></i> Pronto
                    </button>
                    <button v-if="o.status !== 'CONCLUIDO' && o.status !== 'CANCELADO' && o.status !== 'EM_PREPARO' && isTakeoutOrder(o)" class="btn btn-sm btn-info text-white" @click.stop="advanceStatus(o)" :disabled="!getNextStatus(o.status, o) || !store.canTransition(o.status, getNextStatus(o.status, o)) || loading" :title="o.status === 'CONFIRMACAO_PAGAMENTO' ? 'Confirmar pagamento' : 'Pedido Retirado'">
                      <i class="bi bi-bag-check"></i> {{ o.status === 'CONFIRMACAO_PAGAMENTO' ? 'Confirmar' : 'Retirado' }}
                    </button>
                    <button v-if="o.status !== 'CONCLUIDO' && o.status !== 'CANCELADO' && !isTakeoutOrder(o)" class="btn btn-sm btn-primary advance" @click="advanceStatus(o)" :disabled="!getNextStatus(o.status, o) || !store.canTransition(o.status, getNextStatus(o.status, o)) || loading" title="Avançar status">
                      Avançar <i class="bi bi-arrow-right"></i>
                    </button>
                  </div>
                </div>
              </div>
              <div v-if="openTimeline[o.id]" class="p-2 bg-light small border-top">
                <div class="fw-semibold">Itens</div>
                <ul class="mb-1">
                  <li v-for="it in normalizeOrderItems(o)" :key="it.id + it.name">
                    <div class="fw-semibold">{{ it.quantity || 1 }}x {{ it.name }} <span class="text-success ms-2">{{ formatCurrency(itemLineTotal(it)) }}</span></div>
                    <div v-if="(it.quantity || 1) > 1" class="small text-muted ms-3">{{ formatCurrency(it.unitPrice || 0) }} /un</div>
                    <div v-if="extractItemOptions(it).length" class="small ms-3 mt-1">
                      <div v-for="(opt, idx) in extractItemOptions(it)" :key="(opt.name || idx) + idx" style="color: #495057;">
                        <span class="text-muted">+</span> <strong style="font-size:0.75rem;background:#e9ecef;border-radius:4px;padding:1px 4px;">{{ Number(opt.quantity || 1) }}/un</strong> {{ opt.name }}<span v-if="(it.quantity || 1) > 1" class="text-muted"> ({{ (Number(opt.quantity || 1) * Number(it.quantity || 1)) }} total)</span><span v-if="opt.price" class="text-success"> {{ formatCurrency(opt.price) }} /un</span>
                      </div>
                    </div>
                  </li>
                </ul>
                <div v-if="Number(o.discountIfood || 0) > 0" class="mt-2 small" style="color: #198754;">
                  <i class="bi bi-ticket-perforated me-1"></i>
                  <strong>Voucher iFood:</strong> {{ formatCurrency(Number(o.discountIfood)) }}
                </div>
                <div v-if="Number(o.discountMerchant || 0) > 0" class="mt-2 small" style="color: #dc3545;">
                  <i class="bi bi-ticket-perforated me-1"></i>
                  <strong>Desconto Loja:</strong> -{{ formatCurrency(Number(o.discountMerchant)) }}
                </div>
                <div v-else-if="!Number(o.discountIfood || 0) && (normalizeOrder(o).couponCode || normalizeOrder(o).couponDiscount)" class="mt-2 small" style="color: #198754;">
                  <i class="bi bi-ticket-perforated me-1"></i>
                  <strong>{{ normalizeOrder(o).couponCode ? `Voucher (${normalizeOrder(o).couponCode})` : 'Voucher Desconto' }}{{ normalizeOrder(o).couponSponsor ? ` - ${normalizeOrder(o).couponSponsor}` : '' }}:</strong>
                  -{{ formatCurrency(normalizeOrder(o).couponDiscount) }}
                </div>
                <div v-if="normalizeOrder(o).paymentChange" class="mt-2 small">
                  <strong>Troco para:</strong> {{ formatCurrency(normalizeOrder(o).paymentChange) }}<template v-if="changeDue(o) > 0"> ({{ formatCurrency(changeDue(o)) }})</template>
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

    <!-- Bulk actions bar -->
    <div v-if="selectedOrderIds.size > 0" class="bulk-actions-bar">
      <div class="d-flex align-items-center justify-content-between w-100">
        <div class="d-flex align-items-center gap-2">
          <span class="fw-semibold">{{ selectedOrderIds.size }} pedido(s) selecionado(s)</span>
          <button class="btn btn-sm btn-outline-light" @click="clearSelection">
            <i class="bi bi-x-lg"></i> Limpar
          </button>
        </div>
        <div class="d-flex gap-2">
          <button class="btn btn-sm btn-light" @click="bulkPrint" title="Imprimir selecionados">
            <i class="bi bi-printer"></i> Imprimir
          </button>
          <button class="btn btn-sm btn-success" @click="bulkEmitNfe" title="Emitir NF-e dos selecionados">
            <i class="bi bi-receipt"></i> NF-e
          </button>
          <button class="btn btn-sm btn-primary"
            @click="bulkAdvanceStatus"
            :disabled="!allSameStatus || !getNextStatus(selectionStatus)"
            title="Avançar status dos pedidos selecionados">
            Avançar <i class="bi bi-arrow-right"></i>
          </button>
        </div>
      </div>
    </div>

    </div>
    <!-- Detalhes do pedido (modal redesenhado) -->
  <div v-if="detailsModalVisible" class="modal fade show" style="display:block; background: rgba(0,0,0,0.45);" @click.self="closeDetails">
    <div class="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable">
      <div class="modal-content od-modal">
        <!-- Header -->
        <div class="od-modal-header">
          <div class="d-flex align-items-center gap-3">
            <div class="od-order-badge">#{{ selectedNormalized ? (selectedNormalized.display || selectedOrder?.displaySimple || selectedOrder?.id?.slice?.(0,6)) : '' }}</div>
            <div>
              <div class="od-customer-name">{{ selectedNormalized ? selectedNormalized.customerName : (selectedOrder && (selectedOrder.customerName || selectedOrder.name)) || '—' }}</div>
              <div class="od-customer-phone">{{ selectedNormalized ? (selectedNormalized.customerPhone || '') : (selectedOrder && (selectedOrder.customerPhone || selectedOrder.contact)) || '' }}
                <span v-if="selectedNormalized?.phoneLocalizer" class="ms-2 badge bg-light text-dark border" title="Localizador de chamada iFood">Localizador {{ selectedNormalized.phoneLocalizer }}</span>
              </div>
            </div>
            <button v-if="orderEditable" class="btn btn-sm btn-outline-secondary od-edit-btn" @click="editCustomer" title="Editar cliente">
              <i class="bi bi-pencil"></i>
            </button>
          </div>
          <button type="button" class="btn-close" aria-label="Fechar" @click="closeDetails"></button>
        </div>

        <div class="modal-body p-0">
          <!-- Info bar -->
          <div class="od-info-bar">
            <div class="od-info-item">
              <i class="bi bi-shop"></i>
              <span>{{ selectedNormalized ? (selectedNormalized.storeName || '—') : (selectedOrder?.store?.name) || '—' }}</span>
            </div>
            <div class="od-info-item">
              <i class="bi bi-broadcast"></i>
              <span>{{ selectedNormalized ? (selectedNormalized.channelLabel || '—') : '—' }}</span>
            </div>
            <div class="od-info-item">
              <i class="bi bi-clock"></i>
              <span>{{ selectedOrder ? getCreatedDurationDisplay(selectedOrder) : '—' }}</span>
            </div>
            <div class="od-info-item" v-if="selectedOrder?.status">
              <span class="badge" :class="{
                'bg-warning text-dark': selectedOrder.status === 'EM_PREPARO',
                'bg-primary': selectedOrder.status === 'SAIU_PARA_ENTREGA',
                'bg-info': selectedOrder.status === 'CONFIRMACAO_PAGAMENTO',
                'bg-success': selectedOrder.status === 'CONCLUIDO',
                'bg-danger': selectedOrder.status === 'CANCELADO'
              }">{{ selectedOrder.status === 'CONCLUIDO' && selectedNormalized?.closedByIfoodCode ? 'Concluído com código' : (STATUS_LABEL[selectedOrder.status] || selectedOrder.status) }}</span>
            </div>
            <div class="od-info-item" v-if="selectedOrder">
              <i :class="getOrderType(selectedOrder) === 'RETIRADA' ? 'bi bi-bag' : 'bi bi-bicycle'"></i>
              <span>{{ getOrderType(selectedOrder) === 'RETIRADA' ? 'Retirada' : 'Entrega' }}</span>
            </div>
          </div>

          <!-- iFood: Scheduled order banner -->
          <div v-if="selectedNormalized?.scheduledTime" class="od-section" style="background:#fff3cd;border-left:4px solid #ffc107">
            <div class="od-section-title"><i class="bi bi-calendar-event"></i> Pedido Agendado</div>
            <div class="fw-semibold">{{ formatDate(selectedNormalized.scheduledTime) }} às {{ formatTime(selectedNormalized.scheduledTime) }}</div>
          </div>

          <!-- Address section -->
          <div class="od-section">
            <div class="od-section-header">
              <div class="od-section-title"><i class="bi bi-geo-alt"></i> Endereço</div>
              <button v-if="orderEditable" class="btn btn-sm btn-outline-secondary od-edit-btn" @click="editAddress" title="Editar endereço"><i class="bi bi-pencil"></i></button>
            </div>
            <template v-if="selectedNormalized?.addressDetails">
              <div class="od-address-text">
                <div>{{ selectedNormalized.addressDetails.street }}{{ selectedNormalized.addressDetails.number ? ', ' + selectedNormalized.addressDetails.number : '' }}</div>
                <div v-if="selectedNormalized.addressDetails.complement" class="text-muted small">Complemento: {{ selectedNormalized.addressDetails.complement }}</div>
                <div v-if="selectedNormalized.addressDetails.neighborhood" class="text-muted small">Bairro: {{ selectedNormalized.addressDetails.neighborhood }}</div>
                <div v-if="selectedNormalized.addressDetails.city || selectedNormalized.addressDetails.state" class="text-muted small">
                  {{ [selectedNormalized.addressDetails.city, selectedNormalized.addressDetails.state].filter(Boolean).join(' - ') }}
                  {{ selectedNormalized.addressDetails.postalCode ? ' · CEP: ' + selectedNormalized.addressDetails.postalCode : '' }}
                </div>
                <div v-if="selectedNormalized.addressDetails.reference" class="text-muted small mt-1"><i class="bi bi-signpost"></i> <strong>Referência:</strong> {{ selectedNormalized.addressDetails.reference }}</div>
                <div v-if="selectedNormalized.addressDetails.observation" class="text-muted small"><i class="bi bi-chat-left-text"></i> <strong>Obs:</strong> {{ selectedNormalized.addressDetails.observation }}</div>
              </div>
            </template>
            <template v-else>
              <div class="od-address-text">{{ selectedNormalized ? (selectedNormalized.address || '—') : (selectedOrder ? normalizeOrder(selectedOrder).address : '—') || '—' }}</div>
            </template>
            <div v-if="selectedNormalized?.deliveryObservations" class="od-notes mt-1">
              <i class="bi bi-info-circle"></i> <strong>Obs. entrega:</strong> {{ selectedNormalized.deliveryObservations }}
            </div>
          </div>

          <!-- iFood: Pickup/collect code -->
          <div v-if="selectedNormalized?.pickupCode" class="od-section">
            <div class="od-section-title"><i class="bi bi-qr-code"></i> Código de Coleta</div>
            <div class="fs-4 fw-bold font-monospace">{{ selectedNormalized.pickupCode }}</div>
          </div>

          <!-- iFood: Customer CPF/CNPJ -->
          <div v-if="selectedNormalized?.documentNumber" class="od-section">
            <div class="od-section-title"><i class="bi bi-person-vcard"></i> CPF/CNPJ do Cliente</div>
            <div class="fw-semibold">{{ selectedNormalized.documentNumber }}</div>
          </div>

          <!-- Items section -->
          <div class="od-section">
            <div class="od-section-header">
              <div class="od-section-title"><i class="bi bi-bag"></i> Itens do pedido</div>
            </div>
            <div class="od-items-list">
              <div v-for="(it, idx) in (selectedNormalized?.items) || normalizeOrderItems(selectedOrder || {})" :key="(it.id||idx)+''" class="od-item">
                <div class="od-item-main">
                  <span class="od-item-qty">{{ it.quantity || 1 }}x</span>
                  <span class="od-item-name">{{ it.name }}</span>
                  <span class="od-item-price">{{ formatCurrency(itemLineTotal(it)) }}</span>
                  <button v-if="orderEditable" class="btn btn-sm btn-outline-secondary od-item-edit-btn ms-2" @click="editItems(idx)" title="Editar item"><i class="bi bi-pencil-square"></i></button>
                </div>
                <div v-if="(it.quantity || 1) > 1" class="od-item-unit-hint">
                  {{ formatCurrency(it.unitPrice || it.price || 0) }} /un
                </div>
                <div v-if="extractItemOptions(it).length" class="od-item-options">
                  <div
                    v-for="(opt, i) in extractItemOptions(it)"
                    :key="(opt.name||i)+'opt'"
                    class="od-item-option"
                    :class="{ 'od-item-option--slot': opt.kind === 'combo_slot' }"
                  >
                    <i
                      class="od-opt-icon"
                      :class="opt.kind === 'combo_slot' ? 'bi bi-dot' : 'bi bi-plus-circle'"
                    ></i>
                    <span class="od-opt-detail">
                      <template v-if="opt.kind === 'combo_slot'">
                        <span class="od-opt-slot-label" v-if="opt.slotName">{{ opt.slotName }}:</span>
                        {{ opt.name }}
                      </template>
                      <template v-else>
                        <span>{{ Number(opt.quantity || 1) }}/un</span>
                        {{ opt.name }}
                        <span v-if="(it.quantity || 1) > 1" class="od-opt-total">({{ (Number(opt.quantity || 1) * Number(it.quantity || 1)) }} total)</span>
                      </template>
                    </span>
                    <span v-if="opt.kind !== 'combo_slot' && opt.price" class="od-opt-price">{{ formatCurrency(opt.price) }} /un</span>
                  </div>
                </div>
                <div v-if="it.notes || it.observations" class="od-item-notes text-muted small fst-italic ps-3">
                  <i class="bi bi-chat-left-dots"></i> {{ it.notes || it.observations }}
                </div>
              </div>
            </div>
            <div v-if="getOrderNotes(selectedOrder)" class="od-notes">
              <i class="bi bi-chat-left-text"></i> {{ getOrderNotes(selectedOrder) }}
            </div>
          </div>

          <!-- Payment section -->
          <div class="od-section">
            <div class="od-section-header">
              <div class="od-section-title"><i class="bi bi-credit-card"></i> Pagamento</div>
              <button v-if="orderEditable" class="btn btn-sm btn-outline-secondary od-edit-btn" @click="editPayment" title="Editar pagamento"><i class="bi bi-pencil"></i></button>
            </div>
            <div class="od-payment-grid">
              <div class="od-pay-row">
                <span class="od-pay-label">Forma</span>
                <span class="od-pay-value">{{ selectedNormalized ? (selectedNormalized.paymentMethod || '—') : normalizeOrder(selectedOrder).paymentMethod }}</span>
              </div>
              <div class="od-pay-row" v-if="selectedNormalized?.subtotal">
                <span class="od-pay-label">Subtotal</span>
                <span class="od-pay-value">{{ formatCurrency(selectedNormalized.subtotal) }}</span>
              </div>
              <div class="od-pay-row" v-if="selectedNormalized?.couponDiscount">
                <span class="od-pay-label">
                  <i class="bi bi-ticket-perforated me-1"></i>
                  {{ selectedNormalized.couponCode ? `Voucher (${selectedNormalized.couponCode})` : 'Voucher Desconto' }}{{ selectedNormalized.couponSponsor ? ` - ${selectedNormalized.couponSponsor}` : '' }}
                </span>
                <span class="od-pay-value text-success">
                  -{{ formatCurrency(selectedNormalized.couponDiscount) }}
                </span>
              </div>
              <div class="od-pay-row" v-if="Number(selectedOrder?.discountMerchant || 0) > 0">
                <span class="od-pay-label"><i class="bi bi-tag me-1"></i>Desconto</span>
                <span class="od-pay-value text-success">-{{ formatCurrency(Number(selectedOrder.discountMerchant)) }}</span>
              </div>
              <div class="od-pay-row" v-if="selectedOrder?.orderType === 'DELIVERY'">
                <span class="od-pay-label">Taxa de entrega</span>
                <span class="od-pay-value">{{ Number(selectedNormalized?.deliveryFee || selectedOrder?.deliveryFee || 0) > 0 ? formatCurrency(selectedNormalized?.deliveryFee || selectedOrder?.deliveryFee) : 'Grátis' }}</span>
              </div>
              <div class="od-pay-row" v-if="selectedNormalized?.additionalFees > 0">
                <span class="od-pay-label">Taxa de serviço</span>
                <span class="od-pay-value">{{ formatCurrency(selectedNormalized.additionalFees) }}</span>
              </div>
              <div class="od-pay-row" v-if="selectedNormalized?.paymentChange">
                <span class="od-pay-label">Troco para</span>
                <span class="od-pay-value">
                  {{ formatCurrency(selectedNormalized.paymentChange) }}<template v-if="changeDue(selectedOrder) > 0"> ({{ formatCurrency(changeDue(selectedOrder)) }})</template>
                </span>
              </div>
              <div class="od-pay-row od-pay-total">
                <span class="od-pay-label">Total faturado</span>
                <span class="od-pay-value">{{ formatCurrency(storeRevenue(selectedOrder || {})) }}</span>
              </div>
              <div class="od-pay-row" v-if="!selectedNormalized?.isPrepaid && (selectedNormalized?.couponDiscount > 0 || Number(selectedOrder?.discountMerchant || 0) > 0)">
                <span class="od-pay-label" style="color: var(--success-dark); font-weight: 600;">
                  <i class="bi bi-cash-coin me-1"></i>Cobrar do cliente
                </span>
                <span class="od-pay-value" style="color: var(--success-dark); font-weight: 700;">{{ formatCurrency(Number(selectedOrder?.total || 0)) }}</span>
              </div>
            </div>
          </div>

          <!-- Rider section -->
          <div class="od-section" v-if="ridersEnabled && selectedOrder">
            <div class="od-section-header">
              <div class="od-section-title"><i class="bi bi-person-badge"></i> Entregador</div>
              <button class="btn btn-sm btn-outline-secondary od-edit-btn" @click="changeRider(selectedOrder)" title="Trocar entregador"><i class="bi bi-pencil"></i></button>
            </div>
            <div v-if="selectedOrder.rider" class="d-flex align-items-center gap-2">
              <span>{{ selectedOrder.rider.name }}</span>
              <button v-if="selectedOrder.rider" class="btn btn-sm btn-outline-success" @click.stop="openWhatsAppToRider(selectedOrder)">
                <i class="bi bi-whatsapp"></i> WhatsApp
              </button>
            </div>
            <div v-else class="text-muted">Nenhum entregador atribuído</div>
          </div>

          <!-- NF-e info card (shown only when NF-e has been issued) -->
          <div v-if="selectedOrder?.payload?.nfe?.nProt" class="od-section" style="border-left:3px solid #198754">
            <div class="od-section-title" style="color:#198754"><i class="bi bi-receipt-cutoff"></i> Nota Fiscal Eletrônica</div>
            <div class="od-payment-grid">
              <div class="od-pay-row">
                <span class="od-pay-label">Protocolo</span>
                <span class="od-pay-value font-monospace">{{ selectedOrder.payload.nfe.nProt }}</span>
              </div>
              <div class="od-pay-row" v-if="selectedOrder.payload.nfe.cStat">
                <span class="od-pay-label">Status SEFAZ</span>
                <span class="od-pay-value">{{ selectedOrder.payload.nfe.cStat }} — {{ selectedOrder.payload.nfe.xMotivo || '' }}</span>
              </div>
              <div class="od-pay-row" v-if="selectedOrder.payload.nfe.authorizedAt">
                <span class="od-pay-label">Autorizado em</span>
                <span class="od-pay-value">{{ new Date(selectedOrder.payload.nfe.authorizedAt).toLocaleString('pt-BR') }}</span>
              </div>
            </div>
            <div class="d-flex gap-2 mt-2 flex-wrap">
              <button type="button" class="btn btn-sm btn-success" @click="imprimirDanfe(selectedOrder)" title="Imprimir DANFE na impressora fiscal">
                <i class="bi bi-printer-fill"></i> Imprimir DANFE
              </button>
              <button type="button" class="btn btn-sm btn-outline-primary" @click="sendNfeEmail(selectedOrder)" title="Enviar DANFE em PDF por e-mail">
                <i class="bi bi-envelope"></i> Enviar PDF por e-mail
              </button>
              <button type="button" class="btn btn-sm btn-outline-secondary" @click="downloadNfePdf(selectedOrder)" title="Baixar DANFE em PDF">
                <i class="bi bi-file-pdf"></i> Baixar PDF
              </button>
              <button type="button" class="btn btn-sm btn-outline-secondary" @click="downloadNfeXml(selectedOrder)" title="Baixar XML">
                <i class="bi bi-download"></i> Baixar XML
              </button>
            </div>
          </div>

          <!-- DEBUG: Raw payload -->
          <div class="od-section" style="background:#1e1e1e;color:#d4d4d4;border-left:4px solid #f44336">
            <div class="od-section-title" style="color:#f44336"><i class="bi bi-bug"></i> DEBUG — Payload completo</div>
            <pre style="white-space:pre-wrap;word-break:break-all;font-size:0.75rem;max-height:400px;overflow-y:auto;margin:0">{{ JSON.stringify(selectedOrder, null, 2) }}</pre>
          </div>
        </div>

        <div class="od-modal-footer">
          <button type="button" class="btn btn-outline-danger" @click="cancelOrderFromDetails"
            :disabled="!orderEditable"
            title="Cancelar pedido">
            <i class="bi bi-x-circle"></i> Cancelar pedido
          </button>
          <div class="d-flex gap-2">
            <button v-if="selectedOrder && selectedOrder.status === 'EM_PREPARO' && isTakeoutOrder(selectedOrder)"
              type="button" class="btn btn-info text-white" @click="markReadyForPickup(selectedOrder)"
              title="Pronto para Retirada">
              <i class="bi bi-bag-check"></i> Pronto p/ Retirada
            </button>
            <button v-if="selectedOrder && selectedOrder.status !== 'CONCLUIDO' && selectedOrder.status !== 'CANCELADO' && selectedOrder.status !== 'EM_PREPARO' && isTakeoutOrder(selectedOrder)"
              type="button" class="btn btn-info text-white" @click="advanceStatus(selectedOrder)"
              :disabled="!getNextStatus(selectedOrder.status, selectedOrder) || !store.canTransition(selectedOrder.status, getNextStatus(selectedOrder.status, selectedOrder)) || loading"
              :title="selectedOrder.status === 'CONFIRMACAO_PAGAMENTO' ? 'Confirmar pagamento' : 'Pedido Retirado'">
              <i class="bi bi-bag-check"></i> {{ selectedOrder.status === 'CONFIRMACAO_PAGAMENTO' ? 'Confirmar' : 'Pedido Retirado' }}
            </button>
            <button type="button" class="btn btn-outline-secondary" @click="printReceipt(selectedOrder)" title="Imprimir">
              <i class="bi bi-printer"></i> Imprimir
            </button>
            <button v-if="!selectedOrder?.payload?.nfe?.nProt && selectedOrder?.status !== 'CANCELADO'" type="button" class="btn btn-outline-success" @click="emitirNfeOrder(selectedOrder)" title="Emitir NF-e">
              <i class="bi bi-receipt"></i> NF-e
            </button>
            <button type="button" class="btn btn-secondary" @click="closeDetails">Fechar</button>
          </div>
        </div>
      </div>
    </div>
  </div>
  
  <!-- Atribuir entregador (modal custom usando ListGroup) -->
  <div v-if="assignModalVisible" class="modal fade show" style="display:block; background: rgba(0,0,0,0.45); z-index:20000;" @click.self="(assignModalVisible=false, bulkAssignOrders=[])">
    <div class="modal-dialog modal-md modal-dialog-centered">
      <div class="modal-content">
        <div class="modal-header">
          <h5 class="modal-title">{{ isBulkAssign ? `Escolher entregador (${bulkAssignOrders.length} pedidos)` : (assignModalOrder?._changeOnly ? 'Trocar entregador' : 'Escolher entregador') }}</h5>
          <button type="button" class="btn-close" aria-label="Fechar" @click="assignModalVisible=false; bulkAssignOrders=[]"></button>
        </div>
        <div class="modal-body">
          <div v-if="isBulkAssign" class="alert alert-info small mb-3">
            Pedidos selecionados: <strong>{{ bulkAssignOrders.map(o => '#' + formatDisplay(o)).join(', ') }}</strong>
          </div>
          <div v-if="assignModalRiders && assignModalRiders.length">
            <ListGroup :items="assignModalRiders" itemKey="id" :selectedId="assignSelectedRider" :showActions="false" @select="assignSelectedRider = $event">
              <template #primary="{ item }">
                <div><strong>{{ item.name }}</strong></div>
                <div v-if="item.description" class="small text-muted">{{ item.description }}</div>
              </template>
            </ListGroup>
          </div>
          <div v-else class="text-muted">Nenhum entregador disponível.</div>
        </div>
        <div class="modal-footer d-flex justify-content-between">
          <div>
            <button class="btn btn-outline-secondary" type="button" @click="assignModalVisible=false; bulkAssignOrders=[]">Cancelar</button>
            <!-- Single order: dispatch without rider (hidden when just changing rider) -->
            <button v-if="!isBulkAssign && !assignModalOrder?._changeOnly" class="btn btn-outline-danger ms-2" type="button" :disabled="!assignOrderId" @click="(async ()=>{ try{ const id = assignOrderId; if(!id){ assignModalVisible=false; console.error('assignModal: pedido indisponível', assignModalOrder && assignModalOrder.value); Swal.fire('Erro','Pedido indisponível.','error'); return } assignModalVisible=false; await store.updateStatus(id, 'SAIU_PARA_ENTREGA'); await store.fetch(); Swal.fire('OK','Pedido despachado sem entregador.','success') }catch(e){ console.error(e); Swal.fire('Erro','Falha ao despachar pedido.','error') } })()">Despachar sem entregador</button>
            <!-- Bulk: dispatch all without rider -->
            <button v-if="isBulkAssign" class="btn btn-outline-danger ms-2" type="button" @click="(async ()=>{ try{ assignModalVisible=false; loading=true; let ok=0,fail=0; for(const o of bulkAssignOrders){ try{ await store.updateStatus(o.id,'SAIU_PARA_ENTREGA'); ok++ }catch(e){ console.error(e); fail++ } } await store.fetch(); loading=false; clearSelection(); bulkAssignOrders=[]; Swal.fire({icon:fail?'warning':'success',title:`${ok} pedido(s) despachado(s) sem entregador`+(fail?`, ${fail} falha(s)`:''),timer:3000,toast:true,position:'top-end',showConfirmButton:false}) }catch(e){ console.error(e); loading=false; Swal.fire('Erro','Falha ao despachar pedidos.','error') } })()">Despachar sem entregador</button>
          </div>
          <div>
            <!-- Single order: assign rider -->
            <button v-if="!isBulkAssign" class="btn btn-secondary" type="button" :disabled="!assignSelectedRider || !assignOrderId" @click="(async ()=>{ try{ const id = assignOrderId; const changeOnly = !!(assignModalOrder && assignModalOrder._changeOnly); if(!id){ assignModalVisible=false; console.error('assignModal: pedido indisponível', assignModalOrder && assignModalOrder.value); Swal.fire('Erro','Pedido indisponível.','error'); return } await store.assignOrder(id, { riderId: assignSelectedRider, alsoSetStatus: !changeOnly }); await store.fetch(); assignModalVisible=false; Swal.fire('OK', changeOnly ? 'Entregador alterado.' : 'Pedido atribuído e notificado via WhatsApp.','success') }catch(e){ console.error(e); Swal.fire('Erro','Falha ao atribuir entregador.','error') } })()">{{ assignModalOrder?._changeOnly ? 'Salvar' : 'Atribuir' }}</button>
            <!-- Bulk: assign same rider to all -->
            <button v-if="isBulkAssign" class="btn btn-secondary" type="button" :disabled="!assignSelectedRider" @click="(async ()=>{ try{ assignModalVisible=false; loading=true; let ok=0,fail=0; for(const o of bulkAssignOrders){ try{ await store.assignOrder(o.id,{riderId:assignSelectedRider,alsoSetStatus:true}); ok++ }catch(e){ console.error(e); fail++ } } await store.fetch(); loading=false; clearSelection(); bulkAssignOrders=[]; Swal.fire({icon:fail?'warning':'success',title:`${ok} pedido(s) atribuído(s)`+(fail?`, ${fail} falha(s)`:''),timer:3000,toast:true,position:'top-end',showConfirmButton:false}) }catch(e){ console.error(e); loading=false; Swal.fire('Erro','Falha ao atribuir entregador.','error') } })()">Atribuir</button>
          </div>
        </div>
      </div>
    </div>
  </div>
  </div>
</template>

<style scoped>
/* Pending acceptance box */
.pending-acceptance-box {
  border: 2px solid #ffc107;
  border-radius: 12px;
  background: #fff8e1;
  overflow: hidden;
}
.pending-header {
  background: #ffc107;
  color: #333;
  padding: 10px 16px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.95rem;
}
.pending-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-top: 1px solid #ffe082;
}
.pending-card:first-of-type { border-top: none; }
.pending-card-info { flex: 1; min-width: 0; }
.pending-card-actions { display: flex; gap: 8px; flex-shrink: 0; margin-left: 12px; }

@keyframes pending-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(255, 193, 7, 0.4); }
  50% { box-shadow: 0 0 12px 4px rgba(255, 193, 7, 0.25); }
}
.pending-acceptance-box { animation: pending-pulse 2s ease-in-out infinite; }

/* No cash session box */
.no-cash-box {
  border: 2px solid #e65100;
  border-radius: 12px;
  background: #fff3e0;
  overflow: hidden;
  animation: no-cash-pulse 2s ease-in-out infinite;
}
.no-cash-header {
  background: #e65100;
  color: #fff;
  padding: 10px 16px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.95rem;
}
.no-cash-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-top: 1px solid #ffcc80;
}
.no-cash-card:first-of-type { border-top: none; }
.no-cash-card-info { flex: 1; min-width: 0; }
.no-cash-card-total { flex-shrink: 0; margin-left: 12px; }
@keyframes no-cash-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(230, 81, 0, 0.4); }
  50% { box-shadow: 0 0 12px 4px rgba(230, 81, 0, 0.25); }
}

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
.orders-column {
   background-color: var(--bg-card, #FFF);
    flex: 0 0 23.5%;
    border: 1px solid var(--border-color, #E6E6E6);
    border-radius: var(--border-radius, 0.75rem);
    box-shadow: var(--shadow-card, 0 0.125rem 0.25rem rgba(0,0,0,0.075));
  }
.orders-column .list { max-height: 70vh; overflow:auto; }
.orders-column .card-header {
  background: var(--bg-card, #FFF);
  border: none;
  border-radius: var(--border-radius, 0.75rem) var(--border-radius, 0.75rem) 0 0;
}
.order-card {
  border: 1px solid var(--border-color, #E6E6E6);
  background: var(--bg-zebra, #FAFAFA);
  border-radius: var(--border-radius-sm, 0.5rem);
  overflow: hidden;
  transition: box-shadow 0.15s, border-color 0.15s, background 0.15s;
}
.order-card:hover {
  box-shadow: var(--shadow-hover, 0 0.25rem 0.5rem rgba(0,0,0,0.1));
  border-color: var(--primary, #105784);
}
.order-card .card-body { cursor: grab; padding: 10px 12px !important; }

/* Header: checkbox + title + channel */
.oc-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.oc-title {
  font-weight: 600;
  font-size: 0.875rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  min-width: 0;
}
.oc-channel {
  font-size: 0.65rem;
  color: #6c757d;
  white-space: nowrap;
  flex-shrink: 0;
  max-width: 90px;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Scheduled order banner */
.oc-scheduled-banner {
  background: #fff3cd;
  color: #856404;
  border: 1px solid #ffc107;
  border-radius: 4px;
  padding: 3px 8px;
  font-size: 0.75rem;
  font-weight: 600;
  margin-bottom: 6px;
  display: flex;
  align-items: center;
  gap: 5px;
}
.oc-scheduled-banner i {
  font-size: 0.85rem;
}

/* Info chips row */
.oc-info {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 8px;
  margin-bottom: 4px;
}
.oc-chip {
  font-size: 0.7rem;
  color: #555;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  white-space: nowrap;
}
.oc-chip i { font-size: 0.65rem; color: #888; }
/* "Cobrar do cliente" chip — destacado pra agilizar conferência de caixa. */
.oc-chip--collect {
  background: #e8f5e9;
  color: #1b5e20;
  font-weight: 600;
  border-radius: 10px;
  padding: 1px 8px;
}
.oc-chip--collect i { color: #1b5e20; }
.oc-wa-btn { font-size: 0.7rem; line-height: 1; }

/* Address */
.oc-address {
  font-size: 0.7rem;
  color: #6c757d;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Footer: time + total + actions */
.oc-footer {
  display: flex;
  align-items: center;
  gap: 6px;
  border-top: 1px solid var(--border-color, #E6E6E6);
  padding-top: 6px;
}
.oc-time {
  font-size: 0.7rem;
  color: #888;
  white-space: nowrap;
}
.oc-ifood-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  background: #EA1D2C;
  color: #fff;
  border-radius: 4px;
  padding: 1px 5px;
  font-size: 0.65rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  white-space: nowrap;
}
.oc-total {
  font-weight: 600;
  font-size: 0.85rem;
  color: #198754;
  white-space: nowrap;
}
.oc-actions {
  display: flex;
  gap: 4px;
  margin-left: auto;
  flex-shrink: 0;
}
.oc-actions .btn { padding: 2px 6px; font-size: 0.72rem; }

button.btn.advance {
  background-color: var(--success, #89D136) !important;
  border: none;
  color: #fff !important;
  font-weight: 500;
  border-radius: var(--border-radius-sm, 0.5rem);
}

/* responsive: horizontal scroll on small screens */
@media (max-width: 768px) {
  .orders-column { min-width: 100%; flex: 0 0 260px; }
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

/* Order details modal */
.od-modal { border-radius: var(--border-radius, 0.75rem); overflow: hidden; }
.od-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  background: linear-gradient(135deg, var(--bg-app, #EEFFED), #e0f0de);
  border-bottom: 1px solid var(--border-color, #E6E6E6);
}
.od-order-badge {
  background: var(--primary, #105784);
  color: #fff;
  font-weight: 700;
  font-size: 1.1rem;
  padding: 6px 14px;
  border-radius: var(--border-radius-sm, 0.5rem);
  white-space: nowrap;
}
.od-customer-name { font-weight: 600; font-size: 1rem; color: #212529; }
.od-customer-phone { font-size: 0.82rem; color: #6c757d; }
.od-info-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 16px;
  padding: 10px 20px;
  background: var(--bg-zebra, #FAFAFA);
  border-bottom: 1px solid var(--border-color, #E6E6E6);
}
.od-info-item {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 0.8rem;
  color: #555;
}
.od-info-item i { color: #888; }
.od-section {
  padding: 14px 20px;
  border-bottom: 1px solid #f0f0f0;
}
.od-section:last-child { border-bottom: none; }
.od-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.od-section-title {
  font-weight: 600;
  font-size: 0.82rem;
  color: #495057;
  margin-bottom: 0;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}
.od-section-title i { margin-right: 4px; color: #888; }
.od-edit-btn {
  padding: 2px 8px;
  font-size: 0.72rem;
  border-radius: 6px;
  color: #6c757d;
  border-color: #dee2e6;
}
.od-edit-btn:hover { color: #0d6efd; border-color: #0d6efd; }
.od-address-text { font-size: 0.88rem; color: #333; line-height: 1.4; }
.od-items-list { display: flex; flex-direction: column; gap: 6px; }
.od-item {
  background: #fafbfc;
  border-radius: 8px;
  padding: 8px 12px;
}
.od-item-main {
  display: flex;
  align-items: center;
  gap: 8px;
}
.od-item-qty {
  font-weight: 600;
  font-size: 0.82rem;
  color: #495057;
  min-width: 28px;
}
.od-item-name { flex: 1; font-size: 0.88rem; color: #212529; }
.od-item-price { font-weight: 600; font-size: 0.85rem; color: #198754; white-space: nowrap; }
.od-item-edit-btn { padding: 1px 6px; font-size: 0.75rem; opacity: 0.6; flex-shrink: 0; }
.od-item-edit-btn:hover { opacity: 1; }
.od-item-unit-hint { font-size: 0.75rem; color: var(--text-secondary, #6c757d); padding-left: 36px; margin-top: 1px; }
.od-item-options { margin-top: 6px; padding-left: 28px; display: flex; flex-direction: column; gap: 3px; }
.od-item-option { font-size: 0.8rem; color: #495057; display: flex; align-items: baseline; gap: 5px; line-height: 1.4; }
.od-item-option--slot { color: var(--text-primary, #212529); }
.od-opt-icon { font-size: 0.65rem; color: var(--text-muted, #adb5bd); flex-shrink: 0; position: relative; top: 1px; }
.od-opt-detail { flex: 1; }
.od-opt-detail > span:first-child { font-weight: 600; font-size: 0.75rem; color: #495057; background: #e9ecef; border-radius: 4px; padding: 1px 5px; margin-right: 4px; }
.od-opt-detail > .od-opt-slot-label:first-child { font-weight: 600; font-size: 0.78rem; color: var(--primary, #105784); background: transparent; padding: 0; margin-right: 4px; border-radius: 0; }
.od-opt-total { font-size: 0.72rem; color: var(--text-secondary, #6c757d); font-weight: 500; }
.od-opt-price { color: #198754; font-size: 0.78rem; white-space: nowrap; flex-shrink: 0; }
.od-notes {
  margin-top: 10px;
  padding: 8px 12px;
  background: #fff8e1;
  border-radius: 8px;
  font-size: 0.82rem;
  color: #795548;
}
.od-notes i { margin-right: 6px; }
.od-payment-grid { display: flex; flex-direction: column; gap: 4px; }
.od-pay-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 0;
  font-size: 0.88rem;
}
.od-pay-label { color: #6c757d; }
.od-pay-value { font-weight: 500; color: #212529; }
.od-pay-total {
  border-top: 2px solid #e9ecef;
  margin-top: 4px;
  padding-top: 8px;
}
.od-pay-total .od-pay-label { font-weight: 600; color: #212529; font-size: 0.95rem; }
.od-pay-total .od-pay-value { font-weight: 700; color: #198754; font-size: 1.1rem; }
.od-modal-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 20px;
  border-top: 1px solid #eee;
}

/* Custom checkbox */
.order-checkbox {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  cursor: pointer;
  flex-shrink: 0;
}
.order-checkbox input {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
}
.order-checkbox-mark {
  width: 20px;
  height: 20px;
  border: 2px solid #ced4da;
  border-radius: 6px;
  background: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
}
.order-checkbox input:checked + .order-checkbox-mark {
  background: #0d6efd;
  border-color: #0d6efd;
}
.order-checkbox input:checked + .order-checkbox-mark::after {
  content: '';
  width: 6px;
  height: 10px;
  border: solid #fff;
  border-width: 0 2.5px 2.5px 0;
  transform: rotate(45deg);
  margin-top: -2px;
}
.order-checkbox:hover .order-checkbox-mark {
  border-color: #0d6efd;
  box-shadow: 0 0 0 3px rgba(13, 110, 253, 0.12);
}

/* Bulk selection */
.bulk-actions-bar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  background: #343a40;
  color: #fff;
  padding: 12px 24px;
  z-index: 1050;
  box-shadow: 0 -2px 10px rgba(0,0,0,0.3);
}
.order-card.selected {
  border: 2px solid #0d6efd !important;
  background: #f0f7ff !important;
  box-shadow: 0 0 0 2px rgba(13, 110, 253, 0.18);
}

.tier-stars {
  font-size: 1rem;
  letter-spacing: 1px;
  margin-left: 6px;
}
.tier-badge {
  font-size: 0.7rem;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 10px;
  margin-left: 6px;
  display: inline-block;
  vertical-align: middle;
}

/* ═══════════════════════════════════════════════════════════════════════
   CHEFIZ DESIGN OVERLAY — overrides above to match the Chefiz Pedidos look.
   Status palette mirrors the design:
     novos/EM_PREPARO        → amber  #e08a1e / soft #fdf2e0
     entrega/SAIU_PARA       → blue   #2b6fe0 / soft #e7f0fe
     pagamento/CONFIRMACAO   → purple #9a5cd0 / soft #f3ebfb
     concluido/CONCLUIDO     → green  #2e8c5a / soft #e6f4ec
     cancelado/CANCELADO     → red    #e23b3b / soft #fdecec
   ═══════════════════════════════════════════════════════════════════════ */

/* Page canvas — neutral Chefiz background */
.container-fluid.p-4 {
  background: #f4f5f7;
  min-height: 100%;
}

/* ── Header ── */
.container-fluid.p-4 .orders-toolbar__top {
  margin-bottom: 18px !important;
}
.container-fluid.p-4 .orders-toolbar__top h2 {
  font-size: 1.45rem !important;
  font-weight: 800 !important;
  letter-spacing: -0.4px;
  color: #1d2330;
  position: relative;
  padding-right: 22px; /* room for the lime status dot */
}
/* Always-visible lime status dot to the right of "Pedidos" */
.container-fluid.p-4 .orders-toolbar__top h2::after {
  content: '';
  position: absolute;
  right: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 11px;
  height: 11px;
  border-radius: 50%;
  background: #89D136;
  box-shadow: 0 0 0 4px rgba(137,209,54,0.22);
}
/* Hide the legacy conditional socket badge — the ::after dot replaces it */
.container-fluid.p-4 .orders-toolbar__top h2 .badge { display: none !important; }

/* ── Header buttons (faithful to Chefiz Pedidos top bar) ── */
.container-fluid.p-4 .orders-toolbar__top .btn-sm {
  height: 40px;
  border-radius: 11px;
  font-weight: 600;
  font-size: 0.85rem;
  padding: 0 14px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

/* Sound button (icon-only, square 40x40) — filled green when ON,
   tinted green when OFF. Identified by its title attribute. */
.container-fluid.p-4 .orders-toolbar__top button[title="Som de novos pedidos"] {
  width: 40px;
  height: 40px;
  padding: 0 !important;
  justify-content: center;
}
.container-fluid.p-4 .orders-toolbar__top button[title="Som de novos pedidos"].btn-primary {
  background: #2e8c5a !important;
  border: none !important;
  color: #fff !important;
  box-shadow: 0 2px 6px rgba(46,140,90,0.30);
}
.container-fluid.p-4 .orders-toolbar__top button[title="Som de novos pedidos"].btn-primary i {
  color: #fff !important;
  font-size: 1.05rem;
}
.container-fluid.p-4 .orders-toolbar__top button[title="Som de novos pedidos"].btn-outline-secondary {
  background: rgba(46,140,90,0.10) !important;
  border: none !important;
  color: #2e8c5a !important;
}
.container-fluid.p-4 .orders-toolbar__top button[title="Som de novos pedidos"].btn-outline-secondary i {
  color: #2e8c5a !important;
  font-size: 1.05rem;
}

/* Impressora pill — white with inline lime dot + "Conectada" green text */
.container-fluid.p-4 .orders-toolbar__top button[title="Configurar impressora"] {
  background: #fff !important;
  border: 1px solid #e9ecf1 !important;
  color: #5a6373 !important;
}
.container-fluid.p-4 .orders-toolbar__top button[title="Configurar impressora"] i.bi-printer {
  color: #5a6373 !important;
  font-size: 1rem;
}
.container-fluid.p-4 .orders-toolbar__top button[title="Configurar impressora"] .badge.bg-success {
  background: transparent !important;
  color: #2e8c5a !important;
  padding: 0 !important;
  margin-left: 8px !important;
  font-size: 0.78rem !important;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.container-fluid.p-4 .orders-toolbar__top button[title="Configurar impressora"] .badge.bg-success::before {
  content: '';
  display: inline-block;
  width: 8px; height: 8px;
  border-radius: 50%;
  background: #2e8c5a;
  box-shadow: 0 0 0 3px rgba(46,140,90,0.18);
  vertical-align: middle;
}

/* Test print button — clean white pill */
.container-fluid.p-4 .orders-toolbar__top button[title="Enviar comanda de teste"] {
  background: #fff !important;
  border: 1px solid #e9ecf1 !important;
  color: #5a6373 !important;
}
.container-fluid.p-4 .orders-toolbar__top button[title="Enviar comanda de teste"] i {
  color: #5a6373 !important;
  font-size: 1rem;
}

/* ── CashControl (Caixa) — solid green Chefiz pill ──
   :deep() reaches into the child component's scoped subtree. */
.container-fluid.p-4 .orders-toolbar__top :deep(.cash-control) {
  margin-left: 0 !important;
}
.container-fluid.p-4 .orders-toolbar__top :deep(.cash-control .btn) {
  height: 40px !important;
  padding: 0 14px !important;
  border-radius: 11px !important;
  font-weight: 700 !important;
  font-size: 0.85rem !important;
  display: inline-flex !important;
  align-items: center;
  gap: 8px;
}
.container-fluid.p-4 .orders-toolbar__top :deep(.cash-control .btn-secondary) {
  background: #2e8c5a !important;
  border: none !important;
  color: #fff !important;
  box-shadow: 0 2px 6px rgba(46,140,90,0.30);
}
.container-fluid.p-4 .orders-toolbar__top :deep(.cash-control .btn-secondary i) {
  color: #fff !important;
  font-size: 1rem;
}
.container-fluid.p-4 .orders-toolbar__top :deep(.cash-control .btn-secondary .badge.bg-success) {
  background: transparent !important;
  color: #fff !important;
  padding: 0 !important;
  margin: 0 !important;
  font-weight: 800 !important;
  font-size: 0.9rem !important;
}
.container-fluid.p-4 .orders-toolbar__top :deep(.cash-control .btn-secondary small.text-muted) {
  color: rgba(255,255,255,0.85) !important;
  font-weight: 600 !important;
  font-size: 0.72rem !important;
  letter-spacing: 0.3px;
  margin-left: 4px !important;
}
.container-fluid.p-4 .orders-toolbar__top :deep(.cash-control .btn-secondary::after) {
  content: '\F282';
  font-family: 'bootstrap-icons';
  font-size: 0.95rem;
  color: #fff;
  margin-left: 2px;
  line-height: 1;
}
/* "Abrir Caixa" — outline green when no session active */
.container-fluid.p-4 .orders-toolbar__top :deep(.cash-control .btn-outline-secondary) {
  background: #fff !important;
  border: 1.5px solid #2e8c5a !important;
  color: #2e8c5a !important;
}

/* ── Novo Pedido + Procurar pedido cards (compact Chefiz cards) ── */
.container-fluid.p-4 .card[style*="border:none"],
.container-fluid.p-4 .filters-bar.card {
  background: #fff !important;
  border: 1px solid #e9ecf1 !important;
  border-radius: 14px !important;
  box-shadow: 0 1px 3px rgba(0,0,0,0.04);
  margin-bottom: 14px !important;
}
.container-fluid.p-4 .card .card-title {
  font-size: 0.85rem;
  font-weight: 700;
  color: #5a6373;
  letter-spacing: 0.2px;
  text-transform: uppercase;
  margin-bottom: 10px;
}
.container-fluid.p-4 .card .form-control {
  background: #f4f5f7;
  border: 1px solid #e9ecf1;
  border-radius: 11px;
  height: 44px;
  font-size: 0.9rem;
}
.container-fluid.p-4 .card .form-control:focus {
  background: #fff;
  border-color: #89D136;
  box-shadow: 0 0 0 3px rgba(137,209,54,0.16);
}
/* Entrega button (lime) */
.container-fluid.p-4 .card .btn-primary {
  background: #89D136 !important;
  border: none !important;
  color: #fff !important;
  border-radius: 11px;
  height: 44px;
  font-weight: 700;
  font-size: 0.9rem;
  box-shadow: 0 2px 6px rgba(137,209,54,0.30);
}
.container-fluid.p-4 .card .btn-primary:hover {
  background: #6DAE1E !important;
}
/* Balcão button (outline lime) */
.container-fluid.p-4 .card .btn-outline-primary {
  background: #fff !important;
  border: 1.5px solid #89D136 !important;
  color: #5f7d10 !important;
  border-radius: 11px;
  height: 44px;
  font-weight: 700;
  font-size: 0.9rem;
}
.container-fluid.p-4 .card .btn-outline-primary:hover {
  background: rgba(137,209,54,0.10) !important;
}

/* Select / TextInput in filters bar */
.container-fluid.p-4 .filters-bar .form-select,
.container-fluid.p-4 .filters-bar .form-control {
  height: 44px;
  border-radius: 11px;
  background: #fff;
  border: 1px solid #e9ecf1;
  font-size: 0.9rem;
  color: #1d2330;
}
.container-fluid.p-4 .filters-bar .form-select:focus,
.container-fluid.p-4 .filters-bar .form-control:focus {
  border-color: #89D136;
  box-shadow: 0 0 0 3px rgba(137,209,54,0.16);
}

/* ── Mobile status tabs (Chefiz pill row) ── */
.container-fluid.p-4 .filters-bar .action-chip {
  flex-shrink: 0;
  height: 36px;
  padding: 0 14px;
  border-radius: 18px;
  border: 1.5px solid #e9ecf1;
  background: #fff;
  color: #5a6373;
  font-size: 0.82rem;
  font-weight: 700;
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.container-fluid.p-4 .filters-bar .action-chip--active {
  background: #89D136;
  border-color: #89D136;
  color: #fff;
  box-shadow: 0 2px 6px rgba(137,209,54,0.30);
}

/* ── "Novo Pedido" row (Chefiz Desktop layout) ─────────────────────────
   Plain flex: phone input grows, Entrega + Balcão buttons sit at
   natural content width — never half-row each like the old grid. */
.orders-new-row { row-gap: 8px; }
.orders-new-input { flex: 1 1 340px; min-width: 0; }
.orders-new-input > div { width: 100%; }  /* TextInput's outer wrapper */
.orders-new-input .form-control {
  height: 44px;
  border-radius: 11px;
  background: #f4f5f7;
  border: 1px solid #e9ecf1;
  font-size: 0.9rem;
}
.orders-new-input .form-control:focus {
  background: #fff;
  border-color: #89D136;
  box-shadow: 0 0 0 3px rgba(137,209,54,0.16);
}
.orders-new-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 44px;
  padding: 0 18px;
  border-radius: 11px;
  font-weight: 700;
  font-size: 0.9rem;
  white-space: nowrap;
  cursor: pointer;
  flex-shrink: 0;
  flex-grow: 0;
  transition: background .12s, border-color .12s;
}
.orders-new-btn--filled {
  background: #89D136;
  color: #fff;
  border: none;
  box-shadow: 0 2px 6px rgba(137,209,54,0.30);
}
.orders-new-btn--filled:hover { background: #6DAE1E; }
.orders-new-btn--outline {
  background: #fff;
  color: #5f7d10;
  border: 1.5px solid #89D136;
}
.orders-new-btn--outline:hover { background: rgba(137,209,54,0.10); }
@media (max-width: 575.98px) {
  /* On very narrow phones, let the buttons share the row 50/50 */
  .orders-new-input { flex: 1 1 100%; }
  .orders-new-btn { flex: 1 1 calc(50% - 4px); justify-content: center; }
}

/* ── Filter row: toggles + advanced inputs share one row ────────────────
   On desktop: one line — input sizes shrink to fit, toggles pushed to end.
   On mobile: toggles+Filtros button on top, advanced inputs stack below. */
.orders-filter-row > .orders-adv-control { flex: 1 1 160px; min-width: 0; max-width: 220px; }
.orders-filter-row > .orders-adv-control--num { flex: 0 1 120px; max-width: 150px; }
.orders-filter-row > .orders-adv-control--name { flex: 2 1 220px; max-width: 320px; } /* widest input */
.orders-filter-row > .orders-adv-control > div { width: 100%; } /* TextInput wrapper */

@media (min-width: 769px) {
  /* Force one line on desktop (controls shrink rather than wrap) */
  .orders-filter-row { flex-wrap: nowrap !important; }
  /* Push Entrega/Retirada to the end of the row */
  .orders-filter-row > .orders-toggle { order: 10; }
  /* The mobile spacer doesn't take any space on desktop */
  .orders-filter-row > .orders-spacer { display: none !important; }
}

@media (max-width: 768px) {
  /* Mobile: hide advanced controls unless the row is expanded */
  .orders-filter-row:not(.orders-filter-row--expanded) > .orders-adv-control {
    display: none !important;
  }
  /* Each advanced control takes full row width when shown */
  .orders-filter-row > .orders-adv-control,
  .orders-filter-row > .orders-adv-control--num,
  .orders-filter-row > .orders-adv-control--name {
    flex: 1 1 100% !important;
    max-width: none !important;
  }
  .orders-filter-row--expanded { row-gap: 8px !important; }
}

/* ── Entrega / Retirada toggle buttons (faithful to Chefiz FilterToggle) ── */
.orders-toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 40px;
  padding: 0 14px;
  border-radius: 11px;
  border: 1.5px solid #e9ecf1;
  background: #fff;
  color: #5a6373;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  transition: background .12s, border-color .12s, color .12s;
  white-space: nowrap;
  flex-shrink: 0;
}
.orders-toggle:hover { background: #f4f5f7; }
.orders-toggle--on {
  background: rgba(137,209,54,0.10);
  border-color: #89D136;
  color: #5f7d10;
}
.orders-toggle__check {
  width: 20px;
  height: 20px;
  border-radius: 6px;
  border: 2px solid #e9ecf1;
  background: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 0.85rem;
  flex-shrink: 0;
  transition: background .12s, border-color .12s;
}
.orders-toggle--on .orders-toggle__check {
  background: #89D136;
  border-color: #89D136;
}
.orders-toggle__check i { line-height: 1; font-weight: 800; }
.orders-toggle__ic {
  font-size: 1rem;
  color: #5a6373;
  transition: color .12s;
}
.orders-toggle--on .orders-toggle__ic { color: #5f7d10; }
.orders-toggle__label { line-height: 1; }

/* ── "Filtros" collapse button (icon-only on mobile) ── */
.orders-filters-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 40px;
  padding: 0 11px;
  border-radius: 11px;
  border: 1.5px solid #e9ecf1;
  background: #fff;
  color: #5a6373;
  cursor: pointer;
  flex-shrink: 0;
  position: relative;
  transition: background .12s, border-color .12s, color .12s;
}
.orders-filters-toggle:hover { background: #f4f5f7; }
.orders-filters-toggle--on {
  background: rgba(137,209,54,0.10);
  border-color: #89D136;
  color: #5f7d10;
}
.orders-filters-toggle > .bi-funnel { font-size: 1.05rem; line-height: 1; }
.orders-filters-toggle__badge {
  min-width: 18px;
  height: 18px;
  border-radius: 9px;
  padding: 0 5px;
  background: #89D136;
  color: #fff;
  font-size: 0.65rem;
  font-weight: 800;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
}
.orders-filters-toggle__chev {
  font-size: 0.85rem;
  line-height: 1;
  transition: transform .15s ease;
}
.orders-filters-toggle__chev--open { transform: rotate(180deg); }

/* Tighten the Entrega/Retirada toggles on phones so they sit on the same
   row as the Filtros button even on 360px viewports. */
@media (max-width: 768px) {
  .orders-toggle { padding: 0 10px; gap: 6px; font-size: 0.8rem; }
  .orders-toggle__check { width: 18px; height: 18px; }
  .orders-toggle__ic { font-size: 0.9rem; }
  .orders-filters-toggle { padding: 0 9px; gap: 5px; }
}

/* ── Kanban board ── */
.orders-board .boards { padding: 0; gap: 14px; }
.orders-column {
  background: #fff !important;
  flex: 1 1 0 !important;
  min-width: 280px;
  border: 1px solid #e9ecf1 !important;
  border-radius: 16px !important;
  box-shadow: 0 1px 3px rgba(0,0,0,0.04) !important;
  display: flex;
  flex-direction: column;
}
.orders-column .card-header {
  background: #fff !important;
  border-bottom: 1px solid #f0f2f5 !important;
  padding: 14px 16px !important;
  font-size: 0.9rem;
  font-weight: 700;
  color: #1d2330;
  display: flex !important;
  align-items: center !important;
  gap: 8px !important;
}
/* Column status dot prefixed before the title */
.orders-column .card-header::before {
  content: '';
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: #e08a1e;
  flex-shrink: 0;
}
.orders-column[data-status="SAIU_PARA_ENTREGA"] .card-header::before { background: #2b6fe0; }
.orders-column[data-status="CONFIRMACAO_PAGAMENTO"] .card-header::before { background: #9a5cd0; }
.orders-column[data-status="CONCLUIDO"] .card-header::before { background: #2e8c5a; }
.orders-column[data-status="CANCELADO"] .card-header::before { background: #e23b3b; }
.orders-column[data-status="EM_PREPARO"] .card-header::before { background: #e08a1e; }

.orders-column .card-header .badge.bg-secondary {
  background: #f4f5f7 !important;
  color: #5a6373 !important;
  font-weight: 800;
  font-size: 0.78rem !important;
  height: 22px;
  min-width: 26px;
  border-radius: 11px;
  padding: 0 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
/* Status-tinted count badge */
.orders-column[data-status="EM_PREPARO"] .card-header .badge.bg-secondary { background: #fdf2e0 !important; color: #e08a1e !important; }
.orders-column[data-status="SAIU_PARA_ENTREGA"] .card-header .badge.bg-secondary { background: #e7f0fe !important; color: #2b6fe0 !important; }
.orders-column[data-status="CONFIRMACAO_PAGAMENTO"] .card-header .badge.bg-secondary { background: #f3ebfb !important; color: #9a5cd0 !important; }
.orders-column[data-status="CONCLUIDO"] .card-header .badge.bg-secondary { background: #e6f4ec !important; color: #2e8c5a !important; }

.orders-column .list {
  padding: 12px !important;
  background: transparent;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.orders-column .list > .card.card-body { margin-bottom: 0 !important; }

/* ── Order card (Chefiz card) ── */
.order-card {
  background: #fff !important;
  border: 1px solid #e9ecf1 !important;
  border-radius: 16px !important;
  box-shadow: 0 1px 3px rgba(0,0,0,0.04) !important;
  padding: 0 !important;
  overflow: visible;
  /* Each card sizes to its own content — never stretches to fill the
     column. The markup uses `card card-body` on the same element, which
     inherits Bootstrap's `flex: 1 1 auto`, so we have to undo the grow
     factor explicitly when sitting inside the kanban flex column. */
  flex: 0 0 auto !important;
  align-self: stretch;
}
.order-card:hover {
  border-color: #cfd5dd !important;
  box-shadow: 0 4px 12px rgba(0,0,0,0.06) !important;
}
.order-card > .card-body {
  padding: 14px !important;
  cursor: grab;
}

/* Header row: #id pill colored by status + name + channel */
.order-card .oc-header { gap: 8px; align-items: center; margin-bottom: 8px; }
.order-card .oc-title {
  font-size: 0.9rem;
  font-weight: 700;
  color: #1d2330;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.order-card .oc-title::first-letter { font-weight: 800; }
.order-card .oc-customer-name { font-weight: 700; }
.order-card .oc-channel {
  font-size: 0.7rem;
  color: #929aa8;
  font-weight: 600;
  max-width: 130px;
  text-align: right;
}

/* Info chip row */
.order-card .oc-info { gap: 6px 12px; margin-bottom: 8px; }
.order-card .oc-chip {
  font-size: 0.78rem;
  color: #5a6373;
  font-weight: 500;
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.order-card .oc-chip i { color: #929aa8; font-size: 0.78rem; }
.order-card .oc-chip--ifood {
  background: rgba(234,29,44,0.08);
  color: #ea1d2c;
  border-radius: 8px;
  padding: 2px 8px;
  font-weight: 700;
}
.order-card .oc-chip--ifood i { color: #ea1d2c; }
.order-card .oc-chip--collect {
  background: #fdf2e0;
  color: #e08a1e;
  font-weight: 700;
  border-radius: 9px;
  padding: 3px 10px;
}
.order-card .oc-chip--collect i { color: #e08a1e; }

/* Address row */
.order-card .oc-address {
  font-size: 0.78rem;
  color: #5a6373;
  font-weight: 500;
  margin: 4px 0 8px;
  display: flex;
  align-items: center;
  gap: 6px;
}
.order-card .oc-address::before {
  content: '\F1A1';
  font-family: 'bootstrap-icons';
  font-size: 0.85rem;
  color: #929aa8;
  flex-shrink: 0;
}

/* Time + total row */
.order-card .d-flex.justify-content-between { align-items: center; }
.order-card .oc-time {
  font-size: 0.75rem;
  color: #929aa8;
  font-weight: 600;
}
.order-card .oc-total {
  font-weight: 800 !important;
  font-size: 1.05rem !important;
  color: #2e8c5a !important;
}

/* Footer with rounded icon buttons */
.order-card .oc-footer {
  border-top: 1px solid #f0f2f5 !important;
  padding-top: 10px !important;
  margin-top: 10px;
  gap: 8px;
}
.order-card .oc-actions { gap: 5px; }
.order-card .oc-actions .btn {
  width: 32px;
  height: 32px;
  padding: 0 !important;
  border-radius: 9px;
  border: 1px solid #e9ecf1;
  background: #fff;
  color: #5a6373;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 0.85rem !important;
  transition: background .12s, border-color .12s;
}
.order-card .oc-actions .btn:hover {
  background: #f4f5f7;
  border-color: #cfd5dd;
}
/* keep the wider "Avançar" / "Pronto" / "Retirado" buttons readable
   AND visually the same height — explicit min/max height + flex centering
   so the bag-check vs arrow-right icons don't make one look taller. */
.order-card .oc-actions .btn.advance,
.order-card .oc-actions .btn-info,
.order-card .oc-actions .btn-success.btn-sm:not([title="Imprimir cupom fiscal"]) {
  width: auto;
  height: 34px !important;
  min-height: 34px !important;
  padding: 0 14px !important;
  font-size: 0.78rem !important;
  font-weight: 700 !important;
  gap: 5px;
  line-height: 1;
  display: inline-flex !important;
  align-items: center;
  justify-content: center;
}
.order-card .oc-actions .btn.advance i,
.order-card .oc-actions .btn-info i,
.order-card .oc-actions .btn-success.btn-sm:not([title="Imprimir cupom fiscal"]) i {
  font-size: 0.9rem;
  line-height: 1;
}
.order-card .oc-actions .btn.advance {
  background: #89D136 !important;
  color: #fff !important;
  border-color: #89D136;
  box-shadow: 0 2px 6px rgba(137,209,54,0.30);
}
.order-card .oc-actions .btn-outline-success { color: #2e8c5a; border-color: rgba(46,140,90,0.40); }
.order-card .oc-actions .btn-success { background: #2e8c5a !important; border-color: #2e8c5a; color: #fff; }
.order-card .oc-actions .btn-outline-danger { color: #e23b3b; border-color: rgba(226,59,59,0.30); }
/* "Pronto" / takeout-advance button — Chefiz blue (matches the "Entrega"
   kanban color). Bootstrap's btn-info has lower specificity than my
   generic .btn override above, so restore it explicitly. */
.order-card .oc-actions .btn-info {
  background: #2b6fe0 !important;
  border-color: #2b6fe0 !important;
  color: #fff !important;
  box-shadow: 0 2px 6px rgba(43,111,224,0.30);
}
.order-card .oc-actions .btn-info:hover {
  background: #2058c4 !important;
  border-color: #2058c4 !important;
}

/* Selected card */
.order-card.selected {
  background: rgba(137,209,54,0.06) !important;
  border-color: #89D136 !important;
  box-shadow: 0 0 0 3px rgba(137,209,54,0.16) !important;
}

/* Custom checkbox → lime */
.order-checkbox input:checked + .order-checkbox-mark {
  background: #89D136 !important;
  border-color: #89D136 !important;
}
.order-checkbox:hover .order-checkbox-mark {
  border-color: #89D136 !important;
  box-shadow: 0 0 0 3px rgba(137,209,54,0.18) !important;
}

/* ── Order details modal (Chefiz detail sheet) ── */
.od-modal {
  border-radius: 18px !important;
  overflow: hidden;
  box-shadow: 0 24px 60px rgba(0,0,0,0.25);
}
.od-modal-header {
  background: linear-gradient(135deg, #e9f6ec, #dcefe2) !important;
  padding: 18px 20px !important;
  border-bottom: 1px solid #e9ecf1 !important;
}
.od-order-badge {
  background: #2e8c5a !important;
  color: #fff;
  font-weight: 800;
  font-size: 1.05rem;
  padding: 8px 14px;
  border-radius: 11px;
}
.od-customer-name { font-weight: 800; font-size: 1.05rem; color: #1d2330; }
.od-customer-phone { font-size: 0.82rem; color: #5a6373; font-weight: 500; }
.od-info-bar {
  padding: 11px 20px;
  background: #fff;
  border-bottom: 1px solid #e9ecf1;
  font-size: 0.8rem;
  color: #5a6373;
  font-weight: 500;
}
.od-info-item i { color: #929aa8; }
.od-section {
  padding: 14px 20px !important;
  border-top: 8px solid #f4f5f7 !important;
  border-bottom: none !important;
}
.od-section:first-of-type { border-top: none !important; }
.od-section-title {
  font-size: 0.78rem;
  font-weight: 800;
  color: #5a6373;
  letter-spacing: 0.6px;
  text-transform: uppercase;
}
.od-section-title i { color: #5a6373; }
.od-item-price,
.od-pay-total .od-pay-value { color: #2e8c5a !important; }
.od-pay-total .od-pay-value { font-weight: 800; font-size: 1.15rem; }
.od-modal-footer {
  padding: 12px 14px !important;
  gap: 8px;
  border-top: 1px solid #e9ecf1;
}
.od-modal-footer .btn {
  height: 52px;
  border-radius: 12px !important;
  font-weight: 700;
  font-size: 0.85rem;
}
.od-modal-footer .btn-primary,
.od-modal-footer .btn-success {
  background: #89D136 !important;
  border-color: #89D136 !important;
  color: #fff !important;
  box-shadow: 0 3px 10px rgba(137,209,54,0.30);
}

/* ── Bulk actions bar (lime treatment) ── */
.bulk-actions-bar {
  background: #1d2330 !important;
  padding: 12px 20px !important;
  border-radius: 16px 16px 0 0;
  box-shadow: 0 -4px 20px rgba(0,0,0,0.20) !important;
}
.bulk-actions-bar .btn-primary {
  background: #89D136 !important;
  border-color: #89D136 !important;
  color: #fff !important;
}
.bulk-actions-bar .btn-success {
  background: #2e8c5a !important;
  border-color: #2e8c5a !important;
}

/* ── Pending acceptance + no-cash boxes (Chefiz palette) ── */
.pending-acceptance-box {
  border-color: #e08a1e !important;
  background: #fdf2e0 !important;
  border-radius: 14px !important;
}
.pending-header { background: #e08a1e !important; color: #fff !important; }
.no-cash-box {
  border-color: #e23b3b !important;
  background: #fdecec !important;
  border-radius: 14px !important;
}
.no-cash-header { background: #e23b3b !important; }

/* ── Responsive: mobile ── */
@media (max-width: 768px) {
  .container-fluid.p-4 { padding: 12px !important; }
  .container-fluid.p-4 .orders-toolbar__top h2 { font-size: 1.25rem !important; }
  .container-fluid.p-4 .orders-toolbar__top .btn-sm { height: 36px; padding: 0 10px; }
  .orders-board .boards { padding: 0; }
  .orders-column { min-width: 100% !important; flex: 1 1 100% !important; }
  /* Mobile bulk bar reserves room for the app's bottom nav, if present */
  .bulk-actions-bar { padding-bottom: calc(12px + env(safe-area-inset-bottom, 0)) !important; }
}

</style>