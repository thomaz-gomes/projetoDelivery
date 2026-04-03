<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import api from '../../api';

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
    if (e.code === 1) { error.value = 'Permissao de localizacao negada. Habilite o GPS.'; }
    else if (e.code === 2 || e.code === 3) { error.value = 'Nao foi possivel obter sua localizacao. Tente novamente.'; }
    else { error.value = e.response?.data?.message || 'Erro ao fazer check-in'; }
  } finally { loading.value = false; }
}

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
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
  <div class="checkin-page d-flex justify-content-center">
    <div class="checkin-container w-100 p-3">
      <h4 class="text-center mb-3">Check-in</h4>

      <div class="checkin-clock">{{ currentTime }}</div>

      <div class="mb-3">
        <label class="form-label fw-semibold">Turno</label>
        <select v-model="selectedShift" class="form-select form-select-lg">
          <option value="" disabled>Selecione um turno</option>
          <option v-for="s in shifts" :key="s.id" :value="s.id">{{ s.name }}</option>
        </select>
      </div>

      <button
        class="btn btn-success btn-lg w-100 mb-3"
        :disabled="loading"
        @click="doCheckin"
      >
        <span v-if="loading" class="spinner-border spinner-border-sm me-2" role="status"></span>
        {{ loading ? 'Registrando...' : 'Fazer Check-in' }}
      </button>

      <div v-if="error" class="alert alert-danger" role="alert">{{ error }}</div>

      <div v-if="success" class="alert alert-success" role="alert">
        <strong>Check-in registrado!</strong>
        <span v-if="success.address"> - {{ success.address }}</span>
      </div>

      <div v-if="todayCheckins.length" class="mt-4">
        <h6 class="fw-semibold mb-2">Check-ins de hoje</h6>
        <ul class="list-group">
          <li v-for="c in todayCheckins" :key="c.id" class="list-group-item d-flex justify-content-between align-items-center">
            <span>{{ c.shift?.name || 'Turno' }}</span>
            <span class="badge bg-secondary">{{ formatTime(c.createdAt) }}</span>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>

<style scoped>
.checkin-page {
  min-height: 100vh;
  background: #f8f9fa;
}
.checkin-container {
  max-width: 500px;
  padding-top: 2rem;
}
.checkin-clock {
  font-size: 3.5rem;
  font-weight: 700;
  font-family: 'Courier New', monospace;
  color: #198754;
  text-align: center;
  padding: 1rem 0;
}
</style>
