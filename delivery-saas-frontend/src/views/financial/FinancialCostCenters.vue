<template>
  <div class="container py-3">
    <div class="d-flex justify-content-between align-items-center mb-3">
      <h3>Centros de Custo (DRE)</h3>
      <div>
        <button class="btn btn-outline-success me-2" @click="seedDefault" v-if="centers.length === 0">
          Gerar Estrutura Padrão
        </button>
        <button class="btn btn-primary" @click="showForm = true">Novo Centro</button>
      </div>
    </div>

    <div class="card">
      <div class="table-responsive">
        <table class="table table-hover mb-0">
          <thead class="table-light">
            <tr>
              <th>Código</th>
              <th>Nome</th>
              <th>Grupo DRE</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="cc in centers" :key="cc.id" :class="{'fw-bold': !cc.parentId}">
              <td>{{ cc.code }}</td>
              <td :style="cc.parentId ? 'padding-left: 2rem' : ''">{{ cc.name }}</td>
              <td><span class="badge bg-light text-dark">{{ cc.dreGroup || '-' }}</span></td>
              <td>
                <span :class="cc.isActive ? 'badge bg-success' : 'badge bg-danger'">
                  {{ cc.isActive ? 'Ativo' : 'Inativo' }}
                </span>
              </td>
              <td class="text-end">
                <button class="btn btn-sm btn-outline-primary" @click="editCenter(cc)">Editar</button>
              </td>
            </tr>
            <tr v-if="centers.length === 0">
              <td colspan="5" class="text-center py-4 text-muted">
                Nenhum centro de custo. Clique em "Gerar Estrutura Padrão" para criar a estrutura DRE.
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
            <h5 class="modal-title">{{ editing ? 'Editar' : 'Novo' }} Centro de Custo</h5>
            <button type="button" class="btn-close" @click="closeForm"></button>
          </div>
          <div class="modal-body">
            <div class="mb-3">
              <label class="form-label">Código</label>
              <TextInput v-model="form.code" placeholder="Ex: 4.01" />
            </div>
            <div class="mb-3">
              <label class="form-label">Nome</label>
              <TextInput v-model="form.name" placeholder="Ex: Marketing e Publicidade" />
            </div>
            <div class="mb-3">
              <label class="form-label">Grupo DRE</label>
              <SelectInput v-model="form.dreGroup" :options="dreGroupOptions" placeholder="Selecionar" />
            </div>
            <div class="mb-3">
              <label class="form-label">Centro de Custo Pai</label>
              <SelectInput v-model="form.parentId" :options="parentOptions" optionValueKey="id" optionLabelKey="label" placeholder="Nenhum (raiz)" />
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
  name: 'FinancialCostCenters',
  components: { TextInput, SelectInput },
  data() {
    return {
      centers: [],
      showForm: false,
      editing: null,
      saving: false,
      form: { code: '', name: '', dreGroup: '', parentId: '' },
      dreGroupOptions: [
        { value: 'REVENUE', label: 'Receita' },
        { value: 'DEDUCTIONS', label: 'Deduções' },
        { value: 'COGS', label: 'CMV' },
        { value: 'OPEX', label: 'Despesas Operacionais' },
        { value: 'FINANCIAL', label: 'Resultado Financeiro' },
      ],
    };
  },
  computed: {
    parentOptions() {
      return this.centers.filter(c => !c.parentId).map(c => ({ id: c.id, label: `${c.code} - ${c.name}` }));
    },
  },
  async mounted() {
    await this.load();
  },
  methods: {
    async load() {
      try {
        const { data } = await api.get('/financial/cost-centers', { params: { flat: 'true' } });
        this.centers = data;
      } catch (e) {
        console.error('Failed to load cost centers:', e);
      }
    },
    editCenter(cc) {
      this.editing = cc.id;
      this.form = { code: cc.code, name: cc.name, dreGroup: cc.dreGroup || '', parentId: cc.parentId || '' };
      this.showForm = true;
    },
    closeForm() {
      this.showForm = false;
      this.editing = null;
      this.form = { code: '', name: '', dreGroup: '', parentId: '' };
    },
    async save() {
      this.saving = true;
      try {
        const payload = { ...this.form };
        if (!payload.parentId) payload.parentId = null;
        if (!payload.dreGroup) payload.dreGroup = null;
        if (this.editing) {
          await api.put(`/financial/cost-centers/${this.editing}`, payload);
        } else {
          await api.post('/financial/cost-centers', payload);
        }
        this.closeForm();
        await this.load();
      } catch (e) {
        alert(e.response?.data?.message || 'Erro ao salvar');
      } finally {
        this.saving = false;
      }
    },
    async seedDefault() {
      if (!confirm('Isso criará a estrutura DRE padrão com centros de custo pré-configurados. Continuar?')) return;
      try {
        await api.post('/financial/cost-centers/seed-default');
        await this.load();
      } catch (e) {
        alert(e.response?.data?.message || 'Erro ao gerar estrutura');
      }
    },
  },
};
</script>
