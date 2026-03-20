<template>
  <div class="container-fluid py-3">
    <h4 class="mb-3">Desempenho do Cardápio</h4>

    <!-- Filters -->
    <div class="card mb-4">
      <div class="card-body">
        <div class="row g-3 align-items-end">
          <div class="col-md-3">
            <label class="form-label">Cardápio</label>
            <select class="form-select" v-model="filters.menuId">
              <option value="">Todos</option>
              <template v-for="store in stores" :key="store.id">
                <option disabled class="fw-bold">{{ store.name }}</option>
                <option v-for="menu in store.menus" :key="menu.id" :value="menu.id">
                  &nbsp;&nbsp;{{ menu.name }}
                </option>
              </template>
            </select>
          </div>
          <div class="col-md-4">
            <label class="form-label">Período</label>
            <div class="btn-group w-100">
              <button v-for="p in periods" :key="p.key"
                class="btn btn-sm"
                :class="filters.period === p.key ? 'btn-primary' : 'btn-outline-secondary'"
                @click="setPeriod(p.key)">
                {{ p.label }}
              </button>
            </div>
          </div>
          <template v-if="filters.period === 'custom'">
            <div class="col-md-2">
              <label class="form-label">De</label>
              <input type="date" class="form-control" v-model="filters.dateFrom" />
            </div>
            <div class="col-md-2">
              <label class="form-label">Até</label>
              <input type="date" class="form-control" v-model="filters.dateTo" />
            </div>
          </template>
          <div class="col-md-1">
            <button class="btn btn-primary w-100" @click="loadReport" :disabled="loading">
              <span v-if="loading" class="spinner-border spinner-border-sm me-1"></span>
              Gerar
            </button>
          </div>
        </div>
        <small class="text-muted mt-2 d-block" v-if="comparisonLabel">{{ comparisonLabel }}</small>
      </div>
    </div>

    <div v-if="loading" class="text-center py-5">
      <div class="spinner-border text-primary"></div>
    </div>

    <template v-if="!loading && loaded">
      <!-- Funnel -->
      <div class="card mb-4">
        <div class="card-header"><strong>Funil de Conversão</strong></div>
        <div class="card-body">
          <div class="row g-3">
            <div class="col" v-for="step in funnelSteps" :key="step.key">
              <div class="border rounded overflow-hidden d-flex flex-column" style="min-height:220px">
                <div class="p-3 pb-2 text-start flex-shrink-0">
                  <div class="fw-semibold" style="font-size:0.85rem;color:var(--text-primary)">{{ step.label }}</div>
                  <div class="fw-bold mt-1" style="font-size:1.75rem;line-height:1.1">{{ step.value.toLocaleString('pt-BR') }}</div>
                  <div class="mt-1" style="font-size:0.78rem;color:var(--text-secondary)">{{ step.description }}</div>
                  <div class="mt-1" style="font-size:0.78rem">
                    <span :class="step.changeClass">{{ step.changeIcon }} {{ step.changePercent }}</span>
                  </div>
                </div>
                <div class="mt-auto position-relative" :style="{height: Math.max(step.barPercent * 0.8, 12) + 'px', background: 'var(--primary)', borderRadius: '0 0 0 0'}">
                  <span class="position-absolute w-100 text-center text-white fw-bold" style="font-size:0.85rem;bottom:4px">{{ step.barPercent }}%</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Sales -->
      <div class="card mb-4">
        <div class="card-header"><strong>Vendas</strong></div>
        <div class="card-body">
          <div class="row g-3 mb-3">
            <div class="col-md-3" v-for="kpi in salesKpis" :key="kpi.label">
              <small class="text-muted">{{ kpi.label }}</small>
              <h5 class="mb-0">{{ kpi.value }}</h5>
              <small :class="kpi.changeClass">{{ kpi.changeIcon }} {{ kpi.changePercent }}</small>
            </div>
          </div>
          <canvas ref="salesChartRef" height="80"></canvas>
        </div>
      </div>

      <!-- Hours + Weekdays -->
      <div class="row g-3 mb-4">
        <div class="col-md-6">
          <div class="card h-100">
            <div class="card-header d-flex align-items-center gap-2">
              <strong>Horários com mais vendas</strong>
              <div class="btn-group btn-group-sm ms-auto">
                <button class="btn" :class="hourFilter==='week'?'btn-primary':'btn-outline-secondary'" @click="hourFilter='week'">Semana</button>
                <button class="btn" :class="hourFilter==='weekend'?'btn-primary':'btn-outline-secondary'" @click="hourFilter='weekend'">Fim de semana</button>
              </div>
            </div>
            <div class="card-body">
              <p class="mb-2">Melhor horário: <strong>{{ byHourData.bestHour }}</strong> — {{ byHourData.bestHourCount }} vendas</p>
              <canvas ref="hourChartRef" height="200"></canvas>
            </div>
          </div>
        </div>
        <div class="col-md-6">
          <div class="card h-100">
            <div class="card-header"><strong>Dias com mais vendas</strong></div>
            <div class="card-body">
              <p class="mb-2">Melhor dia: <strong>{{ byWeekdayData.bestDay }}</strong> — {{ byWeekdayData.bestDayCount }} pedidos</p>
              <canvas ref="weekdayChartRef" height="200"></canvas>
            </div>
          </div>
        </div>
      </div>

      <!-- Product Ranking -->
      <div class="card mb-4">
        <div class="card-header"><strong>Ranking de Itens do Cardápio</strong></div>
        <div class="card-body p-0">
          <div class="table-responsive">
          <table class="table table-hover align-middle mb-0">
            <thead>
              <tr>
                <th>#</th>
                <th>Produto</th>
                <th class="text-end">Qtd vendida</th>
                <th class="text-end">Receita</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in productRanking" :key="item.name">
                <td>{{ item.position }}</td>
                <td>{{ item.name }}</td>
                <td class="text-end">{{ item.quantity }}</td>
                <td class="text-end">R$ {{ Number(item.revenue).toFixed(2) }}</td>
              </tr>
              <tr v-if="!productRanking.length">
                <td colspan="4" class="text-center text-muted py-3">Nenhum dado no período</td>
              </tr>
            </tbody>
          </table>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, nextTick } from 'vue'
