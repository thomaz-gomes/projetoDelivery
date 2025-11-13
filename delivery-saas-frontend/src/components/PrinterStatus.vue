<template>
  <div class="printer-status small text-muted">
    <span v-if="connected" class="text-success">🖨️ Impressora conectada</span>
    <span v-else class="text-danger">⚠️ QZ Tray desconectado</span>
  </div>
</template>

<script setup>
import { ref, onMounted } from "vue";
import printService from "../services/printService.js";

const connected = ref(false);

onMounted(async () => {
  connected.value = await printService.connectQZ();
  setInterval(() => {
    connected.value = printService.isConnected();
  }, 5000);
});
</script>