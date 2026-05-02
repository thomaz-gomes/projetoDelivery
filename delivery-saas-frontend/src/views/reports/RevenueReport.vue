<template>
  <div class="container py-3">
    <h3 class="mb-3">Relatório de Faturamento</h3>

    <!-- Filtros -->
    <div class="card mb-4">
      <div class="card-body">
        <div class="row g-2 align-items-end">
          <div class="col-md-4">
            <label class="form-label">Data início</label>
            <input type="date" v-model="filters.from" class="form-control" />
          </div>
          <div class="col-md-4">
            <label class="form-label">Data fim</label>
            <input type="date" v-model="filters.to" class="form-control" />
          </div>
          <div class="col-md-4 d-flex align-items-end">
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
    <div v-else-if="loaded && summary.totalOrders === 0" class="alert alert-info text-center">
      <i class="bi bi-info-circle me-2"></i>
      Nenhum pedido encontrado no período selecionado.
    </div>

    <!-- Conteúdo -->
    <template v-else-if="loaded">

      <!-- Cards de resumo -->
      <div class="row g-3 mb-4">
        <div class="col-xl-3 col-sm-6">
          <div class="card text-white h-100" style="background: #4f81e0;">
            <div class="card-body py-3">
              <div class="small opacity-75 mb-1">
                <i class="bi bi-currency-dollar me-1"></i>Faturamento Total
              </div>
              <div class="fs-5 fw-bold">{{ fmtCurrency(summary.totalRevenue) }}</div>
              <div class="small opacity-75 mt-1">{{ summary.totalOrders }} pedidos</div>
            </div>
          </div>
        </div>
        <div class="col-xl-3 col-sm-6">
          <div class="card text-white h-100" style="background: #1abc9c;">
            <div class="card-body py-3">
              <div class="small opacity-75 mb-1">
                <i class="bi bi-receipt me-1"></i>Ticket Médio
              </div>
              <div class="fs-5 fw-bold">{{ fmtCurrency(summary.avgTicket) }}</div>
              <div class="small opacity-75 mt-1">geral</div>
            </div>
          </div>
        </div>
        <div class="col-xl-3 col-sm-6">
          <div class="card text-white h-100" style="background: #e04f4f;">
            <div class="card-body py-3">
              <div class="small opacity-75 mb-1">
                <i class="bi bi-bicycle me-1"></i>Ticket Médio Delivery
              </div>
              <div class="fs-5 fw-bold">{{ fmtCurrency(summary.avgDelivery) }}</div>
              <div class="small opacity-75 mt-1">por pedido delivery</div>
            </div>
          </div>
        </div>
        <div class="col-xl-3 col-sm-6">
          <div class="card text-white h-100" style="background: #f5a623;">
            <div class="card-body py-3">
              <div class="small opacity-75 mb-1">
                <i class="bi bi-shop me-1"></i>Ticket Médio Balcão
              </div>
              <div class="fs-5 fw-bold">{{ fmtCurrency(summary.avgBalcao) }}</div>
              <div class="small opacity-75 mt-1">por pedido balcão</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Tabela por canal -->
      <div class="card mb-4">
        <div class="card-header d-flex align-items-center gap-2">
          <i class="bi bi-table text-secondary"></i>
          <strong>Resumo por canal</strong>
        </div>
        <div class="table-responsive">
          <table class="table table-hover mb-0">
            <thead>
              <tr>
                <th>Canal</th>
                <th class="text-end">Pedidos</th>
                <th class="text-end">Faturamento</th>
                <th class="text-end">Ticket Médio</th>
                <th style="min-width: 160px;">Representatividade</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="ch in summary.byChannel" :key="ch.name">
                <td>
                  <span class="badge" :style="{ background: channelColor(ch.name) }">
                    {{ ch.name }}
                  </span>
                </td>
                <td class="text-end">{{ ch.orderCount }}</td>
                <td class="text-end fw-semibold">{{ fmtCurrency(ch.totalRevenue) }}</td>
                <td class="text-end">{{ fmtCurrency(ch.avgTicket) }}</td>
                <td>
                  <div class="d-flex align-items-center gap-2">
                    <div class="progress flex-grow-1" style="height: 8px;">
                      <div
                        class="progress-bar"
                        :style="{ width: pct(ch.totalRevenue) + '%', background: channelColor(ch.name) }"
                      ></div>
                    </div>
                    <small class="text-muted" style="min-width: 36px; text-align: right;">
                      {{ pct(ch.totalRevenue).toFixed(1) }}%
                    </small>
                  </div>
                </td>
              </tr>
            </tbody>
            <tfoot class="table-light fw-semibold">
              <tr>
                <td>Total</td>
                <td class="text-end">{{ summary.totalOrders }}</td>
                <td class="text-end">{{ fmtCurrency(summary.totalRevenue) }}</td>
                <td class="text-end">{{ fmtCurrency(summary.avgTicket) }}</td>
                <td>100%</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <!-- Gráfico: Faturamento por dia -->
      <div class="card mb-4">
        <div class="card-header d-flex align-items-center gap-2">
          <i class="bi bi-graph-up text-primary"></i>
          <strong>Faturamento por dia</strong>
        </div>
        <div class="card-body">
          <BaseChart type="line" :data="chartByDayData" :options="chartByDayOptions" height="300px" />
        </div>
      </div>

      <div class="row g-4 mb-2">
        <!-- Gráfico: Faturamento por canal (doughnut) -->
        <div class="col-md-6">
          <div class="card h-100">
            <div class="card-header d-flex align-items-center gap-2">
              <i class="bi bi-pie-chart text-success"></i>
              <strong>Participação por canal</strong>
            </div>
            <div class="card-body d-flex align-items-center justify-content-center">
              <BaseChart type="doughnut" :data="chartChannelData" :options="chartChannelOptions" height="260px" />
            </div>
          </div>
        </div>

        <!-- Gráfico: Ticket médio por canal -->
        <div class="col-md-6">
          <div class="card h-100">
            <div class="card-header d-flex align-items-center gap-2">
              <i class="bi bi-bar-chart-line text-warning"></i>
              <strong>Ticket médio por canal</strong>
            </div>
            <div class="card-body">
              <BaseChart type="bar" :data="chartTicketData" :options="chartTicketOptions" height="220px" />
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

