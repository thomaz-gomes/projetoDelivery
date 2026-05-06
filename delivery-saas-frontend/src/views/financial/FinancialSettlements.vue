<template>
  <div class="container py-3">
    <div class="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
      <h3 class="mb-0">Repasses Marketplace</h3>
      <div class="d-flex gap-2 flex-wrap">
        <select class="form-select form-select-sm" v-model="filters.gatewayConfigId" @change="load" style="min-width:180px">
          <option value="">Todas operadoras</option>
          <option v-for="gw in gateways" :key="gw.id" :value="gw.id">
            {{ gw.provider }}{{ gw.label ? ` (${gw.label})` : '' }}
          </option>
        </select>
        <input type="date" class="form-control form-control-sm" v-model="filters.from" @change="load" />
        <input type="date" class="form-control form-control-sm" v-model="filters.to" @change="load" />
        <button class="btn btn-sm btn-outline-primary" @click="load" :disabled="loading">
          <span v-if="loading" class="spinner-border spinner-border-sm me-1"></span>
          Atualizar
        </button>
      </div>
    </div>

    <div class="card">
      <div class="table-responsive">
        <table class="table table-hover mb-0 align-middle">
          <thead class="table-light">
            <tr>
              <th>Data prevista</th>
              <th>Operadora</th>
              <th class="text-center">Vendas</th>
              <th class="text-end">A receber</th>
              <th class="text-end">Antecipação</th>
              <th class="text-end">Líquido esperado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!groups.length">
              <td colspan="7" class="text-center py-4 text-muted">Nenhum repasse pendente no período.</td>
            </tr>
            <tr v-for="g in groups" :key="g.gatewayConfigId + '|' + g.expectedDate" :class="badgeClass(g.expectedDate)">
              <td>
                <strong>{{ formatDate(g.expectedDate) }}</strong>
                <div class="small text-muted">{{ relativeDate(g.expectedDate) }}</div>
              </td>
              <td>
                <span class="badge bg-secondary">{{ g.gatewayProvider }}</span>
                <small v-if="g.gatewayLabel" class="text-muted ms-1">{{ g.gatewayLabel }}</small>
              </td>
              <td class="text-center">{{ g.receivableCount }}</td>
              <td class="text-end text-success fw-semibold">{{ fmt(g.totalReceivable) }}</td>
              <td class="text-end text-danger">
                <span v-if="g.totalAnticipation > 0">-{{ fmt(g.totalAnticipation) }}</span>
                <span v-else class="text-muted">—</span>
              </td>
              <td class="text-end fw-bold">{{ fmt(g.expectedNet) }}</td>
              <td class="text-end">
                <button class="btn btn-sm btn-success" @click="openReconcile(g)">
                  <i class="bi bi-bank me-1"></i>Conciliar
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Modal conciliar -->
    <div v-if="reconciling" class="modal d-block" tabindex="-1" style="background: rgba(0,0,0,0.5)">
      <div class="modal-dialog">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">Conciliar repasse — {{ formatDate(reconciling.expectedDate) }}</h5>
            <button type="button" class="btn-close" @click="reconciling = null"></button>
          </div>
          <div class="modal-body">
            <div class="alert alert-light small">
              <div><strong>Operadora:</strong> {{ reconciling.gatewayProvider }}{{ reconciling.gatewayLabel ? ` (${reconciling.gatewayLabel})` : '' }}</div>
              <div><strong>Vendas:</strong> {{ reconciling.receivableCount }}</div>
              <div><strong>A receber (bruto):</strong> {{ fmt(reconciling.totalReceivable) }}</div>
              <div v-if="reconciling.totalAnticipation > 0"><strong>Antecipação:</strong> -{{ fmt(reconciling.totalAnticipation) }}</div>
              <div class="fw-bold"><strong>Líquido esperado:</strong> {{ fmt(reconciling.expectedNet) }}</div>
            </div>

            <div class="mb-2">
              <label class="form-label small">Conta bancária que recebeu *</label>
              <select class="form-select form-select-sm" v-model="recForm.accountId">
                <option value="">Selecionar...</option>
                <option v-for="a in accounts" :key="a.id" :value="a.id">{{ a.name }}</option>
              </select>
            </div>
            <div class="mb-2">
              <label class="form-label small">Valor recebido (R$) *</label>
              <input type="number" class="form-control form-control-sm" v-model.number="recForm.actualAmount" step="0.01" />
              <small v-if="diffAlert" class="text-danger">
                Diferença de {{ fmt(diffAlert) }} em relação ao esperado — será registrada como ajuste.
              </small>
            </div>
            <div class="mb-2">
              <label class="form-label small">Data do repasse</label>
              <input type="date" class="form-control form-control-sm" v-model="recForm.paidAt" />
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-outline-secondary" @click="reconciling = null">Cancelar</button>
            <button class="btn btn-success" :disabled="!canSubmit || submitting" @click="submitReconcile">
              <span v-if="submitting" class="spinner-border spinner-border-sm me-1"></span>
              Confirmar Conciliação
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import api from '../../api';

