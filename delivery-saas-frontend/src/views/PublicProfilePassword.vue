<template>
  <div class="pw-page">
    <div class="pw-header">
      <button class="pw-back" @click="goProfile" aria-label="Voltar"><i class="bi bi-arrow-left"></i></button>
      <h5 class="m-0 fw-bold flex-fill text-center">Alterar senha</h5>
      <div style="width:34px"></div>
    </div>

    <div class="pw-body">
      <div class="pw-card">
        <div class="pw-section-header mb-3">
          <div class="pw-avatar"><i class="bi bi-lock"></i></div>
          <div>
            <div class="fw-bold">Segurança</div>
            <div class="small" style="color:var(--pw-muted)">Altere sua senha de acesso</div>
          </div>
        </div>

        <form @submit.prevent="change">
          <div class="mb-3">
            <label class="form-label pw-label">Senha atual</label>
            <input v-model="currentPassword" type="password" class="form-control pw-input" autocomplete="current-password" />
          </div>
          <div class="mb-3">
            <label class="form-label pw-label">Nova senha</label>
            <input v-model="newPassword" type="password" class="form-control pw-input" autocomplete="new-password" />
          </div>
          <div class="mb-3">
            <label class="form-label pw-label">Confirme a nova senha</label>
            <input v-model="confirmPassword" type="password" class="form-control pw-input" autocomplete="new-password" />
            <div v-if="confirmPassword && confirmPassword !== newPassword" class="small mt-1" style="color:#C62828">As senhas não coincidem</div>
            <div v-else-if="confirmPassword && confirmPassword === newPassword" class="small mt-1" style="color:var(--pw-brand)"><i class="bi bi-check-circle me-1"></i>Senhas conferem</div>
          </div>
          <button class="btn pw-btn-primary w-100" type="submit" :disabled="saving || !currentPassword || !newPassword || newPassword !== confirmPassword">
            <span v-if="saving" class="spinner-border spinner-border-sm me-1"></span>Alterar senha
          </button>
        </form>
      </div>
    </div>

    <nav class="pw-bottom-nav d-lg-none">
      <button :class="{ active: navActive('/profile') }" class="pw-nav-item" @click.prevent="goProfile">
        <i class="bi bi-person pw-nav-icon"></i><div class="pw-nav-label">Perfil</div>
      </button>
      <button :class="{ active: navActive('/history') }" class="pw-nav-item" @click.prevent="goHistory">
        <i class="bi bi-journal-text pw-nav-icon"></i><div class="pw-nav-label">Histórico</div>
      </button>
      <button :class="{ active: navActive('/menu') }" class="pw-nav-item" @click.prevent="goMenu">
        <i class="bi bi-grid pw-nav-icon"></i><div class="pw-nav-label">Cardápio</div>
      </button>
    </nav>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import api from '../api'
import Swal from 'sweetalert2'

const route = useRoute()
const router = useRouter()
const companyId = route.params.companyId
const currentPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const saving = ref(false)

async function change() {
  if (newPassword.value !== confirmPassword.value) { Swal.fire({ icon: 'warning', text: 'As senhas não coincidem' }); return }
  saving.value = true
  try {
    await api.post(`/public/${companyId}/profile/password`, { currentPassword: currentPassword.value, newPassword: newPassword.value })
    Swal.fire({ icon: 'success', text: 'Senha alterada com sucesso', timer: 1500, showConfirmButton: false })
    currentPassword.value = ''; newPassword.value = ''; confirmPassword.value = ''
  } catch (e) {
    console.error(e)
    Swal.fire({ icon: 'error', text: e?.response?.data?.message || 'Erro ao alterar senha' })
  } finally { saving.value = false }
}

function _publicNavigate(pathSuffix){
  try{ const base = `/public/${route.params.companyId || companyId}`; const q = Object.assign({}, route.query || {}); Object.keys(q).forEach(k => { if (q[k] === undefined) delete q[k] }); router.push({ path: `${base}${pathSuffix || ''}`, query: q }) }catch(e){}
}
function goProfile(){ _publicNavigate('/profile') }
function goHistory(){ _publicNavigate('/history') }
function goMenu(){ _publicNavigate('/menu') }
function navActive(suffix){ try{ return (route.path || '').endsWith(suffix) }catch(e){ return false } }
</script>

<style scoped>
.pw-page {
  --pw-bg: #FFF8F0; --pw-surface: #FFFFFF; --pw-surface-alt: #FBF3E8;
  --pw-border: #F0E6D2; --pw-text: #1A1410; --pw-muted: #7A6E62;
  --pw-brand: #2E7D32; --pw-brand-light: #E8F5E9;
  font-family: 'Inter', -apple-system, system-ui, sans-serif;
  background: var(--pw-bg); min-height: 100vh; color: var(--pw-text); padding-bottom: 80px;
}
.pw-header {
  display: flex; align-items: center; padding: 16px 20px;
  background: var(--pw-surface); border-bottom: 1px solid var(--pw-border);
  position: sticky; top: 0; z-index: 10;
}
.pw-back {
  all: unset; cursor: pointer; width: 34px; height: 34px; border-radius: 50%;
  background: var(--pw-surface-alt); display: flex; align-items: center; justify-content: center;
  font-size: 14px; color: var(--pw-text);
}
.pw-back:hover { background: var(--pw-border); }
.pw-body { max-width: 520px; margin: 0 auto; padding: 20px 16px; }
.pw-card {
  background: var(--pw-surface); border: 1px solid var(--pw-border);
  border-radius: 16px; padding: 24px;
}
.pw-section-header {
  display: flex; align-items: center; gap: 12px;
  padding-bottom: 16px; border-bottom: 1px solid var(--pw-border);
}
.pw-avatar {
  width: 44px; height: 44px; border-radius: 50%;
  background: var(--pw-brand-light); color: var(--pw-brand);
  display: flex; align-items: center; justify-content: center; font-size: 20px; flex-shrink: 0;
}
.pw-label { font-size: 13px; font-weight: 600; color: var(--pw-text); margin-bottom: 4px; }
.pw-input {
  border: 1px solid var(--pw-border) !important; border-radius: 12px !important;
  background: var(--pw-surface) !important; color: var(--pw-text) !important; padding: 10px 14px !important;
}
.pw-input:focus { border-color: var(--pw-brand) !important; box-shadow: 0 0 0 3px rgba(46,125,50,0.1) !important; }
.pw-btn-primary {
  background: var(--pw-brand); color: #fff; border: none; border-radius: 12px;
  font-weight: 700; font-size: 15px; padding: 14px;
}
.pw-btn-primary:hover { background: #256029; color: #fff; }
.pw-btn-primary:disabled { opacity: 0.5; }
.pw-bottom-nav {
  display: flex; position: fixed; left: 0; right: 0; bottom: 0; height: 64px;
  background: var(--pw-surface); border-top: 1px solid var(--pw-border);
  z-index: 10800; align-items: center; justify-content: space-around;
}
.pw-nav-item {
  all: unset; cursor: pointer; display: flex; flex-direction: column;
  align-items: center; gap: 4px; padding: 6px 12px; color: var(--pw-muted);
}
.pw-nav-icon { font-size: 20px; line-height: 1; }
.pw-nav-label { font-size: 11px; }
.pw-nav-item.active, .pw-nav-item.active .pw-nav-label, .pw-nav-item.active .pw-nav-icon {
  color: var(--pw-brand) !important; font-weight: 700;
}
@media (max-width: 576px) { .pw-body { padding: 16px 12px; } .pw-card { padding: 18px; } }
</style>
