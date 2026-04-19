<template>
  <div class="pp-page">
    <!-- Header -->
    <div class="pp-header">
      <h5 class="m-0 fw-bold">Minha Conta</h5>
      <button class="pp-close" @click="goMenu" aria-label="Voltar"><i class="bi bi-x-lg"></i></button>
    </div>

    <div class="pp-body">
      <!-- Logged in with profile -->
      <div v-if="profile">
        <div class="pp-card mb-3">
          <div class="pp-welcome">
            <div class="pp-avatar"><i class="bi bi-person"></i></div>
            <div>
              <div class="pp-name">Olá, {{ profile.name || profile.email }}</div>
              <div class="pp-detail"><i class="bi bi-whatsapp me-1"></i>{{ profile.whatsapp || '—' }}</div>
              <div class="pp-detail"><i class="bi bi-envelope me-1"></i>{{ profile.email || '—' }}</div>
            </div>
          </div>

          <div class="pp-actions">
            <button class="pp-action-btn" @click="goHistory"><i class="bi bi-bag"></i><span>Pedidos</span></button>
            <button class="pp-action-btn" @click.prevent="_publicNavigate('/addresses')"><i class="bi bi-geo-alt"></i><span>Endereços</span></button>
            <button class="pp-action-btn" @click.prevent="_publicNavigate('/profile/edit')"><i class="bi bi-pencil"></i><span>Dados</span></button>
            <button class="pp-action-btn" @click.prevent="_publicNavigate('/profile/password')"><i class="bi bi-lock"></i><span>Senha</span></button>
          </div>
        </div>

        <!-- Last order -->
        <div v-if="lastOrder" class="pp-card mb-3">
          <div class="pp-section-title">ÚLTIMO PEDIDO</div>
          <div class="d-flex justify-content-between align-items-start mb-2">
            <div>
              <div class="fw-semibold">Pedido #{{ lastOrder.displaySimple || lastOrder.displayId || (lastOrder.id || '').slice(0,6) }}</div>
              <div class="pp-detail mt-1">{{ formatDateTime(lastOrder.createdAt) }}</div>
            </div>
            <div class="text-end">
              <div class="pp-detail">{{ (lastOrder.items||[]).reduce((s,i)=> s+Number(i.quantity||1),0) }} {{ (lastOrder.items||[]).reduce((s,i)=> s+Number(i.quantity||1),0) === 1 ? 'item' : 'itens' }}</div>
              <div class="fw-bold" style="color:var(--pp-brand)">{{ fmt(Number(lastOrder.total||0)) }}</div>
            </div>
          </div>
          <div class="d-flex gap-2 mt-3">
            <button class="btn pp-btn-primary" @click="repeatOrder(lastOrder)">Repetir pedido</button>
            <button class="btn pp-btn-outline" @click="goHistory">Ver histórico</button>
          </div>
        </div>

        <!-- Cashback -->
        <div v-if="cashbackEnabled && wallet && wallet.balance !== undefined" class="pp-card mb-3">
          <div class="pp-section-title">CASHBACK</div>
          <div class="d-flex justify-content-between align-items-center">
            <div>
              <div class="pp-detail">Saldo disponível</div>
              <div class="fw-bold" style="font-size:20px;color:var(--pp-brand)">{{ fmt(Number(wallet.balance||0)) }}</div>
            </div>
            <button class="btn pp-btn-outline" @click.prevent="_publicNavigate('/profile/transactions')">Ver extrato</button>
          </div>
        </div>

        <button class="btn pp-btn-danger w-100" @click="doLogout"><i class="bi bi-box-arrow-right me-2"></i>Sair da conta</button>
      </div>

      <!-- Token present but no profile loaded -->
      <div v-else-if="!profile && tokenPresent">
        <div class="pp-card mb-3">
          <div class="text-center py-3">
            <div class="pp-avatar mb-2" style="margin:0 auto"><i class="bi bi-person-check"></i></div>
            <div class="fw-semibold">Conectado</div>
            <div class="pp-detail">Você está autenticado.</div>
          </div>
          <div class="pp-actions">
            <button class="pp-action-btn" @click="goHistory"><i class="bi bi-bag"></i><span>Pedidos</span></button>
            <button class="pp-action-btn" @click.prevent="_publicNavigate('/addresses')"><i class="bi bi-geo-alt"></i><span>Endereços</span></button>
            <button class="pp-action-btn" @click.prevent="_publicNavigate('/profile/edit')"><i class="bi bi-pencil"></i><span>Dados</span></button>
            <button class="pp-action-btn" @click.prevent="_publicNavigate('/profile/password')"><i class="bi bi-lock"></i><span>Senha</span></button>
          </div>
        </div>
        <button class="btn pp-btn-danger w-100" @click="doLogout"><i class="bi bi-box-arrow-right me-2"></i>Sair</button>
      </div>

      <!-- Not logged in: Login / Register tabs -->
      <div v-else>
        <div class="pp-card mb-3">
          <div class="text-center mb-3">
            <div class="pp-avatar mb-2" style="margin:0 auto"><i class="bi bi-person"></i></div>
            <div class="fw-semibold">Seus dados</div>
          </div>

          <div class="pp-tabs mb-3">
            <button :class="['pp-tab', { active: tab === 'login' }]" @click="tab='login'">Entrar</button>
            <button :class="['pp-tab', { active: tab === 'register' }]" @click="tab='register'">Criar Conta</button>
          </div>

          <div v-if="msg" class="alert mb-3" :class="msgType" style="border-radius:10px;font-size:13px;padding:10px 14px">{{ msg }}</div>

          <!-- Login -->
          <div v-if="tab === 'login'">
            <div class="mb-3">
              <label class="form-label pp-label">WhatsApp / Telefone</label>
              <input :value="login.email" @input="onLoginPhoneInput" class="form-control pp-input" type="text" placeholder="(00) 9 0000-0000" />
              <div class="pp-hint">Formato: (DD) 9 0000-0000 — inclua o DDD</div>
            </div>
            <div class="mb-3">
              <label class="form-label pp-label">Senha</label>
              <input v-model="login.password" class="form-control pp-input" type="password" />
            </div>
            <div class="d-flex align-items-center gap-3 flex-wrap">
              <button class="btn pp-btn-primary" @click="doLogin" :disabled="loading">
                <span v-if="loading" class="spinner-border spinner-border-sm me-1"></span>Entrar
              </button>
              <a href="#" class="pp-link d-flex align-items-center gap-1" @click.prevent="useWhatsapp">
                <i class="bi bi-whatsapp"></i> Continuar com WhatsApp
              </a>
            </div>
          </div>

          <!-- Register -->
          <div v-if="tab === 'register'">
            <div class="mb-3">
              <label class="form-label pp-label">Nome</label>
              <input v-model="reg.name" class="form-control pp-input" type="text" />
            </div>
            <div class="mb-3">
              <label class="form-label pp-label">WhatsApp</label>
              <input :value="reg.whatsapp" @input="onRegWhatsappInput" class="form-control pp-input" type="text" placeholder="(00) 9 0000-0000" />
              <div class="pp-hint">Utilize DDD, exemplo: (11) 9 9123-4567</div>
            </div>
            <div class="mb-3">
              <label class="form-label pp-label">E-mail</label>
              <input v-model="reg.email" class="form-control pp-input" type="email" />
            </div>
            <div class="mb-3">
              <label class="form-label pp-label">Senha</label>
              <input v-model="reg.password" class="form-control pp-input" type="password" />
            </div>
            <div class="d-flex justify-content-end">
              <button class="btn pp-btn-primary" @click="doRegister" :disabled="loading">
                <span v-if="loading" class="spinner-border spinner-border-sm me-1"></span>Criar Conta
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Mobile bottom nav -->
    <nav class="pp-bottom-nav d-lg-none">
      <button :class="{ active: navActive('/profile') }" class="pp-nav-item" @click.prevent="goProfile">
        <i class="bi bi-person pp-nav-icon"></i><div class="pp-nav-label">Perfil</div>
      </button>
      <button :class="{ active: navActive('/history') }" class="pp-nav-item" @click.prevent="goHistory">
        <i class="bi bi-journal-text pp-nav-icon"></i><div class="pp-nav-label">Histórico</div>
      </button>
      <button :class="{ active: navActive('/menu') }" class="pp-nav-item" @click.prevent="goMenu">
        <i class="bi bi-grid pp-nav-icon"></i><div class="pp-nav-label">Cardápio</div>
      </button>
    </nav>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import api from '../api'
