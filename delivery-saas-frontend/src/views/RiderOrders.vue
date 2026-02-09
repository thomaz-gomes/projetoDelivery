<template>
  <div class="container py-3">
    <div class="d-flex justify-content-between align-items-center mb-3">
      <h4>Meus Pedidos</h4>
      <div>
        <button class="btn btn-outline-secondary" @click="load">Recarregar</button>
      </div>
    </div>

    <div v-if="loading" class="text-center">Carregando...</div>

    <div v-else>
      <div v-if="orders.length === 0" class="text-center text-muted">Nenhum pedido disponível.</div>
      <transition-group name="fade-list" tag="div" class="d-grid gap-3">
        <div v-for="o in orders" :key="o.id" class="card">
          <div class="card-header d-flex justify-content-between align-items-start">
            <div>
              <div class="fw-semibold">#{{ o.displayId || o.displaySimple }} — {{ o.customerName || o.customerPhone || 'Cliente' }}</div>
              <div class="small text-muted d-flex align-items-center gap-2">
                <span>{{ o.customerPhone || '' }}</span>
                <div v-if="o.customerPhone" class="d-flex gap-1">
                  <a :href="'tel:' + o.customerPhone" class="btn btn-sm btn-outline-primary py-0 px-1" title="Ligar">
                    <i class="bi bi-telephone-fill"></i>
                  </a>
                  <a :href="getWhatsAppLink(o.customerPhone)" target="_blank" class="btn btn-sm btn-outline-success py-0 px-1" title="WhatsApp">
                    <i class="bi bi-whatsapp"></i>
                  </a>
                </div>
              </div>
            </div>
            <div class="text-end small text-muted">
              <div>{{ formatDate(o.createdAt) }}</div>
              <div class="fw-semibold text-success">{{ formatMoney(o.total) }}</div>
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
          <div class="card-footer d-flex justify-content-between">
            <div>
              <button v-if="o.status === 'SAIU_PARA_ENTREGA'" class="btn btn-sm btn-success" @click="markDelivered(o)">Marcar entregue</button>
              <button class="btn btn-sm btn-outline-secondary ms-2" @click="viewOrder(o)">Ver</button>
            </div>
            <div class="small text-muted">Comanda: {{ o.displayId || o.displaySimple || o.id.slice(0,6) }}</div>
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

const orders = ref([])
const loading = ref(false)
let socket = null

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

function viewOrder(o){
  // navigate to order detail page if exists
  if (o.id) window.location.href = `/orders/${o.id}/receipt`;
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
        }
      }catch(e){ console.warn('order-updated handler error', e) }
    });
  }catch(e){ console.warn('Failed to init socket in RiderOrders', e) }
}

onMounted(()=>{ 
  load(); 
  ensureSocket(); 
  try{ window.addEventListener('open-rider-scanner', externalOpenScannerHandler) }catch(e){}
})
onUnmounted(()=>{ 
  try{ socket && socket.disconnect(); }catch(e){} 
  try{ window.removeEventListener('open-rider-scanner', externalOpenScannerHandler) }catch(e){}
  stopScanner();
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
