<template>
  <div class="container-fluid py-4">
    <div class="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-4">
      <div>
        <h4 class="mb-1">Configuração Meta (Plataforma)</h4>
        <small class="text-muted">
          Credenciais do Meta App usadas por toda a plataforma para WhatsApp Cloud, Messenger e Instagram Direct.
        </small>
      </div>
      <div class="d-flex align-items-center gap-2">
        <span class="badge" :class="configured ? 'bg-success' : 'bg-light text-dark'">
          <i :class="configured ? 'bi bi-check-circle me-1' : 'bi bi-exclamation-circle me-1'"></i>
          {{ configured ? 'Configurado' : 'Não configurado' }}
        </span>
        <BaseButton
          variant="outline"
          size="sm"
          :loading="testing"
          :disabled="!configured || saving"
          @click="testConnection"
        >
          <i class="bi bi-plug me-1"></i> Testar conexão
        </BaseButton>
      </div>
    </div>

    <div v-if="loading" class="text-center py-5">
      <div class="spinner-border text-primary" role="status"></div>
    </div>

    <div v-else class="row g-4">
      <div class="col-lg-8">
        <!-- App Credentials -->
        <div class="card shadow-sm mb-4">
          <div class="card-body">
            <h6 class="card-title mb-3">
              <i class="bi bi-key me-1"></i> Credenciais do App
            </h6>

            <div class="mb-3">
              <TextInput
                v-model="form.appId"
                label="Meta App ID"
                placeholder="123456789012345"
                autocomplete="off"
              />
            </div>

            <div class="mb-3">
              <label class="form-label d-flex align-items-center justify-content-between">
                <strong>Meta App Secret</strong>
                <button
                  type="button"
                  class="btn btn-link btn-sm text-secondary p-0"
                  @click="showSecret = !showSecret"
                >
                  <i :class="showSecret ? 'bi bi-eye-slash' : 'bi bi-eye'" class="me-1"></i>
                  {{ showSecret ? 'Ocultar' : 'Mostrar' }}
                </button>
              </label>
              <TextInput
                v-model="form.appSecret"
                :type="showSecret ? 'text' : 'password'"
                :placeholder="configured ? '••••••••••••••••••••••••••••• (já configurado)' : 'Cole o App Secret aqui'"
                autocomplete="off"
              />
              <small class="text-muted d-block mt-1">
                Deixe em branco para manter o valor atual.
              </small>
            </div>

            <div class="mb-3">
              <label class="form-label"><strong>Graph API Version</strong></label>
              <SelectInput
                v-model="form.graphVersion"
                :options="graphVersions"
              />
            </div>
          </div>
        </div>

        <!-- Webhooks -->
        <div class="card shadow-sm mb-4">
          <div class="card-body">
            <h6 class="card-title mb-3">
              <i class="bi bi-link-45deg me-1"></i> Webhooks
            </h6>

            <div class="mb-3">
              <TextInput
                v-model="form.webhookBaseUrl"
                label="Webhook Base URL"
                placeholder="https://api.delivery.example.com/webhook/meta"
                autocomplete="off"
              />
              <small class="text-muted d-block mt-1">
                <i class="bi bi-info-circle me-1"></i>
                Cole esta URL no painel Meta App &gt; Webhooks (Callback URL).
              </small>
            </div>

            <div class="mb-3">
              <label class="form-label d-flex align-items-center justify-content-between">
                <strong>Webhook Verify Token</strong>
                <button
                  type="button"
                  class="btn btn-link btn-sm text-secondary p-0"
                  :disabled="regenerating"
                  @click="regenerateVerifyToken"
                >
                  <span v-if="regenerating" class="spinner-border spinner-border-sm me-1"></span>
                  <i v-else class="bi bi-arrow-clockwise me-1"></i>
                  Gerar novo
                </button>
              </label>
              <TextInput
                :model-value="form.webhookVerifyToken || ''"
                placeholder="Clique em 'Gerar novo' para criar um token"
                :input-class="'font-monospace'"
                autocomplete="off"
                @update:modelValue="form.webhookVerifyToken = $event"
              />
              <small class="text-muted d-block mt-1">
                Use este token no campo "Verify Token" do painel Meta App.
              </small>
            </div>
          </div>
        </div>

        <!-- App Review -->
        <div class="card shadow-sm mb-4">
          <div class="card-body">
            <h6 class="card-title mb-3">
              <i class="bi bi-shield-check me-1"></i> App Review Status
            </h6>

            <div class="d-flex gap-3 flex-wrap mb-2">
              <div class="form-check">
                <input
                  id="reviewDev"
                  class="form-check-input"
                  type="radio"
                  value="development"
                  v-model="form.appReviewStatus"
                />
                <label class="form-check-label" for="reviewDev">
                  <strong>Development</strong>
                </label>
              </div>
              <div class="form-check">
                <input
                  id="reviewLive"
                  class="form-check-input"
                  type="radio"
                  value="live"
                  v-model="form.appReviewStatus"
                />
                <label class="form-check-label" for="reviewLive">
                  <strong>Live</strong>
                </label>
              </div>
            </div>

            <div
              v-if="form.appReviewStatus === 'development'"
              class="alert alert-warning d-flex align-items-start gap-2 mb-0 small"
            >
              <i class="bi bi-exclamation-triangle-fill mt-1"></i>
              <div>
                Em <strong>Development</strong>, somente usuários adicionados como Testers/Admins no Meta App
                conseguem usar a integração. Mude para <strong>Live</strong> após App Review aprovado.
              </div>
            </div>
          </div>
        </div>

        <!-- Actions -->
        <div class="d-flex gap-2">
          <BaseButton
            variant="primary"
            :loading="saving"
            @click="save"
          >
            <i class="bi bi-save me-1"></i> Salvar
          </BaseButton>
          <BaseButton
            variant="outline"
            :disabled="saving"
            @click="load"
          >
            <i class="bi bi-arrow-counterclockwise me-1"></i> Descartar alterações
          </BaseButton>
        </div>

        <!-- Test result -->
        <div v-if="testResult" class="alert mt-3" :class="testResult.ok ? 'alert-success' : 'alert-danger'">
          <div class="d-flex align-items-start gap-2">
            <i :class="testResult.ok ? 'bi bi-check-circle-fill' : 'bi bi-x-circle-fill'" class="mt-1"></i>
            <div class="flex-grow-1">
              <strong>{{ testResult.ok ? 'Conexão OK' : 'Falha na conexão' }}</strong>
              <pre class="mb-0 mt-1 small" style="white-space: pre-wrap; word-break: break-word;">{{ formatTestResult(testResult) }}</pre>
            </div>
            <button type="button" class="btn-close" @click="testResult = null"></button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import Swal from 'sweetalert2'
