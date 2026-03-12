<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { Chart, registerables } from 'chart.js'
import api from '../api'

Chart.register(...registerables)

const SERVICE_KEYS = [
  'MENU_IMPORT_ITEM', 'MENU_IMPORT_LINK', 'MENU_IMPORT_PHOTO', 'MENU_IMPORT_PLANILHA',
  'GENERATE_DESCRIPTION', 'OCR_PHOTO', 'AI_STUDIO_ENHANCE',
  'TECHNICAL_SHEET_IMPORT_PARSE', 'TECHNICAL_SHEET_IMPORT_ITEM',
  'INGREDIENT_IMPORT_PARSE', 'INGREDIENT_IMPORT_ITEM',
  'NFE_IMPORT_MATCH', 'NFE_RECEIPT_PHOTO', 'POS_PARSER',
]

const tab = ref('log')
const loading = ref(false)

// Log data
const logRows = ref([])
const page = ref(1)
const pages = ref(1)
const total = ref(0)
const filters = ref({ dateFrom: '', dateTo: '', companyId: '', serviceKey: '', provider: '' })

// Dashboard data
const summary = ref({ totals: {}, monthly: {}, byService: {} })
const dashboardLoaded = ref(false)

// Shared
const companies = ref([])
const pricingMap = ref({})
const creditBrlPrice = ref(0)
const usdToBrl = ref(5.80)

// Charts
const chartCostRevenue = ref(null)
const chartByService = ref(null)
const chartProfit = ref(null)
let chartCostRevenueInstance = null
let chartByServiceInstance = null
let chartProfitInstance = null

// Margin simulator
const desiredMargin = ref(50)

const suggestedCreditPriceNum = computed(() => {
  const t = summary.value?.totals
  if (!t?.costBrl || !t?.creditsSpent) return 0
  const avgCostPerCredit = t.costBrl / t.creditsSpent
  return avgCostPerCredit / (1 - desiredMargin.value / 100)
})

const suggestedCreditPrice = computed(() => {
  return suggestedCreditPriceNum.value ? suggestedCreditPriceNum.value.toFixed(4).replace('.', ',') : '—'
})

const projectedProfit = computed(() => {
  const t = summary.value?.totals
  if (!t?.creditsSpent) return 0
  return (t.creditsSpent * suggestedCreditPriceNum.value) - t.costBrl
})

const showing = computed(() => {
  if (!logRows.value.length) return 0
  const start = (page.value - 1) * 25 + 1
  const end = start + logRows.value.length - 1
  return `${start}–${end}`
})

// Totals for log table summary row
const logTotals = computed(() => {
  let inputTokens = 0, outputTokens = 0, costBrl = 0, credits = 0, revenueBrl = 0
  for (const row of logRows.value) {
    inputTokens += row.inputTokens || 0
    outputTokens += row.outputTokens || 0
    const c = calcCostBrl(row)
    costBrl += c
    credits += row.creditsSpent || 0
    revenueBrl += calcRevenueBrl(row)
  }
  return { inputTokens, outputTokens, costBrl, credits, revenueBrl, profit: revenueBrl - costBrl }
})

function fmtBrl(value) {
  if (value == null || isNaN(value)) return '—'
  return Number(value).toFixed(2).replace('.', ',')
}

function fmtNum(value) {
  if (value == null) return '—'
  return Number(value).toLocaleString('pt-BR')
}

function calcCostBrl(row) {
  const p = pricingMap.value[`${row.provider}:${row.model}`] || { input: 0, output: 0 }
  const costUsd = (row.inputTokens / 1_000_000 * p.input) + (row.outputTokens / 1_000_000 * p.output)
  return costUsd * usdToBrl.value
}

function calcRevenueBrl(row) {
  return (row.creditsSpent || 0) * creditBrlPrice.value
}

