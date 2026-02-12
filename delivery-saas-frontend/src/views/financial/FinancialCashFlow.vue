<template>
  <div class="container py-3">
    <h3 class="mb-3">Fluxo de Caixa</h3>

    <!-- Filtros -->
    <div class="card mb-3">
      <div class="card-body">
        <div class="row g-2 align-items-end">
          <div class="col-md-3">
            <label class="form-label">Data início</label>
            <input type="date" class="form-control" v-model="filters.dateFrom">
          </div>
          <div class="col-md-3">
            <label class="form-label">Data fim</label>
            <input type="date" class="form-control" v-model="filters.dateTo">
          </div>
          <div class="col-md-2">
            <label class="form-label">Conta</label>
            <SelectInput v-model="filters.accountId" :options="accountOptions" optionValueKey="id" optionLabelKey="name" placeholder="Todas" />
          </div>
          <div class="col-md-2">
            <label class="form-label">Visão</label>
            <SelectInput v-model="filters.view" :options="viewOptions" />
          </div>
          <div class="col-md-2 text-end">
            <button class="btn btn-primary" @click="load">Atualizar</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Cards de totais -->
    <div class="row g-3 mb-4" v-if="data">
      <div class="col-md-3">
        <div class="card border-primary">
          <div class="card-body text-center">
            <div class="text-muted small">Saldo Total</div>
            <div class="fs-5 fw-bold text-primary">{{ formatCurrency(data.totalBalance) }}</div>
          </div>
        </div>
      </div>
      <div class="col-md-3">
        <div class="card border-success">
          <div class="card-body text-center">
            <div class="text-muted small">Entradas (Realizado)</div>
            <div class="fs-5 fw-bold text-success">{{ formatCurrency(data.realized?.totals?.inflow) }}</div>
          </div>
        </div>
      </div>
      <div class="col-md-3">
        <div class="card border-danger">
          <div class="card-body text-center">
            <div class="text-muted small">Saídas (Realizado)</div>
            <div class="fs-5 fw-bold text-danger">{{ formatCurrency(data.realized?.totals?.outflow) }}</div>
          </div>
        </div>
      </div>
      <div class="col-md-3">
        <div class="card border-info">
          <div class="card-body text-center">
            <div class="text-muted small">Previsto (Líquido)</div>
            <div class="fs-5 fw-bold text-info">{{ formatCurrency(data.forecast?.totals?.net) }}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Tabela Realizado vs Previsto por período -->
    <div class="row g-3" v-if="data">
      <div class="col-md-6">
        <div class="card">
          <div class="card-header"><strong>Realizado</strong></div>
          <div class="table-responsive">
            <table class="table table-sm mb-0">
              <thead class="table-light">
                <tr><th>Período</th><th class="text-success">Entradas</th><th class="text-danger">Saídas</th><th>Saldo</th></tr>
              </thead>
              <tbody>
                <tr v-for="row in (data.realized?.byDate || [])" :key="row.date">
                  <td>{{ row.date }}</td>
                  <td class="text-success">{{ formatCurrency(row.inflow) }}</td>
                  <td class="text-danger">{{ formatCurrency(row.outflow) }}</td>
                  <td :class="row.net >= 0 ? 'text-success' : 'text-danger'">{{ formatCurrency(row.net) }}</td>
                </tr>
                <tr v-if="!data.realized?.byDate?.length">
                  <td colspan="4" class="text-center text-muted py-3">Sem movimentações no período.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <div class="col-md-6">
        <div class="card">
          <div class="card-header"><strong>Previsto</strong> <span class="text-muted small">(títulos pendentes)</span></div>
          <div class="table-responsive">
            <table class="table table-sm mb-0">
              <thead class="table-light">
                <tr><th>Período</th><th class="text-success">A Receber</th><th class="text-danger">A Pagar</th><th>Saldo</th></tr>
              </thead>
              <tbody>
                <tr v-for="row in (data.forecast?.byDate || [])" :key="row.date">
                  <td>{{ row.date }}</td>
                  <td class="text-success">{{ formatCurrency(row.inflow) }}</td>
                  <td class="text-danger">{{ formatCurrency(row.outflow) }}</td>
                  <td :class="row.net >= 0 ? 'text-success' : 'text-danger'">{{ formatCurrency(row.net) }}</td>
                </tr>
                <tr v-if="!data.forecast?.byDate?.length">
                  <td colspan="4" class="text-center text-muted py-3">Sem títulos pendentes no período.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>

    <!-- Contas -->
    <div class="card mt-4" v-if="data && data.accounts">
      <div class="card-header"><strong>Saldos por Conta</strong></div>
      <div class="table-responsive">
        <table class="table table-sm mb-0">
          <thead class="table-light">
            <tr><th>Conta</th><th>Tipo</th><th>Saldo Atual</th></tr>
          </thead>
          <tbody>
            <tr v-for="acc in data.accounts" :key="acc.id">
              <td>{{ acc.name }}</td>
              <td>{{ acc.type }}</td>
              <td :class="Number(acc.currentBalance) >= 0 ? 'text-success fw-bold' : 'text-danger fw-bold'">{{ formatCurrency(acc.currentBalance) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<script>
import api from '../../api';
import SelectInput from '../../components/form/select/SelectInput.vue';

export default {
  name: 'FinancialCashFlow',
  components: { SelectInput },
  data() {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];
    return {
      data: null,
      accounts: [],
      filters: { dateFrom: startOfMonth, dateTo: endOfMonth, accountId: '', view: 'daily' },
      viewOptions: [
        { value: 'daily', label: 'Diário' },
        { value: 'weekly', label: 'Semanal' },
        { value: 'monthly', label: 'Mensal' },
      ],
    };
  },
  computed: {
    accountOptions() { return this.accounts; },
  },
  async mounted() {
    try {
      const { data } = await api.get('/financial/accounts');
      this.accounts = data;
    } catch (e) { /* ignore */ }
    await this.load();
  },
  methods: {
    async load() {
      try {
        const params = {};
        if (this.filters.dateFrom) params.dateFrom = this.filters.dateFrom;
        if (this.filters.dateTo) params.dateTo = this.filters.dateTo;
        if (this.filters.accountId) params.accountId = this.filters.accountId;
        if (this.filters.view) params.view = this.filters.view;
        const { data } = await api.get('/financial/cash-flow', { params });
        this.data = data;
      } catch (e) {
        console.error('Failed to load cash flow:', e);
      }
    },
    formatCurrency(value) {
      return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value || 0);
    },
  },
};
</script>
