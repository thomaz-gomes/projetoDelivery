<template>
  <div class="container-fluid py-3">
    <h3 class="mb-3">Relatório de Produtos</h3>

    <!-- Filtros -->
    <div class="card mb-4">
      <div class="card-body">
        <div class="row g-2 align-items-end">
          <div class="col-md-3">
            <label class="form-label">Data início</label>
            <input type="date" v-model="filters.from" class="form-control" />
          </div>
          <div class="col-md-3">
            <label class="form-label">Data fim</label>
            <input type="date" v-model="filters.to" class="form-control" />
          </div>
          <div class="col-md-2">
            <label class="form-label">Top produtos (gráficos 3 e 4)</label>
            <input type="number" v-model.number="filters.topN" class="form-control" min="2" max="10" />
          </div>
          <div class="col-md-2">
            <label class="form-label">Top produtos (gráficos 1 e 2)</label>
            <input type="number" v-model.number="filters.limit" class="form-control" min="3" max="30" />
          </div>
          <div class="col-md-2 d-flex align-items-end">
            <button class="btn btn-primary w-100" @click="load" :disabled="loading">
              <span v-if="loading" class="spinner-border spinner-border-sm me-1"></span>
              Gerar Relatório
            </button>
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
    <div v-else-if="loaded && noData" class="alert alert-info text-center">
      <i class="bi bi-info-circle me-2"></i>
      Nenhum pedido encontrado no período selecionado.
    </div>

    <!-- Gráficos -->
    <template v-else-if="loaded">
      <div class="row g-4">
        <!-- Gráfico 1: Top por Quantidade -->
        <div class="col-12">
          <div class="card">
            <div class="card-header d-flex align-items-center gap-2">
              <i class="bi bi-bar-chart-fill text-primary"></i>
              <strong>Produtos mais vendidos por quantidade</strong>
              <span class="badge bg-secondary ms-auto">Top {{ topByCount.length }}</span>
            </div>
            <div class="card-body">
              <BaseChart type="bar" :data="chartCountData" :options="chartCountOptions" height="400px" />
            </div>
          </div>
        </div>

        <!-- Gráfico 2: Top por Faturamento -->
        <div class="col-12">
          <div class="card">
            <div class="card-header d-flex align-items-center gap-2">
              <i class="bi bi-currency-dollar text-success"></i>
              <strong>Produtos mais vendidos por faturamento</strong>
              <span class="badge bg-secondary ms-auto">Top {{ topByRevenue.length }}</span>
            </div>
            <div class="card-body">
              <BaseChart type="bar" :data="chartRevenueData" :options="chartRevenueOptions" height="400px" />
            </div>
          </div>
        </div>

        <!-- Gráfico 3: Por Dia da Semana -->
        <div class="col-12">
          <div class="card">
            <div class="card-header d-flex align-items-center gap-2">
              <i class="bi bi-calendar-week text-warning"></i>
              <strong>Produtos mais vendidos por dia da semana</strong>
              <span class="badge bg-secondary ms-auto">Top {{ filters.topN }} produtos</span>
            </div>
            <div class="card-body">
              <BaseChart type="bar" :data="chartWeekdayData" :options="chartWeekdayOptions" height="300px" />
            </div>
          </div>
        </div>

        <!-- Gráfico 4: Por Hora do Dia -->
        <div class="col-12">
          <div class="card">
            <div class="card-header d-flex align-items-center gap-2">
              <i class="bi bi-clock text-danger"></i>
              <strong>Produtos mais vendidos por hora do dia</strong>
              <span class="badge bg-secondary ms-auto">Top {{ filters.topN }} produtos</span>
            </div>
            <div class="card-body">
              <BaseChart type="line" :data="chartHourData" :options="chartHourOptions" height="300px" />
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script>
import BaseChart from '@/components/BaseChart.vue';
import api from '../../api';

const COLORS = ['#4e79a7','#f28e2b','#e15759','#76b7b2','#59a14f','#edc948','#b07aa1','#ff9da7','#9c755f','#bab0ac']

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function firstDayOfMonthStr() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