import api from '../../api'
import BaseButton from '../../components/BaseButton.vue'
import TextInput from '../../components/form/input/TextInput.vue'
import SelectInput from '../../components/form/select/SelectInput.vue'

const loading = ref(true)
const saving = ref(false)
const testing = ref(false)
const regenerating = ref(false)
const configured = ref(false)
const showSecret = ref(false)
const testResult = ref(null)

const graphVersions = [
  { value: 'v21.0', label: 'v21.0 (recomendado)' },
  { value: 'v20.0', label: 'v20.0' },
  { value: 'v19.0', label: 'v19.0' },
  { value: 'v18.0', label: 'v18.0' },
]

// Backend masked secret prefix (so we can detect untouched mask on save)
const maskedSecretLoaded = ref('')

const form = ref({
  appId: '',
  appSecret: '',
  graphVersion: 'v21.0',
  webhookBaseUrl: '',
  webhookVerifyToken: '',
  appReviewStatus: 'development',
})

async function load() {
  loading.value = true
  testResult.value = null
  try {
    const { data } = await api.get('/admin/meta-config')
    if (data && data.configured) {
      configured.value = true
      form.value.appId = data.appId || ''
      form.value.appSecret = '' // never prefill the masked secret into the input
      maskedSecretLoaded.value = data.appSecret || ''
      form.value.graphVersion = data.graphVersion || 'v21.0'
      form.value.webhookBaseUrl = data.webhookBaseUrl || ''
      form.value.webhookVerifyToken = data.webhookVerifyToken || ''
      form.value.appReviewStatus = data.appReviewStatus || 'development'
    } else {
      configured.value = false
      maskedSecretLoaded.value = ''
      form.value = {
        appId: '',
        appSecret: '',
        graphVersion: 'v21.0',
        webhookBaseUrl: '',
        webhookVerifyToken: '',
        appReviewStatus: 'development',
      }
    }
  } catch (e) {
    Swal.fire({ icon: 'error', text: e?.response?.data?.message || 'Erro ao carregar configuração Meta' })
  } finally {
    loading.value = false
  }
}

async function save() {
  saving.value = true
  testResult.value = null
  try {
    // Sparse payload: omit appSecret if user didn't type one (keep existing).
    const payload = {
      appId: form.value.appId,
      graphVersion: form.value.graphVersion,
      webhookBaseUrl: form.value.webhookBaseUrl,
      appReviewStatus: form.value.appReviewStatus,
    }
    if (form.value.appSecret && form.value.appSecret.trim().length > 0) {
      payload.appSecret = form.value.appSecret.trim()
    }
    await api.put('/admin/meta-config', payload)
    Swal.fire({
      icon: 'success',
      text: 'Configuração Meta salva com sucesso',
      timer: 1500,
      showConfirmButton: false,
    })
    await load()
  } catch (e) {
    Swal.fire({ icon: 'error', text: e?.response?.data?.message || 'Erro ao salvar configuração Meta' })
  } finally {
    saving.value = false
  }
}

async function testConnection() {
  testing.value = true
  testResult.value = null
  try {
    const { data } = await api.post('/admin/meta-config/test')
    testResult.value = data || { ok: false, error: 'Resposta vazia' }
  } catch (e) {
    testResult.value = {
      ok: false,
      error: e?.response?.data?.error || e?.response?.data?.message || e?.message || 'Erro desconhecido',
    }
  } finally {
    testing.value = false
  }
}

async function regenerateVerifyToken() {
  const result = await Swal.fire({
    title: 'Gerar novo verify token?',
    text: 'O token atual deixará de funcionar e você precisará atualizá-lo no painel Meta App.',
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: 'Gerar novo',
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#105784',
  })
  if (!result.isConfirmed) return
  regenerating.value = true
  try {
    const { data } = await api.post('/admin/meta-config/regenerate-verify-token')
    if (data && data.token) {
      form.value.webhookVerifyToken = data.token
      configured.value = true
      Swal.fire({
        icon: 'success',
        text: 'Novo verify token gerado',
        timer: 1500,
        showConfirmButton: false,
      })
    }
  } catch (e) {
    Swal.fire({ icon: 'error', text: e?.response?.data?.message || 'Erro ao gerar verify token' })
  } finally {
    regenerating.value = false
  }
}

function formatTestResult(r) {
  if (!r) return ''
  if (r.ok) {
    try { return JSON.stringify(r.app, null, 2) } catch { return String(r.app) }
  }
  if (typeof r.error === 'string') return r.error
  try { return JSON.stringify(r.error, null, 2) } catch { return String(r.error) }
}

onMounted(load)
</script>

<style scoped>
.font-monospace {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.85rem;
}
</style>
