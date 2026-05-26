<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import api from '../../api'
import BaseButton from '../../components/BaseButton.vue'
import Swal from 'sweetalert2'

// Template builder for Meta WhatsApp Cloud API. Submits to Meta for
// approval; the result lands in the existing MetaTemplate cache with
// createdViaApp=true. Status polling is handled by the marketing worker
// (deferred to a follow-up PR — for now operator clicks "Sincronizar"
// on the list page to refresh).

const router = useRouter()

const accounts = ref([])
const loadingAccounts = ref(false)
const submitting = ref(false)
const error = ref('')

// Pré-fill defaults are sensible for a Brazil-first SMB deployment.
const form = ref({
  accountId: '',
  name: '',
  category: 'MARKETING',
  language: 'pt_BR',
  headerText: '',         // optional text header (image/video deferred)
  body: '',               // required
  footer: '',             // optional
  buttons: [],            // [{ type: 'URL'|'PHONE_NUMBER'|'QUICK_REPLY', text, url?, phone_number? }]
})

const CATEGORIES = [
  { value: 'MARKETING', label: 'Marketing — promoções, novidades, cross-sell' },
  { value: 'UTILITY', label: 'Utilidade — notificação de pedido, lembrete, alerta' },
  { value: 'AUTHENTICATION', label: 'Autenticação — códigos OTP' },
]

const LANGUAGES = [
  { value: 'pt_BR', label: 'Português (Brasil)' },
  { value: 'en_US', label: 'English (US)' },
  { value: 'es_ES', label: 'Español' },
]

const BUTTON_TYPES = [
  { value: 'QUICK_REPLY', label: 'Resposta rápida' },
  { value: 'URL', label: 'Link (URL)' },
  { value: 'PHONE_NUMBER', label: 'Telefone' },
]

// Detect {{N}} variables in body — Meta requires them sequential starting at 1
const bodyVariables = computed(() => {
  const matches = (form.value.body || '').match(/\{\{(\d+)\}\}/g) || []
  const nums = new Set(matches.map(m => Number(m.replace(/[{}]/g, ''))))
  return Array.from(nums).sort((a, b) => a - b)
})

const variablesValid = computed(() => {
  // Variables must be sequential 1..N (no gaps)
  for (let i = 0; i < bodyVariables.value.length; i++) {
    if (bodyVariables.value[i] !== i + 1) return false
  }
  return true
})

const canSubmit = computed(() => {
  if (!form.value.accountId) return false
  if (!form.value.name || !/^[a-z0-9_]+$/.test(form.value.name)) return false
  if (!form.value.body || form.value.body.trim().length < 1) return false
  if (!variablesValid.value) return false
  return true
})

const bodyPreview = computed(() => {
  let txt = form.value.body
  // Substitute {{N}} with sample values for preview
  txt = txt.replace(/\{\{(\d+)\}\}/g, (_, n) => `[var${n}]`)
  return txt
})

onMounted(async () => {
  loadingAccounts.value = true
  try {
    const { data } = await api.get('/auth/meta/connected')
    const all = Array.isArray(data?.accounts) ? data.accounts : []
    accounts.value = all.filter(a => a.provider === 'META_WA')
    if (accounts.value.length && !form.value.accountId) {
      form.value.accountId = accounts.value[0].id
    }
  } catch (e) {
    error.value = 'Falha ao carregar contas WhatsApp conectadas'
  } finally { loadingAccounts.value = false }
})

function addButton() {
  if (form.value.buttons.length >= 3) return
  form.value.buttons.push({ type: 'QUICK_REPLY', text: '' })
}

function removeButton(idx) {
  form.value.buttons.splice(idx, 1)
}

function insertVariable() {
  const next = bodyVariables.value.length + 1
  form.value.body = (form.value.body || '') + `{{${next}}}`
}

function buildComponents() {
  const out = []
  if (form.value.headerText && form.value.headerText.trim()) {
    out.push({
      type: 'HEADER',
      format: 'TEXT',
      text: form.value.headerText.trim(),
    })
  }
  out.push({
    type: 'BODY',
    text: form.value.body.trim(),
  })
  if (form.value.footer && form.value.footer.trim()) {
    out.push({
      type: 'FOOTER',
      text: form.value.footer.trim(),
    })
  }
  if (form.value.buttons.length > 0) {
    const buttons = form.value.buttons
      .filter(b => b.text && b.text.trim())
      .map(b => {
        const base = { type: b.type, text: b.text.trim() }
        if (b.type === 'URL' && b.url) base.url = b.url.trim()
        if (b.type === 'PHONE_NUMBER' && b.phone_number) base.phone_number = b.phone_number.trim()
        return base
      })
    if (buttons.length) out.push({ type: 'BUTTONS', buttons })
  }
  return out
}

