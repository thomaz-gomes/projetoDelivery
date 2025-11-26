<template>
  <div class="agent-token-admin">
    <h3>Agent Token (Admin)</h3>

    <div style="margin-bottom:12px">
      <div><strong>Socket URL:</strong> {{ socketUrl || '-' }}</div>
      <div><strong>Store IDs:</strong> {{ (storeIds || []).join(', ') || '-' }}</div>
      <div><strong>Token issued:</strong> {{ tokenIssuedLabel || 'nenhum' }}</div>
    </div>

    <div style="margin-bottom:12px">
      <button class="btn btn-primary" @click="generateToken" :disabled="loading">Gerar / Rotacionar token</button>
      <button class="btn" @click="refresh" :disabled="loading">Refresh</button>
    </div>

    <div v-if="generatedToken" style="margin-top:12px">
      <label>Token (copie e guarde em segurança — será exibido apenas agora)</label>
      <div style="display:flex; gap:8px; align-items:center">
        <input readonly style="flex:1" :value="generatedToken" />
        <button @click="copyToken">Copiar</button>
      </div>
      <small style="color:#666">Configure o `PRINT_AGENT_TOKEN` no agente local com esse valor.</small>
    </div>

    <div style="margin-top:12px;color:#666">{{ status }}</div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import api from '../api'

const socketUrl = ref('')
const storeIds = ref([])
const tokenIssuedLabel = ref('')
const generatedToken = ref('')
const status = ref('')
const loading = ref(false)

async function refresh() {
  status.value = 'Buscando dados...'
  try {
    const { data } = await api.get('/agent-setup')
    socketUrl.value = data.socketUrl
    storeIds.value = data.storeIds || []
    tokenIssuedLabel.value = data.tokenHint || ''
    status.value = 'Pronto'
  } catch (e) {
    status.value = 'Erro ao buscar /agent-setup: ' + (e?.response?.data?.message || e.message || e)
  }
}

async function generateToken() {
  loading.value = true
  status.value = 'Gerando token...'
  generatedToken.value = ''
  try {
    const { data } = await api.post('/agent-setup/token')
    generatedToken.value = data.token
    status.value = 'Token gerado. Copie e guarde em segurança.'
    await refresh()
  } catch (e) {
    status.value = 'Falha ao gerar token: ' + (e?.response?.data?.message || e.message || e)
  } finally {
    loading.value = false
  }
}

function copyToken() {
  try { navigator.clipboard.writeText(generatedToken.value); status.value = 'Token copiado para área de transferência.' } catch (e) { status.value = 'Falha ao copiar: ' + e }
}

onMounted(refresh)
</script>

<style scoped>
.agent-token-admin { padding:12px; max-width:720px; background:#fff; border:1px solid #eee }
button { padding:6px 10px }
input[readonly] { padding:6px }
</style>
