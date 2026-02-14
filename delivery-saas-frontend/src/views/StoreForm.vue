<template>
  <div class="container mt-3">
    <h2 v-if="isNew">Nova Loja</h2>
    <h2 v-else>Editar Loja</h2>

    <div class="card mt-3">
      <div class="card-body">
        <div v-if="loading" class="text-center">Carregando...</div>
        <div v-else>
          <ul class="nav nav-tabs mb-3">
                  <li class="nav-item"><a class="nav-link" :class="{active: activeTab==='geral'}" href="#" @click.prevent="setActiveTab('geral')">Geral</a></li>
                  <li class="nav-item"><a class="nav-link" :class="{active: activeTab==='fiscal'}" href="#" @click.prevent="setActiveTab('fiscal')">Fiscal</a></li>
                </ul>

                <div v-show="activeTab==='geral'">
            <div class="mb-3"><TextInput label="Nome" labelClass="form-label" v-model="form.name" inputClass="form-control" /></div>
                <div class="mb-3 form-check form-switch">
                  <input class="form-check-input" type="checkbox" id="store-active" :checked="form.isActive" @change.prevent="handleActiveToggle($event)" />
                  <label class="form-check-label small" for="store-active">Loja ativa</label>
                </div>
                <div v-if="remainingPauseText" class="mt-2">
                  <small class="text-muted">Pausa ativa: <strong>{{ remainingPauseText }}</strong></small>
                  <button class="btn btn-sm btn-link" @click.prevent="clearPauseNow">Cancelar pausa</button>
                </div>
              <div class="mb-3"><TextInput label="Slug público (opcional)" labelClass="form-label" v-model="form.slug" placeholder="ex: nomedaloja" inputClass="form-control" />
                <div class="form-text small">Se preenchido, a URL pública ficará em <code>/public/SEU_SLUG</code>. Caso vazio, o sistema gerará/resolve um slug automaticamente.</div>
              </div>
            <div class="mb-3"><TextInput label="Endereço" labelClass="form-label" v-model="form.address" inputClass="form-control" /></div>
            <div class="mb-3"><TextInput label="Telefone" labelClass="form-label" v-model="form.phone" placeholder="(00) 0000-0000" maxlength="15" inputClass="form-control" @input="handlePhoneInput" /></div>
            <div class="mb-3"><TextInput label="WhatsApp" labelClass="form-label" v-model="form.whatsapp" placeholder="(00) 0 0000-0000" maxlength="16" inputClass="form-control" @input="handleWhatsAppInput" /></div>
            <div class="row">
              <div class="col-md-6 mb-3">
                <MediaField v-model="form.bannerUrl" label="Banner" field-id="store-banner" />
              </div>
              <div class="col-md-6 mb-3">
                <MediaField v-model="form.logoUrl" label="Logotipo" field-id="store-logo" />
              </div>
            </div>
          </div>

          <!-- Horário moved to menu configuration; store-level schedule removed -->

          <div v-show="activeTab==='fiscal'">

            <!-- ── Dados do Emitente ── -->
            <div class="card mb-4">
              <div class="card-header"><h6 class="mb-0"><i class="bi bi-building me-2"></i>Dados do Emitente</h6></div>
              <div class="card-body">
                <div class="row g-3">
                  <div class="col-md-4">
                    <TextInput label="CNPJ" labelClass="form-label fw-semibold" v-model="form.cnpj" placeholder="00.000.000/0000-00" inputClass="form-control" />
                  </div>
                  <div class="col-md-4">
                    <TextInput label="Inscrição Estadual (IE)" labelClass="form-label fw-semibold" v-model="form.ie" placeholder="ISENTO ou número" inputClass="form-control" />
                  </div>
                  <div class="col-md-4">
                    <label class="form-label fw-semibold">Timezone</label>
                    <select class="form-select" v-model="form.timezone">
                      <option v-for="tz in TIMEZONES" :key="tz" :value="tz">{{ tz }}</option>
                    </select>
                    <div class="form-text">Ex: <strong>America/Sao_Paulo</strong></div>
                  </div>
                  <div class="col-12">
                    <TextInput label="Razão Social" labelClass="form-label fw-semibold" v-model="form.razaoSocial" placeholder="Nome empresarial completo" inputClass="form-control" />
                  </div>
                </div>
              </div>
            </div>

            <!-- ── Endereço do Emitente ── -->
            <div class="card mb-4">
              <div class="card-header"><h6 class="mb-0"><i class="bi bi-geo-alt me-2"></i>Endereço do Emitente</h6></div>
              <div class="card-body">
                <div class="row g-3">
                  <div class="col-md-8">
                    <TextInput label="Logradouro" labelClass="form-label fw-semibold" v-model="form.enderEmit.xLgr" inputClass="form-control" />
                  </div>
                  <div class="col-md-4">
                    <TextInput label="Número" labelClass="form-label fw-semibold" v-model="form.enderEmit.nro" inputClass="form-control" />
                  </div>
                  <div class="col-md-4">
                    <TextInput label="Bairro" labelClass="form-label fw-semibold" v-model="form.enderEmit.xBairro" inputClass="form-control" />
                  </div>
                  <div class="col-md-4">
                    <TextInput label="Município" labelClass="form-label fw-semibold" v-model="form.enderEmit.xMun" inputClass="form-control" />
                  </div>
                  <div class="col-md-2">
                    <TextInput label="UF" labelClass="form-label fw-semibold" v-model="form.enderEmit.UF" placeholder="BA" maxlength="2" inputClass="form-control" />
                  </div>
                  <div class="col-md-2">
                    <TextInput label="CEP" labelClass="form-label fw-semibold" v-model="form.enderEmit.CEP" inputClass="form-control" />
                  </div>
                  <div class="col-md-4">
                    <TextInput label="Cód. Município (IBGE)" labelClass="form-label fw-semibold" v-model="form.enderEmit.cMun" placeholder="Ex: 2927408" inputClass="form-control" />
                  </div>
                </div>
              </div>
            </div>

            <!-- ── Configurações NF-e ── -->
            <div class="card mb-4">
              <div class="card-header"><h6 class="mb-0"><i class="bi bi-file-earmark-text me-2"></i>Configurações NF-e</h6></div>
              <div class="card-body">
                <div class="row g-3">
                  <div class="col-md-3">
                    <TextInput label="Série" labelClass="form-label fw-semibold" v-model="form.nfeSerie" placeholder="1" inputClass="form-control" />
                  </div>
                  <div class="col-md-3">
                    <label class="form-label fw-semibold">Ambiente</label>
                    <select class="form-select" v-model="form.nfeEnvironment">
                      <option value="homologation">Homologação (testes)</option>
                      <option value="production">Produção</option>
                    </select>
                  </div>
                  <div class="col-md-3">
                    <TextInput label="CSC (Token)" labelClass="form-label fw-semibold" v-model="form.csc" inputClass="form-control" />
                  </div>
                  <div class="col-md-3">
                    <TextInput label="CSC ID (Seq.)" labelClass="form-label fw-semibold" v-model="form.cscId" inputClass="form-control" />
                  </div>
                </div>
              </div>
            </div>

            <!-- ── Certificado Digital ── -->
            <div class="card mb-4">
              <div class="card-header"><h6 class="mb-0"><i class="bi bi-shield-lock me-2"></i>Certificado Digital A1 (PFX)</h6></div>
              <div class="card-body">
                <p class="text-muted small mb-3">Faça upload do arquivo <code>.pfx</code> da loja para emitir NF-e com o CNPJ desta loja.</p>

                <!-- Estado: arquivo novo selecionado -->
                <div v-if="form.certFileName || form.certBase64" class="alert alert-info d-flex align-items-center justify-content-between py-2 mb-3">
                  <div>
                    <i class="bi bi-file-earmark-check me-2"></i>
                    <strong>Novo arquivo:</strong> {{ form.certFileName || 'Selecionado' }}
                  </div>
                  <button class="btn btn-sm btn-outline-secondary" type="button" @click="clearSelectedCert">
                    <i class="bi bi-x-lg me-1"></i>Remover
                  </button>
                </div>

                <!-- Estado: certificado já armazenado -->
                <div v-else-if="form.storedCertExists" class="alert alert-success d-flex flex-column gap-2 py-2 mb-3">
                  <div class="d-flex align-items-center">
                    <i class="bi bi-patch-check-fill me-2"></i>
                    <div>
                      <strong>Certificado armazenado</strong>
                      <div class="small opacity-75">{{ form.storedCertFilename || 'arquivo.pfx' }} · Senha armazenada: <strong>{{ form.storedCertPasswordStored ? 'Sim' : 'Não' }}</strong></div>
                    </div>
                  </div>
                  <div class="d-flex gap-2">
                    <button class="btn btn-sm btn-outline-primary" type="button" @click.prevent="triggerCertInput" :disabled="saving">
                      <i class="bi bi-arrow-repeat me-1"></i>Substituir
                    </button>
                    <button class="btn btn-sm btn-outline-danger" type="button" @click.prevent="confirmDeleteCert" :disabled="saving">
                      <i class="bi bi-trash me-1"></i>Remover
                    </button>
                  </div>
                </div>

                <!-- Estado: nenhum certificado -->
                <div v-else class="mb-3">
                  <label class="form-label fw-semibold">Arquivo do certificado</label>
                  <input ref="certInput" type="file" accept=".pfx,.p12" class="form-control" @change="onCertFileChange($event)" />
                </div>

                <!-- Input file oculto para substituição -->
                <input v-if="form.storedCertExists || form.certBase64" ref="certInput" type="file" accept=".pfx,.p12" class="d-none" @change="onCertFileChange($event)" />

                <div class="row g-3 mt-1">
                  <div class="col-md-6">
                    <TextInput label="Senha do PFX" labelClass="form-label fw-semibold" v-model="form.certPassword" placeholder="Deixe vazio para manter a atual" inputClass="form-control" />
                    <div class="form-text">Necessária apenas ao enviar um novo certificado ou alterar a senha.</div>
                  </div>
                  <div class="col-md-6 d-flex align-items-end pb-1">
                    <div class="form-check">
                      <input class="form-check-input" type="checkbox" id="clearCert" v-model="form.clearCert">
                      <label class="form-check-label small" for="clearCert">Limpar certificado armazenado ao salvar</label>
                    </div>
                  </div>
                </div>

                <!-- Botão de diagnóstico SEFAZ -->
                <div class="mt-3 pt-3 border-top">
                  <button class="btn btn-sm btn-outline-warning" type="button" @click.prevent="runCertDebug" :disabled="debugRunning">
                    <span v-if="debugRunning" class="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span>
                    <i v-else class="bi bi-bug me-1"></i>
                    {{ debugRunning ? 'Diagnosticando...' : 'Diagnosticar certificado + SEFAZ' }}
                  </button>
                  <span class="ms-2 text-muted small">Verifica arquivo, senha, validade e conexão com a SEFAZ</span>

                  <!-- Resultado do diagnóstico -->
                  <div v-if="debugResult" class="mt-3">
                    <div class="alert" :class="debugResult.summary?.startsWith('✅') ? 'alert-success' : debugResult.summary?.startsWith('⚠') ? 'alert-warning' : 'alert-danger'">
                      <strong>{{ debugResult.summary }}</strong>
                    </div>

                    <!-- Info do certificado -->
                    <div v-if="debugResult.certInfo" class="card mb-3">
                      <div class="card-header py-2"><small class="fw-semibold"><i class="bi bi-award me-1"></i>Informações do Certificado</small></div>
                      <div class="card-body py-2 small">
                        <div><strong>Subject:</strong> {{ debugResult.certInfo.subject }}</div>
                        <div><strong>Emissor:</strong> {{ debugResult.certInfo.issuer }}</div>
                        <div><strong>Válido de:</strong> {{ formatDate(debugResult.certInfo.notBefore) }} <strong>até:</strong> {{ formatDate(debugResult.certInfo.notAfter) }}</div>
                        <div v-if="debugResult.certInfo.daysRemaining !== null">
                          <strong>Dias restantes:</strong>
                          <span :class="debugResult.certInfo.daysRemaining < 30 ? 'text-danger fw-bold' : 'text-success'">{{ debugResult.certInfo.daysRemaining }}</span>
                        </div>
                        <div v-if="debugResult.certInfo.expired" class="text-danger fw-bold mt-1"><i class="bi bi-exclamation-triangle me-1"></i>CERTIFICADO EXPIRADO</div>
                      </div>
                    </div>

                    <!-- Steps detalhados -->
                    <div class="table-responsive">
                      <table class="table table-sm table-bordered mb-0 small">
                        <thead class="table-light"><tr><th style="width:30px"></th><th>Verificação</th><th>Detalhe</th></tr></thead>
                        <tbody>
                          <tr v-for="(s, idx) in debugResult.steps" :key="idx">
                            <td class="text-center">
                              <i v-if="s.status === 'ok' || s.status === 'ok (usado)'" class="bi bi-check-circle-fill text-success"></i>
                              <i v-else-if="s.status === 'fail'" class="bi bi-x-circle-fill text-danger"></i>
                              <i v-else-if="s.status === 'warn'" class="bi bi-exclamation-triangle-fill text-warning"></i>
                              <i v-else-if="s.status === 'skip'" class="bi bi-dash-circle text-secondary"></i>
                              <i v-else class="bi bi-info-circle text-primary"></i>
                            </td>
                            <td>{{ s.step }}</td>
                            <td><small class="text-break">{{ s.detail }}</small></td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            </div>

          </div>

          <div class="d-flex gap-2 mt-3">
            <button class="btn btn-primary" @click="save" :disabled="saving">Salvar</button>
            <button class="btn btn-outline-secondary" @click="cancel">Cancelar</button>
          </div>

          <div v-if="message" class="mt-3 alert" :class="messageClass">{{ message }}</div>
        </div>
      </div>
    </div>

    <!-- cropper modal removed: ImageUploader manages its own cropper -->
  
  <!-- Delete confirmation modal -->
  <div v-if="showDeleteModal" class="cropper-modal" role="dialog" aria-modal="true">
  <div class="cropper-modal-content modal-content-padding">
      <h5>Confirmação</h5>
      <p>Tem certeza que deseja remover o certificado armazenado para esta loja? Esta ação não pode ser desfeita.</p>
      <div class="d-flex justify-content-end" style="gap:8px;">
        <button class="btn btn-secondary" type="button" @click="cancelDeleteCert" :disabled="saving">Cancelar</button>
        <button class="btn btn-danger" type="button" @click="deleteCert" :disabled="saving">
          <span v-if="saving" class="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span>
          <span v-if="saving">Removendo...</span>
          <span v-else>Remover</span>
        </button>
      </div>
    </div>
  </div>

  </div>
