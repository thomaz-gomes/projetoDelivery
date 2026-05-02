<template>
  <ListCard title="Check-ins de Motoboys" icon="bi bi-clock-history">
    <template #filters>
      <div class="row g-2 align-items-end">
        <div class="col-6 col-md-3">
          <label class="form-label small mb-1">De</label>
          <input type="date" class="form-control form-control-sm" v-model="filterFrom" />
        </div>
        <div class="col-6 col-md-3">
          <label class="form-label small mb-1">Até</label>
          <input type="date" class="form-control form-control-sm" v-model="filterTo" />
        </div>
        <div class="col-12 col-md-3">
          <label class="form-label small mb-1">Motoboy</label>
          <SelectInput v-model="filterRider" :options="riderOptions" placeholder="Todos" />
        </div>
        <div class="col-12 col-md-3">
          <button class="btn btn-primary btn-sm w-100" @click="load" :disabled="loading">
            <i class="bi bi-search me-1"></i>Buscar
          </button>
        </div>
      </div>
    </template>

    <div v-if="loading" class="text-center py-4">
      <div class="spinner-border spinner-border-sm text-primary" role="status"></div>
      <span class="ms-2 text-muted">Carregando...</span>
    </div>

    <div v-else-if="!checkins.length" class="text-center text-muted py-4">
      Nenhum check-in encontrado no período.
    </div>

    <div v-else class="table-responsive">
      <table class="table table-hover table-sm align-middle mb-0">
        <thead>
          <tr>
            <th>Motoboy</th>
            <th>Turno</th>
            <th>Check-in</th>
            <th>Check-out</th>
            <th>Endereço</th>
            <th>Distância</th>
            <th>Pontualidade</th>
            <th>Status Turno</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in checkins" :key="c.id">
            <td>{{ c.rider?.name || '-' }}</td>
            <td>{{ c.shift?.label || c.shift?.name || '-' }}</td>
            <td class="text-nowrap">{{ formatDate(c.checkinAt) }}</td>
            <td class="text-nowrap">{{ c.checkoutAt ? formatDate(c.checkoutAt) : '—' }}</td>
            <td class="small">{{ c.address || '-' }}</td>
            <td class="text-nowrap">{{ c.distanceMeters != null ? c.distanceMeters + 'm' : '-' }}</td>
            <td>
              <span v-if="isOnTime(c)" class="badge bg-success">No horário</span>
              <span v-else class="badge bg-danger">Atrasado</span>
            </td>
            <td>
              <span v-if="!c.checkoutAt" class="badge bg-warning text-dark d-flex align-items-center gap-1" style="width:fit-content">
                <span class="pulse-dot"></span>Em andamento
              </span>
              <span v-else class="badge bg-secondary">Encerrado</span>
            </td>
            <td class="text-end text-nowrap">
              <button
                v-if="!c.checkoutAt"
                class="btn btn-sm btn-outline-danger"
                :disabled="actionLoading === c.id"
                @click="closeShift(c)"
                title="Fechar turno"
              >
                <i class="bi bi-stop-circle me-1"></i>Fechar
              </button>
              <button
                v-else
                class="btn btn-sm btn-outline-secondary"
                :disabled="actionLoading === c.id"
                @click="reopenShift(c)"
                title="Reabrir turno"
              >
                <i class="bi bi-arrow-counterclockwise me-1"></i>Reabrir
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </ListCard>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import api from '../api';
import Swal from 'sweetalert2';
import ListCard from '../components/ListCard.vue';
import SelectInput from '../components/form/select/SelectInput.vue';

const checkins = ref([]);
const riders = ref([]);
const bonusRules = ref([]);
const loading = ref(false);
const actionLoading = ref(null);

// Filters — default to current month
const now = new Date();
const filterFrom = ref(new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10));
const filterTo = ref(now.toISOString().slice(0, 10));
const filterRider = ref('');

const riderOptions = computed(() =>
  [{ value: '', label: 'Todos' }].concat(
    riders.value.map(r => ({ value: r.id, label: r.name }))
  )
);

async function load() {
  loading.value = true;
  try {
    const params = {};
    if (filterFrom.value) params.from = filterFrom.value;
    if (filterTo.value) params.to = filterTo.value + 'T23:59:59';
    if (filterRider.value) params.riderId = filterRider.value;
    const [checkinsRes, ridersRes, rulesRes] = await Promise.all([
      api.get('/riders/checkins', { params }),
      api.get('/riders'),
      api.get('/riders/bonus-rules')
    ]);
    checkins.value = checkinsRes.data;
    riders.value = ridersRes.data;
    bonusRules.value = rulesRes.data.filter(r => r.active && r.type === 'EARLY_CHECKIN');
  } catch (e) {
    console.error(e);
  } finally {
    loading.value = false;
  }
}

async function closeShift(c) {
  const confirm = await Swal.fire({
    title: 'Fechar turno?',
    text: `Encerrar o turno de ${c.rider?.name || 'entregador'} agora?`,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: 'Fechar turno',
    confirmButtonColor: '#dc3545',
    cancelButtonText: 'Cancelar',
  });
  if (!confirm.isConfirmed) return;
  actionLoading.value = c.id;
  try {
    const { data } = await api.post(`/riders/checkins/${c.id}/checkout`);
    const idx = checkins.value.findIndex(x => x.id === c.id);
    if (idx >= 0) checkins.value.splice(idx, 1, { ...checkins.value[idx], checkoutAt: data.checkoutAt });
    Swal.fire({ icon: 'success', title: 'Turno encerrado', timer: 1200, showConfirmButton: false });
  } catch (e) {
    Swal.fire('Erro', e.response?.data?.message || 'Falha ao encerrar turno', 'error');
  } finally {
    actionLoading.value = null;
  }
}

async function reopenShift(c) {
  const confirm = await Swal.fire({
    title: 'Reabrir turno?',
    text: `Reabrir o turno de ${c.rider?.name || 'entregador'}?`,
    icon: 'question',
    showCancelButton: true,
    confirmButtonText: 'Reabrir',
    cancelButtonText: 'Cancelar',
  });
  if (!confirm.isConfirmed) return;
  actionLoading.value = c.id;
  try {
    const { data } = await api.post(`/riders/checkins/${c.id}/reopen`);
    const idx = checkins.value.findIndex(x => x.id === c.id);
    if (idx >= 0) checkins.value.splice(idx, 1, { ...checkins.value[idx], checkoutAt: data.checkoutAt });
    Swal.fire({ icon: 'success', title: 'Turno reaberto', timer: 1200, showConfirmButton: false });
  } catch (e) {
    Swal.fire('Erro', e.response?.data?.message || 'Falha ao reabrir turno', 'error');
  } finally {
    actionLoading.value = null;
  }
}

function isOnTime(checkin) {
  const d = new Date(checkin.checkinAt);
  const mins = d.getHours() * 60 + d.getMinutes();
  return bonusRules.value.some(rule => {
    if (rule.shiftId && checkin.shiftId !== rule.shiftId) return false;
    const [h, m] = rule.deadlineTime.split(':').map(Number);
    return mins <= h * 60 + m;
  });
}

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

onMounted(load);
</script>

<style scoped>
.pulse-dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #dc3545;
  animation: pulse 1.4s infinite;
}
@keyframes pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.4; transform: scale(0.7); }
}
</style>
