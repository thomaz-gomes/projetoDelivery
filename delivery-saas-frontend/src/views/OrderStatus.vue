<template>
  <div class="container py-4">
    <div class="card">
      <div class="card-body">
        <h5 class="mb-3 fw-semibold">Pedido nº <span>{{ displayId || order?.displayId || order?.id?.slice(0,6) }}</span></h5>
        <div v-if="loading" class="text-center py-3">Carregando...</div>
        <div v-else>
          <div v-if="needsPhone" class="alert alert-warning">
            Informe seu WhatsApp para visualizar este pedido.
            <div class="input-group mt-2">
              <TextInput v-model="phoneInput" placeholder="(00) 0 0000-0000" maxlength="16" inputClass="form-control" />
              <button class="btn btn-primary" @click="submitPhone">Ver pedido</button>
            </div>
          </div>
          <template v-if="!needsPhone && order">
            <div class="status-box mb-4">
              <div class="d-flex align-items-center justify-content-between">
                <div class="d-flex align-items-center gap-2">
                  <span class="status-dot"></span>
                  <div class="fw-semibold small">Status do pedido</div>
                </div>
                <span class="badge rounded-pill px-3 py-2" :class="statusClass()">{{ statusLabel() }}</span>
              </div>
              <div class="mt-2 small text-muted">Seu pedido está sendo processado. Você pode compartilhar pelo WhatsApp.</div>
              <button class="btn btn-success btn-sm mt-3" @click="shareOnWhatsApp" :disabled="!order">Compartilhar no WhatsApp</button>
              <button v-if="hasStoredPhone" class="btn btn-outline-danger btn-sm mt-2" @click="logoutPublic">Sair</button>
            </div>

            <div class="items-section mb-4">
              <h6 class="fw-semibold mb-3">Itens</h6>
              <div v-for="it in order?.items || []" :key="it.id" class="item-card">
                <div class="d-flex justify-content-between">
                  <div>
                    <div class="item-name fw-semibold">{{ it.name }}</div>
                    <div v-if="it.notes" class="item-notes text-muted small">OBS: {{ it.notes }}</div>
                  </div>
                  <div class="item-price fw-semibold">{{ formatCurrency(Number(it.price||0)*Number(it.quantity||1)) }}</div>
                </div>
                <div class="item-meta small text-muted mt-1">Qtd: {{ it.quantity }} · Unitário: {{ formatCurrency(Number(it.price||0)) }}</div>
              </div>
              <div class="totals-box mt-3">
                <div class="d-flex justify-content-between mb-1"><span class="text-muted">Subtotal</span><span>{{ formatCurrency(subtotal) }}</span></div>
                <div class="d-flex justify-content-between mb-1"><span class="text-muted">Taxa de entrega</span><span>{{ formatCurrency(deliveryFee) }}</span></div>
                <div class="d-flex justify-content-between total-line pt-2 mt-1"><span class="fw-semibold">Total</span><span class="fw-semibold">{{ formatCurrency(Number(order?.total||0)) }}</span></div>
              </div>
            </div>

            <div class="delivery-info mb-4">
              <h6 class="fw-semibold mb-3">Informações para entrega</h6>
              <div class="info-row mb-3">
                <i class="bi bi-person icon" aria-hidden="true"></i>
                <div>
                  <div class="fw-semibold">{{ order?.customerName || order?.payload?.rawPayload?.customer?.name || '—' }}</div>
                  <div class="text-muted small">{{ order?.customerPhone || order?.payload?.rawPayload?.customer?.contact || '—' }}</div>
                </div>
              </div>
              <div class="info-row mb-2">
                <i class="bi bi-geo-alt icon" aria-hidden="true"></i>
                <div>
                  <div class="fw-semibold">{{ order?.address || order?.payload?.delivery?.deliveryAddress?.formattedAddress || order?.payload?.rawPayload?.address?.formattedAddress || '—' }}</div>
                  <div class="text-muted small" v-if="order?.payload?.delivery?.deliveryAddress?.neighborhood">{{ order.payload.delivery.deliveryAddress.neighborhood }}</div>
                  <div class="text-muted small" v-if="(order?.payload?.delivery?.deliveryAddress?.streetNumber) || (order?.payload?.rawPayload?.address?.streetNumber)">
                    Nº: {{ order?.payload?.delivery?.deliveryAddress?.streetNumber || order?.payload?.rawPayload?.address?.streetNumber }}
                  </div>
                  <div class="text-muted small" v-if="order?.payload?.delivery?.deliveryAddress?.complement || order?.payload?.rawPayload?.address?.complement">
                    Comp.: {{ order?.payload?.delivery?.deliveryAddress?.complement || order?.payload?.rawPayload?.address?.complement }}
                  </div>
                  <div class="text-muted small" v-if="order?.payload?.delivery?.deliveryAddress?.reference || order?.payload?.rawPayload?.address?.reference">
                    Ref.: {{ order?.payload?.delivery?.deliveryAddress?.reference || order?.payload?.rawPayload?.address?.reference }}
                  </div>
                  <div class="text-muted small" v-if="order?.payload?.delivery?.deliveryAddress?.observation || order?.payload?.rawPayload?.address?.observation">
                    Obs.: {{ order?.payload?.delivery?.deliveryAddress?.observation || order?.payload?.rawPayload?.address?.observation }}
                  </div>
                </div>
              </div>
            </div>

            <div v-if="order?.payment || order?.payload?.rawPayload?.payment" class="payment-section mb-4">
              <h6 class="fw-semibold mb-3">Pagamento</h6>
              <div class="payment-card">
                <i class="bi bi-credit-card me-2"></i>
                <span>{{ (order?.payment && (order.payment.methodName||order.payment.method)) || (order?.payload?.rawPayload?.payment && order.payload.rawPayload.payment.method) || '—' }}</span>
              </div>
            </div>

            <div class="history-section mb-4" v-if="(order?.histories||[]).length">
              <h6 class="fw-semibold mb-3">Histórico</h6>
              <ul class="history-list">
                <li v-for="h in (order?.histories || [])" :key="h.id">
                  <span class="text-muted">{{ h.from || '—' }}</span>
                  <span class="mx-1">→</span>
                  <span>{{ h.to }}</span>
                  <span class="text-muted ms-2 small">{{ formatDate(h.createdAt) }}</span>
                </li>
              </ul>
            </div>

            <div class="d-flex gap-2 mb-2">
              <button class="btn btn-outline-secondary" @click="goBack">Voltar</button>
              <button class="btn btn-primary" v-if="canViewHistory" @click="goHistory">Ver meu histórico</button>
            </div>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { formatDateTime } from '../utils/dates.js'
