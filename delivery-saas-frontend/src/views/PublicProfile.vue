<template>
    <div class="public-container">
        <div class="list-card container py-4 list-card--card-style">
            <div class="card"><div class="card-body">
                <h4 class="mb-0"><i class="bi bi-person nav-icon me-2"></i> Minha Conta</h4>


                
         <div v-if="profile">
          <div class="card mb-3">
            <div class="card-body">
              <h5 class="card-title">Olá, {{ profile.name || profile.email }}</h5>
              <p class="card-text small text-muted">WhatsApp: {{ profile.whatsapp || '-' }}</p>
              <p class="card-text small text-muted">Email: {{ profile.email || '-' }}</p>
              <div class="d-flex gap-2 mb-2">
                <button class="btn btn-outline-secondary" @click="goHistory">Meus Pedidos</button>
                <button class="btn btn-outline-secondary" @click.prevent="_publicNavigate('/addresses')">Meus endereços</button>
                <button class="btn btn-outline-secondary" @click.prevent="_publicNavigate('/profile/edit')">Meus dados</button>
                <button class="btn btn-outline-secondary" @click.prevent="_publicNavigate('/profile/password')">Alterar senha</button>
                <button class="btn btn-danger" @click="doLogout">Sair</button>
              </div>

              <div v-if="lastOrder" class="card mt-2">
                <div class="card-body">
                  <div class="d-flex justify-content-between align-items-start">
                    <div>
                      <div class="fw-semibold">Último pedido: {{ lastOrder.displayId || (lastOrder.id || '').slice(0,6) }}</div>
                      <div class="small text-muted mt-1">{{ formatDateTime(lastOrder.createdAt) }}</div>
                    </div>
                    <div class="text-end">
                      <div class="small text-muted">Itens: {{ (lastOrder.items||[]).reduce((s,i)=> s+Number(i.quantity||1),0) }}</div>
                      <div class="fw-semibold">{{ new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(lastOrder.total||0)) }}</div>
                    </div>
                  </div>
                  <div class="mt-3 d-flex gap-2">
                    <button class="btn btn-sm btn-primary" @click="repeatOrder(lastOrder)">Repetir pedido</button>
                    <button class="btn btn-sm btn-outline-secondary" @click="goHistory">Ver histórico</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div v-if="cashbackEnabled && wallet && (wallet.balance!==undefined)" class="card mt-3">
            <div class="card-body">
              <h5 class="card-title">Saldo de Cashback</h5>
              <div class="d-flex justify-content-between align-items-center">
                <div class="fw-semibold">{{ new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(wallet.balance||0)) }}</div>
                <div><button class="btn btn-sm btn-outline-secondary" @click.prevent="_publicNavigate('/profile/transactions')">Ver extrato</button></div>
              </div>
            </div>
          </div>
        </div>
          <ul v-if="!profile && !tokenPresent" class="nav nav-tabs mb-3">
          <li class="nav-item"><a class="nav-link" :class="{active: tab==='login'}" href="#" @click.prevent="tab='login'">Entrar</a></li>
          <li class="nav-item"><a class="nav-link" :class="{active: tab==='register'}" href="#" @click.prevent="tab='register'">Criar Conta</a></li>
        </ul>


        
        <div v-if="!profile && !tokenPresent && tab==='login'">
          <div v-if="msg" class="alert" :class="msgType">{{ msg }}</div>
          <div class="mb-3">
            <label class="form-label">WhatsApp / Telefone</label>
            <input :value="login.email" @input="onLoginPhoneInput" class="form-control" type="text" placeholder="(00) 9 0000-0000" />
            <div class="small text-muted mt-1">Formato: (DD) 9 0000-0000 — inclua o DDD</div>
          </div>
          <div class="mb-3">
            <label class="form-label">Senha</label>
            <input v-model="login.password" class="form-control" type="password" />
          </div>
          <div class="d-flex justify-content-between align-items-center">
            <button class="btn btn-primary" @click="doLogin" :disabled="loading">Entrar</button>
            <button class="btn btn-link" @click.prevent="useWhatsapp">Continuar com WhatsApp</button>
          </div>
        </div>



        <div v-if="!profile && tokenPresent" class="card mb-3">
          <div class="card-body">
            <h5 class="card-title">Conectado</h5>
            <p class="small text-muted">Você está conectado com um token válido.</p>
            <div class="d-flex gap-2 flex-wrap">
              <button class="btn btn-outline-secondary" @click="goHistory">Ver histórico</button>
              <button class="btn btn-outline-secondary" @click.prevent="_publicNavigate('/addresses')">Meus endereços</button>
              <button class="btn btn-outline-secondary" @click.prevent="_publicNavigate('/profile/edit')">Meus dados</button>
              <button class="btn btn-outline-secondary" @click.prevent="_publicNavigate('/profile/password')">Alterar senha</button>
              <button class="btn btn-danger" @click="doLogout">Sair</button>
            </div>
          </div>
        </div>


        <div v-if="!profile && !tokenPresent && tab==='register'">
          <div v-if="msg" class="alert" :class="msgType">{{ msg }}</div>
          <div class="mb-3">
            <label class="form-label">Nome</label>
            <input v-model="reg.name" class="form-control" type="text" />
          </div>
          <div class="mb-3">
            <label class="form-label">WhatsApp</label>
            <input :value="reg.whatsapp" @input="onRegWhatsappInput" class="form-control" type="text" placeholder="(00) 9 0000-0000" />
            <div class="small text-muted mt-1">Utilize DDD; exemplo: (11) 9 9123-4567</div>
          </div>
          <div class="mb-3">
            <label class="form-label">Email</label>
            <input v-model="reg.email" class="form-control" type="email" />
          </div>
          <div class="mb-3">
            <label class="form-label">Senha</label>
            <input v-model="reg.password" class="form-control" type="password" />
          </div>
          <div class="d-flex justify-content-end">
            <button class="btn btn-primary" @click="doRegister" :disabled="loading">Criar Conta</button>
          </div>
        </div>


            </div>
        </div>
        </div>
        
    </div>
 

  <!-- Mobile bottom nav (same as OrderHistory) -->
  <nav class="mobile-bottom-nav d-lg-none">
    <button :class="{active: navActive('/profile')}" class="nav-item" @click.prevent="goProfile" aria-label="Perfil">
      <i class="bi bi-person nav-icon" aria-hidden="true"></i>
      <div class="nav-label">Perfil</div>
    </button>
    <button :class="{active: navActive('/history')}" class="nav-item" @click.prevent="goHistory" aria-label="Histórico de pedidos">
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

