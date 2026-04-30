<template>
  <div class="os-page">
    <!-- Header -->
    <div class="os-header">
      <h5 class="m-0 fw-bold">Pedido confirmado</h5>
      <button class="os-close" @click="goBack" aria-label="Fechar"><i class="bi bi-x-lg"></i></button>
    </div>

    <div class="os-body">
      <div v-if="loading" class="text-center py-5">
        <div class="spinner-border" style="color:var(--os-brand)" role="status"><span class="visually-hidden">Carregando...</span></div>
      </div>

      <div v-else-if="needsPhone" class="os-card">
        <div class="text-center mb-3">
          <i class="bi bi-shield-lock" style="font-size:40px;color:var(--os-brand)"></i>
        </div>
        <p class="text-center small" style="color:var(--os-muted)">Informe seu WhatsApp para visualizar este pedido.</p>
        <div class="d-flex gap-2">
          <TextInput v-model="phoneInput" placeholder="(00) 9 0000-0000" maxlength="16" inputClass="form-control" />
          <button class="btn btn-sm" style="background:var(--os-brand);color:#fff;border-radius:10px;font-weight:600" @click="submitPhone">Ver pedido</button>
        </div>
      </div>

      <template v-if="!needsPhone && order">
        <!-- Success banner -->
        <div class="os-success-card">
          <div class="os-success-icon">
            <i class="bi bi-check-lg"></i>
          </div>
          <h5 class="fw-bold mt-3 mb-1">Pedido confirmado!</h5>
          <div class="small" style="color:var(--os-muted)">Pedido nº <strong>{{ order?.displaySimple || displayId || order?.displayId || order?.id?.slice(0,6) }}</strong></div>
          <div class="small mt-1" style="color:var(--os-muted)">Seu pedido está sendo processado.</div>
          <span class="os-status-badge mt-3" :class="statusClass()">
            <span class="os-status-dot"></span>
            {{ statusLabel() }}
          </span>
        </div>

        <!-- WhatsApp share -->
        <button class="btn os-whatsapp-btn w-100 mb-3" @click="shareOnWhatsApp">
          <i class="bi bi-whatsapp me-2"></i>Compartilhar no WhatsApp
        </button>

        <!-- Items -->
        <div class="os-card mb-3">
          <div class="os-section-title">ITENS</div>
          <div v-for="it in order?.items || []" :key="it.id" class="os-item">
            <div class="d-flex justify-content-between align-items-start">
              <div style="min-width:0;flex:1">
                <div class="os-item-name">{{ it.name }}</div>
                <div v-if="it.notes" class="os-item-sub">OBS: {{ it.notes }}</div>
                <div class="os-item-sub">Qtd: {{ it.quantity }} · Unitário: {{ formatCurrency(Number(it.price||0)) }}</div>
              </div>
              <div class="os-item-price">{{ formatCurrency(Number(it.price||0) * Number(it.quantity||1)) }}</div>
            </div>
          </div>

          <div class="os-totals">
            <div class="d-flex justify-content-between mb-1"><span>Subtotal</span><span>{{ formatCurrency(subtotal) }}</span></div>
            <div v-if="couponDiscount > 0" class="d-flex justify-content-between mb-1" style="color:#198754"><span>{{ order?.couponCode ? `Cupom (${order.couponCode})` : 'Cupom' }}</span><span>-{{ formatCurrency(couponDiscount) }}</span></div>
            <div class="d-flex justify-content-between mb-1"><span>Taxa de entrega</span><span>{{ deliveryFee > 0 ? formatCurrency(deliveryFee) : 'Grátis' }}</span></div>
            <div v-if="additionalFees > 0" class="d-flex justify-content-between mb-1"><span>Taxa de serviço</span><span>{{ formatCurrency(additionalFees) }}</span></div>
            <div v-if="appliedCashback > 0" class="d-flex justify-content-between mb-1" style="color:#198754"><span>Cashback usado</span><span>-{{ formatCurrency(appliedCashback) }}</span></div>
            <div class="d-flex justify-content-between os-total-line"><span class="fw-bold">Total</span><span class="fw-bold os-total-value">{{ formatCurrency(computedTotal) }}</span></div>
            <div v-if="cashbackEarned > 0" class="d-flex justify-content-between mt-2 small" style="color:#198754"><span><i class="bi bi-cash-stack me-1"></i>Cashback recebido</span><span>+{{ formatCurrency(cashbackEarned) }}</span></div>
          </div>
        </div>

        <!-- Delivery info -->
        <div class="os-card mb-3">
          <div class="os-section-title">INFORMAÇÕES PARA ENTREGA</div>
          <div class="os-info-row mb-3">
            <div class="os-info-icon"><i class="bi bi-person"></i></div>
            <div>
              <div class="fw-semibold">{{ order?.customerName || order?.payload?.rawPayload?.customer?.name || '—' }}</div>
              <div class="small" style="color:var(--os-muted)">{{ order?.customerPhone || order?.payload?.rawPayload?.customer?.contact || '—' }}</div>
            </div>
          </div>
          <div class="os-info-row">
            <div class="os-info-icon"><i class="bi bi-geo-alt"></i></div>
            <div>
              <div class="fw-semibold">{{ deliveryAddress }}</div>
              <div class="small" style="color:var(--os-muted)" v-if="deliveryNeighborhood">{{ deliveryNeighborhood }}</div>
            </div>
          </div>
        </div>

        <!-- Payment -->
        <div v-if="paymentMethodName" class="os-card mb-3">
          <div class="os-section-title">PAGAMENTO</div>
          <div class="os-info-row">
            <div class="os-info-icon"><i class="bi bi-credit-card"></i></div>
            <div class="fw-semibold">{{ paymentMethodName }}</div>
          </div>
        </div>

        <!-- History -->
        <div v-if="(order?.histories||[]).length" class="os-card mb-3">
          <div class="os-section-title">HISTÓRICO</div>
          <div v-for="h in (order?.histories || [])" :key="h.id" class="os-history-row">
            <span style="color:var(--os-muted)">{{ h.from || '—' }}</span>
            <i class="bi bi-arrow-right mx-1" style="font-size:10px;color:var(--os-muted)"></i>
            <span>{{ h.to }}</span>
            <span class="ms-auto small" style="color:var(--os-muted)">{{ formatDate(h.createdAt) }}</span>
          </div>
        </div>

        <!-- Actions -->
        <button class="btn os-back-btn w-100" @click="goBack">Voltar ao cardápio</button>
      </template>
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
import { removePhoneMask } from '../utils/phoneMask'
import { formatCurrency, formatAmount } from '../utils/formatters.js'

