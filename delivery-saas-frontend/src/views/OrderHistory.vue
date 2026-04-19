<template>
  <div class="oh-page">
    <div class="oh-header">
      <h5 class="m-0 fw-bold">Meus pedidos</h5>
      <button class="oh-close" @click="goMenu" aria-label="Voltar"><i class="bi bi-x-lg"></i></button>
    </div>

    <div class="oh-body">
      <!-- Phone prompt -->
      <div v-if="needsPhone" class="oh-card mb-3">
        <div class="text-center mb-3">
          <div class="oh-icon-circle"><i class="bi bi-shield-lock"></i></div>
        </div>
        <p class="text-center small" style="color:var(--oh-muted)">Informe seu WhatsApp para ver seus pedidos.</p>
        <div class="d-flex gap-2">
          <TextInput v-model="phone" placeholder="(00) 9 0000-0000" maxlength="16" inputClass="form-control oh-input" />
          <button class="btn oh-btn-primary" @click="submitPhone">Ver</button>
        </div>
        <button v-if="hasStoredPhone" class="btn oh-btn-outline w-100 mt-2" @click="useSaved">Usar contato salvo</button>
      </div>

      <!-- Orders list -->
      <template v-else>
        <div class="d-flex justify-content-between align-items-center mb-3">
          <div class="small" style="color:var(--oh-muted)">{{ orders.length }} {{ orders.length === 1 ? 'pedido' : 'pedidos' }}</div>
          <div class="d-flex gap-2">
            <button class="btn oh-btn-outline btn-sm" @click="refresh"><i class="bi bi-arrow-clockwise me-1"></i>Atualizar</button>
          </div>
        </div>

        <div v-if="loading" class="text-center py-4">
          <div class="spinner-border" style="color:var(--oh-brand)" role="status"><span class="visually-hidden">Carregando...</span></div>
        </div>

        <div v-else-if="orders.length === 0" class="oh-empty">
          <i class="bi bi-bag-x"></i>
          <div class="fw-semibold mt-2">Nenhum pedido encontrado</div>
          <div class="small" style="color:var(--oh-muted)">Seus pedidos aparecerão aqui</div>
        </div>

        <div v-for="o in orders" :key="o.id" class="oh-order-card" @click="openOrder(o)">
          <div class="d-flex justify-content-between align-items-start mb-2">
            <div>
              <div class="oh-order-num">Pedido #{{ o.displaySimple || o.displayId || o.id.slice(0,6) }}</div>
              <div class="oh-order-date">{{ formatDate(o.createdAt) }}</div>
            </div>
            <span :class="['oh-status', statusKey(o.status)]">{{ statusLabel(o.status) }}</span>
          </div>

          <div class="oh-order-details">
            <div v-if="o.customerName" class="oh-detail-row">
              <i class="bi bi-person"></i><span>{{ o.customerName }}</span>
            </div>
            <div v-if="getOrderAddress(o)" class="oh-detail-row">
              <i class="bi bi-geo-alt"></i><span>{{ getOrderAddress(o) }}</span>
            </div>
            <div v-if="getPaymentMethod(o)" class="oh-detail-row">
              <i class="bi bi-credit-card"></i><span>{{ getPaymentMethod(o) }}</span>
            </div>
          </div>

          <div v-if="Number(o.couponDiscount || 0) > 0 || Number(o.discountIfood || 0) > 0" class="oh-discount">
            <i class="bi bi-ticket-perforated me-1"></i>
            <span v-if="Number(o.discountIfood || 0) > 0">Voucher: {{ formatCurrency(Number(o.discountIfood)) }}</span>
            <span v-else>{{ o.couponCode ? `Cupom ${o.couponCode}` : 'Cupom' }}: -{{ formatCurrency(Number(o.couponDiscount || 0)) }}</span>
          </div>

          <div class="d-flex justify-content-between align-items-center mt-2 pt-2" style="border-top:1px solid var(--oh-border)">
            <div class="small" style="color:var(--oh-muted)">{{ itemCount(o) }} {{ itemCount(o) === 1 ? 'item' : 'itens' }}</div>
            <div class="oh-order-total">{{ formatCurrency(Number(o.total||0)) }}</div>
          </div>
        </div>
      </template>
    </div>

    <!-- Mobile bottom nav -->
    <nav class="oh-bottom-nav d-lg-none">
      <button :class="{ active: navActive('/profile') }" class="oh-nav-item" @click.prevent="goProfile">
        <i class="bi bi-person oh-nav-icon"></i><div class="oh-nav-label">Perfil</div>
      </button>
      <button :class="{ active: navActive('/history') }" class="oh-nav-item" @click.prevent="goOrders">
        <i class="bi bi-journal-text oh-nav-icon"></i><div class="oh-nav-label">Histórico</div>
      </button>
      <button :class="{ active: navActive('/menu') }" class="oh-nav-item" @click.prevent="goMenu">
        <i class="bi bi-grid oh-nav-icon"></i><div class="oh-nav-label">Cardápio</div>
      </button>
    </nav>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import Swal from 'sweetalert2'
