<script setup>
defineProps({
  status: { type: Object, required: true },
  queueCount: { type: Number, default: 0 },
  failureCount: { type: Number, default: 0 },
})

const emit = defineEmits(['reload-ifood', 'open-settings', 'open-failures'])

function statusLabel(s) {
  if (!s) return 'desconhecido'
  if (s.status === 'connected') return 'conectado'
  if (s.status === 'error') return 'erro: ' + (s.error || '')
  if (s.status === 'disconnected') {
    if (s.reason === 'missing-config' || s.reason === 'no-config') return 'sem configuração'
    return 'desconectado'
  }
  return s.status
}
</script>

<template>
  <header class="app-header">
    <div class="brand">
      <strong>Delivery iFood Agent</strong>
    </div>

    <div class="metrics">
      <span class="status-pill" :class="status.status">
        <span class="dot" />
        {{ statusLabel(status) }}
      </span>

      <span class="metric" title="Mensagens aguardando envio">
        Fila: <strong>{{ queueCount }}</strong>
      </span>

      <button class="metric clickable failures" @click="emit('open-failures')" title="Ver falhas">
        Falhas: <strong>{{ failureCount }}</strong>
      </button>
    </div>

    <div class="actions">
      <button class="btn ghost" @click="emit('reload-ifood')" title="Recarregar iFood">
        Recarregar iFood
      </button>
      <button class="btn ghost" @click="emit('open-settings')" title="Configurações">
        ⚙
      </button>
    </div>
  </header>
</template>

<style scoped>
.app-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 0.5rem 1rem;
  background: var(--bg-header);
  border-bottom: 1px solid var(--border);
  flex: 0 0 auto;
  gap: 1rem;
}
.brand { font-size: 0.95rem; }
.metrics { display: flex; align-items: center; gap: 0.75rem; }
.status-pill {
  display: inline-flex; align-items: center; gap: 0.4rem;
  font-size: 0.85rem; padding: 0.2rem 0.6rem;
  border-radius: 999px;
  background: #777; color: #fff;
}
.status-pill .dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; opacity: 0.85; }
.status-pill.connected { background: #1f9d55; }
.status-pill.disconnected { background: #888; }
.status-pill.error { background: #c0392b; }

.metric {
  font-size: 0.85rem; padding: 0.2rem 0.5rem;
  background: var(--status-bg); color: var(--status-fg);
  border-radius: 4px; border: 0;
}
.metric.clickable:hover { filter: brightness(1.1); }
.metric.failures:not(:disabled) { cursor: pointer; }

.actions { display: flex; gap: 0.5rem; }
.btn {
  font-size: 0.85rem; padding: 0.35rem 0.7rem;
  border: 1px solid var(--border); background: transparent; color: var(--fg);
  border-radius: 4px;
}
.btn:hover { background: rgba(127,127,127,0.1); }
.btn.ghost { background: transparent; }
</style>