export default {
  name: 'ProductsReport',

  components: { BaseChart },

  data() {
    return {
      filters: {
        from: firstDayOfMonthStr(),
        to: todayStr(),
        topN: 5,
        limit: 10,
      },
      loading: false,
      loaded: false,
      topByCount: [],
      topByRevenue: [],
      byWeekday: null,
      byHour: null,
    };
  },

  computed: {
    noData() {
      return (
        !this.topByCount.length &&
        !this.topByRevenue.length
      );
    },
    chartCountData() {
      const items = this.topByCount || []
      const labels = items.map(i => i.name)
      const colors = items.map((_, i) => COLORS[i % COLORS.length])
      return { labels, datasets: [{ label: 'Quantidade vendida', data: items.map(i => i.quantity), backgroundColor: colors, borderColor: colors.map(c => c + 'cc'), borderWidth: 1, borderRadius: 4 }] }
    },
    chartCountOptions() {
      const labels = (this.topByCount || []).map(i => i.name)
      return {
        indexAxis: 'y',
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => ` ${ctx.raw} unidades` } } },
        scales: {
          x: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: '#f0f0f0' } },
          y: { ticks: { font: { size: 12 }, callback: (val, idx) => { const l = labels[idx] || ''; return l.length > 30 ? l.slice(0, 28) + '…' : l } } },
        },
      }
    },
    chartRevenueData() {
      const items = this.topByRevenue || []
      const labels = items.map(i => i.name)
      const colors = items.map((_, i) => COLORS[i % COLORS.length])
      return { labels, datasets: [{ label: 'Faturamento (R$)', data: items.map(i => i.revenue), backgroundColor: colors, borderColor: colors.map(c => c + 'cc'), borderWidth: 1, borderRadius: 4 }] }
    },
    chartRevenueOptions() {
      const fmt = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)
      const fmtShort = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v)
      const labels = (this.topByRevenue || []).map(i => i.name)
      return {
        indexAxis: 'y',
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => ` ${fmt(ctx.raw)}` } } },
        scales: {
          x: { beginAtZero: true, ticks: { callback: fmtShort }, grid: { color: '#f0f0f0' } },
          y: { ticks: { font: { size: 12 }, callback: (val, idx) => { const l = labels[idx] || ''; return l.length > 30 ? l.slice(0, 28) + '…' : l } } },
        },
      }
    },
    chartWeekdayData() {
      const { labels = [], series = [] } = this.byWeekday || {}
      return {
        labels,
        datasets: series.map((s, i) => ({
          label: s.name.length > 25 ? s.name.slice(0, 23) + '…' : s.name,
          data: s.data,
          backgroundColor: COLORS[i % COLORS.length] + 'cc',
          borderColor: COLORS[i % COLORS.length],
          borderWidth: 1,
          borderRadius: 3,
        })),
      }
    },
    chartWeekdayOptions() {
      return {
        plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${ctx.raw} un` } } },
        scales: { x: { grid: { color: '#f0f0f0' } }, y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: '#f0f0f0' } } },
      }
    },
    chartHourData() {
      const { labels = [], series = [] } = this.byHour || {}
      return {
        labels,
        datasets: series.map((s, i) => ({
          label: s.name.length > 25 ? s.name.slice(0, 23) + '…' : s.name,
          data: s.data,
          borderColor: COLORS[i % COLORS.length],
          backgroundColor: COLORS[i % COLORS.length] + '33',
          borderWidth: 2,
          pointRadius: 3,
          fill: false,
          tension: 0.3,
        })),
      }
    },
    chartHourOptions() {
      return {
        plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${ctx.raw} un` } } },
        scales: { x: { grid: { color: '#f0f0f0' } }, y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: '#f0f0f0' } } },
      }
    },
  },

  methods: {
    async load() {
      this.loading = true;
      this.loaded = false;

      const params = {
        dateFrom: this.filters.from,
        dateTo: this.filters.to,
        topN: this.filters.topN,
        limit: this.filters.limit,
      };

      try {
        const [r1, r2, r3, r4] = await Promise.all([
          api.get('/reports/products/top-by-count', { params }),
          api.get('/reports/products/top-by-revenue', { params }),
          api.get('/reports/products/by-weekday', { params }),
          api.get('/reports/products/by-hour', { params }),
        ]);

        this.topByCount = r1.data || [];
        this.topByRevenue = r2.data || [];
        this.byWeekday = r3.data || null;
        this.byHour = r4.data || null;
        this.loaded = true;
      } catch (e) {
        console.error('ProductsReport load error:', e);
        alert('Erro ao carregar dados do relatório.');
      } finally {
        this.loading = false;
      }
    },
  },
};
</script>
