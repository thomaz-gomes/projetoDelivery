<script setup>
import { onMounted, ref, computed, onUnmounted, nextTick, watch } from 'vue';
import { useOrdersStore } from '../stores/orders';
import { useAuthStore } from '../stores/auth';
import { useRouter } from 'vue-router';
import Swal from 'sweetalert2';
import { io } from 'socket.io-client';
import 'sweetalert2/dist/sweetalert2.min.css';
import printService from "../services/printService.js";
import PrinterStatus from '../components/PrinterStatus.vue';

import api from '../api';
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
// extra filters
const searchOrderNumber = ref('');
const searchCustomerName = ref('');
let audio = null;
const now = ref(Date.now());

// atualiza 'now' a cada 30s para que durações sejam atualizadas na interface
let nowTimer = null;

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
    body: `${pedido.customerName || "Cliente"} — R$${Number(pedido.total || 0).toFixed(2)}`,
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
    await store.fetchRiders();
  } catch (e) {
    console.error(e);
    Swal.fire('Erro', 'Falha ao carregar pedidos/entregadores.', 'error');
  }

  // 🔌 Conectar ao servidor (tempo real)
  socket.value = io('https://localhost:3000');
  socket.value.on('connect', () => console.log('📡 Conectado ao servidor de pedidos.'));

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
    store.orders.unshift(full);
    // remove a marcação após a animação
    nextTick(() => setTimeout(() => { full._isNew = false; }, 900));
    beep();
    pulseButton();
    showNotification(full);

    try {
      await printService.enqueuePrint(full);
      console.log(`🖨️ Impressão automática enviada: ${formatDisplay(full)}`);
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

  socket.value.on('disconnect', () => {
    console.warn('⚠️ Desconectado do servidor de pedidos.');
  });
  // init drag & drop after DOM rendered
  await nextTick();
  initDragAndDrop();
  // inicia atualização de tempo para durações
  nowTimer = setInterval(() => (now.value = Date.now()), 30 * 1000);
});

// re-init drag/drop when orders list changes
watch(() => store.orders.length, async () => {
  await nextTick();
  initDragAndDrop();
});

onUnmounted(() => {
  socket.value?.disconnect();
  clearInterval(nowTimer);
  // destroy Sortable instances
  for (const s of sortableInstances) {
    try { s.destroy(); } catch (e) {}
  }
});

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

function parseDate(val) {
  if (!val) return null;
  if (val instanceof Date) return val;
  if (typeof val === 'number') return new Date(val);
  return new Date(val);
}

function formatDateShort(d) {
  if (!d) return '-';
  const dt = parseDate(d);
  const day = dt.getDate();
  let month = dt.toLocaleString('pt-BR', { month: 'short' });
  month = month.replace('.', '');
  const time = dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
  return `${day}/${month}, ${time}`;
}

function formatTimeOnly(d) {
  if (!d) return '-';
  const dt = parseDate(d);
  return dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
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
  return `${formatDateShort(created)} (${humanDuration(now.value - created.getTime())})`;
}

function getStatusStartDurationDisplay(o) {
  const start = getStatusStart(o);
  if (!start) return '';
  return `Desde ${formatTimeOnly(start)} (${humanDuration(now.value - start.getTime())})`;
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
  const pipeline = ['EM_PREPARO', 'SAIU_PARA_ENTREGA', 'CONCLUIDO'];
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
  CANCELADO: 'Cancelado',
  INVOICE_AUTHORIZED: 'NFC-e Autorizada',
};

