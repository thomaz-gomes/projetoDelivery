<template>
  <div class="container py-3">
    
    <div class="card mb-3">
      <div class="card-body">
        <div class="row g-2 align-items-end">
          <div class="col-12"><h3>Histórico de Vendas</h3>
</div>
          <div class="col-md-2">
            <label class="form-label">Data início</label>
            <DateInput v-model="filters.from" inputClass="form-control" />
          </div>
          <div class="col-md-2">
            <label class="form-label">Data fim</label>
            <DateInput v-model="filters.to" inputClass="form-control" />
          </div>
          <div class="col-md-2">
            <label class="form-label">Entregador</label>
            <SelectInput v-model="filters.riderId" :options="riderOptions" optionValueKey="id" optionLabelKey="name" placeholder="Todos" />
          </div>
          <div class="col-md-2">
            <label class="form-label">Forma de pagamento</label>
            <SelectInput v-model="filters.paymentMethod" :options="paymentMethodOptions" placeholder="Todas" />
          </div>
          <div class="col-md-4 text-end">
            <button class="btn btn-primary me-2" :disabled="loading" @click="load">
              <span v-if="loading" class="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span>
              {{ loading ? 'Buscando...' : 'Buscar' }}
            </button>
            <button class="btn btn-outline-secondary me-2" :disabled="loading" @click="reset">Limpar</button>
            <button class="btn btn-outline-primary" :disabled="loading" @click="showImportModal = true" title="Importar vendas de planilha">
              <i class="bi bi-upload me-1"></i> Importar
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- ── KPIs do período (recorte filtrado) ─────────────────────────────── -->
    <div v-if="displayed.length > 0" class="card mb-3 kpi-card">
      <div class="card-body">
        <div class="row g-3">
          <!-- Coluna 1: Volume + Tickets médios -->
          <div class="col-lg-3 col-md-6">
            <div class="kpi-section-title">Volume</div>
            <div class="kpi-row">
              <span class="kpi-label" title="Inclui pedidos cancelados">Qtde total de pedidos</span>
              <span class="kpi-value">{{ summary.qtdTotal }}</span>
            </div>
            <div class="kpi-row">
              <span class="kpi-label">Qtde de pedidos cancelados</span>
              <span class="kpi-value text-danger">{{ summary.qtdCancelado }}</span>
            </div>
            <div class="kpi-row">
              <span class="kpi-label" title="Soma do valor de todos os pedidos">Total dos pedidos</span>
              <span class="kpi-value">{{ fmtBRL(summary.valorTotal) }}</span>
            </div>
            <div class="kpi-row">
              <span class="kpi-label">Total dos pedidos cancelados</span>
              <span class="kpi-value text-danger">{{ fmtBRL(summary.valorCancelado) }}</span>
            </div>
            <hr class="kpi-divider" />
            <div class="kpi-row">
              <span class="kpi-label">Ticket médio - Entrega</span>
              <span class="kpi-value">{{ fmtBRL(summary.ticketEntrega) }}</span>
            </div>
            <div class="kpi-row">
              <span class="kpi-label">Ticket médio - Balcão</span>
              <span class="kpi-value">{{ fmtBRL(summary.ticketBalcao) }}</span>
            </div>
            <div class="kpi-row">
              <span class="kpi-label">Ticket médio - Mesa</span>
              <span class="kpi-value">{{ fmtBRL(summary.ticketMesa) }}</span>
            </div>
            <div class="kpi-row">
              <span class="kpi-label">Ticket médio - Ficha</span>
              <span class="kpi-value">{{ fmtBRL(summary.ticketFicha) }}</span>
            </div>
          </div>

          <!-- Coluna 2: Composição por tipo -->
          <div class="col-lg-2 col-md-6">
            <div class="kpi-section-title">Composição</div>
            <div class="kpi-row">
              <span class="kpi-label">Qtde Entrega</span>
              <span class="kpi-value">{{ summary.porTipo.DELIVERY.qty }}</span>
            </div>
            <div class="kpi-row">
              <span class="kpi-label">Qtde Balcão</span>
              <span class="kpi-value">{{ summary.porTipo.BALCAO.qty }}</span>
            </div>
            <div class="kpi-row">
              <span class="kpi-label">Qtde Ficha</span>
              <span class="kpi-value">{{ summary.porTipo.FICHA.qty }}</span>
            </div>
            <div class="kpi-row">
              <span class="kpi-label" title="Qtd de pedidos no salão / Total de clientes atendidos">Qtde Salão / Clientes</span>
              <span class="kpi-value">{{ summary.salao.qty }} / {{ summary.salao.clientes }}</span>
            </div>
          </div>

          <!-- Coluna 3: Valores agregados -->
          <div class="col-lg-3 col-md-6">
            <div class="kpi-section-title">Valores</div>
            <div class="kpi-row">
              <span class="kpi-label">Total dos itens</span>
              <span class="kpi-value">{{ fmtBRL(summary.totalItens) }}</span>
            </div>
            <div class="kpi-row">
              <span class="kpi-label">Total das taxas de entrega</span>
              <span class="kpi-value">{{ fmtBRL(summary.totalTaxaEntrega) }}</span>
            </div>
            <div class="kpi-row">
              <span class="kpi-label">Total das taxas de serviço</span>
              <span class="kpi-value">{{ fmtBRL(summary.totalTaxaServico) }}</span>
            </div>
            <div class="kpi-row">
              <span class="kpi-label">Total de acréscimos</span>
              <span class="kpi-value">{{ fmtBRL(summary.totalAcrescimos) }}</span>
            </div>
            <div class="kpi-row">
              <span class="kpi-label">Total de descontos</span>
              <span class="kpi-value text-danger">{{ fmtBRL(summary.totalDescontos) }}</span>
            </div>
          </div>

          <!-- Coluna 4: Cupons fiscais (NFC-e) -->
          <div class="col-lg-4 col-md-6">
            <div class="kpi-section-title">Cupons fiscais (NFC-e)</div>
            <div class="kpi-row">
              <span class="kpi-label">Quantidade de cupons emitidos</span>
              <span class="kpi-value">{{ summary.cuponsEmitidos }}</span>
            </div>
            <div class="kpi-row">
              <span class="kpi-label" title="Pedidos não-cancelados sem NFC-e emitida">Cupons a emitir</span>
              <span class="kpi-value text-warning">{{ summary.cuponsAEmitir }}</span>
            </div>
            <div class="kpi-row">
              <span class="kpi-label">Valor total dos cupons emitidos</span>
              <span class="kpi-value">{{ fmtBRL(summary.valorCuponsEmitidos) }}</span>
            </div>
            <div class="kpi-row">
              <span class="kpi-label">Valor total dos cupons em vendas canceladas</span>
              <span class="kpi-value text-danger">{{ fmtBRL(summary.valorCuponsCancelados) }}</span>
            </div>
            <div class="kpi-row">
              <span class="kpi-label">Quantidade de cupons em vendas canceladas</span>
              <span class="kpi-value text-danger">{{ summary.qtdCuponsCancelados }}</span>
            </div>
          </div>
        </div>

        <!-- Canais — tabela compacta, ordenada por valor -->
        <div v-if="summary.canais.length > 0" class="row mt-3 pt-3 border-top">
          <div class="col-12">
            <div class="kpi-section-title">Vendas por canal</div>
            <div class="table-responsive">
              <table class="table table-sm kpi-channels mb-0">
                <thead>
                  <tr>
                    <th>Canal</th>
                    <th class="text-end" style="width:90px">Qtde</th>
                    <th class="text-end" style="width:130px">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="c in summary.canais" :key="c.nome">
                    <td>{{ c.nome }}</td>
                    <td class="text-end">{{ c.qty }}</td>
                    <td class="text-end">{{ fmtBRL(c.sum) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>

    <ListCard :title="`Pedidos (${orders.length})`" :subtitle="orders.length ? `${orders.length} itens` : ''" :quickSearch="true" quickSearchPlaceholder="Buscar por pedido, endereço ou cliente" @quick-search="onQuickSearch" @quick-clear="onQuickClear">
      <template #default>
        <div class="table-responsive">
          <table class="table table-hover mb-0">
            <thead class="table-light">
              <tr>
                <th style="width:40px"><input type="checkbox" class="form-check-input" :checked="allSelected" @change="toggleSelectAll" /></th>
                <th>Nº Pedido</th>
                <th>Endereço</th>
                <th>Cliente</th>
                <th>Data</th>
                <th>Entregador</th>
                <th>Pagamento</th>
                <th>NF-e</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="o in paginatedOrders" :key="o.id">
                <td><input type="checkbox" class="form-check-input" :checked="selectedIds.has(o.id)" @change="toggleSelect(o.id)" /></td>
                <td>{{ formatOrderNumber(o) }}</td>
                <td>{{ formatAddress(o) }}</td>
                <td>{{ o.customerName || o.customer?.fullName || o.customer?.name || o.customer?.contact || '-' }}</td>
                <td>{{ formatDate(o.createdAt) }}</td>
                <td>{{ o.rider?.name || '-' }}</td>
                <td>
                  {{ getPaymentMethod(o) || '-' }}
                  <span v-if="o.couponCode || Number(o.couponDiscount || 0) > 0" class="badge bg-success ms-1" :title="o.couponCode ? `Cupom: ${o.couponCode}` : 'Cupom aplicado'">
                    <i class="bi bi-ticket-perforated"></i> {{ o.couponCode || '' }}
                  </span>
                </td>
                <td>
                  <span v-if="o.payload?.nfe?.nProt" class="badge bg-success" title="NF-e emitida">
                    <i class="bi bi-check-circle"></i>
                  </span>
                  <button v-else class="btn btn-sm btn-outline-success" @click="emitirNfeOrder(o)" title="Emitir NF-e">
                    <i class="bi bi-receipt"></i>
                  </button>
                </td>
                <td class="text-end">
                  <button class="btn btn-sm btn-outline-primary" @click="viewDetails(o)">Ver</button>
                </td>
              </tr>
              <tr v-if="displayed.length === 0">
                <td colspan="9" class="text-center py-4">Nenhum pedido encontrado para o período.</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Paginação -->
        <div v-if="totalPages > 1" class="d-flex justify-content-between align-items-center p-3 border-top">
          <div class="text-muted">
            Mostrando {{ (currentPage - 1) * itemsPerPage + 1 }} até {{ Math.min(currentPage * itemsPerPage, displayed.length) }} de {{ displayed.length }} pedidos
          </div>
          <nav>
            <ul class="pagination mb-0">
              <li class="page-item" :class="{ disabled: currentPage === 1 }">
                <button class="page-link" @click="currentPage = 1" :disabled="currentPage === 1">Primeira</button>
              </li>
              <li class="page-item" :class="{ disabled: currentPage === 1 }">
                <button class="page-link" @click="currentPage--" :disabled="currentPage === 1">Anterior</button>
              </li>
              <li 
                v-for="page in visiblePages" 
                :key="page" 
                class="page-item" 
                :class="{ active: currentPage === page }"
              >
                <button class="page-link" @click="currentPage = page">{{ page }}</button>
              </li>
              <li class="page-item" :class="{ disabled: currentPage === totalPages }">
                <button class="page-link" @click="currentPage++" :disabled="currentPage === totalPages">Próxima</button>
              </li>
              <li class="page-item" :class="{ disabled: currentPage === totalPages }">
                <button class="page-link" @click="currentPage = totalPages" :disabled="currentPage === totalPages">Última</button>
              </li>
            </ul>
          </nav>
        </div>
      </template>
    </ListCard>

    <!-- Bulk actions bar -->
    <div v-if="selectedIds.size > 0" class="position-fixed bottom-0 start-0 end-0 bg-dark text-white p-2 d-flex align-items-center justify-content-between" style="z-index:1050">
      <div class="d-flex align-items-center gap-2 ms-3">
        <span class="fw-semibold">{{ selectedIds.size }} pedido(s) selecionado(s)</span>
        <button class="btn btn-sm btn-outline-light" @click="clearSelection">
          <i class="bi bi-x-lg"></i> Limpar
        </button>
      </div>
      <div class="d-flex gap-2 me-3">
        <button class="btn btn-sm btn-success" @click="bulkEmitNfe" title="Emitir NF-e dos selecionados">
          <i class="bi bi-receipt"></i> Emitir NF-e
        </button>
      </div>
    </div>

    <!-- Import modal -->
    <div v-if="showImportModal" class="modal d-block" tabindex="-1" style="background:rgba(0,0,0,0.5)">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title"><i class="bi bi-upload me-2"></i>Importar Vendas</h5>
            <button type="button" class="btn-close" @click="closeImportModal"></button>
          </div>
          <div class="modal-body">
            <p class="text-muted mb-3">Selecione a planilha de vendas do sistema antigo. Formatos aceitos: <strong>.xlsx, .xls, .csv</strong></p>
            <input type="file" class="form-control" ref="importFileInput" accept=".xlsx,.xls,.csv" @change="onImportFileChange" />
            <div v-if="importResult" class="mt-3">
              <div class="alert" :class="importResult.errors?.length ? 'alert-warning' : 'alert-success'">
                <strong>{{ importResult.message }}</strong><br />
                <span>{{ importResult.created }} pedido(s) criado(s)</span>
                <span v-if="importResult.skipped"> — {{ importResult.skipped }} ignorado(s)</span>
                <div v-if="importResult.errors?.length" class="mt-2">
                  <small v-for="(e, i) in importResult.errors" :key="i" class="d-block text-danger">
                    Linha {{ e.row }}: {{ e.error }}
                  </small>
                </div>
              </div>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-outline-secondary" @click="closeImportModal">Fechar</button>
            <button class="btn btn-primary" :disabled="!importFile || importing" @click="doImport">
              <span v-if="importing" class="spinner-border spinner-border-sm me-1"></span>
              {{ importing ? 'Importando...' : 'Importar' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, computed, watch } from 'vue';
import { useRouter } from 'vue-router';
import Swal from 'sweetalert2';
import api from '../api';
import SelectInput from '../components/form/select/SelectInput.vue';
import { formatDate } from '../utils/dates.js';
import DateInput from '../components/form/date/DateInput.vue';
import ListCard from '../components/ListCard.vue';

const router = useRouter();
const orders = ref([]);
const q = ref('');
const currentPage = ref(1);
const itemsPerPage = ref(20);
const loading = ref(false);

const displayed = computed(() => {
  const term = (q.value || '').toLowerCase()
  const pm = (filters.value.paymentMethod || '').toLowerCase()
  let list = orders.value || []
  if (pm) {
    list = list.filter(o => (getPaymentMethod(o) || '').toLowerCase() === pm)
  }
  if (term) {
    list = list.filter(o => {
      const addr = formatAddress(o) || ''
      const customer = o.customerName || (o.customer && (o.customer.fullName || o.customer.name || o.customer.contact)) || ''
      const num = formatOrderNumber(o) || ''
      return (addr + ' ' + customer + ' ' + num).toLowerCase().includes(term)
    })
  }
  return list
})

const totalPages = computed(() => {
  return Math.ceil(displayed.value.length / itemsPerPage.value);
});

// ─── KPIs do período ─────────────────────────────────────────────────────────
// Calcula resumo a partir da lista FILTRADA (displayed) — assim o operador vê o
// total do recorte que ele escolheu (data, entregador, forma de pagamento etc.).
// Tipos de pedido normalizados:
//   DELIVERY → entrega; PICKUP/BALCAO/TAKEOUT → balcão; MESA → mesa; FICHA → ficha
function _normalizeOrderType(o) {
  const t = String(o?.orderType || o?.type || '').toUpperCase()
  if (t === 'DELIVERY') return 'DELIVERY'
  if (t === 'PICKUP' || t === 'BALCAO' || t === 'BALCÃO' || t === 'TAKEOUT' || t === 'TAKE-OUT' || t === 'PICK-UP' || t === 'INDOOR') return 'BALCAO'
  if (t === 'MESA' || t === 'TABLE') return 'MESA'
  if (t === 'FICHA') return 'FICHA'
  return 'DELIVERY' // default conservador (maioria dos pedidos)
}

// Identifica o canal de origem do pedido. Integrações (iFood, Aiqfome, etc.)
// vencem a relação ao cardápio porque o pedido nasce nelas — só depois é
// roteado para um Menu interno. Para pedidos sem integração, usa o nome do
// cardápio (cada cardápio digital é um canal). "Cardápio Web" só sobra como
// rótulo de último recurso quando nada conhecido bateu.
function _normalizeChannel(o) {
  const raw = String(o?.canal || o?.source || o?.channel || o?.payload?.source || o?.payload?.salesChannel || '').toLowerCase()
  if (raw.includes('ifood')) return 'iFood'
  if (raw.includes('aiqfome') || raw.includes('aiq')) return 'Aiqfome'
  if (raw.includes('whatsapp') || raw.includes('wpp') || raw === 'wa') return 'WhatsApp'
  if (raw.includes('deeliv')) return 'Deeliv'
  if (raw.includes('saipos')) return 'Site Delivery (SAIPOS)'
  if (raw.includes('facebook')) return 'Facebook'
  if (raw.includes('telefone') || raw.includes('phone')) return 'Telefone'
  if (raw.includes('delivery direto')) return 'Delivery Direto'
  if (raw === 'pdv' || raw.includes('pdv')) return 'PDV / Balcão'

  // Pedidos sem integração: cada cardápio digital é um canal próprio.
  const menuName = o?.menu?.name || o?.menuName
  if (menuName) return String(menuName)

  if (raw.includes('site') || raw.includes('próprio') || raw.includes('proprio')) return 'Site Próprio'
  if (raw.includes('cardapio') || raw.includes('cardápio') || raw.includes('menu') || raw === 'web') return 'Cardápio Digital'
  if (!raw) return 'Outro'
  return raw.charAt(0).toUpperCase() + raw.slice(1)
}

const summary = computed(() => {
  const list = displayed.value || []
  const totals = {
    qtdTotal: 0,
    qtdCancelado: 0,
    valorTotal: 0,
    valorCancelado: 0,
    totalItens: 0,
    totalTaxaEntrega: 0,
    totalTaxaServico: 0,
    totalAcrescimos: 0,
    totalDescontos: 0,
    porTipo: { DELIVERY: { qty: 0, sum: 0 }, BALCAO: { qty: 0, sum: 0 }, MESA: { qty: 0, sum: 0 }, FICHA: { qty: 0, sum: 0 } },
    salao: { qty: 0, clientes: 0 },
    canais: new Map(),
    cuponsEmitidos: 0,
    cuponsAEmitir: 0,
    valorCuponsEmitidos: 0,
    valorCuponsCancelados: 0,
    qtdCuponsCancelados: 0,
  }

  for (const o of list) {
    const total = Number(o?.total || 0) || 0
    const isCanceled = String(o?.status || '').toUpperCase() === 'CANCELADO'
    const tipo = _normalizeOrderType(o)
    const tEntrega = Number(o?.deliveryFee || 0) || 0
    const tServico = Number(o?.additionalFees || 0) || 0
    const desconto = Number(o?.couponDiscount ?? o?.discount ?? 0) || 0
    const subtotal = Number(o?.subtotal || 0) || Math.max(0, total - tEntrega - tServico + desconto)
    const temNfe = !!(o?.payload?.nfe?.nProt)

    totals.qtdTotal += 1
    totals.valorTotal += total
    if (isCanceled) {
      totals.qtdCancelado += 1
      totals.valorCancelado += total
      if (temNfe) {
        totals.qtdCuponsCancelados += 1
        totals.valorCuponsCancelados += total
      }
    } else {
      // Métricas operacionais (itens/taxas/descontos) só somam pedidos válidos.
      totals.totalItens += subtotal
      totals.totalTaxaEntrega += tEntrega
      totals.totalTaxaServico += tServico
      totals.totalAcrescimos += tServico
      totals.totalDescontos += desconto
      totals.porTipo[tipo].qty += 1
      totals.porTipo[tipo].sum += total
      if (tipo === 'MESA') {
        totals.salao.qty += 1
        totals.salao.clientes += Number(o?.peopleCount || o?.numCustomers || 0) || 0
      }

      const canal = _normalizeChannel(o)
      const cur = totals.canais.get(canal) || { qty: 0, sum: 0 }
      cur.qty += 1
      cur.sum += total
      totals.canais.set(canal, cur)
    }

    if (temNfe) {
      totals.cuponsEmitidos += 1
      if (!isCanceled) totals.valorCuponsEmitidos += total
    } else if (!isCanceled) {
      totals.cuponsAEmitir += 1
    }
  }

  const ticket = (k) => totals.porTipo[k].qty > 0 ? totals.porTipo[k].sum / totals.porTipo[k].qty : 0

  // Canais ordenados pelo valor descendente — mais relevante na operação
  const canais = [...totals.canais.entries()]
    .map(([nome, v]) => ({ nome, qty: v.qty, sum: v.sum }))
    .sort((a, b) => b.sum - a.sum)

  return {
    ...totals,
    ticketEntrega: ticket('DELIVERY'),
    ticketBalcao: ticket('BALCAO'),
    ticketMesa: ticket('MESA'),
    ticketFicha: ticket('FICHA'),
    canais,
  }
})

const fmtBRL = (v) => `R$ ${Number(v || 0).toFixed(2).replace('.', ',')}`

const paginatedOrders = computed(() => {
  const start = (currentPage.value - 1) * itemsPerPage.value;
  const end = start + itemsPerPage.value;
  return displayed.value.slice(start, end);
});

const riders = ref([]);

// default date filter: today in YYYY-MM-DD (local) format
const today = (() => {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
})();

const filters = ref({ from: today, to: today, riderId: '', paymentMethod: '' });

const riderOptions = ref([]);

// Fixed list keeps the dropdown predictable before orders load. The labels
// mirror what getPaymentMethod() emits so client-side comparison is exact.
const paymentMethodOptions = [
  { value: 'PIX', label: 'PIX' },
  { value: 'Dinheiro', label: 'Dinheiro' },
  { value: 'Cartão de Crédito', label: 'Cartão de Crédito' },
  { value: 'Cartão de Débito', label: 'Cartão de Débito' },
  { value: 'Vale', label: 'Vale' },
  { value: 'Online', label: 'Online' },
];

// use shared formatDateTime from utils/dates.js

function padNumber(n){
  if (n == null || n === '') return null;
  return String(n).toString().padStart(2, '0');
}

function formatOrderNumber(o){
  if(!o) return '';
  if(o.displaySimple) return o.displaySimple;
  if(o.displayId !== undefined && o.displayId !== null) {
    const p = padNumber(o.displayId);
    return p ? p : String(o.displayId);
  }
  // prefer `number` when backend exposes the per-day number in that field
  if(o.number !== undefined && o.number !== null) return String(o.number);
  // fallback to a short id
  return o.id ? String(o.id).slice(0,6) : '';
}

function formatAddress(o){
  if(!o) return '-';
  const a = o.address || o.deliveryAddress || o.customerAddress || o.payload?.delivery?.deliveryAddress;
  if(!a) return o.addressText || '-';
  if (typeof a === 'string') return a || o.addressText || '-'
  const main = a.formatted || a.formattedAddress || [a.street || a.streetName, a.number || a.streetNumber].filter(Boolean).join(', ');
  const tail = []
  if(a.neighborhood) tail.push(a.neighborhood)
  if(a.complement) tail.push('Comp: ' + a.complement)
  if(a.reference) tail.push('Ref: ' + a.reference)
  if(a.observation) tail.push('Obs: ' + a.observation)
  if(a.city && !tail.includes(a.city)) tail.push(a.city)
  return [main, tail.filter(Boolean).join(' — ')].filter(Boolean).join(' | ')
}

function getPaymentMethod(o){
  if(!o) return ''
  try{
    const payment = o.payment || o.paymentMethod || o.payload?.payment || o.payload?.rawPayload?.payment
    if(!payment) return ''
    const method = (payment.method || payment.methodCode || payment.name || payment.type || '').toString()
    const labels = { 'PIX':'PIX', 'CREDIT_CARD':'Cartão de Crédito', 'DEBIT_CARD':'Cartão de Débito', 'CASH':'Dinheiro', 'MONEY':'Dinheiro', 'VOUCHER':'Vale', 'ONLINE':'Online', 'Dinheiro':'Dinheiro', 'Crédito':'Crédito' }
    return labels[method] || method || ''
  }catch(e){ return '' }
}

async function load(){
  loading.value = true;
  try{
    const params = { light: true };
    if(filters.value.from) params.from = filters.value.from;
    if(filters.value.to) params.to = filters.value.to;
    if(filters.value.riderId) params.riderId = filters.value.riderId;
    console.log('[sales] GET /orders', params);
    // Per-call 60s timeout — the heavy include + wide date ranges can
    // exceed the global 15s default even with `light=true`.
    const { data } = await api.get('/orders', { params, timeout: 60000 });
    orders.value = Array.isArray(data) ? data : (data?.orders || []);
    currentPage.value = 1;
    console.log('[sales] received', orders.value.length, 'orders');
  }catch(e){
    console.error('load orders failed', e?.response?.status, e?.response?.data, e?.message || e);
    orders.value = [];
  } finally {
    loading.value = false;
  }
}

async function loadRiders(){
  try{
    const { data } = await api.get('/riders');
    riders.value = Array.isArray(data) ? data : (data?.riders || []);
    riderOptions.value = riders.value.map(r => ({ id: r.id, name: r.fullName || r.name }));
  }catch(e){
    riderOptions.value = [];
  }
}

function reset(){
  filters.value = { from: today, to: today, riderId: '', paymentMethod: '' };
  orders.value = [];
  currentPage.value = 1;
}

function viewDetails(o){
  router.push({ path: `/sales/${o.id}` });
}

const visiblePages = computed(() => {
  const pages = [];
  const total = totalPages.value;
  const current = currentPage.value;
  
  if (total <= 7) {
    for (let i = 1; i <= total; i++) {
      pages.push(i);
    }
  } else {
    if (current <= 4) {
      for (let i = 1; i <= 5; i++) pages.push(i);
      pages.push('...');
      pages.push(total);
    } else if (current >= total - 3) {
      pages.push(1);
      pages.push('...');
      for (let i = total - 4; i <= total; i++) pages.push(i);
    } else {
      pages.push(1);
      pages.push('...');
      for (let i = current - 1; i <= current + 1; i++) pages.push(i);
      pages.push('...');
      pages.push(total);
    }
  }
  
  return pages.filter(p => p !== '...' || pages.indexOf(p) === pages.lastIndexOf(p));
});

// Import logic
const showImportModal = ref(false);
const importFile = ref(null);
const importing = ref(false);
const importResult = ref(null);
const importFileInput = ref(null);

function onImportFileChange(e) {
  importFile.value = e.target.files?.[0] || null;
  importResult.value = null;
}

function closeImportModal() {
  showImportModal.value = false;
  importFile.value = null;
  importResult.value = null;
  if (importFileInput.value) importFileInput.value.value = '';
}

async function doImport() {
  if (!importFile.value) return;
  importing.value = true;
  importResult.value = null;
  try {
    const formData = new FormData();
    formData.append('file', importFile.value);
    const { data } = await api.post('/orders/import', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
    importResult.value = data;
    if (data.created > 0) load();
  } catch (e) {
    importResult.value = { message: e.response?.data?.message || 'Erro ao importar', created: 0, skipped: 0, errors: [] };
  } finally {
    importing.value = false;
  }
}

onMounted(()=>{ loadRiders(); load(); });

watch(() => filters.value.paymentMethod, () => { currentPage.value = 1; });

function onQuickSearch(val){ 
  q.value = val;
  currentPage.value = 1;
}

function onQuickClear(){
  q.value = '';
  currentPage.value = 1;
}

const selectedIds = ref(new Set());

const allSelected = computed(() => {
  if (!paginatedOrders.value.length) return false;
  return paginatedOrders.value.every(o => selectedIds.value.has(o.id));
});

function toggleSelect(id) {
  const s = new Set(selectedIds.value);
  if (s.has(id)) s.delete(id); else s.add(id);
  selectedIds.value = s;
}

function toggleSelectAll() {
  if (allSelected.value) {
    const s = new Set(selectedIds.value);
    paginatedOrders.value.forEach(o => s.delete(o.id));
    selectedIds.value = s;
  } else {
    const s = new Set(selectedIds.value);
    paginatedOrders.value.forEach(o => s.add(o.id));
    selectedIds.value = s;
  }
}

function clearSelection() { selectedIds.value = new Set(); }

async function emitirNfeOrder(order) {
  const r = await Swal.fire({
    title: 'Emitir NF-e?',
    text: `Pedido #${formatOrderNumber(order)}`,
    icon: 'question',
    showCancelButton: true,
    confirmButtonText: 'Emitir',
    cancelButtonText: 'Cancelar'
  });
  if (!r.isConfirmed) return;
  try {
    const { data } = await api.post('/nfe/emit-from-order', { orderId: order.id });
    if (data.success) {
      Swal.fire({ icon: 'success', title: 'NF-e Autorizada', text: `Protocolo: ${data.nProt}`, toast: true, timer: 4000, position: 'top-end', showConfirmButton: false });
      load();
    } else {
      Swal.fire({ icon: 'error', title: 'Erro NF-e', text: data.xMotivo || data.error });
    }
  } catch (e) {
    const errData = e.response?.data;
    let errorText = errData?.error || e.message;
    if (errData?.detail) {
      const d = errData.detail;
      if (d.httpStatus) errorText += `\nHTTP ${d.httpStatus}`;
      if (d.url) errorText += `\nURL: ${d.url}`;
      if (d.httpData) errorText += `\nResposta: ${d.httpData.substring(0, 300)}`;
    }
    Swal.fire({ icon: 'error', title: 'Erro ao emitir NF-e', text: errorText });
  }
}

async function bulkEmitNfe() {
  const ids = [...selectedIds.value];
  if (!ids.length) return;
  const r = await Swal.fire({
    title: `Emitir NF-e para ${ids.length} pedido(s)?`,
    icon: 'question',
    showCancelButton: true,
    confirmButtonText: 'Emitir todos',
    cancelButtonText: 'Cancelar'
  });
  if (!r.isConfirmed) return;
  try {
    const { data } = await api.post('/nfe/emit-from-order', { orderIds: ids });
    const ok = data.results.filter(r => r.success).length;
    const fail = data.results.length - ok;
    Swal.fire({
      icon: fail ? 'warning' : 'success',
      title: `${ok} emitida(s)${fail ? `, ${fail} erro(s)` : ''}`,
      timer: 5000, toast: true, position: 'top-end', showConfirmButton: false
    });
    load();
  } catch (e) {
    Swal.fire({ icon: 'error', title: 'Erro', text: e.response?.data?.error || e.message });
  }
  clearSelection();
}
</script>

<style scoped>
.card { overflow: hidden; }

/* ── KPI card (resumo do período) ───────────────────────────────────── */
.kpi-card .card-body { padding: 1.25rem; }

.kpi-section-title {
  font-size: 0.72rem;
  font-weight: 500;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-muted);
  margin-bottom: 0.75rem;
  padding-bottom: 0.4rem;
  border-bottom: 1px solid var(--border-color-soft);
}

.kpi-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.25rem 0;
  font-size: 0.85rem;
}

.kpi-label {
  color: var(--text-secondary);
  line-height: 1.3;
}

.kpi-value {
  color: var(--text-primary);
  font-weight: 600;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.kpi-divider {
  margin: 0.6rem 0;
  border: 0;
  border-top: 1px dashed var(--border-color);
}

/* tabela de canais — compactar e usar mesma tipografia das demais tabelas */
.kpi-channels th {
  font-size: 0.72rem;
  font-weight: 500;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
  border-bottom: 1px solid var(--border-color);
  padding: 0.5rem 0.75rem;
}
.kpi-channels td {
  font-size: 0.85rem;
  color: var(--text-primary);
  padding: 0.45rem 0.75rem;
  border-bottom: 1px solid var(--border-color-soft);
}
.kpi-channels tbody tr:last-child td { border-bottom: 0; }
.kpi-channels tbody tr:hover td { background: var(--bg-hover); }

@media (max-width: 768px) {
  .kpi-section-title { margin-bottom: 0.5rem; }
  .kpi-row { font-size: 0.8rem; }
}
</style>
