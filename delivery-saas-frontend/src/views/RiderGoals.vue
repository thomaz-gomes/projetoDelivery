<script setup>
import { ref, computed, onMounted } from 'vue';
import api from '../api';
import ListCard from '../components/ListCard.vue';
import TextInput from '../components/form/input/TextInput.vue';
import SelectInput from '../components/form/select/SelectInput.vue';

const goals = ref([]);
const riders = ref([]);
const achievements = ref([]);
const loading = ref(false);
const loadingAchievements = ref(false);
const showModal = ref(false);
const editing = ref(null);
const saving = ref(false);
const activeTab = ref('goals');

const filters = ref({ scope: '', ruleType: '', active: '' });

const ruleTypeLabels = {
  DELIVERY_COUNT: 'Numero de Entregas',
  AVG_DELIVERY_TIME: 'Tempo Medio de Entrega',
  CANCELLATION_RATE: 'Taxa de Cancelamento',
  CODE_COMPLETION_RATE: 'Taxa de Codigo iFood',
  CONSECUTIVE_CHECKINS: 'Check-ins Consecutivos',
};

const operatorLabels = {
  LTE: '\u2264 Menor ou igual',
  GTE: '\u2265 Maior ou igual',
};

const periodLabels = {
  MONTHLY: 'Mensal',
  WEEKLY: 'Semanal',
  FIXED: 'Fixo',
};

const rewardTypeLabels = {
  MONEY: 'Dinheiro',
  CUSTOM: 'Personalizado',
  MONEY_AND_CUSTOM: 'Dinheiro + Personalizado',
};

const defaultForm = () => ({
  name: '',
  description: '',
  ruleType: 'DELIVERY_COUNT',
  ruleOperator: 'GTE',
  ruleValue: '',
  scope: 'GLOBAL',
  periodType: 'MONTHLY',
  startDate: '',
  endDate: '',
  rewardType: 'MONEY',
  rewardAmount: '',
  rewardDescription: '',
  autoApprove: true,
  riderIds: [],
});

const form = ref(defaultForm());

function formatCurrency(value) {
  if (value == null) return '';
  return 'R$ ' + Number(value).toFixed(2).replace('.', ',');
}

function formatDate(d) {
  if (!d) return '-';
  const dt = new Date(d);
  return dt.toLocaleDateString('pt-BR');
}

const filteredGoals = computed(() => {
  return goals.value.filter(g => {
    if (filters.value.scope && g.scope !== filters.value.scope) return false;
    if (filters.value.ruleType && g.ruleType !== filters.value.ruleType) return false;
    if (filters.value.active === 'true' && !g.active) return false;
    if (filters.value.active === 'false' && g.active) return false;
    return true;
  });
});

async function load() {
  loading.value = true;
  try {
    const [goalsRes, ridersRes] = await Promise.all([
      api.get('/riders/goals'),
      api.get('/riders'),
    ]);
    goals.value = goalsRes.data;
    riders.value = ridersRes.data;
  } catch (e) {
    console.error(e);
  } finally {
    loading.value = false;
  }
}

async function loadAchievements() {
  loadingAchievements.value = true;
  try {
    const res = await api.get('/riders/goals/achievements', { params: { status: 'PENDING_APPROVAL' } });
    achievements.value = res.data;
  } catch (e) {
    console.error(e);
  } finally {
    loadingAchievements.value = false;
  }
}

function onTabChange(tab) {
  activeTab.value = tab;
  if (tab === 'approvals') {
    loadAchievements();
  }
}

function openCreate() {
  editing.value = null;
  form.value = defaultForm();
  showModal.value = true;
}

function openEdit(g) {
  editing.value = g;
  form.value = {
    name: g.name,
    description: g.description || '',
    ruleType: g.ruleType,
    ruleOperator: g.ruleOperator,
    ruleValue: g.ruleValue,
    scope: g.scope,
    periodType: g.periodType,
    startDate: g.startDate ? g.startDate.substring(0, 10) : '',
    endDate: g.endDate ? g.endDate.substring(0, 10) : '',
    rewardType: g.rewardType,
    rewardAmount: g.rewardAmount || '',
    rewardDescription: g.rewardDescription || '',
    autoApprove: g.autoApprove,
    riderIds: (g.assignments || []).map(a => a.rider?.id).filter(Boolean),
  };
  showModal.value = true;
}

