<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import api from '../../api'
import BaseButton from '../../components/BaseButton.vue'
import MediaField from '../../components/MediaLibrary/MediaField.vue'
import { assetUrl } from '../../utils/assetUrl.js'
import Swal from 'sweetalert2'

const router = useRouter()
const step = ref(1)
const form = ref({
  name: '',
  segmentId: '',
  // channelKey is the operator-facing "which WhatsApp" picker. Format:
  //   "meta:<accountId>" → Cloud API number
  //   "evo:<instanceName>" → Evolution instance
  //   "" → AUTO (mirror customer's last conversation)
  // We derive channel/metaWaAccountId/evolutionInstanceName from this on save.
  channelKey: '',
  templateId: '',
  freeText: '',
  mediaUrl: null,
  scheduleType: 'ONE_SHOT',
  scheduledFor: '',
  conversionWindowHours: 48,
  attributionScope: 'menu',
  // Trigger-only fields (scheduleType=TRIGGER)
  triggerType: '',
  triggerDelayMinutes: 30,
  triggerMaxAgeHours: 23,
  triggerOnlyFirstTimeCustomers: false,
  triggerMinOrderValue: '',
  respectQuietHours: true,
  quietHoursStart: '23:00',
  quietHoursEnd: '09:00',
})

const segments = ref([])
const audienceCount = ref(null)
const channels = ref([])           // [{ key, type, label, status, official, ... }]
const approvedTemplates = ref([])
const previewText = ref('')
const previewSeen = ref(false)
const preflight = ref({ eligible: 0, issues: [] })
const confirmCount = ref('')
const activating = ref(false)
const campaignId = ref(null)

const selectedSegment = computed(() => segments.value.find(s => s.id === form.value.segmentId))
const selectedChannel = computed(() => channels.value.find(c => c.key === form.value.channelKey))
const channelType = computed(() => selectedChannel.value?.type || 'AUTO')
const isOfficial = computed(() => selectedChannel.value?.official ?? true)

// Templates filtered to the chosen Meta account (each template belongs to
// exactly one account — listing all approved would let the operator pick
// a template that won't render through the chosen number).
const templatesForChannel = computed(() => {
  if (channelType.value !== 'META_WA' || !selectedChannel.value?.metaWaAccountId) return []
  return approvedTemplates.value.filter(t => t.metaWaAccountId === selectedChannel.value.metaWaAccountId)
})

// Image attachment is only honored when:
//   - Evolution channel: always (sendMedia with caption)
//   - Cloud channel: only if the selected template has a HEADER of format=IMAGE
//     (Meta rejects header parameters that the template wasn't built to accept)
const selectedTemplate = computed(() => {
  if (!form.value.templateId) return null
  return approvedTemplates.value.find(t => t.id === form.value.templateId) || null
})
const templateSupportsImage = computed(() => {
  const tpl = selectedTemplate.value
  if (!tpl) return false
  const header = (tpl.components || []).find(c => String(c.type).toUpperCase() === 'HEADER')
  return header && String(header.format || '').toUpperCase() === 'IMAGE'
})
const canAttachImage = computed(() => {
  if (channelType.value === 'EVOLUTION_WA') return true
  if (channelType.value === 'META_WA') return templateSupportsImage.value
  // AUTO: image renders only if the resolved channel happens to be Evolution
  // OR the chosen template has IMAGE header. Show the field with a hint.
  if (channelType.value === 'AUTO') return true
  return false
})

// ── Live WhatsApp preview ──
// Renders the selected Cloud template (header/body/footer/buttons) or the
// Evolution free-text on the right of Step 2, mirroring the preview UX from
// the template editor. Cloud {{N}} placeholders and Evolution {nome}/{cliente}/
// {cupom} are replaced with bracketed labels so the operator sees the message
// shape without needing a real customer fetch.
function substituteCloudVars(text) {
  if (!text) return ''
  return String(text).replace(/\{\{(\d+)\}\}/g, (_, n) => `[var${n}]`)
}
function substituteFreeTextVars(text) {
  if (!text) return ''
  return String(text)
    .replace(/\{nome\}/g, '[Nome]')
    .replace(/\{cliente\}/g, '[Cliente]')
    .replace(/\{cupom\}/g, '[Cupom]')
}

