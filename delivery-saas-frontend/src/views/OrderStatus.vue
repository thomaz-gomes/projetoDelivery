<template>
  <div class="container py-4">
    <div class="card">
      <div class="card-body">
        <h4>Pedido <small class="text-muted">#{{ displayId || order?.id?.slice(0,6) }}</small></h4>
        <div v-if="loading" class="text-center py-3">Carregando...</div>
        <div v-else>
          <div class="mb-3">
            <div class="small text-success">Seu pedido foi recebido — acompanhe o status abaixo. Você também pode compartilhar este pedido pelo WhatsApp.</div>
            <div class="mt-2">
              <button class="btn btn-success btn-sm" @click="shareOnWhatsApp" :disabled="!order">Compartilhar no WhatsApp</button>
            </div>
          </div>
          <div class="mb-2">
            <strong>Status:</strong>
            <span class="badge" :class="statusClass()">{{ statusLabel() }}</span>
          </div>

          <div class="mb-3 d-flex flex-column gap-2">
            <div class="d-flex justify-content-between align-items-start">
              <div class="d-flex align-items-center">
                <i class="bi bi-person me-2 text-muted" aria-hidden="true"></i>
                <div>
                  <div><strong>Cliente</strong></div>
                  <div class="small text-muted">{{ order?.customerName || order?.payload?.rawPayload?.customer?.name || '—' }}</div>
                </div>
              </div>
              <div class="small text-muted">{{ order?.customerPhone || order?.payload?.rawPayload?.customer?.contact || '—' }}</div>
            </div>

            <div class="d-flex justify-content-between align-items-start">
              <div class="d-flex align-items-center">
                <i class="bi bi-geo-alt me-2 text-muted" aria-hidden="true"></i>
                <div>
                  <div><strong>Endereço</strong></div>
                  <div class="small text-muted">{{ order?.address || order?.payload?.rawPayload?.customer?.address?.formattedAddress || '—' }}</div>
                </div>
              </div>
            </div>
          </div>

          <div class="mb-3">
            <strong>Itens</strong>
            <ul>
              <li v-for="it in order?.items || []" :key="it.id">{{ it.quantity }}x {{ it.name }} — R$ {{ Number(it.price || 0).toFixed(2) }}</li>
            </ul>
          </div>

          <div class="mb-3">
            <strong>Total:</strong> R$ {{ Number(order?.total || 0).toFixed(2) }}
          </div>

          <div v-if="order?.payment || order?.payload?.rawPayload?.payment" class="mb-3">
            <div class="d-flex align-items-center">
              <i class="bi bi-credit-card me-2 text-muted"></i>
              <div>
                <div><strong>Pagamento</strong></div>
                <div class="small text-muted">{{ (order?.payment && order.payment.methodName) || (order?.payload?.rawPayload?.payment && order.payload.rawPayload.payment.method) || '—' }}</div>
              </div>
            </div>
          </div>

          <div class="mb-3">
            <strong>Histórico:</strong>
            <ul>
              <li v-for="h in (order?.histories || [])" :key="h.id">{{ h.from || '—' }} → {{ h.to }} ({{ formatDate(h.createdAt) }})</li>
            </ul>
          </div>

          <div class="d-flex gap-2">
            <button class="btn btn-outline-secondary" @click="goBack">Voltar</button>
            <button class="btn btn-primary" v-if="canViewHistory" @click="goHistory">Ver meu histórico</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, computed } from 'vue'
import Swal from 'sweetalert2'
import { bindLoading } from '../state/globalLoading.js'
import { useRoute, useRouter } from 'vue-router'
import api from '../api'
import { io } from 'socket.io-client'

const route = useRoute()
const router = useRouter()
const companyId = route.params.companyId
const orderId = route.params.orderId
const phoneQuery = route.query.phone || ''
// persist storeId across public views so navigation keeps the selected store
const storeStorageKey = `public_store_${companyId}`
const storeId = ref(route.query.storeId || localStorage.getItem(storeStorageKey) || null)
try{ if(route.query && route.query.storeId) localStorage.setItem(storeStorageKey, String(route.query.storeId)) }catch(e){}
// persist menuId similarly so the selected menu survives navigation
const menuStorageKey = `public_menu_${companyId}`
const menuId = ref(route.query.menuId || localStorage.getItem(menuStorageKey) || null)
try{ if(route.query && route.query.menuId) localStorage.setItem(menuStorageKey, String(route.query.menuId)) }catch(e){}

const loading = ref(true)
bindLoading(loading)
const order = ref(null)
const displayId = ref(null)
const socket = ref(null)