</template>

<script setup>
import { ref, onMounted, nextTick, onBeforeUnmount, computed } from 'vue'
import api from '../api'
import Swal from 'sweetalert2'
import { assetUrl } from '../utils/assetUrl.js'
import MediaField from '../components/MediaLibrary/MediaField.vue'
import { useRoute, useRouter } from 'vue-router'
import { applyPhoneMask } from '../utils/phoneMask'

const route = useRoute()
const router = useRouter()
const id = route.params.id || null
const isNew = !id

const loading = ref(false)
const saving = ref(false)
const message = ref('')
const messageClass = ref('')

const DEFAULT_TZ = 'America/Sao_Paulo'
// Common IANA timezone options for select
const TIMEZONES = [
  'America/Sao_Paulo', 'UTC', 'America/New_York', 'America/Los_Angeles', 'America/Chicago',
  'America/Argentina/Buenos_Aires', 'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Asia/Tokyo',
  'Asia/Shanghai', 'Australia/Sydney'
]
const form = ref({ name: '', address: '', phone: '', whatsapp: '', bannerUrl: '', logoUrl: '', bannerBase64: null, logoBase64: null, timezone: DEFAULT_TZ, cnpj: '', ie: '', razaoSocial: '', nfeSerie: '1', nfeEnvironment: 'homologation', csc: '', cscId: '', enderEmit: { xLgr: '', nro: '', xBairro: '', cMun: '', xMun: '', UF: '', CEP: '' }, certBase64: null, certFileName: '', certPassword: '', clearCert: false, storedCertExists: false, storedCertFilename: null, storedCertPasswordStored: false, isActive: true })

