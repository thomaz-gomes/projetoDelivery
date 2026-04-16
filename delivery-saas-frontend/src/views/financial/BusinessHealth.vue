<template>
  <div class="container py-3 position-relative">
    <!-- Loading overlay -->
    <div v-if="loading" class="loading-overlay">
      <div class="spinner-border text-primary" role="status">
        <span class="visually-hidden">Carregando...</span>
      </div>
    </div>

    <!-- Header -->
    <div class="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3">
      <div>
        <h3 class="mb-0">Saúde do Negócio</h3>
        <small v-if="data?.period" class="text-muted">
          {{ data.period.label }} ({{ formatDate(data.period.from) }} – {{ formatDate(data.period.to) }})
        </small>
      </div>
      <div class="d-flex flex-wrap gap-2">
        <select class="form-select form-select-sm w-auto" v-model="period" @change="load">
          <option v-for="p in PERIODS" :key="p.code" :value="p.code">{{ p.label }}</option>
        </select>
        <select v-if="stores.length > 1" class="form-select form-select-sm w-auto" v-model="storeId" @change="load">
          <option value="">Todas as lojas</option>
          <option v-for="s in stores" :key="s.id" :value="s.id">{{ s.name }}</option>
        </select>
      </div>
    </div>

    <!-- Data availability banner (Task 3.4) -->
    <div v-if="showDataAvailabilityBanner" class="alert alert-info small mb-3">
      <i class="bi bi-info-circle me-1"></i>
      Dados de CMV disponíveis a partir de {{ formatDate(data.dataStartDate) }}.
      Períodos anteriores podem estar incompletos.
    </div>

    <!-- Alerts -->
    <div v-if="data?.alerts?.length" class="mb-3">
      <div
        v-for="(al, i) in data.alerts"
        :key="i"
        class="alert d-flex align-items-start gap-2 small mb-2"
        :class="alertClass(al.level)"
      >
        <i :class="['bi', alertIcon(al.level), 'mt-1']"></i>
        <div class="flex-grow-1">
          {{ al.message }}
          <router-link v-if="al.actionUrl" :to="al.actionUrl" class="ms-2 alert-link">
            Ver detalhes <i class="bi bi-arrow-right-short"></i>
          </router-link>
        </div>
      </div>
    </div>

    <!-- KPI grid -->
    <div v-if="data?.kpis" class="row g-3 mb-4">
      <div class="col-md-3 col-6">
        <KpiCard
          label="Faturamento"
          :value="data.kpis.revenue.value"
          formatter="currency"
          :delta="data.kpis.revenue.deltaPct"
          icon="bi-cash-coin"
        />
      </div>
      <div class="col-md-3 col-6">
        <KpiCard
          label="CMV"
          :value="data.kpis.cmv.pct"
          formatter="percent"
          :status="data.kpis.cmv.status"
          :band="data.kpis.cmv.band"
          icon="bi-box-seam"
        />
      </div>
      <div class="col-md-3 col-6">
        <KpiCard
          label="Margem Bruta"
          :value="data.kpis.grossMargin.pct || 0"
          formatter="percent"
          :status="data.kpis.grossMargin.status"
          icon="bi-graph-up"
        />
      </div>
      <div class="col-md-3 col-6">
        <KpiCard
          label="Lucro Operacional"
          :value="data.kpis.operatingProfit.pct || 0"
          formatter="percent"
          :status="data.kpis.operatingProfit.status"
          icon="bi-bar-chart-line"
        />
      </div>
      <div class="col-md-3 col-6">
        <KpiCard
          label="Lucro Líquido"
          :value="data.kpis.netProfit.pct || 0"
          formatter="percent"
          :status="data.kpis.netProfit.status"
          icon="bi-piggy-bank"
        />
      </div>
      <div class="col-md-3 col-6">
        <KpiCard
          label="Ticket Médio"
          :value="data.kpis.ticketAvg.value"
          formatter="currency"
          :delta="data.kpis.ticketAvg.deltaPct"
          icon="bi-receipt"
        />
      </div>
      <div class="col-md-3 col-6">
        <KpiCard
          label="Pedidos"
          :value="data.kpis.ordersCount.value"
          formatter="integer"
          :delta="data.kpis.ordersCount.deltaPct"
          icon="bi-bag-check"
        />
      </div>
      <div class="col-md-3 col-6">
        <KpiCard
          label="Margem Bruta (R$)"
          :value="data.kpis.grossMargin.value"
          formatter="currency"
          icon="bi-cash"
        />
      </div>
    </div>

    <!-- Break-even card -->
    <div v-if="data?.breakEven" class="card mb-4">
      <div class="card-body">
        <div class="d-flex align-items-center justify-content-between mb-3">
          <h6 class="mb-0"><i class="bi bi-graph-up-arrow me-2"></i>Ponto de Equilíbrio</h6>
        </div>
        <BreakEvenBar
          :current-revenue="Number(data.breakEven.currentRevenue) || 0"
          :break-even-revenue="data.breakEven.breakEvenRevenue"
          :safety-margin-pct="data.breakEven.safetyMarginPct"
        />
        <div class="row g-3 mt-2">
          <div class="col-md-3 col-6">
            <div class="text-muted small">Custos fixos</div>
            <div class="fw-semibold">{{ formatCurrency(data.breakEven.fixedCosts) }}</div>
          </div>
          <div class="col-md-3 col-6">
            <div class="text-muted small">Margem de contribuição</div>
            <div class="fw-semibold">{{ formatPct(data.breakEven.contributionMarginPct) }}</div>
          </div>
          <div class="col-md-3 col-6">
            <div class="text-muted small">Break-even</div>
            <div class="fw-semibold">
              {{ data.breakEven.breakEvenRevenue != null ? formatCurrency(data.breakEven.breakEvenRevenue) : '—' }}
            </div>
          </div>
          <div class="col-md-3 col-6">
            <div class="text-muted small">Margem de segurança</div>
            <div
              class="fw-semibold"
              :class="data.breakEven.safetyMarginPct != null && data.breakEven.safetyMarginPct < 0 ? 'text-danger' : 'text-success'"
            >
              {{ data.breakEven.safetyMarginPct != null ? formatPct(data.breakEven.safetyMarginPct) : '—' }}
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Top / Bottom products -->
    <div class="row g-3 mb-4">
      <div class="col-md-6">
        <div class="card h-100">
          <div class="card-body">
            <h6 class="mb-3"><i class="bi bi-trophy me-2"></i>Top 5 Margem (R$)</h6>
            <div v-if="!data?.topProducts?.length" class="text-muted small">Sem dados no período.</div>
            <ul v-else class="list-unstyled mb-0">
              <li
                v-for="p in data.topProducts"
                :key="p.productId"
                class="d-flex justify-content-between align-items-center py-2 border-bottom"
              >
                <div class="text-truncate pe-2">
                  <div class="fw-semibold text-truncate">{{ p.productName }}</div>
                  <div class="text-muted small">{{ p.qtySold }} vendidos · {{ formatPct(p.marginPct) }}</div>
                </div>
                <span class="badge bg-success">{{ formatCurrency(p.marginAbs) }}</span>
              </li>
            </ul>
          </div>
        </div>
      </div>
      <div class="col-md-6">
        <div class="card h-100">
          <div class="card-body">
            <h6 class="mb-3"><i class="bi bi-exclamation-triangle me-2"></i>Pior 5 Margem (%)</h6>
            <div v-if="!data?.bottomProducts?.length" class="text-muted small">Sem dados no período.</div>
            <ul v-else class="list-unstyled mb-0">
              <li
                v-for="p in data.bottomProducts"
                :key="p.productId"
                class="d-flex justify-content-between align-items-center py-2 border-bottom"
              >
                <div class="text-truncate pe-2">
                  <div class="fw-semibold text-truncate">{{ p.productName }}</div>
                  <div class="text-muted small">
                    {{ p.qtySold }} vendidos · {{ formatCurrency(p.marginAbs) }}
                  </div>
                </div>
                <span class="badge" :class="marginBadgeClass(p.marginPct)">
                  {{ formatPct(p.marginPct) }}
                </span>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>

    <!-- Empty state -->
    <div v-if="!loading && !data" class="text-center text-muted py-5">
      <i class="bi bi-bar-chart display-4 d-block mb-2"></i>
      <p>Nenhum dado disponível para o período selecionado.</p>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import Swal from 'sweetalert2';
