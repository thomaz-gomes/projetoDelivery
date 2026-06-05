<script setup>
import { ref, onMounted, computed, watch } from 'vue';
import { useCustomersStore } from '../stores/customers';
import { useImportProgressStore } from '../stores/importProgress';
import { useRouter } from 'vue-router';
import { formatCurrency, formatDate } from '../utils/formatters.js';
import BaseButton from '../components/BaseButton.vue';
import ListCard from '../components/ListCard.vue';
import api from '../api';
import Swal from 'sweetalert2'

const store = useCustomersStore();
const imp = useImportProgressStore();
const router = useRouter();

const q = ref('');
const error = ref('');
const loading = ref(false)
const importing = ref(false)
const fileInputRef = ref(null)

// Recarrega a lista quando o import de fundo terminar (sem erro)
watch(() => imp.done, (isDone) => {
  if (isDone && !imp.error) load();
})

const limit = ref(20)
const offset = ref(0)
const total = ref(0)

// ── Filtros ──
const tierFilter = ref('')
const onlyWhatsApp = ref(false)
const tierCounts = ref({ novo: 0, regular: 0, fiel: 0, vip: 0, em_risco: 0 })
const tierCountsTotal = ref(0)
const hasAnyFilter = computed(() => Boolean(q.value) || Boolean(tierFilter.value) || onlyWhatsApp.value)

const TIER_DEFS = [
  { key: 'novo',     label: 'Novos',     icon: 'bi-stars' },
  { key: 'regular',  label: 'Regulares', icon: 'bi-star' },
  { key: 'fiel',     label: 'Fiéis',     icon: 'bi-star-half' },
  { key: 'vip',      label: 'VIP',       icon: 'bi-trophy' },
  { key: 'em_risco', label: 'Em Risco',  icon: 'bi-exclamation-triangle' },
]

async function loadTierCounts() {
  try {
    const data = await store.fetchTierCounts({ hasWhatsApp: onlyWhatsApp.value })
    tierCounts.value = data?.counts || {}
    tierCountsTotal.value = data?.total || 0
  } catch (e) { console.warn('Falha ao carregar contagens de tier', e?.message || e) }
}

function selectTier(key) {
  // Clica no card já ativo → desativa o filtro
  tierFilter.value = (tierFilter.value === key) ? '' : key
  offset.value = 0
  load()
}

// Quando troca o filtro de WhatsApp, recarrega lista E contagens (os cards
// passam a refletir só os clientes com contato).
function toggleOnlyWhatsApp() {
  onlyWhatsApp.value = !onlyWhatsApp.value
  offset.value = 0
  load()
  loadTierCounts()
}

const load = async () => {
  loading.value = true
  error.value = ''
  try{
    const token = localStorage.getItem('token')
    if(!token){ router.push({ path: '/login', query: { redirect: '/customers' } }); return }
    await store.fetch({
      q: q.value,
      skip: offset.value,
      take: limit.value,
      tier: tierFilter.value,
      hasWhatsApp: onlyWhatsApp.value,
    })
    total.value = store.total
  }catch(e){ console.error('Failed to fetch customers', e); error.value = e?.response?.data?.message || 'Falha ao carregar clientes' }
  finally{ loading.value = false }
}

onMounted(()=> { load(); loadTierCounts() })

// ── Bulk select ──
// Guarda Customer inteiro (não só id) pra sobreviver à paginação e à troca
// de filtro: ao mudar de página, a seleção da página anterior permanece e
// ainda temos `.whatsapp` pra filtrar no submit. selectedIds é Set derivado
// pra fazer os v-for/checked O(1).
const selectedMap = ref(new Map())
const selectedIds = computed(() => new Set(selectedMap.value.keys()))
const selectionCount = computed(() => selectedMap.value.size)
const selectedWithWhatsApp = computed(() =>
  Array.from(selectedMap.value.values()).filter(c => !!(c.whatsapp || c.phone))
)
const pageAllSelected = computed(() => {
  if (!displayed.value.length) return false
  return displayed.value.every(c => selectedMap.value.has(c.id))
})

