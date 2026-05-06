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
      <div class="stat-card stat-card--clickable" v-if="nextSettlement" @click="openSettlementHistory">
        <div class="stat-icon stat-icon--info"><i class="bi bi-bank"></i></div>
        <div class="stat-body">
          <div class="stat-label">Próximo Repasse {{ nextSettlement.gatewayProvider || 'iFood' }}</div>
          <div class="stat-value text-info">{{ formatCurrency(nextSettlement.expectedNet) }}</div>
          <div class="stat-sub">
            {{ formatDate(nextSettlement.expectedDate) }} · {{ nextSettlement.receivableCount }} venda(s)
            <span class="text-primary ms-1"><i class="bi bi-clock-history"></i> ver histórico</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Modal: histórico de repasses -->
    <div v-if="showHistoryModal" class="modal d-block" tabindex="-1" style="background: rgba(0,0,0,0.5)" @click.self="showHistoryModal = false">
      <div class="modal-dialog modal-lg">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">
              <i class="bi bi-bank me-1"></i>Histórico de Repasses {{ historyFilter.provider || 'iFood' }}
            </h5>
            <button type="button" class="btn-close" @click="showHistoryModal = false"></button>
          </div>
          <div class="modal-body">
            <div class="row g-2 mb-3">
              <div class="col-md-4">
                <label class="form-label small">De</label>
                <input type="date" class="form-control form-control-sm" v-model="historyFilter.from" @change="loadSettlementHistory" />
              </div>
              <div class="col-md-4">
                <label class="form-label small">Até</label>
                <input type="date" class="form-control form-control-sm" v-model="historyFilter.to" @change="loadSettlementHistory" />
              </div>
              <div class="col-md-4 d-flex align-items-end gap-1">
                <button class="btn btn-sm btn-outline-secondary" @click="setHistoryRange(30)">Últimos 30d</button>
                <button class="btn btn-sm btn-outline-secondary" @click="setHistoryRange(90)">90d</button>
              </div>
            </div>

            <div v-if="loadingHistory" class="text-center py-4">
              <div class="spinner-border spinner-border-sm"></div>
            </div>
            <div v-else-if="!settlementHistory.length" class="text-center text-muted py-4">
              Nenhum repasse no período selecionado.
            </div>
            <div v-else>
              <div class="d-flex justify-content-between align-items-center mb-2 small text-muted">
                <span>{{ settlementHistory.length }} repasse(s)</span>
                <span>Total recebido: <strong class="text-success">{{ formatCurrency(historyTotal) }}</strong></span>
              </div>
              <div class="table-responsive">
                <table class="table table-sm table-hover mb-0 align-middle">
                  <thead class="table-light">
                    <tr>
                      <th>Data do crédito</th>
                      <th class="text-center">Vendas</th>
                      <th class="text-end">A receber</th>
                      <th class="text-end">Antecipação</th>
                      <th class="text-end">Líquido recebido</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="g in settlementHistory" :key="g.gatewayConfigId + '|' + g.paidAt">
                      <td>{{ formatDate(g.paidAt) }}</td>
                      <td class="text-center">{{ g.receivableCount }}</td>
                      <td class="text-end text-success">{{ formatCurrency(g.totalReceivable) }}</td>
                      <td class="text-end text-danger">
                        <span v-if="g.totalAnticipation > 0">-{{ formatCurrency(g.totalAnticipation) }}</span>
                        <span v-else class="text-muted">—</span>
                      </td>
                      <td class="text-end fw-bold">{{ formatCurrency(g.actualNet) }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          <div class="modal-footer">
            <router-link to="/financial/settlements" class="btn btn-sm btn-outline-primary me-auto">
              <i class="bi bi-bank me-1"></i>Ver repasses pendentes
            </router-link>
            <button class="btn btn-secondary" @click="showHistoryModal = false">Fechar</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Faturas de Cartão -->
    <div v-if="invoiceSummaries.length" class="mt-4 mb-4">
      <h5>Faturas de Cartão</h5>
      <div class="row g-3">
        <div v-for="inv in invoiceSummaries" :key="inv.card.id" class="col-md-6">
          <div class="card" :class="inv.parcelasCount > 0 ? 'border-primary' : 'border-light'">
            <div class="card-body">
              <div class="d-flex justify-content-between align-items-center">
                <div>
                  <h6 class="mb-0">{{ inv.card.name }}{{ inv.card.lastDigits ? ` (final ${inv.card.lastDigits})` : '' }}</h6>
                  <small class="text-muted">Fatura {{ inv.month }} · vence dia {{ inv.card.dueDay }}</small>
                </div>
                <div class="text-end">
                  <div class="fs-5 fw-bold">{{ formatCurrency(inv.total) }}</div>
                  <small class="text-muted">{{ inv.parcelasCount }} parcela{{ inv.parcelasCount !== 1 ? 's' : '' }}</small>
                </div>
              </div>
              <div class="mt-2 d-flex gap-2" v-if="inv.parcelasCount > 0">
                <button class="btn btn-sm btn-outline-primary" @click="showInvoiceDetail(inv)">Ver detalhes</button>
                <button class="btn btn-sm btn-success" @click="payInvoice(inv)">Pagar fatura</button>
              </div>
            </div>
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
      health: null,
      stores: [],
      selectedStoreId: '',
      loading: false,
      reconciling: false,
      invoiceSummaries: [],
      // Marketplace settlements (next + history)
      pendingSettlements: [],
      showHistoryModal: false,
      loadingHistory: false,
      settlementHistory: [],
      historyFilter: { provider: 'IFOOD', from: '', to: '' },
    };
  },
  computed: {
    nextSettlement() {
      // First upcoming pending iFood settlement (sorted by date)
      const ifood = this.pendingSettlements.filter(g => g.gatewayProvider === 'IFOOD');
      return ifood[0] || this.pendingSettlements[0] || null;
    },
    historyTotal() {
      return this.settlementHistory.reduce((sum, g) => sum + Number(g.actualNet || 0), 0);
    },
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
      await Promise.all([this.loadSummary(), this.loadHealth(), this.loadInvoices(), this.loadPendingSettlements()]);
    },
    async loadPendingSettlements() {
      try {
        const today = new Date();
        const future = new Date(); future.setDate(future.getDate() + 90);
        const params = {
          from: today.toISOString().slice(0, 10),
          to: future.toISOString().slice(0, 10),
        };
        const { data } = await api.get('/financial/settlements/pending', { params });
        this.pendingSettlements = data || [];
      } catch (e) {
        console.warn('Failed to load pending settlements:', e);
        this.pendingSettlements = [];
      }
    },
    openSettlementHistory() {
      this.setHistoryRange(30);
      this.showHistoryModal = true;
      this.loadSettlementHistory();
    },
    setHistoryRange(days) {
      const to = new Date();
      const from = new Date(); from.setDate(from.getDate() - days);
      this.historyFilter.from = from.toISOString().slice(0, 10);
      this.historyFilter.to = to.toISOString().slice(0, 10);
      if (this.showHistoryModal) this.loadSettlementHistory();
    },
    async loadSettlementHistory() {
      this.loadingHistory = true;
      try {
        const params = {
          provider: this.historyFilter.provider || undefined,
          from: this.historyFilter.from || undefined,
          to: this.historyFilter.to || undefined,
        };
        const { data } = await api.get('/financial/settlements/history', { params });
        this.settlementHistory = data || [];
      } catch (e) {
        console.error('Failed to load settlement history:', e);
        this.settlementHistory = [];
      } finally {
        this.loadingHistory = false;
      }
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
    async loadInvoices() {
      try {
        const { data } = await api.get('/financial/invoices/summary');
        this.invoiceSummaries = data;
      } catch (e) {
        console.error(e);
      }
    },
    async payInvoice(inv) {
      if (!confirm(`Pagar fatura ${inv.card.name} de ${this.formatCurrency(inv.total)} (${inv.parcelasCount} parcelas)?`)) return;
      try {
        await api.post('/financial/invoices/pay', {
          payablePaymentMethodId: inv.card.id,
          month: inv.month,
          accountId: inv.card.accountId,
        });
        alert('Fatura paga com sucesso!');
        await this.loadInvoices();
        if (this.loadAll) await this.loadAll();
      } catch (e) {
        alert(e.response?.data?.message || 'Erro ao pagar fatura');
      }
    },
    showInvoiceDetail(inv) {
      const lines = inv.parcelas.map(p =>
        `${p.description} — ${this.formatCurrency(p.grossAmount)} — ${this.formatDate(p.dueDate)}`
      ).join('\n');
      alert(`Fatura ${inv.card.name} - ${inv.month}\n\n${lines}\n\nTotal: ${this.formatCurrency(inv.total)}`);
    },
    formatCurrency(value) {
      return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value || 0);
    },
    formatDate(dateStr) {
      if (!dateStr) return 'N/A';
      // YYYY-MM-DD → DD/MM/YYYY (avoids timezone shift); else uses full locale string
      const s = String(dateStr);
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
        const [y, m, d] = s.split('-');
        return `${d}/${m}/${y}`;
      }
      return new Date(dateStr).toLocaleString('pt-BR');
    },
  },
};
</script>

<style scoped>
:deep(.stat-card--clickable) {
  cursor: pointer;
  transition: transform 0.1s, box-shadow 0.1s;
}
:deep(.stat-card--clickable:hover) {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(13, 110, 253, 0.15);
}
:deep(.stat-icon--info) {
  background: rgba(13, 202, 240, 0.12);
  color: #0dcaf0;
}
</style>
