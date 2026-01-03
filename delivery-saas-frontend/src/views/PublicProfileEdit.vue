<template>
    <div class="public-container">
        <div class="list-card container py-4 list-card--card-style">
            <div class="card"><div class="card-body">
                <h4 class="mb-0">Meus dados</h4>
    <div v-if="loading">Carregando...</div>
    <form v-else @submit.prevent="save">
      <div class="mb-3">
        <label class="form-label">Nome</label>
        <input v-model="profile.name" class="form-control" />
      </div>
        <div class="mb-3">
          <label class="form-label">Telefone</label>
          <input v-model="profile.whatsapp" class="form-control" />
        </div>
        <div class="mb-3">
          <label class="form-label">Data de nascimento</label>
          <input v-model="profile.birthDate" type="date" class="form-control" />
        </div>
        <div class="mb-3">
          <label class="form-label">CPF</label>
          <input v-model="profile.cpf" class="form-control" placeholder="000.000.000-00" />
        </div>
        <div class="mb-3">
          <label class="form-label">Email</label>
          <input v-model="profile.email" class="form-control" />
        </div>
      <button class="btn btn-primary" :disabled="saving">Salvar</button>
    </form>
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
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import api from '../api'

const route = useRoute()
const router = useRouter()
const companyId = route.params.companyId
const loading = ref(true)
const saving = ref(false)
const profile = ref({ name: '', whatsapp: '', birthDate: '', cpf: '', email: '' })

async function load() {
  loading.value = true
  try {
    // try localStorage first
    const key = `public_customer_${companyId}`
    const raw = localStorage.getItem(key)
    if (raw) {
      profile.value = JSON.parse(raw)
      return
    }
    const { data } = await api.get(`/public/${companyId}/profile`)
    if (data && data.profile) {
      profile.value = data.profile
      localStorage.setItem(key, JSON.stringify(data.profile))
    }
  } catch (e) {
    console.warn('load profile failed', e?.message || e)
  } finally {
    loading.value = false
  }
}

async function save() {
  saving.value = true
  try {
    await api.post(`/public/${companyId}/profile`, profile.value)
    const key = `public_customer_${companyId}`
    localStorage.setItem(key, JSON.stringify(profile.value))
    router.push({ path: `/public/${companyId}/profile` })
  } catch (e) {
    console.error(e)
    alert('Erro ao salvar')
  } finally {
    saving.value = false
  }
}

onMounted(load)

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