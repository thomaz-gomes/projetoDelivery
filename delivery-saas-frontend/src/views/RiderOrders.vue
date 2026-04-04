<template>
  <div class="container py-3">
    <div class="d-flex justify-content-between align-items-center mb-3">
      <h4>Meus Pedidos</h4>
      <div class="d-flex align-items-center gap-2">
        <span v-if="trackingEnabled && activeOrderForTracking" class="badge bg-success px-2 py-1">
          📡 GPS Ativo
        </span>
        <span v-else-if="!trackingEnabled" class="badge bg-secondary px-2 py-1">
          📡 Rastreamento Desligado pelo Admin
        </span>
        <button class="btn btn-outline-secondary btn-sm" @click="load">Recarregar</button>
      </div>
    </div>

    <div v-if="loading" class="text-center">Carregando...</div>

    <div v-else>
      <div v-if="orders.length === 0" class="text-center text-muted">Nenhum pedido disponível.</div>
      <transition-group name="fade-list" tag="div" class="d-grid gap-3">
        <div v-for="o in orders" :key="o.id" class="card">
          <div class="card-header">
            <div class="d-flex justify-content-between align-items-center mb-1">
              <span class="fw-bold">#{{ o.displayId || o.displaySimple }}</span>
              <span :class="statusBadgeClass(o.status)" class="badge">{{ statusLabel(o.status) }}</span>
            </div>
            <div class="d-flex justify-content-between align-items-center">
              <div class="small">
                <span class="fw-semibold">{{ o.customerName || 'Cliente' }}</span>
                <div v-if="o.customerPhone" class="d-flex align-items-center gap-1 mt-1">
                  <span class="text-muted">{{ o.customerPhone }}</span>
                  <a :href="'tel:' + o.customerPhone" class="btn btn-sm btn-outline-primary py-0 px-1" title="Ligar"><i class="bi bi-telephone-fill"></i></a>
                  <a :href="getWhatsAppLink(o.customerPhone)" target="_blank" class="btn btn-sm btn-outline-success py-0 px-1" title="WhatsApp"><i class="bi bi-whatsapp"></i></a>
                </div>
              </div>
              <div class="text-end">
                <div class="fw-bold text-success">{{ formatMoney(o.total) }}</div>
                <div class="text-muted" style="font-size: 0.7rem">{{ formatDate(o.createdAt) }}</div>
              </div>
            </div>
          </div>
          <div class="card-body">
            <div class="mb-2">
              <strong>Endereço:</strong> {{ formatAddress(o) }}
              <a v-if="getAddressForMaps(o)" :href="getGoogleMapsLink(o)" target="_blank" class="btn btn-sm btn-outline-info py-0 px-1 ms-1" title="Ver no Google Maps">
                <i class="bi bi-geo-alt-fill"></i>
              </a>
            </div>
            <div class="mb-2"><strong>Pagamento:</strong> {{ formatPayment(o) }}</div>
            <div class="mb-2"><strong>Itens:</strong>
              <ul class="mb-0">
                <li v-for="it in normalizeOrderItems(o)" :key="it.id || (it.name + String(it.price) + it.quantity)" class="small">
                  <div class="d-flex justify-content-between">
                    <div>{{ (it.quantity || 1) }}x {{ it.name }}</div>
                    <div class="text-muted">{{ formatMoney(it.unitPrice || it.price || it.amount || 0) }}</div>
                  </div>
                </li>
              </ul>
            </div>
          </div>
          <div v-if="o.status === 'SAIU_PARA_ENTREGA'" class="card-footer">
            <button class="btn btn-success w-100" @click="markDelivered(o)">
              <i class="bi bi-check-circle me-1"></i>Marcar entregue
            </button>
          </div>
        </div>
  </transition-group>
    </div>

    <!-- QR Scanner Modal -->
    <div v-if="scanning" class="scanner-overlay">
      <div class="scanner-container">
        <div class="scanner-header">
          <strong>Leitor QR</strong>
          <button class="btn btn-sm btn-outline-light" @click="stopScanner">Fechar</button>
        </div>
        <video ref="videoEl" autoplay playsinline muted class="scanner-video"></video>
        <div class="scanner-footer">
          <div class="small text-white">Aponte a câmera para o QR do pedido</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import api from '../api'
import { formatDateTime } from '../utils/dates'
import { io } from 'socket.io-client'
import { SOCKET_URL } from '@/config'
import { normalizeOrderItems } from '../utils/orderUtils.js'
import Swal from 'sweetalert2'
import { isNativeApp, startNativeTracking, stopNativeTracking } from '../utils/nativeTracking.js'

