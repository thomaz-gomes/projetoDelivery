<template>
  <div class="pa-page">
    <div class="pa-header">
      <h5 class="m-0 fw-bold">Meus endereços</h5>
      <button class="pa-close" @click="goProfile" aria-label="Voltar"><i class="bi bi-arrow-left"></i></button>
    </div>

    <div class="pa-body">
      <!-- Add/Edit form -->
      <div v-if="showForm" class="pa-card mb-3">
        <div class="pa-section-title">{{ editing.id ? 'EDITAR ENDEREÇO' : 'NOVO ENDEREÇO' }}</div>
        <form @submit.prevent="save" ref="formRef">
          <div class="mb-3">
            <label class="form-label pa-label">Rótulo</label>
            <input v-model="editing.label" class="form-control pa-input" placeholder="Ex: Casa, Trabalho" />
          </div>
          <div class="row mb-3">
            <div class="col-8">
              <label class="form-label pa-label">Rua</label>
              <input v-model="editing.street" class="form-control pa-input" placeholder="Rua, Avenida..." />
            </div>
            <div class="col-4">
              <label class="form-label pa-label">Número</label>
              <input v-model="editing.number" class="form-control pa-input" placeholder="Nº" />
            </div>
          </div>
          <div class="mb-3">
            <label class="form-label pa-label">Complemento</label>
            <input v-model="editing.complement" class="form-control pa-input" placeholder="Apto, bloco..." />
          </div>
          <div class="mb-3">
            <label class="form-label pa-label">Bairro</label>
            <select v-model="editing.neighborhood" class="form-select pa-input">
              <option value="">Selecione o bairro</option>
              <option v-for="b in neighborhoods" :key="b.id" :value="b.name">{{ b.name }}</option>
            </select>
          </div>
          <div class="mb-3">
            <label class="form-label pa-label">Referência</label>
            <input v-model="editing.reference" class="form-control pa-input" placeholder="Próximo ao mercado..." />
          </div>
          <div class="mb-3">
            <label class="form-label pa-label">Observação</label>
            <input v-model="editing.observation" class="form-control pa-input" placeholder="Tocar campainha..." />
          </div>
          <div class="d-flex gap-2">
            <button class="btn pa-btn-primary flex-fill" type="submit" :disabled="saving">
              <span v-if="saving" class="spinner-border spinner-border-sm me-1"></span>Salvar
            </button>
            <button class="btn pa-btn-outline" type="button" @click="cancelEdit">Cancelar</button>
          </div>
        </form>
      </div>

      <!-- Add button -->
      <button v-if="!showForm" class="btn pa-btn-primary w-100 mb-3" @click="newAddress">
        <i class="bi bi-plus-lg me-2"></i>Novo endereço
      </button>

      <!-- Loading -->
      <div v-if="loading" class="text-center py-4">
        <div class="spinner-border" style="color:var(--pa-brand)" role="status"><span class="visually-hidden">Carregando...</span></div>
      </div>

      <!-- Empty -->
      <div v-else-if="addresses.length === 0 && !showForm" class="pa-empty">
        <i class="bi bi-geo-alt"></i>
        <div class="fw-semibold mt-2">Nenhum endereço cadastrado</div>
        <div class="small" style="color:var(--pa-muted)">Adicione um endereço para agilizar seus pedidos</div>
      </div>

      <!-- Address list -->
      <div v-else>
        <div v-for="addr in addresses" :key="addr.id" class="pa-addr-card">
          <div class="d-flex gap-3">
            <div class="pa-addr-icon"><i class="bi bi-geo-alt"></i></div>
            <div class="flex-fill" style="min-width:0">
              <div class="pa-addr-label">{{ addr.label || addr.street || 'Endereço' }}</div>
              <div class="pa-addr-detail">{{ addr.street }}{{ addr.number ? ', ' + addr.number : '' }}{{ addr.complement ? ' · ' + addr.complement : '' }}</div>
              <div v-if="addr.neighborhood" class="pa-addr-detail">{{ addr.neighborhood }}</div>
              <div v-if="addr.reference" class="pa-addr-sub">Ref: {{ addr.reference }}</div>
              <div v-if="addr.observation" class="pa-addr-sub">Obs: {{ addr.observation }}</div>
            </div>
          </div>
          <div class="pa-addr-actions">
            <button class="pa-action-btn" @click="edit(addr)" aria-label="Editar"><i class="bi bi-pencil"></i></button>
            <button class="pa-action-btn danger" @click="remove(addr)" aria-label="Excluir"><i class="bi bi-trash3"></i></button>
          </div>
        </div>
      </div>
    </div>

    <!-- Mobile bottom nav -->
    <nav class="pa-bottom-nav d-lg-none">
      <button :class="{ active: navActive('/profile') }" class="pa-nav-item" @click.prevent="goProfile">
        <i class="bi bi-person pa-nav-icon"></i><div class="pa-nav-label">Perfil</div>
      </button>
      <button :class="{ active: navActive('/history') }" class="pa-nav-item" @click.prevent="goHistory">
        <i class="bi bi-journal-text pa-nav-icon"></i><div class="pa-nav-label">Histórico</div>
      </button>
      <button :class="{ active: navActive('/menu') }" class="pa-nav-item" @click.prevent="goMenu">
        <i class="bi bi-grid pa-nav-icon"></i><div class="pa-nav-label">Cardápio</div>
      </button>
    </nav>
  </div>