import Swal from 'sweetalert2'
import { bindLoading } from '../state/globalLoading.js'
import { useRoute, useRouter } from 'vue-router'
import api from '../api'
import { io } from 'socket.io-client'
import { SOCKET_URL } from '@/config'
// phone mask helpers (remove formatting before sending to backend)
import { removePhoneMask } from '../utils/phoneMask'
import { formatCurrency, formatAmount } from '../utils/formatters.js'

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
// whether we need the user to supply a phone to authorize viewing this order
const needsPhone = ref(false)
const phoneInput = ref('')
const displayId = ref(null)
const socket = ref(null)
const hasStoredPhone = computed(()=> {
  try { return !!(JSON.parse(localStorage.getItem(`public_customer_${companyId}`)||'null')||{}).contact } catch { return false }
})
const subtotal = computed(()=> (order.value?.items||[]).reduce((s,it)=> s + (Number(it.price||0)*Number(it.quantity||1)),0))
const deliveryFee = computed(()=> Number(order.value?.deliveryFee||0))

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
  return formatDateTime(d)
}

const canViewHistory = computed(() => {
  // allow viewing history if we have a stored contact or phone query
  const stored = localStorage.getItem(`public_customer_${companyId}`)
  if (stored) return true
  return Boolean(phoneQuery)
})

