<script setup>
import { ref, onMounted, computed } from 'vue'
import api from '../api'

const settings = ref({
  openai_api_key: '',
  openai_model: '',
  credit_brl_price: '',
  google_ai_api_key: '',
  usd_to_brl: '',
  custom_domain_server_ip: '',
})
const settingsMeta = ref([])  // { key, isSet, updatedAt }
const loading = ref(true)
const saving = ref(false)
const saved = ref(false)
const error = ref(null)
const showKey = ref(false)
const showGoogleKey = ref(false)

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

// ── Provedor de IA por serviço ──────────────────────────────────────────────
const AI_PROVIDER_SERVICES = [
  { key: 'NFE_IMPORT_MATCH',             label: 'NFe Matching (ingredientes)',      icon: 'bi-receipt',        default: 'gemini'  },
  { key: 'MENU_IMPORT_LINK',             label: 'Importar cardápio via link',       icon: 'bi-link-45deg',     default: 'openai'  },
  { key: 'MENU_IMPORT_PHOTO',            label: 'Importar cardápio via foto',       icon: 'bi-camera',         default: 'openai'  },
  { key: 'MENU_IMPORT_PLANILHA',         label: 'Importar cardápio via planilha',   icon: 'bi-table',          default: 'openai'  },
  { key: 'MENU_IMPORT_ITEM',             label: 'Por item importado (cardápio)',    icon: 'bi-list-check',     default: 'openai'  },
  { key: 'INGREDIENT_IMPORT_PARSE',      label: 'Import ingredientes (parse)',      icon: 'bi-box-seam',       default: 'openai'  },
  { key: 'INGREDIENT_IMPORT_ITEM',       label: 'Por item (ingrediente)',           icon: 'bi-box-seam',       default: 'openai'  },
  { key: 'TECHNICAL_SHEET_IMPORT_PARSE', label: 'Import fichas técnicas (parse)',   icon: 'bi-journal-text',   default: 'openai'  },
  { key: 'TECHNICAL_SHEET_IMPORT_ITEM',  label: 'Por item (ficha técnica)',         icon: 'bi-journal-text',   default: 'openai'  },
  { key: 'GENERATE_DESCRIPTION',         label: 'Gerar descrição de produto',       icon: 'bi-pencil-square',  default: 'gemini'  },
  { key: 'POS_PARSER',                   label: 'Parser de POS (Saipos)',           icon: 'bi-printer',        default: 'openai'  },
]