function statusClass() {
  const s = order.value?.status
  if (!s) return 'bg-secondary text-white'
  if (s === 'EM_PREPARO') return 'bg-warning text-dark'
  if (s === 'SAIU_PARA_ENTREGA') return 'bg-primary text-white'
  if (s === 'CONCLUIDO') return 'bg-success text-white'
  if (s === 'CANCELADO') return 'bg-danger text-white'
  if (s === 'INVOICE_AUTHORIZED') return 'bg-info text-white'
  return 'bg-secondary text-white'
}

function statusLabel() {
  const s = order.value?.status
  if (!s) return '—'
  if (s === 'EM_PREPARO') return 'Em preparo'
  if (s === 'SAIU_PARA_ENTREGA') return 'Saiu para entrega'
  if (s === 'CONCLUIDO') return 'Concluído'
  if (s === 'CANCELADO') return 'Cancelado'
  if (s === 'INVOICE_AUTHORIZED') return 'NFC-e Autorizada'
  return s
}

function formatDate(d) {
  if (!d) return '-'
  const dt = new Date(d)
  return dt.toLocaleString()
}

const canViewHistory = computed(() => {
  // allow viewing history if we have a stored contact or phone query
  const stored = localStorage.getItem(`public_customer_${companyId}`)
  if (stored) return true
  return Boolean(phoneQuery)
})

async function fetchOrder() {
  loading.value = true
  try {
    const phone = phoneQuery || (JSON.parse(localStorage.getItem(`public_customer_${companyId}`) || 'null') || {}).contact || ''
    const res = await api.get(`/public/${companyId}/orders/${orderId}?phone=${encodeURIComponent(phone)}`)
    order.value = res.data
    displayId.value = res.data.displayId
  } catch (e) {
    console.error('Failed to fetch public order', e)
    order.value = null
  } finally { loading.value = false }
}

onMounted(async () => {
  await fetchOrder()
  // connect socket and listen for order-updated
  const API_URL = (import.meta.env.VITE_API_URL && import.meta.env.VITE_API_URL !== 'https://localhost:3000')
    ? import.meta.env.VITE_API_URL
    : `${location.protocol}//${location.hostname}:3000`;
  console.log('OrderStatus socket connecting to API_URL:', API_URL);
  // allow polling fallback first to increase resilience on networks that close long-lived websockets
  socket.value = io(API_URL, { transports: ['polling', 'websocket'], timeout: 30000, reconnectionAttempts: 50, reconnectionDelay: 1000, randomizationFactor: 0.2 })
  socket.value.on('connect', () => console.log('connected to socket'))
  socket.value.on('order-updated', (payload) => {
    if (!payload || !payload.id) return
    if (String(payload.id) === String(orderId)) {
      // refresh the order
      fetchOrder()
    }
  })
})

onUnmounted(() => {
  socket.value?.disconnect()
})

function goBack(){ router.push({ path: `/public/${companyId}/menu`, query: { storeId: storeId.value || undefined, menuId: menuId.value || undefined } }) }
function goHistory(){
  const phone = (JSON.parse(localStorage.getItem(`public_customer_${companyId}`) || 'null') || {}).contact || phoneQuery || ''
  if (!phone) { Swal.fire({ icon: 'warning', text: 'Identifique-se primeiro com seu WhatsApp' }); return }
  router.push({ path: `/public/${companyId}/history`, query: { phone, storeId: storeId.value || undefined, menuId: menuId.value || undefined } })
}

function shareOnWhatsApp(){
  if(!order.value) return
  const display = order.value.displayId || (order.value.displaySimple ? order.value.displaySimple : order.value.id)
  const total = Number(order.value.total || 0).toFixed(2)
  const phoneForQuery = phoneQuery || (JSON.parse(localStorage.getItem(`public_customer_${companyId}`) || 'null') || {}).contact || ''
  let orderUrl = `${window.location.origin}/public/${companyId}/order/${orderId}`
  const params = new URLSearchParams()
  if(phoneForQuery) params.set('phone', phoneForQuery)
  if(storeId.value) params.set('storeId', storeId.value)
  if(menuId.value) params.set('menuId', menuId.value)
  const qs = params.toString()
  if(qs) orderUrl += `?${qs}`
  const msg = `Pedido ${display} criado. Total: R$ ${total}. Acompanhe: ${orderUrl}`
  const wa = `https://wa.me/?text=${encodeURIComponent(msg)}`
  window.open(wa, '_blank')
}
</script>

<style scoped>
.badge { font-size: 1rem; }
</style>
