<template>
  <div class="printer-status small text-muted">
    <span v-if="connected" class="text-success">🖨️ Serviço de impressão disponível</span>
    <span v-else class="text-danger">⚠️ Serviço de impressão indisponível</span>
    <div class="mt-1">
      <small>Rota de impressão: <strong>{{ routeLabel }}</strong></small>
      <button v-if="devMode" class="btn btn-sm btn-link" @click="toggleRoute">Alternar rota</button>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, computed, watch } from "vue";
import printService from "../services/printService.js";

const connected = ref(false);
const route = ref(printService.getPrintRoute());
const devMode = Boolean(import.meta && import.meta.env && import.meta.env.DEV);

function toggleRoute() {
  const next = route.value === 'backend' ? 'agent' : 'backend';
  printService.setPrintRoute(next);
  route.value = next;
}

const routeLabel = computed(() => route.value === 'backend' ? 'Backend (/agent-print)' : 'Local agent (http://localhost:4000)');

onMounted(async () => {
  // initial probe based on current route
  connected.value = await printService.connectQZ();

  // periodically refresh connectivity flag (keeps badge up-to-date)
  setInterval(() => {
    try { connected.value = printService.isConnected(); } catch (e) { connected.value = false }
  }, 5000);
});

// When route changes (either via toggle or external config), re-run probe
watch(route, async (newRoute, oldRoute) => {
  try {
    connected.value = await printService.connectQZ();
  } catch (e) {
    connected.value = false;
  }
});
</script>