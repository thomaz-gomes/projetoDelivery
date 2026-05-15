<template>
  <div class="container-fluid py-3">

    <!-- Alert toast -->
    <div v-if="alert.show" :class="`alert alert-${alert.type} alert-dismissible`" role="alert">
      {{ alert.msg }}
      <button type="button" class="btn-close" @click="alert.show = false"></button>
    </div>

    <!-- Aviso dados fiscais -->
    <div class="alert alert-warning d-flex align-items-start gap-2" role="alert">
      <i class="bi bi-exclamation-triangle-fill fs-5 mt-1"></i>
      <div>
        <strong>Atenção:</strong> Antes de emitir notas fiscais, verifique se os
        <router-link to="/settings/dados-fiscais" class="alert-link">dados fiscais</router-link>
        estão corretamente preenchidos e validados, incluindo o
        <strong>certificado digital</strong>.
      </div>
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
              <!-- ── Cabeçalho ────────────────────────────────────────── -->
              <div class="text-center">
                <div class="danfe-store-name">{{ danfeData.storeName }}</div>
                <div class="danfe-small">
                  CNPJ: {{ fmtCnpj(danfeData.cnpj) }}<span v-if="danfeData.razao"> {{ danfeData.razao }}</span>
                </div>
                <div class="danfe-small">{{ danfeData.fullAddress }}</div>
                <div class="danfe-small">
                  <span v-if="danfeData.fone">Fone: {{ danfeData.fone }}</span>
                  <span v-if="danfeData.fone && danfeData.ie"> &nbsp;</span>
                  <span v-if="danfeData.ie">I.E.: {{ danfeData.ie }}</span>
                </div>
                <div class="danfe-small mt-1">DOCUMENTO AUXILIAR DA NOTA FISCAL DE CONSUMIDOR ELETRONICA</div>
              </div>

              <!-- ── Itens ────────────────────────────────────────────── -->
              <table class="danfe-items-table mt-2">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Cód</th>
                    <th>Descrição</th>
                    <th class="text-end">Qtd</th>
                    <th class="text-end">Un</th>
                    <th class="text-end">Vl Unit.</th>
                    <th class="text-end">Vl Total</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-if="danfeModal.items.length === 0">
                    <td colspan="7" class="text-center text-muted py-2 danfe-small">Sem itens</td>
                  </tr>
                  <tr v-for="(it, i) in danfeModal.items" :key="i">
                    <td>{{ String(i + 1).padStart(3, '0') }}</td>
                    <td>{{ (it.id || '').slice(0, 8) || '—' }}</td>
                    <td>{{ it.name }}</td>
                    <td class="text-end">{{ it.qty }}</td>
                    <td class="text-end">UN</td>
                    <td class="text-end">{{ fmtCurrency(it.price) }}</td>
                    <td class="text-end">{{ fmtCurrency(it.total) }}</td>
                  </tr>
                </tbody>
              </table>

              <!-- ── Totais ──────────────────────────────────────────── -->
              <div class="danfe-totals mt-2">
                <div class="d-flex justify-content-between">
                  <span class="fw-bold">QTD. TOTAL DE ITENS</span>
                  <span class="fw-bold">{{ String(danfeData.totalItens).padStart(3, '0') }}</span>
                </div>
                <div class="d-flex justify-content-between">
                  <span class="fw-bold">VALOR TOTAL R$</span>
                  <span class="fw-bold">{{ fmtNumber(danfeData.subtotal) }}</span>
                </div>
                <div v-if="danfeData.desconto > 0" class="d-flex justify-content-between danfe-small">
                  <span>Descontos R$</span>
                  <span>- {{ fmtNumber(danfeData.desconto) }}</span>
                </div>
                <div v-if="danfeData.acrescimo > 0" class="d-flex justify-content-between danfe-small">
                  <span>Acréscimos R$</span>
                  <span>+ {{ fmtNumber(danfeData.acrescimo) }}</span>
                </div>
                <div class="d-flex justify-content-between mt-1">
                  <span class="fw-bold">VALOR A PAGAR R$</span>
                  <span class="fw-bold">{{ fmtNumber(danfeData.valorPagar) }}</span>
                </div>
              </div>

              <!-- ── Formas de Pagamento ─────────────────────────────── -->
              <div class="danfe-payments mt-2">
                <div class="d-flex justify-content-between">
                  <span class="fw-bold">FORMA DE PAGAMENTO</span>
                  <span class="fw-bold danfe-small">Valor Pago</span>
                </div>
                <div v-for="(pay, i) in danfeData.payments" :key="i" class="d-flex justify-content-between danfe-small">
                  <span>{{ pay.label }}</span>
                  <span>{{ fmtNumber(pay.value) }}</span>
                </div>
                <div v-if="danfeData.troco > 0" class="d-flex justify-content-between danfe-small">
                  <span>Troco</span>
                  <span>{{ fmtNumber(danfeData.troco) }}</span>
                </div>
              </div>

              <!-- ── Chave de Acesso ─────────────────────────────────── -->
              <div class="mt-3 text-center danfe-small">
                <div>Consulte pela Chave de Acesso em</div>
                <div class="danfe-url">{{ danfeData.consultaUrl }}</div>
                <div class="danfe-chave mt-1">{{ fmtChave(danfeModal.row.chNFe) }}</div>
              </div>

              <!-- ── QR Code + Info NFC-e ────────────────────────────── -->
              <div class="d-flex justify-content-between align-items-start mt-2 gap-2">
                <div class="danfe-qr">
                  <canvas ref="qrCanvas" width="180" height="180"></canvas>
                </div>
                <div class="danfe-nfe-info danfe-small text-end">
                  <div class="fw-semibold">
                    <span v-if="danfeData.consumerName">{{ danfeData.consumerName }}</span>
                    <span v-else>CONSUMIDOR NÃO IDENTIFICADO</span>
                  </div>
                  <div class="mt-1">NFC-e nº {{ danfeData.nNF }}</div>
                  <div>Série {{ danfeData.serie }}</div>
                  <div>{{ formatDt(danfeModal.row.dhRecbto || danfeModal.row.createdAt) }}</div>
                  <div class="mt-1">Protocolo de Autorização:</div>
                  <div>{{ danfeModal.row.nProt || '—' }}</div>
                </div>
              </div>

              <!-- ── Tributos (IBPT) ─────────────────────────────────── -->
              <div class="mt-3 danfe-small text-center">
                <div v-if="danfeData.deliveryFee > 0">Taxa de entrega: {{ fmtCurrency(danfeData.deliveryFee) }}.</div>
                <div>
                  Tributos Aproximados — Total {{ fmtCurrency(danfeData.tributos.total) }}.
                  Federal {{ fmtCurrency(danfeData.tributos.federal) }}.
                  Estadual {{ fmtCurrency(danfeData.tributos.estadual) }}.
                  Municipal {{ fmtCurrency(danfeData.tributos.municipal) }}.
                  Fonte IBPT
                </div>
              </div>

              <div v-if="danfeData.isHomolog" class="text-center mt-2 fw-bold danfe-small text-danger">
                EMITIDA EM AMBIENTE DE HOMOLOGAÇÃO — SEM VALOR FISCAL
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

  </div>
