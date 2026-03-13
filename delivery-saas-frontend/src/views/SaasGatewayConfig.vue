<template>
  <div class="container-fluid py-4">
    <h4 class="mb-4">Gateway de Pagamento</h4>

    <div v-if="loading" class="text-center py-5">
      <div class="spinner-border text-primary"></div>
    </div>

    <div v-else class="row">
      <div class="col-lg-8">
        <div class="card shadow-sm mb-4">
          <div class="card-body">
            <h6 class="card-title mb-3">Provider</h6>

            <div class="mb-3">
              <label class="form-label">Gateway ativo</label>
              <select class="form-select" v-model="form.provider" @change="onProviderChange">
                <option value="">Selecione...</option>
                <option v-for="p in providers" :key="p.value" :value="p.value">{{ p.label }}</option>
              </select>
            </div>

            <div class="mb-3">
              <label class="form-label">Nome de exibição</label>
              <input type="text" class="form-control" v-model="form.displayName" />
            </div>

            <!-- Mercado Pago credentials -->
            <template v-if="form.provider === 'MERCADOPAGO'">
              <h6 class="mt-4 mb-3">Credenciais Mercado Pago</h6>
              <div class="mb-3">
                <label class="form-label">Access Token</label>
                <input type="password" class="form-control" v-model="form.credentials.accessToken"
                       :placeholder="hasCredentials ? '••••••• (já configurado)' : 'APP_USR-...'" />
              </div>
              <div class="mb-3">
                <label class="form-label">Public Key (opcional)</label>
                <input type="text" class="form-control" v-model="form.credentials.publicKey"
                       placeholder="APP_USR-..." />
              </div>
              <div class="mb-3">
                <label class="form-label">Webhook Secret (opcional)</label>
                <input type="text" class="form-control" v-model="form.webhookSecret"
                       placeholder="Deixe vazio para desabilitar validação" />
              </div>
            </template>

            <div class="mb-3">
              <label class="form-label">Taxa da plataforma (R$)</label>
              <input type="number" step="0.01" class="form-control" v-model.number="form.platformFee"
                     style="max-width: 200px" />
            </div>
          </div>
        </div>

        <!-- Billing Mode -->
        <div class="card shadow-sm mb-4">
          <div class="card-body">
            <h6 class="card-title mb-3">Modo de Cobrança</h6>
            <p class="text-muted small mb-3">Defina se a cobrança recorrente é automática (gateway cobra) ou manual (gera fatura, cliente paga).</p>

            <div class="row g-3">
              <div v-for="t in billingTypes" :key="t.key" class="col-md-4">
                <div class="card h-100">
                  <div class="card-body text-center">
                    <i :class="t.icon" class="fs-3 mb-2 d-block"></i>
                    <strong>{{ t.label }}</strong>
                    <div class="mt-2">
                      <div class="btn-group btn-group-sm w-100">
                        <button class="btn" :class="form.billingMode[t.key] === 'AUTO' ? 'btn-primary' : 'btn-outline-secondary'"
                                @click="form.billingMode[t.key] = 'AUTO'">Auto</button>
                        <button class="btn" :class="form.billingMode[t.key] === 'MANUAL' ? 'btn-primary' : 'btn-outline-secondary'"
                                @click="form.billingMode[t.key] = 'MANUAL'">Manual</button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Actions -->
        <div class="d-flex gap-2">
          <button class="btn btn-primary" @click="save" :disabled="saving">
            <span v-if="saving" class="spinner-border spinner-border-sm me-1"></span>
            Salvar
          </button>
          <button class="btn btn-outline-secondary" @click="testConnection" :disabled="testing">
            <span v-if="testing" class="spinner-border spinner-border-sm me-1"></span>
            Testar Conexão
          </button>
        </div>

        <div v-if="message" class="alert mt-3" :class="messageType === 'success' ? 'alert-success' : 'alert-danger'">
          {{ message }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import api from '../api.js'

const loading = ref(true)
const saving = ref(false)
const testing = ref(false)
const hasCredentials = ref(false)
const message = ref('')
const messageType = ref('success')

const providers = [
  { value: 'MERCADOPAGO', label: 'Mercado Pago' },
]

const billingTypes = [
  { key: 'plan', label: 'Plano', icon: 'bi bi-journal-check' },
  { key: 'module', label: 'Módulos', icon: 'bi bi-box-seam' },
  { key: 'credits', label: 'Créditos IA', icon: 'bi bi-stars' },
]

const form = ref({
  provider: '',
  displayName: '',
  credentials: { accessToken: '', publicKey: '' },
  webhookSecret: '',
  platformFee: 2.00,
  billingMode: { plan: 'MANUAL', module: 'MANUAL', credits: 'MANUAL' },
})

onMounted(async () => {
  try {
    const { data } = await api.get('/saas/gateway')
    if (data) {
      form.value.provider = data.provider || ''
      form.value.displayName = data.displayName || ''
      form.value.billingMode = data.billingMode || { plan: 'MANUAL', module: 'MANUAL', credits: 'MANUAL' }
      form.value.platformFee = Number(data.platformFee || 2)
      hasCredentials.value = data.hasCredentials || false
    }
  } catch (e) {
    console.error(e)
  } finally {
    loading.value = false
  }
})

function onProviderChange() {
  if (form.value.provider === 'MERCADOPAGO') {
    form.value.displayName = form.value.displayName || 'Mercado Pago'
  }
  form.value.credentials = { accessToken: '', publicKey: '' }
  hasCredentials.value = false
}

async function save() {
  saving.value = true
  message.value = ''
  try {
    const payload = {
      provider: form.value.provider,
      displayName: form.value.displayName,
      billingMode: form.value.billingMode,
      platformFee: form.value.platformFee,
    }
    if (form.value.credentials.accessToken) {
      payload.credentials = form.value.credentials
    }
    if (form.value.webhookSecret) {
      payload.webhookSecret = form.value.webhookSecret
    }

    await api.put('/saas/gateway', payload)
    hasCredentials.value = true
    message.value = 'Gateway salvo com sucesso!'
    messageType.value = 'success'
  } catch (e) {
    message.value = e.response?.data?.message || 'Erro ao salvar'
    messageType.value = 'error'
  } finally {
    saving.value = false
  }
}

async function testConnection() {
  testing.value = true
  message.value = ''
  try {
    const { data } = await api.post('/saas/gateway/test')
    message.value = data.message
    messageType.value = data.success ? 'success' : 'error'
  } catch (e) {
    message.value = e.response?.data?.message || 'Erro ao testar'
    messageType.value = 'error'
  } finally {
    testing.value = false
  }
}
</script>
