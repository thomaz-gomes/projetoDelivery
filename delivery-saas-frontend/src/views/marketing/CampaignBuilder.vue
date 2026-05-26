<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import api from '../../api'
import BaseButton from '../../components/BaseButton.vue'
import Swal from 'sweetalert2'

const router = useRouter()
const step = ref(1)
const form = ref({
  name: '',
  segmentId: '',
  channel: 'META_WA',
  templateId: '',
  freeText: '',
  scheduleType: 'ONE_SHOT',
  scheduledFor: '',
  conversionWindowHours: 48,
  attributionScope: 'menu',
})

const segments = ref([])
const audienceCount = ref(null)
const approvedTemplates = ref([])
const previewText = ref('')
const previewSeen = ref(false)
const preflight = ref({ eligible: 0, issues: [] })
const confirmCount = ref('')
const activating = ref(false)
const campaignId = ref(null)

const selectedSegment = computed(() => segments.value.find(s => s.id === form.value.segmentId))
const needsAudienceConfirm = computed(() => preflight.value.issues.some(i => i.code === 'large_audience'))
const canActivate = computed(() => {
  if (preflight.value.issues.some(i => i.severity === 'error')) return false
  if (needsAudienceConfirm.value && Number(confirmCount.value) !== preflight.value.eligible) return false
  return true
})

onMounted(async () => {
  try {
    const [segs, tpls] = await Promise.all([
      api.get('/marketing/segments'),
      api.get('/meta/templates').catch(() => ({ data: [] })),
    ])
    segments.value = segs.data
    approvedTemplates.value = (tpls.data || []).filter(t => t.status === 'APPROVED')
  } catch (e) {
    Swal.fire({ icon: 'error', text: 'Falha ao carregar dados iniciais' })
  }
})

async function loadAudienceCount() {
  if (!form.value.segmentId) return
  const seg = segments.value.find(s => s.id === form.value.segmentId)
  if (!seg) return
  try {
    const { data } = await api.post('/marketing/segments/preview', { ruleJson: seg.ruleJson })
    audienceCount.value = data.count
  } catch (e) {
    audienceCount.value = 0
  }
}

async function loadPreviewSample() {
  if (!form.value.segmentId) return
  try {
    const seg = segments.value.find(s => s.id === form.value.segmentId)
    const { data } = await api.post('/marketing/segments/preview', { ruleJson: seg.ruleJson })
    if (data.sample.length === 0) {
      previewText.value = '(sem amostra para preview)'
    } else {
      const cust = data.sample[0]
      const firstName = (cust.fullName || '').split(' ')[0] || 'Cliente'
      let txt = form.value.freeText || ''
      // Cloud preview: just show "Template: <name>" since template variables resolve server-side
      if (form.value.channel === 'META_WA' || (form.value.channel === 'AUTO' && form.value.templateId)) {
        const tpl = approvedTemplates.value.find(t => t.id === form.value.templateId)
        txt = tpl ? `[Template Cloud: ${tpl.name}]\n(O cliente verá o template com variáveis substituídas)` : '(sem template selecionado)'
      } else {
        txt = txt
          .replace(/\{nome\}/g, firstName)
          .replace(/\{cliente\}/g, cust.fullName || '')
          .replace(/\{cupom\}/g, 'EXEMPLO')
      }
      previewText.value = txt
    }
    previewSeen.value = true
  } catch (e) {
    previewText.value = 'Falha ao gerar preview'
    previewSeen.value = true
  }
}

async function persistDraft() {
  // First time creating: POST. Else PATCH.
  const payload = {
    name: form.value.name || `Campanha ${new Date().toLocaleDateString('pt-BR')}`,
    segmentId: form.value.segmentId,
    scheduleType: form.value.scheduleType,
    scheduledFor: form.value.scheduledFor ? new Date(form.value.scheduledFor).toISOString() : null,
    channel: form.value.channel,
    templateId: form.value.templateId || null,
    freeText: form.value.freeText || null,
    conversionWindowHours: Number(form.value.conversionWindowHours) || 48,
    attributionScope: form.value.attributionScope,
  }
  if (!campaignId.value) {
    const { data } = await api.post('/marketing/campaigns', payload)
    campaignId.value = data.id
  } else {
    await api.patch(`/marketing/campaigns/${campaignId.value}`, payload)
  }
}

