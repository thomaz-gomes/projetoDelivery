<template>
  <div class="container py-3">
    <div class="d-flex justify-content-between align-items-center mb-3">
      <h3>Taxas e Operadoras</h3>
      <div class="d-flex gap-2">
        <button class="btn btn-outline-warning" @click="checkRepair" :disabled="repairing">
          <i class="bi bi-wrench me-1"></i>Corrigir Taxas Antigas
        </button>
        <button class="btn btn-primary" @click="showForm = true">Nova Configuração</button>
      </div>
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
                <button class="btn btn-sm btn-outline-warning" :disabled="recreating" @click="recreate(gw)" title="Recriar lançamentos das vendas (apaga e regenera as receivables não pagas usando a config atual)">
                  <i class="bi bi-arrow-clockwise"></i>
                </button>
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
            <hr class="my-2"/>
            <h6 class="text-muted mb-2">Cronograma de Repasse</h6>
            <div class="mb-2">
              <label class="form-label">Tipo de cronograma</label>
              <select class="form-select" v-model="form.settlementType">
                <option value="DAILY">Diário (D+N dias úteis) — cartão / PIX</option>
                <option value="WEEKLY">Semanal (fecha em dia X, paga em dia Y)</option>
                <option value="MONTHLY">Mensal (N dias após venda + dia Y)</option>
              </select>
            </div>
            <div v-if="form.settlementType === 'DAILY'" class="mb-3">
              <label class="form-label">Prazo (dias úteis)</label>
              <input type="number" class="form-control" v-model.number="form.settlementDays" min="0">
              <small class="text-muted">Ex: 1 = D+1 (próximo dia útil), 30 = D+30</small>
            </div>
            <div v-if="form.settlementType === 'WEEKLY'" class="row g-2 mb-3">
              <div class="col-6">
                <label class="form-label">Início da semana</label>
                <select class="form-select" v-model.number="form.periodStartDayOfWeek">
                  <option v-for="d in DAYS_OF_WEEK" :key="d.value" :value="d.value">{{ d.label }}</option>
                </select>
              </div>
              <div class="col-6">
                <label class="form-label">Dia do repasse</label>
                <select class="form-select" v-model.number="form.settlementDayOfWeek">
                  <option v-for="d in DAYS_OF_WEEK" :key="d.value" :value="d.value">{{ d.label }}</option>
                </select>
              </div>
              <small class="text-muted">Ex: iFood semanal — início Segunda, repasse Quarta</small>
            </div>
            <div v-if="form.settlementType === 'MONTHLY'" class="row g-2 mb-3">
              <div class="col-6">
                <label class="form-label">Atraso (dias)</label>
                <input type="number" class="form-control" v-model.number="form.settlementMonthlyDelay" min="1">
              </div>
              <div class="col-6">
                <label class="form-label">Dia do repasse</label>
                <select class="form-select" v-model.number="form.settlementDayOfWeek">
                  <option v-for="d in DAYS_OF_WEEK" :key="d.value" :value="d.value">{{ d.label }}</option>
                </select>
              </div>
              <small class="text-muted">Ex: iFood mensal — 30 dias + próxima Quarta</small>
            </div>
            <hr class="my-2"/>
            <h6 class="text-muted mb-2">Antecipação Automática</h6>
            <div class="form-check form-switch mb-2">
              <input class="form-check-input" type="checkbox" id="anticipEnabled" v-model="form.anticipationEnabled">
              <label class="form-check-label" for="anticipEnabled">Antecipar automaticamente (cobra taxa adicional)</label>
            </div>
            <div v-if="form.anticipationEnabled" class="row g-2 mb-3">
              <div class="col-6">
                <label class="form-label">Taxa antecipação % (ex: 0.02 = 2%)</label>
                <input type="number" class="form-control" v-model.number="form.anticipationFeePercent" step="0.001" min="0" max="1">
              </div>
              <div class="col-6">
                <label class="form-label">Prazo antecipado (dias úteis)</label>
                <input type="number" class="form-control" v-model.number="form.anticipationDays" min="1">
                <small class="text-muted">Ex: 1 = D+1</small>
              </div>
            </div>

            <div v-if="editing" class="alert alert-warning small mb-0">
              <i class="bi bi-info-circle me-1"></i>
              Após mudar o cronograma, use o botão <strong>"Recriar lançamentos"</strong> na lista
              para refazer as receivables das vendas existentes (apenas as ainda não pagas).
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
      repairing: false,
      recreating: false,
      DAYS_OF_WEEK: [
        { value: 0, label: 'Domingo' }, { value: 1, label: 'Segunda' }, { value: 2, label: 'Terça' },
        { value: 3, label: 'Quarta' },  { value: 4, label: 'Quinta' },  { value: 5, label: 'Sexta' },
        { value: 6, label: 'Sábado' },
      ],
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
      return {
        provider: 'IFOOD', label: '', feeType: 'PERCENTAGE',
        feePercent: 0, feeFixed: 0,
        settlementDays: 0,
        settlementType: 'DAILY',
        settlementDayOfWeek: 3,        // quarta-feira
        periodStartDayOfWeek: 1,       // segunda-feira
        settlementMonthlyDelay: 30,
        anticipationEnabled: false,
        anticipationFeePercent: null,
        anticipationDays: 1,
      };
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
      this.form = {
        provider: gw.provider,
        label: gw.label || '',
        feeType: gw.feeType,
        feePercent: Number(gw.feePercent),
        feeFixed: Number(gw.feeFixed),
        settlementDays: gw.settlementDays || 0,
        settlementType: gw.settlementType || 'DAILY',
        settlementDayOfWeek: gw.settlementDayOfWeek != null ? Number(gw.settlementDayOfWeek) : 3,
        periodStartDayOfWeek: gw.periodStartDayOfWeek != null ? Number(gw.periodStartDayOfWeek) : 1,
        settlementMonthlyDelay: gw.settlementMonthlyDelay != null ? Number(gw.settlementMonthlyDelay) : 30,
        anticipationEnabled: Boolean(gw.anticipationEnabled),
        anticipationFeePercent: gw.anticipationFeePercent != null ? Number(gw.anticipationFeePercent) : null,
        anticipationDays: gw.anticipationDays != null ? Number(gw.anticipationDays) : 1,
      };
      this.showForm = true;
    },
    async recreate(gw) {
      const ok = window.confirm(
        `Recriar lançamentos de todas as vendas ${gw.provider}?\n\nVai apagar e regenerar as receivables (e taxas) das vendas CONCLUIDO usando a configuração atual. Vendas já conciliadas (PAID com paidAt) são ignoradas.`
      );
      if (!ok) return;
      this.recreating = true;
      try {
        const { data } = await api.post('/financial/settlements/recreate', { provider: gw.provider });
        alert(`Recriação concluída.\nPedidos verificados: ${data.totalOrders}\nRecriados: ${data.recreated}\nIgnorados: ${data.skipped}\nLançamentos apagados: ${data.deletedTransactions}`);
      } catch (e) {
        alert(e.response?.data?.message || 'Erro ao recriar lançamentos');
      } finally {
        this.recreating = false;
      }
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
    async checkRepair() {
      this.repairing = true;
      try {
        const { data: dry } = await api.post('/financial/gateways/repair-fee-percent', { dryRun: true });
        if (dry.gatewaysFixed === 0) {
          alert('Nenhuma operadora precisa de correção. Todas as taxas já estão no formato correto.');
          return;
        }
        const lines = dry.gateways
          .map((g) => `• ${g.provider}${g.label ? ` (${g.label})` : ''}: ${g.currentPercent} → ${g.fixedPercent} (${g.transactionCount} transação(ões))`)
          .join('\n');
        const ok = window.confirm(
          `Encontradas ${dry.gatewaysFixed} operadora(s) com taxa em formato incorreto:\n\n${lines}\n\nIsso recalculará ${dry.transactionsRecalculated} transação(ões) já lançadas. Confirma?`,
        );
        if (!ok) return;
        const { data: applied } = await api.post('/financial/gateways/repair-fee-percent', { dryRun: false });
        alert(`Corrigido com sucesso!\n${applied.gatewaysFixed} operadora(s) ajustada(s).\n${applied.transactionsRecalculated} transação(ões) recalculada(s).`);
        await this.load();
      } catch (e) {
        alert(e.response?.data?.message || 'Erro ao corrigir taxas');
      } finally {
        this.repairing = false;
      }
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
