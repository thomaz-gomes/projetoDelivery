<template>
  <div class="container">
    <!-- Filters card -->
    <div class="card mb-3">
      <div class="card-body">
        <div class="row g-2 align-items-end">
          <div class="col-md-2">
            <label class="form-label">Loja</label>
            <select class="form-select" v-model="filters.storeId">
              <option value="">Todas</option>
              <option v-for="s in stores" :key="s.id" :value="s.id">{{ s.name }}</option>
            </select>
          </div>
          <div class="col-md-2">
            <label class="form-label">Status</label>
            <select class="form-select" v-model="filters.status">
              <option value="">Todos</option>
              <option value="PENDING">Pendente</option>
              <option value="MATCHED">Matched</option>
              <option value="APPLIED">Aplicado</option>
              <option value="ERROR">Erro</option>
            </select>
          </div>
          <div class="col-md-2">
            <label class="form-label">Data inicio</label>
            <DateInput v-model="filters.from" inputClass="form-control" />
          </div>
          <div class="col-md-2">
            <label class="form-label">Data fim</label>
            <DateInput v-model="filters.to" inputClass="form-control" />
          </div>
          <div class="col-md-2 text-end">
            <button class="btn btn-primary me-2" @click="load"><i class="bi bi-search me-1"></i>Buscar</button>
            <button class="btn btn-outline-secondary" @click="reset">Limpar</button>
          </div>
          <div class="col-md-2 text-end">
            <button class="btn btn-success" @click="showImportModal = true"><i class="bi bi-plus-lg me-1"></i>Nova Importacao</button>
          </div>
        </div>
      </div>
    </div>

    <!-- MDe sync card -->
    <div class="card mb-3" v-if="stores.length">
      <div class="card-body">
        <h6 class="mb-3"><i class="bi bi-cloud-download me-2"></i>Sincronizacao MDe</h6>
        <div class="row g-2">
          <div v-for="s in stores" :key="'mde-' + s.id" class="col-md-4">
            <div class="border rounded p-2 d-flex justify-content-between align-items-center">
              <div>
                <strong>{{ s.name }}</strong>
                <div class="small text-muted" v-if="mdeStatus[s.id]">
                  <span v-if="mdeStatus[s.id].lastSync">Ultima sync: {{ formatDate(mdeStatus[s.id].lastSync) }}</span>
                  <span v-else>Nunca sincronizado</span>
                  <span v-if="mdeStatus[s.id].pendingCount" class="ms-2 badge bg-warning">{{ mdeStatus[s.id].pendingCount }} pendentes</span>
                </div>
                <div class="small text-muted" v-else>Sem dados de sync</div>
              </div>
              <button class="btn btn-sm btn-outline-primary" :disabled="syncingStore === s.id" @click="syncMde(s.id)">
                <i class="bi bi-arrow-repeat me-1" :class="{ 'spin': syncingStore === s.id }"></i>Sincronizar NFe
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Main list -->
    <ListCard title="Importacoes de Compras" icon="bi bi-receipt" :subtitle="list.length ? `${list.length} importacoes` : ''">
      <template #default>
        <div class="table-responsive">
          <table class="table table-hover mb-0">
            <thead>
              <tr>
                <th>Data</th>
                <th>Fonte</th>
                <th>Fornecedor</th>
                <th>Loja</th>
                <th>Nr Nota</th>
                <th>Valor Total</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in paged" :key="row.id">
                <td>{{ formatDate(row.createdAt) }}</td>
                <td><span :class="sourceBadgeClass(row.source)">{{ sourceLabel(row.source) }}</span></td>
                <td>{{ row.supplierName || '-' }}</td>
                <td>{{ row.store?.name || '-' }}</td>
                <td>{{ row.nfeNumber || '-' }}</td>
                <td>{{ formatCurrency(row.totalValue) }}</td>
                <td><span :class="statusBadgeClass(row.status)">{{ statusLabel(row.status) }}</span></td>
                <td>
                  <button v-if="row.status === 'PENDING'" class="btn btn-sm btn-outline-primary" :disabled="processingId === row.id" @click="processMatch(row)">
                    <i class="bi bi-robot me-1"></i>Processar com IA
                  </button>
                  <button v-else-if="row.status === 'MATCHED'" class="btn btn-sm btn-outline-info" @click="reviewImport(row)">
                    <i class="bi bi-eye me-1"></i>Revisar
                  </button>
                  <router-link v-else-if="row.status === 'APPLIED' && row.stockMovementId" class="btn btn-sm btn-outline-success" :to="`/stock-movements/${row.stockMovementId}`">
                    <i class="bi bi-box-arrow-up-right me-1"></i>Ver Movimento
                  </router-link>
                  <span v-else-if="row.status === 'ERROR'" class="text-danger small">
                    <i class="bi bi-exclamation-triangle me-1"></i>{{ row.errorMessage || 'Erro' }}
                  </span>
                </td>
              </tr>
              <tr v-if="!paged.length">
                <td colspan="8" class="text-center text-muted py-4">
                  <span v-if="loading"><i class="bi bi-arrow-repeat spin me-1"></i>Carregando...</span>
                  <span v-else>Nenhuma importacao encontrada.</span>
                </td>
              </tr>
            </tbody>
          </table>
          <!-- Pagination -->
          <div class="d-flex justify-content-between align-items-center mt-2">
            <div class="text-muted">Mostrando {{ startIndex }} - {{ endIndex }} de {{ list.length }}</div>
            <div class="d-flex gap-2 align-items-center">
              <label class="mb-0">Por pagina</label>
              <select class="form-select form-select-sm" v-model.number="perPage">
                <option :value="10">10</option>
                <option :value="25">25</option>
                <option :value="50">50</option>
              </select>
              <button class="btn btn-sm btn-outline-secondary" :disabled="page <= 1" @click="page--">Anterior</button>
              <button class="btn btn-sm btn-outline-secondary" :disabled="page >= totalPages" @click="page++">Proxima</button>
            </div>
          </div>
        </div>
      </template>
    </ListCard>

    <PurchaseImportModal v-if="showImportModal" :review-import-id="reviewImportId" @close="onModalClose" @imported="onImported" />
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import api from '../../api'
import DateInput from '../../components/form/date/DateInput.vue'
import ListCard from '../../components/ListCard.vue'
import PurchaseImportModal from '../../components/PurchaseImportModal.vue'