// ── Debug diagnóstico do certificado ──
const debugRunning = ref(false)
const debugResult = ref(null)

async function runCertDebug() {
  debugRunning.value = true
  debugResult.value = null
  try {
    const { data } = await api.post('/nfe/debug-cert', { storeId: id || undefined })
    debugResult.value = data
  } catch (e) {
    debugResult.value = { summary: '❌ Erro ao executar diagnóstico', steps: [{ step: 'Requisição', status: 'fail', detail: e?.response?.data?.error || e?.message || String(e) }] }
  } finally {
    debugRunning.value = false
  }
}

function formatDate(iso) {
  if (!iso) return 'N/A'
  try { return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) } catch { return iso }
}

const activeTab = ref('geral')
const weekDays = [ { value:0,label:'Domingo'},{value:1,label:'Segunda'},{value:2,label:'Terça'},{value:3,label:'Quarta'},{value:4,label:'Quinta'},{value:5,label:'Sexta'},{value:6,label:'Sábado'} ]

const remainingPauseText = computed(() => {
  try{
    if(closedUntilNextShift.value) return 'Fechado até o próximo expediente'
    if(!pauseUntil.value) return ''
    const t = Date.parse(String(pauseUntil.value))
    if(isNaN(t)) return ''
    const diff = t - Date.now()
    if(diff <= 0) return ''
    const mins = Math.floor(diff / 60000)
    const secs = Math.floor((diff % 60000) / 1000)
    if(mins >= 60){ const h = Math.floor(mins / 60); const m = mins % 60; return `${h}h ${m}m` }
    if(mins > 0) return `${mins}m ${secs}s`
    return `${secs}s`
  }catch(e){ return '' }
})