const providerMap = ref({})
const savingProviders = ref(false)
const savedProviders = ref(false)
const errorProviders = ref(null)

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
    await api.put('/saas/settings', [
      { key: 'credit_brl_price', value: String(settings.value.credit_brl_price).replace(',', '.') },
      { key: 'usd_to_brl', value: String(settings.value.usd_to_brl).replace(',', '.') },
      { key: 'custom_domain_server_ip', value: String(settings.value.custom_domain_server_ip || '').trim() },
    ])

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
    const usdRow = data.find(r => r.key === 'usd_to_brl')
    if (usdRow && usdRow.isSet) {
      settings.value.usd_to_brl = usdRow.value
    }
    const ipRow = data.find(r => r.key === 'custom_domain_server_ip')
    if (ipRow && ipRow.isSet) {
      settings.value.custom_domain_server_ip = ipRow.value
    }
    // Carrega mapa de provedores
    const providerRow = data.find(r => r.key === 'ai_provider_map')
    if (providerRow && providerRow.isSet && providerRow.value) {
      try { providerMap.value = JSON.parse(providerRow.value) } catch { /* ignore */ }
    }
    for (const svc of AI_PROVIDER_SERVICES) {
      if (!providerMap.value[svc.key]) providerMap.value[svc.key] = svc.default
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
    if (settings.value.google_ai_api_key.trim()) {
      payload.push({ key: 'google_ai_api_key', value: settings.value.google_ai_api_key.trim() })
    }

    await api.put('/saas/settings', payload)
    saved.value = true
    settings.value.openai_api_key = ''
    settings.value.google_ai_api_key = ''
    showKey.value = false
    showGoogleKey.value = false
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

async function clearGoogleKey() {
  if (!confirm('Tem certeza que deseja remover a chave da API Google AI?')) return
  saving.value = true
  error.value = null
  try {
    await api.put('/saas/settings', [{ key: 'google_ai_api_key', value: '' }])
    settings.value.google_ai_api_key = ''
    await load()
  } catch (e) {
    error.value = e?.response?.data?.message || 'Erro ao remover chave'
  } finally {
    saving.value = false
  }
}

async function saveProviders() {
  savingProviders.value = true
  savedProviders.value = false
  errorProviders.value = null
  try {
    await api.put('/saas/settings', [{ key: 'ai_provider_map', value: JSON.stringify(providerMap.value) }])
    savedProviders.value = true
    setTimeout(() => { savedProviders.value = false }, 3000)
  } catch (e) {
    errorProviders.value = e?.response?.data?.message || 'Erro ao salvar provedores de IA'
  } finally {
    savingProviders.value = false
  }
}

// ── Domínio Próprio (Custom Domain Pricing) ─────────────────────────────
const domainPricing = ref({ monthly: '', yearly: '' })
const domainModuleId = ref(null)
const loadingDomain = ref(false)
const savingDomain = ref(false)
const savedDomain = ref(false)
const errorDomain = ref(null)

async function loadDomainPricing() {
  loadingDomain.value = true
  errorDomain.value = null
  try {
    const { data } = await api.get('/saas/modules')
    const mod = data.find(m => m.key === 'CUSTOM_DOMAIN')
    if (mod) {
      domainModuleId.value = mod.id
      const mp = mod.prices || []
      const monthly = mp.find(p => p.period === 'MONTHLY')
      const yearly = mp.find(p => p.period === 'ANNUAL')
      domainPricing.value.monthly = monthly ? Number(monthly.price) : ''
      domainPricing.value.yearly = yearly ? Number(yearly.price) : ''
    }
  } catch (e) {
    errorDomain.value = e?.response?.data?.message || 'Erro ao carregar preços de domínio'
  } finally {
    loadingDomain.value = false
  }
}

async function saveDomainPricing() {
  if (!domainModuleId.value) return
  savingDomain.value = true
  savedDomain.value = false
  errorDomain.value = null
  try {
    const prices = []
    if (domainPricing.value.monthly !== '' && domainPricing.value.monthly !== null) {
      prices.push({ period: 'MONTHLY', price: parseFloat(domainPricing.value.monthly) || 0 })
    }
    if (domainPricing.value.yearly !== '' && domainPricing.value.yearly !== null) {
      prices.push({ period: 'ANNUAL', price: parseFloat(domainPricing.value.yearly) || 0 })
    }
    await api.put(`/saas/modules/${domainModuleId.value}`, { prices })
    savedDomain.value = true
    setTimeout(() => { savedDomain.value = false }, 3000)
  } catch (e) {
    errorDomain.value = e?.response?.data?.message || 'Erro ao salvar preços de domínio'
  } finally {
    savingDomain.value = false
  }
}

// ── Pricing de Modelos de IA ─────────────────────────────────────────────
const providerPricings = ref([])
const loadingPricings = ref(false)
const newPricing = ref({ provider: 'openai', model: '', inputPricePerMillion: '', outputPricePerMillion: '' })
const showNewPricingForm = ref(false)
const savingPricing = ref(false)

async function loadPricings() {
  loadingPricings.value = true
  try {
    const { data } = await api.get('/saas/ai-provider-pricing')
    providerPricings.value = data
  } catch (e) {
    console.error('Erro ao carregar pricings:', e)
  } finally {
    loadingPricings.value = false
  }
}

async function savePricing(p) {
  savingPricing.value = true
  try {
    if (p.id) {
      await api.put(`/saas/ai-provider-pricing/${p.id}`, {
        inputPricePerMillion: parseFloat(p.inputPricePerMillion),
        outputPricePerMillion: parseFloat(p.outputPricePerMillion),
        isActive: p.isActive,
      })
    } else {
      await api.post('/saas/ai-provider-pricing', {
        provider: p.provider,
        model: p.model,
        inputPricePerMillion: parseFloat(p.inputPricePerMillion),
        outputPricePerMillion: parseFloat(p.outputPricePerMillion),
      })
      newPricing.value = { provider: 'openai', model: '', inputPricePerMillion: '', outputPricePerMillion: '' }
      showNewPricingForm.value = false
    }
    await loadPricings()
  } catch (e) {
    alert(e?.response?.data?.message || 'Erro ao salvar pricing')
  } finally {
    savingPricing.value = false
  }
}

async function deletePricing(id) {
  if (!confirm('Remover este modelo de pricing?')) return
  try {
    await api.delete(`/saas/ai-provider-pricing/${id}`)
    await loadPricings()
  } catch (e) {
    alert(e?.response?.data?.message || 'Erro ao remover')
  }
}

onMounted(async () => {
  await load()
  await loadCredits()
  await loadPricings()
  await loadDomainPricing()
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

      <!-- Google AI Studio -->
      <div class="card border-0 shadow-sm mb-4">
        <div class="card-body">
          <h5 class="card-title mb-1">
            <i class="bi bi-google me-2 text-danger"></i>Google AI Studio
          </h5>
          <p class="text-muted small mb-4">
            Chave usada para geração e aprimoramento de fotos no AI Studio
            (Gemini Flash para análise de imagens + Imagen 3 para geração).
            Não é compartilhada com empresas clientes.
          </p>

          <div class="mb-3">
            <label class="form-label fw-semibold">Chave da API (API Key)</label>

            <div v-if="metaFor('google_ai_api_key').isSet" class="mb-2">
              <span class="badge bg-success me-2"><i class="bi bi-check-circle me-1"></i>Configurada</span>
              <small class="text-muted">
                Atualizada em
                {{ metaFor('google_ai_api_key').updatedAt
                    ? new Date(metaFor('google_ai_api_key').updatedAt).toLocaleDateString('pt-BR')
                    : '—' }}
              </small>
              <button class="btn btn-outline-danger btn-sm ms-3" @click="clearGoogleKey" :disabled="saving">
                <i class="bi bi-trash me-1"></i>Remover
              </button>
            </div>
            <div v-else class="mb-2">
              <span class="badge bg-warning text-dark"><i class="bi bi-exclamation-triangle me-1"></i>Não configurada</span>
            </div>

            <div class="input-group">
              <input
                :type="showGoogleKey ? 'text' : 'password'"
                class="form-control font-monospace"
                v-model="settings.google_ai_api_key"
                placeholder="AIzaSy... (deixe vazio para manter a chave atual)"
                autocomplete="new-password"
              />
              <button class="btn btn-outline-secondary" type="button" @click="showGoogleKey = !showGoogleKey" :title="showGoogleKey ? 'Ocultar' : 'Mostrar'">
                <i :class="showGoogleKey ? 'bi bi-eye-slash' : 'bi bi-eye'"></i>
              </button>
            </div>
            <div class="form-text">
              Obtenha sua chave em <strong>aistudio.google.com</strong>.
              Digite apenas quando quiser substituir. Deixe em branco para preservar a atual.
            </div>
          </div>

          <button class="btn btn-primary" @click="save" :disabled="saving">
            <span v-if="saving" class="spinner-border spinner-border-sm me-2"></span>
            <i v-else class="bi bi-floppy me-2"></i>
            Salvar configurações
          </button>
        </div>
      </div>

      <!-- Provedor de IA por serviço -->
      <div class="card border-0 shadow-sm mb-4">
        <div class="card-body">
          <h5 class="card-title mb-1">
            <i class="bi bi-shuffle me-2 text-info"></i>Provedor de IA por Serviço
          </h5>
          <p class="text-muted small mb-4">
            Escolha qual provedor de IA (Gemini ou OpenAI) será usado para cada operação de texto/matching.
            Serviços de imagem (AI Studio) usam sempre Gemini.
          </p>

          <div v-if="errorProviders" class="alert alert-danger py-2 small">{{ errorProviders }}</div>
          <div v-if="savedProviders" class="alert alert-success py-2 small">Provedores salvos com sucesso.</div>

          <div class="table-responsive">
            <table class="table table-sm align-middle mb-3">
              <thead class="table-light">
                <tr>
                  <th>Serviço</th>
                  <th style="width: 180px;">Provedor</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="svc in AI_PROVIDER_SERVICES" :key="svc.key">
                  <td>
                    <i class="bi me-2 text-primary" :class="svc.icon"></i>
                    {{ svc.label }}
                    <code class="ms-2 text-muted" style="font-size: 0.7rem;">{{ svc.key }}</code>
                  </td>
                  <td>
                    <select class="form-select form-select-sm" v-model="providerMap[svc.key]">
                      <option value="gemini">Gemini</option>
                      <option value="openai">OpenAI</option>
                    </select>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <button class="btn btn-primary" @click="saveProviders" :disabled="savingProviders">
            <span v-if="savingProviders" class="spinner-border spinner-border-sm me-2"></span>
            <i v-else class="bi bi-floppy me-2"></i>
            Salvar provedores
          </button>
        </div>
      </div>

      <!-- Pricing de Modelos de IA -->
      <div class="card border-0 shadow-sm mb-4">
        <div class="card-body">
          <h5 class="card-title mb-1">
            <i class="bi bi-tags me-2 text-success"></i>Pricing de Modelos de IA
          </h5>
          <p class="text-muted small mb-4">
            Configure o custo por milhão de tokens (USD) de cada modelo de IA.
            Usado para calcular o custo real das operações.
          </p>

          <div v-if="loadingPricings" class="text-center py-3">
            <div class="spinner-border spinner-border-sm text-primary"></div>
          </div>

          <template v-else>
            <div class="table-responsive">
              <table class="table table-sm align-middle mb-3">
                <thead class="table-light">
                  <tr>
                    <th>Provider</th>
                    <th>Modelo</th>
                    <th style="width: 160px;">Input (USD/M)</th>
                    <th style="width: 160px;">Output (USD/M)</th>
                    <th style="width: 100px;" class="text-end">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="p in providerPricings" :key="p.id">
                    <td>
                      <span class="badge" :class="p.provider === 'openai' ? 'bg-dark' : 'bg-info'">
                        {{ p.provider }}
                      </span>
                    </td>
                    <td><code class="small">{{ p.model }}</code></td>
                    <td>
                      <input
                        type="number"
                        class="form-control form-control-sm"
                        v-model="p.inputPricePerMillion"
                        min="0"
                        step="0.01"
                        @change="savePricing(p)"
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        class="form-control form-control-sm"
                        v-model="p.outputPricePerMillion"
                        min="0"
                        step="0.01"
                        @change="savePricing(p)"
                      />
                    </td>
                    <td class="text-end">
                      <button class="btn btn-outline-danger btn-sm" @click="deletePricing(p.id)" title="Remover">
                        <i class="bi bi-trash"></i>
                      </button>
                    </td>
                  </tr>
                  <!-- New row form -->
                  <tr v-if="showNewPricingForm">
                    <td>
                      <select class="form-select form-select-sm" v-model="newPricing.provider">
                        <option value="openai">openai</option>
                        <option value="gemini">gemini</option>
                      </select>
                    </td>
                    <td>
                      <input type="text" class="form-control form-control-sm" v-model="newPricing.model" placeholder="ex: gpt-4o-mini" />
                    </td>
                    <td>
                      <input type="number" class="form-control form-control-sm" v-model="newPricing.inputPricePerMillion" min="0" step="0.01" placeholder="0.15" />
                    </td>
                    <td>
                      <input type="number" class="form-control form-control-sm" v-model="newPricing.outputPricePerMillion" min="0" step="0.01" placeholder="0.60" />
                    </td>
                    <td class="text-end">
                      <button class="btn btn-success btn-sm" @click="savePricing(newPricing)" :disabled="!newPricing.model || savingPricing">
                        <i class="bi bi-check"></i>
                      </button>
                      <button class="btn btn-outline-secondary btn-sm ms-1" @click="showNewPricingForm = false">
                        <i class="bi bi-x"></i>
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <button v-if="!showNewPricingForm" class="btn btn-outline-primary btn-sm" @click="showNewPricingForm = true">
              <i class="bi bi-plus me-1"></i>Adicionar modelo
            </button>
          </template>
        </div>
      </div>

      <!-- Domínio Próprio -->
      <div class="card border-0 shadow-sm mb-4">
        <div class="card-body">
          <h5 class="card-title mb-1">
            <i class="bi bi-globe2 me-2 text-primary"></i>Domínio Próprio
          </h5>
          <p class="text-muted small mb-4">
            Defina o valor cobrado dos clientes por domínio customizado (mensal e anual).
          </p>

          <div v-if="errorDomain" class="alert alert-danger py-2 small">{{ errorDomain }}</div>
          <div v-if="savedDomain" class="alert alert-success py-2 small">Preços de domínio salvos com sucesso.</div>

          <div v-if="loadingDomain" class="text-center py-3">
            <div class="spinner-border spinner-border-sm text-primary"></div>
          </div>
          <template v-else-if="domainModuleId">
            <div class="row g-3 mb-3">
              <div class="col-6">
                <label class="form-label fw-semibold mb-1">Mensal (R$)</label>
                <div class="input-group">
                  <span class="input-group-text">R$</span>
                  <input
                    type="number"
                    class="form-control"
                    v-model="domainPricing.monthly"
                    min="0"
                    step="0.01"
                    placeholder="9.90"
                  />
                </div>
              </div>
              <div class="col-6">
                <label class="form-label fw-semibold mb-1">Anual (R$)</label>
                <div class="input-group">
                  <span class="input-group-text">R$</span>
                  <input
                    type="number"
                    class="form-control"
                    v-model="domainPricing.yearly"
                    min="0"
                    step="0.01"
                    placeholder="99.00"
                  />
                </div>
              </div>
            </div>

            <button class="btn btn-primary" @click="saveDomainPricing" :disabled="savingDomain">
              <span v-if="savingDomain" class="spinner-border spinner-border-sm me-2"></span>
              <i v-else class="bi bi-floppy me-2"></i>
              Salvar preços de domínio
            </button>
          </template>
          <div v-else class="text-muted small">
            Módulo CUSTOM_DOMAIN não encontrado. Execute o seed de módulos primeiro.
          </div>
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

          <!-- Cotação USD→BRL -->
          <div class="mb-4 p-3 rounded-3 bg-light border">
            <label class="form-label fw-semibold mb-1">
              <i class="bi bi-currency-exchange me-1"></i>Cotação USD → BRL
            </label>
            <div class="input-group" style="max-width: 240px;">
              <span class="input-group-text">US$ 1 =</span>
              <input
                type="number"
                class="form-control"
                v-model="settings.usd_to_brl"
                min="0"
                step="0.01"
                placeholder="ex: 5.80"
              />
              <span class="input-group-text">BRL</span>
            </div>
            <div class="form-text">
              Taxa de câmbio para calcular custo real dos tokens em reais.
              Atualize manualmente conforme necessário.
            </div>
          </div>

          <!-- IP do Servidor para Domínios Customizados -->
          <div class="mb-4 p-3 rounded-3 bg-light border">
            <label class="form-label fw-semibold mb-1">
              <i class="bi bi-globe me-1"></i>IP do Servidor (Domínios Customizados)
            </label>
            <input
              type="text"
              class="form-control"
              style="max-width: 240px;"
              v-model="settings.custom_domain_server_ip"
              placeholder="ex: 123.45.67.89"
            />
            <div class="form-text">
              IP do servidor exibido nas instruções de DNS para clientes que configuram domínio próprio.
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
                    <th style="width: 120px;" class="text-end">Split (R$)</th>
                    <th style="width: 120px;" class="text-end">Resultado (R$)</th>
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
                    <td class="text-end text-muted">
                      R$ {{ ((creditServices[def.key] || 0) * 0.01).toFixed(2).replace('.', ',') }}
                    </td>
                    <td class="text-end fw-semibold" :class="brlPrice > 0 && (creditServices[def.key] || 0) * brlPrice - (creditServices[def.key] || 0) * 0.01 > 0 ? 'text-success' : 'text-danger'">
                      {{ brlPrice > 0 ? 'R$ ' + ((creditServices[def.key] || 0) * brlPrice - (creditServices[def.key] || 0) * 0.01).toFixed(2).replace('.', ',') : 'R$ —' }}
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
