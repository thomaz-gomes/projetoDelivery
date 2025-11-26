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
              <div class="small text-muted">{{ o.customerPhone || '' }}</div>
            </div>
            <div class="text-end small text-muted">
              <div>{{ formatDate(o.createdAt) }}</div>
              <div class="fw-semibold text-success">{{ formatMoney(o.total) }}</div>
            </div>
          </div>
          <div class="card-body">
            <div class="mb-2"><strong>Endereço:</strong> {{ o.address || o.payload?.delivery?.deliveryAddress?.formattedAddress || '-' }}</div>
            <div class="mb-2"><strong>Pagamento:</strong> {{ o.payload?.payments ? (o.payload.payments[0]?.method || o.payload.payments[0]?.type) : (o.payment?.method || o.payment?.type) || '-' }}</div>
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
            <div class="mt-2 text-muted small">Status: <strong class="text-uppercase">{{ o.status }}</strong></div>
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
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import api from '../api'
import { io } from 'socket.io-client'
import { SOCKET_URL } from '@/config'
import { normalizeOrderItems } from '../utils/orderUtils.js'

const orders = ref([])
const loading = ref(false)
let socket = null

function formatMoney(v){ try{ return new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(v||0)) }catch(e){ return v } }
function formatDate(d){ if(!d) return ''; try{ return new Date(d).toLocaleString() }catch(e){ return d } }

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

onMounted(()=>{ load(); ensureSocket(); })
onUnmounted(()=>{ try{ socket && socket.disconnect(); }catch(e){} })
</script>

<style scoped>
.fade-list-enter-active, .fade-list-leave-active {
  transition: all 300ms ease;
}
.fade-list-enter-from { opacity: 0; transform: translateY(-8px); }
.fade-list-enter-to { opacity: 1; transform: translateY(0); }
.fade-list-leave-from { opacity: 1; transform: translateY(0); }
.fade-list-leave-to { opacity: 0; transform: translateY(8px); height: 0; margin: 0; padding: 0; }
</style>