// pause / closed state used by UI (declared here to avoid ReferenceError)
let _pauseTicker = null
const pauseUntil = ref(null)
const closedUntilNextShift = ref(false)

async function clearPauseNow(){
  // clear pause flags for existing stores, or reset local state for new stores
  if (isNew) { pauseUntil.value = null; closedUntilNextShift.value = false; form.value.isActive = true; return }
  try{
    await api.post(`/stores/${id}/settings/upload`, { pauseUntil: null, pausedUntil: null, pause_until: null, closedUntilNextShift: false })
    pauseUntil.value = null
    closedUntilNextShift.value = false
    form.value.isActive = true
    await Swal.fire({ toast:true, position:'top-end', showConfirmButton:false, timer:1200, icon:'success', title: 'Pausa cancelada' })
  }catch(e){
    console.warn('clearPauseNow failed', e)
    await Swal.fire({ icon:'error', text: e?.response?.data?.message || 'Falha ao cancelar pausa' })
  }
}

function _startPauseTicker(){
  if(_pauseTicker) return
  _pauseTicker = setInterval(()=>{ try{ /* trigger recompute */ pauseUntil.value = pauseUntil.value ? pauseUntil.value : pauseUntil.value }catch(e){} }, 1000)
}
function _clearPauseTicker(){ if(_pauseTicker){ clearInterval(_pauseTicker); _pauseTicker = null } }
const certInput = ref(null)
const showDeleteModal = ref(false)

