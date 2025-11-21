<!-- src/components/PrinterWatcher.vue -->
<template>
  <div class="printer-status">
    <p v-if="connecting">⏳ Conectando à impressora...</p>
    <p v-else-if="!connected">⚠️ Desconectado do servidor de pedidos</p>
    <p v-else>🖨️ Monitorando pedidos...</p>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from "vue";
import { io } from "socket.io-client";
import printService, { isConnecting } from "../services/printService.js";
import { computed } from 'vue';

const connected = ref(false);
const connecting = computed(() => isConnecting());
let socket;
let reconnectTimer;

onMounted(async () => {
  // 🚀 tentativa inicial de conectar ao QZ Tray
  async function ensureQZConnected() {
    if (!printService.isConnected()) {
      const ok = await printService.connectQZ();
      if (ok) console.log("✅ QZ Tray conectado e pronto.");
    }
  }

  await ensureQZConnected();
  reconnectTimer = setInterval(ensureQZConnected, 15000); // tenta reconectar a cada 15s

  // ⚡ conectar ao backend via Socket.IO (use VITE_API_URL or derive from page)
  const API_URL = (import.meta.env.VITE_API_URL && import.meta.env.VITE_API_URL !== 'https://localhost:3000')
    ? import.meta.env.VITE_API_URL
    : `${location.protocol}//${location.hostname}:3000`;

  // prefer polling first for better resilience on some networks
  socket = io(API_URL, {
    transports: ['polling', 'websocket'],
    reconnectionAttempts: Infinity,
    reconnectionDelay: 2000,
    timeout: 30000
  });

  socket.on("connect", () => {
    connected.value = true;
    console.log("📡 Conectado ao servidor de pedidos");
  });

  socket.on("disconnect", (reason) => {
    connected.value = false;
    console.warn("⚠️ Desconectado do servidor de pedidos:", reason);
  });

  socket.on("connect_error", (err) => {
    console.error("❌ Erro de conexão Socket.IO:", err.message);
  });

  // 🧾 Recebe novos pedidos em tempo real
  socket.on("novo-pedido", async (pedido) => {
    console.log("🆕 Novo pedido recebido:", pedido);
    await printService.enqueuePrint(pedido);
  });
});

onUnmounted(() => {
  socket?.disconnect();
  clearInterval(reconnectTimer);
});
</script>

<style scoped>
.printer-status {
  font-size: 13px;
  color: #666;
  margin: 4px 0;
}
</style>