const CHANNEL_COLORS = {
  'Delivery': '#4f81e0',
  'Retirada': '#4fc97a',
  'Balcão': '#f5a623',
};

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function firstDayOfMonthStr() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

const FMT = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
function fmtCurrency(v) {
  return FMT.format(Number(v || 0));
}

export default {
  name: 'RevenueReport',

  components: { BaseChart },

  data() {
    return {
      filters: { from: firstDayOfMonthStr(), to: todayStr() },
      loading: false,
      loaded: false,
      summary: {
        totalRevenue: 0,
        totalOrders: 0,
        avgTicket: 0,
        avgDelivery: 0,
        avgPickup: 0,
        avgBalcao: 0,
        byChannel: [],
      },
      byDay: null,
    };
  },

  computed: {
    chartByDayData() {
      if (!this.byDay) return { labels: [], datasets: [] }
      const { labels = [], series = {} } = this.byDay
      const displayLabels = labels.map(d => { const [, m, day] = d.split('-'); return `${day}/${m}` })
      return {
        labels: displayLabels,
        datasets: [
          { label: 'Total', data: series.Total || [], borderColor: '#4f81e0', backgroundColor: '#4f81e020', fill: true, tension: 0.3, pointRadius: 3, borderWidth: 2 },
          { label: 'Delivery', data: series.Delivery || [], borderColor: '#e04f4f', backgroundColor: 'transparent', tension: 0.3, pointRadius: 2, borderDash: [5, 3], borderWidth: 1.5 },
          { label: 'Retirada', data: series.Retirada || [], borderColor: '#4fc97a', backgroundColor: 'transparent', tension: 0.3, pointRadius: 2, borderDash: [5, 3], borderWidth: 1.5 },
          { label: 'Balcão', data: series['Balcão'] || [], borderColor: '#f5a623', backgroundColor: 'transparent', tension: 0.3, pointRadius: 2, borderDash: [5, 3], borderWidth: 1.5 },
        ],
      }
    },
    chartByDayOptions() {
      const fmt = this.fmtCurrency || ((v) => v)
      return {
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'top' },
          tooltip: { callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${fmt(ctx.raw)}` } },
        },
        scales: {
          y: { beginAtZero: true, ticks: { callback: (v) => fmt(v) }, grid: { color: '#f0f0f0' } },
          x: { grid: { color: '#f0f0f0' }, ticks: { maxTicksLimit: 15 } },
        },
      }
    },
    chartChannelData() {
      const CHANNEL_COLORS = { Delivery: '#4f81e0', Retirada: '#4fc97a', 'Balcão': '#f5a623' }
      const byChannel = this.summary?.byChannel || []
      const labels = byChannel.map(c => c.name)
      const data = byChannel.map(c => Number(c.totalRevenue))
      const colors = labels.map(l => CHANNEL_COLORS[l] || '#aaa')
      return { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 2, hoverOffset: 6 }] }
    },
    chartChannelOptions() {
      const fmt = this.fmtCurrency || ((v) => v)
      const total = (this.summary?.byChannel || []).reduce((s, c) => s + Number(c.totalRevenue), 0)
      return {
        plugins: {
          legend: { position: 'bottom' },
          tooltip: { callbacks: { label: (ctx) => ` ${ctx.label}: ${fmt(ctx.raw)} (${total ? ((ctx.raw / total) * 100).toFixed(1) : 0}%)` } },
        },
      }
    },
    chartTicketData() {
      const CHANNEL_COLORS = { Delivery: '#4f81e0', Retirada: '#4fc97a', 'Balcão': '#f5a623' }
      const byChannel = this.summary?.byChannel || []
      const labels = byChannel.map(c => c.name)
      const data = byChannel.map(c => Number(Number(c.avgTicket).toFixed(2)))
      const colors = labels.map(l => CHANNEL_COLORS[l] || '#aaa')
      return { labels, datasets: [{ label: 'Ticket médio', data, backgroundColor: colors, borderRadius: 6, borderWidth: 0 }] }
    },
    chartTicketOptions() {
      const fmt = this.fmtCurrency || ((v) => v)
      return {
        indexAxis: 'y',
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (ctx) => ` ${fmt(ctx.raw)}` } },
        },
        scales: { x: { beginAtZero: true, ticks: { callback: (v) => fmt(v) }, grid: { color: '#f0f0f0' } } },
      }
    },
  },

  methods: {
    fmtCurrency,

    channelColor(name) {
      return CHANNEL_COLORS[name] || '#607d8b';
    },

    pct(val) {
      if (!this.summary.totalRevenue) return 0;
      return (Number(val) / Number(this.summary.totalRevenue)) * 100;
    },

    async load() {
      this.loading = true;
      this.loaded = false;
      const params = { dateFrom: this.filters.from, dateTo: this.filters.to };
      try {
        const [r1, r2] = await Promise.all([
          api.get('/reports/revenue/summary', { params }),
          api.get('/reports/revenue/by-day', { params }),
        ]);
        this.summary = r1.data || {};
        this.byDay = r2.data || null;
        this.loaded = true;
      } catch (e) {
        console.error('RevenueReport load error:', e);
        alert('Erro ao carregar dados do relatório.');
      } finally {
        this.loading = false;
      }
    },
  },
};
</script>
