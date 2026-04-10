<template>
  <div class="container py-3">
    <h3 class="mb-3">Financeiro</h3>

    <!-- Store filter -->
    <div class="mb-3" v-if="stores.length > 1">
      <select class="form-select form-select-sm w-auto" v-model="selectedStoreId" @change="loadAll">
        <option value="">Todas as lojas</option>
        <option v-for="s in stores" :key="s.id" :value="s.id">{{ s.name }}</option>
      </select>
    </div>

    <!-- Saúde Financeira -->
    <div class="card border-warning mb-4" v-if="health">
      <div class="card-header bg-warning bg-opacity-10">
        <h6 class="mb-0">Saúde Financeira</h6>
      </div>
      <div class="card-body">
        <div class="d-flex justify-content-between mb-2">
          <span>Pedidos sem registro financeiro</span>
          <span :class="health.orphanOrders > 0 ? 'text-danger fw-bold' : 'text-success'">
            {{ health.orphanOrders }}
          </span>
        </div>
        <div class="d-flex justify-content-between mb-2">
          <span>Pedidos fora de caixa</span>
          <span :class="health.outOfSessionOrders > 0 ? 'text-warning fw-bold' : 'text-success'">
            {{ health.outOfSessionOrders }}
          </span>
        </div>
        <div class="d-flex justify-content-between mb-2">
          <span>Falhas de bridge pendentes</span>
          <span :class="health.pendingBridgeFailures > 0 ? 'text-danger fw-bold' : 'text-success'">
            {{ health.pendingBridgeFailures }}
          </span>
        </div>
        <div class="d-flex justify-content-between mb-2 text-muted">
          <span>Último registro financeiro</span>
          <span>{{ health.lastSuccessfulBridge ? formatDate(health.lastSuccessfulBridge) : 'N/A' }}</span>
        </div>
        <button v-if="health.orphanOrders > 0 || health.pendingBridgeFailures > 0"
                class="btn btn-sm btn-outline-warning mt-2"
                :disabled="reconciling"
                @click="runReconciliation">
          {{ reconciling ? 'Executando...' : 'Executar Reconciliação' }}
        </button>
      </div>
    </div>

    <!-- Cards de resumo -->
    <div class="stat-grid mb-4">
      <div class="stat-card">
        <div class="stat-icon stat-icon--success"><i class="bi bi-arrow-down-circle"></i></div>
        <div class="stat-body">
          <div class="stat-label">A Receber (mês)</div>
          <div class="stat-value text-success">{{ formatCurrency(summary.receivables?.total || 0) }}</div>
          <div class="stat-sub">{{ summary.receivables?.count || 0 }} títulos</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon stat-icon--danger"><i class="bi bi-arrow-up-circle"></i></div>
        <div class="stat-body">
          <div class="stat-label">A Pagar (mês)</div>
          <div class="stat-value text-danger">{{ formatCurrency(summary.payables?.total || 0) }}</div>
          <div class="stat-sub">{{ summary.payables?.count || 0 }} títulos</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon stat-icon--warning"><i class="bi bi-exclamation-triangle"></i></div>
        <div class="stat-body">
          <div class="stat-label">Vencidos</div>
          <div class="stat-value text-warning">{{ formatCurrency(summary.overdue?.total || 0) }}</div>
          <div class="stat-sub">{{ summary.overdue?.count || 0 }} títulos</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon stat-icon--primary"><i class="bi bi-wallet2"></i></div>
        <div class="stat-body">
          <div class="stat-label">Saldo Total</div>
          <div class="stat-value">{{ formatCurrency(summary.totalBalance || 0) }}</div>
          <div class="stat-sub">todas as contas</div>
        </div>
      </div>
    </div>

    <!-- Atalhos rápidos -->
    <div class="row g-3 mb-4">
      <div class="col-md-4">
        <div class="card h-100">
          <div class="card-body">
            <h6 class="card-title">Contas a Pagar / Receber</h6>
            <p class="card-text text-muted small">Gerenciar títulos financeiros, registrar pagamentos e recebimentos.</p>
            <router-link to="/financial/transactions" class="btn btn-sm btn-outline-primary">Acessar</router-link>
          </div>
        </div>
      </div>
      <div class="col-md-4">
        <div class="card h-100">
          <div class="card-body">
            <h6 class="card-title">Fluxo de Caixa</h6>
            <p class="card-text text-muted small">Visualizar entradas e saídas realizadas vs. previstas.</p>
            <router-link to="/financial/cash-flow" class="btn btn-sm btn-outline-primary">Acessar</router-link>
          </div>
        </div>
      </div>
      <div class="col-md-4">
        <div class="card h-100">
          <div class="card-body">
            <h6 class="card-title">DRE</h6>
            <p class="card-text text-muted small">Demonstrativo de Resultado do Exercício por período.</p>
            <router-link to="/financial/dre" class="btn btn-sm btn-outline-primary">Acessar</router-link>
          </div>
        </div>
      </div>
    </div>

    <div class="row g-3">
      <div class="col-md-4">
        <div class="card h-100">
          <div class="card-body">
            <h6 class="card-title">Contas Bancárias</h6>
            <p class="card-text text-muted small">Gerenciar contas, caixas e wallets de marketplace.</p>
            <router-link to="/financial/accounts" class="btn btn-sm btn-outline-secondary">Gerenciar</router-link>
          </div>
        </div>
      </div>
      <div class="col-md-4">
        <div class="card h-100">
          <div class="card-body">
            <h6 class="card-title">Taxas e Operadoras</h6>
            <p class="card-text text-muted small">Configurar taxas de iFood, Rappi, Stone, Cielo, etc.</p>
            <router-link to="/financial/gateways" class="btn btn-sm btn-outline-secondary">Configurar</router-link>
          </div>
        </div>
      </div>
      <div class="col-md-4">
        <div class="card h-100">
          <div class="card-body">
            <h6 class="card-title">Conciliação OFX</h6>
            <p class="card-text text-muted small">Importar extratos bancários e conciliar automaticamente.</p>
            <router-link to="/financial/ofx" class="btn btn-sm btn-outline-secondary">Importar</router-link>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import api from '../../api';

