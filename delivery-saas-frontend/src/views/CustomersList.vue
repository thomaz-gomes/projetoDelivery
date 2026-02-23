<script setup>
import { ref, onMounted, computed } from 'vue';
import { useCustomersStore } from '../stores/customers';
import { useRouter } from 'vue-router';
import { formatCurrency, formatDate } from '../utils/formatters.js';
import BaseButton from '../components/BaseButton.vue';
import ListCard from '../components/ListCard.vue';
import api from '../api';
import Swal from 'sweetalert2'

const store = useCustomersStore();
const router = useRouter();

const q = ref('');
const error = ref('');
const loading = ref(false)

const limit = ref(20)
const offset = ref(0)
const total = ref(0)

const load = async () => {
  loading.value = true
  error.value = ''
  try{
    const token = localStorage.getItem('token')
    if(!token){ router.push({ path: '/login', query: { redirect: '/customers' } }); return }
    await store.fetch()
    let list = store.list || []
    if(q.value) list = list.filter(c => (c.fullName||'').toLowerCase().includes(q.value.toLowerCase()) || (c.whatsapp||'').includes(q.value) || (c.cpf||'').includes(q.value))
    total.value = list.length
  }catch(e){ console.error('Failed to fetch customers', e); error.value = e?.response?.data?.message || 'Falha ao carregar clientes' }
  finally{ loading.value = false }
}

onMounted(()=> load())

function goNew(){ router.push('/customers/new') }
function goProfile(id){ router.push(`/customers/${id}`) }

function onQuickSearch(val){ q.value = val; offset.value = 0; load() }
function onQuickClear(){ resetFilters() }

async function onImport(e){
  const file = e.target.files?.[0]
  if(!file) return
  try{
    const res = await store.importFile(file)
    await load()
    Swal.fire({ icon:'success', text: `Importação: criados ${res.created}, atualizados ${res.updated}.` })
  }catch(e){ console.error(e); Swal.fire({ icon:'error', text: 'Falha ao importar' }) }
}

const resetFilters = () => { q.value=''; offset.value=0; load() }
const nextPage = () => { if(offset.value + limit.value < total.value) offset.value += limit.value }
const prevPage = () => { offset.value = Math.max(0, offset.value - limit.value) }

const displayed = computed(()=>{
  let list = store.list || []
  if(q.value) list = list.filter(c => (c.fullName||'').toLowerCase().includes(q.value.toLowerCase()) || (c.whatsapp||'').includes(q.value) || (c.cpf||'').includes(q.value))
  total.value = list.length
  return list.slice(offset.value, offset.value + limit.value)
})

function editCustomer(id){ router.push(`/customers/${id}/edit`) }

const tierColors = {
  em_risco: '#dc3545',
  regular: '#ffc107',
  fiel: '#0d6efd',
  vip: '#198754',
}

const tierBgColors = {
  em_risco: 'rgba(220,53,69,0.1)',
  regular: 'rgba(255,193,7,0.1)',
  fiel: 'rgba(13,110,253,0.1)',
  vip: 'rgba(25,135,84,0.1)',
}

function starsHtml(stars) {
  return '★'.repeat(stars) + '☆'.repeat(4 - stars)
}

// Merge modal state
const showMerge = ref(false)
const mergeStep = ref(1)
const primaryId = ref(null)
const mergeQuery = ref('')
const selectedMerge = ref(new Set())
const overwrite = ref({ fullName: false, cpf: false, whatsapp: false, phone: false, ifoodCustomerId: false })

const primaryObj = computed(() => {
  if(!primaryId.value) return null
  return (store.list || []).find(c => c.id === primaryId.value) || null
})

const selectedList = computed(() => {
  const s = Array.from(selectedMerge.value || [])
  return (store.list || []).filter(c => s.includes(c.id) && c.id !== primaryId.value)
})

function candidateFor(field){
  for(const c of selectedList.value){
    const v = c[field]
    if(v !== undefined && v !== null && String(v).trim() !== '') return v
  }
  return null
}

function openMergeModal(){
  // ensure store data loaded
  if(!store.list || store.list.length === 0) load()
  showMerge.value = true
  mergeStep.value = 1
  primaryId.value = null
  selectedMerge.value = new Set()
  mergeQuery.value = ''
}

function closeMergeModal(){ showMerge.value = false }

function toggleSelect(id){ if(selectedMerge.value.has(id)) selectedMerge.value.delete(id); else selectedMerge.value.add(id) }

function nextMergeStep(){ if(mergeStep.value === 1 && !primaryId.value){ Swal.fire({ icon:'warning', text:'Selecione a conta principal' }); return } mergeStep.value++ }
function prevMergeStep(){ if(mergeStep.value>1) mergeStep.value-- }