function setActiveTab(t){ activeTab.value = t }

async function load() {
  loading.value = true
  try {
    if (!isNew) {
      const { data } = await api.get(`/stores/${id}`)
      const s = data
      form.value.name = s.name || ''
      form.value.slug = s.slug || ''
      form.value.address = s.address || ''
  form.value.logoUrl = s.logoUrl ? assetUrl(s.logoUrl) : ''
  form.value.bannerUrl = s.bannerUrl ? assetUrl(s.bannerUrl) : ''
      form.value.cnpj = s.cnpj || ''
      form.value.ie = s.ie || ''
      form.value.razaoSocial = s.razaoSocial || s.xNome || ''
      form.value.nfeSerie = s.nfeSerie || '1'
      form.value.nfeEnvironment = s.nfeEnvironment || 'homologation'
      form.value.csc = s.csc || ''
      form.value.cscId = s.cscId || ''
      if (s.enderEmit && typeof s.enderEmit === 'object') {
        form.value.enderEmit = { xLgr: s.enderEmit.xLgr || '', nro: s.enderEmit.nro || '', xBairro: s.enderEmit.xBairro || '', cMun: s.enderEmit.cMun || '', xMun: s.enderEmit.xMun || '', UF: s.enderEmit.UF || '', CEP: s.enderEmit.CEP || '' }
      }
  form.value.timezone = s.timezone || DEFAULT_TZ
      // populate certificate state if present
      form.value.storedCertExists = !!s.certExists
      form.value.storedCertFilename = s.certFilename || null
      form.value.storedCertPasswordStored = !!s.certPasswordStored
        // isActive and pause/closed flags from merged settings
        form.value.isActive = s.isActive === undefined ? true : !!s.isActive
        try{
          pauseUntil.value = s.pauseUntil || s.pausedUntil || s.pause_until || null
          closedUntilNextShift.value = !!(s.closedUntilNextShift || s.closed_until_next_shift)
        }catch(_) { pauseUntil.value = null; closedUntilNextShift.value = false }
    }
  } catch (e) {
    console.error('Failed to load store', e)
    message.value = 'Erro ao carregar dados'
    messageClass.value = 'alert-danger'
  } finally { loading.value = false }
}