const orders = ref([])
const loading = ref(false)
let socket = null

// GPS Tracking state
const trackingEnabled = ref(false)
const activeOrderForTracking = ref(null)
let watchId = null
let trackingIntervalId = null
let wakeLock = null

// QR Scanner state
const scanning = ref(false)
const videoEl = ref(null)
let stream = null
let qrScanner = null

function stopScanner() {
  scanning.value = false;
  if (qrScanner) {
    try { qrScanner.stop(); } catch (__) {}
    qrScanner = null;
  }
  if (stream) {
    stream.getTracks().forEach(t => t.stop());
    stream = null;
  }
}

async function startScanner() {
  try {
    scanning.value = true;
    const constraints = { video: { facingMode: 'environment' } };
    stream = await navigator.mediaDevices.getUserMedia(constraints);
    if (videoEl.value) videoEl.value.srcObject = stream;

    if ('BarcodeDetector' in window) {
      const detector = new BarcodeDetector({ formats: ['qr_code'] });
      const poll = async () => {
        if (!scanning.value) return;
        try {
          const detections = await detector.detect(videoEl.value);
          if (detections && detections.length > 0) {
            const raw = detections[0].rawValue || detections[0].rawData || '';
            stopScanner();
            await claimTokenFromText(raw);
            return;
          }
        } catch (e) {
          console.warn('BarcodeDetector error, falling back to qr-scanner', e);
          try { await startQrScannerFallback(); } catch (__) {}
          return;
        }
        setTimeout(poll, 500);
      };
      setTimeout(poll, 500);
    } else {
      await startQrScannerFallback();
    }
  } catch (e) {
    console.error('Scanner error', e);
    Swal.fire({ icon: 'error', text: 'Não foi possível acessar a câmera. Verifique as permissões.' });
    scanning.value = false;
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  }
}

async function startQrScannerFallback() {
  try {
    const module = await import('qr-scanner');
    const QrScanner = module.default || module;
    QrScanner.WORKER_PATH = '/node_modules/qr-scanner/qr-scanner-worker.min.js';
    qrScanner = new QrScanner(videoEl.value, result => {
      stopScanner();
      claimTokenFromText(result).catch(()=>{});
    });
    await qrScanner.start();
  } catch (e) {
    console.error('qr-scanner fallback failed', e);
    Swal.fire({ icon: 'error', text: 'Falha ao iniciar o leitor. Tente novamente.' });
  }
}

async function claimTokenFromText(text) {
  if (!text) return Swal.fire({ icon: 'error', text: 'QR inválido' });
  const m = String(text).match(/([A-Za-z0-9_-]{8,})$/);
  const token = m ? m[1] : String(text).trim();
  try {
    const { data } = await api.post(`/tickets/${encodeURIComponent(token)}/claim`);
    if (data && data.ok) {
      Swal.fire({ icon: 'success', title: 'Pedido atribuído', html: `Pedido <b>${data.order.displayId || data.order.id}</b> atribuído a você.` });
      // reload orders list
      await load();
    } else {
      Swal.fire({ icon: 'error', text: 'Falha ao atribuir pedido' });
    }
  } catch (e) {
    console.error('claim failed', e);
    Swal.fire({ icon: 'error', text: e?.response?.data?.message || 'Falha ao ler QR e atribuir pedido' });
  }
}

function externalOpenScannerHandler(){
  try{ if(!scanning.value) startScanner().catch(()=>{}); }catch(e){ console.warn('externalOpenScannerHandler', e) }
}

function formatMoney(v){ try{ return new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(v||0)) }catch(e){ return v } }
function statusLabel(s) {
  const map = { PENDENTE_ACEITE: 'Pendente', EM_PREPARO: 'Em Preparo', PRONTO: 'Pronto', SAIU_PARA_ENTREGA: 'Em Entrega', CONFIRMACAO_PAGAMENTO: 'Aguardando Pgto' }
  return map[s] || s
}
function statusBadgeClass(s) {
  const map = { SAIU_PARA_ENTREGA: 'bg-primary', EM_PREPARO: 'bg-warning text-dark', PRONTO: 'bg-info', CONFIRMACAO_PAGAMENTO: 'bg-secondary', PENDENTE_ACEITE: 'bg-light text-dark' }
  return map[s] || 'bg-secondary'
}
function formatDate(d){ if(!d) return ''; try{ return formatDateTime(d) }catch(e){ return d } }
function getWhatsAppLink(phone) {
  if (!phone) return '#';
  // remove non-digits
  const digits = String(phone).replace(/\D/g, '');
  return `https://wa.me/55${digits}`;
}

