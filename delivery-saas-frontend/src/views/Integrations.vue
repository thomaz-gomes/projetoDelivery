<script setup>
import { onMounted, ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import api from '../api';
import ListCard from '../components/ListCard.vue';
import { formatDateTime } from '../utils/dates.js';
import Swal from 'sweetalert2'

const router = useRouter();

const loading = ref(false)
const error = ref('')

// filters & pagination
const q = ref('')
const filterEnabled = ref('')
const limit = ref(20)
const offset = ref(0)
const total = ref(0)

const integrations = ref([])
const metaPixels = ref([])
const stores = ref([])
const menus = ref([])

// modal for choosing integration type
const showTypeModal = ref(false)

const integrationTypes = [
  {
    key: 'IFOOD',
    name: 'iFood',
    description: 'Receba pedidos do iFood automaticamente na sua central.',
    icon: 'https://logodownload.org/wp-content/uploads/2017/05/ifood-logo-0.png',
    iconType: 'img',
    route: '/settings/ifood',
  },
  {
    key: 'META_PIXEL',
    name: 'Meta Pixel (Facebook)',
    description: 'Rastreie eventos de conversão no seu cardápio online para otimizar campanhas.',
    iconType: 'svg',
    route: '/settings/meta-pixel',
  },
]

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [{ data: ints }, { data: sts }, { data: mns }] = await Promise.all([
      api.get('/integrations'),
      api.get('/stores'),
      api.get('/menu/menus'),
    ])
    integrations.value = ints || []
    stores.value = sts || []
    menus.value = mns || []
    try {
      const { data: pxs } = await api.get('/meta-pixel')
      metaPixels.value = pxs || []
    } catch (e) { metaPixels.value = [] }
    total.value = allItems.value.length
  } catch (e) {
    console.error(e);
    error.value = 'Falha ao carregar integrações';
  } finally {
    loading.value = false
  }
}

function goNew() {
  showTypeModal.value = true
}

function selectType(type) {
  showTypeModal.value = false
  router.push(type.route)
}

function goEdit(item) {
  if (item._type === 'META_PIXEL') {
    router.push('/settings/meta-pixel')
  } else {
    router.push('/settings/ifood')
  }
}

const remove = async (it) => {
  if (it._type === 'META_PIXEL') {
    const res = await Swal.fire({ title: 'Remover Meta Pixel?', text: `Remover pixel do cardápio ${menuName(it.menuId)}?`, icon: 'warning', showCancelButton: true, confirmButtonText: 'Remover', cancelButtonText: 'Cancelar' })
    if(!res.isConfirmed) return
    try{ await api.delete(`/meta-pixel/${it.id}`); await load(); Swal.fire({ icon:'success', text:'Pixel removido' }) }catch(e){ console.error(e); Swal.fire({ icon:'error', text: e.response?.data?.message || 'Erro ao remover' }) }
  } else {
    const res = await Swal.fire({ title: 'Remover integração?', text: `Remover ${it.provider} vinculado à loja ${storeName(it.storeId)}?`, icon: 'warning', showCancelButton: true, confirmButtonText: 'Remover', cancelButtonText: 'Cancelar' })
    if(!res.isConfirmed) return
    try{ await api.delete(`/integrations/${it.id}`); await load(); Swal.fire({ icon:'success', text:'Integração removida' }) }catch(e){ console.error(e); Swal.fire({ icon:'error', text: e.response?.data?.message || 'Erro ao remover' }) }
  }
}

const resetFilters = () => { q.value=''; filterEnabled.value=''; offset.value=0; load() }
const nextPage = () => { if(offset.value + limit.value < total.value) { offset.value += limit.value } }
const prevPage = () => { offset.value = Math.max(0, offset.value - limit.value) }

const allItems = computed(() => {
  const apiInts = (integrations.value || []).map(i => ({ ...i, _type: 'API', _label: i.provider || 'API', _sublabel: storeName(i.storeId) }))
  const pxInts = (metaPixels.value || []).map(p => ({ ...p, _type: 'META_PIXEL', _label: 'Meta Pixel', _sublabel: menuName(p.menuId), enabled: p.enabled }))
  return [...apiInts, ...pxInts]
})

const displayed = computed(() => {
  let list = allItems.value
  if(q.value) list = list.filter(i => (i._label||'').toLowerCase().includes(q.value.toLowerCase()) || (i._sublabel||'').toLowerCase().includes(q.value.toLowerCase()))
  if(filterEnabled.value !== '') list = list.filter(i => String(!!i.enabled) === String(filterEnabled.value))
  total.value = list.length
  return list.slice(offset.value, offset.value + limit.value)
})

function storeName(id){
  if(!id) return '-'
  const s = stores.value.find(x => x.id === id)
  return s ? s.name : id
}

function menuName(id){
  if(!id) return '-'
  const m = menus.value.find(x => x.id === id)
  if (!m) return id
  const store = stores.value.find(s => s.id === m.storeId)
  return m.name + (store ? ` (${store.name})` : '')
}

