<script setup>
import { ref, onMounted } from 'vue'

const status = ref({ status: 'disconnected', reason: 'boot' })

onMounted(() => {
  if (window.agentApi && window.agentApi.onSocketStatus) {
    window.agentApi.onSocketStatus((st) => { status.value = st })
  }
})
</script>

<template>
  <div class="app">
    <header class="app-header">
      <h1>Delivery iFood Agent</h1>
      <span class="status" :class="status.status">{{ status.status }}</span>
    </header>
    <main class="app-main">
      <p>Renderer pronto. Componentes serão adicionados nas próximas tarefas.</p>
    </main>
  </div>
</template>

<style scoped>
.app { display: flex; flex-direction: column; height: 100vh; }
.app-header { display: flex; align-items: center; justify-content: space-between; padding: 0.75rem 1rem; background: var(--bg-header); border-bottom: 1px solid var(--border); }
.app-header h1 { font-size: 1rem; margin: 0; font-weight: 600; }
.status { font-size: 0.85rem; padding: 0.15rem 0.5rem; border-radius: 4px; background: var(--status-bg); color: var(--status-fg); }
.status.connected { background: #1f9d55; color: #fff; }
.status.disconnected, .status.error { background: #c0392b; color: #fff; }
.app-main { flex: 1; padding: 1rem; }
</style>
