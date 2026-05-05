<template>
  <div class="container py-3">
    <div class="d-flex justify-content-between align-items-center mb-3">
      <h3>Despesas Fixas</h3>
      <button class="btn btn-primary" @click="openCreate">Nova Despesa Fixa</button>
    </div>

    <div class="card">
      <div class="table-responsive">
        <table class="table table-hover mb-0">
          <thead class="table-light">
            <tr>
              <th>Descrição</th>
              <th>Valor</th>
              <th>Periodicidade</th>
              <th>Próximo Vencimento</th>
              <th>Centro de Custo</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in items" :key="item.id">
              <td>
                <div>{{ item.description }}</div>
                <small v-if="item.supplier" class="text-muted">{{ item.supplier.name }}</small>
              </td>
              <td>{{ formatCurrency(item.grossAmount) }}</td>
              <td>{{ recurrenceLabel(item.recurrence) }}</td>
              <td>
                <span :class="dueBadgeClass(item.nextDueDate)">
                  {{ formatDate(item.nextDueDate) }}
                </span>
              </td>
              <td>
                <span v-if="item.costCenter">{{ item.costCenter.name }}</span>
                <span v-else class="text-muted">—</span>
              </td>
              <td>
                <span :class="item.isActive ? 'badge bg-success' : 'badge bg-secondary'">
                  {{ item.isActive ? 'Ativo' : 'Inativo' }}
                </span>
              </td>
              <td class="text-end text-nowrap">
                <button class="btn btn-sm btn-outline-primary me-1" title="Editar" @click="openEdit(item)">
                  <i class="bi bi-pencil"></i>
                </button>
                <button class="btn btn-sm btn-outline-warning me-1" title="Gerar agora" @click="generateNow(item)">
                  <i class="bi bi-lightning"></i>
                </button>
                <button v-if="item.isActive" class="btn btn-sm btn-outline-danger" title="Desativar" @click="deactivate(item)">
                  <i class="bi bi-x-lg"></i>
                </button>
              </td>
            </tr>
            <tr v-if="items.length === 0 && !loading">
              <td colspan="7" class="text-center py-4 text-muted">
                Nenhuma despesa fixa cadastrada.
              </td>
            </tr>
            <tr v-if="loading">
              <td colspan="7" class="text-center py-4 text-muted">
                Carregando...
              </td>
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
            <h5 class="modal-title">{{ editing ? 'Editar' : 'Nova' }} Despesa Fixa</h5>
            <button type="button" class="btn-close" @click="closeForm"></button>
          </div>
          <div class="modal-body">
            <div class="mb-3">
              <label class="form-label">Descrição <span class="text-danger">*</span></label>
              <TextInput v-model="form.description" placeholder="Ex: Aluguel mensal" />
            </div>
            <div class="mb-3">
              <label class="form-label">Valor (R$) <span class="text-danger">*</span></label>
              <input
                type="number"
                class="form-control"
                v-model.number="form.grossAmount"
                min="0"
                step="0.01"
                placeholder="0,00"
              />
            </div>
            <div class="mb-3">
              <label class="form-label">Periodicidade</label>
              <SelectInput
                v-model="form.recurrence"
                :options="recurrenceOptions"
                placeholder="Selecionar"
              />
            </div>
            <div class="mb-3" v-if="showDayOfMonth">
              <label class="form-label">Dia do mês</label>
              <input
                type="number"
                class="form-control"
                v-model.number="form.dayOfMonth"
                min="1"
                max="28"
                placeholder="Ex: 5"
              />
            </div>
            <div class="mb-3">
              <label class="form-label">Próximo Vencimento <span class="text-danger">*</span></label>
              <input type="date" class="form-control" v-model="form.nextDueDate" />
            </div>
            <div class="mb-3">
              <label class="form-label">Conta</label>
              <SelectInput
                v-model="form.accountId"
                :options="accountOptions"
                optionValueKey="id"
                optionLabelKey="name"
                placeholder="Nenhuma"
              />
            </div>
            <div class="mb-3">
              <label class="form-label">Centro de Custo</label>
              <SelectInput
                v-model="form.costCenterId"
                :options="fixedCostCenterOptions"
                optionValueKey="id"
                optionLabelKey="displayName"
                placeholder="Nenhum"
              />
            </div>
            <div class="mb-3">
              <label class="form-label">Observações</label>
              <textarea class="form-control" v-model="form.notes" rows="3" placeholder="Observações opcionais"></textarea>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" @click="closeForm">Cancelar</button>
            <button class="btn btn-primary" @click="save" :disabled="saving">
              {{ saving ? 'Salvando...' : 'Salvar' }}
            </button>
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

const RECURRENCE_LABELS = {
  WEEKLY: 'Semanal',
  BIWEEKLY: 'Quinzenal',
  MONTHLY: 'Mensal',
  QUARTERLY: 'Trimestral',
  ANNUAL: 'Anual',
};

const DAY_OF_MONTH_RECURRENCES = ['MONTHLY', 'QUARTERLY', 'ANNUAL'];