import { formatDateTime } from '../utils/dates.js'

const route = useRoute()
const router = useRouter()
const companyId = route.params.companyId || ''

import { onMounted } from 'vue'
import { applyPhoneMask, removePhoneMask } from '../utils/phoneMask.js'

const props = defineProps({ embedded: { type: Boolean, default: false }, initialTab: { type: String, default: '' } })
const emit = defineEmits(['authenticated','logout'])

const tab = ref('login')
const loading = ref(false)
const msg = ref('')
const msgType = ref('')

const login = ref({ email: '', password: '' })
const reg = ref({ name: '', whatsapp: '', email: '', password: '' })
const profile = ref(null)
const lastOrder = ref(null)
const loadingLast = ref(false)
const wallet = ref({ balance: 0, transactions: [] })
const cashbackEnabled = ref(false)
const tokenPresent = ref(false)

const COMPANY_CUSTOMER_KEY = `public_customer_${companyId}`
const PUBLIC_TOKEN_KEY = `public_token_${companyId}`

function fmt(v){ return new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(v) }

onMounted(()=>{
  fetchCashbackSettings()
  const token = localStorage.getItem(PUBLIC_TOKEN_KEY)
  const stored = JSON.parse(localStorage.getItem(COMPANY_CUSTOMER_KEY) || 'null')
  if(token && stored){
    profile.value = stored
    fetchLastOrder()
    tokenPresent.value = true
  } else if (token && !stored) {
    tokenPresent.value = true
    fetchLastOrder()
  }
  try{
    const initial = (props.initialTab && String(props.initialTab).length) ? String(props.initialTab).toLowerCase() : ((route && route.query && route.query.tab) ? String(route.query.tab).toLowerCase() : '')
    if(initial === 'register') tab.value = 'register'
    if(initial === 'login') tab.value = 'login'
  }catch(e){}
})

