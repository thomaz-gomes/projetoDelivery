<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import api from '../../api';
import MobileBottomNav from '../../components/MobileBottomNav.vue';

const currentTime = ref('');
const shifts = ref([]);
const selectedShift = ref('');
const loading = ref(false);
const error = ref('');
const success = ref(null);
const todayCheckins = ref([]);

let clockInterval = null;

function updateClock() {
  const now = new Date();
  currentTime.value = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

async function loadData() {
  try {
    const [shiftsRes, checkinsRes] = await Promise.all([
      api.get('/riders/me/shifts'),
      api.get('/riders/me/checkins', { params: { from: new Date().toISOString().slice(0, 10) } })
    ]);
    shifts.value = shiftsRes.data;
    todayCheckins.value = checkinsRes.data;
  } catch (e) { console.error(e); }
}

async function doCheckin() {
  if (!selectedShift.value) { error.value = 'Selecione um turno'; return; }
  error.value = '';
  success.value = null;
  loading.value = true;

  try {
    const pos = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10000 });
    });

    const { data } = await api.post('/riders/me/checkin', {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      shiftId: selectedShift.value
    });

    success.value = data;
    await loadData();
  } catch (e) {
    if (e.code === 1) { error.value = 'Permissão de localização negada. Habilite o GPS.'; }
    else if (e.code === 2 || e.code === 3) { error.value = 'Não foi possível obter sua localização. Tente novamente.'; }
    else { error.value = e.response?.data?.message || 'Erro ao fazer check-in'; }
  } finally { loading.value = false; }
}

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function shiftAlreadyChecked(shiftId) {
  return todayCheckins.value.some(c => c.shiftId === shiftId);
}

onMounted(() => {
  updateClock();
  clockInterval = setInterval(updateClock, 1000);
  loadData();
});

onUnmounted(() => {
  if (clockInterval) clearInterval(clockInterval);
});
</script>

<template>
  <div class="checkin-page">
    <div class="checkin-container mx-auto px-3 pt-4 pb-5">
      <!-- Clock hero -->
      <div class="text-center mb-4">
        <div class="checkin-clock">{{ currentTime }}</div>
        <div class="text-muted small">Horário atual</div>
      </div>

      <!-- Shift select -->
      <div class="mb-3">
        <label class="form-label fw-semibold">Turno</label>
        <select v-model="selectedShift" class="form-select form-select-lg">
          <option value="" disabled>Selecione um turno</option>
          <option v-for="s in shifts" :key="s.id" :value="s.id" :disabled="shiftAlreadyChecked(s.id)">
            {{ s.name }} ({{ s.startTime }} - {{ s.endTime }}){{ shiftAlreadyChecked(s.id) ? ' ✓' : '' }}
          </option>
        </select>
        <div v-if="shifts.length === 0" class="form-text text-warning small mt-1">
          <i class="bi bi-exclamation-triangle me-1"></i>Nenhum turno atribuído a você.
        </div>
      </div>

      <!-- Check-in button -->
      <button
        class="btn btn-success btn-lg w-100 py-3 mb-3"
        :disabled="loading || !selectedShift"
        @click="doCheckin"
      >
        <span v-if="loading" class="spinner-border spinner-border-sm me-2"></span>
        <i v-else class="bi bi-geo-alt-fill me-2"></i>
        {{ loading ? 'Registrando...' : 'Fazer Check-in' }}
      </button>

      <!-- Feedback -->
      <div v-if="error" class="alert alert-danger py-2 small">
        <i class="bi bi-exclamation-circle me-1"></i>{{ error }}
      </div>
      <div v-if="success" class="alert alert-success py-2 small">
        <i class="bi bi-check-circle-fill me-1"></i>
        <strong>Check-in registrado!</strong>
        <div v-if="success.address" class="mt-1 text-muted" style="font-size: 0.8rem">{{ success.address }}</div>
      </div>

      <!-- Today's checkins -->
      <div v-if="todayCheckins.length" class="mt-4">
        <h6 class="fw-semibold mb-2"><i class="bi bi-clock-history me-1"></i>Check-ins de hoje</h6>
        <div class="list-group">
          <div v-for="c in todayCheckins" :key="c.id" class="list-group-item d-flex justify-content-between align-items-center py-2">
            <div>
              <div class="fw-semibold small">{{ c.shift?.name || 'Turno' }}</div>
              <div class="text-muted" style="font-size: 0.75rem">{{ c.address ? c.address.substring(0, 60) + '...' : '' }}</div>
            </div>
            <span class="badge bg-success">{{ formatTime(c.checkinAt) }}</span>
          </div>
        </div>
      </div>
    </div>

    <div style="height: 80px"></div>
    <MobileBottomNav />
  </div>
</template>

<style scoped>
.checkin-page {
  min-height: 100vh;
  background: #f8f9fa;
}
.checkin-container {
  max-width: 480px;
}
.checkin-clock {
  font-size: 3.5rem;
  font-weight: 700;
  font-family: 'Courier New', monospace;
  color: #198754;
  line-height: 1;
}
</style>