onMounted(()=>{
  // fetch cashback settings to decide whether to show wallet section
  fetchCashbackSettings()
  const token = localStorage.getItem('token')
  const stored = JSON.parse(localStorage.getItem(COMPANY_CUSTOMER_KEY) || 'null')
  if(token && stored){
    profile.value = stored
    fetchLastOrder()
    tokenPresent.value = true
  } else if (token && !stored) {
    // token exists but no stored customer info — treat as logged-in and try to infer profile
    tokenPresent.value = true
    fetchLastOrder() // try to get last order using token-authenticated route
  }
  // allow opening a specific tab via prop or query param: prop takes precedence
  try{
    const initial = (props.initialTab && String(props.initialTab).length) ? String(props.initialTab).toLowerCase() : ((route && route.query && route.query.tab) ? String(route.query.tab).toLowerCase() : '')
    if(initial === 'register') tab.value = 'register'
    if(initial === 'login') tab.value = 'login'
  }catch(e){}
})

function setMsg(text, type='alert-success'){
  msg.value = text
  msgType.value = type
}

async function fetchLastOrder(){
  try{
    loadingLast.value = true
    // prefer querying by phone if we have it, otherwise try a token-authenticated fetch (limit=1)
    let res
    const phone = (profile.value && (profile.value.contact || profile.value.whatsapp)) || ''
    const digits = removePhoneMask(phone || '')
    if(digits){
      res = await api.get(`/public/${companyId}/orders?phone=${encodeURIComponent(digits)}`)
    } else {
      // backend may support returning recent orders for authenticated token when no phone provided
      res = await api.get(`/public/${companyId}/orders?limit=1`)
    }
    const arr = Array.isArray(res.data) ? res.data : []
    if(arr.length){
      lastOrder.value = arr[0]
      // if we don't have profile yet, try to extract customer from order
      if(!profile.value && arr[0].customer){
        profile.value = arr[0].customer
        try{ localStorage.setItem(COMPANY_CUSTOMER_KEY, JSON.stringify(profile.value)) }catch{}
      }
      // if we have profile, fetch wallet
      if(profile.value && profile.value.id) fetchWallet()
    }
  }catch(e){ console.warn('fetchLastOrder err', e) }finally{ loadingLast.value = false }
}

async function fetchWallet(){
  try{
    if(!profile.value || !profile.value.id) return
    const res = await api.get(`/cashback/wallet?clientId=${profile.value.id}`)
    wallet.value = res.data || { balance: 0, transactions: [] }
  }catch(e){ console.warn('fetchWallet', e) }
}

async function fetchCashbackSettings(){
  try{
    const res = await api.get(`/public/${companyId}/cashback-settings`)
    cashbackEnabled.value = !!(res.data && res.data.enabled)
  }catch(e){ cashbackEnabled.value = false }
}

function repeatOrder(order){
  if(!order || !Array.isArray(order.items) || !order.items.length){ setMsg('Nenhum item no pedido', 'alert-danger'); return }
  try{
    const key = `public_cart_${companyId}`
    const cart = order.items.map(i => ({
      lineId: `${Date.now()}-${Math.random().toString(36).slice(2,9)}`,
      productId: i.productId || i.productId,
      name: i.name || i.productName || '',
      price: Number(i.price||0),
      quantity: Number(i.quantity||1),
      options: Array.isArray(i.options) ? i.options.map(o => ({ id: o.id || o.optionId || null, name: o.name, price: Number(o.price||0) })) : []
    }))
    localStorage.setItem(key, JSON.stringify(cart))
    setMsg('Pedido carregado no carrinho', 'alert-success')
    _publicNavigate('/menu')
  }catch(e){ console.warn('repeatOrder err', e); setMsg('Não foi possível repetir o pedido', 'alert-danger') }
}