async function goToReview() {
  try {
    await persistDraft()
    const { data } = await api.get(`/marketing/campaigns/${campaignId.value}/preflight`)
    preflight.value = data
    step.value = 4
  } catch (e) {
    Swal.fire({ icon: 'error', text: e?.response?.data?.message || 'Falha ao salvar rascunho' })
  }
}

async function activate() {
  activating.value = true
  try {
    const body = needsAudienceConfirm.value ? { confirmedCount: Number(confirmCount.value) } : {}
    await api.post(`/marketing/campaigns/${campaignId.value}/activate`, body)
    await Swal.fire({ icon: 'success', text: 'Campanha ativada com sucesso' })
    router.push(`/marketing/campaigns/${campaignId.value}`)
  } catch (e) {
    Swal.fire({ icon: 'error', text: e?.response?.data?.message || 'Falha ao ativar' })
  } finally { activating.value = false }
}
</script>

<template>
  <div class="container py-4">
    <h2 class="h4 mb-4">Nova campanha</h2>

    <!-- Progress -->
    <div class="d-flex mb-4 gap-2">
      <div v-for="n in 4" :key="n" class="flex-grow-1 text-center small"
           :class="step === n ? 'fw-bold text-primary' : 'text-muted'">
        {{ n }}. {{ ['Audiência','Mensagem','Quando','Revisar'][n-1] }}
      </div>
    </div>

    <!-- Step 1 -->
    <div v-if="step === 1" class="card">
      <div class="card-body">
        <h5>Audiência</h5>
        <div class="mb-3">
          <label class="form-label">Nome da campanha</label>
          <input v-model="form.name" class="form-control" placeholder="Ex: Reativação 30 dias - PIZZA30" />
        </div>
        <div class="mb-3">
          <label class="form-label">Segmento</label>
          <select v-model="form.segmentId" class="form-select" @change="loadAudienceCount">
            <option value="">Selecione...</option>
            <option v-for="s in segments" :key="s.id" :value="s.id">{{ s.name }}</option>
          </select>
          <router-link to="/marketing/segments/new" target="_blank" class="small mt-1 d-block">
            Criar novo segmento →
          </router-link>
        </div>
        <div v-if="audienceCount !== null" class="alert alert-info">
          📊 {{ audienceCount }} clientes elegíveis (com opt-in)
        </div>
        <div class="d-flex justify-content-end mt-4">
          <BaseButton variant="primary" :disabled="!form.segmentId || audienceCount === 0" @click="step = 2">Próximo →</BaseButton>
        </div>
      </div>
    </div>

    <!-- Step 2 -->
    <div v-if="step === 2" class="card">
      <div class="card-body">
        <h5>Mensagem</h5>

        <div class="mb-3">
          <label class="form-label">Canal</label>
          <div class="form-check">
            <input id="ch_meta" v-model="form.channel" type="radio" value="META_WA" class="form-check-input"/>
            <label for="ch_meta" class="form-check-label">Cloud API (oficial, recomendado)</label>
          </div>
          <div class="form-check">
            <input id="ch_evo" v-model="form.channel" type="radio" value="EVOLUTION_WA" class="form-check-input"/>
            <label for="ch_evo" class="form-check-label">Evolution (não-oficial, risco de banimento)</label>
          </div>
          <div class="form-check">
            <input id="ch_auto" v-model="form.channel" type="radio" value="AUTO" class="form-check-input"/>
            <label for="ch_auto" class="form-check-label">Automático (espelha último canal usado)</label>
          </div>
        </div>

        <div v-if="form.channel === 'META_WA' || form.channel === 'AUTO'" class="mb-3">
          <label class="form-label">Template aprovado</label>
          <select v-model="form.templateId" class="form-select">
            <option value="">Selecione um template...</option>
            <option v-for="t in approvedTemplates" :key="t.id" :value="t.id">{{ t.name }}</option>
          </select>
          <small v-if="!approvedTemplates.length" class="form-text text-warning">
            Nenhum template APPROVED encontrado. Crie um em Configurações → Templates WhatsApp.
          </small>
        </div>

        <div v-if="form.channel === 'EVOLUTION_WA'" class="mb-3">
          <div class="alert alert-warning small">
            <i class="bi bi-exclamation-triangle me-1"></i>
            Evolution não é oficial para marketing. WhatsApp pode banir o número se detectar spam.
          </div>
          <label class="form-label">Texto da mensagem</label>
          <textarea v-model="form.freeText" class="form-control" rows="5" placeholder="Olá {nome}, ..."></textarea>
          <small class="form-text">Placeholders: {nome}, {cliente}, {cupom}</small>
        </div>

        <div class="mt-3">
          <button class="btn btn-outline-secondary" @click="loadPreviewSample">Pré-visualizar com cliente real</button>
        </div>

        <div v-if="previewText" class="mt-3 p-3" style="background:#dcf8c6;border-radius:8px;max-width:420px;">
          <pre style="white-space:pre-wrap;font-family:inherit;margin:0">{{ previewText }}</pre>
        </div>

        <div class="d-flex justify-content-between mt-4">
          <BaseButton variant="outline" @click="step = 1">← Voltar</BaseButton>
          <BaseButton variant="primary" :disabled="!previewSeen" @click="step = 3">Próximo →</BaseButton>
        </div>
      </div>
    </div>

    <!-- Step 3 -->
    <div v-if="step === 3" class="card">
      <div class="card-body">
        <h5>Quando enviar</h5>

        <div class="form-check">
          <input id="sch_once" v-model="form.scheduleType" type="radio" value="ONE_SHOT" class="form-check-input"/>
          <label for="sch_once" class="form-check-label">Uma vez (One-shot)</label>
        </div>
        <div v-if="form.scheduleType === 'ONE_SHOT'" class="ms-4 mb-3">
          <input v-model="form.scheduledFor" type="datetime-local" class="form-control" />
          <small class="form-text">Deixe em branco para enviar imediatamente após ativação.</small>
        </div>

        <div class="form-check">
          <input type="radio" disabled class="form-check-input"/>
          <label class="form-check-label text-muted">Recorrente (em breve)</label>
        </div>
        <div class="form-check">
          <input type="radio" disabled class="form-check-input"/>
          <label class="form-check-label text-muted">Gatilho (aniversário, etc — em breve)</label>
        </div>

        <hr/>
        <div class="mb-3">
          <label class="form-label">Janela de conversão (horas)</label>
          <input v-model.number="form.conversionWindowHours" type="number" class="form-control" min="1" max="168" />
        </div>

        <div class="mb-3">
          <label class="form-label">Escopo de atribuição</label>
          <select v-model="form.attributionScope" class="form-select">
            <option value="menu">Apenas o cardápio do segmento</option>
            <option value="company">Qualquer cardápio da empresa</option>
          </select>
        </div>

        <div class="d-flex justify-content-between mt-4">
          <BaseButton variant="outline" @click="step = 2">← Voltar</BaseButton>
          <BaseButton variant="primary" @click="goToReview">Próximo →</BaseButton>
        </div>
      </div>
    </div>

    <!-- Step 4 -->
    <div v-if="step === 4" class="card">
      <div class="card-body">
        <h5>Revisar e ativar</h5>

        <div class="mb-3 small">
          <div><strong>Nome:</strong> {{ form.name }}</div>
          <div><strong>Segmento:</strong> {{ selectedSegment?.name }} ({{ preflight.eligible }} clientes)</div>
          <div><strong>Canal:</strong> {{ form.channel }}</div>
          <div><strong>Tipo:</strong> {{ form.scheduleType }} {{ form.scheduledFor ? `• Agendada para ${form.scheduledFor}` : '• Imediato' }}</div>
          <div><strong>Janela de conversão:</strong> {{ form.conversionWindowHours }}h</div>
          <div><strong>Escopo:</strong> {{ form.attributionScope }}</div>
        </div>

        <div v-if="preflight.issues.length" class="mb-3">
          <div v-for="(i, idx) in preflight.issues" :key="idx"
               class="alert" :class="{
                 'alert-danger':  i.severity === 'error',
                 'alert-warning': i.severity === 'warning',
                 'alert-info':    i.severity === 'confirm',
               }">
            {{ i.msg }}
          </div>
        </div>

        <div v-if="needsAudienceConfirm" class="mb-3">
          <label class="form-label">Para confirmar, digite exatamente: <strong>{{ preflight.eligible }}</strong></label>
          <input v-model.number="confirmCount" type="number" class="form-control" />
        </div>

        <div class="d-flex justify-content-between mt-4">
          <BaseButton variant="outline" @click="step = 3">← Voltar</BaseButton>
          <BaseButton variant="primary" :loading="activating" :disabled="!canActivate" @click="activate">
            🚀 Ativar campanha
          </BaseButton>
        </div>
      </div>
    </div>
  </div>
</template>