function toggleCustomer(id) {
  const m = new Map(selectedMap.value)
  if (m.has(id)) {
    m.delete(id)
  } else {
    const c = displayed.value.find(x => x.id === id)
    if (c) m.set(id, c)
  }
  selectedMap.value = m
}
function togglePageAll() {
  const m = new Map(selectedMap.value)
  if (pageAllSelected.value) {
    displayed.value.forEach(c => m.delete(c.id))
  } else {
    displayed.value.forEach(c => m.set(c.id, c))
  }
  selectedMap.value = m
}
function clearSelection() { selectedMap.value = new Map() }

// ── Modal "Criar lista" (segmento de marketing fixado nos selecionados) ──
const showCreateListModal = ref(false)
const createListForm = ref({ name: '', description: '' })
const creatingList = ref(false)

function openCreateListModal() {
  createListForm.value = {
    name: `Lista de clientes (${selectionCount.value}) — ${new Date().toLocaleDateString('pt-BR')}`,
    description: '',
  }
  showCreateListModal.value = true
}
function closeCreateListModal() {
  if (creatingList.value) return
  showCreateListModal.value = false
}
async function submitCreateList() {
  const ids = selectedWithWhatsApp.value.map(c => c.id)
  if (!ids.length) {
    Swal.fire({ icon: 'warning', text: 'Nenhum cliente selecionado tem WhatsApp cadastrado.' })
    return
  }
  if (!createListForm.value.name.trim()) {
    Swal.fire({ icon: 'warning', text: 'Informe um nome para a lista.' })
    return
  }
  creatingList.value = true
  try {
    const ruleJson = {
      rule: {
        all: [
          { field: 'customerId', op: 'in', value: ids },
        ],
      },
    }
    await api.post('/marketing/segments', {
      name: createListForm.value.name.trim(),
      description: createListForm.value.description.trim() || null,
      ruleJson,
    })
    showCreateListModal.value = false
    clearSelection()
    await Swal.fire({
      icon: 'success',
      title: 'Lista criada',
      html: `Segmento <strong>${createListForm.value.name}</strong> criado com <strong>${ids.length}</strong> contato(s). Use no Marketing → Campanhas para enviar.`,
    })
  } catch (e) {
    console.error('createList error', e)
    Swal.fire({ icon: 'error', text: e?.response?.data?.message || e?.message || 'Falha ao criar lista' })
  } finally {
    creatingList.value = false
  }
}

function goNew(){ router.push('/customers/new') }
function goProfile(id){ router.push(`/customers/${id}`) }

function onQuickSearch(val){ q.value = val; offset.value = 0; load() }
function onQuickClear(){ resetFilters() }

async function onImport(e){
  const file = e.target.files?.[0]
  if(!file) return
  if(fileInputRef.value) fileInputRef.value.value = ''
  importing.value = true
  try{
    const res = await store.importFile(file)
    // Backend retorna imediatamente com jobId; polling via importProgress store
    imp.start(res.jobId, res.total, file.name)
  }catch(e){
    console.error(e)
    Swal.fire({ icon:'error', title: 'Falha ao enviar arquivo', text: e?.response?.data?.message || e?.message || 'Erro desconhecido' })
  }finally{
    importing.value = false
  }
}

const resetFilters = () => { q.value=''; tierFilter.value=''; onlyWhatsApp.value=false; offset.value=0; load(); loadTierCounts() }
const nextPage = () => { if(offset.value + limit.value < total.value){ offset.value += limit.value; load() } }
const prevPage = () => { if(offset.value > 0){ offset.value = Math.max(0, offset.value - limit.value); load() } }

const displayed = computed(() => store.list || [])

function editCustomer(id){ router.push(`/customers/${id}`) }

const tierColors = {
  em_risco: '#dc3545',
  regular: '#ffc107',
  fiel: '#0d6efd',
  vip: '#198754',
  novo: '#0d6efd',
}

const tierBgColors = {
  em_risco: 'rgba(220,53,69,0.1)',
  regular: 'rgba(255,193,7,0.1)',
  fiel: 'rgba(13,110,253,0.1)',
  vip: 'rgba(25,135,84,0.1)',
  novo: 'rgba(13,110,253,0.06)',
}

function starsHtml(stars) {
  return '★'.repeat(stars) + '☆'.repeat(4 - stars)
}