const route = useRoute()
const router = useRouter()
const companyId = route.params.companyId
const orderId = route.params.orderId
const phoneQuery = route.query.phone || ''
const storeStorageKey = `public_store_${companyId}`
const storeId = ref(route.query.storeId || localStorage.getItem(storeStorageKey) || null)
try{ if(route.query && route.query.storeId) localStorage.setItem(storeStorageKey, String(route.query.storeId)) }catch(e){}
const menuStorageKey = `public_menu_${companyId}`
const menuId = ref(route.query.menuId || localStorage.getItem(menuStorageKey) || null)
try{ if(route.query && route.query.menuId) localStorage.setItem(menuStorageKey, String(route.query.menuId)) }catch(e){}

const loading = ref(true)
bindLoading(loading)
const order = ref(null)
const needsPhone = ref(false)
const phoneInput = ref('')
const displayId = ref(null)
const socket = ref(null)

const subtotal = computed(()=> {
  const ip = order.value?.payload?.order || order.value?.payload || {}
  const ifoodSub = ip.total?.subTotal
  if (ifoodSub != null && Number(ifoodSub) > 0) return Number(ifoodSub)
  return (order.value?.items||[]).reduce((s,it)=> s + (Number(it.price||0)*Number(it.quantity||1)),0)
})
const deliveryFee = computed(()=> Number(order.value?.deliveryFee||0))
const additionalFees = computed(()=> {
  const ip = order.value?.payload?.order || order.value?.payload || {}
  return Number(ip.total?.additionalFees ?? 0) || 0
})
const couponDiscount = computed(()=> Number(order.value?.couponDiscount||0))
const appliedCashback = computed(() => Number(order.value?.payload?.appliedCashback || 0))
const cashbackEarned = computed(() => Number(order.value?.cashbackEarned || 0))

// Fix NaN: compute total from parts if order.total is missing/NaN
const computedTotal = computed(() => {
  const raw = Number(order.value?.total || 0)
  if (!isNaN(raw) && raw > 0) return raw
  // fallback: compute from subtotal + fees - discounts
  return Math.max(0, subtotal.value - couponDiscount.value - appliedCashback.value + deliveryFee.value + additionalFees.value)
})

const deliveryAddress = computed(() => {
  return order.value?.address || order.value?.payload?.delivery?.deliveryAddress?.formattedAddress || order.value?.payload?.rawPayload?.address?.formattedAddress || '—'
})
const deliveryNeighborhood = computed(() => {
  return order.value?.payload?.delivery?.deliveryAddress?.neighborhood || ''
})
const paymentMethodName = computed(() => {
  return (order.value?.payment && (order.value.payment.methodName || order.value.payment.method)) || (order.value?.payload?.rawPayload?.payment && order.value.payload.rawPayload.payment.method) || ''
})

