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
                <label class="form-label">Taxa % <span class="text-muted small">(ex: digite 12 para 12%)</span></label>
                <div class="input-group">
                  <input type="number" class="form-control" v-model.number="form.feePercentDisplay" step="0.01" min="0" max="100">
                  <span class="input-group-text">%</span>
                </div>
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
                <label class="form-label">Taxa antecipação % <span class="text-muted small">(ex: digite 1.5 para 1,5%)</span></label>
                <div class="input-group">
                  <input type="number" class="form-control" v-model.number="form.anticipationFeePercentDisplay" step="0.01" min="0" max="100">
                  <span class="input-group-text">%</span>
                </div>
                <small class="text-muted">Cobrada por venda no dia do repasse antecipado.</small>
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
import Swal from 'sweetalert2';
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
        feePercent: 0,                   // stored as fraction (0.12)
        feePercentDisplay: 0,            // shown as percentage (12)
        feeFixed: 0,
        settlementDays: 0,
        settlementType: 'DAILY',
        settlementDayOfWeek: 3,        // quarta-feira
        periodStartDayOfWeek: 1,       // segunda-feira
        settlementMonthlyDelay: 30,
        anticipationEnabled: false,
        anticipationFeePercent: null,         // fraction (0.015)
        anticipationFeePercentDisplay: null,  // percentage (1.5)
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
      const feePct = Number(gw.feePercent || 0);
      const antPct = gw.anticipationFeePercent != null ? Number(gw.anticipationFeePercent) : null;
      this.form = {
        provider: gw.provider,
        label: gw.label || '',
        feeType: gw.feeType,
        feePercent: feePct,
        feePercentDisplay: Math.round(feePct * 10000) / 100,        // 0.12 → 12.00
        feeFixed: Number(gw.feeFixed),
        settlementDays: gw.settlementDays || 0,
        settlementType: gw.settlementType || 'DAILY',
        settlementDayOfWeek: gw.settlementDayOfWeek != null ? Number(gw.settlementDayOfWeek) : 3,
        periodStartDayOfWeek: gw.periodStartDayOfWeek != null ? Number(gw.periodStartDayOfWeek) : 1,
        settlementMonthlyDelay: gw.settlementMonthlyDelay != null ? Number(gw.settlementMonthlyDelay) : 30,
        anticipationEnabled: Boolean(gw.anticipationEnabled),
        anticipationFeePercent: antPct,
        anticipationFeePercentDisplay: antPct != null ? Math.round(antPct * 10000) / 100 : null,  // 0.015 → 1.50
        anticipationDays: gw.anticipationDays != null ? Number(gw.anticipationDays) : 1,
      };
      this.showForm = true;
    },
    async recreate(gw) {
      const confirmed = await Swal.fire({
        icon: 'question',
        title: `Recriar lançamentos de ${gw.provider}?`,
        html: `Vai apagar e regenerar as receivables e taxas das vendas <strong>CONCLUIDO</strong> usando a configuração atual.<br><br>Vendas já conciliadas (PAID com paidAt) são ignoradas.`,
        showCancelButton: true,
        confirmButtonText: 'Recriar',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#ffc107',
      });
      if (!confirmed.isConfirmed) return;
      this.recreating = true;
      try {
        const { data } = await api.post('/financial/settlements/recreate', { provider: gw.provider });
        if (data.totalOrders === 0) {
          await Swal.fire({
            icon: 'warning',
            title: 'Nenhum pedido encontrado',
            html: `O sistema não identificou pedidos do ${gw.provider}.<br><br><small class="text-muted">Verifique se a integração está vinculada à empresa e se há pedidos com status CONCLUIDO.</small>`,
          });
        } else {
          const failed = Number(data.failed || 0);
          const errorsHtml = failed > 0 && Array.isArray(data.errors)
            ? `<hr><div class="text-start small text-danger"><strong>Primeiras falhas:</strong><ul>${data.errors.map(e => `<li><code>${e.orderId.slice(0, 8)}</code>: ${e.error}</li>`).join('')}</ul></div>`
            : '';
          await Swal.fire({
            icon: failed > 0 ? 'warning' : 'success',
            title: failed > 0 ? 'Recriação parcial' : 'Recriação concluída',
            html: `<div class="text-start small">
              Pedidos verificados: <strong>${data.totalOrders}</strong><br>
              Recriados: <strong class="text-success">${data.recreated}</strong><br>
              Ignorados (já conciliados): <strong class="text-muted">${data.skipped}</strong><br>
              ${failed > 0 ? `Falharam: <strong class="text-danger">${failed}</strong><br>` : ''}
              Lançamentos apagados: <strong>${data.deletedTransactions}</strong>
            </div>${errorsHtml}`,
            width: failed > 0 ? 600 : undefined,
          });
        }
      } catch (e) {
        const detail = e.response?.data?.message || e.response?.data?.error || e.message || 'Erro desconhecido';
        const code = e.response?.data?.code ? `<br><small class="text-muted">Código: <code>${e.response.data.code}</code></small>` : '';
        Swal.fire({
          icon: 'error',
          title: 'Erro ao recriar lançamentos',
          html: `<div class="text-start small">${detail}${code}</div>`,
          width: 600,
        });
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
        // Convert percentage display values back to the fraction format the
        // backend stores (e.g. user types 12 → save 0.12; types 1.5 → save 0.015).
        const payload = { ...this.form };
        const fp = Number(payload.feePercentDisplay);
        payload.feePercent = Number.isFinite(fp) ? Math.round(fp * 100) / 10000 : 0;
        if (payload.anticipationEnabled) {
          const ap = Number(payload.anticipationFeePercentDisplay);
          payload.anticipationFeePercent = Number.isFinite(ap) ? Math.round(ap * 100) / 10000 : null;
        } else {
          payload.anticipationFeePercent = null;
        }
        delete payload.feePercentDisplay;
        delete payload.anticipationFeePercentDisplay;

        if (this.editing) {
          await api.put(`/financial/gateways/${this.editing}`, payload);
        } else {
          await api.post('/financial/gateways', payload);
        }
        this.closeForm();
        await this.load();
      } catch (e) {
        Swal.fire({ icon: 'error', title: 'Erro', text: e.response?.data?.message || 'Erro ao salvar' });
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
          await Swal.fire({ icon: 'info', title: 'Tudo certo', text: 'Nenhuma operadora precisa de correção.' });
          return;
        }
        const linesHtml = dry.gateways
          .map((g) => `<li>${g.provider}${g.label ? ` (${g.label})` : ''}: <code>${g.currentPercent}</code> → <code>${g.fixedPercent}</code> (${g.transactionCount} transação(ões))</li>`)
          .join('');
        const confirmed = await Swal.fire({
          icon: 'warning',
          title: 'Corrigir taxas antigas?',
          html: `<div class="text-start small">Encontradas <strong>${dry.gatewaysFixed}</strong> operadora(s) com taxa em formato incorreto:<ul>${linesHtml}</ul>Isso recalculará <strong>${dry.transactionsRecalculated}</strong> transação(ões).</div>`,
          showCancelButton: true,
          confirmButtonText: 'Corrigir',
          cancelButtonText: 'Cancelar',
          confirmButtonColor: '#ffc107',
        });
        if (!confirmed.isConfirmed) return;
        const { data: applied } = await api.post('/financial/gateways/repair-fee-percent', { dryRun: false });
        await Swal.fire({
          icon: 'success',
          title: 'Corrigido com sucesso',
          html: `<div class="text-start small"><strong>${applied.gatewaysFixed}</strong> operadora(s) ajustada(s).<br><strong>${applied.transactionsRecalculated}</strong> transação(ões) recalculada(s).</div>`,
        });
        await this.load();
      } catch (e) {
        Swal.fire({ icon: 'error', title: 'Erro', text: e.response?.data?.message || 'Erro ao corrigir taxas' });
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
        Swal.fire({ icon: 'error', title: 'Erro', text: e.response?.data?.message || 'Erro na simulação' });
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
