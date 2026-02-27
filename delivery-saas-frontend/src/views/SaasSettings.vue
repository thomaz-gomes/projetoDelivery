<script setup>
import { ref, onMounted } from 'vue'
import api from '../api'

const settings = ref({
  openai_api_key: '',
  openai_model: '',
})
const settingsMeta = ref([])  // { key, isSet, updatedAt }
const loading = ref(true)
const saving = ref(false)
const saved = ref(false)
const error = ref(null)
const showKey = ref(false)

async function load() {
  loading.value = true
  error.value = null
  try {
    const { data } = await api.get('/saas/settings')
    settingsMeta.value = data
    // Não preenche o campo da chave com o valor mascarado — o usuário
    // deve digitar apenas quando quiser alterar
    const modelRow = data.find(r => r.key === 'openai_model')
    if (modelRow && modelRow.isSet) {
      settings.value.openai_model = modelRow.value
    }
  } catch (e) {
    error.value = e?.response?.data?.message || 'Erro ao carregar configurações'
  } finally {
    loading.value = false
  }
}

function metaFor(key) {
  return settingsMeta.value.find(r => r.key === key) || { isSet: false, updatedAt: null }
}

async function save() {
  saving.value = true
  saved.value = false
  error.value = null
  try {
    const payload = []
    // Só inclui a chave se o campo não estiver vazio (evita sobrescrever com vazio)
    if (settings.value.openai_api_key.trim()) {
      payload.push({ key: 'openai_api_key', value: settings.value.openai_api_key.trim() })
    }
    payload.push({ key: 'openai_model', value: settings.value.openai_model.trim() })

    await api.put('/saas/settings', payload)
    saved.value = true
    settings.value.openai_api_key = ''
    showKey.value = false
    await load()
    setTimeout(() => { saved.value = false }, 3000)
  } catch (e) {
    error.value = e?.response?.data?.message || 'Erro ao salvar configurações'
  } finally {
    saving.value = false
  }
}

async function clearKey() {
  if (!confirm('Tem certeza que deseja remover a chave da API OpenAI?')) return
  saving.value = true
  error.value = null
  try {
    await api.put('/saas/settings', [{ key: 'openai_api_key', value: '' }])
    settings.value.openai_api_key = ''
    await load()
  } catch (e) {
    error.value = e?.response?.data?.message || 'Erro ao remover chave'
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="container py-3" style="max-width: 720px;">
    <div class="d-flex align-items-center mb-4">
      <router-link to="/saas" class="btn btn-outline-secondary btn-sm me-3">
        <i class="bi bi-arrow-left"></i>
      </router-link>
      <h2 class="mb-0">Configurações do Sistema</h2>
    </div>

    <div v-if="loading" class="text-center py-5">
      <div class="spinner-border text-primary"></div>
    </div>

    <template v-else>
      <div v-if="error" class="alert alert-danger">{{ error }}</div>
      <div v-if="saved" class="alert alert-success">Configurações salvas com sucesso.</div>

      <!-- OpenAI -->
      <div class="card border-0 shadow-sm mb-4">
        <div class="card-body">
          <h5 class="card-title mb-1">
            <i class="bi bi-stars me-2 text-primary"></i>OpenAI
          </h5>
          <p class="text-muted small mb-4">
            Chave usada para importação de cardápios via IA e análise de recibos.
            Não é compartilhada com empresas clientes.
          </p>

          <!-- API Key -->
          <div class="mb-3">
            <label class="form-label fw-semibold">Chave da API (API Key)</label>

            <div v-if="metaFor('openai_api_key').isSet" class="mb-2">
              <span class="badge bg-success me-2"><i class="bi bi-check-circle me-1"></i>Configurada</span>
              <small class="text-muted">
                Atualizada em
                {{ metaFor('openai_api_key').updatedAt
                    ? new Date(metaFor('openai_api_key').updatedAt).toLocaleDateString('pt-BR')
                    : '—' }}
              </small>
              <button class="btn btn-outline-danger btn-sm ms-3" @click="clearKey" :disabled="saving">
                <i class="bi bi-trash me-1"></i>Remover
              </button>
            </div>
            <div v-else class="mb-2">
              <span class="badge bg-warning text-dark"><i class="bi bi-exclamation-triangle me-1"></i>Não configurada</span>
            </div>

            <div class="input-group">
              <input
                :type="showKey ? 'text' : 'password'"
                class="form-control font-monospace"
                v-model="settings.openai_api_key"
                placeholder="sk-... (deixe vazio para manter a chave atual)"
                autocomplete="new-password"
              />
              <button class="btn btn-outline-secondary" type="button" @click="showKey = !showKey" :title="showKey ? 'Ocultar' : 'Mostrar'">
                <i :class="showKey ? 'bi bi-eye-slash' : 'bi bi-eye'"></i>
              </button>
            </div>
            <div class="form-text">
              Digite uma nova chave apenas se quiser substituir a atual.
              Deixe em branco para preservar a chave existente.
            </div>
          </div>

          <!-- Model -->
          <div class="mb-3">
            <label class="form-label fw-semibold">Modelo</label>
            <input
              type="text"
              class="form-control font-monospace"
              v-model="settings.openai_model"
              placeholder="gpt-4o (padrão para importação de cardápio)"
            />
            <div class="form-text">
              Modelos recomendados: <code>gpt-4o</code> (mais preciso), <code>gpt-4o-mini</code> (mais rápido e barato).
              Deixe vazio para usar o padrão.
            </div>
          </div>

          <button class="btn btn-primary" @click="save" :disabled="saving">
            <span v-if="saving" class="spinner-border spinner-border-sm me-2"></span>
            <i v-else class="bi bi-floppy me-2"></i>
            Salvar configurações
          </button>
        </div>
      </div>
    </template>
  </div>
</template>
