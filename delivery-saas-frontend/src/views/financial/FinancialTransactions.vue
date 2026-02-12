<template>
  <div class="container py-3">
    <div class="d-flex justify-content-between align-items-center mb-3">
      <h3>Contas a Pagar / Receber</h3>
      <button class="btn btn-primary" @click="showForm = true">Novo Lançamento</button>
    </div>

    <!-- Filtros -->
    <div class="card mb-3">
      <div class="card-body">
        <div class="row g-2 align-items-end">
          <div class="col-md-2">
            <label class="form-label">Tipo</label>
            <SelectInput v-model="filters.type" :options="typeOptions" placeholder="Todos" />
          </div>
          <div class="col-md-2">
            <label class="form-label">Status</label>
            <SelectInput v-model="filters.status" :options="statusOptions" placeholder="Todos" />
          </div>
          <div class="col-md-2">
            <label class="form-label">Vencimento de</label>
            <input type="date" class="form-control" v-model="filters.dueDateFrom">
          </div>
          <div class="col-md-2">
            <label class="form-label">Vencimento até</label>
            <input type="date" class="form-control" v-model="filters.dueDateTo">
          </div>
          <div class="col-md-2">
            <label class="form-label">Origem</label>
            <SelectInput v-model="filters.sourceType" :options="sourceTypeOptions" placeholder="Todas" />
          </div>
          <div class="col-md-2 text-end">
            <button class="btn btn-primary me-1" @click="load">Buscar</button>
            <button class="btn btn-outline-secondary" @click="resetFilters">Limpar</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Tabela -->
    <div class="card">
      <div class="table-responsive">
        <table class="table table-hover mb-0">
          <thead class="table-light">
            <tr>
              <th>Descrição</th>
              <th>Tipo</th>
              <th>Valor Bruto</th>
              <th>Taxas</th>
              <th>Valor Líquido</th>
              <th>Vencimento</th>
              <th>Status</th>
              <th>Origem</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="tx in transactions" :key="tx.id" :class="{'table-warning': tx.status === 'OVERDUE'}">
              <td>
                <div>{{ tx.description }}</div>
                <small class="text-muted" v-if="tx.account">{{ tx.account.name }}</small>
              </td>
              <td>
                <span :class="tx.type === 'RECEIVABLE' ? 'badge bg-success' : 'badge bg-danger'">
                  {{ tx.type === 'RECEIVABLE' ? 'Receber' : 'Pagar' }}
                </span>
              </td>
              <td>{{ formatCurrency(tx.grossAmount) }}</td>
              <td class="text-danger">{{ Number(tx.feeAmount) > 0 ? '-' + formatCurrency(tx.feeAmount) : '-' }}</td>
              <td class="fw-bold">{{ formatCurrency(tx.netAmount) }}</td>
              <td>{{ formatDate(tx.dueDate) }}</td>
              <td><span :class="statusBadge(tx.status)">{{ statusLabel(tx.status) }}</span></td>
              <td><span class="badge bg-light text-dark">{{ tx.sourceType || 'MANUAL' }}</span></td>
              <td class="text-end">
                <div class="btn-group btn-group-sm">
                  <button v-if="tx.status === 'PENDING' || tx.status === 'CONFIRMED'" class="btn btn-outline-success" @click="payTransaction(tx)">
                    {{ tx.type === 'RECEIVABLE' ? 'Receber' : 'Pagar' }}
                  </button>
                  <button v-if="tx.status === 'PENDING'" class="btn btn-outline-danger" @click="cancelTransaction(tx)">Cancelar</button>
                </div>
              </td>
            </tr>
            <tr v-if="transactions.length === 0">
              <td colspan="9" class="text-center py-4 text-muted">Nenhuma transação encontrada.</td>
            </tr>
          </tbody>
        </table>
      </div>
      <!-- Paginação -->
      <div v-if="totalPages > 1" class="d-flex justify-content-between align-items-center p-3 border-top">
        <span class="text-muted">{{ total }} transações</span>
        <nav>
          <ul class="pagination mb-0 pagination-sm">
            <li class="page-item" :class="{disabled: page <= 1}">
              <button class="page-link" @click="page--; load()">Anterior</button>
            </li>
            <li class="page-item active"><span class="page-link">{{ page }}</span></li>
            <li class="page-item" :class="{disabled: page >= totalPages}">
              <button class="page-link" @click="page++; load()">Próxima</button>
            </li>
          </ul>
        </nav>
      </div>
    </div>

    <!-- Modal novo lançamento -->
    <div v-if="showForm" class="modal d-block" tabindex="-1" style="background: rgba(0,0,0,0.5)">
      <div class="modal-dialog modal-lg">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">Novo Lançamento</h5>
            <button type="button" class="btn-close" @click="showForm = false"></button>
          </div>
          <div class="modal-body">
            <div class="row g-3">
              <div class="col-md-6">
                <label class="form-label">Tipo</label>
                <SelectInput v-model="form.type" :options="typeOptions" />
              </div>
              <div class="col-md-6">
                <label class="form-label">Descrição</label>
                <TextInput v-model="form.description" placeholder="Ex: Compra de insumos" />
              </div>
              <div class="col-md-4">
                <label class="form-label">Valor Bruto (R$)</label>
                <input type="number" class="form-control" v-model.number="form.grossAmount" step="0.01" min="0">
              </div>
              <div class="col-md-4">
                <label class="form-label">Vencimento</label>
                <input type="date" class="form-control" v-model="form.dueDate">
              </div>
              <div class="col-md-4">
                <label class="form-label">Conta</label>
                <SelectInput v-model="form.accountId" :options="accountOptions" optionValueKey="id" optionLabelKey="name" placeholder="Selecionar conta" />
              </div>
              <div class="col-md-6">
                <label class="form-label">Centro de Custo</label>
                <SelectInput v-model="form.costCenterId" :options="costCenterOptions" optionValueKey="id" optionLabelKey="label" placeholder="Selecionar" />
              </div>
              <div class="col-md-6">
                <label class="form-label">Operadora (taxas)</label>
                <SelectInput v-model="form.gatewayConfigId" :options="gatewayOptions" optionValueKey="id" optionLabelKey="label" placeholder="Nenhuma (sem taxa)" />
              </div>
              <div class="col-12">
                <label class="form-label">Observações</label>
                <textarea class="form-control" v-model="form.notes" rows="2"></textarea>
              </div>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" @click="showForm = false">Cancelar</button>
            <button class="btn btn-primary" @click="createTransaction" :disabled="saving">{{ saving ? 'Salvando...' : 'Salvar' }}</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import api from '../../api';
