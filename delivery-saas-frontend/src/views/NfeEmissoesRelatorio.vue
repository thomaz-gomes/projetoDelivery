<template>
  <div class="container-fluid py-3">

    <!-- Alert toast -->
    <div v-if="alert.show" :class="`alert alert-${alert.type} alert-dismissible`" role="alert">
      {{ alert.msg }}
      <button type="button" class="btn-close" @click="alert.show = false"></button>
    </div>

    <!-- Filtros -->
    <div class="card mb-3">
      <div class="card-body">
        <div class="row g-2 align-items-end">
          <div class="col-md-2">
            <label class="form-label small mb-1">De</label>
            <DateInput v-model="filters.from" inputClass="form-control form-control-sm" />
          </div>
          <div class="col-md-2">
            <label class="form-label small mb-1">Até</label>
            <DateInput v-model="filters.to" inputClass="form-control form-control-sm" />
          </div>
          <div class="col-md-2">
            <label class="form-label small mb-1">Status</label>
            <SelectInput v-model="filters.status" :options="statusOptions"
              optionValueKey="value" optionLabelKey="label"
              placeholder="Todos" inputClass="form-control form-control-sm" />
          </div>
          <div class="col-md-3">
            <label class="form-label small mb-1">Buscar (cliente / nProt)</label>
            <input v-model="filters.search" type="text" class="form-control form-control-sm"
              placeholder="Nome do cliente ou nº protocolo" @keydown.enter="load" />
          </div>
          <div class="col-md-3 d-flex gap-2">
            <button class="btn btn-sm btn-primary" @click="load" :disabled="loading">
              <i class="bi bi-search me-1"></i>Buscar
            </button>
            <button class="btn btn-sm btn-outline-secondary" @click="reset">Limpar</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Tabela -->
    <ListCard title="Notas Fiscais Emitidas" icon="bi bi-receipt">
      <template #actions>
        <span class="text-muted small">{{ total }} nota(s)</span>
      </template>

      <div class="table-responsive">
        <table class="table table-hover table-sm mb-0">
          <thead class="table-light">
            <tr>
              <th>Data/Hora</th>
              <th>Cliente</th>
              <th>Valor</th>
              <th>nNF / Série</th>
              <th>nProt</th>
              <th>Ambiente</th>
              <th>Status</th>
              <th class="text-end">Ações</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading">
              <td colspan="8" class="text-center py-4 text-muted">
                <i class="bi bi-hourglass-split me-1"></i> Carregando...
              </td>
            </tr>
            <tr v-else-if="rows.length === 0">
              <td colspan="8" class="text-center py-4 text-muted">Nenhuma nota encontrada.</td>
            </tr>
            <tr v-for="row in paginatedRows" :key="row.id">
              <td class="text-nowrap">{{ formatDt(row.createdAt) }}</td>
              <td>{{ row.order?.customerName || '—' }}</td>
              <td class="text-nowrap">{{ fmtCurrency(row.order?.total) }}</td>
              <td class="text-nowrap">
                <span v-if="extractNNF(row)">{{ extractNNF(row) }}</span>
                <span v-else class="text-muted small">—</span>
              </td>
              <td class="font-monospace small text-nowrap">{{ row.nProt || '—' }}</td>
              <td>
                <span v-if="row.order?.payload?.nfe?.tpAmb === '1' || isProducao(row)"
                  class="badge bg-success bg-opacity-75">Produção</span>
                <span v-else class="badge bg-warning text-dark bg-opacity-75">Homologação</span>
              </td>
              <td>
                <span :class="statusBadge(row.cStat)">{{ row.cStat }} {{ statusLabel(row.cStat) }}</span>
              </td>
              <td class="text-end text-nowrap">
                <!-- Ver/Baixar XML -->
                <button class="btn btn-sm btn-outline-secondary me-1"
                  title="Baixar XML" @click="downloadXml(row)"
                  :disabled="!row.rawXml">
                  <i class="bi bi-file-earmark-code"></i>
                </button>
                <!-- Imprimir DANFE -->
                <button class="btn btn-sm btn-outline-secondary me-1"
                  title="Imprimir DANFE" @click="openDanfe(row)">
                  <i class="bi bi-printer"></i>
                </button>
                <!-- Re-emitir -->
                <button class="btn btn-sm btn-outline-primary me-1"
                  title="Re-emitir" @click="reemitir(row)"
                  :disabled="!row.orderId || actionLoading === row.id">
                  <i class="bi bi-arrow-repeat"></i>
                </button>
                <!-- Enviar e-mail -->
                <button class="btn btn-sm btn-outline-info me-1"
                  title="Enviar por e-mail" @click="openEmail(row)"
                  :disabled="!row.rawXml">
                  <i class="bi bi-envelope"></i>
                </button>
                <!-- Cancelar -->
                <button class="btn btn-sm btn-outline-danger"
                  title="Cancelar NF-e" @click="openCancel(row)"
                  :disabled="row.cStat === 'CANCELADA'">
                  <i class="bi bi-x-circle"></i>
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Paginação -->
      <div v-if="totalPages > 1" class="d-flex justify-content-between align-items-center p-3 border-top">
        <div class="text-muted small">
          Mostrando {{ (currentPage - 1) * perPage + 1 }}–{{ Math.min(currentPage * perPage, rows.length) }}
          de {{ rows.length }}
        </div>
        <nav>
          <ul class="pagination pagination-sm mb-0">
            <li class="page-item" :class="{ disabled: currentPage === 1 }">
              <button class="page-link" @click="currentPage = 1">«</button>
            </li>
            <li class="page-item" :class="{ disabled: currentPage === 1 }">
              <button class="page-link" @click="currentPage--">‹</button>
            </li>
            <li v-for="pg in visiblePages" :key="pg"
              class="page-item" :class="{ active: currentPage === pg, disabled: pg === '...' }">
              <button class="page-link" @click="pg !== '...' && (currentPage = pg)">{{ pg }}</button>
            </li>
            <li class="page-item" :class="{ disabled: currentPage === totalPages }">
              <button class="page-link" @click="currentPage++">›</button>
            </li>
            <li class="page-item" :class="{ disabled: currentPage === totalPages }">
              <button class="page-link" @click="currentPage = totalPages">»</button>
            </li>
          </ul>
        </nav>
      </div>
    </ListCard>

    <!-- ── Modal: Cancelar ── -->
    <div v-if="cancelModal.show" class="modal d-block" tabindex="-1" style="background:rgba(0,0,0,.5)">
      <div class="modal-dialog">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title"><i class="bi bi-x-circle text-danger me-2"></i>Cancelar NF-e</h5>
            <button class="btn-close" @click="cancelModal.show = false"></button>
          </div>
          <div class="modal-body">
            <div class="alert alert-warning small">
              <i class="bi bi-exclamation-triangle me-1"></i>
              O cancelamento altera o status localmente. A comunicação de cancelamento à SEFAZ será implementada em breve.
            </div>
            <div class="mb-3">
              <strong>Protocolo:</strong> {{ cancelModal.row?.nProt || cancelModal.row?.id }}<br>
              <strong>Cliente:</strong> {{ cancelModal.row?.order?.customerName || '—' }}
            </div>
            <label class="form-label">Motivo do cancelamento <span class="text-muted small">(mínimo 15 caracteres)</span></label>
            <textarea v-model="cancelModal.motivo" class="form-control" rows="3"
              placeholder="Ex: Erro na emissão, pedido cancelado pelo cliente..."></textarea>
            <div v-if="cancelModal.motivo.length > 0 && cancelModal.motivo.length < 15"
              class="text-danger small mt-1">
              {{ cancelModal.motivo.length }}/15 caracteres mínimos
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-outline-secondary" @click="cancelModal.show = false">Fechar</button>
            <button class="btn btn-danger" @click="confirmCancel"
              :disabled="cancelModal.motivo.length < 15 || cancelModal.loading">
              <span v-if="cancelModal.loading" class="spinner-border spinner-border-sm me-1"></span>
              Confirmar Cancelamento
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- ── Modal: Enviar E-mail ── -->
    <div v-if="emailModal.show" class="modal d-block" tabindex="-1" style="background:rgba(0,0,0,.5)">
      <div class="modal-dialog">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title"><i class="bi bi-envelope me-2"></i>Enviar XML por E-mail</h5>
            <button class="btn-close" @click="emailModal.show = false"></button>
          </div>
          <div class="modal-body">
            <div class="mb-3">
              <strong>Protocolo:</strong> {{ emailModal.row?.nProt || emailModal.row?.id }}<br>
              <strong>Cliente:</strong> {{ emailModal.row?.order?.customerName || '—' }}
            </div>
            <label class="form-label">E-mail do destinatário</label>
            <input v-model="emailModal.email" type="email" class="form-control"
              placeholder="cliente@email.com" />
          </div>
          <div class="modal-footer">
            <button class="btn btn-outline-secondary" @click="emailModal.show = false">Fechar</button>
            <button class="btn btn-primary" @click="sendEmail"
              :disabled="!emailModal.email || emailModal.loading">
              <span v-if="emailModal.loading" class="spinner-border spinner-border-sm me-1"></span>
              <i v-else class="bi bi-send me-1"></i>Enviar
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- ── Modal: DANFE ── -->
    <div v-if="danfeModal.show" class="modal d-block" tabindex="-1" style="background:rgba(0,0,0,.5)">
      <div class="modal-dialog modal-lg">
        <div class="modal-content">
          <div class="modal-header d-print-none">
            <h5 class="modal-title"><i class="bi bi-receipt me-2"></i>DANFE NFC-e</h5>
            <div class="ms-auto d-flex gap-2">
              <button class="btn btn-sm btn-primary" @click="printDanfe">
                <i class="bi bi-printer me-1"></i>Imprimir
              </button>
              <button class="btn-close" @click="danfeModal.show = false"></button>
            </div>
          </div>
          <div class="modal-body" id="danfe-print-area">
            <div v-if="danfeModal.row" class="danfe-cupom mx-auto">
              <div class="text-center mb-2">
                <div class="fw-bold fs-6">{{ danfeModal.emitNome }}</div>
                <div class="small text-muted">CNPJ: {{ fmtCnpj(danfeModal.emitCnpj) }}</div>
                <div class="small text-muted">{{ danfeModal.emitEnder }}</div>
                <hr class="my-1">
                <div class="fw-semibold">DANFE NFC-e</div>
                <div class="small text-muted">Documento Auxiliar da Nota Fiscal de Consumidor Eletrônica</div>
                <hr class="my-1">
              </div>

              <!-- Itens -->
              <table class="table table-sm table-borderless mb-1" style="font-size:0.78rem">
                <thead><tr><th>#</th><th>Produto</th><th class="text-end">Qtd</th><th class="text-end">Unit</th><th class="text-end">Total</th></tr></thead>
                <tbody>
                  <tr v-for="(it, i) in danfeModal.items" :key="i">
                    <td>{{ i+1 }}</td>
                    <td>{{ it.name }}</td>
                    <td class="text-end">{{ it.qty }}</td>
                    <td class="text-end">{{ fmtCurrency(it.price) }}</td>
                    <td class="text-end">{{ fmtCurrency(it.total) }}</td>
                  </tr>
                </tbody>
              </table>
              <hr class="my-1">

              <!-- Totais -->
              <div class="d-flex justify-content-between small"><span>Subtotal</span><span>{{ fmtCurrency(danfeModal.row.order?.total) }}</span></div>
              <div class="d-flex justify-content-between fw-bold"><span>TOTAL</span><span>{{ fmtCurrency(danfeModal.row.order?.total) }}</span></div>
              <hr class="my-1">

              <!-- Consumidor -->
              <div class="small text-muted mb-1">
                <span v-if="danfeModal.row.order?.customerName">Consumidor: {{ danfeModal.row.order.customerName }}</span>
                <span v-else>Consumidor: Não identificado</span>
              </div>

              <!-- NF-e info -->
              <hr class="my-1">
              <div class="small text-muted text-center">
                <div>NF-e nº {{ extractNNF(danfeModal.row) || '—' }}</div>
                <div v-if="danfeModal.row.nProt">Protocolo: {{ danfeModal.row.nProt }}</div>
                <div>Emissão: {{ formatDt(danfeModal.row.createdAt) }}</div>
              </div>

              <!-- QR Code placeholder -->
              <div class="text-center mt-2 small text-muted">
                <i class="bi bi-qr-code" style="font-size:2rem"></i>
                <div class="mt-1">Consulte a NF-e pelo QR Code ou chave de acesso</div>
              </div>

              <div class="text-center mt-2 small fw-semibold">
                <span v-if="danfeModal.row.order?.payload?.nfe?.tpAmb === '2'" class="text-warning">
                  EMITIDA EM AMBIENTE DE HOMOLOGAÇÃO — SEM VALOR FISCAL
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import api from '../api'
import ListCard from '../components/ListCard.vue'
import DateInput from '../components/form/date/DateInput.vue'
import SelectInput from '../components/form/select/SelectInput.vue'
import { formatDate } from '../utils/dates.js'