async function performMerge(){
  if(!primaryId.value){ Swal.fire({ icon:'error', text:'Conta principal inválida' }); return }
  const merges = Array.from(selectedMerge.value).filter(id => id !== primaryId.value)
  if(merges.length === 0){ Swal.fire({ icon:'warning', text:'Selecione ao menos uma conta para mesclar' }); return }
  try{
    const payload = { primaryId: primaryId.value, mergeIds: merges, overwrite: overwrite.value }
    const res = await api.post('/customers/merge', payload)
    await load()
    Swal.fire({ icon:'success', text:'Clientes combinados com sucesso' })
    closeMergeModal()
  }catch(e){ console.error(e); Swal.fire({ icon:'error', text: String(e?.message || e || 'Falha ao combinar clientes') }) }
}
</script>

<template>
  <ListCard :title="`Clientes (${total || store.list.length})`" icon="bi bi-people" :subtitle="total ? `${total} clientes cadastrados` : ''" :quickSearch="true" quickSearchPlaceholder="Buscar por nome, CPF, WhatsApp" @quick-search="onQuickSearch" @quick-clear="onQuickClear">
    <template #actions>
      <div class="d-flex align-items-center gap-2">
        <label class="btn btn-outline-secondary btn-sm mb-0">
          <i class="bi bi-upload me-1"></i> Importar
          <input type="file" accept=".csv,.xlsx,.xls" class="d-none" @change="onImport" />
        </label>
        <button class="btn btn-primary" @click="goNew"><i class="bi bi-plus-lg me-1"></i> Novo cliente</button>
        <button class="btn btn-outline-secondary" @click.stop="openMergeModal"><i class="bi bi-git-merge me-1"></i> Combinar</button>
      </div>
    </template>

    <template #default>
      <div v-if="loading" class="text-center py-4">
        <div class="spinner-border spinner-border-sm text-secondary me-2"></div>
        Carregando...
      </div>
      <div v-else-if="error" class="alert alert-danger">{{ error }}</div>
      <div v-else>
        <div class="table-responsive">
          <table class="table table-hover align-middle mb-0 customers-table">
            <thead>
              <tr>
                <th>Cliente</th>
                <th>WhatsApp</th>
                <th class="text-center">Pedidos</th>
                <th class="text-end">Total gasto</th>
                <th class="text-center">Classificação</th>
                <th style="width:120px">Ações</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="c in displayed" :key="c.id" class="customer-row" @click="goProfile(c.id)">
                <td>
                  <div class="d-flex align-items-center gap-2">
                    <div class="customer-avatar" :style="{ background: tierBgColors[c.stats?.tier] || '#f0f0f0', color: tierColors[c.stats?.tier] || '#666' }">
                      {{ (c.fullName || '?')[0].toUpperCase() }}
                    </div>
                    <div>
                      <div class="fw-semibold">{{ c.fullName }}</div>
                      <div class="text-muted small">{{ c.cpf || '' }}</div>
                      <div v-if="c.ifoodCustomerId" class="text-muted small">iFood ID: <strong>{{ c.ifoodCustomerId }}</strong></div>
                    </div>
                  </div>
                </td>
                <td>
                  <span v-if="c.whatsapp || c.phone" class="text-nowrap">
                    {{ c.whatsapp || c.phone }}
                  </span>
                  <span v-else class="text-muted">—</span>
                </td>
                <td class="text-center">
                  <span class="badge bg-light text-dark">{{ c.stats?.totalOrders || 0 }}</span>
                </td>
                <td class="text-end">
                  <span class="fw-medium">{{ formatCurrency(c.stats?.totalSpent || 0) }}</span>
                  <div v-if="c.stats?.lastOrderDate" class="text-muted small">
                    Último: {{ formatDate(c.stats.lastOrderDate) }}
                  </div>
                </td>
                <td class="text-center">
                  <div v-if="c.stats?.tier">
                    <span class="tier-stars" :style="{ color: tierColors[c.stats.tier] }">
                      {{ starsHtml(c.stats.stars) }}
                    </span>
                    <div>
                      <span class="badge tier-badge" :style="{ background: tierBgColors[c.stats.tier], color: tierColors[c.stats.tier] }">
                        {{ c.stats.label }}
                      </span>
                    </div>
                  </div>
                  <span v-else class="text-muted">—</span>
                </td>
                <td @click.stop>
                  <div class="d-flex gap-1">
                    <button class="btn btn-sm btn-outline-primary" title="Ver perfil" @click="goProfile(c.id)">
                      <i class="bi bi-person"></i>
                    </button>
                    <button class="btn btn-sm btn-outline-secondary" title="Editar" @click="editCustomer(c.id)">
                      <i class="bi bi-pencil"></i>
                    </button>
                  </div>
                </td>
              </tr>
              <tr v-if="total === 0">
                <td colspan="6" class="text-center text-secondary py-4">Nenhum cliente encontrado.</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="d-flex align-items-center justify-content-between mt-3 px-1">
          <small class="text-muted">Mostrando {{ offset + 1 }} - {{ Math.min(offset + limit, total) }} de {{ total }}</small>
          <div class="d-flex gap-2">
            <button class="btn btn-sm btn-outline-secondary" @click="prevPage" :disabled="offset===0">
              <i class="bi bi-chevron-left"></i> Anterior
            </button>
            <button class="btn btn-sm btn-secondary" @click="nextPage" :disabled="offset+limit >= total">
              Próxima <i class="bi bi-chevron-right"></i>
            </button>
          </div>
        </div>
      </div>
    </template>
  </ListCard>

  <!-- Merge Modal -->
  <div v-if="showMerge" class="merge-modal-backdrop">
    <div class="merge-modal card p-3">
      <h5>Combinar clientes — Etapa {{ mergeStep }} de 3</h5>

      <div v-if="mergeStep === 1" class="mt-3">
        <p class="text-muted small">Selecione a conta principal que receberá os dados</p>
        <select class="form-select" v-model="primaryId">
          <option :value="null">-- Selecione --</option>
          <option v-for="c in store.list" :key="c.id" :value="c.id">
            {{ c.fullName }} — {{ c.cpf || '-' }} — {{ c.whatsapp || c.phone || '—' }} — {{ c.stats?.totalOrders || 0 }} pedidos
          </option>
        </select>
      </div>

      <div v-if="mergeStep === 2" class="mt-3">
        <p class="text-muted small">Buscar e marcar contas para mesclar</p>
        <input class="form-control mb-2" placeholder="Buscar por nome/CPF/WhatsApp" v-model="mergeQuery" />
        <div style="max-height:240px;overflow:auto">
          <div v-for="c in (store.list || []).filter(i => !mergeQuery || (i.fullName||'').toLowerCase().includes(mergeQuery.toLowerCase()) || (i.whatsapp||'').includes(mergeQuery) || (i.cpf||'').includes(mergeQuery))" :key="c.id" class="form-check">
            <input class="form-check-input" type="checkbox" :id="'m-'+c.id" :checked="selectedMerge.has(c.id)" @change.prevent="toggleSelect(c.id)" />
            <label class="form-check-label" :for="'m-'+c.id">{{ c.fullName }} — {{ c.cpf || '-' }} — {{ c.whatsapp || c.phone || '—' }} ({{ c.stats?.totalOrders || 0 }} pedidos)</label>
          </div>
        </div>
      </div>

      <div v-if="mergeStep === 3" class="mt-3">
        <p class="text-muted small">Quais campos devem ser atualizados no cadastro principal?</p>
        <div v-if="!primaryObj">
          <div class="text-warning">Selecione a conta principal na etapa 1.</div>
        </div>
        <div v-else>
          <div v-if="selectedList.length === 0" class="text-muted small">Selecione contas na etapa anterior para que valores candidatos apareçam.</div>
          <div v-else>
            <div v-for="(meta, idx) in [{k:'fullName',label:'Nome completo'},{k:'cpf',label:'CPF'},{k:'whatsapp',label:'WhatsApp'},{k:'phone',label:'Telefone'},{k:'ifoodCustomerId',label:'iFood ID'}]" :key="meta.k">
              <template v-if="(!(primaryObj[meta.k]) || primaryObj[meta.k] === null || String(primaryObj[meta.k]).trim() === '')">
                <template v-if="candidateFor(meta.k)">
                  <div class="form-check d-flex justify-content-between align-items-center">
                    <div>
                      <input class="form-check-input me-2" type="checkbox" :id="'ov-'+meta.k" v-model="overwrite[meta.k]" />
                      <label class="form-check-label" :for="'ov-'+meta.k">{{ meta.label }}</label>
                    </div>
                    <div class="text-muted small">Será: <strong>{{ candidateFor(meta.k) }}</strong></div>
                  </div>
                </template>
              </template>
            </div>
          </div>
        </div>
      </div>

      <div class="mt-3 d-flex justify-content-end gap-2">
        <button class="btn btn-outline-secondary" @click="closeMergeModal">Cancelar</button>
        <button v-if="mergeStep>1" class="btn btn-light" @click="prevMergeStep">Voltar</button>
        <button v-if="mergeStep<3" class="btn btn-primary" @click="nextMergeStep">Próximo</button>
        <button v-else class="btn btn-success" @click="performMerge">Confirmar e mesclar</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.customers-table thead th {
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: #6c757d;
  border-bottom: 2px solid #e9ecef;
  padding: 0.6rem 0.75rem;
}
.customers-table tbody td {
  padding: 0.7rem 0.75rem;
  vertical-align: middle;
}
.customer-row {
  cursor: pointer;
  transition: background-color 0.15s;
}
.customer-row:hover {
  background-color: #f8f9ff !important;
}
.customer-avatar {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 0.95rem;
  flex-shrink: 0;
}
.tier-stars {
  font-size: 1rem;
  letter-spacing: 1px;
}
.tier-badge {
  font-size: 0.7rem;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 10px;
  margin-top: 2px;
  display: inline-block;
}
.merge-modal-backdrop{position:fixed;inset:0;background:rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;z-index:1050}
.merge-modal{width:720px;max-width:95%;}
</style>