function onCertFileChange(e){
  const f = e.target.files && e.target.files[0]
  if (!f) return
  const reader = new FileReader()
  reader.onload = () => {
    // store as data URL; backend accepts data URL or raw base64
    form.value.certBase64 = reader.result
    form.value.certFileName = f.name || ''
    // ensure clearCert unchecked when selecting a file
    form.value.clearCert = false
  }
  reader.readAsDataURL(f)
  try{ e.target.value = '' }catch{}
}

function clearSelectedCert(){ form.value.certBase64 = null; form.value.certFileName = ''; }

function triggerCertInput(){ try{ if (certInput.value && certInput.value.click) certInput.value.click() }catch(e){ console.warn('failed to trigger cert input', e) } }

function confirmDeleteCert(){ showDeleteModal.value = true }

function cancelDeleteCert(){ showDeleteModal.value = false }

function handlePhoneInput(e) {
  form.value.phone = applyPhoneMask(e.target.value)
}

function handleWhatsAppInput(e) {
  form.value.whatsapp = applyPhoneMask(e.target.value)
}

async function handleActiveToggle(e){
  // guard: only for existing stores
  if(!id){ e.target.checked = true; form.value.isActive = true; await Swal.fire({ icon:'warning', text: 'Salve a loja antes de alterar o status.' }); return }
  const checked = !!e.target.checked
  // opening the store: clear any pause flags and set active
  if(checked){
    try{
      await api.put(`/stores/${id}`, { isActive: true })
      // clear pause flags in settings (best-effort)
      try{ await api.post(`/stores/${id}/settings/upload`, { pauseUntil: null, pausedUntil: null, pause_until: null, closedUntilNextShift: false }) }catch(_){ }
      form.value.isActive = true
      await Swal.fire({ toast:true, position:'top-end', showConfirmButton:false, timer:1200, icon:'success', title: 'Loja aberta' })
    }catch(err){ console.error('Failed to open store', err); e.target.checked = false; form.value.isActive = false; await Swal.fire({ icon:'error', text: err?.response?.data?.message || 'Falha ao abrir loja' }) }
    return
  }

  // ask pause options when closing
  try{
    const inputOptions = { '15': '15 minutos', '30': '30 minutos', '60': '1 hora', '180': '3 horas', 'untilNext': 'Fechar até o próximo expediente' }
    const res = await Swal.fire({ title: 'Fechar loja?', input: 'radio', inputOptions, inputValidator: (v) => v ? null : 'Escolha uma opção', showCancelButton: true, confirmButtonText: 'Confirmar', cancelButtonText: 'Cancelar' })
    if(!res.isConfirmed){ e.target.checked = true; form.value.isActive = true; return }
    const val = res.value
    if(val === 'untilNext'){
      // persist closedUntilNextShift flag in settings
      try{ await api.post(`/stores/${id}/settings/upload`, { closedUntilNextShift: true }) }catch(e){ console.warn('failed to persist closedUntilNextShift', e) }
      try{ await api.put(`/stores/${id}`, { isActive: false }) }catch(e){ console.warn('failed to set isActive false', e) }
      form.value.isActive = false
      await Swal.fire({ toast:true, position:'top-end', showConfirmButton:false, timer:1500, icon:'success', title: 'Loja fechada até o próximo expediente' })
      return
    }
    const mins = Number(val || 0)
    if(mins > 0){
      const pauseUntil = new Date(Date.now() + mins * 60000).toISOString()
      try{ await api.post(`/stores/${id}/settings/upload`, { pauseUntil }) }catch(e){ console.warn('failed to persist pauseUntil', e) }
      try{ await api.put(`/stores/${id}`, { isActive: false }) }catch(e){ console.warn('failed to set isActive false', e) }
      form.value.isActive = false
      await Swal.fire({ toast:true, position:'top-end', showConfirmButton:false, timer:1500, icon:'success', title: `Loja pausada por ${mins} minutos` })
      return
    }
    // fallback: revert
    e.target.checked = true; form.value.isActive = true
  }catch(err){ console.error('handleActiveToggle error', err); e.target.checked = true; form.value.isActive = true; await Swal.fire({ icon:'error', text: 'Operação cancelada' }) }
}