// ── State ────────────────────────────────────────────────────────────────────
const rows       = ref([])
const total      = ref(0)
const loading    = ref(false)
const actionLoading = ref(null)
const currentPage = ref(1)
const perPage    = 20

const filters = ref({ from: '', to: '', status: '', search: '' })

const alert = ref({ show: false, type: 'success', msg: '' })

const cancelModal = ref({ show: false, row: null, motivo: '', loading: false })
const emailModal  = ref({ show: false, row: null, email: '',  loading: false })
const danfeModal  = ref({ show: false, row: null, items: [], emitNome: '', emitCnpj: '', emitEnder: '' })

const statusOptions = [
  { value: '', label: 'Todos' },
  { value: '100', label: 'Autorizada (100)' },
  { value: 'CANCELADA', label: 'Cancelada' },
]

// ── Pagination ───────────────────────────────────────────────────────────────
const totalPages = computed(() => Math.ceil(rows.value.length / perPage))

const paginatedRows = computed(() => {
  const s = (currentPage.value - 1) * perPage
  return rows.value.slice(s, s + perPage)
})

const visiblePages = computed(() => {
  const tot = totalPages.value
  const cur = currentPage.value
  if (tot <= 7) return Array.from({ length: tot }, (_, i) => i + 1)
  if (cur <= 4) return [1, 2, 3, 4, 5, '...', tot]
  if (cur >= tot - 3) return [1, '...', tot-4, tot-3, tot-2, tot-1, tot]
  return [1, '...', cur-1, cur, cur+1, '...', tot]
})