</template>

<script setup>
import { ref, computed, onMounted, nextTick, watch } from 'vue'
import api from '../api'
import QRCode from 'qrcode'
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
const qrCanvas = ref(null)

// Aggregated view model for the DANFE modal — keeps the template readable
// and centralizes the source-of-truth lookups (Store, OrderItem, payload).
const danfeData = computed(() => {
  const row = danfeModal.value.row || {}
  const order = row.order || {}
  const emit = row.emit || {}
  const payload = order.payload || {}
  const items = danfeModal.value.items || []

  const subtotal = items.reduce((s, it) => s + Number(it.total || 0), 0)
  const desconto = Number(order.couponDiscount || payload.couponDiscount || 0)
    + Number(payload.discountMerchant || 0)
    + Number(payload.paymentDiscount || 0)
  const acrescimo = Number(order.deliveryFee || payload.deliveryFee || 0)
    + Number(payload.surcharge || 0)
  const valorPagar = Number(order.total != null ? order.total : (subtotal - desconto + acrescimo))

  // Payments — accept payload.payments[] (multi), payload.payment{} (legacy)
  // or fall back to a single "Dinheiro" row equal to the total.
  const rawPayments = Array.isArray(payload.payments)
    ? payload.payments
    : (payload.payment ? [payload.payment] : [])
  const payments = rawPayments.map((p) => ({
    label: p.label || p.methodName || p.method || p.methodCode || 'Pagamento',
    value: Number(p.amount || p.value || valorPagar || 0),
  }))
  if (!payments.length) payments.push({ label: 'Dinheiro', value: valorPagar })
  const changeFor = Number(payload.payment?.changeFor || payload.changeFor || 0)
  const troco = changeFor > 0 ? Math.max(0, changeFor - valorPagar) : 0

  // Tributos aproximados (Lei 12.741) — IBPT fornece tabelas por NCM, mas
  // sem essa integração usamos uma estimativa simples baseada em alíquotas
  // médias para alimentos prontos no Simples Nacional.
  const baseTrib = subtotal
  const tributos = {
    federal: baseTrib * 0.063,
    estadual: baseTrib * 0.0961,
    municipal: 0,
    total: 0,
  }
  tributos.total = tributos.federal + tributos.estadual + tributos.municipal

  const chNFe = row.chNFe || ''
  const serie = chNFe ? String(parseInt(chNFe.slice(22, 25), 10)).padStart(3, '0') : '—'
  const nNF = chNFe ? String(parseInt(chNFe.slice(25, 34), 10)).padStart(9, '0') : '—'

  const ende = emit.enderEmit || {}
  const fullAddress = [
    [ende.xLgr, ende.nro].filter(Boolean).join(', '),
    ende.xBairro,
    [ende.xMun, ende.UF].filter(Boolean).join(' - '),
    ende.CEP ? String(ende.CEP).replace(/^(\d{5})(\d{3})$/, '$1-$2') : '',
  ].filter(Boolean).join(' ')

  // Detect homologação either from rawXml or from the qrCode URL (the |2|
  // segment encodes tpAmb).
  const isHomolog = /<tpAmb>2<\/tpAmb>/.test(row.rawXml || '')
    || /\|2\|2\|/.test(row.qrCodeUrl || '')

  return {
    storeName: row.store?.name || emit.xNome || '—',
    cnpj: emit.cnpj || '',
    razao: emit.xNome || '',
    ie: emit.ie || '',
    fone: emit.fone || ende.fone || '',
    fullAddress,
    consumerName: order.customerName || '',
    totalItens: items.length,
    subtotal,
    desconto,
    acrescimo,
    valorPagar,
    payments,
    troco,
    tributos,
    deliveryFee: Number(order.deliveryFee || payload.deliveryFee || 0),
    consultaUrl: 'http://nfe.sefaz.ba.gov.br/servicos/nfce/qrcode.aspx',
    nNF,
    serie,
    isHomolog,
  }
})