import TextInput from '../../components/form/input/TextInput.vue';
import SelectInput from '../../components/form/select/SelectInput.vue';

export default {
  name: 'FinancialTransactions',
  components: { TextInput, SelectInput },
  data() {
    return {
      transactions: [],
      total: 0,
      page: 1,
      limit: 30,
      showForm: false,
      saving: false,
      filters: { type: '', status: '', dueDateFrom: '', dueDateTo: '', sourceType: '' },
      form: { type: 'PAYABLE', description: '', grossAmount: 0, dueDate: '', accountId: '', costCenterId: '', gatewayConfigId: '', notes: '' },
      accounts: [],
      costCenters: [],
      gateways: [],
      typeOptions: [{ value: 'PAYABLE', label: 'A Pagar' }, { value: 'RECEIVABLE', label: 'A Receber' }],
      statusOptions: [
        { value: 'PENDING', label: 'Pendente' }, { value: 'CONFIRMED', label: 'Confirmada' },
        { value: 'PAID', label: 'Paga' }, { value: 'OVERDUE', label: 'Vencida' },
        { value: 'CANCELED', label: 'Cancelada' }, { value: 'PARTIALLY', label: 'Parcial' },
      ],
      sourceTypeOptions: [
        { value: 'ORDER', label: 'Pedido' }, { value: 'RIDER', label: 'Motoboy' },
        { value: 'AFFILIATE', label: 'Afiliado' }, { value: 'COUPON', label: 'Cupom' },
        { value: 'STOCK_PURCHASE', label: 'Compra Estoque' }, { value: 'MANUAL', label: 'Manual' },
      ],
    };
  },
  computed: {
    totalPages() { return Math.ceil(this.total / this.limit); },
    accountOptions() { return this.accounts.filter(a => a.isActive); },
    costCenterOptions() { return this.costCenters.map(c => ({ id: c.id, label: `${c.code} - ${c.name}` })); },
    gatewayOptions() { return this.gateways.map(g => ({ id: g.id, label: `${g.provider} ${g.label || ''}`.trim() })); },
  },
  async mounted() {
    await Promise.all([this.load(), this.loadLookups()]);
  },
  methods: {
    async load() {
      try {
        const params = { page: this.page, limit: this.limit };
        if (this.filters.type) params.type = this.filters.type;
        if (this.filters.status) params.status = this.filters.status;
        if (this.filters.dueDateFrom) params.dueDateFrom = this.filters.dueDateFrom;
        if (this.filters.dueDateTo) params.dueDateTo = this.filters.dueDateTo;
        if (this.filters.sourceType) params.sourceType = this.filters.sourceType;
        const { data } = await api.get('/financial/transactions', { params });
        this.transactions = data.data;
        this.total = data.total;
      } catch (e) {
        console.error('Failed to load transactions:', e);
      }
    },
    async loadLookups() {
      try {
        const [acc, cc, gw] = await Promise.all([
          api.get('/financial/accounts'),
          api.get('/financial/cost-centers', { params: { flat: 'true' } }),
          api.get('/financial/gateways'),
        ]);
        this.accounts = acc.data;
        this.costCenters = cc.data;
        this.gateways = gw.data;
      } catch (e) {
        console.error('Failed to load lookups:', e);
      }
    },
    resetFilters() {
      this.filters = { type: '', status: '', dueDateFrom: '', dueDateTo: '', sourceType: '' };
      this.page = 1;
      this.load();
    },
    async createTransaction() {
      if (!this.form.description || !this.form.grossAmount || !this.form.dueDate) {
        alert('Preencha descrição, valor e vencimento');
        return;
      }
      this.saving = true;
      try {
        await api.post('/financial/transactions', this.form);
        this.showForm = false;
        this.form = { type: 'PAYABLE', description: '', grossAmount: 0, dueDate: '', accountId: '', costCenterId: '', gatewayConfigId: '', notes: '' };
        await this.load();
      } catch (e) {
        alert(e.response?.data?.message || 'Erro ao criar');
      } finally {
        this.saving = false;
      }
    },
    async payTransaction(tx) {
      const label = tx.type === 'RECEIVABLE' ? 'recebimento' : 'pagamento';
      if (!confirm(`Confirmar ${label} de ${this.formatCurrency(tx.netAmount)}?`)) return;
      try {
        await api.post(`/financial/transactions/${tx.id}/pay`, { accountId: tx.accountId });
        await this.load();
      } catch (e) {
        alert(e.response?.data?.message || 'Erro ao registrar pagamento');
      }
    },
    async cancelTransaction(tx) {
      if (!confirm('Cancelar esta transação?')) return;
      try {
        await api.post(`/financial/transactions/${tx.id}/cancel`);
        await this.load();
      } catch (e) {
        alert(e.response?.data?.message || 'Erro ao cancelar');
      }
    },
    formatCurrency(value) {
      return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value || 0);
    },
    formatDate(d) {
      if (!d) return '-';
      return new Date(d).toLocaleDateString('pt-BR');
    },
    statusLabel(s) {
      const map = { PENDING: 'Pendente', CONFIRMED: 'Confirmada', PAID: 'Paga', OVERDUE: 'Vencida', CANCELED: 'Cancelada', PARTIALLY: 'Parcial' };
      return map[s] || s;
    },
    statusBadge(s) {
      const map = { PENDING: 'badge bg-secondary', CONFIRMED: 'badge bg-info', PAID: 'badge bg-success', OVERDUE: 'badge bg-danger', CANCELED: 'badge bg-dark', PARTIALLY: 'badge bg-warning text-dark' };
      return map[s] || 'badge bg-secondary';
    },
  },
};
</script>
