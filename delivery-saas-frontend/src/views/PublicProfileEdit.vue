<template>
  <div class="pe-page">
    <div class="pe-header">
      <button class="pe-back" @click="goProfile" aria-label="Voltar"><i class="bi bi-arrow-left"></i></button>
      <h5 class="m-0 fw-bold flex-fill text-center">Meus dados</h5>
      <div style="width:34px"></div>
    </div>

    <div class="pe-body">
      <div v-if="loading" class="text-center py-4">
        <div class="spinner-border" style="color:var(--pe-brand)" role="status"><span class="visually-hidden">Carregando...</span></div>
      </div>

      <div v-else class="pe-card">
        <div class="pe-section-header mb-3">
          <div class="pe-avatar"><i class="bi bi-person-gear"></i></div>
          <div>
            <div class="fw-bold">Dados pessoais</div>
            <div class="small" style="color:var(--pe-muted)">Atualize suas informações</div>
          </div>
        </div>

        <form @submit.prevent="save">
          <div class="mb-3">
            <label class="form-label pe-label">Nome</label>
            <input v-model="profile.name" class="form-control pe-input" placeholder="Seu nome completo" />
          </div>
          <div class="mb-3">
            <label class="form-label pe-label">Telefone / WhatsApp</label>
            <input v-model="profile.whatsapp" class="form-control pe-input" placeholder="(00) 9 0000-0000" />
          </div>
          <div class="row mb-3">
            <div class="col-6">
              <label class="form-label pe-label">Data de nascimento</label>
              <input v-model="profile.birthDate" type="date" class="form-control pe-input" />
            </div>
            <div class="col-6">
              <label class="form-label pe-label">CPF</label>
              <input v-model="profile.cpf" class="form-control pe-input" placeholder="000.000.000-00" />
            </div>
          </div>
          <div class="mb-3">
            <label class="form-label pe-label">Email</label>
            <input v-model="profile.email" type="email" class="form-control pe-input" placeholder="seu@email.com" />
          </div>
          <button class="btn pe-btn-primary w-100" type="submit" :disabled="saving">
            <span v-if="saving" class="spinner-border spinner-border-sm me-1"></span>Salvar alterações
          </button>
        </form>
      </div>
    </div>

    <nav class="pe-bottom-nav d-lg-none">
      <button :class="{ active: navActive('/profile') }" class="pe-nav-item" @click.prevent="goProfile">
        <i class="bi bi-person pe-nav-icon"></i><div class="pe-nav-label">Perfil</div>
      </button>
      <button :class="{ active: navActive('/history') }" class="pe-nav-item" @click.prevent="goHistory">
        <i class="bi bi-journal-text pe-nav-icon"></i><div class="pe-nav-label">Histórico</div>
      </button>
      <button :class="{ active: navActive('/menu') }" class="pe-nav-item" @click.prevent="goMenu">
        <i class="bi bi-grid pe-nav-icon"></i><div class="pe-nav-label">Cardápio</div>
      </button>
    </nav>
  </div>
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
    const key = `public_customer_${companyId}`
    const raw = localStorage.getItem(key)
    if (raw) { profile.value = JSON.parse(raw); return }
    const { data } = await api.get(`/public/${companyId}/profile`)
    if (data && data.profile) { profile.value = data.profile; localStorage.setItem(key, JSON.stringify(data.profile)) }
  } catch (e) { console.warn('load profile failed', e?.message || e) }
  finally { loading.value = false }
}

async function save() {
  saving.value = true
  try {
    await api.post(`/public/${companyId}/profile`, profile.value)
    localStorage.setItem(`public_customer_${companyId}`, JSON.stringify(profile.value))
    goProfile()
  } catch (e) { console.error(e); alert('Erro ao salvar') }
  finally { saving.value = false }
}

onMounted(load)