import { bindLoading } from '../state/globalLoading.js'
import { useRoute, useRouter } from 'vue-router'
import api from '../api'
import { applyPhoneMask, removePhoneMask } from '../utils/phoneMask.js'
import { formatCurrency } from '../utils/formatters.js'
import { formatDateTime } from '../utils/dates.js'

const route = useRoute()
const router = useRouter()
const companyId = route.params.companyId

const storeStorageKey = `public_store_${companyId}`
const storeId = ref(route.query.storeId || localStorage.getItem(storeStorageKey) || null)
try{ if(route.query && route.query.storeId) localStorage.setItem(storeStorageKey, String(route.query.storeId)) }catch(e){}
const menuStorageKey = `public_menu_${companyId}`
const menuId = ref(route.query.menuId || localStorage.getItem(menuStorageKey) || null)
try{ if(route.query && route.query.menuId) localStorage.setItem(menuStorageKey, String(route.query.menuId)) }catch(e){}

const phoneQuery = route.query.phone || ''
const phone = ref(phoneQuery || '')
const needsPhone = ref(false)
const loading = ref(false)
bindLoading(loading)
const orders = ref([])

function statusKey(s){
  if (!s) return ''
  if (s === 'EM_PREPARO') return 'warning'
  if (s === 'SAIU_PARA_ENTREGA') return 'info'
  if (s === 'CONCLUIDO') return 'success'
  if (s === 'CANCELADO') return 'danger'
  return ''
}
function statusLabel(s){
  if (!s) return '—'
  if (s === 'EM_PREPARO') return 'Em preparo'
  if (s === 'SAIU_PARA_ENTREGA') return 'Saiu para entrega'
  if (s === 'CONCLUIDO') return 'Concluído'
  if (s === 'CANCELADO') return 'Cancelado'
  if (s === 'INVOICE_AUTHORIZED') return 'NFC-e Autorizada'
  return s
}
function formatDate(d){ if(!d) return '-'; return formatDateTime(d) }
function itemCount(o){ return (o.items||[]).reduce((s,i)=> s+Number(i.quantity||1),0) }

const hasStoredPhone = computed(()=> {
  try { return !!(JSON.parse(localStorage.getItem(`public_customer_${companyId}`)||'null')||{}).contact } catch { return false }
})

async function loadHistory(useCookie=false){
  loading.value = true
  try {
    let url = `/public/${companyId}/orders`
    const digits = removePhoneMask(phone.value || '')
    if (!useCookie && digits) url += `?phone=${encodeURIComponent(digits)}`
    const res = await api.get(url)
    orders.value = Array.isArray(res.data) ? res.data : []
    if (digits) localStorage.setItem(`public_customer_${companyId}`, JSON.stringify({ name: '', contact: phone.value }))
    needsPhone.value = false
  } catch (e) {
    console.warn('Failed to load history', e?.response?.status, e?.response?.data || e)
    if (e?.response?.status === 400) { needsPhone.value = true }
    orders.value = []
  } finally { loading.value = false }
}

