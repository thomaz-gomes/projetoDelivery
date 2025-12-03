<template>
  <div>
    <ListCard title="Cardápios" icon="bi bi-list-ul" :subtitle="menus.length ? `${menus.length} itens` : ''">
      <template #actions>
        <div class="d-flex" style="gap:8px">
          <button class="btn btn-primary" @click="goNew"><i class="bi bi-plus-lg me-1"></i> Novo cardápio</button>
          <button class="btn btn-outline-secondary" @click="goOptions"><i class="bi bi-list-check me-1"></i> Opções</button>
        </div>
      </template>

      <template #filters>
        <div class="row g-2">
          <div class="col-md-6">
            <input class="form-control" v-model="search" placeholder="Buscar menu por nome" @keyup.enter="load" />
          </div>
          <div class="col-md-6 d-flex justify-content-end align-items-start">
            <button class="btn btn-outline-secondary" @click="resetFilters">Limpar</button>
          </div>
        </div>
      </template>

      <template #default>
        <div v-if="loading" class="text-center py-4">Carregando...</div>
        <div v-else-if="error" class="alert alert-danger">{{ error }}</div>
        <div v-else>
          <div v-if="menus.length === 0" class="alert alert-info">Nenhum cardápio criado</div>
          <div v-else class="table-responsive">
            <table class="table table-striped align-middle">
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Loja</th>
                  <th>Public</th>
                  <th style="width:120px">Ações</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="m in filtered" :key="m.id">
                  <td>
                    <div><strong><a role="button" class="text-white" @click.prevent="openMenuAdmin(m)">{{ m.name }}</a></strong></div>
                    <div class="desc small text-muted">{{ m.description || '' }}</div>
                  </td>
                  <td>{{ m.storeId ? (storesMap[m.storeId]?.name || m.storeId) : 'Nenhuma' }}</td>
                  <td><span class="text-monospace">/public/{{ (storesMap[m.storeId] && slugify(storesMap[m.storeId].name)) || companyId }}</span></td>
                  <td>
                    <div class="d-flex align-items-center">
                      <div class="form-check form-switch me-2">
                        <input
                          class="form-check-input"
                          type="checkbox"
                          :id="'menu-active-'+m.id"
                          :checked="m.isActive !== false"
                          :disabled="togglingMenus.includes(m.id)"
                          @change.stop.prevent="toggleMenuActive(m)"
                        />
                      </div>

                      <button class="btn btn-sm btn-light me-2" @click="edit(m)" title="Editar"><i class="bi bi-pencil-square"></i></button>

                      <button class="btn btn-sm btn-outline-primary me-2" @click="openMenuAdmin(m)" title="Editar estrutura deste cardápio"><i class="bi bi-box-seam"></i></button>

                      <button class="btn btn-sm btn-outline-secondary me-2" @click="copyPublicLink(m)" title="Copiar link público"><i class="bi bi-link-45deg"></i></button>

                      <button class="btn btn-sm btn-outline-danger" @click="remove(m)" title="Remover"><i class="bi bi-trash"></i></button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="d-flex align-items-center justify-content-between mt-3">
            <div><small>Mostrando {{ filtered.length }} de {{ menus.length }}</small></div>
            <div></div>
          </div>
        </div>
      </template>
    </ListCard>

    <!-- Edit inline removed: use separate edit screen -->
  </div>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue'
import api from '../api'
import { useRoute, useRouter } from 'vue-router'
import ListCard from '@/components/ListCard.vue'
import { bindLoading } from '../state/globalLoading.js'
import Swal from 'sweetalert2'

const route = useRoute()
const router = useRouter()
const companyId = localStorage.getItem('companyId') || ''

const loading = ref(false)
bindLoading(loading)
const error = ref('')

const menus = ref([])
const stores = ref([])
const storesMap = {}
const search = ref('')
const togglingMenus = ref([])

const filtered = computed(() => {
  const q = (search.value || '').toLowerCase().trim()
  if (!q) return menus.value
  return menus.value.filter(m => (m.name || '').toLowerCase().includes(q))
})

async function load(){
  loading.value = true
  try{
    error.value = ''
    const res = await api.get('/menu/menus')
    menus.value = res.data || []
    const st = await api.get('/stores')
    stores.value = st.data || []
    // build a simple map for display
    stores.value.forEach(s => storesMap[s.id] = s)
    // nothing else to load
  }catch(e){ console.error(e); error.value = e.response?.data?.message || 'Erro ao carregar cardápios' }finally{ loading.value = false }
}

function goNew(){ router.push({ path: '/menu/menus/new' }) }
function edit(m){ router.push({ path: `/menu/menus/${m.id}` }) }

function openProductNew(m){ router.push({ path: '/menu/products/new', query: { menuId: m.id } }) }
function openMenuAdmin(m){ router.push({ path: '/menu/admin', query: { menuId: m.id } }) }

function goOptions(){ router.push({ path: '/menu/options' }) }

function openOptions(m){
  const q = {}
  if(m && m.id) q.menuId = m.id
  router.push({ path: '/menu/options', query: q })
}

async function toggleMenuActive(m){
  if(!m || !m.id) return
  // optimistic toggle
  const prev = m.isActive === undefined ? true : m.isActive
  const newVal = !prev
  togglingMenus.value.push(m.id)
  try{
    // update UI immediately
    m.isActive = newVal
    await api.patch(`/menu/menus/${m.id}`, { isActive: newVal })
    Swal.fire({ toast:true, position:'top-end', showConfirmButton:false, timer:1200, icon:'success', title: newVal ? 'Cardápio aberto' : 'Cardápio fechado' })
  }catch(e){
    console.error('Failed to toggle menu active', e)
    // revert
    m.isActive = prev
    Swal.fire({ icon: 'error', text: e.response?.data?.message || 'Falha ao atualizar status' })
  }finally{
    togglingMenus.value = togglingMenus.value.filter(id => id !== m.id)
  }
}

function copyPublicLink(m){
  try{
    // prefer menu slug when available, then store slug, then fallback to companyId
    const store = storesMap[m.storeId]
    const slug = m && m.slug ? m.slug : (store ? (store.slug || slugify(store.name || String(store.id))) : companyId)
    const link = `${window.location.origin}/public/${slug}`
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(link)
      Swal.fire({ toast:true, position:'top-end', showConfirmButton:false, timer:1200, icon:'success', title: 'Link copiado' })
    }else{
      // fallback
      const ta = document.createElement('textarea'); ta.value = link; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove()
      Swal.fire({ toast:true, position:'top-end', showConfirmButton:false, timer:1200, icon:'success', title: 'Link copiado' })
    }
  }catch(e){ console.error('copy failed', e); Swal.fire({ icon:'error', text: 'Falha ao copiar link' }) }
}

function slugify(s){
  try{
    return String(s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
  }catch(e){ return String(s || '') }
}

async function remove(m){
  const r = await Swal.fire({ title: 'Remover cardápio?', text: `Remover cardápio ${m.name}?`, icon: 'warning', showCancelButton: true, confirmButtonText: 'Remover', cancelButtonText: 'Cancelar' })
  if(!r.isConfirmed) return
  try{
    await api.delete(`/menu/menus/${m.id}`)
    await load()
    Swal.fire({ icon: 'success', text: 'Cardápio removido' })
  }catch(e){ console.error(e); Swal.fire({ icon: 'error', text: e.response?.data?.message || 'Falha ao remover' }) }
}

function resetFilters(){ search.value = ''; load() }

onMounted(load)
</script>

<style scoped>
.text-monospace { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, 'Roboto Mono', 'Courier New', monospace; }
</style>
