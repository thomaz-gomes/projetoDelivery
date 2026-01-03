<template>
  <div class="public-container py-4">
    <ListCard title="Meus pedidos" icon="bi bi-journal-text" :subtitle="orders.length ? `${orders.length} pedidos` : ''" variant="card-style">
        <div v-if="needsPhone" class="phone-box mb-4">
        <label class="form-label small fw-semibold">Informe seu WhatsApp</label>
        <TextInput v-model="phone" placeholder="(00) 0 0000-0000" maxlength="16" inputClass="form-control" />
        <button class="btn btn-primary btn-sm mt-2" @click="submitPhone">Ver histórico</button>
        <button v-if="hasStoredPhone" class="btn btn-outline-secondary btn-sm mt-2 ms-2" @click="useSaved">Usar salvo</button>
      </div>
      <div v-else class="d-flex justify-content-between align-items-center mb-3">
        <div class="small text-muted">Total de pedidos: {{ orders.length }}</div>
        <div class="d-flex gap-2">
          <button class="btn btn-outline-secondary btn-sm" @click="refresh">Atualizar</button>
          <button class="btn btn-outline-danger btn-sm" @click="logoutPublic">Sair</button>
        </div>
      </div>

      <div v-if="loading" class="text-center py-3">Carregando...</div>
      <div v-else>
        <div v-if="!needsPhone && orders.length === 0" class="empty text-muted">Nenhum pedido encontrado</div>
        <div v-for="o in orders" :key="o.id" class="order-card" @click="openOrder(o)">
          <div class="d-flex justify-content-between align-items-start">
            <div>
              <div class="fw-semibold">Pedido nº {{ o.displayId || o.id.slice(0,6) }}</div>
              <div class="small text-muted mt-1">{{ formatDate(o.createdAt) }}</div>
            </div>
            <span class="badge rounded-pill px-3 py-2" :class="statusClass(o.status)">{{ statusLabel(o.status) }}</span>
          </div>
            <div class="mt-2 d-flex justify-content-between align-items-center">
            <div class="small text-muted">Itens: {{ (o.items||[]).reduce((s,i)=> s+Number(i.quantity||1),0) }}</div>
            <div class="fw-semibold">{{ formatCurrency(Number(o.total||0)) }}</div>
          </div>
        </div>
      </div>
  </ListCard>
  </div>

  <!-- Mobile bottom navigation (visible on small screens) -->
  <nav class="mobile-bottom-nav d-lg-none">
    <button :class="{active: navActive('/profile')}" class="nav-item" @click.prevent="goProfile" aria-label="Perfil">
      <i class="bi bi-person nav-icon" aria-hidden="true"></i>
      <div class="nav-label">Perfil</div>
    </button>
    <button :class="{active: navActive('/history')}" class="nav-item" @click.prevent="goOrders" aria-label="Histórico de pedidos">
      <i class="bi bi-journal-text nav-icon" aria-hidden="true"></i>
      <div class="nav-label">Histórico</div>
    </button>
    <button :class="{active: navActive('/menu')}" class="nav-item" @click.prevent="goMenu" aria-label="Cardápio">
      <i class="bi bi-list nav-icon" aria-hidden="true"></i>
      <div class="nav-label">Cardápio</div>
    </button>
  </nav>

</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import ListCard from '@/components/ListCard.vue'
import Swal from 'sweetalert2'
import { bindLoading } from '../state/globalLoading.js'
import { useRoute, useRouter } from 'vue-router'
import api from '../api'
import { applyPhoneMask, removePhoneMask } from '../utils/phoneMask.js'
import { formatCurrency } from '../utils/formatters.js'
const route = useRoute()
const router = useRouter()
const companyId = route.params.companyId

// persist storeId across public views so navigation keeps the selected store
const storeStorageKey = `public_store_${companyId}`
const storeId = ref(route.query.storeId || localStorage.getItem(storeStorageKey) || null)
try{ if(route.query && route.query.storeId) localStorage.setItem(storeStorageKey, String(route.query.storeId)) }catch(e){}
// persist menuId similarly so the selected menu survives navigation
const menuStorageKey = `public_menu_${companyId}`
const menuId = ref(route.query.menuId || localStorage.getItem(menuStorageKey) || null)
try{ if(route.query && route.query.menuId) localStorage.setItem(menuStorageKey, String(route.query.menuId)) }catch(e){}