</template>

<script setup>
import { ref, onMounted, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import api from '../api'

const route = useRoute()
const router = useRouter()
const companyId = route.params.companyId
const loading = ref(true)
const saving = ref(false)
const addresses = ref([])
const editing = ref({})
const formRef = ref(null)
const LOCAL_KEY = `public_addresses_${companyId}`
const showForm = ref(false)
const neighborhoods = ref([])

function newAddress(){
  editing.value = {}
  showForm.value = true
  nextTick(()=>{ try{ formRef.value?.scrollIntoView({ behavior: 'smooth', block: 'center' }) }catch(e){} })
}

async function load() {
  loading.value = true
  try {
    const [res, nbRes] = await Promise.all([
      api.get(`/public/${companyId}/addresses`),
      api.get(`/public/${companyId}/neighborhoods`).catch(() => ({ data: [] })),
    ])
    const data = res?.data
    if (Array.isArray(data)) addresses.value = data
    else addresses.value = data?.addresses || []
    neighborhoods.value = Array.isArray(nbRes?.data) ? nbRes.data : (nbRes?.data?.neighborhoods || [])
    try{ localStorage.setItem(LOCAL_KEY, JSON.stringify(addresses.value)) }catch{}
  } catch (e) {
    console.warn('load addresses failed, falling back to localStorage', e?.message || e)
    try{ const raw = localStorage.getItem(LOCAL_KEY); addresses.value = raw ? JSON.parse(raw) : [] }catch(err){ addresses.value = [] }
  } finally { loading.value = false }
}

function edit(addr) { editing.value = Object.assign({}, addr); showForm.value = true; nextTick(()=>{ try{ formRef.value?.scrollIntoView({ behavior: 'smooth', block: 'center' }) }catch(e){} }) }
function cancelEdit() { editing.value = {}; showForm.value = false }

async function save() {
  saving.value = true
  try {
    if (editing.value.id && String(editing.value.id).startsWith('local-')){
      const idx = addresses.value.findIndex(a => a.id === editing.value.id)
      if (idx !== -1) addresses.value.splice(idx, 1, Object.assign({}, editing.value))
      else addresses.value.push(Object.assign({}, editing.value))
      try{ localStorage.setItem(LOCAL_KEY, JSON.stringify(addresses.value)) }catch{}
      showForm.value = false
    } else {
      try{
        if (editing.value.id) {
          await api.put(`/public/${companyId}/addresses/${editing.value.id}`, editing.value)
        } else {
          const res = await api.post(`/public/${companyId}/addresses`, editing.value)
          if (res && res.data) {
            try{
              const created = res.data
              const normalized = { id: created.id || String(Date.now()) + '-' + Math.random().toString(36).slice(2,8), label: created.label || created.formatted || created.street || '', street: created.street || '', number: created.number || '', complement: created.complement || '', formattedAddress: created.formatted || created.formattedAddress || '', neighborhood: created.neighborhood || '', reference: created.reference || '', observation: created.observation || '' }
              const idx = addresses.value.findIndex(a => String(a.id) === String(normalized.id))
              if(idx === -1) addresses.value.unshift(normalized)
              else addresses.value.splice(idx, 1, normalized)
              try{ localStorage.setItem(LOCAL_KEY, JSON.stringify(addresses.value)) }catch(e){}
              try{ window.dispatchEvent(new CustomEvent('app:addresses-updated', { detail: { addresses: addresses.value } })) }catch(e){}
            }catch(e){}
            editing.value = {}; showForm.value = false; saving.value = false; return
          }
        }
        await load(); editing.value = {}; showForm.value = false
      } catch (err) {
        if (err?.response?.status === 404) {
          if (!editing.value.id) editing.value.id = `local-${Date.now()}-${Math.random().toString(36).slice(2,6)}`
          const idx = addresses.value.findIndex(a => a.id === editing.value.id)
          if (idx !== -1) addresses.value.splice(idx, 1, Object.assign({}, editing.value))
          else addresses.value.push(Object.assign({}, editing.value))
          try{ localStorage.setItem(LOCAL_KEY, JSON.stringify(addresses.value)) }catch{}
          editing.value = {}; showForm.value = false
        } else { throw err }
      }
    }
  } catch (e) { console.error(e); alert('Erro ao salvar') }
  finally { saving.value = false }
}

async function remove(addr) {
  if (!confirm('Excluir este endereço?')) return
  try {
    try{ await api.delete(`/public/${companyId}/addresses/${addr.id}`); await load() }
    catch(err){
      if (err?.response?.status === 404) { addresses.value = addresses.value.filter(a => a.id !== addr.id); try{ localStorage.setItem(LOCAL_KEY, JSON.stringify(addresses.value)) }catch{} }
      else { throw err }
    }
  } catch (e) { console.error(e); alert('Erro ao excluir') }
}

onMounted(load)

function _publicNavigate(pathSuffix, extraQuery = {}){
  try{ const base = `/public/${route.params.companyId || companyId}`; const mergedQuery = Object.assign({}, route.query || {}, extraQuery || {}); Object.keys(mergedQuery).forEach(k => { if (mergedQuery[k] === undefined) delete mergedQuery[k] }); router.push({ path: `${base}${pathSuffix || ''}`, query: mergedQuery }) }catch(e){ console.warn('_publicNavigate', e) }
}
function goProfile(){ _publicNavigate('/profile') }
function goHistory(){ _publicNavigate('/history') }
function goMenu(){ _publicNavigate('/menu') }
function navActive(suffix){ try{ return (route.path || '').endsWith(suffix) }catch(e){ return false } }
</script>

<style scoped>
.pa-page {
  --pa-bg: #FFF8F0;
  --pa-surface: #FFFFFF;
  --pa-surface-alt: #FBF3E8;
  --pa-border: #F0E6D2;
  --pa-text: #1A1410;
  --pa-muted: #7A6E62;
  --pa-brand: #2E7D32;
  --pa-brand-light: #E8F5E9;
  font-family: 'Inter', -apple-system, system-ui, sans-serif;
  background: var(--pa-bg);
  min-height: 100vh;
  color: var(--pa-text);
  padding-bottom: 80px;
}
.pa-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 20px; background: var(--pa-surface);
  border-bottom: 1px solid var(--pa-border);
  position: sticky; top: 0; z-index: 10;
  flex-direction: row-reverse;
}
.pa-header h5 { flex: 1; text-align: center; }
.pa-close {
  all: unset; cursor: pointer; width: 34px; height: 34px; border-radius: 50%;
  background: var(--pa-surface-alt); display: flex; align-items: center; justify-content: center;
  font-size: 14px; color: var(--pa-text);
}
.pa-close:hover { background: var(--pa-border); }
.pa-body { max-width: 520px; margin: 0 auto; padding: 20px 16px; }