async function loadConfig() {
  const [pricingRes, settingsRes, companiesRes] = await Promise.all([
    api.get('/saas/ai-provider-pricing'),
    api.get('/saas/settings'),
    api.get('/saas/companies'),
  ])

  for (const p of pricingRes.data) {
    pricingMap.value[`${p.provider}:${p.model}`] = {
      input: parseFloat(p.inputPricePerMillion),
      output: parseFloat(p.outputPricePerMillion),
    }
  }

  const brlRow = settingsRes.data.find(s => s.key === 'credit_brl_price')
  if (brlRow?.isSet) creditBrlPrice.value = parseFloat(brlRow.value) || 0
  const usdRow = settingsRes.data.find(s => s.key === 'usd_to_brl')
  if (usdRow?.isSet) usdToBrl.value = parseFloat(usdRow.value) || 5.80

  companies.value = companiesRes.data || []
}

async function loadLog() {
  loading.value = true
  try {
    const params = { page: page.value, limit: 25 }
    if (filters.value.dateFrom) params.dateFrom = filters.value.dateFrom
    if (filters.value.dateTo) params.dateTo = filters.value.dateTo
    if (filters.value.companyId) params.companyId = filters.value.companyId
    if (filters.value.serviceKey) params.serviceKey = filters.value.serviceKey
    if (filters.value.provider) params.provider = filters.value.provider

    const { data } = await api.get('/saas/ai-usage', { params })
    logRows.value = data.rows
    total.value = data.total
    pages.value = data.pages
  } finally {
    loading.value = false
  }
}

async function loadDashboard() {
  if (dashboardLoaded.value) return
  loading.value = true
  try {
    const { data } = await api.get('/saas/ai-usage/summary', { params: { months: 6 } })
    summary.value = data
    creditBrlPrice.value = data.creditBrlPrice || creditBrlPrice.value
    usdToBrl.value = data.usdToBrl || usdToBrl.value
    dashboardLoaded.value = true
    nextTick(() => renderCharts())
  } finally {
    loading.value = false
  }
}

function applyFilters() {
  page.value = 1
  loadLog()
}

function renderCharts() {
  // Destroy existing
  if (chartCostRevenueInstance) chartCostRevenueInstance.destroy()
  if (chartByServiceInstance) chartByServiceInstance.destroy()
  if (chartProfitInstance) chartProfitInstance.destroy()

  const months = Object.keys(summary.value.monthly || {}).sort()
  const labels = months.map(m => { const [y, mo] = m.split('-'); return `${mo}/${y}` })

  // Bar chart: Custo vs Receita
  if (chartCostRevenue.value) {
    chartCostRevenueInstance = new Chart(chartCostRevenue.value, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Custo (BRL)', data: months.map(m => summary.value.monthly[m].costBrl), backgroundColor: '#e04f4f' },
          { label: 'Receita (BRL)', data: months.map(m => summary.value.monthly[m].revenueBrl), backgroundColor: '#4fc97a' },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'top' } },
        scales: { y: { beginAtZero: true } },
      },
    })
  }

  // Doughnut chart: by service
  if (chartByService.value) {
    const svcKeys = Object.keys(summary.value.byService || {})
    const svcColors = [
      '#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f',
      '#edc948', '#b07aa1', '#ff9da7', '#9c755f', '#bab0ac',
      '#86bcb6', '#8cd17d', '#b6992d', '#499894', '#d37295',
    ]
    chartByServiceInstance = new Chart(chartByService.value, {
      type: 'doughnut',
      data: {
        labels: svcKeys,
        datasets: [{
          data: svcKeys.map(k => summary.value.byService[k].costBrl),
          backgroundColor: svcColors.slice(0, svcKeys.length),
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'right', labels: { boxWidth: 12, font: { size: 11 } } },
        },
      },
    })
  }

  // Line chart: Lucro mensal
  if (chartProfit.value) {
    const profitData = months.map(m => {
      const d = summary.value.monthly[m]
      return (d.revenueBrl || 0) - (d.costBrl || 0)
    })
    chartProfitInstance = new Chart(chartProfit.value, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Lucro (BRL)',
          data: profitData,
          borderColor: '#4e79a7',
          backgroundColor: 'rgba(78,121,167,0.1)',
          fill: true,
          tension: 0.3,
          pointRadius: 4,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'top' } },
        scales: { y: { beginAtZero: true } },
      },
    })
  }
}