// columns to render (order matters)
const COLUMNS = [
  { key: 'EM_PREPARO', label: 'Novos / Em preparo' },
  { key: 'SAIU_PARA_ENTREGA', label: 'Saiu para entrega' },
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
          if (toCol === 'CONCLUIDO'){
            const conf = await Swal.fire({ title: 'Marcar como concluído?', text: 'Deseja marcar este pedido como CONCLUÍDO?', icon: 'question', showCancelButton: true, confirmButtonText: 'Sim', cancelButtonText: 'Cancelar' })
            if(!conf.isConfirmed){ evt.from.insertBefore(li, evt.from.children[evt.oldIndex] || null); return }
          }
          if (toCol === 'CANCELADO'){
            const conf = await Swal.fire({ title: 'Cancelar pedido?', text: 'Tem certeza que deseja cancelar este pedido?', icon: 'warning', showCancelButton: true, confirmButtonText: 'Sim, cancelar', cancelButtonText: 'Manter' })
            if(!conf.isConfirmed){ evt.from.insertBefore(li, evt.from.children[evt.oldIndex] || null); return }
          }
          await changeStatus(order, toCol);
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
      await printService.enqueuePrint(order);
      console.log(`🧾 Impressão solicitada manualmente: ${formatDisplay(order)}`);

      Swal.fire({
        icon: "success",
        title: "Impressão enviada!",
        text: `Comanda do pedido ${formatDisplay(order)} enviada à impressora.`,
        timer: 2500,
        toast: true,
        position: "top-end",
        showConfirmButton: false,
      });
    } catch (err) {
    console.error("❌ Erro ao imprimir manualmente:", err);
    Swal.fire({
      icon: "error",
      title: "Erro ao imprimir",
      text:
        "Falha ao imprimir comanda. Verifique se o QZ Tray está aberto e autorizado.",
      timer: 4000,
      toast: true,
      position: "top-end",
      showConfirmButton: false,
    });
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
  { to: 'CONCLUIDO', label: 'Concluído' },
  { to: 'CANCELADO', label: 'Cancelar' },
];