// ── Helpers ──────────────────────────────────────────────────────────────────
function showAlert(type, msg) {
  alert.value = { show: true, type, msg }
  setTimeout(() => { alert.value.show = false }, 5000)
}

function formatDt(dt) {
  if (!dt) return '—'
  try {
    return new Date(dt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  } catch { return dt }
}

function fmtCurrency(v) {
  const n = Number(v || 0)
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function fmtCnpj(v) {
  if (!v) return ''
  const d = String(v).replace(/\D/g, '')
  return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
}

function statusBadge(cStat) {
  if (cStat === '100') return 'badge bg-success'
  if (cStat === 'CANCELADA') return 'badge bg-secondary'
  return 'badge bg-danger'
}

function statusLabel(cStat) {
  if (cStat === '100') return '— Autorizada'
  if (cStat === 'CANCELADA') return '— Cancelada'
  return '— Rejeitada'
}

function isProducao(row) {
  // try to infer environment from rawXml tpAmb tag
  if (!row.rawXml) return false
  return /<tpAmb>1<\/tpAmb>/.test(row.rawXml)
}

function extractNNF(row) {
  if (!row.rawXml) return null
  const m = row.rawXml.match(/<nNF>(\d+)<\/nNF>/)
  return m ? m[1] : null
}

// ── Load data ─────────────────────────────────────────────────────────────────
async function load() {
  loading.value = true
  currentPage.value = 1
  try {
    const params = {}
    if (filters.value.from)   params.from   = filters.value.from
    if (filters.value.to)     params.to     = filters.value.to
    if (filters.value.status) params.status = filters.value.status
    if (filters.value.search) params.search = filters.value.search
    params.limit = 200 // fetch up to 200, paginate client-side

    const { data } = await api.get('/nfe/emitidas', { params })
    rows.value  = Array.isArray(data.data) ? data.data : []
    total.value = data.pagination?.total || rows.value.length
  } catch (e) {
    showAlert('danger', 'Erro ao carregar notas: ' + (e?.response?.data?.error || e?.message || 'Erro desconhecido'))
    rows.value = []
  } finally {
    loading.value = false
  }
}

function reset() {
  filters.value = { from: '', to: '', status: '', search: '' }
  rows.value = []
  total.value = 0
  currentPage.value = 1
}

// ── Actions ───────────────────────────────────────────────────────────────────
async function downloadXml(row) {
  try {
    const resp = await api.get(`/nfe/xml/${row.id}`, { responseType: 'blob' })
    const url = URL.createObjectURL(new Blob([resp.data], { type: 'application/xml' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `nfe-${row.nProt || row.id}.xml`
    a.click()
    URL.revokeObjectURL(url)
  } catch (e) {
    showAlert('danger', 'Erro ao baixar XML: ' + (e?.response?.data?.error || e?.message || 'Erro'))
  }
}

async function reemitir(row) {
  if (!row.orderId) return showAlert('warning', 'Esta nota não está vinculada a um pedido.')
  if (!confirm(`Re-emitir NF-e para o pedido ${row.orderId}?`)) return
  actionLoading.value = row.id
  try {
    const { data } = await api.post('/nfe/emit-from-order', { orderId: row.orderId })
    if (data.success) {
      showAlert('success', `NF-e re-emitida com sucesso! Protocolo: ${data.nProt}`)
      await load()
    } else {
      showAlert('warning', `SEFAZ: ${data.cStat} — ${data.xMotivo}`)
    }
  } catch (e) {
    showAlert('danger', 'Erro ao re-emitir: ' + (e?.response?.data?.error || e?.message || 'Erro'))
  } finally {
    actionLoading.value = null
  }
}

function openCancel(row) {
  cancelModal.value = { show: true, row, motivo: '', loading: false }
}

async function confirmCancel() {
  cancelModal.value.loading = true
  try {
    await api.post('/nfe/cancelar', {
      nfeProtocolId: cancelModal.value.row.id,
      motivo: cancelModal.value.motivo
    })
    showAlert('success', 'NF-e cancelada com sucesso.')
    cancelModal.value.show = false
    await load()
  } catch (e) {
    showAlert('danger', 'Erro ao cancelar: ' + (e?.response?.data?.error || e?.message || 'Erro'))
  } finally {
    cancelModal.value.loading = false
  }
}

function openEmail(row) {
  const email = row.order?.payload?.customer?.email || row.order?.payload?.rawPayload?.customer?.email || ''
  emailModal.value = { show: true, row, email, loading: false }
}

async function sendEmail() {
  emailModal.value.loading = true
  try {
    await api.post('/nfe/enviar-email', {
      nfeProtocolId: emailModal.value.row.id,
      email: emailModal.value.email
    })
    showAlert('success', 'E-mail enviado com sucesso.')
    emailModal.value.show = false
  } catch (e) {
    showAlert('warning', e?.response?.data?.error || 'Serviço de e-mail não disponível.')
    emailModal.value.show = false
  } finally {
    emailModal.value.loading = false
  }
}

function openDanfe(row) {
  // Build items list from order payload
  const items = []
  try {
    const payload = row.order?.payload || {}
    const rawItems = payload.items || payload.rawPayload?.items || []
    for (const it of rawItems) {
      items.push({
        name: it.name || it.xProd || 'Produto',
        qty: Number(it.quantity || it.qCom || 1),
        price: Number(it.price || it.vUnCom || 0),
        total: Number(it.quantity || 1) * Number(it.price || 0)
      })
    }
  } catch { /* ignore */ }

  // Try to extract emitente info from rawXml
  let emitNome = '', emitCnpj = '', emitEnder = ''
  if (row.rawXml) {
    const nm = row.rawXml.match(/<xNome>(.*?)<\/xNome>/)
    const cn = row.rawXml.match(/<CNPJ>(.*?)<\/CNPJ>/)
    const lg = row.rawXml.match(/<xLgr>(.*?)<\/xLgr>/)
    const nr = row.rawXml.match(/<nro>(.*?)<\/nro>/)
    const mn = row.rawXml.match(/<xMun>(.*?)<\/xMun>/)
    emitNome = nm ? nm[1] : ''
    emitCnpj = cn ? cn[1] : ''
    emitEnder = [lg?.[1], nr?.[1], mn?.[1]].filter(Boolean).join(', ')
  }

  danfeModal.value = { show: true, row, items, emitNome, emitCnpj, emitEnder }
}

function printDanfe() {
  const el = document.getElementById('danfe-print-area')
  if (!el) return
  const w = window.open('', '_blank', 'width=400,height=700')
  w.document.write(`<html><head><title>DANFE NFC-e</title>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css">
    <style>body{font-size:12px;} .danfe-cupom{max-width:300px;margin:0 auto;}</style>
    </head><body>`)
  w.document.write(el.innerHTML)
  w.document.write('</body></html>')
  w.document.close()
  w.focus()
  setTimeout(() => { w.print(); w.close() }, 400)
}

onMounted(load)
</script>

<style scoped>
.danfe-cupom {
  max-width: 320px;
  font-size: 0.82rem;
}
</style>