async function useSaved(){
  const saved = JSON.parse(localStorage.getItem(`public_customer_${companyId}`) || 'null')
  if(saved && saved.contact){ phone.value = saved.contact; await loadHistory(false) }
  else await Swal.fire({ icon: 'info', text: 'Nenhum contato salvo encontrado.' })
}

function submitPhone(){ if(!phone.value) return; loadHistory(false) }
function refresh(){ loadHistory(true) }
function openOrder(o){ router.push({ path: `/public/${companyId}/order/${o.id}`, query: { storeId: storeId.value || undefined, menuId: menuId.value || undefined } }) }

onMounted(()=> { loadHistory(true) })
if (phoneQuery) loadHistory(false)

function _publicNavigate(pathSuffix, extraQuery = {}){
  try{
    const base = `/public/${route.params.companyId || companyId}`
    const mergedQuery = Object.assign({}, route.query || {}, extraQuery || {})
    if (storeId.value && !mergedQuery.storeId) mergedQuery.storeId = storeId.value
    if (menuId.value && !mergedQuery.menuId) mergedQuery.menuId = menuId.value
    Object.keys(mergedQuery).forEach(k => { if (mergedQuery[k] === undefined) delete mergedQuery[k] })
    router.push({ path: `${base}${pathSuffix || ''}`, query: mergedQuery })
  }catch(e){ console.warn('_publicNavigate', e) }
}
function goProfile(){ _publicNavigate('/profile') }
function goOrders(){ _publicNavigate('/history') }
function goMenu(){ _publicNavigate('/menu') }
function navActive(suffix){ try{ return (route.path || '').endsWith(suffix) }catch(e){ return false } }

function getOrderAddress(o){
  if (!o) return ''
  if (o.address) return o.address
  try {
    const addr = o.payload?.rawPayload?.address
    if (addr) {
      if (addr.formattedAddress || addr.formatted) return addr.formattedAddress || addr.formatted
      const parts = []
      if (addr.streetName || addr.street) parts.push(addr.streetName || addr.street)
      if (addr.streetNumber || addr.number) parts.push(addr.streetNumber || addr.number)
      if (addr.neighborhood || addr.neigh) parts.push(addr.neighborhood || addr.neigh)
      return parts.filter(Boolean).join(', ')
    }
  } catch (e) { /* ignore */ }
  return ''
}

function getPaymentMethod(o){
  if (!o) return ''
  try {
    const payment = o.payload?.rawPayload?.payment || o.payload?.payment
    if (!payment) return ''
    const method = payment.method || payment.methodCode || ''
    const labels = { 'PIX': 'PIX', 'CREDIT_CARD': 'Cartão de Crédito', 'DEBIT_CARD': 'Cartão de Débito', 'CASH': 'Dinheiro', 'MONEY': 'Dinheiro', 'VOUCHER': 'Vale', 'ONLINE': 'Online' }
    return labels[method] || method || ''
  } catch (e) { /* ignore */ }
  return ''
}
</script>

<style scoped>
.oh-page {
  --oh-bg: #FFF8F0;
  --oh-surface: #FFFFFF;
  --oh-surface-alt: #FBF3E8;
  --oh-border: #F0E6D2;
  --oh-text: #1A1410;
  --oh-muted: #7A6E62;
  --oh-brand: #2E7D32;
  --oh-brand-light: #E8F5E9;
  font-family: 'Inter', -apple-system, system-ui, sans-serif;
  background: var(--oh-bg);
  min-height: 100vh;
  color: var(--oh-text);
  padding-bottom: 80px;
}
.oh-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 20px; background: var(--oh-surface);
  border-bottom: 1px solid var(--oh-border);
  position: sticky; top: 0; z-index: 10;
}
.oh-close {
  all: unset; cursor: pointer; width: 34px; height: 34px; border-radius: 50%;
  background: var(--oh-surface-alt); display: flex; align-items: center; justify-content: center;
  font-size: 14px; color: var(--oh-text);
}
.oh-close:hover { background: var(--oh-border); }
.oh-body { max-width: 580px; margin: 0 auto; padding: 20px 16px; }

