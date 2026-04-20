<template>
  <Teleport to="body">
    <div v-if="modelValue" class="drawer-overlay" @click.self="close">
      <div class="drawer-panel">
        <!-- Cabeçalho com dados do OFX -->
        <div class="drawer-header">
          <div class="d-flex justify-content-between align-items-start mb-3">
            <h5 class="mb-0">Conciliar Item</h5>
            <button class="btn-close" @click="close"></button>
          </div>
          <div class="card bg-light border-0 mb-3">
            <div class="card-body py-2">
              <div class="small text-muted">Extrato bancário</div>
              <div class="fw-semibold">{{ item?.memo || 'Sem descrição' }}</div>
              <div class="d-flex gap-3 mt-1">
                <span class="fw-bold" :class="Number(item?.amount) >= 0 ? 'text-success' : 'text-danger'" style="font-size: 1.25rem">
                  {{ formatCurrency(item?.amount) }}
                </span>
                <span class="text-muted align-self-center">{{ formatDate(item?.ofxDate) }}</span>
              </div>
              <div class="text-muted small mt-1">FITID: {{ item?.fitId || '-' }}</div>
            </div>
          </div>
        </div>

        <div class="drawer-body">
          <!-- Área 1: Candidatos sugeridos -->
          <div class="mb-4">
            <h6 class="text-muted mb-2"><i class="bi-lightning me-1"></i>Candidatos sugeridos</h6>
            <div v-if="loadingCandidates" class="text-center py-3">
              <div class="spinner-border spinner-border-sm text-primary"></div>
              <span class="ms-2 text-muted small">Buscando...</span>
            </div>
            <div v-else-if="candidates.length === 0" class="text-muted small py-2">
              Nenhum lançamento compatível encontrado.
            </div>
            <div v-else class="d-flex flex-column gap-2">
              <div v-for="c in candidates" :key="c.id" class="card candidate-card">
                <div class="card-body py-2 px-3 d-flex justify-content-between align-items-center">
                  <div>
                    <div class="fw-semibold small">{{ c.description }}</div>
                    <div class="d-flex gap-2 mt-1">
                      <span class="small">{{ formatCurrency(c.netAmount) }}</span>
                      <span class="text-muted small">{{ formatDate(c.dueDate) }}</span>
                      <span v-if="c.costCenter" class="text-muted small">{{ c.costCenter.name }}</span>
                    </div>
                  </div>
                  <div class="d-flex align-items-center gap-2">
                    <span class="badge" :class="scoreBadgeClass(c.score)">{{ c.score }}%</span>
                    <button class="btn btn-sm btn-outline-primary" @click="matchWith(c)">Vincular</button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Área 2: Busca manual -->
          <div class="mb-4">
            <h6 class="text-muted mb-2"><i class="bi-search me-1"></i>Buscar lançamento</h6>
            <div class="input-group input-group-sm mb-2">
              <input type="text" class="form-control" v-model="searchQuery" placeholder="Buscar por descrição..."
                     @keyup.enter="searchCandidates">
              <button class="btn btn-outline-primary" @click="searchCandidates" :disabled="!searchQuery.trim()">
                <i class="bi-search"></i>
              </button>
            </div>
            <div v-if="searchResults.length" class="d-flex flex-column gap-2">
              <div v-for="c in searchResults" :key="c.id" class="card candidate-card">
                <div class="card-body py-2 px-3 d-flex justify-content-between align-items-center">
                  <div>
                    <div class="fw-semibold small">{{ c.description }}</div>
                    <div class="d-flex gap-2 mt-1">
                      <span class="small">{{ formatCurrency(c.netAmount) }}</span>
                      <span class="text-muted small">{{ formatDate(c.dueDate) }}</span>
                    </div>
                  </div>
                  <button class="btn btn-sm btn-outline-primary" @click="matchWith(c)">Vincular</button>
                </div>
              </div>
            </div>
          </div>

          <!-- Área 3: Criar novo lançamento -->
          <div>
            <button class="btn btn-sm btn-outline-secondary w-100 mb-3" @click="showCreateForm = !showCreateForm">
              <i class="bi-plus-circle me-1"></i>
              {{ showCreateForm ? 'Fechar formulário' : 'Criar novo lançamento' }}
            </button>

            <div v-if="showCreateForm" class="create-form">
              <div class="mb-3">
                <label class="form-label">Tipo</label>
                <SelectInput v-model="newTx.type" :options="typeOptions" optionValueKey="value" optionLabelKey="label" />
              </div>
              <div class="mb-3">
                <label class="form-label">Descrição</label>
                <TextInput v-model="newTx.description" />
              </div>
              <div class="row g-2 mb-3">
                <div class="col-6">
                  <label class="form-label">Valor bruto</label>
                  <CurrencyInput v-model="newTx.grossAmount" />
                </div>
                <div class="col-6">
                  <label class="form-label">Taxa</label>
                  <CurrencyInput v-model="newTx.feeAmount" />
                </div>
              </div>
              <div class="mb-2">
                <small class="text-muted">Valor líquido: <strong>{{ formatCurrency(computedNetAmount) }}</strong></small>
              </div>
              <div class="row g-2 mb-3">
                <div class="col-6">
                  <label class="form-label">Emissão</label>
                  <DateInput v-model="newTx.issueDate" />
                </div>
                <div class="col-6">
                  <label class="form-label">Vencimento</label>
                  <DateInput v-model="newTx.dueDate" />
                </div>
              </div>
              <div class="mb-3">
                <label class="form-label">Centro de custo</label>
                <SelectInput v-model="newTx.costCenterId" :options="costCenters" optionValueKey="id" optionLabelKey="name"
                  placeholder="Selecionar..." />
              </div>
              <div class="mb-3">
                <label class="form-label">Observações</label>
                <TextareaInput v-model="newTx.notes" rows="2" />
              </div>
              <BaseButton variant="primary" block :loading="creating" @click="createAndMatch">
                Criar e Vincular
              </BaseButton>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script>
