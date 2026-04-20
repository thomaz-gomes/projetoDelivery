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
                  <button v-if="tx.status === 'PENDING' || tx.status === 'CONFIRMED'" class="btn btn-outline-success" @click="openPayModal(tx)">
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

    <!-- Modal de pagamento / edição -->
    <div v-if="showPayModal" class="modal d-block" tabindex="-1" style="background: rgba(0,0,0,0.5)">
      <div class="modal-dialog">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">{{ payForm.type === 'RECEIVABLE' ? 'Receber' : 'Pagar' }} Transação</h5>
            <button type="button" class="btn-close" @click="showPayModal = false"></button>
          </div>
          <div class="modal-body">
            <div class="row g-3">
              <div class="col-12">
                <label class="form-label">Descrição</label>
                <TextInput v-model="payForm.description" />
              </div>
              <div class="col-md-6">
                <label class="form-label">Valor Bruto (R$)</label>
                <input type="number" class="form-control" v-model.number="payForm.grossAmount" step="0.01" min="0">
              </div>
              <div class="col-md-6">
                <label class="form-label">Vencimento</label>
                <input type="date" class="form-control" v-model="payForm.dueDate">
              </div>
              <div class="col-md-6">
                <label class="form-label">Conta</label>
                <SelectInput v-model="payForm.accountId" :options="accountOptions" optionValueKey="id" optionLabelKey="name" placeholder="Selecionar conta" />
              </div>
              <div class="col-md-6">
                <label class="form-label">Valor do Pagamento (R$)</label>
                <input type="number" class="form-control" v-model.number="payForm.payAmount" step="0.01" min="0">
              </div>
              <div class="col-md-6">
                <label class="form-label">Data de Pagamento</label>
                <input type="date" class="form-control" v-model="payForm.paidDate">
              </div>
              <div class="col-12">
                <label class="form-label">Observações</label>
                <textarea class="form-control" v-model="payForm.notes" rows="2" placeholder="Observações do pagamento..."></textarea>
              </div>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-outline-secondary" @click="showPayModal = false">Cancelar</button>
            <button class="btn btn-primary" @click="confirmPay" :disabled="payingSaving">
              {{ payingSaving ? 'Processando...' : (payForm.type === 'RECEIVABLE' ? 'Confirmar Recebimento' : 'Confirmar Pagamento') }}
            </button>
          </div>
        </div>
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
                <label class="form-label">Conta</label>
                <SelectInput v-model="form.accountId" :options="accountOptions" optionValueKey="id" optionLabelKey="name" placeholder="Selecionar conta" />
              </div>
              <div class="col-md-4">
                <label class="form-label">Centro de Custo</label>
                <SelectInput v-model="form.costCenterId" :options="costCenterOptions" optionValueKey="id" optionLabelKey="label" placeholder="Selecionar" />
              </div>
              <div class="col-md-4">
                <label class="form-label">Fornecedor</label>
                <SelectInput v-model="form.supplierId" :options="supplierOptions" optionValueKey="id" optionLabelKey="name" placeholder="Nenhum" />
              </div>
              <div class="col-md-4">
                <label class="form-label">Operadora (taxas)</label>
                <SelectInput v-model="form.gatewayConfigId" :options="gatewayOptions" optionValueKey="id" optionLabelKey="label" placeholder="Nenhuma (sem taxa)" />
              </div>
              <div class="col-md-4">
                <label class="form-label">Forma de Pagamento</label>
                <SelectInput v-model="form.payablePaymentMethodId" :options="paymentMethodOptions"
                  optionValueKey="id" optionLabelKey="name" placeholder="Nenhuma (avulso)" />
              </div>
              <div class="col-md-6" v-if="form.payablePaymentMethodId">
                <label class="form-label">Data da Compra</label>
                <input type="date" class="form-control" v-model="form.purchaseDate">
              </div>
              <div class="col-md-6" v-if="selectedMethodType !== 'CREDIT_CARD'">
                <label class="form-label">Vencimento</label>
                <input type="date" class="form-control" v-model="form.dueDate">
              </div>
              <div class="col-md-4" v-if="selectedMethodType === 'CREDIT_CARD' || selectedMethodType === 'BOLETO'">
                <label class="form-label">Parcelas</label>
                <SelectInput v-model="form.installmentCount" :options="installmentOptions" />
              </div>
              <div class="col-md-4" v-if="selectedMethodType === 'BOLETO' && form.installmentCount > 1">
                <label class="form-label">Intervalo</label>
                <SelectInput v-model="form.boletoTemplate" :options="boletoTemplateOptions" />
              </div>
              <div class="col-12" v-if="form.payablePaymentMethodId && selectedMethodType !== 'CREDIT_CARD' && form.installmentCount > 1 && form.purchaseDate && form.grossAmount > 0">
                <button type="button" class="btn btn-outline-primary btn-sm mb-2" @click="previewInstallments">
                  Calcular Parcelas
                </button>
              </div>
              <div class="col-12" v-if="installmentPreview.length >= 1">
                <h6>Parcelas</h6>
                <table class="table table-sm">
                  <thead><tr><th>Parcela</th><th>Valor (R$)</th><th>Vencimento</th></tr></thead>
                  <tbody>
                    <tr v-for="inst in installmentPreview" :key="inst.number">
                      <td>{{ inst.number }}/{{ inst.totalInstallments }}</td>
                      <td><input type="number" class="form-control form-control-sm" v-model.number="inst.amount" step="0.01" min="0"></td>
                      <td><input type="date" class="form-control form-control-sm" v-model="inst.dueDate"></td>
                    </tr>
                  </tbody>
                </table>
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
      showPayModal: false,
      payingSaving: false,
      payForm: { id: '', type: '', description: '', grossAmount: 0, dueDate: '', accountId: '', payAmount: 0, paidDate: '', notes: '' },
      filters: { type: '', status: '', dueDateFrom: '', dueDateTo: '', sourceType: '' },
      form: { type: 'PAYABLE', description: '', grossAmount: 0, dueDate: '', accountId: '', costCenterId: '', gatewayConfigId: '', notes: '', payablePaymentMethodId: '', purchaseDate: '', installmentCount: 1, boletoTemplate: '30d', supplierId: '' },
      installmentPreview: [],
      installmentOptions: Array.from({ length: 24 }, (_, i) => ({ value: i + 1, label: `${i + 1}x` })),
      boletoTemplateOptions: [
        { value: '30d', label: 'A cada 30 dias' },
        { value: '7_14_21', label: '7/14/21 dias' },
        { value: '7_15', label: '7/15 dias' },
        { value: 'custom', label: 'Personalizado' },
      ],
      accounts: [],
      costCenters: [],
      gateways: [],
      paymentMethods: [],
      suppliers: [],
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
    paymentMethodOptions() { return this.paymentMethods.filter(m => m.isActive); },
    supplierOptions() { return this.suppliers.filter(s => s.isActive); },
    selectedMethodType() {
      const m = this.paymentMethods.find(pm => pm.id === this.form.payablePaymentMethodId);
      return m?.type || null;
    },
  },
  watch: {
    'form.payablePaymentMethodId'() { this.autoPreviewCreditCard(); },
    'form.purchaseDate'() { this.autoPreviewCreditCard(); },
    'form.grossAmount'() { this.autoPreviewCreditCard(); },
    'form.installmentCount'() { this.autoPreviewCreditCard(); },
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
        const [acc, cc, gw, pm, sup] = await Promise.all([
          api.get('/financial/accounts'),
          api.get('/financial/cost-centers', { params: { flat: 'true' } }),
          api.get('/financial/gateways'),
          api.get('/financial/payment-methods', { params: { activeOnly: 'true' } }),
          api.get('/suppliers').catch(() => ({ data: [] })),
        ]);
        this.accounts = acc.data;
        this.costCenters = cc.data;
        this.gateways = gw.data;
        this.paymentMethods = pm.data;
        this.suppliers = Array.isArray(sup.data) ? sup.data : (sup.data?.suppliers || []);
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
      const isCreditCard = this.selectedMethodType === 'CREDIT_CARD';
      if (!this.form.description || !this.form.grossAmount) {
        alert('Preencha descrição e valor');
        return;
      }
      if (!isCreditCard && !this.form.dueDate) {
        alert('Preencha a data de vencimento');
        return;
      }
      if (isCreditCard && (!this.form.purchaseDate || !this.installmentPreview.length)) {
        alert('Preencha a data da compra e calcule as parcelas');
        return;
      }
      this.saving = true;
      try {
        const payload = { ...this.form };
        if (isCreditCard && this.installmentPreview.length) {
          payload.installments = this.installmentPreview;
          // Use first installment due date as the transaction dueDate
          if (!payload.dueDate && this.installmentPreview[0]) {
            payload.dueDate = this.installmentPreview[0].dueDate;
          }
        } else if (this.installmentPreview.length > 1) {
          payload.installments = this.installmentPreview;
        }
        await api.post('/financial/transactions', payload);
        this.showForm = false;
        this.installmentPreview = [];
        this.form = { type: 'PAYABLE', description: '', grossAmount: 0, dueDate: '', accountId: '', costCenterId: '', gatewayConfigId: '', notes: '', payablePaymentMethodId: '', purchaseDate: '', installmentCount: 1, boletoTemplate: '30d', supplierId: '' };
        await this.load();
      } catch (e) {
        alert(e.response?.data?.message || 'Erro ao criar');
      } finally {
        this.saving = false;
      }
    },
    autoPreviewCreditCard() {
      if (this.selectedMethodType === 'CREDIT_CARD' && this.form.purchaseDate && this.form.grossAmount > 0 && this.form.payablePaymentMethodId) {
        clearTimeout(this._autoPreviewTimer);
        this._autoPreviewTimer = setTimeout(() => this.previewInstallments(), 300);
      }
    },
    async previewInstallments() {
      try {
        const { data } = await api.post('/financial/transactions/preview-installments', {
          payablePaymentMethodId: this.form.payablePaymentMethodId,
          purchaseDate: this.form.purchaseDate,
          grossAmount: this.form.grossAmount,
          installmentCount: this.form.installmentCount,
          template: this.form.boletoTemplate,
        });
        this.installmentPreview = data.preview;
      } catch (e) {
        alert(e.response?.data?.message || 'Erro ao calcular parcelas');
      }
    },
    openPayModal(tx) {
      const today = new Date().toISOString().slice(0, 10);
      this.payForm = {
        id: tx.id,
        type: tx.type,
        description: tx.description,
        grossAmount: Number(tx.grossAmount),
        dueDate: tx.dueDate ? tx.dueDate.slice(0, 10) : '',
        accountId: tx.accountId || '',
        payAmount: Number(tx.netAmount),
        paidDate: today,
        notes: tx.notes || '',
      };
      this.showPayModal = true;
    },
    async confirmPay() {
      if (!this.payForm.accountId) {
        alert('Selecione uma conta');
        return;
      }
      if (!this.payForm.paidDate) {
        alert('Preencha a data de pagamento');
        return;
      }
      this.payingSaving = true;
      try {
        // 1) Update transaction fields if changed
        await api.put(`/financial/transactions/${this.payForm.id}`, {
          description: this.payForm.description,
          grossAmount: this.payForm.grossAmount,
          dueDate: this.payForm.dueDate,
          accountId: this.payForm.accountId,
          notes: this.payForm.notes,
        });
        // 2) Register payment
        await api.post(`/financial/transactions/${this.payForm.id}/pay`, {
          amount: this.payForm.payAmount,
          accountId: this.payForm.accountId,
          notes: this.payForm.notes,
          paidDate: this.payForm.paidDate,
        });
        this.showPayModal = false;
        await this.load();
      } catch (e) {
        alert(e.response?.data?.message || 'Erro ao registrar pagamento');
      } finally {
        this.payingSaving = false;
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
