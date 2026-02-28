<script setup>
import { ref, onMounted, computed } from 'vue'
import api from '../api'

const settings = ref({
  openai_api_key: '',
  openai_model: '',
  credit_brl_price: '',
})
const settingsMeta = ref([])  // { key, isSet, updatedAt }
const loading = ref(true)
const saving = ref(false)
const saved = ref(false)
const error = ref(null)
const showKey = ref(false)

// ── Créditos de IA ──────────────────────────────────────────────────────────
// Definições exibidas no formulário (label + ícone + padrão de fallback)
const SERVICE_DEFS = [
  { key: 'AI_STUDIO_ENHANCE',    label: 'Gerar / aprimorar imagem (AI Studio)',        icon: 'bi-stars',          default: 10 },
  { key: 'MENU_IMPORT_LINK',     label: 'Importar cardápio via link com IA',            icon: 'bi-link-45deg',     default: 5  },
  { key: 'MENU_IMPORT_PHOTO',    label: 'Importar cardápio via foto com IA',            icon: 'bi-camera',         default: 5  },
  { key: 'MENU_IMPORT_PLANILHA', label: 'Importar cardápio via planilha (Excel/CSV)',   icon: 'bi-table',          default: 2  },
  { key: 'MENU_IMPORT_ITEM',     label: 'Por item importado via IA (cardápio aplicado)',icon: 'bi-list-check',     default: 1  },
  { key: 'GENERATE_DESCRIPTION', label: 'Gerar descrição de produto com IA',            icon: 'bi-pencil-square',  default: 2  },
]

const creditServices = ref({}) // key → creditsPerUnit (editável)
const loadingCredits = ref(false)
const savingCredits = ref(false)
const savedCredits = ref(false)
const errorCredits = ref(null)

const brlPrice = computed(() => {
  const v = parseFloat(String(settings.value.credit_brl_price).replace(',', '.'))
  return isNaN(v) || v <= 0 ? 0 : v
})

function brlFor(credits) {
  if (!brlPrice.value || !credits) return 'R$ —'
  return 'R$ ' + (credits * brlPrice.value).toFixed(2).replace('.', ',')
}

async function loadCredits() {
  loadingCredits.value = true
  errorCredits.value = null
  try {
    const { data } = await api.get('/saas/credit-services')
    const map = {}
    for (const svc of data) map[svc.key] = svc.creditsPerUnit
    // Preenche valores editáveis com fallback nos defaults da lista
    for (const def of SERVICE_DEFS) {
      creditServices.value[def.key] = map[def.key] ?? def.default
    }
  } catch (e) {
    errorCredits.value = e?.response?.data?.message || 'Erro ao carregar custos de créditos'
  } finally {
    loadingCredits.value = false
  }
}

async function saveCredits() {
  savingCredits.value = true
  savedCredits.value = false
  errorCredits.value = null
  try {
    // Salva o preço BRL por crédito junto com as configurações gerais
    await api.put('/saas/settings', [{ key: 'credit_brl_price', value: String(settings.value.credit_brl_price).replace(',', '.') }])

    // Salva os custos de cada serviço
    const payload = SERVICE_DEFS.map(def => ({
      key: def.key,
      creditsPerUnit: Math.max(0, Math.round(Number(creditServices.value[def.key]) || def.default)),
    }))
    await api.put('/saas/credit-services', payload)

    savedCredits.value = true
    setTimeout(() => { savedCredits.value = false }, 3000)
  } catch (e) {
    errorCredits.value = e?.response?.data?.message || 'Erro ao salvar custos de créditos'
  } finally {
    savingCredits.value = false
  }
}
// ───────────────────────────────────────────────────────────────────────────

async function load() {
  loading.value = true
  error.value = null
  try {
    const { data } = await api.get('/saas/settings')
    settingsMeta.value = data
    const modelRow = data.find(r => r.key === 'openai_model')
    if (modelRow && modelRow.isSet) {
      settings.value.openai_model = modelRow.value
    }
    const brlRow = data.find(r => r.key === 'credit_brl_price')
    if (brlRow && brlRow.isSet) {
      settings.value.credit_brl_price = brlRow.value
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

onMounted(async () => {
  await load()
  await loadCredits()
})
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

      <!-- Créditos de IA -->
      <div class="card border-0 shadow-sm mb-4">
        <div class="card-body">
          <h5 class="card-title mb-1">
            <i class="bi bi-coin me-2 text-warning"></i>Créditos de IA
          </h5>
          <p class="text-muted small mb-4">
            Define o custo em créditos de cada operação de IA e o valor monetário de referência por crédito
            (usado para comunicar o custo em reais ao cliente).
          </p>

          <div v-if="errorCredits" class="alert alert-danger py-2 small">{{ errorCredits }}</div>
          <div v-if="savedCredits" class="alert alert-success py-2 small">Custos de créditos salvos com sucesso.</div>

          <!-- Valor por crédito em BRL -->
          <div class="mb-4 p-3 rounded-3 bg-light border">
            <label class="form-label fw-semibold mb-1">
              <i class="bi bi-currency-dollar me-1"></i>Valor por crédito (R$)
            </label>
            <div class="input-group" style="max-width: 240px;">
              <span class="input-group-text">R$</span>
              <input
                type="number"
                class="form-control"
                v-model="settings.credit_brl_price"
                min="0"
                step="0.001"
                placeholder="ex: 0.0496"
              />
            </div>
            <div class="form-text">
              Exemplo: <code>0.0496</code> → 25 créditos = R$ 1,24
            </div>
          </div>

          <!-- Tabela de serviços -->
          <div v-if="loadingCredits" class="text-center py-3">
            <div class="spinner-border spinner-border-sm text-primary"></div>
          </div>
          <template v-else>
            <div class="table-responsive">
              <table class="table table-sm align-middle mb-3">
                <thead class="table-light">
                  <tr>
                    <th>Operação</th>
                    <th style="width: 140px;">Créditos</th>
                    <th style="width: 120px;" class="text-end">Valor (R$)</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="def in SERVICE_DEFS" :key="def.key">
                    <td>
                      <i class="bi me-2 text-primary" :class="def.icon"></i>
                      {{ def.label }}
                      <code class="ms-2 text-muted" style="font-size: 0.7rem;">{{ def.key }}</code>
                    </td>
                    <td>
                      <input
                        type="number"
                        class="form-control form-control-sm"
                        v-model.number="creditServices[def.key]"
                        min="0"
                        step="1"
                      />
                    </td>
                    <td class="text-end fw-semibold" :class="brlPrice > 0 ? 'text-success' : 'text-muted'">
                      {{ brlFor(creditServices[def.key]) }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <button class="btn btn-warning" @click="saveCredits" :disabled="savingCredits">
              <span v-if="savingCredits" class="spinner-border spinner-border-sm me-2"></span>
              <i v-else class="bi bi-floppy me-2"></i>
              Salvar créditos de IA
            </button>
          </template>
        </div>
      </div>
    </template>
  </div>
</template>
