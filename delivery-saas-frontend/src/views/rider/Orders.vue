<script setup>
import { ref, onMounted } from 'vue';
import api from '../../api';
import RiderOrders from '../RiderOrders.vue';
import MobileBottomNav from '../../components/MobileBottomNav.vue';
import { useRouter } from 'vue-router';

const router = useRouter();
const checkedIn = ref(null); // null = loading, true/false after check

async function verifyCheckin() {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const { data } = await api.get('/riders/me/checkins', { params: { from: today } });
    checkedIn.value = data.length > 0;
  } catch (e) {
    // If endpoint fails (e.g. rider not found), allow access
    checkedIn.value = true;
  }
}

onMounted(verifyCheckin);
</script>

<template>
  <MobileBottomNav />

  <!-- Loading -->
  <div v-if="checkedIn === null" class="text-center py-5">
    <div class="spinner-border text-primary" role="status"></div>
  </div>

  <!-- No check-in alert -->
  <div v-else-if="!checkedIn" class="checkin-alert-wrapper">
    <div class="checkin-alert mx-auto px-3 pt-5 pb-5 text-center">
      <div class="alert-icon mb-3">
        <i class="bi bi-exclamation-triangle-fill"></i>
      </div>
      <h5 class="fw-bold mb-2">Check-in necessário</h5>
      <p class="text-muted mb-4">
        Você precisa fazer o check-in uma vez ao dia para visualizar seus pedidos.
        Registre sua presença no turno antes de começar as entregas.
      </p>
      <button class="btn btn-success btn-lg px-4" @click="router.push('/rider/checkin')">
        <i class="bi bi-geo-alt-fill me-2"></i>Fazer Check-in
      </button>
    </div>
  </div>

  <!-- Orders (only if checked in) -->
  <RiderOrders v-else />
</template>

<style scoped>
.checkin-alert-wrapper {
  min-height: 80vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f8f9fa;
}
.checkin-alert {
  max-width: 420px;
}
.alert-icon {
  font-size: 3.5rem;
  color: #ffc107;
}
</style>