function formatPayment(o) {
  try {
    if (!o) return '-';
    // Try multiple possible payment locations
    const payment = o.payment || 
                   o.payload?.payment || 
                   (o.payload?.payments && o.payload.payments[0]) ||
                   (o.payload?.rawPayload?.payment) ||
                   (o.payload?.rawPayload?.payments && o.payload.rawPayload.payments[0]);
    
    if (!payment) return '-';
    
    const method = payment.methodName || payment.method || payment.type || payment.name;
    const value = payment.value || payment.amount;
    
    if (method && value) {
      return `${method} - ${formatMoney(value)}`;
    }
    return method || '-';
  } catch (e) {
    console.warn('formatPayment error', e);
    return '-';
  }
}

function getAddressForMaps(o) {
  try {
    if (!o) return null;
    const addr = o.address || 
                o.payload?.delivery?.deliveryAddress || 
                o.deliveryAddress || 
                o.customerAddress || 
                o.payload?.rawPayload?.address;
    return addr;
  } catch (e) {
    return null;
  }
}

function getGoogleMapsLink(o) {
  try {
    const addr = getAddressForMaps(o);
    if (!addr) return '#';
    
    // Try coordinates first
    if (addr.latitude && addr.longitude) {
      return `https://www.google.com/maps?q=${addr.latitude},${addr.longitude}`;
    }
    
    // Build address string for search
    const parts = [];
    if (addr.street || addr.streetName) parts.push(addr.street || addr.streetName);
    if (addr.number || addr.streetNumber) parts.push(addr.number || addr.streetNumber);
    if (addr.neighborhood) parts.push(addr.neighborhood);
    if (addr.city) parts.push(addr.city);
    if (addr.state) parts.push(addr.state);
    if (addr.postalCode || addr.zipCode) parts.push(addr.postalCode || addr.zipCode);
    
    // If we have formattedAddress, use it
    if (addr.formattedAddress || addr.formatted) {
      return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr.formattedAddress || addr.formatted)}`;
    }
    
    // Otherwise build from parts
    if (parts.length > 0) {
      return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(parts.join(', '))}`;
    }
    
    // Last resort: just the address string
    if (o.address && typeof o.address === 'string') {
      return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(o.address)}`;
    }
    
    return '#';
  } catch (e) {
    console.warn('getGoogleMapsLink error', e);
    return '#';
  }
}

function formatAddress(o){
  try{
    if(!o) return '-'
    
    // Try to find address object from multiple possible locations
    const a = o.payload?.delivery?.deliveryAddress || 
             o.address || 
             o.deliveryAddress || 
             o.customerAddress || 
             o.payload?.rawPayload?.address ||
             o.payload?.rawPayload?.delivery?.deliveryAddress;
    
    // If address is a simple string, return it
    if (typeof o.address === 'string' && o.address) return o.address;
    if (typeof a === 'string' && a) return a;
    
    if(!a) return '-';
    
    // Build formatted address
    const main = a.formattedAddress || 
                a.formatted || 
                [a.street || a.streetName, a.number || a.streetNumber].filter(Boolean).join(', ');
    
    const tail = []
    if(a.neighborhood) tail.push(a.neighborhood)
    if(a.complement) tail.push('Comp: ' + a.complement)
    if(a.reference) tail.push('Ref: ' + a.reference)
    if(a.observation) tail.push('Obs: ' + a.observation)
    if(a.city && !tail.includes(a.city)) tail.push(a.city)
    
    const result = [main, tail.filter(Boolean).join(' — ')].filter(Boolean).join(' | ');
    return result || '-';
  }catch(e){ 
    console.warn('formatAddress error', e);
    return '-';
  }
}

let usingNativeTracking = false

function sendPositionToServer(lat, lng, heading, accuracy, orderId) {
  if (accuracy && accuracy > 1000) return
  api.post('/riders/me/position', {
    lat, lng,
    heading: heading ?? null,
    orderId: orderId ?? null,
    accuracy: accuracy ?? null,
  }).catch((e) => console.warn('GPS position update failed:', e?.message))
}

async function acquireWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen')
      wakeLock.addEventListener('release', () => { wakeLock = null })
    }
  } catch (e) { /* non-blocking */ }
}

function releaseWakeLock() {
  try { if (wakeLock) { wakeLock.release(); wakeLock = null } } catch (e) {}
}

let lastPositionSentAt = 0

async function startTracking(orderId = null) {
  if (watchId !== null || usingNativeTracking) return // already tracking
  activeOrderForTracking.value = orderId || '__active__'

  await acquireWakeLock()

  // Try native Capacitor GPS first (works in background)
  if (isNativeApp()) {
    const started = await startNativeTracking((lat, lng, heading, accuracy) => {
      sendPositionToServer(lat, lng, heading, accuracy, orderId)
    })
    if (started) {
      usingNativeTracking = true
      return
    }
  }

  if (!navigator.geolocation) return

  // Throttled sender — max once per 8s to avoid flooding
  const sendPosition = (pos) => {
    const now = Date.now()
    if (now - lastPositionSentAt < 8000) return
    lastPositionSentAt = now
    const { latitude: lat, longitude: lng, heading, accuracy } = pos.coords
    sendPositionToServer(lat, lng, heading, accuracy, orderId)
  }

  // watchPosition is the PRIMARY mechanism — OS-level, fires on movement
  watchId = navigator.geolocation.watchPosition(
    sendPosition,
    (err) => {
      console.warn('GPS watchPosition error:', err?.message)
      // Auto-restart watchPosition on failure
      if (watchId !== null) {
        try { navigator.geolocation.clearWatch(watchId) } catch (e) {}
        watchId = null
      }
      setTimeout(() => {
        if (activeOrderForTracking.value && watchId === null) {
          watchId = navigator.geolocation.watchPosition(
            sendPosition,
            () => {},
            { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 }
          )
        }
      }, 3000)
    },
    { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 }
  )

  // Heartbeat every 30s — fallback if watchPosition stalls
  trackingIntervalId = setInterval(() => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lng, heading, accuracy } = pos.coords
        sendPositionToServer(lat, lng, heading, accuracy, orderId)
      },
      () => {},
      { enableHighAccuracy: false, maximumAge: 30000, timeout: 15000 }
    )
  }, 30000)
}

function stopTracking() {
  releaseWakeLock()
  if (usingNativeTracking) {
    stopNativeTracking()
    usingNativeTracking = false
  }
  if (watchId !== null) {
    try { navigator.geolocation.clearWatch(watchId) } catch (e) {}
    watchId = null
  }
  if (trackingIntervalId !== null) {
    clearInterval(trackingIntervalId)
    trackingIntervalId = null
  }
  activeOrderForTracking.value = null
}

async function checkTrackingStatus() {
  try {
    const { data } = await api.get('/riders/tracking-status')
    trackingEnabled.value = data.enabled ?? false
  } catch (e) { /* non-blocking */ }
}

function syncTrackingWithOrders(orderList) {
  if (!trackingEnabled.value) { stopTracking(); return }
  // Always track when logged in and tracking is enabled
  const activeOrder = orderList.find(o => o.status === 'SAIU_PARA_ENTREGA')
  const orderId = activeOrder ? activeOrder.id : null
  if (activeOrderForTracking.value === null) {
    // Not tracking yet — start
    startTracking(orderId)
  } else if (activeOrder && activeOrderForTracking.value !== activeOrder.id) {
    // Active order changed — restart with new orderId
    stopTracking()
    startTracking(orderId)
  }
  // If no active order but already tracking, keep tracking (just without orderId)
}

async function load(){
  loading.value = true
  try{
    const res = await api.get('/riders/me/orders')
    const list = res.data.items || res.data || []
    // Many rider list endpoints return a lightweight order shape without items/payload.
    // Fetch full details for each order in parallel so cards show address, items and payment.
    try {
      const details = await Promise.all(list.map(async (o) => {
        try {
          const { data } = await api.get(`/orders/${o.id}`);
          return data || o;
        } catch (e) {
          // fallback to original light object
          return o;
        }
      }));
      // exclude already completed orders
      orders.value = details.filter(d => d && d.status !== 'CONCLUIDO');
    } catch (e) {
      orders.value = (list || []).filter(d => d && d.status !== 'CONCLUIDO');
    }
    syncTrackingWithOrders(orders.value)
  }catch(e){ console.error(e); alert(e?.response?.data?.message || 'Erro') }
  finally{ loading.value = false }
}

// normalizeOrderItems imported from ../utils/orderUtils.js

async function markDelivered(o){
  try{
    const { data } = await api.post(`/orders/${o.id}/complete`);
    if (data && data.ok) {
      // remove from list immediately
      orders.value = orders.value.filter(x => x.id !== o.id)
      // success feedback: small non-blocking toast
      try { Swal && Swal.fire && Swal.fire({ icon: 'success', title: 'Entregue', text: `Pedido ${o.displayId || o.id} marcado como entregue.`, toast: true, position: 'top-end', timer: 2500, showConfirmButton: false }); } catch(e) {}
    } else {
      try { Swal && Swal.fire && Swal.fire({ icon: 'error', title: 'Erro', text: 'Falha ao marcar entregue', toast: true, position: 'top-end' }); } catch(e) {}
    }
  }catch(e){ console.error(e); try { Swal && Swal.fire && Swal.fire({ icon: 'error', title: 'Erro', text: e?.response?.data?.message || 'Erro ao marcar entregue', toast: true, position: 'top-end' }); } catch(_){} }
}

function ensureSocket(){
  try{
    socket = io(SOCKET_URL, { transports: ['websocket'] });
    socket.on('connect', () => console.log('RiderOrders socket connected', socket.id));
    socket.on('disconnect', () => console.log('RiderOrders socket disconnected'));
    socket.on('order-updated', async (payload) => {
      try{
        const id = payload && (payload.id || payload.orderId);
        if (!id) return;
        // if order concluded, remove from list
        if (payload.status === 'CONCLUIDO'){
          orders.value = orders.value.filter(x => x.id !== id);
          return;
        }
        // otherwise refresh that order details if present
        const idx = orders.value.findIndex(x => x.id === id);
        if (idx !== -1){
          try{
            const { data } = await api.get(`/orders/${id}`);
            orders.value.splice(idx, 1, data);
          }catch(e){ console.warn('Failed to refresh order after update', e); }
        } else {
          // Order not in list — may have been newly assigned to this rider; reload all
          await load();
        }
        syncTrackingWithOrders(orders.value);
      }catch(e){ console.warn('order-updated handler error', e) }
    });
  }catch(e){ console.warn('Failed to init socket in RiderOrders', e) }
}

// Reinicia o tracking quando a página volta ao foco (tela desbloqueada, app ativo)
// Isso resolve o problema de watchPosition ser suspenso em segundo plano no mobile.
function onVisibilityChange() {
  if (document.visibilityState === 'visible' && trackingEnabled.value) {
    if (activeOrderForTracking.value) {
      // Restart watch — may have been paused by browser while in bg
      const currentOrderId = activeOrderForTracking.value === '__active__' ? null : activeOrderForTracking.value
      stopTracking()
      startTracking(currentOrderId)
    } else {
      // Page came back visible but not tracking — start if enabled
      startTracking(null)
    }
  }
}

function onBeforeUnload() {
  const token = localStorage.getItem('token')
  if (token && trackingEnabled.value && activeOrderForTracking.value) {
    try {
      fetch(`${api.defaults.baseURL}/riders/me/position`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
        keepalive: true,
      }).catch(() => {})
    } catch (e) { /* best effort */ }
  }
}

onMounted(async () => {
  await checkTrackingStatus()
  // Start GPS tracking immediately if enabled (don't wait for orders)
  if (trackingEnabled.value && navigator.geolocation) {
    startTracking(null)
  }
  load()
  ensureSocket()
  try { window.addEventListener('open-rider-scanner', externalOpenScannerHandler) } catch (e) {}
  document.addEventListener('visibilitychange', onVisibilityChange)
  window.addEventListener('beforeunload', onBeforeUnload)
})
onUnmounted(() => {
  stopTracking()
  try { socket && socket.disconnect() } catch (e) {}
  try { window.removeEventListener('open-rider-scanner', externalOpenScannerHandler) } catch (e) {}
  document.removeEventListener('visibilitychange', onVisibilityChange)
  window.removeEventListener('beforeunload', onBeforeUnload)
  stopScanner()
})
</script>

<style scoped>
.fade-list-enter-active, .fade-list-leave-active {
  transition: all 300ms ease;
}
.fade-list-enter-from { opacity: 0; transform: translateY(-8px); }
.fade-list-enter-to { opacity: 1; transform: translateY(0); }
.fade-list-leave-from { opacity: 1; transform: translateY(0); }
.fade-list-leave-to { opacity: 0; transform: translateY(8px); height: 0; margin: 0; padding: 0; }

/* QR Scanner Modal */
.scanner-overlay { 
  position: fixed; 
  top: 0; 
  left: 0; 
  right: 0; 
  bottom: 0; 
  z-index: 9999; 
  background: #000; 
  display: flex; 
  flex-direction: column;
}
.scanner-container {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
}
.scanner-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px;
  background: rgba(0, 0, 0, 0.8);
  color: white;
}
.scanner-video {
  flex: 1;
  width: 100%;
  object-fit: cover;
  background: #000;
}
.scanner-footer {
  padding: 20px;
  background: rgba(0, 0, 0, 0.8);
  text-align: center;
}
</style>