export default {
  name: 'FinancialSettlements',
  data() {
    return {
      gateways: [],
      accounts: [],
      groups: [],
      loading: false,
      filters: { gatewayConfigId: '', from: this.todayStr(-7), to: this.todayStr(60) },
      reconciling: null,
      submitting: false,
      recForm: { accountId: '', actualAmount: 0, paidAt: '' },
    };
  },
  computed: {
    diffAlert() {
      if (!this.reconciling) return null;
      const d = Math.round((Number(this.recForm.actualAmount || 0) - Number(this.reconciling.expectedNet)) * 100) / 100;
      return Math.abs(d) >= 0.01 ? d : null;
    },
    canSubmit() {
      return this.recForm.accountId && Number(this.recForm.actualAmount) > 0;
    },
  },
  async mounted() {
    await Promise.all([this.loadGateways(), this.loadAccounts()]);
    await this.load();
  },
  methods: {
    todayStr(deltaDays = 0) {
      const d = new Date();
      d.setDate(d.getDate() + deltaDays);
      return d.toISOString().slice(0, 10);
    },
    async loadGateways() {
      try {
        const { data } = await api.get('/financial/gateways');
        this.gateways = data.filter((g) => g.isActive);
      } catch (e) { console.warn('Falha ao carregar gateways', e); }
    },
    async loadAccounts() {
      try {
        const { data } = await api.get('/financial/accounts');
        this.accounts = (data || []).filter((a) => a.isActive);
      } catch (e) { console.warn('Falha ao carregar contas', e); }
    },
    async load() {
      this.loading = true;
      try {
        const params = {};
        if (this.filters.gatewayConfigId) params.gatewayConfigId = this.filters.gatewayConfigId;
        if (this.filters.from) params.from = this.filters.from;
        if (this.filters.to) params.to = this.filters.to;
        const { data } = await api.get('/financial/settlements/pending', { params });
        this.groups = data;
      } catch (e) {
        alert(e.response?.data?.message || 'Erro ao carregar repasses');
      } finally {
        this.loading = false;
      }
    },
    openReconcile(g) {
      this.reconciling = g;
      this.recForm = {
        accountId: this.accounts[0]?.id || '',
        actualAmount: g.expectedNet,
        paidAt: g.expectedDate,
      };
    },
    async submitReconcile() {
      if (!this.canSubmit) return;
      this.submitting = true;
      try {
        const body = {
          expectedDate: this.reconciling.expectedDate,
          gatewayConfigId: this.reconciling.gatewayConfigId,
          actualAmount: Number(this.recForm.actualAmount),
          accountId: this.recForm.accountId,
          paidAt: this.recForm.paidAt,
        };
        const { data } = await api.post('/financial/settlements/reconcile', body);
        let msg = `${data.receivablesSettled} venda(s) marcada(s) como pagas.`;
        if (data.difference) msg += `\nAjuste de ${this.fmt(Math.abs(data.difference))} criado.`;
        alert(msg);
        this.reconciling = null;
        await this.load();
      } catch (e) {
        alert(e.response?.data?.message || 'Erro ao conciliar repasse');
      } finally {
        this.submitting = false;
      }
    },
    fmt(v) {
      return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v) || 0);
    },
    formatDate(s) {
      if (!s) return '—';
      const [y, m, d] = String(s).slice(0, 10).split('-');
      return `${d}/${m}/${y}`;
    },
    relativeDate(s) {
      if (!s) return '';
      const target = new Date(`${s}T12:00:00`);
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const diff = Math.round((target - today) / (1000 * 60 * 60 * 24));
      if (diff === 0) return 'Hoje';
      if (diff < 0) return `Há ${-diff} dia(s) (atrasado)`;
      if (diff === 1) return 'Amanhã';
      return `Em ${diff} dia(s)`;
    },
    badgeClass(date) {
      const target = new Date(`${date}T12:00:00`);
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const diff = (target - today) / (1000 * 60 * 60 * 24);
      if (diff < 0) return 'table-danger';
      if (diff <= 1) return 'table-warning';
      return '';
    },
  },
};
</script>