onMounted(()=> load())

</script>

<template>
  <ListCard title="Integrações" icon="bi bi-plug" :subtitle="total ? `${total} itens` : ''">
    <template #actions>
      <button class="btn btn-primary" @click="goNew"><i class="bi bi-plus-lg me-1"></i> Nova integração</button>
    </template>

    <template #filters>
      <div class="filters row g-2">
        <div class="col-md-4">
          <TextInput v-model="q" placeholder="Buscar por tipo ou loja..." inputClass="form-control" />
        </div>
        <div class="col-md-3">
          <SelectInput  class="form-select"  v-model="filterEnabled"  @change="load">
            <option value="">Todos</option>
            <option value="true">Ativos</option>
            <option value="false">Inativos</option>
          </SelectInput>
        </div>
        <div class="col-md-2 d-flex align-items-center">
          <button class="btn btn-outline-secondary w-100" @click="resetFilters">Limpar</button>
        </div>
      </div>
    </template>

    <template #default>
      <div v-if="loading" class="text-center py-4">Carregando...</div>
      <div v-else-if="error" class="alert alert-danger">{{ error }}</div>
      <div v-else>
        <div class="table-responsive">
          <table class="table table-striped align-middle">
            <thead>
              <tr>
                <th>Tipo</th>
                <th>Vinculado a</th>
                <th>Ativo</th>
                <th>Criado</th>
                <th style="width:160px">Ações</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="it in displayed" :key="it.id">
                <td>
                  <div class="d-flex align-items-center gap-2">
                    <img v-if="it._type === 'API' && (it.provider||'').toUpperCase() === 'IFOOD'" src="https://logodownload.org/wp-content/uploads/2017/05/ifood-logo-0.png" alt="iFood" style="height:20px" />
                    <svg v-else-if="it._type === 'META_PIXEL'" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="#1877F2"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
                    <i v-else class="bi bi-plug"></i>
                    <strong>{{ it._label }}</strong>
                  </div>
                  <div v-if="it._type === 'META_PIXEL'" class="small text-muted">Pixel ID: {{ it.pixelId }}</div>
                  <div v-else class="small text-muted">ClientId: {{ it.clientId ? '●●●' : '-' }}</div>
                </td>
                <td>{{ it._sublabel }}</td>
                <td>
                  <span :class="['badge', it.enabled ? 'bg-success' : 'bg-secondary']">{{ it.enabled ? 'Sim' : 'Não' }}</span>
                </td>
                <td>{{ it.createdAt ? formatDateTime(it.createdAt) : '-' }}</td>
                <td>
                  <div class="d-flex">
                    <button class="btn btn-sm btn-outline-secondary me-2" @click="goEdit(it)" title="Editar"><i class="bi bi-pencil-square"></i></button>
                    <button class="btn btn-sm btn-outline-danger" @click="remove(it)" title="Remover"><i class="bi bi-trash"></i></button>
                  </div>
                </td>
              </tr>
              <tr v-if="total === 0">
                <td colspan="5" class="text-center text-secondary py-4">Nenhuma integração encontrada.</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="d-flex align-items-center justify-content-between mt-3">
          <div>
            <small>Mostrando {{ Math.min(offset + 1, total) }} - {{ Math.min(offset + limit, total) }} de {{ total }}</small>
          </div>
          <div>
            <button class="btn btn-sm btn-outline-secondary me-2" @click="prevPage" :disabled="offset===0">Anterior</button>
            <button class="btn btn-sm btn-secondary" @click="nextPage" :disabled="offset+limit >= total">Próxima</button>
          </div>
        </div>
      </div>
    </template>
  </ListCard>

  <!-- Modal: choose integration type -->
  <div v-if="showTypeModal" class="modal-backdrop-custom" @click.self="showTypeModal = false">
    <div class="type-modal-card">
      <div class="d-flex justify-content-between align-items-center mb-3">
        <h5 class="mb-0">Escolha o tipo de integração</h5>
        <button class="btn-close" @click="showTypeModal = false"></button>
      </div>
      <div class="row g-3">
        <div v-for="t in integrationTypes" :key="t.key" class="col-12 col-sm-6">
          <div class="type-option-card" @click="selectType(t)">
            <div class="d-flex align-items-center gap-3 mb-2">
              <img v-if="t.iconType === 'img'" :src="t.icon" :alt="t.name" style="height:32px" />
              <svg v-else xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="#1877F2"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
              <strong>{{ t.name }}</strong>
            </div>
            <p class="small text-muted mb-0">{{ t.description }}</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-backdrop-custom {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1050;
}
.type-modal-card {
  background: #fff;
  border-radius: 12px;
  padding: 24px;
  max-width: 520px;
  width: 90%;
  box-shadow: 0 8px 32px rgba(0,0,0,0.2);
}
.type-option-card {
  border: 2px solid #e9ecef;
  border-radius: 10px;
  padding: 16px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.type-option-card:hover {
  border-color: #0d6efd;
  background: #f8f9ff;
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(13,110,253,0.15);
}
</style>
