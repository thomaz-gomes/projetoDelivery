<script setup>
import { ref, onMounted } from 'vue'

const emit = defineEmits(['close'])

const failures = ref([])
const loading = ref(false)

async function refresh() {
  loading.value = true
  try {
    if (window.agentApi && window.agentApi.getFailures) {
      const list = await window.agentApi.getFailures()
      failures.value = Array.isArray(list) ? list.slice().reverse() : []  // newest first
    }
  } finally {
    loading.value = false
  }
}

async function onClearAll() {
  if (window.agentApi && window.agentApi.clearFailures) {
    await window.agentApi.clearFailures()
  }
  await refresh()
}

function formatRelative(at) {
  if (!at) return ''
  const ms = Date.now() - at
  if (ms < 60_000) return 'agora'
  const min = Math.floor(ms / 60_000)
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h} h`
  return `${Math.floor(h / 24)} d`
}

onMounted(refresh)
</script>

<template>
  <div class="failures-panel">
    <header>
      <h2>Falhas de envio</h2>
      <div class="head-actions">
        <button class="btn ghost" @click="refresh" :disabled="loading" title="Atualizar">↻</button>
        <button class="btn ghost" @click="emit('close')" title="Fechar">×</button>
      </div>
    </header>

    <p v-if="!loading && failures.length === 0" class="empty">
      Nenhuma falha registrada.
    </p>

    <ul v-else class="list">
      <li v-for="(f, i) in failures" :key="i" class="item">
        <div class="row">
          <strong>#{{ f.orderNumber || '?' }}</strong>
          <span class="kind" v-if="f.kind">{{ f.kind }}</span>
          <span class="when">{{ formatRelative(f.at) }}</span>
        </div>
        <div class="err">{{ f.error || 'erro desconhecido' }}</div>
      </li>
    </ul>

    <footer v-if="failures.length > 0">
      <button class="btn" @click="onClearAll" :disabled="loading">Limpar tudo</button>
    </footer>
  </div>
</template>

<style scoped>
.failures-panel { display: flex; flex-direction: column; gap: 0.75rem; height: 100%; }
header { display: flex; align-items: center; justify-content: space-between; }
header h2 { font-size: 1.05rem; margin: 0; }
.head-actions { display: flex; gap: 0.25rem; }
.empty { font-size: 0.9rem; opacity: 0.75; margin: 1rem 0; }
.list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.5rem; flex: 1; overflow-y: auto; }
.item { padding: 0.5rem 0.6rem; border: 1px solid var(--border); border-radius: 4px; background: var(--bg); }
.item .row { display: flex; align-items: center; gap: 0.5rem; font-size: 0.85rem; }
.item .kind { background: var(--status-bg); color: var(--status-fg); padding: 0.05rem 0.4rem; border-radius: 3px; font-size: 0.75rem; }
.item .when { margin-left: auto; opacity: 0.7; font-size: 0.75rem; }
.item .err { font-size: 0.82rem; color: #c0392b; margin-top: 0.25rem; word-break: break-word; }
footer { display: flex; justify-content: flex-end; }
.btn { font-size: 0.85rem; padding: 0.35rem 0.7rem; border: 1px solid var(--border); border-radius: 4px; background: transparent; color: var(--fg); }
.btn.ghost { background: transparent; border: none; }
.btn:hover:not(:disabled) { background: rgba(127,127,127,0.1); }
.btn:disabled { opacity: 0.55; cursor: not-allowed; }
</style>