const statusFilters = [
  { value: 'TODOS', label: 'Todos', color: 'secondary' },
  { value: 'EM_PREPARO', label: 'Em preparo', color: 'warning' },
  { value: 'SAIU_PARA_ENTREGA', label: 'Saiu p/ entrega', color: 'primary' },
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

function pulseButton() {
  if (!soundButton.value) return;
  soundButton.value.classList.add('btn-pulse');
  setTimeout(() => soundButton.value?.classList.remove('btn-pulse'), 800);
}

// duplicate real-time handler removed (handled inside onMounted)

</script>

<template>
  <div>
  <div class="container py-4">
    <header class="d-flex flex-wrap align-items-center justify-content-between mb-4 gap-3">
      <h2 class="fs-4 fw-semibold m-0">Pedidos</h2>
      <PrinterWatcher />
      <PrinterStatus />
    </header>

    <!-- 🔍 Filtros + Som -->
    <div
      class="filters-bar d-flex flex-wrap align-items-center justify-content-between gap-3 mb-4"
    >
  <!-- Filtros de status (visível apenas em dispositivos pequenos) -->
  <div class="btn-group flex-wrap d-flex d-md-none">
        <button
          v-for="s in statusFilters"
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
      <div class="d-flex align-items-center gap-2 flex-wrap">
        <select
          v-model="selectedRider"
          class="form-select form-select-sm"
          style="min-width: 200px;"
        >
          <option value="TODOS">Todos os entregadores</option>
          <!-- normalize option values to strings to avoid type-mismatch when comparing ids -->
          <option v-for="r in store.riders" :key="r.id" :value="String(r.id)">
            {{ r.name }}
          </option>
        </select>

        <input v-model="searchOrderNumber" class="form-control form-control-sm" placeholder="Nº pedido" style="max-width:140px;" />
        <input v-model="searchCustomerName" class="form-control form-control-sm" placeholder="Nome do cliente" style="min-width:200px; max-width:280px;" />

        <!-- 🔊 Botão de som -->
        <button
          ref="soundButton"
          type="button"
          class="btn position-relative"
          :class="playSound ? 'btn-primary' : 'btn-outline-secondary'"
          @click="toggleSound"
          title="Som de novos pedidos"
        >
          <i
            :class="playSound ? 'bi bi-volume-up-fill' : 'bi bi-volume-mute-fill'"
            class="fs-5"
          ></i>
        </button>
      </div>
    </div>

    <!-- Orders board: columns with drag & drop -->
    <div v-if="store.orders && store.orders.length > 0" class="orders-board">
      <div class="boards d-flex gap-3 overflow-auto py-2">
        <div class="orders-column card" v-for="col in COLUMNS" :key="col.key" :data-status="col.key">
          <div class="card-header d-flex align-items-center justify-content-between">
            <div class="fw-semibold">{{ col.label }}</div>
            <div><span class="badge bg-secondary">{{ columnOrders(col.key).length }}</span></div>
          </div>
          <div class="list mt-2  p-2" style="min-height:120px">
            <div v-for="o in columnOrders(col.key)" :key="o.id" class="card mb-2 order-card" :class="{ 'fade-in': o._isNew }" :data-order-id="o.id">
              <div class="card-body p-2 d-flex align-items-start gap-2">
                <div class="flex-grow-1">
                  <div class="d-flex align-items-center justify-content-between">
                    <div>
                          <div class="fw-semibold">#{{ formatDisplay(o) }} — {{ o.customerName || 'Cliente' }}</div>
                          <div class="text-muted small">{{ o.customerPhone || '' }}</div>
                          <div class="mt-1 small text-muted d-flex align-items-center">
                            <i class="bi bi-person-badge me-1"></i>
                            <span v-if="o.rider">{{ o.rider.name }}</span>
                            <span v-else class="text-muted">—</span>
                            <button v-if="o.rider" class="btn btn-sm btn-link p-0 ms-2" @click.stop="openWhatsAppToRider(o)" title="WhatsApp do entregador">
                              <i class="bi bi-whatsapp text-success"></i>
                            </button>
                          </div>
                    </div>
                    <div>
                      <span class="badge text-uppercase" :class="{
                        'bg-warning text-dark': o.status === 'EM_PREPARO',
                        'bg-primary': o.status === 'SAIU_PARA_ENTREGA',
                        'bg-success': o.status === 'CONCLUIDO',
                        'bg-danger': o.status === 'CANCELADO',
                        'bg-info text-white': o.status === 'INVOICE_AUTHORIZED'
                      }">{{ STATUS_LABEL[o.status] || o.status }}</span>
                    </div>
                  </div>
                  <div class="small text-muted mt-1">{{ o.address || o.payload?.delivery?.deliveryAddress?.formattedAddress || '-' }}</div>
                  <div class="d-flex justify-content-between align-items-center mt-2">
                    <div class="small text-muted">{{ getCreatedDurationDisplay(o) }}</div>
                    <div class="fw-semibold text-success">R$ {{ Number(o.total || 0).toFixed(2) }}</div>
                  </div>
                </div>
              </div>
              <div class="card-footer bg-transparent py-1 d-flex justify-content-between align-items-center">
                <div class="small text-muted">{{ getPaymentMethod(o) }}</div>
                <div>
                  <button class="btn btn-sm btn-light me-1" @click="printReceipt(o)"><i class="bi bi-printer"></i></button>
                  <button class="btn btn-sm btn-primary me-1" @click="advanceStatus(o)" :disabled="!getNextStatus(o.status) || !store.canTransition(o.status, getNextStatus(o.status)) || loading" title="Avançar status">
                    <i class="bi bi-arrow-right"></i>
                  </button>
                  <button class="btn btn-sm btn-outline-secondary" @click="toggleTimeline(o.id)">Detalhes</button>
                </div>
              </div>
              <div v-if="openTimeline[o.id]" class="p-2 bg-light small border-top">
                <div class="fw-semibold">Itens</div>
                <ul class="mb-1">
                  <li v-for="it in o.items" :key="it.id">{{ it.quantity || 1 }}x {{ it.name }}</li>
                </ul>
                <div v-if="getOrderNotes(o)" class="text-muted">{{ getOrderNotes(o) }}</div>
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
.orders-column {background-color: #E6E6E6; flex: 0 0 32%; }
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
</style>