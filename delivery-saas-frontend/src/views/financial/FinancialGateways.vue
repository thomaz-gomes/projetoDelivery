<template>
  <div class="container py-3">
    <div class="d-flex justify-content-between align-items-center mb-3">
      <h3>Taxas e Operadoras</h3>
      <button class="btn btn-primary" @click="showForm = true">Nova Configuração</button>
    </div>

    <div class="card">
      <div class="table-responsive">
        <table class="table table-hover mb-0">
          <thead class="table-light">
            <tr>
              <th>Operadora</th>
              <th>Label</th>
              <th>Tipo de Taxa</th>
              <th>Taxa %</th>
              <th>Taxa Fixa</th>
              <th>Prazo (D+N)</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="gw in gateways" :key="gw.id">
              <td><strong>{{ gw.provider }}</strong></td>
              <td>{{ gw.label || '-' }}</td>
              <td><span class="badge bg-secondary">{{ gw.feeType }}</span></td>
              <td>{{ Number(gw.feePercent) > 0 ? (Number(gw.feePercent) * 100).toFixed(1) + '%' : '-' }}</td>
              <td>{{ Number(gw.feeFixed) > 0 ? formatCurrency(gw.feeFixed) : '-' }}</td>
              <td>D+{{ gw.settlementDays || 0 }}</td>
              <td>
                <span :class="gw.isActive ? 'badge bg-success' : 'badge bg-danger'">
                  {{ gw.isActive ? 'Ativa' : 'Inativa' }}
                </span>
              </td>
              <td class="text-end">
                <button class="btn btn-sm btn-outline-primary me-1" @click="editGateway(gw)">Editar</button>
                <button class="btn btn-sm btn-outline-info me-1" @click="simulate(gw)">Simular</button>
              </td>
            </tr>
            <tr v-if="gateways.length === 0">
              <td colspan="8" class="text-center py-4 text-muted">Nenhuma operadora configurada.</td>
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
            <h5 class="modal-title">{{ editing ? 'Editar' : 'Nova' }} Configuração</h5>
            <button type="button" class="btn-close" @click="closeForm"></button>
          </div>
          <div class="modal-body">
            <div class="mb-3">
              <label class="form-label">Operadora</label>
              <SelectInput v-model="form.provider" :options="providerOptions" :disabled="!!editing" />
            </div>
            <div class="mb-3">
              <label class="form-label">Label (opcional)</label>
              <TextInput v-model="form.label" placeholder="Ex: iFood Entrega, Stone Crédito" />
            </div>
            <div class="mb-3">
              <label class="form-label">Tipo de Taxa</label>
              <SelectInput v-model="form.feeType" :options="feeTypeOptions" />
            </div>
            <div class="row g-2 mb-3">
              <div class="col-6">
                <label class="form-label">Taxa % (ex: 0.12 = 12%)</label>
                <input type="number" class="form-control" v-model.number="form.feePercent" step="0.001" min="0" max="1">
              </div>
              <div class="col-6">
                <label class="form-label">Taxa Fixa (R$)</label>
                <input type="number" class="form-control" v-model.number="form.feeFixed" step="0.01" min="0">
              </div>
            </div>
            <div class="row g-2 mb-3">
              <div class="col-6">
                <label class="form-label">Prazo (dias úteis)</label>
                <input type="number" class="form-control" v-model.number="form.settlementDays" min="0">
              </div>
              <div class="col-6">
                <label class="form-label">Taxa Antecipação % (opcional)</label>
                <input type="number" class="form-control" v-model.number="form.anticipationFeePercent" step="0.001" min="0" max="1">
              </div>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" @click="closeForm">Cancelar</button>
            <button class="btn btn-primary" @click="save" :disabled="saving">{{ saving ? 'Salvando...' : 'Salvar' }}</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Modal de simulação -->
    <div v-if="showSimulation" class="modal d-block" tabindex="-1" style="background: rgba(0,0,0,0.5)">
      <div class="modal-dialog">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">Simular Taxas - {{ simulationGateway?.provider }}</h5>
            <button type="button" class="btn-close" @click="showSimulation = false"></button>
          </div>
          <div class="modal-body">
            <div class="mb-3">
              <label class="form-label">Valor Bruto (R$)</label>
              <input type="number" class="form-control" v-model.number="simAmount" step="0.01" min="0">
            </div>
            <button class="btn btn-info mb-3" @click="runSimulation">Calcular</button>
            <div v-if="simResult" class="alert alert-light">
              <div><strong>Valor Bruto:</strong> {{ formatCurrency(simResult.breakdown?.grossAmount) }}</div>
              <div class="text-danger"><strong>Taxa:</strong> -{{ formatCurrency(simResult.feeAmount) }}</div>
              <div class="text-success fs-5"><strong>Valor Líquido:</strong> {{ formatCurrency(simResult.netAmount) }}</div>
              <div class="mt-2"><strong>Data de Recebimento:</strong> {{ formatDate(simResult.expectedDate) }}</div>
            </div>
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
  name: 'FinancialGateways',
  components: { TextInput, SelectInput },
  data() {
    return {
      gateways: [],
      showForm: false,
      editing: null,
      saving: false,
      form: this.emptyForm(),
      showSimulation: false,
      simulationGateway: null,
      simAmount: 100,
      simResult: null,
      providerOptions: [
        { value: 'IFOOD', label: 'iFood' }, { value: 'RAPPI', label: 'Rappi' },
        { value: 'UBER_EATS', label: 'Uber Eats' }, { value: 'STONE', label: 'Stone' },
        { value: 'CIELO', label: 'Cielo' }, { value: 'PAGSEGURO', label: 'PagSeguro' },
        { value: 'MERCADO_PAGO', label: 'Mercado Pago' }, { value: 'PIX_MANUAL', label: 'PIX (Manual)' },
        { value: 'OTHER', label: 'Outro' },
      ],
      feeTypeOptions: [
        { value: 'PERCENTAGE', label: 'Percentual' },
        { value: 'FIXED', label: 'Fixa' },
        { value: 'MIXED', label: 'Mista (% + Fixa)' },
      ],
    };
  },
  async mounted() {
    await this.load();
  },
  methods: {
    emptyForm() {
      return { provider: 'IFOOD', label: '', feeType: 'PERCENTAGE', feePercent: 0, feeFixed: 0, settlementDays: 0, anticipationFeePercent: null };
    },
    async load() {
      try {
        const { data } = await api.get('/financial/gateways');
        this.gateways = data;
      } catch (e) {
        console.error('Failed to load gateways:', e);
      }
    },
    editGateway(gw) {
      this.editing = gw.id;
      this.form = { provider: gw.provider, label: gw.label || '', feeType: gw.feeType, feePercent: Number(gw.feePercent), feeFixed: Number(gw.feeFixed), settlementDays: gw.settlementDays, anticipationFeePercent: gw.anticipationFeePercent };
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
          await api.put(`/financial/gateways/${this.editing}`, this.form);
        } else {
          await api.post('/financial/gateways', this.form);
        }
        this.closeForm();
        await this.load();
      } catch (e) {
        alert(e.response?.data?.message || 'Erro ao salvar');
      } finally {
        this.saving = false;
      }
    },
    simulate(gw) {
      this.simulationGateway = gw;
      this.simResult = null;
      this.simAmount = 100;
      this.showSimulation = true;
    },
    async runSimulation() {
      try {
        const { data } = await api.post('/financial/gateways/simulate', {
          gatewayConfigId: this.simulationGateway.id,
          grossAmount: this.simAmount,
        });
        this.simResult = data;
      } catch (e) {
        alert(e.response?.data?.message || 'Erro na simulação');
      }
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
