<template>
  <div class="container-fluid py-4">
    <div class="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-4">
      <div>
        <h4 class="mb-1">Evolution API · WhatsApp Baileys</h4>
        <small class="text-muted">
          Credenciais e endpoint da Evolution API (provider WhatsApp self-hosted). Substitui as variáveis
          <code>EVOLUTION_API_BASE_URL</code> e <code>EVOLUTION_API_API_KEY</code> do <code>.env</code>.
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
          :disabled="!form.baseUrl || saving"
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
        <!-- Credenciais -->
        <div class="card shadow-sm mb-4">
          <div class="card-body">
            <h6 class="card-title mb-3">
              <i class="bi bi-key me-1"></i> Credenciais
            </h6>

            <div class="mb-3">
              <TextInput
                v-model="form.baseUrl"
                label="Base URL"
                placeholder="https://evolution.meudominio.com.br"
                autocomplete="off"
              />
              <small class="text-muted d-block mt-1">
                URL pública da instalação da Evolution API (sem barra final).
                <span v-if="source.baseUrl === 'env'" class="text-warning">
                  <i class="bi bi-exclamation-triangle-fill"></i> Valor atual vem do .env — salve para migrar para o banco.
                </span>
              </small>
            </div>

            <div class="mb-3">
              <label class="form-label d-flex align-items-center justify-content-between">
                <strong>API Key</strong>
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
                v-model="form.apiKey"
                :type="showSecret ? 'text' : 'password'"
                :placeholder="maskedApiKey ? `${maskedApiKey} (já configurada)` : 'Cole a AUTHENTICATION_API_KEY'"
                autocomplete="off"
              />
              <small class="text-muted d-block mt-1">
                Deixe em branco para manter o valor atual.
                <span v-if="source.apiKey === 'env'" class="text-warning">
                  <i class="bi bi-exclamation-triangle-fill"></i> Valor atual vem do .env — salve para migrar para o banco.
                </span>
              </small>
            </div>
          </div>
        </div>

        <!-- Webhook -->
        <div class="card shadow-sm mb-4">
          <div class="card-body">
            <h6 class="card-title mb-3">
              <i class="bi bi-link-45deg me-1"></i> Webhook
            </h6>

            <div class="mb-3">
              <TextInput
                v-model="form.webhookUrl"
                label="Webhook URL"
                placeholder="https://api.meudominio.com.br/webhook/evolution"
                autocomplete="off"
              />
              <small class="text-muted d-block mt-1">
                URL que a Evolution vai chamar quando receber mensagens. Configure essa URL na criação de cada instância.
              </small>
            </div>

            <div class="mb-3">
              <label class="form-label"><strong>Webhook Verify Token</strong></label>
              <TextInput
                v-model="form.webhookToken"
                :placeholder="maskedWebhookToken ? `${maskedWebhookToken} (já configurado)` : 'Token opcional para validar callbacks'"
                :input-class="'font-monospace'"
                autocomplete="off"
              />
              <small class="text-muted d-block mt-1">
                Opcional. Quando preenchido, o webhook valida o header <code>apikey</code> contra este valor.
              </small>
            </div>
          </div>
        </div>

        <!-- Actions -->
        <div class="d-flex gap-2 mb-4">
          <BaseButton variant="primary" :loading="saving" @click="save">
            <i class="bi bi-save me-1"></i> Salvar
          </BaseButton>
          <BaseButton variant="outline" :disabled="saving" @click="load">
            <i class="bi bi-arrow-counterclockwise me-1"></i> Descartar alterações
          </BaseButton>
        </div>

        <!-- Test result -->
        <div v-if="testResult" class="alert mb-4" :class="testResult.ok ? 'alert-success' : 'alert-danger'">
          <div class="d-flex align-items-start gap-2">
            <i :class="testResult.ok ? 'bi bi-check-circle-fill' : 'bi bi-x-circle-fill'" class="mt-1"></i>
            <div class="flex-grow-1">
              <strong>{{ testResult.ok ? 'Conexão OK' : 'Falha na conexão' }}</strong>
              <pre class="mb-0 mt-1 small" style="white-space: pre-wrap; word-break: break-word;">{{ formatTestResult(testResult) }}</pre>
            </div>
            <button type="button" class="btn-close" @click="testResult = null"></button>
          </div>
        </div>

        <!-- Logs -->
        <div class="card shadow-sm">
          <div class="card-body">
            <div class="d-flex align-items-center justify-content-between mb-3">
              <h6 class="card-title mb-0">
                <i class="bi bi-list-task me-1"></i> Últimas requisições
              </h6>
              <BaseButton variant="outline" size="sm" :loading="loadingLogs" @click="loadLogs">
                <i class="bi bi-arrow-clockwise me-1"></i> Atualizar
              </BaseButton>
            </div>

            <div v-if="logs.length === 0" class="text-muted small text-center py-3">
              Nenhuma chamada registrada ainda.
            </div>
            <div v-else class="table-responsive">
              <table class="table table-sm align-middle mb-0 small">
                <thead>
                  <tr>
                    <th>Quando</th>
                    <th>Operação</th>
                    <th>Endpoint</th>
                    <th>Instância</th>
                    <th class="text-end">Status</th>
                    <th class="text-end">Duração</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in logs" :key="row.id" :class="rowClass(row)">
                    <td class="text-muted">{{ formatTime(row.createdAt) }}</td>
                    <td>{{ row.operation }}</td>
                    <td class="font-monospace small">{{ row.method }} {{ row.endpoint }}</td>
                    <td class="font-monospace small">{{ row.instanceName || '—' }}</td>
                    <td class="text-end">
                      <span v-if="row.status" class="badge" :class="badgeForStatus(row.status)">
                        {{ row.status }}
                      </span>
                      <span v-else class="text-danger">erro</span>
                    </td>
                    <td class="text-end text-muted">{{ row.durationMs != null ? `${row.durationMs}ms` : '—' }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div v-if="logs.length > 0" class="mt-2 small text-muted">
              Mantemos as últimas {{ logs.length }} chamadas (limite global: 1000).
            </div>
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

const loading = ref(true)
const saving = ref(false)
const testing = ref(false)
const configured = ref(false)
const showSecret = ref(false)
const testResult = ref(null)

const maskedApiKey = ref('')
const maskedWebhookToken = ref('')
const source = ref({ baseUrl: null, apiKey: null })

const form = ref({
  baseUrl: '',
  apiKey: '',
  webhookUrl: '',
  webhookToken: '',
})

const logs = ref([])
const loadingLogs = ref(false)

async function load() {
  loading.value = true
  testResult.value = null
  try {
    const { data } = await api.get('/admin/evolution-config')
    configured.value = !!data?.configured
    form.value.baseUrl = data?.baseUrl || ''
    form.value.apiKey = ''
    form.value.webhookUrl = data?.webhookUrl || ''
    form.value.webhookToken = ''
    maskedApiKey.value = data?.apiKey || ''
    maskedWebhookToken.value = data?.webhookToken || ''
    source.value = data?.source || { baseUrl: null, apiKey: null }
  } catch (e) {
    Swal.fire({ icon: 'error', text: e?.response?.data?.message || 'Erro ao carregar configuração' })
  } finally {
    loading.value = false
  }
  await loadLogs()
}

async function save() {
  saving.value = true
  testResult.value = null
  try {
    const payload = {
      baseUrl: (form.value.baseUrl || '').trim().replace(/\/$/, ''),
      webhookUrl: (form.value.webhookUrl || '').trim(),
    }
    if (form.value.apiKey && form.value.apiKey.trim()) {
      payload.apiKey = form.value.apiKey.trim()
    }
    if (form.value.webhookToken && form.value.webhookToken.trim()) {
      payload.webhookToken = form.value.webhookToken.trim()
    }
    await api.put('/admin/evolution-config', payload)
    Swal.fire({
      icon: 'success',
      text: 'Configuração salva com sucesso',
      timer: 1500,
      showConfirmButton: false,
    })
    await load()
  } catch (e) {
    Swal.fire({ icon: 'error', text: e?.response?.data?.message || 'Erro ao salvar configuração' })
  } finally {
    saving.value = false
  }
}

async function testConnection() {
  testing.value = true
  testResult.value = null
  try {
    const { data } = await api.post('/admin/evolution-config/test')
    testResult.value = data
  } catch (e) {
    testResult.value = e?.response?.data || { ok: false, error: e?.message || 'Erro desconhecido' }
  } finally {
    testing.value = false
  }
  await loadLogs()
}

async function loadLogs() {
  loadingLogs.value = true
  try {
    const { data } = await api.get('/admin/evolution-config/logs', { params: { limit: 50 } })
    logs.value = data?.items || []
  } catch {
    logs.value = []
  } finally {
    loadingLogs.value = false
  }
}

function formatTestResult(r) {
  if (!r) return ''
  if (r.ok) {
    return `HTTP ${r.status} — versão ${r.version || '?'}${r.message ? `\n${r.message}` : ''}`
  }
  if (typeof r.error === 'string') return r.error
  try { return JSON.stringify(r.error, null, 2) } catch { return String(r.error) }
}

function formatTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleTimeString('pt-BR', { hour12: false }) + ' ' + d.toLocaleDateString('pt-BR')
}

function badgeForStatus(s) {
  if (s >= 200 && s < 300) return 'bg-success'
  if (s >= 400 && s < 500) return 'bg-warning text-dark'
  return 'bg-danger'
}

function rowClass(row) {
  if (row.error) return 'table-danger'
  if (row.status >= 400) return 'table-warning'
  return ''
}

onMounted(load)
</script>

<style scoped>
.font-monospace {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.85rem;
}
</style>