import api from '../../api';
import TextInput from '../form/input/TextInput.vue';
import TextareaInput from '../form/input/TextareaInput.vue';
import SelectInput from '../form/select/SelectInput.vue';
import CurrencyInput from '../form/input/CurrencyInput.vue';
import DateInput from '../form/date/DateInput.vue';
import BaseButton from '../BaseButton.vue';

export default {
  name: 'ReconciliationDrawer',
  components: { TextInput, TextareaInput, SelectInput, CurrencyInput, DateInput, BaseButton },
  props: {
    modelValue: { type: Boolean, default: false },
    item: { type: Object, default: null },
  },
  emits: ['update:modelValue', 'reconciled'],
  data() {
    return {
      candidates: [],
      loadingCandidates: false,
      searchQuery: '',
      searchResults: [],
      showCreateForm: false,
      creating: false,
      costCenters: [],
      newTx: this.defaultNewTx(),
      typeOptions: [
        { value: 'PAYABLE', label: 'A pagar' },
        { value: 'RECEIVABLE', label: 'A receber' },
      ],
    };
  },
  computed: {
    computedNetAmount() {
      return (Number(this.newTx.grossAmount) || 0) - (Number(this.newTx.feeAmount) || 0);
    },
  },
  watch: {
    item(val) {
      if (val) {
        this.resetState();
        this.loadCandidates();
        this.loadCostCenters();
        this.prefillForm();
      }
    },
  },
  methods: {
    defaultNewTx() {
      return {
        type: 'PAYABLE',
        description: '',
        grossAmount: 0,
        feeAmount: 0,
        issueDate: '',
        dueDate: '',
        costCenterId: '',
        notes: '',
      };
    },
    resetState() {
      this.candidates = [];
      this.searchQuery = '';
      this.searchResults = [];
      this.showCreateForm = false;
      this.creating = false;
    },
    prefillForm() {
      if (!this.item) return;
      const amount = Math.abs(Number(this.item.amount));
      const isCredit = Number(this.item.amount) > 0;
      const dateStr = this.item.ofxDate ? new Date(this.item.ofxDate).toISOString().split('T')[0] : '';
      this.newTx = {
        type: isCredit ? 'RECEIVABLE' : 'PAYABLE',
        description: this.item.memo || '',
        grossAmount: amount,
        feeAmount: 0,
        issueDate: dateStr,
        dueDate: dateStr,
        costCenterId: '',
        notes: '',
      };
    },
    async loadCandidates() {
      this.loadingCandidates = true;
      try {
        const { data } = await api.get(`/financial/ofx/items/${this.item.id}/candidates`);
        this.candidates = data;
      } catch (e) {
        console.error('Erro ao buscar candidatos:', e);
      } finally {
        this.loadingCandidates = false;
      }
    },
    async loadCostCenters() {
      try {
        const { data } = await api.get('/financial/cost-centers');
        this.costCenters = data;
      } catch (e) { /* ignore */ }
    },
    async searchCandidates() {
      if (!this.searchQuery.trim()) return;
      try {
        const { data } = await api.get(`/financial/ofx/items/${this.item.id}/candidates`, {
          params: { search: this.searchQuery },
        });
        this.searchResults = data;
      } catch (e) {
        console.error('Erro na busca:', e);
      }
    },
    async matchWith(candidate) {
      try {
        await api.post(`/financial/ofx/items/${this.item.id}/match`, {
          transactionId: candidate.id,
          notes: 'Conciliado manualmente',
        });
        this.$emit('reconciled');
        this.close();
      } catch (e) {
        console.error('Erro ao vincular:', e);
      }
    },
    async createAndMatch() {
      this.creating = true;
      try {
        await api.post(`/financial/ofx/items/${this.item.id}/create-and-match`, {
          type: this.newTx.type,
          description: this.newTx.description,
          grossAmount: this.newTx.grossAmount,
          feeAmount: this.newTx.feeAmount,
          issueDate: this.newTx.issueDate,
          dueDate: this.newTx.dueDate,
          costCenterId: this.newTx.costCenterId || null,
          notes: this.newTx.notes || null,
        });
        this.$emit('reconciled');
        this.close();
      } catch (e) {
        console.error('Erro ao criar lançamento:', e);
      } finally {
        this.creating = false;
      }
    },
    close() {
      this.$emit('update:modelValue', false);
    },
    scoreBadgeClass(score) {
      if (score >= 80) return 'bg-success';
      if (score >= 50) return 'bg-warning text-dark';
      return 'bg-secondary';
    },
    formatCurrency(value) {
      return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value || 0);
    },
    formatDate(d) {
      if (!d) return '-';
      return new Date(d).toLocaleDateString('pt-BR');
    },
  },
};
</script>

<style scoped>
.drawer-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.3);
  z-index: 1050;
  display: flex;
  justify-content: flex-end;
}
.drawer-panel {
  width: 450px;
  max-width: 90vw;
  background: var(--bg-card, #fff);
  height: 100%;
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow-dropdown, 0 0.5rem 1.5rem rgba(0,0,0,0.1));
}
.drawer-header {
  padding: 1.25rem;
  border-bottom: 1px solid var(--border-color-soft, rgba(0,0,0,0.06));
}
.drawer-body {
  padding: 1.25rem;
  overflow-y: auto;
  flex: 1;
}
.candidate-card {
  cursor: pointer;
  transition: box-shadow 0.15s;
}
.candidate-card:hover {
  box-shadow: var(--shadow-hover, 0 4px 12px rgba(0,0,0,0.08));
}
.create-form {
  border-top: 1px solid var(--border-color-soft, rgba(0,0,0,0.06));
  padding-top: 1rem;
}
</style>
