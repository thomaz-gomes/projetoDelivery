<script setup>
import { ref, onMounted } from 'vue';
import api from '../api';
import ListCard from '../components/ListCard.vue';

const rules = ref([]);
const shifts = ref([]);
const loading = ref(false);
const showModal = ref(false);
const editing = ref(null);
const form = ref({ name: '', type: 'EARLY_CHECKIN', deadlineTime: '', bonusAmount: '', shiftId: '' });

const typeLabels = { EARLY_CHECKIN: 'Check-in antecipado' };

function formatCurrency(value) {
  return 'R$ ' + Number(value).toFixed(2).replace('.', ',');
}

async function load() {
  loading.value = true;
  try {
    const [rulesRes, shiftsRes] = await Promise.all([
      api.get('/riders/bonus-rules'),
      api.get('/riders/shifts')
    ]);
    rules.value = rulesRes.data;
    shifts.value = shiftsRes.data.filter(s => s.active);
  } catch (e) { console.error(e); }
  finally { loading.value = false; }
}

function openCreate() {
  editing.value = null;
  form.value = { name: '', type: 'EARLY_CHECKIN', deadlineTime: '', bonusAmount: '', shiftId: '' };
  showModal.value = true;
}

function openEdit(r) {
  editing.value = r;
  form.value = { name: r.name, type: r.type, deadlineTime: r.deadlineTime, bonusAmount: r.bonusAmount, shiftId: r.shiftId || '' };
  showModal.value = true;
}

async function save() {
  const payload = { ...form.value, shiftId: form.value.shiftId || null, bonusAmount: Number(form.value.bonusAmount) };
  try {
    if (editing.value) {
      await api.patch(`/riders/bonus-rules/${editing.value.id}`, payload);
    } else {
      await api.post('/riders/bonus-rules', payload);
    }
    showModal.value = false;
    await load();
  } catch (e) { alert(e.response?.data?.message || 'Erro ao salvar'); }
}

async function remove(r) {
  if (!confirm(`Desativar regra "${r.name}"?`)) return;
  try {
    await api.delete(`/riders/bonus-rules/${r.id}`);
    await load();
  } catch (e) { alert(e.response?.data?.message || 'Erro ao desativar'); }
}

onMounted(load);
</script>

<template>
  <ListCard title="Regras de Bonus" icon="bi bi-trophy" subtitle="Gerencie regras de bonus para entregadores">
    <template #actions>
      <button class="btn btn-primary" @click="openCreate">
        <i class="bi bi-plus-lg me-1"></i> Nova Regra
      </button>
    </template>

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
              <th>Tipo</th>
              <th>Horario Limite</th>
              <th>Valor Bonus</th>
              <th>Turno</th>
              <th>Status</th>
              <th style="width: 150px">Acoes</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in rules" :key="r.id">
              <td>{{ r.name }}</td>
              <td>{{ typeLabels[r.type] || r.type }}</td>
              <td>{{ r.deadlineTime }}</td>
              <td>{{ formatCurrency(r.bonusAmount) }}</td>
              <td>{{ r.shift ? r.shift.name : 'Qualquer turno' }}</td>
              <td>
                <span :class="['badge', r.active ? 'bg-success' : 'bg-danger']">
                  {{ r.active ? 'Ativo' : 'Inativo' }}
                </span>
              </td>
              <td>
                <div class="d-flex gap-1">
                  <button class="btn btn-sm btn-outline-primary" @click="openEdit(r)" title="Editar">
                    <i class="bi bi-pencil"></i>
                  </button>
                  <button class="btn btn-sm btn-outline-danger" @click="remove(r)" title="Desativar" v-if="r.active">
                    <i class="bi bi-trash"></i>
                  </button>
                </div>
              </td>
            </tr>
            <tr v-if="rules.length === 0">
              <td colspan="7" class="text-center text-muted py-4">Nenhuma regra de bonus cadastrada.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </ListCard>

  <!-- Modal Create/Edit -->
  <div v-if="showModal" class="modal-backdrop fade show"></div>
  <div v-if="showModal" class="modal fade show d-block" tabindex="-1" @click.self="showModal = false">
    <div class="modal-dialog">
      <div class="modal-content">
        <div class="modal-header">
          <h5 class="modal-title">{{ editing ? 'Editar Regra' : 'Nova Regra de Bonus' }}</h5>
          <button type="button" class="btn-close" @click="showModal = false"></button>
        </div>
        <div class="modal-body">
          <div class="mb-3">
            <TextInput label="Nome" v-model="form.name" placeholder="Ex: Bonus check-in matutino" inputClass="form-control" />
          </div>
          <div class="mb-3">
            <label class="form-label">Tipo</label>
            <SelectInput class="form-select" v-model="form.type">
              <option value="EARLY_CHECKIN">Check-in antecipado</option>
            </SelectInput>
          </div>
          <div class="mb-3">
            <label class="form-label">Horario Limite</label>
            <input type="time" class="form-control" v-model="form.deadlineTime" />
          </div>
          <div class="mb-3">
            <label class="form-label">Valor Bonus</label>
            <div class="input-group">
              <span class="input-group-text">R$</span>
              <input type="number" step="0.01" min="0" class="form-control" v-model="form.bonusAmount" placeholder="0.00" />
            </div>
          </div>
          <div class="mb-3">
            <label class="form-label">Turno</label>
            <SelectInput class="form-select" v-model="form.shiftId">
              <option value="">Qualquer turno</option>
              <option v-for="s in shifts" :key="s.id" :value="s.id">{{ s.name }}</option>
            </SelectInput>
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" @click="showModal = false">Cancelar</button>
          <button type="button" class="btn btn-primary" @click="save">
            {{ editing ? 'Salvar' : 'Criar' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
