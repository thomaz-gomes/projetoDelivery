<script setup>
import { onMounted, ref, watch, onUnmounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import api from '../api';
import Swal from 'sweetalert2';
import { useAuthStore } from '../stores/auth';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const msg = ref('Processando...');
const ok = ref(false);
const loading = ref(false);
let tried = false;

async function tryClaim() {
  if (tried) return;
  tried = true;
  const token = route.params.token;
  let authError = false;
  let lastError = null;
  try {
    loading.value = true;
    const { data } = await api.post(`/tickets/${token}/claim`);
    ok.value = true;
    msg.value = `Pedido ${data.order.displaySimple != null ? String(data.order.displaySimple).padStart(2,'0') : (data.order.displayId != null ? String(data.order.displayId).padStart(2,'0') : data.order.id.slice(0,6))} atribuído e DESPACHADO!`;
    // small delay then navigate rider to their orders
    setTimeout(() => router.push('/rider/orders'), 900);
  } catch (e) {
    lastError = e;
    msg.value = (e && e.response && e.response.data && e.response.data.message) || 'Falha ao atribuir';
    // if authorization error, redirect to login preserving redirect
    if (e && e.response && (e.response.status === 401 || e.response.status === 403)) {
      tried = false; // allow retry after login
      authError = true;
      loading.value = true; // keep spinner while waiting for login
      Swal.fire({ icon: 'warning', title: 'Autenticação necessária', text: 'Faça login como entregador para confirmar a leitura do QR.' }).then(() => {
        router.push({ path: '/login', query: { redirect: route.fullPath } });
      });
    } else {
      loading.value = false;
    }
  } finally {
    // if not waiting for login, stop spinner
    if (!(lastError && lastError.response && (lastError.response.status === 401 || lastError.response.status === 403))) loading.value = false;
  }
}

onMounted(() => {
  // If already authenticated, try immediately, otherwise wait for auth.token
  if (auth.token) {
    tryClaim();
  } else {
    msg.value = 'Faça login para confirmar a leitura do QR...';
    loading.value = true; // show spinner while waiting for login
  }
});

// watch auth.token to retry claim after login
const stopWatch = watch(() => auth.token, (v) => {
  if (v) {
    // small delay to ensure token stored and api headers applied
    setTimeout(() => tryClaim(), 150);
  }
});

onUnmounted(() => {
  stopWatch();
});

function cancelWaiting() {
  // prevent further retries and stop waiting spinner
  tried = true;
  loading.value = false;
  try { stopWatch(); } catch (e) {}
  // navigate back to a safe place
  router.push('/');
}
</script>

<template>
  <div class="page">
    <h2>Comanda (Rider)</h2>
    <div class="d-flex align-items-center gap-2">
      <div v-if="loading" class="spinner-border spinner-border-sm text-primary" role="status"><span class="visually-hidden">Loading...</span></div>
      <p :style="{ color: ok ? 'green' : 'crimson', margin: 0 }">{{ msg }}</p>
    </div>

    <!-- Full-screen centered overlay while waiting/claiming -->
    <div v-if="loading" class="overlay">
      <div class="overlay-inner card p-4 text-center">
        <div class="mb-3">
          <div class="spinner-border text-primary" role="status" style="width:3rem;height:3rem"><span class="visually-hidden">Loading...</span></div>
        </div>
        <div class="mb-3">
          <h5 class="m-0">{{ ok ? 'Concluído' : 'Aguardando confirmação' }}</h5>
          <div class="small text-muted mt-2">{{ msg }}</div>
        </div>
        <div>
          <button class="btn btn-sm btn-outline-light me-2" @click="cancelWaiting">Cancelar</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page { max-width:500px; margin:32px auto; padding:0 12px; }
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 3000;
}
.overlay-inner { background: rgba(255,255,255,0.98); border-radius: 12px; min-width: 280px; }
.overlay .btn-outline-light { color: #333; border-color: rgba(0,0,0,0.08); }
</style>
