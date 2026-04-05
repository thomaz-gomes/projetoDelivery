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
        <h6 class="mb-3"><i class="bi bi-cloud-download me-2"></i>Sincronizacao MDe <span class="badge bg-success ms-2" style="font-size:10px">Auto 30min</span></h6>
        <div class="alert alert-warning d-flex align-items-start gap-2 mb-3" role="alert">
          <i class="bi bi-exclamation-triangle-fill fs-5 mt-1"></i>
          <div>
            <strong>Atenção:</strong> Para sincronizar com a SEFAZ, os
            <router-link to="/settings/dados-fiscais" class="alert-link">dados fiscais</router-link>
            devem estar corretamente preenchidos e validados, incluindo o
            <strong>certificado digital</strong>.
          </div>
        </div>
        <div class="row g-2">
          <div v-for="s in stores" :key="'mde-' + s.id" class="col-md-4">
            <div class="border rounded p-2">
              <div class="d-flex justify-content-between align-items-center">
                <div>
                  <strong>{{ s.name }}</strong>
                  <div class="small text-muted" v-if="mdeStatus[s.id]">
                    <span v-if="mdeStatus[s.id].lastSyncAt">Ultima sync: {{ formatDate(mdeStatus[s.id].lastSyncAt) }}</span>
                    <span v-else-if="mdeStatus[s.id].lastSync">Ultima sync: {{ formatDate(mdeStatus[s.id].lastSync) }}</span>
                    <span v-else>Nunca sincronizado</span>
                    <span v-if="mdeStatus[s.id].pendingCount" class="ms-2 badge bg-warning">{{ mdeStatus[s.id].pendingCount }} pendentes</span>
                  </div>
                  <div class="small text-muted" v-else>Sem dados de sync</div>
                </div>
                <button
                  v-if="mdeStatus[s.id]?.activated"
                  class="btn btn-sm btn-outline-primary"
                  :disabled="mdeStatus[s.id]?.status === 'syncing' || mdeStatus[s.id]?.status === 'queued'"
                  @click="syncMde(s.id)"
                >
                  <i class="bi bi-arrow-repeat me-1" :class="{ 'spin': mdeStatus[s.id]?.status === 'syncing' }"></i>Sincronizar
                </button>
                <button
                  v-else
                  class="btn btn-sm btn-primary"
                  :disabled="syncingStore === s.id"
                  @click="activateMde(s.id)"
                >
                  <i class="bi bi-power me-1" :class="{ 'spin': syncingStore === s.id }"></i>Ativar
                </button>
              </div>
              <!-- Queue status indicators -->
              <div v-if="mdeStatus[s.id]?.status === 'syncing'" class="small text-primary mt-1">
                <i class="bi bi-arrow-repeat spin me-1"></i>Sincronizando com SEFAZ...
              </div>
              <div v-else-if="mdeStatus[s.id]?.status === 'queued'" class="small text-info mt-1">
                <i class="bi bi-clock me-1"></i>Na fila (posicao {{ mdeStatus[s.id].queuePosition }})
              </div>
              <div v-else-if="mdeStatus[s.id]?.status === 'backoff'" class="small text-warning mt-1">
                <i class="bi bi-exclamation-triangle me-1"></i>Limite SEFAZ — aguardando {{ mdeStatus[s.id].backoffMinutes }}min
              </div>
              <div v-if="mdeStatus[s.id]?.lastError && mdeStatus[s.id]?.status !== 'backoff'" class="small text-danger mt-1">
                <i class="bi bi-x-circle me-1"></i>{{ mdeStatus[s.id].lastError }}
              </div>
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
                <td class="text-end">
                  <div class="d-flex gap-1 justify-content-end">
                    <button v-if="row.status === 'PENDING' && isResNFe(row)" class="btn btn-sm btn-outline-warning" :disabled="processingId === row.id" @click="fetchXml(row)">
                      <i class="bi bi-cloud-download me-1"></i>Buscar XML
                    </button>
                    <button v-else-if="row.status === 'PENDING'" class="btn btn-sm btn-outline-primary" :disabled="processingId === row.id" @click="processMatch(row)">
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
                    <button
                      v-if="['PENDING', 'ERROR', 'MATCHED'].includes(row.status)"
                      class="btn btn-sm btn-outline-danger"
                      title="Excluir importacao"
                      @click="deleteImport(row)"
                    >
                      <i class="bi bi-trash"></i>
                    </button>
                  </div>
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
import { ref, computed, onMounted, onUnmounted } from 'vue'
import Swal from 'sweetalert2'
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

async function activateMde(storeId) {
  syncingStore.value = storeId
  Swal.fire({ title: 'Ativando sincronizacao...', text: 'Validando configuracao da loja', allowOutsideClick: false, didOpen: () => Swal.showLoading() })
  try {
    await api.post('/purchase-imports/mde/activate', { storeId })
    try {
      const { data } = await api.get('/purchase-imports/mde/status', { params: { storeId } })
      mdeStatus.value[storeId] = data
    } catch { /* ignore */ }
    Swal.fire({ icon: 'success', title: 'Sincronizacao ativada', text: 'Clique em "Iniciar sincronizacao" para buscar as notas fiscais.', confirmButtonColor: '#105784' })
  } catch (e) {
    console.error('MDe activate failed', e?.message || e)
    Swal.fire({ icon: 'error', text: e?.response?.data?.message || e?.message || 'Erro ao ativar MDe' })
  } finally {
    syncingStore.value = null
  }
}