// ── Merge modal state ────────────────────────────────────────────────
// The merge modal needs a customer list independent from the main page —
// otherwise the operator who just searched "fernando" to find the duplicate
// would only see fernandos as merge candidates and never find the other
// account they want to combine with. mergeCandidates is populated by its
// own backend query, debounced via mergeSearchTimer.
const showMerge = ref(false)
const mergeStep = ref(1)
const primaryId = ref(null)
const mergeQuery = ref('')
const mergeCandidates = ref([])
const mergeLoading = ref(false)
const selectedMerge = ref(new Set())
const overwrite = ref({ fullName: false, cpf: false, whatsapp: false, phone: false, ifoodCustomerId: false })

// Snapshot picked customers (primary + each merge target) so they remain
// available even after a fresh search drops them from mergeCandidates.
// Step 3 ("overwrite fields") reads from this cache, not from the live list.
const pickedCustomers = ref(new Map())

let mergeSearchTimer = null

async function fetchMergeCandidates(){
  mergeLoading.value = true
  try {
    const { data } = await api.get('/customers', { params: { q: mergeQuery.value || '', take: 50, skip: 0 } })
    mergeCandidates.value = Array.isArray(data?.rows) ? data.rows : []
  } catch (e) {
    console.error('merge candidates fetch failed', e)
    mergeCandidates.value = []
  } finally {
    mergeLoading.value = false
  }
}

function onMergeSearchInput(){
  if (mergeSearchTimer) clearTimeout(mergeSearchTimer)
  mergeSearchTimer = setTimeout(fetchMergeCandidates, 300)
}

watch(primaryId, (id) => {
  if (!id) return
  const found = mergeCandidates.value.find(c => c.id === id)
  if (found) pickedCustomers.value.set(id, found)
})

const primaryObj = computed(() => {
  if(!primaryId.value) return null
  return pickedCustomers.value.get(primaryId.value)
    || mergeCandidates.value.find(c => c.id === primaryId.value)
    || null
})

const selectedList = computed(() => {
  const ids = Array.from(selectedMerge.value || []).filter(id => id !== primaryId.value)
  return ids.map(id => pickedCustomers.value.get(id) || mergeCandidates.value.find(c => c.id === id)).filter(Boolean)
})

function candidateFor(field){
  for(const c of selectedList.value){
    const v = c[field]
    if(v !== undefined && v !== null && String(v).trim() !== '') return v
  }
  return null
}

function openMergeModal(){
  showMerge.value = true
  mergeStep.value = 1
  primaryId.value = null
  selectedMerge.value = new Set()
  pickedCustomers.value = new Map()
  mergeQuery.value = ''
  fetchMergeCandidates()
}

function closeMergeModal(){ showMerge.value = false }

function toggleSelect(id){
  if(selectedMerge.value.has(id)) {
    selectedMerge.value.delete(id)
  } else {
    selectedMerge.value.add(id)
    // Cache the customer so step 3 can read its fields even if the operator
    // later narrows the search and drops it from mergeCandidates.
    const found = mergeCandidates.value.find(c => c.id === id)
    if (found) pickedCustomers.value.set(id, found)
  }
  // Force reactivity on the Set wrapper
  selectedMerge.value = new Set(selectedMerge.value)
}

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
  }catch(e){
    console.error(e)
    const detail = e?.response?.data?.error || e?.response?.data?.message
    Swal.fire({ icon:'error', text: detail || String(e?.message || e || 'Falha ao combinar clientes') })
  }
}
</script>