function fmtNumber(v) {
  return Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtChave(ch) {
  if (!ch) return ''
  return String(ch).replace(/\D/g, '').replace(/(\d{4})(?=\d)/g, '$1 ').trim()
}

// Render the QR code into the canvas as soon as the modal mounts. The URL
// comes from infNFeSupl in the signed XML (resolved server-side); falling
// back to the consultaUrl + chave gives the operator something to scan even
// when the signed XML is missing.
watch(() => danfeModal.value.show, async (show) => {
  if (!show) return
  await nextTick()
  if (!qrCanvas.value) return
  const url = danfeModal.value.row?.qrCodeUrl
    || (danfeModal.value.row?.chNFe
      ? `${danfeData.value.consultaUrl}?chNFe=${danfeModal.value.row.chNFe}`
      : '')
  if (!url) return
  try { await QRCode.toCanvas(qrCanvas.value, url, { width: 180, margin: 1 }) }
  catch (e) { console.warn('QRCode render failed', e?.message) }
})

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
  // Build items list. Prefer the OrderItem relation (canonical for POS and
  // public-menu orders); fall back to payload.items for legacy/imported
  // orders that store items inside the JSON payload instead.
  const items = []
  try {
    const relItems = Array.isArray(row.order?.items) ? row.order.items : []
    const payload = row.order?.payload || {}
    const payloadItems = Array.isArray(payload.items)
      ? payload.items
      : (Array.isArray(payload.rawPayload?.items) ? payload.rawPayload.items : [])
    const rawItems = relItems.length ? relItems : payloadItems
    for (const it of rawItems) {
      const qty = Number(it.quantity || it.qCom || 1)
      const price = Number(it.price || it.vUnCom || 0)
      items.push({
        id: it.productId || it.id || '',
        name: it.name || it.xProd || 'Produto',
        qty,
        price,
        total: qty * price,
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
/* Cupom DANFE NFC-e — proporções de impressora térmica 80mm */
.danfe-cupom {
  max-width: 340px;
  font-size: 11px;
  font-family: "Courier New", monospace;
  color: #000;
  background: #fff;
  padding: 8px;
  line-height: 1.25;
}
.danfe-store-name {
  font-size: 14px;
  font-weight: 700;
  text-transform: none;
}
.danfe-small { font-size: 10px; }
.danfe-items-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 10px;
}
.danfe-items-table th {
  border-bottom: 1px solid #000;
  border-top: 1px solid #000;
  padding: 2px 1px;
  font-weight: 600;
  text-align: left;
}
.danfe-items-table th.text-end,
.danfe-items-table td.text-end { text-align: right; }
.danfe-items-table td {
  padding: 1px;
  vertical-align: top;
}
.danfe-items-table tbody tr:last-child td {
  border-bottom: 1px solid #000;
  padding-bottom: 4px;
}
.danfe-totals,
.danfe-payments {
  font-size: 11px;
  border-bottom: 1px solid #000;
  padding-bottom: 4px;
}
.danfe-chave {
  font-family: "Courier New", monospace;
  font-size: 10px;
  word-break: break-all;
  letter-spacing: 0.5px;
}
.danfe-url {
  font-size: 9px;
  word-break: break-all;
}
.danfe-qr canvas { display: block; }
.danfe-nfe-info { line-height: 1.3; }

@media print {
  .danfe-cupom { max-width: 80mm; padding: 0; }
}
</style>