async function save() {
  saving.value = true;
  const payload = {
    name: form.value.name,
    description: form.value.description || null,
    ruleType: form.value.ruleType,
    ruleOperator: form.value.ruleOperator,
    ruleValue: Number(form.value.ruleValue),
    scope: form.value.scope,
    periodType: form.value.periodType,
    startDate: form.value.startDate || null,
    endDate: form.value.periodType === 'FIXED' ? (form.value.endDate || null) : null,
    rewardType: form.value.rewardType,
    rewardAmount: ['MONEY', 'MONEY_AND_CUSTOM'].includes(form.value.rewardType) ? Number(form.value.rewardAmount) : null,
    rewardDescription: ['CUSTOM', 'MONEY_AND_CUSTOM'].includes(form.value.rewardType) ? (form.value.rewardDescription || null) : null,
    autoApprove: form.value.autoApprove,
  };
  try {
    let goalId;
    if (editing.value) {
      await api.put(`/riders/goals/${editing.value.id}`, payload);
      goalId = editing.value.id;
    } else {
      const res = await api.post('/riders/goals', payload);
      goalId = res.data.id;
    }
    // Assign riders if scope is INDIVIDUAL
    if (form.value.scope === 'INDIVIDUAL' && form.value.riderIds.length > 0) {
      await api.post(`/riders/goals/${goalId}/assign`, { riderIds: form.value.riderIds });
    }
    showModal.value = false;
    await load();
  } catch (e) {
    alert(e.response?.data?.message || 'Erro ao salvar');
  } finally {
    saving.value = false;
  }
}

async function deactivate(g) {
  if (!confirm(`Desativar meta "${g.name}"?`)) return;
  try {
    await api.delete(`/riders/goals/${g.id}`);
    await load();
  } catch (e) {
    alert(e.response?.data?.message || 'Erro ao desativar');
  }
}

async function approveAchievement(a) {
  try {
    await api.put(`/riders/goals/achievements/${a.id}/approve`);
    achievements.value = achievements.value.filter(x => x.id !== a.id);
  } catch (e) {
    alert(e.response?.data?.message || 'Erro ao aprovar');
  }
}

async function rejectAchievement(a) {
  try {
    await api.put(`/riders/goals/achievements/${a.id}/reject`);
    achievements.value = achievements.value.filter(x => x.id !== a.id);
  } catch (e) {
    alert(e.response?.data?.message || 'Erro ao rejeitar');
  }
}

function toggleRider(riderId) {
  const idx = form.value.riderIds.indexOf(riderId);
  if (idx === -1) {
    form.value.riderIds.push(riderId);
  } else {
    form.value.riderIds.splice(idx, 1);
  }
}

onMounted(load);
</script>