<template>
  <ListCard :title="`Clientes (${total || store.list.length})`" icon="bi bi-people" :subtitle="total ? `${total} clientes cadastrados` : ''" :quickSearch="true" quickSearchPlaceholder="Buscar por nome, CPF, WhatsApp" @quick-search="onQuickSearch" @quick-clear="onQuickClear">
    <template #actions>
      <div class="d-flex align-items-center gap-2">
        <label class="btn btn-outline-secondary btn-sm mb-0" :class="{ disabled: importing }">
          <span v-if="importing"><span class="spinner-border spinner-border-sm me-1"></span> Importando...</span>
          <span v-else><i class="bi bi-upload me-1"></i> Importar</span>
          <input ref="fileInputRef" type="file" accept=".csv,.xlsx,.xls" class="d-none" @change="onImport" :disabled="importing" />
        </label>
        <a class="btn btn-link btn-sm p-0" href="/templates/customers-template.csv" download>Baixar planilha modelo</a>
        <router-link class="btn btn-outline-secondary" to="/customer-groups"><i class="bi bi-people-fill me-1"></i> Grupos</router-link>
        <button class="btn btn-primary" @click="goNew"><i class="bi bi-plus-lg me-1"></i> Novo cliente</button>
        <button class="btn btn-outline-secondary" @click.stop="openMergeModal"><i class="bi bi-git-merge me-1"></i> Combinar</button>
      </div>
    </template>

    <template #default>
      <!-- ═══ Tier cards (clique pra filtrar) ═══ -->
      <div class="tier-cards mb-3">
        <button
          v-for="t in TIER_DEFS"
          :key="t.key"
          type="button"
          class="tier-card"
          :class="['tier-card--' + t.key, { active: tierFilter === t.key }]"
          @click="selectTier(t.key)"
        >
          <div class="tier-card-icon"><i :class="['bi', t.icon]"></i></div>
          <div class="tier-card-body">
            <div class="tier-card-label">{{ t.label }}</div>
            <div class="tier-card-count">{{ tierCounts[t.key] || 0 }}</div>
          </div>
        </button>
      </div>

      <!-- ═══ Toggle: somente clientes com WhatsApp ═══ -->
      <div class="d-flex align-items-center gap-2 mb-3 flex-wrap">
        <button
          type="button"
          class="btn btn-sm"
          :class="onlyWhatsApp ? 'btn-success' : 'btn-outline-success'"
          @click="toggleOnlyWhatsApp"
          :title="onlyWhatsApp ? 'Clique para ver todos os clientes' : 'Filtrar para somente clientes com WhatsApp/telefone'"
        >
          <i class="bi bi-whatsapp me-1"></i>
          {{ onlyWhatsApp ? 'Somente com WhatsApp' : 'Filtrar por WhatsApp' }}
        </button>
      </div>

      <!-- ═══ Filtros ativos + limpar ═══ -->
      <div v-if="hasAnyFilter" class="d-flex align-items-center gap-2 mb-3 small">
        <span class="text-muted">Filtros ativos:</span>
        <span v-if="tierFilter" class="badge bg-light text-dark border">
          {{ (TIER_DEFS.find(t => t.key === tierFilter) || {}).label }}
        </span>
        <span v-if="onlyWhatsApp" class="badge bg-success-subtle text-success border border-success">
          <i class="bi bi-whatsapp me-1"></i>Com WhatsApp
        </span>
        <span v-if="q" class="badge bg-light text-dark border">Busca: "{{ q }}"</span>
        <button class="btn btn-sm btn-link p-0 ms-auto" @click="resetFilters">
          <i class="bi bi-x-circle me-1"></i>Limpar filtro
        </button>
      </div>

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
                <th style="width:34px">
                  <input
                    type="checkbox"
                    class="form-check-input"
                    :checked="pageAllSelected"
                    @change="togglePageAll"
                    @click.stop
                    title="Selecionar todos da página"
                  />
                </th>
                <th>Cliente</th>
                <th>WhatsApp</th>
                <th class="text-center">Pedidos</th>
                <th class="text-end">Total gasto</th>
                <th class="text-center">Classificação</th>
                <th style="width:120px">Ações</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="c in displayed" :key="c.id" class="customer-row" :class="{ 'row-selected': selectedIds.has(c.id) }" @click="goProfile(c.id)">
                <td @click.stop>
                  <input
                    type="checkbox"
                    class="form-check-input"
                    :checked="selectedIds.has(c.id)"
                    @change="toggleCustomer(c.id)"
                  />
                </td>
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
                <td colspan="7" class="text-center text-secondary py-4">Nenhum cliente encontrado.</td>
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

  <!-- ═══ Bulk Action Bar — aparece quando há seleção ═══ -->
  <transition name="bulk-bar">
    <div v-if="selectionCount > 0" class="bulk-action-bar">
      <div class="d-flex align-items-center gap-3 w-100">
        <span class="fw-semibold">{{ selectionCount }} cliente(s) selecionado(s)</span>
        <button class="btn btn-sm btn-outline-light" @click="clearSelection">
          <i class="bi bi-x-lg me-1"></i>Limpar seleção
        </button>
        <div class="ms-auto d-flex gap-2">
          <button class="btn btn-light btn-sm" @click="openCreateListModal" :disabled="!selectedWithWhatsApp.length">
            <i class="bi bi-whatsapp me-1"></i>Criar lista
            <span v-if="selectedWithWhatsApp.length !== selectionCount" class="badge bg-warning text-dark ms-1" :title="`Apenas ${selectedWithWhatsApp.length} têm WhatsApp cadastrado`">
              {{ selectedWithWhatsApp.length }} c/ WA
            </span>
          </button>
        </div>
      </div>
    </div>
  </transition>

  <!-- ═══ Modal: Criar lista (segmento de marketing) ═══ -->
  <div v-if="showCreateListModal" class="modal d-block" tabindex="-1"
       @click.self="closeCreateListModal" style="background:rgba(0,0,0,0.5)">
    <div class="modal-dialog modal-dialog-centered" role="document">
      <div class="modal-content">
        <div class="modal-header">
          <h5 class="modal-title">
            <i class="bi bi-whatsapp text-success me-2"></i>Criar lista de contatos
          </h5>
          <button type="button" class="btn-close" @click="closeCreateListModal" :disabled="creatingList"></button>
        </div>
        <div class="modal-body">
          <div class="alert alert-info py-2 small mb-3">
            <i class="bi bi-info-circle me-1"></i>
            Será criado um <strong>segmento de marketing</strong> com os clientes selecionados que têm WhatsApp.
            Use no Marketing → Campanhas para disparar mensagens.
          </div>
          <div class="mb-3">
            <label class="form-label">Nome da lista</label>
            <input v-model="createListForm.name" class="form-control" placeholder="Ex: Clientes VIP — Maio 2026" :disabled="creatingList" />
          </div>
          <div class="mb-3">
            <label class="form-label">Descrição (opcional)</label>
            <textarea v-model="createListForm.description" class="form-control" rows="2" placeholder="Para que serve esta lista?" :disabled="creatingList"></textarea>
          </div>
          <div class="d-flex justify-content-between small">
            <span class="text-muted">Selecionados</span>
            <strong>{{ selectionCount }}</strong>
          </div>
          <div class="d-flex justify-content-between small">
            <span class="text-muted">Com WhatsApp (entrarão na lista)</span>
            <strong :class="selectedWithWhatsApp.length === 0 ? 'text-danger' : 'text-success'">{{ selectedWithWhatsApp.length }}</strong>
          </div>
          <div v-if="selectedWithWhatsApp.length < selectionCount" class="alert alert-warning py-2 small mt-2 mb-0">
            <i class="bi bi-exclamation-triangle me-1"></i>
            {{ selectionCount - selectedWithWhatsApp.length }} cliente(s) sem WhatsApp serão ignorados.
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-outline-secondary" @click="closeCreateListModal" :disabled="creatingList">Cancelar</button>
          <button class="btn btn-primary" :disabled="creatingList || !createListForm.name.trim() || !selectedWithWhatsApp.length" @click="submitCreateList">
            <span v-if="creatingList" class="spinner-border spinner-border-sm me-1"></span>
            Criar lista
          </button>
        </div>
      </div>
    </div>
  </div>

  <!-- Merge Modal -->
  <div v-if="showMerge" class="merge-modal-backdrop">
    <div class="merge-modal card p-3">
      <h5>Combinar clientes — Etapa {{ mergeStep }} de 3</h5>

      <div v-if="mergeStep === 1" class="mt-3">
        <p class="text-muted small">Selecione a conta principal que receberá os dados</p>
        <!-- Independent search (NOT bound to main page filter). Debounced
             backend call updates mergeCandidates, so the dropdown reflects
             the modal's own query. -->
        <div class="input-group mb-2">
          <span class="input-group-text"><i class="bi bi-search"></i></span>
          <input
            class="form-control"
            placeholder="Buscar cliente por nome, CPF ou WhatsApp"
            v-model="mergeQuery"
            @input="onMergeSearchInput"
          />
          <span v-if="mergeLoading" class="input-group-text">
            <span class="spinner-border spinner-border-sm" role="status"></span>
          </span>
        </div>
        <select class="form-select" v-model="primaryId" size="8">
          <option :value="null">-- Selecione --</option>
          <option v-for="c in mergeCandidates" :key="c.id" :value="c.id">
            {{ c.fullName }} — {{ c.cpf || '-' }} — {{ c.whatsapp || c.phone || '—' }} — {{ c.stats?.totalOrders || 0 }} pedidos
          </option>
        </select>
        <div v-if="!mergeLoading && mergeCandidates.length === 0" class="text-muted small mt-2">
          Nenhum cliente encontrado para "{{ mergeQuery }}".
        </div>
      </div>

      <div v-if="mergeStep === 2" class="mt-3">
        <p class="text-muted small">Buscar e marcar contas para mesclar</p>
        <div class="input-group mb-2">
          <span class="input-group-text"><i class="bi bi-search"></i></span>
          <input
            class="form-control"
            placeholder="Buscar por nome, CPF ou WhatsApp"
            v-model="mergeQuery"
            @input="onMergeSearchInput"
          />
          <span v-if="mergeLoading" class="input-group-text">
            <span class="spinner-border spinner-border-sm" role="status"></span>
          </span>
        </div>
        <div style="max-height:240px;overflow:auto">
          <div v-for="c in mergeCandidates.filter(i => i.id !== primaryId)" :key="c.id" class="form-check">
            <input class="form-check-input" type="checkbox" :id="'m-'+c.id" :checked="selectedMerge.has(c.id)" @change.prevent="toggleSelect(c.id)" />
            <label class="form-check-label" :for="'m-'+c.id">{{ c.fullName }} — {{ c.cpf || '-' }} — {{ c.whatsapp || c.phone || '—' }} ({{ c.stats?.totalOrders || 0 }} pedidos)</label>
          </div>
          <div v-if="!mergeLoading && mergeCandidates.filter(i => i.id !== primaryId).length === 0" class="text-muted small">
            Nenhum cliente para mesclar com a busca atual.
          </div>
        </div>
        <div v-if="selectedMerge.size > 0" class="small text-muted mt-2">
          <i class="bi bi-info-circle me-1"></i>{{ selectedMerge.size }} selecionado(s). Refine a busca acima para encontrar mais — os já marcados permanecem.
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