import api from '../../api';
import KpiCard from '../../components/KpiCard.vue';
import BreakEvenBar from '../../components/BreakEvenBar.vue';

const PERIODS = [
  { code: 'current_month', label: 'Mês atual' },
  { code: 'last_month', label: 'Mês anterior' },
  { code: 'last_30d', label: 'Últimos 30 dias' },
  { code: 'current_quarter', label: 'Trimestre atual' },
  { code: 'last_quarter', label: 'Trimestre anterior' },
  { code: 'current_year', label: 'Ano atual' },
];

const period = ref('current_month');
const storeId = ref('');
const stores = ref([]);
const data = ref(null);
const loading = ref(false);

const showDataAvailabilityBanner = computed(() => {
  if (!data.value?.dataStartDate || !data.value?.period?.from) return false;
  return new Date(data.value.dataStartDate) > new Date(data.value.period.from);
});

async function loadStores() {
  try {
    const { data: resp } = await api.get('/stores');
    stores.value = resp || [];
  } catch (e) {
    console.warn('Failed to load stores:', e);
  }
}

async function load() {
  loading.value = true;
  try {
    const params = { period: period.value };
    if (storeId.value) params.storeId = storeId.value;
    const { data: resp } = await api.get('/financial/reports/business-health', { params });
    data.value = resp;
  } catch (e) {
    console.error('Failed to load business health:', e);
    Swal.fire({
      icon: 'error',
      title: 'Erro ao carregar',
      text: e.response?.data?.message || 'Não foi possível carregar os indicadores de saúde do negócio.',
    });
    data.value = null;
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  await loadStores();
  await load();
});

function formatCurrency(v) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v) || 0);
}

function formatPct(v) {
  if (v == null) return '—';
  const n = Number(v) || 0;
  return `${n.toFixed(1)}%`;
}

function formatDate(s) {
  if (!s) return '';
  try {
    return new Date(s).toLocaleDateString('pt-BR');
  } catch {
    return s;
  }
}

function alertClass(level) {
  switch (level) {
    case 'danger': return 'alert-danger';
    case 'warning': return 'alert-warning';
    case 'info': return 'alert-info';
    default: return 'alert-secondary';
  }
}

function alertIcon(level) {
  switch (level) {
    case 'danger': return 'bi-exclamation-octagon';
    case 'warning': return 'bi-exclamation-triangle';
    case 'info': return 'bi-info-circle';
    default: return 'bi-chat-left-text';
  }
}

function marginBadgeClass(pct) {
  const n = Number(pct) || 0;
  if (n < 0) return 'bg-danger';
  if (n < 20) return 'bg-warning text-dark';
  return 'bg-success';
}
</script>

<style scoped>
.loading-overlay {
  position: absolute;
  inset: 0;
  background-color: rgba(255, 255, 255, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
  border-radius: 0.375rem;
}
</style>
