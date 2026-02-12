<template>
  <div class="container py-3">
    <h3 class="mb-3">Financeiro</h3>

    <!-- Cards de resumo -->
    <div class="row g-3 mb-4">
      <div class="col-md-3">
        <div class="card border-success">
          <div class="card-body text-center">
            <div class="text-muted small">A Receber (mês)</div>
            <div class="fs-4 fw-bold text-success">{{ formatCurrency(summary.receivables?.total || 0) }}</div>
            <div class="text-muted small">{{ summary.receivables?.count || 0 }} títulos</div>
          </div>
        </div>
      </div>
      <div class="col-md-3">
        <div class="card border-danger">
          <div class="card-body text-center">
            <div class="text-muted small">A Pagar (mês)</div>
            <div class="fs-4 fw-bold text-danger">{{ formatCurrency(summary.payables?.total || 0) }}</div>
            <div class="text-muted small">{{ summary.payables?.count || 0 }} títulos</div>
          </div>
        </div>
      </div>
      <div class="col-md-3">
        <div class="card border-warning">
          <div class="card-body text-center">
            <div class="text-muted small">Vencidos</div>
            <div class="fs-4 fw-bold text-warning">{{ formatCurrency(summary.overdue?.total || 0) }}</div>
            <div class="text-muted small">{{ summary.overdue?.count || 0 }} títulos</div>
          </div>
        </div>
      </div>
      <div class="col-md-3">
        <div class="card border-primary">
          <div class="card-body text-center">
            <div class="text-muted small">Saldo Total</div>
            <div class="fs-4 fw-bold text-primary">{{ formatCurrency(summary.totalBalance || 0) }}</div>
            <div class="text-muted small">todas as contas</div>
          </div>
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
      loading: false,
    };
  },
  async mounted() {
    await this.loadSummary();
  },
  methods: {
    async loadSummary() {
      this.loading = true;
      try {
        const { data } = await api.get('/financial/reports/summary');
        this.summary = data;
      } catch (e) {
        console.error('Failed to load financial summary:', e);
      } finally {
        this.loading = false;
      }
    },
    formatCurrency(value) {
      return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value || 0);
    },
  },
};
</script>
