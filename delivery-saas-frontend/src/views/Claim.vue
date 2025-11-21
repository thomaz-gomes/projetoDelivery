<script setup>
import { onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import api from '../api';

const route = useRoute();
const msg = ref('Processando...');
const ok = ref(false);

onMounted(async () => {
  const token = route.params.token;
  try {
    const { data } = await api.post(`/tickets/${token}/claim`);
    ok.value = true;
  msg.value = `Pedido ${data.order.displaySimple != null ? String(data.order.displaySimple).padStart(2,'0') : (data.order.displayId != null ? String(data.order.displayId).padStart(2,'0') : data.order.id.slice(0,6))} atribuído e DESPACHADO!`;
  } catch (e) {
    msg.value = e?.response?.data?.message || 'Falha ao atribuir';
  }
});
</script>

<template>
  <div class="page">
    <h2>Comanda</h2>
    <p :style="{ color: ok ? 'green' : 'crimson' }">{{ msg }}</p>
  </div>
</template>

<style scoped>
.page { max-width:500px; margin:32px auto; padding:0 12px; }
</style>