async function deleteCert(){
  try{
    if (isNew) return
    saving.value = true
    await api.delete(`/stores/${id}/cert`)
    // update UI state
    form.value.storedCertExists = false
    form.value.storedCertFilename = null
    form.value.storedCertPasswordStored = false
    message.value = 'Certificado removido'
    messageClass.value = 'alert-success'
  } catch(e){
    console.error('Failed to delete cert', e)
    message.value = e?.response?.data?.message || e?.message || 'Falha ao remover certificado'
    messageClass.value = 'alert-danger'
  } finally {
    saving.value = false
    showDeleteModal.value = false
  }
}

// schedule management moved to menu-level settings

// MediaField sets form.bannerUrl / form.logoUrl directly via v-model

async function save(){
  try{
    saving.value = true;

    const payload = {
      name: form.value.name || undefined,
      slug: form.value.slug !== undefined ? (form.value.slug || undefined) : undefined,
      address: form.value.address || undefined,
      timezone: form.value.timezone || undefined,
      cnpj: form.value.cnpj || undefined,
      isActive: form.value.isActive,
      logoUrl: form.value.logoUrl || undefined,
      bannerUrl: form.value.bannerUrl || undefined,
      weeklySchedule: form.value.open24Hours ? null : form.value.weeklySchedule,
      ie: form.value.ie || undefined,
      razaoSocial: form.value.razaoSocial || undefined,
      nfeSerie: form.value.nfeSerie || undefined,
      nfeEnvironment: form.value.nfeEnvironment || undefined,
      csc: form.value.csc || undefined,
      cscId: form.value.cscId || undefined,
      enderEmit: form.value.enderEmit || undefined,
    }

    if (form.value.certBase64) payload.certBase64 = form.value.certBase64
    if (form.value.clearCert) {
      payload.certPassword = ''
    } else if (form.value.certPassword && String(form.value.certPassword).length > 0) {
      payload.certPassword = form.value.certPassword
    }

    if (isNew) {
      const { data } = await api.post('/stores', payload)
      message.value = 'Loja criada'
      messageClass.value = 'alert-success'
      router.push('/settings/stores')
    } else {
      await api.put(`/stores/${id}`, payload)
      message.value = 'Loja atualizada'
      messageClass.value = 'alert-success'
      router.push('/settings/stores')
    }
  } catch(e){
    console.error('save failed', e);
    message.value = e?.response?.data?.message || e?.message || 'Erro ao salvar'
    messageClass.value = 'alert-danger'
  } finally { saving.value = false }
}

function cancel(){ router.push('/settings/stores') }

onMounted(()=>{ load(); _startPauseTicker() })
onBeforeUnmount(()=>{ _clearPauseTicker(); /* ImageUploader handles object URLs */ })
</script>

<style scoped>
.cropper-modal { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display:flex; align-items:center; justify-content:center; z-index:2000 }
.cropper-modal-content { background: #fff; border-radius:8px; max-width:92vw; width:720px; max-height:92vh; overflow:auto }
.cropper-canvas-wrapper { width:100%; height: auto; display:flex; align-items:center; justify-content:center }
.crop-image-container { position: relative; width:100%; max-height:64vh; display:flex; align-items:center; justify-content:center; overflow:hidden; background:#f5f5f5 }
.crop-image { max-width:100%; max-height:64vh; user-select:none; -webkit-user-drag:none }
.crop-box { position:absolute; border:2px dashed #fff; box-shadow: 0 6px 18px rgba(0,0,0,0.2); background: rgba(255,255,255,0.02); touch-action: none }
.crop-actions { display:flex; gap:8px }
.cropper-actions .btn { min-width:100px }
</style>