export default {
  name: 'FinancialDashboard',
  data() {
    return {
      summary: {},
      health: null,
      stores: [],
      selectedStoreId: '',
      loading: false,
      reconciling: false,
    };
  },
  async mounted() {
    await this.loadStores();
    await this.loadAll();
  },
  methods: {
    async loadStores() {
      try {
        const { data } = await api.get('/stores');
        this.stores = data || [];
      } catch (e) {
        console.warn('Failed to load stores:', e);
      }
    },
    async loadAll() {
      await Promise.all([this.loadSummary(), this.loadHealth()]);
    },
    async loadSummary() {
      this.loading = true;
      try {
        const params = {};
        if (this.selectedStoreId) params.storeId = this.selectedStoreId;
        const { data } = await api.get('/financial/reports/summary', { params });
        this.summary = data;
      } catch (e) {
        console.error('Failed to load financial summary:', e);
      } finally {
        this.loading = false;
      }
    },
    async loadHealth() {
      try {
        const { data } = await api.get('/financial/health');
        this.health = data;
      } catch (e) {
        console.error('Failed to load financial health:', e);
      }
    },
    async runReconciliation() {
      this.reconciling = true;
      try {
        await api.post('/financial/reconciliation/run');
        await this.loadHealth();
      } catch (e) {
        console.error('Reconciliation failed:', e);
      } finally {
        this.reconciling = false;
      }
    },
    formatCurrency(value) {
      return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value || 0);
    },
    formatDate(dateStr) {
      if (!dateStr) return 'N/A';
      return new Date(dateStr).toLocaleString('pt-BR');
    },
  },
};
</script>