function setMsg(text, type='alert-success'){ msg.value = text; msgType.value = type }

async function fetchLastOrder(){
  try{
    loadingLast.value = true
    let res
    const phone = (profile.value && (profile.value.contact || profile.value.whatsapp)) || ''
    const digits = removePhoneMask(phone || '')
    if(digits){ res = await api.get(`/public/${companyId}/orders?phone=${encodeURIComponent(digits)}`) }
    else { res = await api.get(`/public/${companyId}/orders?limit=1`) }
    const arr = Array.isArray(res.data) ? res.data : []
    if(arr.length){
      lastOrder.value = arr[0]
      if(!profile.value && arr[0].customer){ profile.value = arr[0].customer; try{ localStorage.setItem(COMPANY_CUSTOMER_KEY, JSON.stringify(profile.value)) }catch{} }
      if(profile.value && profile.value.id) fetchWallet()
    }
  }catch(e){ console.warn('fetchLastOrder err', e) }finally{ loadingLast.value = false }
}

async function fetchWallet(){
  try{ if(!profile.value || !profile.value.id) return; const res = await api.get(`/cashback/wallet?clientId=${profile.value.id}`); wallet.value = res.data || { balance: 0, transactions: [] } }catch(e){ console.warn('fetchWallet', e) }
}