import api from '../../api.js'
import Chart from 'chart.js/auto'

const loading = ref(false)
const loaded = ref(false)
const stores = ref([])
const hourFilter = ref('week')

const filters = ref({
  menuId: '',
  period: '7d',
  dateFrom: '',
  dateTo: '',
})

const periods = [
  { key: 'today', label: 'Hoje' },
  { key: '7d', label: 'Últ. 7 dias' },
  { key: '30d', label: 'Últ. 30 dias' },
  { key: 'custom', label: 'Personalizado' },
]

const funnel = ref({ current: {}, previous: {} })
const sales = ref({ current: {}, previous: {} })
const byHourData = ref({ labels: [], data: [], bestHour: '-', bestHourCount: 0 })
const byWeekdayData = ref({ labels: [], data: [], bestDay: '-', bestDayCount: 0 })
const productRanking = ref([])

const salesChartRef = ref(null)
const hourChartRef = ref(null)
const weekdayChartRef = ref(null)
let salesChartInstance = null
let hourChartInstance = null
let weekdayChartInstance = null

const comparisonLabel = computed(() => {
  if (filters.value.period === 'today') return 'Comparação com o dia anterior'
  if (filters.value.period === '7d') return 'Comparação com os últimos 7 dias anteriores'
  if (filters.value.period === '30d') return 'Comparação com os últimos 30 dias anteriores'
  return ''
})

function setPeriod(key) {
  filters.value.period = key
  if (key !== 'custom') {
    const now = new Date()
    const to = now.toISOString().slice(0, 10)
    let from = to
    if (key === '7d') { const d = new Date(now); d.setDate(d.getDate() - 7); from = d.toISOString().slice(0, 10) }
    else if (key === '30d') { const d = new Date(now); d.setDate(d.getDate() - 30); from = d.toISOString().slice(0, 10) }
    filters.value.dateFrom = from
    filters.value.dateTo = to
  }
}

function pctChange(curr, prev) {
  if (!prev || prev === 0) return curr > 0 ? '+100%' : '0%'
  const pct = ((curr - prev) / prev * 100).toFixed(2)
  return (pct > 0 ? '+' : '') + pct + '%'
}
function changeClass(curr, prev) { return curr >= prev ? 'text-success' : 'text-danger' }
function changeIcon(curr, prev) { return curr >= prev ? '▲' : '▼' }

const funnelSteps = computed(() => {
  const c = funnel.value.current || {}
  const p = funnel.value.previous || {}
  const steps = [
    { key: 'VISIT', label: 'Visitas', description: 'visitaram seu cardápio' },
    { key: 'ITEM_VIEW', label: 'Visualizações', description: 'visualizaram algum item' },
    { key: 'ADD_TO_CART', label: 'Carrinho', description: 'adicionaram itens ao carrinho' },
    { key: 'CHECKOUT_START', label: 'Revisão', description: 'iniciaram o checkout' },
    { key: 'ORDER_COMPLETE', label: 'Concluídos', description: 'concluíram o pedido' },
  ]
  const maxVal = Math.max(...steps.map(s => c[s.key] || 0), 1)
  return steps.map(s => ({
    ...s,
    value: c[s.key] || 0,
    barPercent: Math.round(((c[s.key] || 0) / maxVal) * 100),
    changePercent: pctChange(c[s.key] || 0, p[s.key] || 0),
    changeClass: changeClass(c[s.key] || 0, p[s.key] || 0),
    changeIcon: changeIcon(c[s.key] || 0, p[s.key] || 0),
  }))
})