/* Card */
.pa-card {
  background: var(--pa-surface); border: 1px solid var(--pa-border);
  border-radius: 16px; padding: 20px;
}
.pa-section-title {
  font-size: 11px; font-weight: 700; letter-spacing: 0.8px; color: var(--pa-muted);
  margin-bottom: 16px; padding-bottom: 10px; border-bottom: 1px solid var(--pa-border);
}

/* Form */
.pa-label { font-size: 13px; font-weight: 600; color: var(--pa-text); margin-bottom: 4px; }
.pa-input {
  border: 1px solid var(--pa-border) !important; border-radius: 12px !important;
  background: var(--pa-surface) !important; color: var(--pa-text) !important;
  padding: 10px 14px !important;
}
.pa-input:focus { border-color: var(--pa-brand) !important; box-shadow: 0 0 0 3px rgba(46,125,50,0.1) !important; }

/* Buttons */
.pa-btn-primary {
  background: var(--pa-brand); color: #fff; border: none; border-radius: 12px;
  font-weight: 600; font-size: 14px; padding: 12px 20px;
}
.pa-btn-primary:hover { background: #256029; color: #fff; }
.pa-btn-primary:disabled { opacity: 0.5; }
.pa-btn-outline {
  background: transparent; color: var(--pa-text); border: 1px solid var(--pa-border);
  border-radius: 12px; font-weight: 600; font-size: 14px; padding: 12px 20px;
}
.pa-btn-outline:hover { background: var(--pa-surface-alt); color: var(--pa-text); }

/* Empty */
.pa-empty { text-align: center; padding: 40px 16px; color: var(--pa-muted); }
.pa-empty i { font-size: 40px; }

/* Address card */
.pa-addr-card {
  background: var(--pa-surface); border: 1px solid var(--pa-border);
  border-radius: 14px; padding: 16px; margin-bottom: 12px;
}
.pa-addr-icon {
  width: 36px; height: 36px; border-radius: 10px;
  background: var(--pa-surface-alt); display: flex; align-items: center; justify-content: center;
  color: var(--pa-muted); font-size: 16px; flex-shrink: 0;
}
.pa-addr-label { font-size: 14px; font-weight: 700; color: var(--pa-text); }
.pa-addr-detail { font-size: 13px; color: var(--pa-muted); margin-top: 2px; }
.pa-addr-sub { font-size: 12px; color: var(--pa-muted); margin-top: 2px; font-style: italic; }
.pa-addr-actions { display: flex; gap: 8px; margin-top: 12px; justify-content: flex-end; }
.pa-action-btn {
  all: unset; cursor: pointer; width: 34px; height: 34px; border-radius: 10px;
  background: var(--pa-surface-alt); display: flex; align-items: center; justify-content: center;
  font-size: 14px; color: var(--pa-muted); border: 1px solid var(--pa-border); transition: background 0.12s;
}
.pa-action-btn:hover { background: var(--pa-border); }
.pa-action-btn.danger { color: #C62828; border-color: #FFCDD2; }
.pa-action-btn.danger:hover { background: #FFEBEE; }

/* Bottom nav */
.pa-bottom-nav {
  display: flex; position: fixed; left: 0; right: 0; bottom: 0; height: 64px;
  background: var(--pa-surface); border-top: 1px solid var(--pa-border);
  z-index: 10800; align-items: center; justify-content: space-around;
}
.pa-nav-item {
  all: unset; cursor: pointer; display: flex; flex-direction: column;
  align-items: center; gap: 4px; padding: 6px 12px; color: var(--pa-muted);
}
.pa-nav-icon { font-size: 20px; line-height: 1; }
.pa-nav-label { font-size: 11px; }
.pa-nav-item.active, .pa-nav-item.active .pa-nav-label, .pa-nav-item.active .pa-nav-icon {
  color: var(--pa-brand) !important; font-weight: 700;
}

@media (max-width: 576px) {
  .pa-body { padding: 16px 12px; }
  .pa-card { padding: 16px; }
}
</style>