async function fetchCashbackSettings(){
  try{ const res = await api.get(`/public/${companyId}/cashback-settings`); cashbackEnabled.value = !!(res.data && res.data.enabled) }catch(e){ cashbackEnabled.value = false }
}

function repeatOrder(order){
  if(!order || !Array.isArray(order.items) || !order.items.length){ setMsg('Nenhum item no pedido', 'alert-danger'); return }
  try{
    const key = `public_cart_${companyId}`
    const cart = order.items.map(i => ({ lineId: `${Date.now()}-${Math.random().toString(36).slice(2,9)}`, productId: i.productId || i.productId, name: i.name || i.productName || '', price: Number(i.price||0), quantity: Number(i.quantity||1), options: Array.isArray(i.options) ? i.options.map(o => ({ id: o.id || o.optionId || null, name: o.name, price: Number(o.price||0) })) : [] }))
    localStorage.setItem(key, JSON.stringify(cart))
    setMsg('Pedido carregado no carrinho', 'alert-success')
    _publicNavigate('/menu')
  }catch(e){ console.warn('repeatOrder err', e); setMsg('Não foi possível repetir o pedido', 'alert-danger') }
}

function onLoginPhoneInput(e){ try{ login.value.email = applyPhoneMask(e.target.value) }catch(e){} }
function onRegWhatsappInput(e){ try{ reg.value.whatsapp = applyPhoneMask(e.target.value) }catch(e){} }

async function doRegister(){
  msg.value = ''
  if(!reg.value.whatsapp || !reg.value.password){ setMsg('WhatsApp e senha são obrigatórios', 'alert-danger'); return }
  const clean = removePhoneMask(reg.value.whatsapp || '')
  if (String(clean).length < 10) { setMsg('Informe um número de WhatsApp válido (DDD + número)', 'alert-danger'); return }
  loading.value = true
  try{
    const payload = { name: reg.value.name, whatsapp: clean, email: reg.value.email || null, password: reg.value.password }
    const res = await api.post(`/public/${companyId}/register`, payload)
    if (res && res.data && res.data.token){
      localStorage.setItem(PUBLIC_TOKEN_KEY, res.data.token)
      if(res.data.customer) localStorage.setItem(COMPANY_CUSTOMER_KEY, JSON.stringify(res.data.customer))
      setMsg('Conta criada com sucesso', 'alert-success')
      if(res.data.customer) profile.value = res.data.customer
      try{ window.dispatchEvent(new CustomEvent('app:user-logged-in')) }catch(e){}
      if(props.embedded){ emit('authenticated', res.data.customer || null) }
      else { router.push({ path: `/public/${companyId}/menu` }) }
    }
  }catch(e){
    console.error('doRegister error', e)
    const status = e?.response?.status
    if (status === 400) setMsg(e.response?.data?.message || 'Dados inválidos', 'alert-danger')
    else setMsg(e.response?.data?.message || 'Erro ao criar conta', 'alert-danger')
  }finally{ loading.value = false }
}

async function doLogin(){
  msg.value = ''
  const raw = login.value.email || ''
  const password = login.value.password || ''
  if(!raw || !password){ setMsg('Informe WhatsApp/email e senha', 'alert-danger'); return }
  loading.value = true
  try{
    const body = { password }
    if (raw.includes('@')) body.email = raw
    else body.whatsapp = removePhoneMask(raw)
    if (body.whatsapp && String(body.whatsapp).length < 10) { setMsg('Informe um número de WhatsApp válido (DDD + número) ou use email', 'alert-danger'); loading.value = false; return }
    let res
    try { res = await api.post(`/public/${companyId}/login`, body) }
    catch (errPrimary) {
      if (errPrimary?.response?.status === 404) { try { res = await api.post('/auth/login-whatsapp', body) } catch (errFallback) { res = await api.post('/auth/login', body) } }
      else { throw errPrimary }
    }
    if (res && res.data && res.data.token){
      localStorage.setItem(PUBLIC_TOKEN_KEY, res.data.token)
      if(res.data.customer) localStorage.setItem(COMPANY_CUSTOMER_KEY, JSON.stringify(res.data.customer))
      setMsg('Login efetuado', 'alert-success')
      if(res.data.customer) profile.value = res.data.customer
      try{ window.dispatchEvent(new CustomEvent('app:user-logged-in')) }catch(e){}
      if(props.embedded){ emit('authenticated', res.data.customer || null) }
      else { router.push({ path: `/public/${companyId}/menu` }) }
    }
  }catch(e){
    console.error('doLogin error', e)
    const status = e?.response?.status
    if (status === 401) setMsg('Usuário ou senha inválidos', 'alert-danger')
    else setMsg(e.response?.data?.message || 'Erro ao autenticar', 'alert-danger')
  }finally{ loading.value = false }
}

