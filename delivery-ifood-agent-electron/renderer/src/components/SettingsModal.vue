<script setup>
import { ref, onMounted } from 'vue'

const emit = defineEmits(['close'])

const backendUrl = ref('')
const ifoodAgentToken = ref('')
const companyId = ref('')
const isFirstRun = ref(false)
const saving = ref(false)
const error = ref('')

onMounted(async () => {
  if (window.agentApi && window.agentApi.getConfig) {
    const cfg = await window.agentApi.getConfig()
    if (cfg) {
      backendUrl.value = cfg.backendUrl || ''
      ifoodAgentToken.value = cfg.ifoodAgentToken || ''
      companyId.value = cfg.companyId || ''
      isFirstRun.value = !(cfg.backendUrl && cfg.ifoodAgentToken && cfg.companyId)
    } else {
      isFirstRun.value = true
    }
  } else {
    isFirstRun.value = true
  }
})

async function onSave() {
  error.value = ''
  const cfg = {
    backendUrl: backendUrl.value.trim(),
    ifoodAgentToken: ifoodAgentToken.value.trim(),
    companyId: companyId.value.trim(),
  }
  if (!cfg.backendUrl || !cfg.ifoodAgentToken || !cfg.companyId) {
    error.value = 'Preencha todos os campos.'
    return
  }
  saving.value = true
  try {
    if (window.agentApi && window.agentApi.saveConfig) {
      await window.agentApi.saveConfig(cfg)
    }
    emit('close')
  } catch (e) {
    error.value = (e && e.message) || 'Falha ao salvar.'
  } finally {
    saving.value = false
  }
}

function onCancel() {
  emit('close')
}
</script>

<template>
  <div class="settings-modal">
    <h2>Configurações do Agente</h2>

    <p class="hint" v-if="isFirstRun">
      Primeiro uso: cole os dados gerados pelo administrador na página
      <em>Agente iFood</em> do painel.
    </p>

    <label>
      URL do backend
      <input v-model="backendUrl" type="url" placeholder="https://api.exemplo.com" autocomplete="off" />
    </label>

    <label>
      Token do agente iFood
      <input v-model="ifoodAgentToken" type="text" placeholder="ifa_xxx" autocomplete="off" spellcheck="false" />
    </label>

    <label>
      ID da empresa
      <input v-model="companyId" type="text" placeholder="cmp_xxx" autocomplete="off" spellcheck="false" />
    </label>

    <p class="error" v-if="error">{{ error }}</p>

    <div class="actions">
      <button v-if="!isFirstRun" type="button" class="btn ghost" @click="onCancel" :disabled="saving">
        Cancelar
      </button>
      <button type="button" class="btn primary" @click="onSave" :disabled="saving">
        {{ saving ? 'Salvando...' : 'Salvar e conectar' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.settings-modal { display: flex; flex-direction: column; gap: 0.75rem; min-width: 360px; }
.settings-modal h2 { font-size: 1.1rem; margin: 0 0 0.25rem 0; }
.hint { font-size: 0.85rem; opacity: 0.85; margin: 0; }
label { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.85rem; }
input {
  font: inherit; padding: 0.45rem 0.6rem;
  background: var(--bg); color: var(--fg);
  border: 1px solid var(--border); border-radius: 4px;
}
.error { color: #c0392b; font-size: 0.85rem; margin: 0; }
.actions { display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 0.5rem; }
.btn { font-size: 0.85rem; padding: 0.4rem 0.9rem; border: 1px solid var(--border); border-radius: 4px; background: transparent; color: var(--fg); }
.btn:hover:not(:disabled) { background: rgba(127,127,127,0.1); }
.btn.primary { background: var(--accent); color: #fff; border-color: var(--accent); }
.btn.primary:hover:not(:disabled) { filter: brightness(1.05); }
.btn.ghost { background: transparent; }
.btn:disabled { opacity: 0.55; cursor: not-allowed; }
</style>