const phoneQuery = route.query.phone || ''
const phone = ref(phoneQuery || '')
const needsPhone = ref(false)
const loading = ref(false)
bindLoading(loading)
const orders = ref([])

function statusClass(s){
  if(!s) return 'bg-secondary text-white'
  if (s === 'EM_PREPARO') return 'bg-warning text-dark'
  if (s === 'SAIU_PARA_ENTREGA') return 'bg-info text-dark'
  if (s === 'CONCLUIDO') return 'bg-success'
  if (s === 'CANCELADO') return 'bg-danger'
  if (s === 'INVOICE_AUTHORIZED') return 'bg-primary'
  return 'bg-secondary'
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
import { formatDateTime } from '../utils/dates.js';

function formatDate(d){ if(!d) return '-'; return formatDateTime(d) }

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

function submitPhone(){
  if(!phone.value) return
  loadHistory(false)
}
function refresh(){ loadHistory(true) }
async function logoutPublic(){
  try { await api.post(`/public/${companyId}/logout`) } catch(e){ }
  try { localStorage.removeItem(`public_customer_${companyId}`) } catch{}
  orders.value = []
  phone.value = ''
  needsPhone.value = true
}
function openOrder(o){ router.push({ path: `/public/${companyId}/order/${o.id}`, query: { storeId: storeId.value || undefined, menuId: menuId.value || undefined } }) }

onMounted(()=> { loadHistory(true) })

// auto-load if phone in query
if (phoneQuery) loadHistory(false)

function _publicNavigate(pathSuffix, extraQuery = {}){
  try{
    const base = `/public/${route.params.companyId || companyId}`;
    const mergedQuery = Object.assign({}, route.query || {}, extraQuery || {});
    if (storeId.value && !mergedQuery.storeId) mergedQuery.storeId = storeId.value
    if (menuId.value && !mergedQuery.menuId) mergedQuery.menuId = menuId.value
    Object.keys(mergedQuery).forEach(k => { if (mergedQuery[k] === undefined) delete mergedQuery[k]; });
    router.push({ path: `${base}${pathSuffix || ''}`, query: mergedQuery });
  }catch(e){ console.warn('_publicNavigate', e) }
}
function goProfile(){ _publicNavigate('/profile') }
function goOrders(){ _publicNavigate('/orders') }
function goMenu(){ _publicNavigate('/menu') }

function navActive(suffix){
  try{ const p = route.path || ''; return p.endsWith(suffix) }catch(e){ return false }
}
</script>

<style scoped>
  .public-container { max-width: 680px; margin: 0 auto; }
  .phone-box { background:#f9fafb; border:1px solid #eceff3; border-radius:12px; padding:14px 16px; }
.order-card { background:#ffffff; border:1px solid #eceff3; border-radius:12px; padding:14px 16px; margin-bottom:14px; cursor:pointer; transition:box-shadow .15s ease; }
.order-card:hover { box-shadow:0 4px 10px rgba(0,0,0,.06); }
.badge { font-size:.75rem; }
.empty { padding:24px 8px; text-align:center; }
@media (max-width:576px){
  .public-container > .list-card .card-body { padding:16px; }
  .order-card { padding:14px 16px; }
  .badge { font-size:.68rem; }
}

/* Mobile bottom nav (same style used on PublicMenu) */
.mobile-bottom-nav { display:flex; position:fixed; left:0; right:0; bottom:0; height:64px; background:#fff; border-top:1px solid rgba(0,0,0,0.06); z-index:10800; align-items:center; justify-content:space-around }
.mobile-bottom-nav .nav-item { background:transparent; border:none; padding:6px 8px; display:flex; flex-direction:column; align-items:center; justify-content:center; color:#333; position:relative }
.mobile-bottom-nav .nav-icon { font-size:20px; line-height:1 }
.mobile-bottom-nav .nav-label { font-size:12px; margin-top:4px }
.mobile-bottom-nav .cart-badge { background:#0d6efd; color:#fff; border-radius:10px; padding:2px 6px; font-size:11px; position:absolute; top:6px; right:12px; margin-left:0 }
.mobile-bottom-nav .nav-item.active, .mobile-bottom-nav .nav-item.active .nav-label, .mobile-bottom-nav .nav-item.active .nav-icon{ color: rgb(255 147 7) !important }
</style>