const templateParts = computed(() => {
  const tpl = selectedTemplate.value
  if (!tpl) return null
  const comps = tpl.components || []
  const header = comps.find(c => String(c.type).toUpperCase() === 'HEADER') || null
  const body = comps.find(c => String(c.type).toUpperCase() === 'BODY') || null
  const footer = comps.find(c => String(c.type).toUpperCase() === 'FOOTER') || null
  const buttonsBlock = comps.find(c => String(c.type).toUpperCase() === 'BUTTONS') || null
  return {
    headerFormat: header?.format ? String(header.format).toUpperCase() : null,
    headerText: header?.format === 'TEXT' ? substituteCloudVars(header.text || '') : '',
    bodyText: substituteCloudVars(body?.text || ''),
    footerText: footer?.text || '',
    buttons: Array.isArray(buttonsBlock?.buttons) ? buttonsBlock.buttons.filter(b => b?.text) : [],
  }
})

const livePreviewMode = computed(() => {
  if (channelType.value === 'META_WA' && form.value.templateId) return 'template'
  if (channelType.value === 'AUTO' && form.value.templateId) return 'template'
  if (channelType.value === 'EVOLUTION_WA') return 'freeText'
  if (channelType.value === 'AUTO' && form.value.freeText) return 'freeText'
  return null
})

const livePreviewHint = computed(() => {
  if (!form.value.channelKey) return 'Selecione um canal acima para começar'
  if (channelType.value === 'META_WA' && !form.value.templateId) return 'Selecione um template aprovado'
  if (channelType.value === 'AUTO' && !form.value.templateId && !form.value.freeText) return 'Escolha um template ou digite o texto livre'
  if (channelType.value === 'EVOLUTION_WA' && !form.value.freeText) return 'Digite o texto da mensagem'
  return ''
})

const freeTextPreview = computed(() => substituteFreeTextVars(form.value.freeText))

const needsAudienceConfirm = computed(() => preflight.value.issues.some(i => i.code === 'large_audience'))
const canActivate = computed(() => {
  if (preflight.value.issues.some(i => i.severity === 'error')) return false
  if (needsAudienceConfirm.value && Number(confirmCount.value) !== preflight.value.eligible) return false
  return true
})

