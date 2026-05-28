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
        <div class="col-12 col-md-2">
          <label class="form-label small mb-1">Motoboy</label>
          <SelectInput v-model="filterRider" :options="riderOptions" placeholder="Todos" />
        </div>
        <div class="col-6 col-md-2">
          <button class="btn btn-primary btn-sm w-100" @click="load" :disabled="loading">
            <i class="bi bi-search me-1"></i>Buscar
          </button>
        </div>
        <div class="col-6 col-md-2">
          <button class="btn btn-success btn-sm w-100" @click="openManualCheckin">
            <i class="bi bi-plus-circle me-1"></i>Check-in manual
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

    <!-- Modal: check-in manual -->
    <div v-if="showManualModal" class="modal d-block" tabindex="-1" style="background: rgba(0,0,0,0.5)">
      <div class="modal-dialog">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">Check-in manual</h5>
            <button type="button" class="btn-close" @click="closeManualModal"></button>
          </div>
          <div class="modal-body">
            <p class="small text-muted mb-3">
              Lança um check-in agora mesmo em nome do motoboy, sem validação de localização.
              Útil quando o motoboy chegou ao ponto mas não conseguiu fazer check-in pelo app.
            </p>

            <div class="mb-3">
              <label class="form-label">Motoboy</label>
              <SelectInput
                v-model="manualForm.riderId"
                :options="riders.map(r => ({ value: r.id, label: r.name }))"
                placeholder="Selecione o motoboy"
              />
            </div>

            <div class="mb-3">
              <label class="form-label">Turno</label>
              <div v-if="loadingShifts" class="text-muted small py-2">
                <span class="spinner-border spinner-border-sm me-2"></span>Carregando turnos...
              </div>
              <div v-else-if="!manualForm.riderId" class="text-muted small">
                Selecione um motoboy para listar os turnos atribuídos.
              </div>
              <div v-else-if="!riderShifts.length" class="alert alert-warning small mb-0">
                Este motoboy não tem nenhum turno atribuído. Atribua um turno em
                <router-link to="/settings/rider-shifts">Configurações → Turnos</router-link>.
              </div>
              <div v-else-if="riderShifts.length === 1" class="form-control bg-light">
                {{ riderShifts[0].name }}
                <span class="text-muted small">({{ riderShifts[0].startTime }} – {{ riderShifts[0].endTime }})</span>
              </div>
              <SelectInput
                v-else
                v-model="manualForm.shiftId"
                :options="riderShifts.map(s => ({ value: s.id, label: `${s.name} (${s.startTime} – ${s.endTime})` }))"
                placeholder="Selecione o turno"
              />
            </div>

            <div class="mb-3">
              <label class="form-label">Observação (opcional)</label>
              <input
                type="text"
                class="form-control"
                v-model="manualForm.note"
                placeholder="Ex: motoboy sem internet"
                maxlength="200"
              />
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" @click="closeManualModal">Cancelar</button>
            <button
              class="btn btn-primary"
              @click="submitManualCheckin"
              :disabled="manualSaving || !canSubmitManual"
            >
              {{ manualSaving ? 'Lançando...' : 'Lançar check-in' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </ListCard>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import api from '../api';
import Swal from 'sweetalert2';
import { localDateKey } from '../utils/dates';
import ListCard from '../components/ListCard.vue';
import SelectInput from '../components/form/select/SelectInput.vue';

const checkins = ref([]);
const riders = ref([]);
const bonusRules = ref([]);
const loading = ref(false);
const actionLoading = ref(null);

// Filters — default to current month
const now = new Date();
const filterFrom = ref(localDateKey(new Date(now.getFullYear(), now.getMonth(), 1)));
const filterTo = ref(localDateKey(now));
const filterRider = ref('');

const riderOptions = computed(() =>
  [{ value: '', label: 'Todos' }].concat(
    riders.value.map(r => ({ value: r.id, label: r.name }))
  )
);

// Manual check-in modal
const showManualModal = ref(false);
const manualSaving = ref(false);
const loadingShifts = ref(false);
const riderShifts = ref([]); // turnos atribuídos ao motoboy selecionado
const manualForm = ref({ riderId: '', shiftId: '', note: '' });

// Habilita "Lançar check-in" só quando os campos obrigatórios estão preenchidos.
// Quando há exatamente 1 turno atribuído, ele é resolvido em submitManualCheckin
// (não exige selecionar manualmente no dropdown).
const canSubmitManual = computed(() => {
  if (!manualForm.value.riderId) return false;
  if (loadingShifts.value) return false;
  if (riderShifts.value.length === 0) return false;
  if (riderShifts.value.length > 1 && !manualForm.value.shiftId) return false;
  return true;
});

function openManualCheckin() {
  manualForm.value = { riderId: filterRider.value || '', shiftId: '', note: '' };
  riderShifts.value = [];
  showManualModal.value = true;
  if (manualForm.value.riderId) loadRiderShifts(manualForm.value.riderId);
}

function closeManualModal() {
  showManualModal.value = false;
  manualForm.value = { riderId: '', shiftId: '', note: '' };
  riderShifts.value = [];
}

async function loadRiderShifts(riderId) {
  if (!riderId) {
    riderShifts.value = [];
    return;
  }
  loadingShifts.value = true;
  try {
    const { data } = await api.get(`/riders/${riderId}/shifts`);
    const active = Array.isArray(data) ? data.filter(s => s.active !== false) : [];
    riderShifts.value = active;
    // Auto-seleciona quando há apenas um turno disponível.
    manualForm.value.shiftId = active.length === 1 ? active[0].id : '';
  } catch (e) {
    console.error('loadRiderShifts failed', e);
    riderShifts.value = [];
  } finally {
    loadingShifts.value = false;
  }
}

// Recarregar turnos sempre que o motoboy mudar no modal.
watch(() => manualForm.value.riderId, (newId) => {
  if (showManualModal.value) loadRiderShifts(newId);
});

async function submitManualCheckin() {
  if (!canSubmitManual.value) return;
  const riderId = manualForm.value.riderId;
  const shiftId = manualForm.value.shiftId
    || (riderShifts.value.length === 1 ? riderShifts.value[0].id : null);
  if (!shiftId) {
    Swal.fire({ icon: 'warning', text: 'Selecione um turno' });
    return;
  }
  manualSaving.value = true;
  try {
    await api.post(`/riders/${riderId}/manual-checkin`, {
      shiftId,
      note: manualForm.value.note || undefined,
    });
    closeManualModal();
    Swal.fire({
      icon: 'success',
      title: 'Check-in lançado',
      timer: 1500,
      showConfirmButton: false,
    });
    await load();
  } catch (e) {
    console.error('submitManualCheckin failed', e);
    Swal.fire({
      icon: 'error',
      text: e.response?.data?.message || 'Falha ao lançar check-in',
    });
  } finally {
    manualSaving.value = false;
  }
}

async function load() {
  loading.value = true;
  try {
    const params = {};
    if (filterFrom.value) params.from = filterFrom.value;
    // Send plain YYYY-MM-DD; backend resolves end-of-day in BRT.
    if (filterTo.value) params.to = filterTo.value;
    if (filterRider.value) params.riderId = filterRider.value;
    const requests = [api.get('/riders/checkins', { params })];
    // Reference data only needs to load once; subsequent filter changes
    // shouldn't refetch the rider list (it was overwriting riderOptions
    // mid-flow and could reset the dropdown selection).
    if (!riders.value.length) requests.push(api.get('/riders'));
    if (!bonusRules.value.length) requests.push(api.get('/riders/bonus-rules'));
    const responses = await Promise.all(requests);
    checkins.value = responses[0].data;
    let i = 1;
    if (!riders.value.length) { riders.value = responses[i++].data; }
    if (!bonusRules.value.length) {
      bonusRules.value = responses[i++].data.filter(r => r.active && r.type === 'EARLY_CHECKIN');
    }
  } catch (e) {
    console.error(e);
  } finally {
    loading.value = false;
  }
}

// Auto-refresh when any filter changes — the explicit Buscar button stays
// for discoverability, but users who just change the dropdown no longer
// see stale rows that look like "the filter was ignored".
let reloadTimer = null;
watch([filterFrom, filterTo, filterRider], () => {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => { load(); }, 250);
});

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