async function syncMde(storeId) {
  try {
    const { data: result } = await api.post('/purchase-imports/mde/sync', { storeId })
    if (result.queued) {
      // Update local status immediately
      mdeStatus.value[storeId] = { ...mdeStatus.value[storeId], status: 'queued', queuePosition: result.position }
      Swal.fire({
        icon: 'info',
        title: 'Sincronizacao agendada',
        text: result.reason === 'already_queued'
          ? 'Ja existe uma sincronizacao na fila para esta loja.'
          : `Posicao na fila: ${result.position}. O processo roda em segundo plano.`,
        timer: 3000,
        showConfirmButton: false,
      })
      startStatusPolling(storeId)
    } else if (result.reason === 'backoff') {
      mdeStatus.value[storeId] = { ...mdeStatus.value[storeId], status: 'backoff', backoffMinutes: result.waitMinutes }
      Swal.fire({
        icon: 'warning',
        title: 'Aguardando cooldown',
        text: `A SEFAZ exige intervalo entre consultas. Tente novamente em ${result.waitMinutes} minuto(s).`,
        confirmButtonColor: '#105784',
      })
    }
  } catch (e) {
    console.error('MDe sync failed', e?.message || e)
    Swal.fire({ icon: 'error', text: e?.response?.data?.message || e?.message || 'Erro ao sincronizar MDe' })
  }
}

async function deleteImport(row) {
  const result = await Swal.fire({
    title: 'Excluir importacao?',
    text: row.supplierName ? `Fornecedor: ${row.supplierName}` : 'Esta acao e irreversivel.',
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: 'Excluir',
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#dc3545',
  })
  if (!result.isConfirmed) return
  try {
    await api.delete(`/purchase-imports/${row.id}`)
    Swal.fire({ icon: 'success', text: 'Importacao excluida', timer: 1500, showConfirmButton: false })
    await load()
  } catch (e) {
    console.error('Delete import failed', e?.message || e)
    Swal.fire({ icon: 'error', text: e?.response?.data?.message || e?.message || 'Erro ao excluir' })
  }
}

function isResNFe(row) {
  // resNFe imports have parsedItems._type === 'resNFe' (no item details)
  return row.parsedItems?._type === 'resNFe'
}

async function fetchXml(row) {
  try {
    const { data } = await api.post(`/purchase-imports/${row.id}/fetch-xml`)
    if (data.queued) {
      Swal.fire({
        icon: 'info',
        title: 'Busca de XML agendada',
        text: 'A busca sera processada em segundo plano.',
        timer: 2000,
        showConfirmButton: false,
      })
      if (row.storeId) startStatusPolling(row.storeId)
    }
  } catch (e) {
    console.error('Fetch XML failed', e?.message || e)
    Swal.fire({ icon: 'error', text: e?.response?.data?.message || e?.message || 'Erro ao buscar XML completo' })
  }
}

async function processMatch(row) {
  processingId.value = row.id
  try {
    await api.post(`/purchase-imports/${row.id}/match`)
    await load()
  } catch (e) {
    console.error('AI match failed', e?.message || e)
    Swal.fire({ icon: 'error', text: e?.response?.data?.message || e?.response?.data?.error || e?.message || 'Erro ao processar matching' })
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

// ── Status polling for background sync ──────────────────────────────────────
const pollingTimers = new Map() // storeId -> intervalId

function startStatusPolling(storeId) {
  if (pollingTimers.has(storeId)) return // already polling
  const timer = setInterval(async () => {
    try {
      const { data } = await api.get('/purchase-imports/mde/status', { params: { storeId } })
      const prevStatus = mdeStatus.value[storeId]?.status
      mdeStatus.value[storeId] = data

      // If transitioned from syncing/queued to idle, refresh list and stop polling
      if ((prevStatus === 'syncing' || prevStatus === 'queued') && data.status === 'idle') {
        await load()
        if (data.newImports > 0) {
          Swal.fire({ icon: 'success', title: `${data.newImports} nota(s) importada(s)`, timer: 3000, showConfirmButton: false })
        } else if (data.fetchXmlResult?.itemCount > 0) {
          Swal.fire({ icon: 'success', title: 'XML obtido', text: `${data.fetchXmlResult.itemCount} item(ns) encontrado(s)`, timer: 3000, showConfirmButton: false })
        } else {
          Swal.fire({ icon: 'info', title: 'Sincronizacao concluida', text: 'Nenhum documento novo encontrado na SEFAZ.', timer: 3000, showConfirmButton: false })
        }
        stopStatusPolling(storeId)
      }
    } catch { /* ignore */ }
  }, 5000)
  pollingTimers.set(storeId, timer)
}

function stopStatusPolling(storeId) {
  const timer = pollingTimers.get(storeId)
  if (timer) {
    clearInterval(timer)
    pollingTimers.delete(storeId)
  }
}

function stopAllPolling() {
  for (const [storeId] of pollingTimers) stopStatusPolling(storeId)
}

// Expose load for external components (e.g., modal triggering reload)
defineExpose({ load })

onMounted(async () => {
  await loadStores()
  await Promise.all([load(), loadMdeStatus()])

  // Start polling for any stores that are currently syncing/queued
  for (const s of stores.value) {
    const status = mdeStatus.value[s.id]?.status
    if (status === 'syncing' || status === 'queued') {
      startStatusPolling(s.id)
    }
  }
})

onUnmounted(() => {
  stopAllPolling()
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