const stores = ref([])
const list = ref([])
const loading = ref(false)
const showImportModal = ref(false)
const reviewImportId = ref(null)
const syncingStore = ref(null)
const processingId = ref(null)
const mdeStatus = ref({})

const filters = ref({ storeId: '', status: '', from: '', to: '' })
const page = ref(1)
const perPage = ref(10)

const totalPages = computed(() => Math.max(1, Math.ceil(list.value.length / perPage.value)))

const paged = computed(() => {
  if (page.value > totalPages.value) page.value = totalPages.value
  const start = (page.value - 1) * perPage.value
  return list.value.slice(start, start + perPage.value)
})

const startIndex = computed(() => list.value.length === 0 ? 0 : (page.value - 1) * perPage.value + 1)
const endIndex = computed(() => Math.min(list.value.length, page.value * perPage.value))

async function loadStores() {
  try {
    const { data } = await api.get('/stores')
    stores.value = Array.isArray(data) ? data : (data?.stores || [])
  } catch (e) {
    console.error('Failed to load stores', e?.message || e)
    stores.value = []
  }
}

async function loadMdeStatus() {
  for (const s of stores.value) {
    try {
      const { data } = await api.get('/purchase-imports/mde/status', { params: { storeId: s.id } })
      mdeStatus.value[s.id] = data
    } catch {
      // store may not have certificate — ignore
    }
  }
}

async function load() {
  loading.value = true
  page.value = 1
  try {
    const params = {}
    if (filters.value.storeId) params.storeId = filters.value.storeId
    if (filters.value.status) params.status = filters.value.status
    if (filters.value.from) params.from = filters.value.from
    if (filters.value.to) params.to = filters.value.to
    const { data } = await api.get('/purchase-imports', { params })
    list.value = Array.isArray(data) ? data : (data?.items || data?.imports || [])
  } catch (e) {
    console.error('Failed to load purchase imports', e?.message || e)
    list.value = []
  } finally {
    loading.value = false
  }
}

function reset() {
  filters.value = { storeId: '', status: '', from: '', to: '' }
  list.value = []
}

async function syncMde(storeId) {
  syncingStore.value = storeId
  try {
    await api.post('/purchase-imports/mde/sync', { storeId })
    // reload MDe status for this store
    try {
      const { data } = await api.get('/purchase-imports/mde/status', { params: { storeId } })
      mdeStatus.value[storeId] = data
    } catch { /* ignore */ }
    // reload list
    await load()
  } catch (e) {
    console.error('MDe sync failed', e?.message || e)
    alert('Falha ao sincronizar MDe: ' + (e?.response?.data?.error || e?.message || 'Erro desconhecido'))
  } finally {
    syncingStore.value = null
  }
}

async function processMatch(row) {
  processingId.value = row.id
  try {
    await api.post(`/purchase-imports/${row.id}/match`)
    await load()
  } catch (e) {
    console.error('AI match failed', e?.message || e)
    alert('Falha ao processar matching: ' + (e?.response?.data?.error || e?.message || 'Erro desconhecido'))
  } finally {
    processingId.value = null
  }
}

function reviewImport(row) {
  reviewImportId.value = row.id
  showImportModal.value = true
}

function onModalClose() {
  showImportModal.value = false
  reviewImportId.value = null
}

async function onImported() {
  showImportModal.value = false
  reviewImportId.value = null
  await load()
}

// Source badge helpers
const sourceLabels = { MDE: 'MDe', XML: 'XML', ACCESS_KEY: 'Chave', RECEIPT_PHOTO: 'Foto' }
function sourceLabel(src) { return sourceLabels[src] || src }
function sourceBadgeClass(src) {
  const map = { MDE: 'badge bg-primary', XML: 'badge bg-info', ACCESS_KEY: 'badge bg-secondary', RECEIPT_PHOTO: 'badge bg-warning' }
  return map[src] || 'badge bg-secondary'
}

// Status badge helpers
const statusLabels = { PENDING: 'Pendente', MATCHED: 'Matched', APPLIED: 'Aplicado', ERROR: 'Erro' }
function statusLabel(s) { return statusLabels[s] || s }
function statusBadgeClass(s) {
  const map = { PENDING: 'badge bg-warning', MATCHED: 'badge bg-info', APPLIED: 'badge bg-success', ERROR: 'badge bg-danger' }
  return map[s] || 'badge bg-secondary'
}

function formatCurrency(n) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(n || 0))
}

function formatDate(d) {
  try { return new Date(d).toLocaleString() } catch { return d }
}

// Expose load for external components (e.g., modal triggering reload)
defineExpose({ load })

onMounted(async () => {
  await loadStores()
  await Promise.all([load(), loadMdeStatus()])
})
</script>

<style scoped>
.spin {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