/* Tier cards (filtro por classificação) */
.tier-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 12px;
}
.tier-card {
  display: flex;
  align-items: center;
  gap: 12px;
  background: #fff;
  border: 1px solid #e9ecef;
  border-radius: 10px;
  padding: 12px 14px;
  cursor: pointer;
  transition: transform 0.12s, box-shadow 0.15s, border-color 0.15s;
  text-align: left;
  font: inherit;
  color: inherit;
}
.tier-card:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(0,0,0,0.06);
  border-color: #d0d7e0;
}
.tier-card.active {
  border-color: var(--bs-primary, #0d6efd);
  box-shadow: 0 0 0 3px rgba(13,110,253,0.12);
}
.tier-card-icon {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.05rem;
  flex-shrink: 0;
}
.tier-card-body { display: flex; flex-direction: column; line-height: 1.1; }
.tier-card-label { font-size: 0.75rem; color: #6c757d; text-transform: uppercase; letter-spacing: 0.03em; }
.tier-card-count { font-size: 1.4rem; font-weight: 700; color: #212529; }

.tier-card--novo     .tier-card-icon { background: rgba(13,110,253,0.10); color: #0d6efd; }
.tier-card--regular  .tier-card-icon { background: rgba(255,193,7,0.15);  color: #b8860b; }
.tier-card--fiel     .tier-card-icon { background: rgba(13,110,253,0.10); color: #0d6efd; }
.tier-card--vip      .tier-card-icon { background: rgba(25,135,84,0.12);  color: #198754; }
.tier-card--em_risco .tier-card-icon { background: rgba(220,53,69,0.10);  color: #dc3545; }

/* Linha selecionada */
.customer-row.row-selected {
  background-color: rgba(13,110,253,0.05) !important;
}

/* Barra de ação em massa (fixa no rodapé) */
.bulk-action-bar {
  position: fixed;
  left: 50%;
  bottom: 16px;
  transform: translateX(-50%);
  z-index: 1040;
  min-width: 540px;
  max-width: 92vw;
  background: #212529;
  color: #fff;
  padding: 12px 18px;
  border-radius: 12px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.25);
  display: flex;
  align-items: center;
}
.bulk-bar-enter-active, .bulk-bar-leave-active {
  transition: transform 0.18s, opacity 0.18s;
}
.bulk-bar-enter-from, .bulk-bar-leave-to {
  transform: translate(-50%, 30px);
  opacity: 0;
}
.bulk-bar-enter-to, .bulk-bar-leave-from {
  transform: translateX(-50%);
  opacity: 1;
}
</style>