function onLoginPhoneInput(e){
  try{ login.value.email = applyPhoneMask(e.target.value) }catch(e){}
}

function onRegWhatsappInput(e){
  try{ reg.value.whatsapp = applyPhoneMask(e.target.value) }catch(e){}
}

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
      localStorage.setItem('token', res.data.token)
      if(res.data.customer) localStorage.setItem(COMPANY_CUSTOMER_KEY, JSON.stringify(res.data.customer))
      setMsg('Conta criada com sucesso', 'alert-success')
      if(res.data.customer) profile.value = res.data.customer
      // notify other components (e.g. PublicMenu) to refresh profile/addresses/wallet
      try{ window.dispatchEvent(new CustomEvent('app:user-logged-in')) }catch(e){}
      if(props.embedded){
        emit('authenticated', res.data.customer || null)
      } else {
        router.push({ path: `/public/${companyId}/menu` })
      }
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
    try {
      res = await api.post(`/public/${companyId}/login`, body)
    } catch (errPrimary) {
      if (errPrimary?.response?.status === 404) {
        try { res = await api.post('/auth/login-whatsapp', body) } catch (errFallback) { res = await api.post('/auth/login', body) }
      } else {
        throw errPrimary
      }
    }

    if (res && res.data && res.data.token){
      localStorage.setItem('token', res.data.token)
      if(res.data.customer) localStorage.setItem(COMPANY_CUSTOMER_KEY, JSON.stringify(res.data.customer))
      setMsg('Login efetuado', 'alert-success')
      if(res.data.customer) profile.value = res.data.customer
      // notify other components (e.g. PublicMenu) to refresh profile/addresses/wallet
      try{ window.dispatchEvent(new CustomEvent('app:user-logged-in')) }catch(e){}
      if(props.embedded){ emit('authenticated', res.data.customer || null) }
      else { router.push({ path: `/public/${companyId}/menu` }) }
    }
  }catch(e){
    console.error('doLogin error', e)
    const status = e?.response?.status
    const path = e?.config?.url
    if (status === 404) setMsg(`Rota não encontrada (${path}). Verifique backend.`, 'alert-danger')
    else if (status === 401) setMsg('Usuário ou senha inválidos', 'alert-danger')
    else setMsg(e.response?.data?.message || 'Erro ao autenticar', 'alert-danger')
  }finally{ loading.value = false }
}

function useWhatsapp(){
  if(props.embedded){
    emit('authenticated', null)
  } else {
    router.push({ path: `/public/${companyId}/menu` })
  }
}

function doLogout(){
  localStorage.removeItem('token')
  localStorage.removeItem(COMPANY_CUSTOMER_KEY)
  profile.value = null
  if(props.embedded){
    emit('logout')
  } else {
    router.push({ path: `/public/${companyId}/menu` })
  }
}

function _publicNavigate(pathSuffix, extraQuery = {}){
  try{
    const base = `/public/${route.params.companyId || companyId}`;
    const mergedQuery = Object.assign({}, route.query || {}, extraQuery || {});
    Object.keys(mergedQuery).forEach(k => { if (mergedQuery[k] === undefined) delete mergedQuery[k]; });
    router.push({ path: `${base}${pathSuffix || ''}`, query: mergedQuery });
  }catch(e){ console.warn('_publicNavigate', e) }
}

function goProfile(){ _publicNavigate('/profile') }
function goHistory(){ _publicNavigate('/history') }
function goMenu(){ _publicNavigate('/menu') }

function navActive(suffix){
  try{
    const p = route.path || ''
    return p.endsWith(suffix)
  }catch(e){ return false }
}
</script>

<style scoped>
.nav-tabs .nav-link{ cursor: pointer }
/* Mobile bottom nav (same style used on PublicMenu / OrderHistory) */
.mobile-bottom-nav { display:flex; position:fixed; left:0; right:0; bottom:0; height:64px; background:#fff; border-top:1px solid rgba(0,0,0,0.06); z-index:10800; align-items:center; justify-content:space-around }
.mobile-bottom-nav .nav-item { background:transparent; border:none; padding:6px 8px; display:flex; flex-direction:column; align-items:center; justify-content:center; color:#333; position:relative }
.mobile-bottom-nav .nav-icon { font-size:20px; line-height:1 }
.mobile-bottom-nav .nav-label { font-size:12px; margin-top:4px }
.mobile-bottom-nav .cart-badge { background:#0d6efd; color:#fff; border-radius:10px; padding:2px 6px; font-size:11px; position:absolute; top:6px; right:12px; margin-left:0 }
.mobile-bottom-nav .nav-item.active, .mobile-bottom-nav .nav-item.active .nav-label, .mobile-bottom-nav .nav-item.active .nav-icon{ color: rgb(255 147 7) !important }
</style>

