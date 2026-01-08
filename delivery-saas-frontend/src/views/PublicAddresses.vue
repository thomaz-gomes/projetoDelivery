<template>
    <div class="public-container">
        <div class="list-card container py-4 list-card--card-style">
            <div class="card">
                <div class="card-body">
                    <div class="row mb-3">
                        <div class="col-8">
                                 <h4 class="mb-0"><i class="bi bi-person nav-icon me-2"></i> Meus endereços</h4>
                        </div>
                        <div class="col-4">
                            <button class="btn btn-outline-primary w-100" @click="newAddress">Novo</button>
                        </div>
                    </div>
               
                    
                    <div v-if="showForm">
                      <h5>{{ editing.id ? 'Editar endereço' : 'Adicionar endereço' }}</h5>
                      <div class="mb-3" ref="formRef">
                      <form @submit.prevent="save">
                        <div class="mb-2"><input v-model="editing.label" class="form-control" placeholder="Rótulo (ex: Casa)"/></div>
                        <div class="mb-2"><input v-model="editing.street" class="form-control" placeholder="Rua"/></div>
                        <div class="mb-2"><input v-model="editing.number" class="form-control" placeholder="Número"/></div>
                        <div class="mb-2"><input v-model="editing.complement" class="form-control" placeholder="Complemento"/></div>
                        <div class="mb-2">
                          <label class="form-label small">Bairro</label>
                          <select v-model="editing.neighborhood" class="form-select">
                            <option value="">Selecione o bairro</option>
                            <option v-for="b in neighborhoods" :key="b.id" :value="b.name">{{ b.name }}</option>
                          </select>
                        </div>
                        <div class="mb-2"><input v-model="editing.reference" class="form-control" placeholder="Referência (pontos de referência)"/></div>
                        <div class="mb-2"><input v-model="editing.observation" class="form-control" placeholder="Observação (ex: tocar campainha)"/></div>
                        <button class="btn btn-primary" :disabled="saving">Salvar</button>
                        <button class="btn btn-secondary ms-2" type="button" @click="cancelEdit">Cancelar</button>
                      </form>
                      </div>
                    </div>
                     <div v-if="loading">Carregando...</div>
                        <div v-else>
                        <ul class="list-group mb-3">
                            <li v-for="addr in addresses" :key="addr.id" class="list-group-item d-flex justify-content-between align-items-start">
                            <div>
                                <div class="fw-bold">{{ addr.label || addr.street }}</div>
                                <div>{{ addr.street }}, {{ addr.number }} {{ addr.complement || '' }}</div>
                                <div>{{ addr.neighborhood || '' }}</div>
                                <div v-if="addr.reference" class="small text-muted">Ref.: {{ addr.reference }}</div>
                                <div v-if="addr.observation" class="small text-muted">Obs.: {{ addr.observation }}</div>
                            </div>
                            <div>
                                <button class="btn btn-sm btn-outline-primary me-2" @click="edit(addr)">Editar</button>
                                <button class="btn btn-sm btn-outline-danger" @click="remove(addr)">Excluir</button>
                            </div>
                            </li>
                        </ul>
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
    try{
      const raw = localStorage.getItem(LOCAL_KEY)
      addresses.value = raw ? JSON.parse(raw) : []
    }catch(err){ addresses.value = [] }
  } finally {
    loading.value = false
  }
}

function edit(addr) { editing.value = Object.assign({}, addr); showForm.value = true; nextTick(()=>{ try{ formRef.value?.scrollIntoView({ behavior: 'smooth', block: 'center' }) }catch(e){} }) }
function cancelEdit() { editing.value = {}; showForm.value = false }

async function save() {
  saving.value = true
  try {
    // if this is a local-only id, update localStorage
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
              // Use returned created address to update local state immediately
              try{
                const created = res.data
                const normalized = {
                  id: created.id || String(Date.now()) + '-' + Math.random().toString(36).slice(2,8),
                  label: created.label || created.formatted || created.street || '',
                  formattedAddress: created.formatted || created.formattedAddress || ((created.street ? (created.street + (created.number ? (', ' + created.number) : '')) : '')),
                  neighborhood: created.neighborhood || '',
                  reference: created.reference || '',
                  observation: created.observation || '',
                }
                const idx = addresses.value.findIndex(a => String(a.id) === String(normalized.id))
                if(idx === -1) addresses.value.unshift(normalized)
                else addresses.value.splice(idx, 1, normalized)
                try{ localStorage.setItem(LOCAL_KEY, JSON.stringify(addresses.value)) }catch(e){}
                // notify other components (PublicMenu) that addresses changed
                try{ window.dispatchEvent(new CustomEvent('app:addresses-updated', { detail: { addresses: addresses.value } })) }catch(e){}
              }catch(e){}
              editing.value = {}
              showForm.value = false
              saving.value = false
              return
            }
        }
        await load()
        editing.value = {}
        showForm.value = false
      } catch (err) {
        if (err?.response?.status === 404) {
          // backend not implemented for addresses; persist locally
          if (!editing.value.id) editing.value.id = `local-${Date.now()}-${Math.random().toString(36).slice(2,6)}`
          const idx = addresses.value.findIndex(a => a.id === editing.value.id)
          if (idx !== -1) addresses.value.splice(idx, 1, Object.assign({}, editing.value))
          else addresses.value.push(Object.assign({}, editing.value))
          try{ localStorage.setItem(LOCAL_KEY, JSON.stringify(addresses.value)) }catch{}
          editing.value = {}
          showForm.value = false
        } else {
          throw err
        }
      }
    }
  } catch (e) {
    console.error(e)
    alert('Erro ao salvar')
  } finally {
    saving.value = false
  }
}

async function remove(addr) {
  if (!confirm('Excluir este endereço?')) return
  try {
    try{
      await api.delete(`/public/${companyId}/addresses/${addr.id}`)
      await load()
    }catch(err){
      if (err?.response?.status === 404) {
        addresses.value = addresses.value.filter(a => a.id !== addr.id)
        try{ localStorage.setItem(LOCAL_KEY, JSON.stringify(addresses.value)) }catch{}
      } else {
        throw err
      }
    }
  } catch (e) {
    console.error(e)
    alert('Erro ao excluir')
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