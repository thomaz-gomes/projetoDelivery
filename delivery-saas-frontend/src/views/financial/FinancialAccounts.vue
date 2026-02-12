<template>
  <div class="container py-3">
    <div class="d-flex justify-content-between align-items-center mb-3">
      <h3>Contas Financeiras</h3>
      <button class="btn btn-primary" @click="showForm = true">Nova Conta</button>
    </div>

    <div class="card">
      <div class="table-responsive">
        <table class="table table-hover mb-0">
          <thead class="table-light">
            <tr>
              <th>Nome</th>
              <th>Tipo</th>
              <th>Banco</th>
              <th>Saldo Atual</th>
              <th>Padrão</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="acc in accounts" :key="acc.id">
              <td>{{ acc.name }}</td>
              <td><span class="badge bg-secondary">{{ typeLabel(acc.type) }}</span></td>
              <td>{{ acc.bankCode ? `${acc.bankCode} / Ag ${acc.agency || '-'}` : '-' }}</td>
              <td :class="Number(acc.currentBalance) >= 0 ? 'text-success' : 'text-danger'">
                {{ formatCurrency(acc.currentBalance) }}
              </td>
              <td>{{ acc.isDefault ? 'Sim' : '-' }}</td>
              <td>
                <span :class="acc.isActive ? 'badge bg-success' : 'badge bg-danger'">
                  {{ acc.isActive ? 'Ativa' : 'Inativa' }}
                </span>
              </td>
              <td class="text-end">
                <button class="btn btn-sm btn-outline-primary me-1" @click="editAccount(acc)">Editar</button>
                <button v-if="acc.isActive" class="btn btn-sm btn-outline-danger" @click="deactivate(acc)">Desativar</button>
              </td>
            </tr>
            <tr v-if="accounts.length === 0">
              <td colspan="7" class="text-center py-4 text-muted">Nenhuma conta cadastrada.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Modal de formulário -->
    <div v-if="showForm" class="modal d-block" tabindex="-1" style="background: rgba(0,0,0,0.5)">
      <div class="modal-dialog">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">{{ editing ? 'Editar Conta' : 'Nova Conta' }}</h5>
            <button type="button" class="btn-close" @click="closeForm"></button>
          </div>
          <div class="modal-body">
            <div class="mb-3">
              <label class="form-label">Nome</label>
              <TextInput v-model="form.name" placeholder="Ex: Caixa Loja, Banco do Brasil CC" />
            </div>
            <div class="mb-3">
              <label class="form-label">Tipo</label>
              <SelectInput v-model="form.type" :options="typeOptions" />
            </div>
            <div class="row g-2 mb-3">
              <div class="col-4">
                <label class="form-label">Cód. Banco</label>
                <TextInput v-model="form.bankCode" placeholder="001" />
              </div>
              <div class="col-4">
                <label class="form-label">Agência</label>
                <TextInput v-model="form.agency" placeholder="1234" />
              </div>
              <div class="col-4">
                <label class="form-label">Conta</label>
                <TextInput v-model="form.accountNumber" placeholder="12345-6" />
              </div>
            </div>
            <div class="form-check mb-3">
              <input class="form-check-input" type="checkbox" v-model="form.isDefault" id="isDefault">
              <label class="form-check-label" for="isDefault">Conta padrão</label>
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
  name: 'FinancialAccounts',
  components: { TextInput, SelectInput },
  data() {
    return {
      accounts: [],
      showForm: false,
      editing: null,
      saving: false,
      form: this.emptyForm(),
      typeOptions: [
        { value: 'CHECKING', label: 'Conta Corrente' },
        { value: 'SAVINGS', label: 'Poupança' },
        { value: 'CASH', label: 'Caixa Físico' },
        { value: 'CREDIT_CARD', label: 'Cartão de Crédito' },
        { value: 'MARKETPLACE', label: 'Marketplace (iFood, Rappi)' },
        { value: 'OTHER', label: 'Outro' },
      ],
    };
  },
  async mounted() {
    await this.load();
  },
  methods: {
    emptyForm() {
      return { name: '', type: 'CHECKING', bankCode: '', agency: '', accountNumber: '', isDefault: false };
    },
    async load() {
      try {
        const { data } = await api.get('/financial/accounts');
        this.accounts = data;
      } catch (e) {
        console.error('Failed to load accounts:', e);
      }
    },
    editAccount(acc) {
      this.editing = acc.id;
      this.form = { name: acc.name, type: acc.type, bankCode: acc.bankCode || '', agency: acc.agency || '', accountNumber: acc.accountNumber || '', isDefault: acc.isDefault };
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
        if (this.editing) {
          await api.put(`/financial/accounts/${this.editing}`, this.form);
        } else {
          await api.post('/financial/accounts', this.form);
        }
        this.closeForm();
        await this.load();
      } catch (e) {
        alert(e.response?.data?.message || 'Erro ao salvar');
      } finally {
        this.saving = false;
      }
    },
    async deactivate(acc) {
      if (!confirm(`Desativar a conta "${acc.name}"?`)) return;
      try {
        await api.delete(`/financial/accounts/${acc.id}`);
        await this.load();
      } catch (e) {
        alert(e.response?.data?.message || 'Erro ao desativar');
      }
    },
    typeLabel(type) {
      const map = { CHECKING: 'Conta Corrente', SAVINGS: 'Poupança', CASH: 'Caixa', CREDIT_CARD: 'Cartão', MARKETPLACE: 'Marketplace', OTHER: 'Outro' };
      return map[type] || type;
    },
    formatCurrency(value) {
      return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value || 0);
    },
  },
};
</script>