function statusClass() {
  const s = order.value?.status
  if (!s) return ''
  if (s === 'EM_PREPARO') return 'warning'
  if (s === 'SAIU_PARA_ENTREGA') return 'primary'
  if (s === 'CONCLUIDO') return 'success'
  if (s === 'CANCELADO') return 'danger'
  return ''
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
function formatDate(d) { if (!d) return '-'; return formatDateTime(d) }

async function fetchOrder(providedPhone) {
  loading.value = true
  needsPhone.value = false
  try {
    const stored = (JSON.parse(localStorage.getItem(`public_customer_${companyId}`) || 'null') || {})
    const rawPhone = (providedPhone || phoneQuery || stored.contact || '').trim()
    if (!rawPhone) { needsPhone.value = true; order.value = null; return }
    const digits = removePhoneMask(rawPhone)
    if (digits.length < 10) { needsPhone.value = true; order.value = null; return }
    const res = await api.get(`/public/${companyId}/orders/${orderId}?phone=${encodeURIComponent(digits)}`)
    order.value = res.data
    displayId.value = res.data.displayId
  } catch (e) {
    console.error('Failed to fetch public order', e?.response?.status, e?.response?.data || e)
    if (e?.response?.status === 403) { needsPhone.value = true; Swal.fire({ icon: 'warning', text: 'Número não autorizado para este pedido.' }) }
    else if (e?.response?.status === 404) { Swal.fire({ icon: 'error', text: 'Pedido não encontrado.' }) }
    else if (e?.response?.status === 400) { needsPhone.value = true }
    else { Swal.fire({ icon: 'error', text: 'Falha ao carregar pedido.' }) }
    order.value = null
  } finally { loading.value = false }
}

onMounted(async () => {
  await fetchOrder()
  socket.value = io(SOCKET_URL, { transports: ['polling', 'websocket'], timeout: 30000, reconnectionAttempts: 50, reconnectionDelay: 1000, randomizationFactor: 0.2 })
  socket.value.on('connect', () => console.log('connected to socket'))
  socket.value.on('order-updated', (payload) => {
    if (!payload || !payload.id) return
    if (String(payload.id) === String(orderId)) fetchOrder()
  })
})
onUnmounted(() => { socket.value?.disconnect() })

function goBack(){ router.push({ path: `/public/${companyId}/menu`, query: { storeId: storeId.value || undefined, menuId: menuId.value || undefined } }) }
function goHistory(){
  const phone = (JSON.parse(localStorage.getItem(`public_customer_${companyId}`) || 'null') || {}).contact || phoneQuery || ''
  if (!phone) { Swal.fire({ icon: 'warning', text: 'Identifique-se primeiro com seu WhatsApp' }); return }
  router.push({ path: `/public/${companyId}/history`, query: { phone, storeId: storeId.value || undefined, menuId: menuId.value || undefined } })
}

function shareOnWhatsApp(){
  if(!order.value) return
  const displaySimple = order.value.displaySimple
  const display = displaySimple ? `#${displaySimple}` : (order.value.displayId || `#${order.value.id.slice(0,6).toUpperCase()}`)
  const total = formatAmount(computedTotal.value)
  const phoneForQuery = phoneQuery || (JSON.parse(localStorage.getItem(`public_customer_${companyId}`) || 'null') || {}).contact || ''
  let orderUrl = `${window.location.origin}/public/${companyId}/order/${orderId}`
  const params = new URLSearchParams()
  if(phoneForQuery) params.set('phone', phoneForQuery)
  if(storeId.value) params.set('storeId', storeId.value)
  if(menuId.value) params.set('menuId', menuId.value)
  const qs = params.toString()
  if(qs) orderUrl += `?${qs}`
  const msg = `🛍️ Pedido ${display} realizado!\n💰 Total: R$ ${total}\n\n📍 Acompanhe seu pedido:\n${orderUrl}`
  window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank')
}

function submitPhone() {
  if (!phoneInput.value) return
  try { const stored = JSON.parse(localStorage.getItem(`public_customer_${companyId}`) || 'null') || {}; stored.contact = phoneInput.value; localStorage.setItem(`public_customer_${companyId}`, JSON.stringify(stored)) } catch {}
  fetchOrder(phoneInput.value)
}
</script>

<style scoped>
.os-page {
  --os-bg: #FFF8F0;
  --os-surface: #FFFFFF;
  --os-surface-alt: #FBF3E8;
  --os-border: #F0E6D2;
  --os-text: #1A1410;
  --os-muted: #7A6E62;
  --os-brand: #2E7D32;
  --os-brand-light: #E8F5E9;
  font-family: 'Inter', -apple-system, system-ui, sans-serif;
  background: var(--os-bg);
  min-height: 100vh;
  color: var(--os-text);
}
.os-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  background: var(--os-surface);
  border-bottom: 1px solid var(--os-border);
  position: sticky;
  top: 0;
  z-index: 10;
}
.os-close {
  all: unset;
  cursor: pointer;
  width: 34px; height: 34px;
  border-radius: 50%;
  background: var(--os-surface-alt);
  display: flex; align-items: center; justify-content: center;
  font-size: 14px; color: var(--os-text);
}
.os-close:hover { background: var(--os-border); }
.os-body { max-width: 520px; margin: 0 auto; padding: 20px 16px 40px; }

