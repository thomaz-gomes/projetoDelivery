<template>
  <div class="container py-3">
    <div class="d-flex justify-content-between align-items-center mb-3">
      <h3>Formas de Pagamento</h3>
      <button class="btn btn-primary" @click="openNew">Nova Forma de Pagamento</button>
    </div>

    <div class="card">
      <div class="table-responsive">
        <table class="table table-hover mb-0">
          <thead class="table-light">
            <tr>
              <th>Nome</th>
              <th>Tipo</th>
              <th>Detalhes</th>
              <th>Conta</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="m in methods" :key="m.id">
              <td>{{ m.name }}</td>
              <td><span class="badge bg-secondary">{{ typeLabel(m.type) }}</span></td>
              <td>{{ detailText(m) }}</td>
              <td>{{ accountName(m.financialAccountId) }}</td>
              <td>
                <span :class="m.isActive ? 'badge bg-success' : 'badge bg-danger'">
                  {{ m.isActive ? 'Ativo' : 'Inativo' }}
                </span>
              </td>
              <td class="text-end">
                <button class="btn btn-sm btn-outline-primary me-1" @click="editMethod(m)">Editar</button>
                <button v-if="m.isActive" class="btn btn-sm btn-outline-danger" @click="deactivate(m)">Desativar</button>
              </td>
            </tr>
            <tr v-if="methods.length === 0">
              <td colspan="6" class="text-center py-4 text-muted">Nenhuma forma de pagamento cadastrada.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Modal -->
    <div v-if="showForm" class="modal d-block" tabindex="-1" style="background: rgba(0,0,0,0.5)">
      <div class="modal-dialog">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">{{ editing ? 'Editar Forma de Pagamento' : 'Nova Forma de Pagamento' }}</h5>
            <button type="button" class="btn-close" @click="closeForm"></button>
          </div>
          <div class="modal-body">
            <div class="mb-3">
              <label class="form-label">Nome</label>
              <TextInput v-model="form.name" placeholder="Ex: Nubank Crédito, PIX Banco do Brasil" />
            </div>
            <div class="mb-3">
              <label class="form-label">Tipo</label>
              <SelectInput v-model="form.type" :options="typeOptions" />
            </div>

            <!-- Campos específicos de cartão de crédito -->
            <template v-if="form.type === 'CREDIT_CARD'">
              <div class="row g-2 mb-3">
                <div class="col-6">
                  <label class="form-label">Dia do Fechamento</label>
                  <input type="number" class="form-control" v-model.number="form.closingDay" min="1" max="31" />
                </div>
                <div class="col-6">
                  <label class="form-label">Dia do Vencimento</label>
                  <input type="number" class="form-control" v-model.number="form.dueDay" min="1" max="31" />
                </div>
              </div>
              <div class="row g-2 mb-3">
                <div class="col-6">
                  <label class="form-label">Bandeira</label>
                  <TextInput v-model="form.brand" placeholder="Visa, Mastercard..." />
                </div>
                <div class="col-6">
                  <label class="form-label">Últimos 4 dígitos</label>
                  <TextInput v-model="form.lastDigits" placeholder="1234" />
                </div>
              </div>
              <div class="mb-3">
                <label class="form-label">Limite</label>
                <input type="number" class="form-control" v-model.number="form.creditLimit" min="0" step="0.01" />
              </div>
            </template>

            <div class="mb-3">
              <label class="form-label">Conta Financeira</label>
              <SelectInput v-model="form.financialAccountId" :options="accountOptions" />
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" @click="closeForm">Cancelar</button>
            <button class="btn btn-primary" @click="save" :disabled="saving">{{ saving ? 'Salvando...' : 'Salvar' }}</button>
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
  name: 'PayablePaymentMethods',
  components: { TextInput, SelectInput },
  data() {
    return {
      methods: [],
      accounts: [],
      showForm: false,
      editing: null,
      saving: false,
      form: this.emptyForm(),
      typeOptions: [
        { value: 'CREDIT_CARD', label: 'Cartão de Crédito' },
        { value: 'BOLETO', label: 'Boleto' },
        { value: 'PIX', label: 'PIX' },
        { value: 'DINHEIRO', label: 'Dinheiro' },
        { value: 'TRANSFERENCIA', label: 'Transferência' },
      ],
    };
  },
  computed: {
    accountOptions() {
      return [
        { value: '', label: 'Nenhuma' },
        ...this.accounts.map(a => ({ value: a.id, label: a.name })),
      ];
    },
  },
  async mounted() {
    await this.loadAll();
  },
  methods: {
    emptyForm() {
      return {
        name: '',
        type: 'PIX',
        closingDay: null,
        dueDay: null,
        brand: '',
        lastDigits: '',
        creditLimit: null,
        financialAccountId: '',
      };
    },
    async loadAll() {
      try {
        const [methodsRes, accountsRes] = await Promise.all([
          api.get('/financial/payment-methods'),
          api.get('/financial/accounts'),
        ]);
        this.methods = methodsRes.data;
        this.accounts = accountsRes.data;
      } catch (e) {
        console.error('Failed to load payment methods:', e);
      }
    },
    openNew() {
      this.editing = null;
      this.form = this.emptyForm();
      this.showForm = true;
    },
    editMethod(m) {
      this.editing = m.id;
      this.form = {
        name: m.name,
        type: m.type,
        closingDay: m.closingDay || null,
        dueDay: m.dueDay || null,
        brand: m.brand || '',
        lastDigits: m.lastDigits || '',
        creditLimit: m.creditLimit != null ? Number(m.creditLimit) : null,
        financialAccountId: m.financialAccountId || '',
      };
      this.showForm = true;
    },
    closeForm() {
      this.showForm = false;
      this.editing = null;
      this.form = this.emptyForm();
    },
    async save() {
      this.saving = true;
      try {
        const payload = { ...this.form };
        // Clear card-specific fields when type is not CREDIT_CARD
        if (payload.type !== 'CREDIT_CARD') {
          delete payload.closingDay;
          delete payload.dueDay;
          delete payload.brand;
          delete payload.lastDigits;
          delete payload.creditLimit;
        }
        if (!payload.financialAccountId) delete payload.financialAccountId;

        if (this.editing) {
          await api.put(`/financial/payment-methods/${this.editing}`, payload);
        } else {
          await api.post('/financial/payment-methods', payload);
        }
        this.closeForm();
        await this.loadAll();
      } catch (e) {
        alert(e.response?.data?.message || 'Erro ao salvar');
      } finally {
        this.saving = false;
      }
    },
    async deactivate(m) {
      if (!confirm(`Desativar "${m.name}"?`)) return;
      try {
        await api.delete(`/financial/payment-methods/${m.id}`);
        await this.loadAll();
      } catch (e) {
        alert(e.response?.data?.message || 'Erro ao desativar');
      }
    },
    typeLabel(type) {
      const map = {
        CREDIT_CARD: 'Cartão de Crédito',
        BOLETO: 'Boleto',
        PIX: 'PIX',
        DINHEIRO: 'Dinheiro',
        TRANSFERENCIA: 'Transferência',
      };
      return map[type] || type;
    },
    detailText(m) {
      if (m.type !== 'CREDIT_CARD') return '-';
      const parts = [];
      if (m.closingDay && m.dueDay) parts.push(`Fech. dia ${m.closingDay} | Venc. dia ${m.dueDay}`);
      if (m.brand) parts.push(m.brand);
      if (m.lastDigits) parts.push(`****${m.lastDigits}`);
      return parts.length ? parts.join(' - ') : '-';
    },
    accountName(id) {
      if (!id) return '-';
      const acc = this.accounts.find(a => a.id === id);
      return acc ? acc.name : '-';
    },
  },
};
</script>