async function fetchOrder(providedPhone) {
  loading.value = true
  needsPhone.value = false
  try {
    // resolve phone from explicit providedPhone, query param or stored customer
    const stored = (JSON.parse(localStorage.getItem(`public_customer_${companyId}`) || 'null') || {})
    const rawPhone = (providedPhone || phoneQuery || stored.contact || '').trim()
    if (!rawPhone) {
      // no phone available — prompt user
      needsPhone.value = true
      order.value = null
      return
    }
    const digits = removePhoneMask(rawPhone)
    if (digits.length < 10) {
      needsPhone.value = true
      order.value = null
      return
    }
    const res = await api.get(`/public/${companyId}/orders/${orderId}?phone=${encodeURIComponent(digits)}`)
    order.value = res.data
    displayId.value = res.data.displayId
  } catch (e) {
    console.error('Failed to fetch public order', e?.response?.status, e?.response?.data || e)
    // differentiate common errors
    if (e?.response?.status === 403) {
      needsPhone.value = true
      Swal.fire({ icon: 'warning', text: 'Número não autorizado para este pedido. Confirme seu WhatsApp.' })
    } else if (e?.response?.status === 404) {
      Swal.fire({ icon: 'error', text: 'Pedido não encontrado.' })
    } else if (e?.response?.status === 400) {
      needsPhone.value = true
    } else {
      Swal.fire({ icon: 'error', text: 'Falha ao carregar pedido.' })
    }
    order.value = null
  } finally { loading.value = false }
}

onMounted(async () => {
  await fetchOrder()
  // connect socket and listen for order-updated
  console.log('OrderStatus socket connecting to SOCKET_URL:', SOCKET_URL);
  // allow polling fallback first to increase resilience on networks that close long-lived websockets
  socket.value = io(SOCKET_URL, { transports: ['polling', 'websocket'], timeout: 30000, reconnectionAttempts: 50, reconnectionDelay: 1000, randomizationFactor: 0.2 })
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
  const total = formatAmount(Number(order.value.total || 0))
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

function submitPhone() {
  if (!phoneInput.value) return
  // persist locally for subsequent auto-loads
  try {
    const stored = JSON.parse(localStorage.getItem(`public_customer_${companyId}`) || 'null') || {}
    stored.contact = phoneInput.value
    localStorage.setItem(`public_customer_${companyId}`, JSON.stringify(stored))
  } catch {}
  fetchOrder(phoneInput.value)
}

async function logoutPublic(){
  try {
    await api.post(`/public/${companyId}/logout`)
  } catch(e){ /* ignore */ }
  try { localStorage.removeItem(`public_customer_${companyId}`) } catch{}
  // force UI to ask phone again
  needsPhone.value = true
  order.value = null
  phoneInput.value = ''
  // redirect to public menu main page
  try { goBack() } catch(e) { /* ignore navigation errors */ }
}
</script>

<style scoped>
.badge { font-size: 1rem; }
.status-box { background:#f9fafb; border:1px solid #eceff3; border-radius:12px; padding:16px; }
.status-dot { width:10px; height:10px; border-radius:50%; background:#28a745; display:inline-block; }
.items-section .item-card { background:#ffffff; border:1px solid #eceff3; border-radius:12px; padding:12px 14px; margin-bottom:12px; }
.item-name { font-size:14px; }
.item-price { font-size:14px; }
.item-meta { font-size:12px; }
.totals-box { border-top:1px dashed #d9d9d9; margin-top:8px; font-size:14px; }
.totals-box .total-line { border-top:1px solid #d9d9d9; }
.delivery-info .info-row { display:flex; align-items:flex-start; gap:12px; }
.delivery-info .icon { font-size:20px; color:#6c757d; }
.payment-card { display:flex; align-items:center; gap:8px; background:#f9fafb; border:1px solid #eceff3; border-radius:12px; padding:12px 14px; font-size:14px; }
.history-list { list-style:none; padding-left:0; margin:0; }
.history-list li { padding:6px 0; font-size:13px; border-bottom:1px solid #f1f1f1; }
.history-list li:last-child { border-bottom:none; }
@media (max-width: 576px){
  .item-card, .payment-card, .status-box { padding:14px 16px; }
  .badge { font-size:.85rem; }
}
</style>