async function submit() {
  if (!canSubmit.value) return
  submitting.value = true
  error.value = ''
  try {
    const payload = {
      accountId: form.value.accountId,
      name: form.value.name,
      language: form.value.language,
      category: form.value.category,
      components: buildComponents(),
    }
    await api.post('/meta/templates', payload)
    await Swal.fire({
      icon: 'success',
      title: 'Template submetido',
      text: 'A Meta vai aprovar em até 24h. Você pode acompanhar o status na lista.',
      timer: 3500,
      showConfirmButton: false,
    })
    router.push('/settings/whatsapp-templates')
  } catch (e) {
    const metaErr = e?.response?.data?.meta
    const msg = metaErr?.message || e?.response?.data?.message || 'Erro ao submeter template'
    error.value = msg
    Swal.fire({ icon: 'error', title: 'Falha ao submeter', text: msg })
  } finally { submitting.value = false }
}
</script>

<template>
  <div class="container py-4">
    <div class="d-flex align-items-center justify-content-between mb-4">
      <div>
        <h2 class="h4 mb-1">Novo template WhatsApp</h2>
        <small class="text-muted">
          Será submetido à Meta para aprovação. Em geral leva alguns minutos a 24h.
        </small>
      </div>
      <BaseButton variant="outline" @click="router.push('/settings/whatsapp-templates')">
        <i class="bi bi-arrow-left me-1"></i> Voltar
      </BaseButton>
    </div>

    <div v-if="error" class="alert alert-danger">
      <i class="bi bi-exclamation-triangle me-1"></i>{{ error }}
    </div>

    <div v-if="loadingAccounts" class="text-center py-5">
      <div class="spinner-border text-primary"></div>
    </div>

    <div v-else-if="!accounts.length" class="alert alert-warning">
      Nenhum número WhatsApp Cloud conectado. Conecte um em
      <router-link to="/settings/whatsapp-cloud">WhatsApp Cloud API</router-link> antes de criar templates.
    </div>

    <div v-else class="row g-3">
      <!-- Form (left) -->
      <div class="col-lg-7">
        <div class="card mb-3">
          <div class="card-body">
            <h6 class="card-title">Conta WhatsApp</h6>
            <select v-model="form.accountId" class="form-select">
              <option v-for="a in accounts" :key="a.id" :value="a.id">
                {{ a.displayName || a.externalId }}
              </option>
            </select>
          </div>
        </div>

        <div class="card mb-3">
          <div class="card-body">
            <h6 class="card-title">Identificação</h6>
            <div class="mb-3">
              <label class="form-label">Nome interno <span class="text-danger">*</span></label>
              <input
                v-model="form.name"
                class="form-control"
                placeholder="reativacao_30d_promo"
                pattern="^[a-z0-9_]+$"
              />
              <small class="form-text">
                Apenas letras minúsculas, números e underscore (_). Não pode mudar depois de submetido.
              </small>
              <small v-if="form.name && !/^[a-z0-9_]+$/.test(form.name)" class="text-danger d-block">
                Nome inválido — use só minúsculas, números e _.
              </small>
            </div>
            <div class="row g-2">
              <div class="col-md-6">
                <label class="form-label">Categoria <span class="text-danger">*</span></label>
                <select v-model="form.category" class="form-select">
                  <option v-for="c in CATEGORIES" :key="c.value" :value="c.value">{{ c.label }}</option>
                </select>
              </div>
              <div class="col-md-6">
                <label class="form-label">Idioma <span class="text-danger">*</span></label>
                <select v-model="form.language" class="form-select">
                  <option v-for="l in LANGUAGES" :key="l.value" :value="l.value">{{ l.label }}</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        <div class="card mb-3">
          <div class="card-body">
            <h6 class="card-title">Conteúdo</h6>

            <div class="mb-3">
              <label class="form-label">Cabeçalho (opcional)</label>
              <input
                v-model="form.headerText"
                class="form-control"
                placeholder="Sentimos sua falta, {{1}}!"
                maxlength="60"
              />
              <small class="form-text">Até 60 caracteres. Suporta 1 variável.</small>
            </div>

            <div class="mb-3">
              <label class="form-label d-flex justify-content-between">
                <span>Corpo <span class="text-danger">*</span></span>
                <button type="button" class="btn btn-sm btn-link p-0" @click="insertVariable">
                  + Inserir variável
                </button>
              </label>
              <textarea
                v-model="form.body"
                class="form-control"
                rows="6"
                placeholder="Olá {{1}}, faz tempo que não te vemos!&#10;Use o cupom {{2}} pra um desconto de {{3}}% no seu próximo pedido."
                maxlength="1024"
              ></textarea>
              <small class="form-text">
                Até 1024 caracteres. Use {{ '{{1}}' }}, {{ '{{2}}' }}, etc. para variáveis (substituídas no envio).
              </small>
              <small v-if="bodyVariables.length > 0" class="d-block mt-1">
                <span v-if="variablesValid" class="text-success">
                  <i class="bi bi-check-circle me-1"></i>{{ bodyVariables.length }} variável(is) detectada(s)
                </span>
                <span v-else class="text-danger">
                  <i class="bi bi-exclamation-triangle me-1"></i>
                  Variáveis devem ser sequenciais começando em {{ '{{1}}' }} (sem pular números).
                </span>
              </small>
            </div>

            <div class="mb-3">
              <label class="form-label">Rodapé (opcional)</label>
              <input
                v-model="form.footer"
                class="form-control"
                placeholder="Para cancelar promoções, responda PARAR."
                maxlength="60"
              />
              <small class="form-text">Até 60 caracteres. Sem variáveis.</small>
            </div>
          </div>
        </div>

        <div class="card mb-3">
          <div class="card-body">
            <div class="d-flex align-items-center justify-content-between mb-2">
              <h6 class="card-title mb-0">Botões (opcional, até 3)</h6>
              <button class="btn btn-sm btn-outline-primary" @click="addButton" :disabled="form.buttons.length >= 3">
                + Adicionar botão
              </button>
            </div>
            <div v-if="!form.buttons.length" class="small text-muted">
              Sem botões. Adicione "Resposta rápida", "Link" ou "Telefone".
            </div>
            <div v-for="(btn, i) in form.buttons" :key="i" class="border rounded p-2 mb-2">
              <div class="d-flex gap-2 align-items-center mb-2">
                <select v-model="btn.type" class="form-select form-select-sm" style="max-width:180px">
                  <option v-for="t in BUTTON_TYPES" :key="t.value" :value="t.value">{{ t.label }}</option>
                </select>
                <input v-model="btn.text" class="form-control form-control-sm" placeholder="Texto do botão" maxlength="25" />
                <button class="btn btn-sm btn-link p-0 text-danger" @click="removeButton(i)">
                  <i class="bi bi-x-circle"></i>
                </button>
              </div>
              <input v-if="btn.type === 'URL'" v-model="btn.url" class="form-control form-control-sm" placeholder="https://exemplo.com" />
              <input v-if="btn.type === 'PHONE_NUMBER'" v-model="btn.phone_number" class="form-control form-control-sm" placeholder="+5573991234567" />
            </div>
          </div>
        </div>

        <div class="d-flex gap-2 justify-content-end">
          <BaseButton variant="outline" @click="router.push('/settings/whatsapp-templates')">Cancelar</BaseButton>
          <BaseButton variant="primary" :loading="submitting" :disabled="!canSubmit" @click="submit">
            <i class="bi bi-cloud-arrow-up me-1"></i> Enviar para aprovação
          </BaseButton>
        </div>
      </div>

      <!-- Preview (right, sticky) -->
      <div class="col-lg-5">
        <div class="card" style="position:sticky;top:80px">
          <div class="card-body">
            <h6 class="card-title">Pré-visualização</h6>
            <div style="background:#e5ddd5;padding:16px;border-radius:8px;min-height:200px">
              <div style="background:#fff;border-radius:8px;padding:10px 14px;max-width:340px;box-shadow:0 1px 0.5px rgba(0,0,0,0.13)">
                <div v-if="form.headerText" class="fw-semibold mb-2">{{ form.headerText }}</div>
                <div v-if="form.body" style="white-space:pre-wrap;font-size:0.9rem">{{ bodyPreview }}</div>
                <div v-else class="text-muted small fst-italic">Digite o corpo da mensagem...</div>
                <div v-if="form.footer" class="text-muted small mt-2" style="font-size:0.78rem">{{ form.footer }}</div>
                <div v-if="form.buttons.length > 0" class="mt-2 pt-2 border-top">
                  <div v-for="(b, i) in form.buttons.filter(x => x.text)" :key="i" class="text-center text-primary small py-1 border-bottom" style="font-size:0.85rem">
                    <i v-if="b.type === 'URL'" class="bi bi-box-arrow-up-right me-1"></i>
                    <i v-else-if="b.type === 'PHONE_NUMBER'" class="bi bi-telephone me-1"></i>
                    {{ b.text }}
                  </div>
                </div>
              </div>
            </div>
            <div class="small text-muted mt-2">
              <i class="bi bi-info-circle me-1"></i>
              No envio real, [var1], [var2]... são substituídos pelos valores reais do cliente/campanha.
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
