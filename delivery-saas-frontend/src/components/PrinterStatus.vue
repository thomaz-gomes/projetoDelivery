<template>
  <div class="printer-status small text-muted">
    <span v-if="connected" class="text-success">🖨️ Impressão disponível</span>
    <span v-else class="text-danger">⚠️ Impressão indisponível</span>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from "vue";
import printService, { checkConnectivity } from "../services/printService.js";

const connected = ref(false);
let timer;

onMounted(async () => {
  try {
    const ok = await checkConnectivity();
    connected.value = !!ok;
  } catch (e) { connected.value = false; }
  timer = setInterval(async () => {
    try { connected.value = !!(await checkConnectivity()); } catch (e) { connected.value = false; }
  }, 5000);
});

onUnmounted(() => { clearInterval(timer); });
</script>