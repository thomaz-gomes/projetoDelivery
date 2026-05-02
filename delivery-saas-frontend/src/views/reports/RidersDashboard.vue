<template>
  <div class="container-fluid py-3">
    <h4 class="mb-3">Dashboard de Entregadores</h4>

    <!-- Filtros -->
    <div class="card mb-4">
      <div class="card-body">
        <div class="row g-2 align-items-end">
          <div class="col-12 col-md-4">
            <SelectInput
              v-model="filters.riderId"
              :options="riderOptions"
              label="Entregador"
              placeholder="Todos"
            />
          </div>
          <div class="col-6 col-md-3">
            <label class="form-label">Data início</label>
            <input type="date" v-model="filters.from" class="form-control" />
          </div>
          <div class="col-6 col-md-3">
            <label class="form-label">Data fim</label>
            <input type="date" v-model="filters.to" class="form-control" />
          </div>
          <div class="col-12 col-md-2 d-flex align-items-end">
            <BaseButton variant="primary" class="w-100" :loading="loading" @click="load">
              Gerar
            </BaseButton>
          </div>
        </div>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="text-center py-5">
      <div class="spinner-border text-primary"></div>
      <p class="mt-2 text-muted">Carregando dados...</p>
    </div>

    <!-- Sem dados -->
    <div v-else-if="loaded && !data.totalDeliveries" class="alert alert-info text-center">
      <i class="bi bi-info-circle me-2"></i>
      Nenhuma entrega encontrada no período selecionado.
    </div>

    <!-- Dashboard -->
    <template v-else-if="loaded && data.totalDeliveries">
      <!-- Stat Cards -->
      <div class="stat-grid mb-4">
        <div class="stat-card">
          <div class="stat-icon stat-icon--primary"><i class="bi-stopwatch"></i></div>
          <div class="stat-body">
            <div class="stat-label">Tempo médio</div>
            <div class="stat-value">{{ data.avgDeliveryTime }} min</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon stat-icon--success"><i class="bi-cash-stack"></i></div>
          <div class="stat-body">
            <div class="stat-label">Custo médio / entrega</div>
            <div class="stat-value">{{ formatCurrency(data.avgCostPerDelivery) }}</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon stat-icon--warning"><i class="bi-box-seam"></i></div>
          <div class="stat-body">
            <div class="stat-label">Total de entregas</div>
            <div class="stat-value">{{ data.totalDeliveries }}</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon stat-icon--info"><i class="bi-hash"></i></div>
          <div class="stat-body">
            <div class="stat-label">Concluídos com código</div>
            <div class="stat-value">{{ data.completedWithCode }}</div>
            <div class="small text-muted mt-1">{{ data.completedWithCodePct }}% do total</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon stat-icon--danger"><i class="bi-x-circle"></i></div>
          <div class="stat-body">
            <div class="stat-label">Cancelados após despacho</div>
            <div class="stat-value">{{ data.cancelledAfterDispatch }}</div>
          </div>
        </div>
      </div>

      <!-- Gráfico de barras -->
      <div class="card mb-4" v-if="data.avgDeliveryTimeByRider.length > 1">
        <div class="card-header d-flex align-items-center gap-2">
          <i class="bi bi-bar-chart-fill text-primary"></i>
          <strong>Tempo médio por entregador (min)</strong>
        </div>
        <div class="card-body">
          <BaseChart
            v-if="data && data.avgDeliveryTimeByRider && data.avgDeliveryTimeByRider.length"
            type="bar"
            :data="chartData"
            :options="chartOptions"
            height="320px"
          />
          <div v-else-if="!loading" class="text-muted text-center py-4">Sem dados para exibir</div>
        </div>
      </div>

      <!-- Tabela detalhada -->
      <div class="card">
        <div class="card-header d-flex align-items-center gap-2">
          <i class="bi bi-table text-primary"></i>
          <strong>Detalhamento por entregador</strong>
        </div>
        <div class="card-body p-0">
          <div class="table-responsive">
            <table class="table table-hover align-middle mb-0">
              <thead>
                <tr>
                  <th>Entregador</th>
                  <th class="text-center">Entregas</th>
                  <th class="text-center">Tempo médio</th>
                  <th class="text-end">Custo médio</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="r in data.avgDeliveryTimeByRider" :key="r.riderId">
                  <td>{{ r.riderName }}</td>
                  <td class="text-center">{{ r.totalDeliveries }}</td>
                  <td class="text-center">{{ r.avgTime }} min</td>
                  <td class="text-end">{{ formatCurrency(r.avgCost || 0) }}</td>
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
import { ref, reactive, computed, onMounted } from 'vue'
import api from '../../api'
import SelectInput from '../../components/form/select/SelectInput.vue'
import BaseButton from '../../components/BaseButton.vue'
import BaseChart from '@/components/BaseChart.vue'

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}
function firstDayOfMonthStr() {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10)
}
function formatCurrency(val) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val)
}

const filters = reactive({
  riderId: '',
  from: firstDayOfMonthStr(),
  to: todayStr(),
})

const loading = ref(false)
const loaded = ref(false)
const data = ref({})
const riders = ref([])
const riderOptions = ref([])
async function fetchRiders() {
  try {
    const res = await api.get('/riders')
    riders.value = res.data || []
    riderOptions.value = [
      { value: '', label: 'Todos' },
      ...riders.value.map(r => ({ value: r.id, label: r.name })),
    ]
  } catch (e) {
    console.error('Failed to fetch riders:', e)
  }
}

async function load() {
  loading.value = true
  loaded.value = false

  try {
    const params = { from: filters.from, to: filters.to }
    if (filters.riderId) params.riderId = filters.riderId

    const res = await api.get('/reports/riders-dashboard', { params })
    data.value = res.data
    loaded.value = true
  } catch (e) {
    console.error('RidersDashboard load error:', e)
    const { default: Swal } = await import('sweetalert2')
    Swal.fire({ icon: 'error', text: e.response?.data?.message || 'Erro ao carregar dashboard' })
  } finally {
    loading.value = false
  }
}

const chartData = computed(() => {
  const riders = data.value?.avgDeliveryTimeByRider || []
  const COLORS = ['#4e79a7','#f28e2b','#e15759','#76b7b2','#59a14f','#edc948','#b07aa1','#ff9da7','#9c755f','#bab0ac']
  const labels = riders.map(r => r.riderName)
  const values = riders.map(r => r.avgTime)
  const colors = riders.map((_, i) => COLORS[i % COLORS.length])
  return {
    labels,
    datasets: [{
      label: 'Tempo médio (min)',
      data: values,
      backgroundColor: colors,
      borderColor: colors.map(c => c + 'cc'),
      borderWidth: 1,
      borderRadius: 4,
    }],
  }
})

const chartOptions = computed(() => ({
  indexAxis: 'y',
  plugins: {
    legend: { display: false },
    tooltip: { callbacks: { label: (ctx) => ` ${ctx.raw} min` } },
  },
  scales: {
    x: {
      beginAtZero: true,
      grid: { color: '#f0f0f0' },
      title: { display: true, text: 'Minutos' },
    },
    y: {
      ticks: {
        font: { size: 12 },
        callback: (val, idx) => {
          const lbl = (data.value?.avgDeliveryTimeByRider || [])[idx]?.riderName || ''
          return lbl.length > 25 ? lbl.slice(0, 23) + '…' : lbl
        },
      },
    },
  },
}))

onMounted(() => {
  fetchRiders()
})
</script>