function _publicNavigate(pathSuffix){
  try{ const base = `/public/${route.params.companyId || companyId}`; const q = Object.assign({}, route.query || {}); Object.keys(q).forEach(k => { if (q[k] === undefined) delete q[k] }); router.push({ path: `${base}${pathSuffix || ''}`, query: q }) }catch(e){}
}
function goProfile(){ _publicNavigate('/profile') }
function goHistory(){ _publicNavigate('/history') }
function goMenu(){ _publicNavigate('/menu') }
function navActive(suffix){ try{ return (route.path || '').endsWith(suffix) }catch(e){ return false } }
</script>

<style scoped>
.pe-page {
  --pe-bg: #FFF8F0;
  --pe-surface: #FFFFFF;
  --pe-surface-alt: #FBF3E8;
  --pe-border: #F0E6D2;
  --pe-text: #1A1410;
  --pe-muted: #7A6E62;
  --pe-brand: #2E7D32;
  --pe-brand-light: #E8F5E9;
  font-family: 'Inter', -apple-system, system-ui, sans-serif;
  background: var(--pe-bg);
  min-height: 100vh;
  color: var(--pe-text);
  padding-bottom: 80px;
}
.pe-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 20px; background: var(--pe-surface);
  border-bottom: 1px solid var(--pe-border);
  position: sticky; top: 0; z-index: 10;
}
.pe-back {
  all: unset; cursor: pointer; width: 34px; height: 34px; border-radius: 50%;
  background: var(--pe-surface-alt); display: flex; align-items: center; justify-content: center;
  font-size: 14px; color: var(--pe-text);
}
.pe-back:hover { background: var(--pe-border); }
.pe-body { max-width: 520px; margin: 0 auto; padding: 20px 16px; }

.pe-card {
  background: var(--pe-surface); border: 1px solid var(--pe-border);
  border-radius: 16px; padding: 24px;
}
.pe-section-header {
  display: flex; align-items: center; gap: 12px;
  padding-bottom: 16px; border-bottom: 1px solid var(--pe-border);
}
.pe-avatar {
  width: 44px; height: 44px; border-radius: 50%;
  background: var(--pe-brand-light); color: var(--pe-brand);
  display: flex; align-items: center; justify-content: center; font-size: 20px; flex-shrink: 0;
}

.pe-label { font-size: 13px; font-weight: 600; color: var(--pe-text); margin-bottom: 4px; }
.pe-input {
  border: 1px solid var(--pe-border) !important; border-radius: 12px !important;
  background: var(--pe-surface) !important; color: var(--pe-text) !important;
  padding: 10px 14px !important;
}
.pe-input:focus { border-color: var(--pe-brand) !important; box-shadow: 0 0 0 3px rgba(46,125,50,0.1) !important; }

.pe-btn-primary {
  background: var(--pe-brand); color: #fff; border: none; border-radius: 12px;
  font-weight: 700; font-size: 15px; padding: 14px;
}
.pe-btn-primary:hover { background: #256029; color: #fff; }
.pe-btn-primary:disabled { opacity: 0.5; }

.pe-bottom-nav {
  display: flex; position: fixed; left: 0; right: 0; bottom: 0; height: 64px;
  background: var(--pe-surface); border-top: 1px solid var(--pe-border);
  z-index: 10800; align-items: center; justify-content: space-around;
}
.pe-nav-item {
  all: unset; cursor: pointer; display: flex; flex-direction: column;
  align-items: center; gap: 4px; padding: 6px 12px; color: var(--pe-muted);
}
.pe-nav-icon { font-size: 20px; line-height: 1; }
.pe-nav-label { font-size: 11px; }
.pe-nav-item.active, .pe-nav-item.active .pe-nav-label, .pe-nav-item.active .pe-nav-icon {
  color: var(--pe-brand) !important; font-weight: 700;
}

@media (max-width: 576px) {
  .pe-body { padding: 16px 12px; }
  .pe-card { padding: 18px; }
}
</style>