function useWhatsapp(){
  if(props.embedded){ emit('authenticated', null) }
  else { router.push({ path: `/public/${companyId}/menu` }) }
}

function doLogout(){
  localStorage.removeItem(PUBLIC_TOKEN_KEY)
  localStorage.removeItem(COMPANY_CUSTOMER_KEY)
  profile.value = null
  if(props.embedded){ emit('logout') }
  else { router.push({ path: `/public/${companyId}/menu` }) }
}

function _publicNavigate(pathSuffix, extraQuery = {}){
  try{
    const base = `/public/${route.params.companyId || companyId}`
    const mergedQuery = Object.assign({}, route.query || {}, extraQuery || {})
    Object.keys(mergedQuery).forEach(k => { if (mergedQuery[k] === undefined) delete mergedQuery[k] })
    router.push({ path: `${base}${pathSuffix || ''}`, query: mergedQuery })
  }catch(e){ console.warn('_publicNavigate', e) }
}

function goProfile(){ _publicNavigate('/profile') }
function goHistory(){ _publicNavigate('/history') }
function goMenu(){ _publicNavigate('/menu') }
function navActive(suffix){ try{ return (route.path || '').endsWith(suffix) }catch(e){ return false } }
</script>

<style scoped>
.pp-page {
  --pp-bg: #FFF8F0;
  --pp-surface: #FFFFFF;
  --pp-surface-alt: #FBF3E8;
  --pp-border: #F0E6D2;
  --pp-text: #1A1410;
  --pp-muted: #7A6E62;
  --pp-brand: #2E7D32;
  --pp-brand-light: #E8F5E9;
  font-family: 'Inter', -apple-system, system-ui, sans-serif;
  background: var(--pp-bg);
  min-height: 100vh;
  color: var(--pp-text);
  padding-bottom: 80px;
}
.pp-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 20px; background: var(--pp-surface);
  border-bottom: 1px solid var(--pp-border);
  position: sticky; top: 0; z-index: 10;
}
.pp-close {
  all: unset; cursor: pointer; width: 34px; height: 34px; border-radius: 50%;
  background: var(--pp-surface-alt); display: flex; align-items: center; justify-content: center;
  font-size: 14px; color: var(--pp-text);
}
.pp-close:hover { background: var(--pp-border); }
.pp-body { max-width: 520px; margin: 0 auto; padding: 20px 16px; }

/* Cards */
.pp-card {
  background: var(--pp-surface); border: 1px solid var(--pp-border);
  border-radius: 16px; padding: 20px;
}
.pp-section-title {
  font-size: 11px; font-weight: 700; letter-spacing: 0.8px; color: var(--pp-muted);
  margin-bottom: 14px; padding-bottom: 10px; border-bottom: 1px solid var(--pp-border);
}

/* Welcome block */
.pp-welcome { display: flex; align-items: center; gap: 14px; margin-bottom: 16px; }
.pp-avatar {
  width: 48px; height: 48px; border-radius: 50%;
  background: var(--pp-brand-light); color: var(--pp-brand);
  display: flex; align-items: center; justify-content: center; font-size: 22px; flex-shrink: 0;
}
.pp-name { font-size: 18px; font-weight: 700; color: var(--pp-text); }
.pp-detail { font-size: 13px; color: var(--pp-muted); margin-top: 2px; }