const salesKpis = computed(() => {
  const c = sales.value.current || {}
  const p = sales.value.previous || {}
  return [
    { label: 'Total de vendas', value: (c.totalSales || 0).toLocaleString('pt-BR'), changePercent: pctChange(c.totalSales, p.totalSales), changeClass: changeClass(c.totalSales, p.totalSales), changeIcon: changeIcon(c.totalSales, p.totalSales) },
    { label: 'Valor total', value: 'R$ ' + (c.totalRevenue || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 }), changePercent: pctChange(c.totalRevenue, p.totalRevenue), changeClass: changeClass(c.totalRevenue, p.totalRevenue), changeIcon: changeIcon(c.totalRevenue, p.totalRevenue) },
    { label: 'Ticket médio', value: 'R$ ' + (c.avgTicket || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 }), changePercent: pctChange(c.avgTicket, p.avgTicket), changeClass: changeClass(c.avgTicket, p.avgTicket), changeIcon: changeIcon(c.avgTicket, p.avgTicket) },
    { label: 'Novos clientes', value: (c.newCustomers || 0).toLocaleString('pt-BR'), changePercent: pctChange(c.newCustomers, p.newCustomers), changeClass: changeClass(c.newCustomers, p.newCustomers), changeIcon: changeIcon(c.newCustomers, p.newCustomers) },
  ]
})

async function loadReport() {
  loading.value = true
  const params = { dateFrom: filters.value.dateFrom, dateTo: filters.value.dateTo }
  if (filters.value.menuId) params.menuId = filters.value.menuId

  try {
    const [funnelRes, salesRes, hourRes, weekdayRes, rankingRes] = await Promise.all([
      api.get('/reports/menu-performance/funnel', { params }),
      api.get('/reports/menu-performance/sales', { params }),
      api.get('/reports/menu-performance/by-hour', { params }),
      api.get('/reports/menu-performance/by-weekday', { params }),
      api.get('/reports/menu-performance/product-ranking', { params }),
    ])

    funnel.value = funnelRes.data
    sales.value = salesRes.data
    byHourData.value = hourRes.data
    byWeekdayData.value = weekdayRes.data
    productRanking.value = rankingRes.data

    loaded.value = true
    await nextTick()
    renderCharts()
  } catch (e) {
    console.error('Error loading menu performance report:', e)
  } finally {
    loading.value = false
  }
}

function renderCharts() {
  // Sales line chart
  if (salesChartInstance) salesChartInstance.destroy()
  if (salesChartRef.value) {
    const daily = sales.value.current?.daily || {}
    const prevDaily = sales.value.previous?.daily || {}
    const labels = Object.keys(daily).sort()
    const prevLabels = Object.keys(prevDaily).sort()
    salesChartInstance = new Chart(salesChartRef.value, {
      type: 'line',
      data: {
        labels: labels.map(d => d.slice(5)),
        datasets: [
          { label: 'Período atual', data: labels.map(d => daily[d]?.count || 0), borderColor: '#105784', tension: 0.3, fill: false },
          { label: 'Período anterior', data: prevLabels.map(d => prevDaily[d]?.count || 0), borderColor: '#ccc', borderDash: [5, 5], tension: 0.3, fill: false },
        ],
      },
      options: { responsive: true, plugins: { legend: { position: 'bottom' } } },
    })
  }

  // Hour chart
  if (hourChartInstance) hourChartInstance.destroy()
  if (hourChartRef.value) {
    hourChartInstance = new Chart(hourChartRef.value, {
      type: 'bar',
      data: {
        labels: byHourData.value.labels,
        datasets: [{ data: byHourData.value.data, backgroundColor: '#105784' }],
      },
      options: { responsive: true, indexAxis: 'y', plugins: { legend: { display: false } } },
    })
  }

  // Weekday chart
  if (weekdayChartInstance) weekdayChartInstance.destroy()
  if (weekdayChartRef.value) {
    weekdayChartInstance = new Chart(weekdayChartRef.value, {
      type: 'bar',
      data: {
        labels: byWeekdayData.value.labels,
        datasets: [{ data: byWeekdayData.value.data, backgroundColor: '#105784' }],
      },
      options: { responsive: true, plugins: { legend: { display: false } } },
    })
  }
}

onMounted(async () => {
  setPeriod('7d')
  try {
    const res = await api.get('/reports/menu-performance/menus')
    stores.value = res.data
  } catch (e) {
    console.error('Error loading menus:', e)
  }
  loadReport()
})
</script>