onMounted(async () => {
  try {
    const [segs, chans, tpls] = await Promise.all([
      api.get('/marketing/segments'),
      api.get('/marketing/campaigns/channels').catch(() => ({ data: [] })),
      api.get('/meta/templates').catch(() => ({ data: [] })),
    ])
    segments.value = segs.data
    channels.value = chans.data
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
      // Cloud preview: just show "Template: <name>" — variables resolve server-side
      if (channelType.value === 'META_WA' || (channelType.value === 'AUTO' && form.value.templateId)) {
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

function buildChannelPayload() {
  const ch = selectedChannel.value
  if (!ch) return { channel: 'AUTO', metaWaAccountId: null, evolutionInstanceName: null }
  return {
    channel: ch.type,
    metaWaAccountId: ch.metaWaAccountId || null,
    evolutionInstanceName: ch.evolutionInstanceName || null,
  }
}

async function persistDraft() {
  const chPart = buildChannelPayload()
  const payload = {
    name: form.value.name || `Campanha ${new Date().toLocaleDateString('pt-BR')}`,
    segmentId: form.value.segmentId,
    scheduleType: form.value.scheduleType,
    scheduledFor: form.value.scheduledFor ? new Date(form.value.scheduledFor).toISOString() : null,
    ...chPart,
    templateId: form.value.templateId || null,
    freeText: form.value.freeText || null,
    mediaUrl: form.value.mediaUrl || null,
    conversionWindowHours: Number(form.value.conversionWindowHours) || 48,
    attributionScope: form.value.attributionScope,
  }
  // Campos de TRIGGER — só envia se scheduleType=TRIGGER
  if (form.value.scheduleType === 'TRIGGER') {
    payload.triggerType = form.value.triggerType || null
    payload.triggerParams = {
      delayMinutes: Number(form.value.triggerDelayMinutes) || 30,
      maxAgeHours: Number(form.value.triggerMaxAgeHours) || 23,
      respectQuietHours: !!form.value.respectQuietHours,
      quietHoursStart: form.value.quietHoursStart || '23:00',
      quietHoursEnd: form.value.quietHoursEnd || '09:00',
      ...(form.value.triggerType === 'WINDOW_WITH_ORDER' ? {
        onlyFirstTimeCustomers: !!form.value.triggerOnlyFirstTimeCustomers,
        ...(form.value.triggerMinOrderValue ? { minOrderValue: Number(form.value.triggerMinOrderValue) } : {}),
      } : {}),
    }
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
    <div v-if="step === 2" class="row g-3">
      <div class="col-lg-7">
        <div class="card">
          <div class="card-body">
        <h5>Mensagem</h5>

        <div class="mb-3">
          <label class="form-label">Qual WhatsApp vai enviar</label>
          <select v-model="form.channelKey" class="form-select">
            <option value="">Automático (espelha último canal usado pelo cliente)</option>
            <optgroup v-if="channels.filter(c => c.type === 'META_WA').length" label="WhatsApp Cloud API (oficial)">
              <option v-for="c in channels.filter(ch => ch.type === 'META_WA')" :key="c.key" :value="c.key">
                {{ c.label }}{{ c.status !== 'ACTIVE' ? ' — ' + c.status : '' }}
              </option>
            </optgroup>
            <optgroup v-if="channels.filter(c => c.type === 'EVOLUTION_WA').length" label="Evolution (não-oficial)">
              <option v-for="c in channels.filter(ch => ch.type === 'EVOLUTION_WA')" :key="c.key" :value="c.key">
                {{ c.label }}{{ c.status !== 'CONNECTED' ? ' — ' + c.status : '' }}
              </option>
            </optgroup>
          </select>
          <small v-if="!channels.length" class="form-text text-warning d-block mt-1">
            <i class="bi bi-exclamation-triangle me-1"></i>
            Nenhum WhatsApp conectado. Conecte um número em
            <router-link to="/settings/whatsapp-cloud">WhatsApp Cloud API</router-link>
            ou <router-link to="/settings/whatsapp">Evolution</router-link> antes de criar campanhas.
          </small>
        </div>

        <!-- Evolution ban warning — keeps the operator honest about the risk. -->
        <div v-if="selectedChannel && !isOfficial" class="alert alert-warning small">
          <i class="bi bi-exclamation-triangle me-1"></i>
          <strong>{{ selectedChannel.label }}</strong> usa Evolution (não-oficial).
          O WhatsApp pode banir o número se detectar padrão de spam — use apenas em
          campanhas pequenas e com mensagens personalizadas. Considere migrar para Cloud API.
        </div>

        <!-- Cloud API (META_WA pinned OR AUTO mirror): template selector -->
        <div v-if="channelType === 'META_WA' || (channelType === 'AUTO' && !!form.templateId)" class="mb-3">
          <label class="form-label">Template aprovado</label>
          <select v-model="form.templateId" class="form-select">
            <option value="">Selecione um template...</option>
            <option
              v-for="t in (channelType === 'META_WA' ? templatesForChannel : approvedTemplates)"
              :key="t.id"
              :value="t.id"
            >{{ t.name }}</option>
          </select>
          <small v-if="channelType === 'META_WA' && !templatesForChannel.length" class="form-text text-warning">
            Nenhum template APPROVED para este número. Crie um em
            <router-link to="/settings/whatsapp-templates" target="_blank">Configurações → Templates WhatsApp</router-link>.
          </small>
        </div>

        <!-- Evolution: free-text editor -->
        <div v-if="channelType === 'EVOLUTION_WA'" class="mb-3">
          <label class="form-label">Texto da mensagem</label>
          <textarea v-model="form.freeText" class="form-control" rows="5" placeholder="Olá {nome}, ..."></textarea>
          <small class="form-text">Placeholders: {nome}, {cliente}, {cupom}</small>
        </div>

        <!-- AUTO mode without a pinned template: show the picker as a hint -->
        <div v-if="channelType === 'AUTO' && !form.templateId" class="mb-3">
          <label class="form-label">Template aprovado (opcional — usado se o canal escolhido for Cloud)</label>
          <select v-model="form.templateId" class="form-select">
            <option value="">Sem template (apenas Evolution)</option>
            <option v-for="t in approvedTemplates" :key="t.id" :value="t.id">{{ t.name }}</option>
          </select>
          <label class="form-label mt-2">Texto livre (usado se o canal escolhido for Evolution)</label>
          <textarea v-model="form.freeText" class="form-control" rows="3" placeholder="Olá {nome}, ..."></textarea>
        </div>

        <!-- Image attachment — biblioteca de mídia / upload -->
        <div v-if="canAttachImage" class="mb-3">
          <MediaField
            v-model="form.mediaUrl"
            label="Imagem (opcional)"
            field-id="campaign-media"
            :crop-aspect="1.91"
            :target-width="1600"
            :target-height="836"
          />
          <small v-if="channelType === 'META_WA' && !templateSupportsImage" class="form-text text-muted d-block mt-1">
            <i class="bi bi-info-circle me-1"></i>
            Selecione um template com cabeçalho do tipo imagem para enviar uma imagem por Cloud API.
          </small>
          <small v-else-if="channelType === 'AUTO'" class="form-text text-muted d-block mt-1">
            <i class="bi bi-info-circle me-1"></i>
            A imagem será enviada se o canal resolvido for Evolution OU se o template Cloud escolhido tiver cabeçalho de imagem.
          </small>
          <small v-else-if="channelType === 'EVOLUTION_WA'" class="form-text text-muted d-block mt-1">
            <i class="bi bi-info-circle me-1"></i>
            O texto acima será enviado como legenda da imagem.
          </small>
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
      </div>

      <!-- Live WhatsApp preview (sticky, right column) -->
      <div class="col-lg-5">
        <div class="card" style="position:sticky;top:80px">
          <div class="card-body">
            <h6 class="card-title mb-3">
              <i class="bi bi-whatsapp text-success me-1"></i>Pré-visualização
            </h6>
            <div style="background:#e5ddd5;padding:16px;border-radius:8px;min-height:220px">
              <div v-if="!livePreviewMode" class="text-muted small text-center py-4">
                {{ livePreviewHint }}
              </div>
              <div v-else style="background:#fff;border-radius:8px;padding:10px 14px;max-width:340px;box-shadow:0 1px 0.5px rgba(0,0,0,0.13)">
                <!-- Template (Cloud) preview -->
                <template v-if="livePreviewMode === 'template' && templateParts">
                  <div v-if="templateParts.headerFormat === 'IMAGE'" class="mb-2">
                    <img v-if="form.mediaUrl" :src="assetUrl(form.mediaUrl)" class="img-fluid rounded" alt="Header" />
                    <div v-else class="bg-secondary-subtle text-muted text-center py-4 rounded small">
                      <i class="bi bi-image me-1"></i>Imagem do template
                    </div>
                  </div>
                  <div v-else-if="templateParts.headerText" class="fw-semibold mb-2" style="font-size:0.92rem">
                    {{ templateParts.headerText }}
                  </div>

                  <div v-if="templateParts.bodyText" style="white-space:pre-wrap;font-size:0.9rem">{{ templateParts.bodyText }}</div>
                  <div v-else class="text-muted small fst-italic">(template sem corpo)</div>

                  <div v-if="templateParts.footerText" class="text-muted mt-2" style="font-size:0.78rem">{{ templateParts.footerText }}</div>

                  <div v-if="templateParts.buttons.length" class="mt-2 pt-2 border-top">
                    <div v-for="(b, i) in templateParts.buttons" :key="i" class="text-center text-primary small py-1 border-bottom" style="font-size:0.85rem">
                      <i v-if="String(b.type).toUpperCase() === 'URL'" class="bi bi-box-arrow-up-right me-1"></i>
                      <i v-else-if="String(b.type).toUpperCase() === 'PHONE_NUMBER'" class="bi bi-telephone me-1"></i>
                      {{ b.text }}
                    </div>
                  </div>
                </template>

                <!-- Free text (Evolution) preview -->
                <template v-else-if="livePreviewMode === 'freeText'">
                  <img v-if="form.mediaUrl" :src="assetUrl(form.mediaUrl)" class="img-fluid rounded mb-2" alt="Imagem" />
                  <div v-if="freeTextPreview" style="white-space:pre-wrap;font-size:0.9rem">{{ freeTextPreview }}</div>
                  <div v-else class="text-muted small fst-italic">Digite a mensagem...</div>
                </template>
              </div>
            </div>
            <div class="small text-muted mt-2">
              <i class="bi bi-info-circle me-1"></i>
              No envio real, [var1], [Nome], etc. são substituídos pelos dados do cliente.
            </div>
          </div>
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
          <input id="sch_trigger" v-model="form.scheduleType" type="radio" value="TRIGGER" class="form-check-input"/>
          <label for="sch_trigger" class="form-check-label">Gatilho automático</label>
        </div>

        <div v-if="form.scheduleType === 'TRIGGER'" class="ms-4 mb-3 mt-2 p-3 border rounded bg-light">
          <div class="alert alert-info small mb-3">
            <i class="bi bi-info-circle me-1"></i>
            <strong>Apenas para WhatsApp Cloud (META_WA):</strong> a campanha dispara mensagem livre
            <em>dentro da janela de 24h</em> aberta pelo cliente. Roda automaticamente em segundo plano
            (cron a cada minuto).
          </div>

          <div class="mb-3">
            <label class="form-label">Tipo de gatilho</label>
            <select v-model="form.triggerType" class="form-select">
              <option value="">Selecione...</option>
              <option value="WINDOW_NO_ORDER">Cliente abriu janela 24h mas <strong>não pediu</strong></option>
              <option value="WINDOW_WITH_ORDER">Cliente abriu janela 24h e <strong>fez pedido</strong></option>
            </select>
            <small class="form-text">
              <span v-if="form.triggerType === 'WINDOW_NO_ORDER'">
                Útil para engajar quem demonstrou interesse mas não converteu (oferece cupom, tira dúvida).
              </span>
              <span v-else-if="form.triggerType === 'WINDOW_WITH_ORDER'">
                Útil para pós-venda dentro da janela (agradecimento, pedido de review, upsell).
              </span>
            </small>
          </div>

          <div v-if="form.triggerType" class="row g-2">
            <div class="col-md-6 mb-3">
              <label class="form-label">Esperar quantos minutos antes de enviar</label>
              <input v-model.number="form.triggerDelayMinutes" type="number" class="form-control" min="1" max="1380" />
              <small class="form-text">
                Tempo desde {{ form.triggerType === 'WINDOW_NO_ORDER' ? 'a mensagem do cliente' : 'a criação do pedido' }}.
              </small>
            </div>
            <div class="col-md-6 mb-3">
              <label class="form-label">Janela máxima (horas)</label>
              <input v-model.number="form.triggerMaxAgeHours" type="number" class="form-control" min="1" max="23" />
              <small class="form-text">Não dispara após esse tempo (limite Meta: 24h).</small>
            </div>
          </div>

          <div v-if="form.triggerType === 'WINDOW_WITH_ORDER'" class="row g-2">
            <div class="col-md-6 mb-3">
              <label class="form-label">Valor mínimo do pedido (R$)</label>
              <input v-model="form.triggerMinOrderValue" type="number" class="form-control" min="0" step="0.01" placeholder="opcional" />
            </div>
            <div class="col-md-6 mb-3 d-flex align-items-end">
              <div class="form-check">
                <input id="trg_firsttime" v-model="form.triggerOnlyFirstTimeCustomers" type="checkbox" class="form-check-input" />
                <label for="trg_firsttime" class="form-check-label">Apenas clientes de primeira viagem</label>
              </div>
            </div>
          </div>

          <hr/>

          <div class="form-check mb-2">
            <input id="trg_quiet" v-model="form.respectQuietHours" type="checkbox" class="form-check-input" />
            <label for="trg_quiet" class="form-check-label">
              <strong>Respeitar horário silencioso</strong> (não enviar em horário inconveniente)
            </label>
          </div>

          <div v-if="form.respectQuietHours" class="row g-2 ms-3">
            <div class="col-md-6 mb-2">
              <label class="form-label">Não enviar a partir de</label>
              <input v-model="form.quietHoursStart" type="time" class="form-control" />
            </div>
            <div class="col-md-6 mb-2">
              <label class="form-label">Voltar a enviar a partir de</label>
              <input v-model="form.quietHoursEnd" type="time" class="form-control" />
            </div>
            <div class="col-12">
              <small class="form-text text-muted">
                Padrão 23:00–09:00. Mensagens que cairiam nesse intervalo são <strong>agendadas</strong> para o próximo horário válido.
                Se a janela de 24h da Meta vencer antes do horário liberar, a mensagem é <strong>descartada</strong> (registrada como SUPPRESSED_QUIET_HOURS para auditoria).
              </small>
            </div>
          </div>
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
          <div>
            <strong>WhatsApp:</strong>
            <template v-if="selectedChannel">
              {{ selectedChannel.label }}
              <span class="badge ms-1" :class="isOfficial ? 'bg-success' : 'bg-warning text-dark'">
                {{ isOfficial ? 'Cloud (oficial)' : 'Evolution (não-oficial)' }}
              </span>
            </template>
            <template v-else>Automático</template>
          </div>
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