/* Cards */
.oh-card {
  background: var(--oh-surface); border: 1px solid var(--oh-border);
  border-radius: 16px; padding: 20px;
}
.oh-icon-circle {
  width: 48px; height: 48px; border-radius: 50%;
  background: var(--oh-brand-light); color: var(--oh-brand);
  display: inline-flex; align-items: center; justify-content: center; font-size: 22px;
}
.oh-input {
  border: 1px solid var(--oh-border) !important; border-radius: 12px !important;
  background: var(--oh-surface) !important; color: var(--oh-text) !important;
}
.oh-input:focus { border-color: var(--oh-brand) !important; box-shadow: 0 0 0 3px rgba(46,125,50,0.1) !important; }

/* Buttons */
.oh-btn-primary {
  background: var(--oh-brand); color: #fff; border: none; border-radius: 10px;
  font-weight: 600; font-size: 14px; padding: 10px 20px; white-space: nowrap;
}
.oh-btn-primary:hover { background: #256029; color: #fff; }
.oh-btn-outline {
  background: transparent; color: var(--oh-text); border: 1px solid var(--oh-border);
  border-radius: 10px; font-weight: 600; font-size: 13px; padding: 6px 14px;
}
.oh-btn-outline:hover { background: var(--oh-surface-alt); color: var(--oh-text); }

/* Empty state */
.oh-empty {
  text-align: center; padding: 40px 16px; color: var(--oh-muted);
}
.oh-empty i { font-size: 40px; }

/* Order card */
.oh-order-card {
  background: var(--oh-surface); border: 1px solid var(--oh-border);
  border-radius: 14px; padding: 16px; margin-bottom: 12px;
  cursor: pointer; transition: box-shadow 0.15s, border-color 0.15s;
}
.oh-order-card:hover { box-shadow: 0 4px 14px rgba(0,0,0,0.06); border-color: #E0D6C4; }
.oh-order-num { font-size: 15px; font-weight: 700; color: var(--oh-text); }
.oh-order-date { font-size: 12px; color: var(--oh-muted); margin-top: 2px; }
.oh-order-total { font-size: 16px; font-weight: 700; color: var(--oh-brand); }

/* Status badge */
.oh-status {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 4px 12px; border-radius: 999px;
  font-size: 11px; font-weight: 600;
  background: var(--oh-surface-alt); color: var(--oh-muted); border: 1px solid var(--oh-border);
}
.oh-status.warning { background: #FFF3CD; border-color: #FFE082; color: #856404; }
.oh-status.info { background: #E3F2FD; border-color: #90CAF9; color: #1565C0; }
.oh-status.success { background: #E8F5E9; border-color: #A5D6A7; color: #2E7D32; }
.oh-status.danger { background: #FFEBEE; border-color: #EF9A9A; color: #C62828; }

/* Order details */
.oh-order-details { margin-top: 8px; }
.oh-detail-row {
  display: flex; align-items: center; gap: 8px;
  font-size: 13px; color: var(--oh-muted); margin-bottom: 4px;
}
.oh-detail-row i { font-size: 13px; color: var(--oh-muted); flex-shrink: 0; }
.oh-discount { font-size: 12px; color: #198754; margin-top: 6px; }

/* Bottom nav */
.oh-bottom-nav {
  display: flex; position: fixed; left: 0; right: 0; bottom: 0; height: 64px;
  background: var(--oh-surface); border-top: 1px solid var(--oh-border);
  z-index: 10800; align-items: center; justify-content: space-around;
}
.oh-nav-item {
  all: unset; cursor: pointer; display: flex; flex-direction: column;
  align-items: center; gap: 4px; padding: 6px 12px; color: var(--oh-muted);
}
.oh-nav-icon { font-size: 20px; line-height: 1; }
.oh-nav-label { font-size: 11px; }
.oh-nav-item.active, .oh-nav-item.active .oh-nav-label, .oh-nav-item.active .oh-nav-icon {
  color: var(--oh-brand) !important; font-weight: 700;
}

@media (max-width: 576px) {
  .oh-body { padding: 16px 12px; }
  .oh-order-card { padding: 14px; }
}
</style>