/* Success banner */
.os-success-card {
  background: var(--os-brand-light);
  border: 1px solid #C8E6C9;
  border-radius: 16px;
  padding: 28px 20px;
  text-align: center;
  margin-bottom: 16px;
}
.os-success-icon {
  width: 56px; height: 56px;
  border-radius: 50%;
  background: var(--os-brand);
  color: #fff;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 28px;
}
.os-status-badge {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 16px; border-radius: 999px;
  font-size: 13px; font-weight: 600;
  background: var(--os-surface); border: 1px solid var(--os-border); color: var(--os-text);
}
.os-status-badge.warning { background: #FFF3CD; border-color: #FFE082; color: #856404; }
.os-status-badge.primary { background: #E3F2FD; border-color: #90CAF9; color: #1565C0; }
.os-status-badge.success { background: #E8F5E9; border-color: #A5D6A7; color: #2E7D32; }
.os-status-badge.danger { background: #FFEBEE; border-color: #EF9A9A; color: #C62828; }
.os-status-dot {
  width: 8px; height: 8px; border-radius: 50%; background: currentColor;
}

/* WhatsApp button */
.os-whatsapp-btn {
  background: var(--os-brand);
  color: #fff;
  border: none;
  border-radius: 12px;
  font-weight: 700;
  font-size: 15px;
  padding: 14px;
}
.os-whatsapp-btn:hover { background: #256029; color: #fff; }

/* Cards */
.os-card {
  background: var(--os-surface);
  border: 1px solid var(--os-border);
  border-radius: 16px;
  padding: 20px;
}
.os-section-title {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.8px;
  color: var(--os-muted);
  margin-bottom: 14px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--os-border);
}

/* Items */
.os-item {
  padding: 10px 0;
  border-bottom: 1px solid var(--os-border);
}
.os-item:last-of-type { border-bottom: none; }
.os-item-name { font-size: 14px; font-weight: 600; color: var(--os-text); }
.os-item-sub { font-size: 12px; color: var(--os-muted); margin-top: 2px; }
.os-item-price { font-size: 14px; font-weight: 700; color: var(--os-text); white-space: nowrap; margin-left: 12px; }

/* Totals */
.os-totals {
  border-top: 1px dashed var(--os-border);
  margin-top: 12px;
  padding-top: 12px;
  font-size: 14px;
  color: var(--os-muted);
}
.os-total-line {
  border-top: 1px solid var(--os-border);
  padding-top: 10px;
  margin-top: 8px;
}
.os-total-value { color: var(--os-brand); font-size: 18px; }

/* Info rows */
.os-info-row {
  display: flex; align-items: flex-start; gap: 12px;
}
.os-info-icon {
  width: 36px; height: 36px;
  border-radius: 10px;
  background: var(--os-surface-alt);
  display: flex; align-items: center; justify-content: center;
  color: var(--os-muted); font-size: 16px;
  flex-shrink: 0;
}

/* History */
.os-history-row {
  display: flex; align-items: center; gap: 4px;
  padding: 8px 0;
  font-size: 13px;
  border-bottom: 1px solid var(--os-border);
}
.os-history-row:last-child { border-bottom: none; }

/* Back button */
.os-back-btn {
  background: var(--os-brand);
  color: #fff;
  border: none;
  border-radius: 12px;
  font-weight: 700;
  font-size: 15px;
  padding: 14px;
}
.os-back-btn:hover { background: #256029; color: #fff; }

@media (max-width: 576px) {
  .os-body { padding: 16px 12px 100px; }
  .os-card { padding: 16px; }
  .os-success-card { padding: 24px 16px; }
}
</style>