onMounted(async () => {
  await loadConfig()
  await loadLog()
})

onUnmounted(() => {
  if (chartCostRevenueInstance) chartCostRevenueInstance.destroy()
  if (chartByServiceInstance) chartByServiceInstance.destroy()
  if (chartProfitInstance) chartProfitInstance.destroy()
})
</script>

<template>
  <div class="container-fluid py-3" style="max-width: 1400px;">
    <!-- Header -->
    <div class="d-flex align-items-center mb-4">
      <router-link to="/saas" class="btn btn-outline-secondary btn-sm me-3">
        <i class="bi bi-arrow-left"></i>
      </router-link>
      <h2 class="mb-0"><i class="bi bi-graph-up me-2"></i>Uso de IA &amp; Tokens</h2>
    </div>

    <!-- Tabs -->
    <ul class="nav nav-tabs mb-4">
      <li class="nav-item">
        <a class="nav-link" :class="{ active: tab === 'log' }" href="#" @click.prevent="tab = 'log'">
          <i class="bi bi-list-ul me-1"></i> Log de Uso
        </a>
      </li>
      <li class="nav-item">
        <a class="nav-link" :class="{ active: tab === 'dashboard' }" href="#" @click.prevent="tab = 'dashboard'; loadDashboard()">
          <i class="bi bi-bar-chart me-1"></i> Dashboard
        </a>
      </li>
    </ul>

    <!-- Loading -->
    <div v-if="loading" class="text-center py-5">
      <div class="spinner-border text-primary"></div>
    </div>

    <!-- TAB 1: Log de Uso -->
    <div v-show="tab === 'log' && !loading">
      <!-- Filters -->
      <div class="card border-0 shadow-sm mb-3">
        <div class="card-body py-2">
          <div class="row g-2 align-items-end">
            <div class="col-auto">
              <label class="form-label small text-muted mb-0">De</label>
              <input type="date" class="form-control form-control-sm" v-model="filters.dateFrom" />
            </div>
            <div class="col-auto">
              <label class="form-label small text-muted mb-0">Até</label>
              <input type="date" class="form-control form-control-sm" v-model="filters.dateTo" />
            </div>
            <div class="col-auto">
              <label class="form-label small text-muted mb-0">Empresa</label>
              <select class="form-select form-select-sm" v-model="filters.companyId">
                <option value="">Todas</option>
                <option v-for="c in companies" :key="c.id" :value="c.id">{{ c.name }}</option>
              </select>
            </div>
            <div class="col-auto">
              <label class="form-label small text-muted mb-0">Serviço</label>
              <select class="form-select form-select-sm" v-model="filters.serviceKey">
                <option value="">Todos</option>
                <option v-for="sk in SERVICE_KEYS" :key="sk" :value="sk">{{ sk }}</option>
              </select>
            </div>
            <div class="col-auto">
              <label class="form-label small text-muted mb-0">Provider</label>
              <select class="form-select form-select-sm" v-model="filters.provider">
                <option value="">Todos</option>
                <option value="openai">OpenAI</option>
                <option value="gemini">Gemini</option>
              </select>
            </div>
            <div class="col-auto">
              <button class="btn btn-primary btn-sm" @click="applyFilters">
                <i class="bi bi-funnel me-1"></i>Filtrar
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Table -->
      <div class="table-responsive">
        <table class="table table-sm table-hover align-middle">
          <thead>
            <tr>
              <th>Data</th>
              <th>Empresa</th>
              <th>Usuário</th>
              <th>Serviço</th>
              <th>Provider/Modelo</th>
              <th class="text-end">Tokens (in/out)</th>
              <th class="text-end">Custo (BRL)</th>
              <th class="text-end">Créditos</th>
              <th class="text-end">Receita (BRL)</th>
              <th class="text-end">Lucro</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in logRows" :key="row.id">
              <td class="small text-nowrap">{{ new Date(row.createdAt).toLocaleString('pt-BR') }}</td>
              <td class="small">{{ row.company?.name || '—' }}</td>
              <td class="small">{{ row.user?.name || row.user?.email || '—' }}</td>
              <td><code class="small">{{ row.serviceKey }}</code></td>
              <td class="small">{{ row.provider }}/{{ row.model }}</td>
              <td class="text-end small">{{ fmtNum(row.inputTokens) }} / {{ fmtNum(row.outputTokens) }}</td>
              <td class="text-end small">{{ fmtBrl(calcCostBrl(row)) }}</td>
              <td class="text-end small">{{ row.creditsSpent ?? '—' }}</td>
              <td class="text-end small">{{ fmtBrl(calcRevenueBrl(row)) }}</td>
              <td class="text-end">
                <span class="badge" :class="calcRevenueBrl(row) - calcCostBrl(row) >= 0 ? 'bg-success' : 'bg-danger'">
                  {{ fmtBrl(calcRevenueBrl(row) - calcCostBrl(row)) }}
                </span>
              </td>
            </tr>
            <tr v-if="logRows.length === 0">
              <td colspan="10" class="text-muted text-center py-3">Nenhum registro encontrado</td>
            </tr>
          </tbody>
          <tfoot v-if="logRows.length > 0">
            <tr class="fw-bold table-light">
              <td colspan="5">Totais da página</td>
              <td class="text-end small">{{ fmtNum(logTotals.inputTokens) }} / {{ fmtNum(logTotals.outputTokens) }}</td>
              <td class="text-end small">{{ fmtBrl(logTotals.costBrl) }}</td>
              <td class="text-end small">{{ logTotals.credits }}</td>
              <td class="text-end small">{{ fmtBrl(logTotals.revenueBrl) }}</td>
              <td class="text-end">
                <span class="badge" :class="logTotals.profit >= 0 ? 'bg-success' : 'bg-danger'">
                  {{ fmtBrl(logTotals.profit) }}
                </span>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <!-- Pagination -->
      <div class="d-flex align-items-center justify-content-between mt-3">
        <small class="text-muted">Mostrando {{ showing }} de {{ total }}</small>
        <div class="d-flex gap-1">
          <button class="btn btn-sm btn-outline-secondary" :disabled="page === 1" @click="page--; loadLog()">
            <i class="bi bi-chevron-left"></i>
          </button>
          <span class="btn btn-sm disabled">{{ page }} / {{ pages }}</span>
          <button class="btn btn-sm btn-outline-secondary" :disabled="page >= pages" @click="page++; loadLog()">
            <i class="bi bi-chevron-right"></i>
          </button>
        </div>
      </div>
    </div>

    <!-- TAB 2: Dashboard -->
    <div v-show="tab === 'dashboard' && !loading">
      <!-- Summary cards -->
      <div class="row g-3 mb-4">
        <div class="col-6 col-lg-3">
          <div class="card border-0 shadow-sm h-100">
            <div class="card-body text-center">
              <div class="text-muted small text-uppercase mb-1">Custo Total</div>
              <div class="fs-4 fw-bold text-danger">R$ {{ fmtBrl(summary.totals.costBrl) }}</div>
            </div>
          </div>
        </div>
        <div class="col-6 col-lg-3">
          <div class="card border-0 shadow-sm h-100">
            <div class="card-body text-center">
              <div class="text-muted small text-uppercase mb-1">Receita Total</div>
              <div class="fs-4 fw-bold text-success">R$ {{ fmtBrl(summary.totals.revenueBrl) }}</div>
            </div>
          </div>
        </div>
        <div class="col-6 col-lg-3">
          <div class="card border-0 shadow-sm h-100">
            <div class="card-body text-center">
              <div class="text-muted small text-uppercase mb-1">Margem</div>
              <div class="fs-4 fw-bold" :class="(summary.totals.revenueBrl || 0) >= (summary.totals.costBrl || 0) ? 'text-primary' : 'text-danger'">
                {{ summary.totals.revenueBrl && summary.totals.costBrl
                  ? (((summary.totals.revenueBrl - summary.totals.costBrl) / summary.totals.revenueBrl) * 100).toFixed(1) + '%'
                  : '—' }}
              </div>
            </div>
          </div>
        </div>
        <div class="col-6 col-lg-3">
          <div class="card border-0 shadow-sm h-100">
            <div class="card-body text-center">
              <div class="text-muted small text-uppercase mb-1">Lucro Total</div>
              <div class="fs-4 fw-bold" :class="(summary.totals.revenueBrl || 0) - (summary.totals.costBrl || 0) >= 0 ? 'text-success' : 'text-danger'">
                R$ {{ fmtBrl((summary.totals.revenueBrl || 0) - (summary.totals.costBrl || 0)) }}
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Charts -->
      <div class="row g-3 mb-4">
        <div class="col-lg-8">
          <div class="card border-0 shadow-sm h-100">
            <div class="card-body">
              <h6 class="mb-3">Custo vs Receita por mês</h6>
              <div style="height: 300px;">
                <canvas ref="chartCostRevenue"></canvas>
              </div>
            </div>
          </div>
        </div>
        <div class="col-lg-4">
          <div class="card border-0 shadow-sm h-100">
            <div class="card-body">
              <h6 class="mb-3">Distribuição de custo por serviço</h6>
              <div style="height: 300px;">
                <canvas ref="chartByService"></canvas>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="row g-3 mb-4">
        <div class="col-12">
          <div class="card border-0 shadow-sm">
            <div class="card-body">
              <h6 class="mb-3">Lucro mensal</h6>
              <div style="height: 250px;">
                <canvas ref="chartProfit"></canvas>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Margin Simulator -->
      <div class="card border-0 shadow-sm mt-4">
        <div class="card-body">
          <h6 class="mb-3"><i class="bi bi-sliders me-2"></i>Simulador de Margem</h6>
          <div class="row align-items-end mb-3 g-3">
            <div class="col-auto">
              <label class="form-label small text-muted">Margem desejada (%)</label>
              <input type="number" class="form-control" style="width: 120px;" v-model.number="desiredMargin" min="0" max="500" step="5" />
            </div>
            <div class="col-auto d-flex align-items-center">
              <div>
                <div class="text-muted small">Preço sugerido/crédito</div>
                <div class="fs-5 fw-bold text-primary">R$ {{ suggestedCreditPrice }}</div>
              </div>
            </div>
            <div class="col-auto d-flex align-items-center">
              <div>
                <div class="text-muted small">Lucro projetado</div>
                <div class="fs-5 fw-bold" :class="projectedProfit >= 0 ? 'text-success' : 'text-danger'">
                  R$ {{ fmtBrl(projectedProfit) }}
                </div>
              </div>
            </div>
          </div>

          <!-- Projection table per service -->
          <div class="table-responsive">
            <table class="table table-sm align-middle">
              <thead>
                <tr>
                  <th>Serviço</th>
                  <th class="text-end">Usos</th>
                  <th class="text-end">Créditos</th>
                  <th class="text-end">Custo (BRL)</th>
                  <th class="text-end">Preço Atual (BRL)</th>
                  <th class="text-end">Preço Novo (BRL)</th>
                  <th class="text-end">Lucro Projetado</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(svc, key) in summary.byService" :key="key">
                  <td><code class="small">{{ key }}</code></td>
                  <td class="text-end">{{ svc.count }}</td>
                  <td class="text-end">{{ svc.creditsSpent }}</td>
                  <td class="text-end">{{ fmtBrl(svc.costBrl) }}</td>
                  <td class="text-end">{{ fmtBrl(svc.creditsSpent * creditBrlPrice) }}</td>
                  <td class="text-end fw-semibold text-primary">{{ fmtBrl(svc.creditsSpent * suggestedCreditPriceNum) }}</td>
                  <td class="text-end fw-semibold" :class="svc.creditsSpent * suggestedCreditPriceNum - svc.costBrl >= 0 ? 'text-success' : 'text-danger'">
                    {{ fmtBrl(svc.creditsSpent * suggestedCreditPriceNum - svc.costBrl) }}
                  </td>
                </tr>
                <tr v-if="!Object.keys(summary.byService || {}).length">
                  <td colspan="7" class="text-muted text-center py-3">Sem dados</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