<template>
  <ListCard title="Metas de Entregadores" icon="bi bi-bullseye" subtitle="Gerencie metas e aprovacoes de conquistas">
    <template #actions>
      <button class="btn btn-primary" @click="openCreate" v-if="activeTab === 'goals'">
        <i class="bi bi-plus-lg me-1"></i> Nova Meta
      </button>
    </template>

    <!-- Tabs -->
    <ul class="nav nav-tabs mb-3">
      <li class="nav-item">
        <a class="nav-link" :class="{ active: activeTab === 'goals' }" href="#" @click.prevent="onTabChange('goals')">
          Metas
        </a>
      </li>
      <li class="nav-item">
        <a class="nav-link" :class="{ active: activeTab === 'approvals' }" href="#" @click.prevent="onTabChange('approvals')">
          Aprovacoes Pendentes
          <span v-if="achievements.length" class="badge bg-danger ms-1">{{ achievements.length }}</span>
        </a>
      </li>
    </ul>

    <!-- Tab 1: Goals -->
    <div v-if="activeTab === 'goals'">
      <!-- Filters -->
      <div class="d-flex flex-wrap gap-2 mb-3">
        <SelectInput v-model="filters.scope" inputClass="form-select-sm" style="width: 160px">
          <option value="">Todos escopos</option>
          <option value="GLOBAL">Global</option>
          <option value="INDIVIDUAL">Individual</option>
        </SelectInput>
        <SelectInput v-model="filters.ruleType" inputClass="form-select-sm" style="width: 200px">
          <option value="">Todos tipos de regra</option>
          <option v-for="(label, key) in ruleTypeLabels" :key="key" :value="key">{{ label }}</option>
        </SelectInput>
        <SelectInput v-model="filters.active" inputClass="form-select-sm" style="width: 130px">
          <option value="">Todos status</option>
          <option value="true">Ativo</option>
          <option value="false">Inativo</option>
        </SelectInput>
      </div>

      <div v-if="loading" class="text-center py-4">
        <div class="spinner-border spinner-border-sm text-primary" role="status"></div>
        <span class="ms-2 text-muted">Carregando...</span>
      </div>

      <div v-else>
        <div class="table-responsive">
          <table class="table table-sm mb-0">
            <thead class="table-light">
              <tr>
                <th>Nome</th>
                <th>Tipo de Regra</th>
                <th>Escopo</th>
                <th>Periodo</th>
                <th>Premio</th>
                <th>Conquistas</th>
                <th>Ativo</th>
                <th style="width: 120px">Acoes</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="g in filteredGoals" :key="g.id">
                <td>{{ g.name }}</td>
                <td>
                  <span class="badge bg-secondary">{{ ruleTypeLabels[g.ruleType] || g.ruleType }}</span>
                </td>
                <td>
                  <span :class="['badge', g.scope === 'GLOBAL' ? 'bg-primary' : 'bg-info']">
                    {{ g.scope }}
                  </span>
                </td>
                <td>{{ periodLabels[g.periodType] || g.periodType }}</td>
                <td>
                  <span v-if="g.rewardAmount">{{ formatCurrency(g.rewardAmount) }}</span>
                  <span v-if="g.rewardAmount && g.rewardDescription"> + </span>
                  <span v-if="g.rewardDescription">{{ g.rewardDescription }}</span>
                  <span v-if="!g.rewardAmount && !g.rewardDescription" class="text-muted">-</span>
                </td>
                <td>
                  <span class="badge bg-light text-dark">{{ g._count?.achievements || 0 }}</span>
                </td>
                <td>
                  <span :class="['badge', g.active ? 'bg-success' : 'bg-danger']">
                    {{ g.active ? 'Ativo' : 'Inativo' }}
                  </span>
                </td>
                <td>
                  <div class="d-flex gap-1">
                    <button class="btn btn-sm btn-outline-primary" @click="openEdit(g)" title="Editar">
                      <i class="bi bi-pencil"></i>
                    </button>
                    <button class="btn btn-sm btn-outline-danger" @click="deactivate(g)" title="Desativar" v-if="g.active">
                      <i class="bi bi-x-circle"></i>
                    </button>
                  </div>
                </td>
              </tr>
              <tr v-if="filteredGoals.length === 0">
                <td colspan="8" class="text-center text-muted py-4">Nenhuma meta encontrada.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Tab 2: Pending Approvals -->
    <div v-if="activeTab === 'approvals'">
      <div v-if="loadingAchievements" class="text-center py-4">
        <div class="spinner-border spinner-border-sm text-primary" role="status"></div>
        <span class="ms-2 text-muted">Carregando...</span>
      </div>

      <div v-else>
        <div class="table-responsive">
          <table class="table table-sm mb-0">
            <thead class="table-light">
              <tr>
                <th>Entregador</th>
                <th>Meta</th>
                <th>Ciclo</th>
                <th>Premio</th>
                <th style="width: 140px">Acoes</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="a in achievements" :key="a.id">
                <td>{{ a.rider?.name || '-' }}</td>
                <td>{{ a.goal?.name || '-' }}</td>
                <td>{{ formatDate(a.cycleStart) }} - {{ formatDate(a.cycleEnd) }}</td>
                <td>
                  <span v-if="a.goal?.rewardAmount">{{ formatCurrency(a.goal.rewardAmount) }}</span>
                  <span v-if="a.goal?.rewardDescription" class="ms-1">{{ a.goal.rewardDescription }}</span>
                </td>
                <td>
                  <div class="d-flex gap-1">
                    <button class="btn btn-sm btn-success" @click="approveAchievement(a)" title="Aprovar">
                      <i class="bi bi-check-lg"></i>
                    </button>
                    <button class="btn btn-sm btn-danger" @click="rejectAchievement(a)" title="Rejeitar">
                      <i class="bi bi-x-lg"></i>
                    </button>
                  </div>
                </td>
              </tr>
              <tr v-if="achievements.length === 0">
                <td colspan="5" class="text-center text-muted py-4">Nenhuma aprovacao pendente.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </ListCard>

  <!-- Modal Create/Edit -->
  <div v-if="showModal" class="modal-backdrop fade show"></div>
  <div v-if="showModal" class="modal fade show d-block" tabindex="-1" @click.self="showModal = false">
    <div class="modal-dialog modal-lg">
      <div class="modal-content">
        <div class="modal-header">
          <h5 class="modal-title">{{ editing ? 'Editar Meta' : 'Nova Meta' }}</h5>
          <button type="button" class="btn-close" @click="showModal = false"></button>
        </div>
        <div class="modal-body">
          <div class="row">
            <!-- Nome -->
            <div class="col-12 mb-3">
              <TextInput label="Nome" v-model="form.name" placeholder="Ex: Velocista do Mes" required />
            </div>

            <!-- Descricao -->
            <div class="col-12 mb-3">
              <label class="form-label"><strong>Descricao</strong></label>
              <textarea class="form-control" v-model="form.description" rows="2" placeholder="Descricao opcional da meta"></textarea>
            </div>

            <!-- Tipo de Regra -->
            <div class="col-md-4 mb-3">
              <label class="form-label"><strong>Tipo de Regra</strong></label>
              <SelectInput v-model="form.ruleType">
                <option v-for="(label, key) in ruleTypeLabels" :key="key" :value="key">{{ label }}</option>
              </SelectInput>
            </div>

            <!-- Operador -->
            <div class="col-md-4 mb-3">
              <label class="form-label"><strong>Operador</strong></label>
              <SelectInput v-model="form.ruleOperator">
                <option v-for="(label, key) in operatorLabels" :key="key" :value="key">{{ label }}</option>
              </SelectInput>
            </div>

            <!-- Valor Alvo -->
            <div class="col-md-4 mb-3">
              <TextInput label="Valor Alvo" type="number" v-model="form.ruleValue" placeholder="0" required />
            </div>

            <!-- Escopo -->
            <div class="col-md-6 mb-3">
              <label class="form-label"><strong>Escopo</strong></label>
              <SelectInput v-model="form.scope">
                <option value="GLOBAL">Global</option>
                <option value="INDIVIDUAL">Individual</option>
              </SelectInput>
            </div>

            <!-- Periodo -->
            <div class="col-md-6 mb-3">
              <label class="form-label"><strong>Periodo</strong></label>
              <SelectInput v-model="form.periodType">
                <option value="MONTHLY">Mensal</option>
                <option value="WEEKLY">Semanal</option>
                <option value="FIXED">Fixo</option>
              </SelectInput>
            </div>

            <!-- Entregadores (only for INDIVIDUAL scope) -->
            <div v-if="form.scope === 'INDIVIDUAL'" class="col-12 mb-3">
              <label class="form-label"><strong>Entregadores</strong></label>
              <div class="border rounded p-2" style="max-height: 200px; overflow-y: auto">
                <div v-for="r in riders" :key="r.id" class="form-check">
                  <input
                    class="form-check-input"
                    type="checkbox"
                    :id="'rider-' + r.id"
                    :checked="form.riderIds.includes(r.id)"
                    @change="toggleRider(r.id)"
                  />
                  <label class="form-check-label" :for="'rider-' + r.id">{{ r.name }}</label>
                </div>
                <div v-if="riders.length === 0" class="text-muted small">Nenhum entregador cadastrado.</div>
              </div>
            </div>

            <!-- Data Inicio -->
            <div class="col-md-6 mb-3">
              <label class="form-label"><strong>Data Inicio</strong></label>
              <input type="date" class="form-control" v-model="form.startDate" />
            </div>

            <!-- Data Fim (only for FIXED period) -->
            <div v-if="form.periodType === 'FIXED'" class="col-md-6 mb-3">
              <label class="form-label"><strong>Data Fim</strong></label>
              <input type="date" class="form-control" v-model="form.endDate" />
            </div>

            <!-- Tipo de Premio -->
            <div class="col-md-4 mb-3">
              <label class="form-label"><strong>Tipo de Premio</strong></label>
              <SelectInput v-model="form.rewardType">
                <option value="MONEY">Dinheiro</option>
                <option value="CUSTOM">Personalizado</option>
                <option value="MONEY_AND_CUSTOM">Dinheiro + Personalizado</option>
              </SelectInput>
            </div>

            <!-- Valor R$ -->
            <div v-if="form.rewardType === 'MONEY' || form.rewardType === 'MONEY_AND_CUSTOM'" class="col-md-4 mb-3">
              <label class="form-label"><strong>Valor R$</strong></label>
              <div class="input-group">
                <span class="input-group-text">R$</span>
                <input type="number" step="0.01" min="0" class="form-control" v-model="form.rewardAmount" placeholder="0.00" />
              </div>
            </div>

            <!-- Descricao do Premio -->
            <div v-if="form.rewardType === 'CUSTOM' || form.rewardType === 'MONEY_AND_CUSTOM'" class="col-md-4 mb-3">
              <TextInput label="Descricao do Premio" v-model="form.rewardDescription" placeholder="Ex: Camiseta especial" />
            </div>

            <!-- Auto Approve -->
            <div class="col-12 mb-3">
              <div class="form-check form-switch">
                <input class="form-check-input" type="checkbox" id="autoApprove" v-model="form.autoApprove" />
                <label class="form-check-label" for="autoApprove">Aprovar automaticamente quando atingir a meta</label>
              </div>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" @click="showModal = false">Cancelar</button>
          <button type="button" class="btn btn-primary" @click="save" :disabled="saving">
            <span v-if="saving" class="spinner-border spinner-border-sm me-1"></span>
            {{ editing ? 'Salvar' : 'Criar' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
