<script setup>
import { ref, onMounted } from 'vue';
import api from '../api';
import ListCard from '../components/ListCard.vue';

const shifts = ref([]);
const loading = ref(false);
const showModal = ref(false);
const editing = ref(null);
const form = ref({ name: '', startTime: '', endTime: '' });

async function load() {
  loading.value = true;
  try {
    const { data } = await api.get('/riders/shifts');
    shifts.value = data;
  } catch (e) { console.error(e); }
  finally { loading.value = false; }
}

function openCreate() {
  editing.value = null;
  form.value = { name: '', startTime: '', endTime: '' };
  showModal.value = true;
}

function openEdit(s) {
  editing.value = s;
  form.value = { name: s.name, startTime: s.startTime, endTime: s.endTime };
  showModal.value = true;
}

async function save() {
  try {
    if (editing.value) {
      await api.patch(`/riders/shifts/${editing.value.id}`, form.value);
    } else {
      await api.post('/riders/shifts', form.value);
    }
    showModal.value = false;
    await load();
  } catch (e) { alert(e.response?.data?.message || 'Erro ao salvar'); }
}

async function remove(s) {
  if (!confirm(`Desativar turno "${s.name}"?`)) return;
  try {
    await api.delete(`/riders/shifts/${s.id}`);
    await load();
  } catch (e) { alert(e.response?.data?.message || 'Erro ao desativar'); }
}

onMounted(load);
</script>

<template>
  <ListCard title="Turnos de Entregadores" icon="bi bi-clock-history" :subtitle="shifts.length ? `${shifts.length} turnos` : ''">
    <template #actions>
      <button class="btn btn-primary" @click="openCreate"><i class="bi bi-plus-lg me-1"></i> Novo turno</button>
    </template>

    <template #default>
      <div v-if="loading" class="text-center py-4">Carregando...</div>
      <div v-else>
        <div class="table-responsive">
          <table class="table table-striped align-middle">
            <thead>
              <tr>
                <th>Nome</th>
                <th>Inicio</th>
                <th>Fim</th>
                <th>Status</th>
                <th style="width:120px">Acoes</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="s in shifts" :key="s.id">
                <td><strong>{{ s.name }}</strong></td>
                <td>{{ s.startTime }}</td>
                <td>{{ s.endTime }}</td>
                <td>
                  <span v-if="s.active !== false" class="badge bg-success">Ativo</span>
                  <span v-else class="badge bg-danger">Inativo</span>
                </td>
                <td>
                  <div class="d-flex">
                    <button class="btn btn-sm btn-outline-secondary me-2" @click="openEdit(s)"><i class="bi bi-pencil-square"></i></button>
                    <button class="btn btn-sm btn-outline-danger" @click="remove(s)"><i class="bi bi-trash"></i></button>
                  </div>
                </td>
              </tr>
              <tr v-if="shifts.length === 0">
                <td colspan="5" class="text-center text-secondary py-4">Nenhum turno cadastrado.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </ListCard>

  <!-- Create/Edit Modal -->
  <div v-if="showModal" class="modal-backdrop fade show"></div>
  <div v-if="showModal" class="modal fade show d-block" tabindex="-1" @click.self="showModal = false">
    <div class="modal-dialog">
      <div class="modal-content">
        <div class="modal-header">
          <h5 class="modal-title">{{ editing ? 'Editar Turno' : 'Novo Turno' }}</h5>
          <button type="button" class="btn-close" @click="showModal = false"></button>
        </div>
        <div class="modal-body">
          <div class="mb-3">
            <label class="form-label">Nome</label>
            <TextInput v-model="form.name" placeholder="Ex: Turno da Manha" />
          </div>
          <div class="mb-3">
            <label class="form-label">Horario de Inicio</label>
            <input type="time" class="form-control" v-model="form.startTime" />
          </div>
          <div class="mb-3">
            <label class="form-label">Horario de Fim</label>
            <input type="time" class="form-control" v-model="form.endTime" />
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" @click="showModal = false">Cancelar</button>
          <button type="button" class="btn btn-primary" @click="save">Salvar</button>
        </div>
      </div>
    </div>
  </div>
</template>