export default {
  name: 'FinancialRecurring',
  components: { TextInput, SelectInput },
  data() {
    return {
      items: [],
      accounts: [],
      costCenters: [],
      loading: false,
      showForm: false,
      editing: null,
      saving: false,
      form: this.emptyForm(),
      recurrenceOptions: [
        { value: 'WEEKLY', label: 'Semanal' },
        { value: 'BIWEEKLY', label: 'Quinzenal' },
        { value: 'MONTHLY', label: 'Mensal' },
        { value: 'QUARTERLY', label: 'Trimestral' },
        { value: 'ANNUAL', label: 'Anual' },
      ],
    };
  },
  computed: {
    showDayOfMonth() {
      return DAY_OF_MONTH_RECURRENCES.includes(this.form.recurrence);
    },
    accountOptions() {
      return this.accounts.filter(a => a.isActive);
    },
    fixedCostCenterOptions() {
      return this.costCenters
        .filter(cc => !cc.natureza || cc.natureza === 'FIXA')
        .map(cc => ({ ...cc, displayName: cc.code ? `${cc.code} - ${cc.name}` : cc.name }));
    },
  },
  async mounted() {
    await Promise.all([this.load(), this.loadAccounts(), this.loadCostCenters()]);
  },
  methods: {
    emptyForm() {
      return {
        description: '',
        grossAmount: '',
        recurrence: 'MONTHLY',
        dayOfMonth: '',
        nextDueDate: '',
        accountId: '',
        costCenterId: '',
        notes: '',
      };
    },
    async load() {
      this.loading = true;
      try {
        const { data } = await api.get('/financial/recurring');
        this.items = data;
      } catch (e) {
        console.error('Failed to load recurring expenses:', e);
      } finally {
        this.loading = false;
      }
    },
    async loadAccounts() {
      try {
        const { data } = await api.get('/financial/accounts');
        this.accounts = data;
      } catch (e) {
        console.error('Failed to load accounts:', e);
      }
    },
    async loadCostCenters() {
      try {
        const { data } = await api.get('/financial/cost-centers', { params: { flat: 'true' } });
        this.costCenters = data;
      } catch (e) {
        console.error('Failed to load cost centers:', e);
      }
    },
    openCreate() {
      this.editing = null;
      this.form = this.emptyForm();
      this.showForm = true;
    },
    openEdit(item) {
      this.editing = item.id;
      this.form = {
        description: item.description || '',
        grossAmount: item.grossAmount || '',
        recurrence: item.recurrence || 'MONTHLY',
        dayOfMonth: item.dayOfMonth || '',
        nextDueDate: item.nextDueDate ? item.nextDueDate.slice(0, 10) : '',
        accountId: item.accountId || '',
        costCenterId: item.costCenterId || '',
        notes: item.notes || '',
      };
      this.showForm = true;
    },
    closeForm() {
      this.showForm = false;
      this.editing = null;
      this.form = this.emptyForm();
    },
    async save() {
      if (!this.form.description) {
        alert('A descrição é obrigatória.');
        return;
      }
      if (!this.form.grossAmount && this.form.grossAmount !== 0) {
        alert('O valor é obrigatório.');
        return;
      }
      if (!this.form.nextDueDate) {
        alert('O próximo vencimento é obrigatório.');
        return;
      }
      this.saving = true;
      try {
        const payload = {
          description: this.form.description,
          grossAmount: Number(this.form.grossAmount),
          recurrence: this.form.recurrence || undefined,
          dayOfMonth: this.showDayOfMonth && this.form.dayOfMonth ? Number(this.form.dayOfMonth) : undefined,
          nextDueDate: this.form.nextDueDate || undefined,
          accountId: this.form.accountId || undefined,
          costCenterId: this.form.costCenterId || undefined,
          notes: this.form.notes || undefined,
        };
        if (this.editing) {
          await api.put(`/financial/recurring/${this.editing}`, payload);
        } else {
          await api.post('/financial/recurring', payload);
        }
        this.closeForm();
        await this.load();
      } catch (e) {
        alert(e.response?.data?.message || 'Erro ao salvar');
      } finally {
        this.saving = false;
      }
    },
    async generateNow(item) {
      try {
        await api.post(`/financial/recurring/${item.id}/generate`);
        alert('Lançamento gerado com sucesso!');
        await this.load();
      } catch (e) {
        alert(e.response?.data?.message || 'Erro ao gerar lançamento');
      }
    },
    async deactivate(item) {
      if (!window.confirm(`Desativar a despesa fixa "${item.description}"?`)) return;
      try {
        await api.delete(`/financial/recurring/${item.id}`);
        await this.load();
      } catch (e) {
        alert(e.response?.data?.message || 'Erro ao desativar');
      }
    },
    recurrenceLabel(value) {
      return RECURRENCE_LABELS[value] || value || '—';
    },
    formatCurrency(value) {
      if (value == null) return '—';
      return Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    },
    formatDate(value) {
      if (!value) return '—';
      const d = new Date(value);
      if (isNaN(d.getTime())) return value;
      return d.toLocaleDateString('pt-BR', { timeZone: 'UTC' });
    },
    dueBadgeClass(value) {
      if (!value) return 'badge bg-secondary';
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const due = new Date(value);
      due.setHours(0, 0, 0, 0);
      const diffDays = Math.round((due - today) / (1000 * 60 * 60 * 24));
      if (diffDays < 0) return 'badge bg-danger';
      if (diffDays <= 7) return 'badge bg-warning text-dark';
      return 'badge bg-success';
    },
  },
};
</script>