/* Action buttons grid */
.pp-actions { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-top: 16px; }
.pp-action-btn {
  all: unset; cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 6px;
  padding: 12px 8px; border-radius: 12px; border: 1px solid var(--pp-border);
  background: var(--pp-surface); text-align: center; transition: background 0.15s;
}
.pp-action-btn i { font-size: 18px; color: var(--pp-brand); }
.pp-action-btn span { font-size: 11px; font-weight: 600; color: var(--pp-text); }
.pp-action-btn:hover { background: var(--pp-surface-alt); }

/* Tabs */
.pp-tabs {
  display: inline-flex; border: 1px solid var(--pp-border); border-radius: 10px;
  overflow: hidden; background: var(--pp-surface-alt);
}
.pp-tab {
  padding: 8px 20px; font-size: 13px; font-weight: 600; border: none;
  background: transparent; color: var(--pp-muted); cursor: pointer; transition: background 0.15s;
}
.pp-tab.active { background: var(--pp-surface); color: var(--pp-text); box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
.pp-tab:hover:not(.active) { color: var(--pp-text); }

/* Form */
.pp-label { font-size: 13px; font-weight: 600; color: var(--pp-text); }
.pp-input {
  border: 1px solid var(--pp-border); border-radius: 12px;
  background: var(--pp-surface); color: var(--pp-text); padding: 10px 14px;
}
.pp-input:focus { border-color: var(--pp-brand); box-shadow: 0 0 0 3px rgba(46,125,50,0.1); }
.pp-hint { font-size: 12px; color: var(--pp-muted); margin-top: 4px; }
.pp-link { color: var(--pp-brand); font-weight: 500; text-decoration: none; font-size: 13px; }
.pp-link:hover { text-decoration: underline; }

/* Buttons */
.pp-btn-primary {
  background: var(--pp-brand); color: #fff; border: none; border-radius: 10px;
  font-weight: 600; font-size: 14px; padding: 10px 20px;
}
.pp-btn-primary:hover { background: #256029; color: #fff; }
.pp-btn-primary:disabled { opacity: 0.5; }
.pp-btn-outline {
  background: transparent; color: var(--pp-text); border: 1px solid var(--pp-border);
  border-radius: 10px; font-weight: 600; font-size: 13px; padding: 8px 16px;
}
.pp-btn-outline:hover { background: var(--pp-surface-alt); color: var(--pp-text); }
.pp-btn-danger {
  background: transparent; color: #C62828; border: 1px solid #FFCDD2;
  border-radius: 12px; font-weight: 600; font-size: 14px; padding: 12px;
}
.pp-btn-danger:hover { background: #FFEBEE; color: #C62828; }

/* Bottom nav */
.pp-bottom-nav {
  display: flex; position: fixed; left: 0; right: 0; bottom: 0; height: 64px;
  background: var(--pp-surface); border-top: 1px solid var(--pp-border);
  z-index: 10800; align-items: center; justify-content: space-around;
}
.pp-nav-item {
  all: unset; cursor: pointer; display: flex; flex-direction: column;
  align-items: center; gap: 4px; padding: 6px 12px; color: var(--pp-muted);
}
.pp-nav-icon { font-size: 20px; line-height: 1; }
.pp-nav-label { font-size: 11px; }
.pp-nav-item.active, .pp-nav-item.active .pp-nav-label, .pp-nav-item.active .pp-nav-icon {
  color: var(--pp-brand) !important; font-weight: 700;
}

@media (max-width: 576px) {
  .pp-body { padding: 16px 12px; }
  .pp-card { padding: 16px; }
  .pp-actions { grid-template-columns: repeat(2, 1fr); }
}
</style>
