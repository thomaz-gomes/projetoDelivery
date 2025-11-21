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
            <li class="nav-item"><a class="nav-link" :class="{active: activeTab==='horario'}" href="#" @click.prevent="setActiveTab('horario')">Horário</a></li>
            <li class="nav-item"><a class="nav-link" :class="{active: activeTab==='fiscal'}" href="#" @click.prevent="setActiveTab('fiscal')">Fiscal</a></li>
          </ul>

          <div v-show="activeTab==='geral'">
            <div class="mb-3"><label class="form-label">Nome</label><input class="form-control" v-model="form.name" /></div>
              <div class="mb-3"><label class="form-label">Slug público (opcional)</label>
                <input class="form-control" v-model="form.slug" placeholder="ex: nomedaloja" />
                <div class="form-text small">Se preenchido, a URL pública ficará em <code>/public/SEU_SLUG</code>. Caso vazio, o sistema gerará/resolve um slug automaticamente.</div>
              </div>
            <div class="mb-3"><label class="form-label">Endereço</label><input class="form-control" v-model="form.address" /></div>
            <div class="mb-3"><label class="form-label">Telefone</label><input class="form-control" v-model="form.phone" /></div>
            <div class="mb-3"><label class="form-label">WhatsApp</label><input class="form-control" v-model="form.whatsapp" /></div>
            <div class="row">
              <div class="col-md-6 mb-3">
                <ImageUploader label="Banner" :initialUrl="form.bannerUrl" :aspect="1200/400" :targetWidth="1200" :targetHeight="400" :uploadUrl="!isNew ? `/stores/${id}/settings/upload` : null" uploadKey="bannerBase64" @cropped="onBannerCropped" @uploaded="onBannerUploaded" />
              </div>
              <div class="col-md-6 mb-3">
                <ImageUploader label="Logotipo (450x450)" :initialUrl="form.logoUrl" :aspect="1" :targetWidth="450" :targetHeight="450" :uploadUrl="!isNew ? `/stores/${id}/settings/upload` : null" uploadKey="logoBase64" @cropped="onLogoCropped" @uploaded="onLogoUploaded" />
              </div>
            </div>
          </div>

          <div v-show="activeTab==='horario'">
            <div class="card mt-3">
              <div class="card-body">
                <h5>Horário por dia</h5>
                <div class="form-text mb-2">Defina dias e intervalos.</div>

                <div class="form-check mb-2">
                  <input class="form-check-input" type="checkbox" id="open24" v-model="form.open24Hours" />
                  <label class="form-check-label" for="open24">Aberto 24 horas (ocultar horários)</label>
                </div>

                <div v-if="!form.open24Hours" class="table-responsive">
                  <table class="table table-sm">
                    <thead><tr><th>Dia</th><th>Ativo</th><th>De</th><th>Até</th><th></th></tr></thead>
                    <tbody>
                      <tr v-for="(day, idx) in weekDays" :key="day.value">
                        <td>{{ day.label }}</td>
                        <td><input type="checkbox" v-model="form.weeklySchedule[day.value].enabled" /></td>
                        <td><input type="time" class="form-control form-control-sm" v-model="form.weeklySchedule[day.value].from" :disabled="!form.weeklySchedule[day.value].enabled" /></td>
                        <td><input type="time" class="form-control form-control-sm" v-model="form.weeklySchedule[day.value].to" :disabled="!form.weeklySchedule[day.value].enabled" /></td>
                        <td style="width:1%;white-space:nowrap">
                          <button class="btn btn-sm btn-outline-secondary" type="button" :disabled="saving || day.value >= 6" @click.prevent="copyToNext(day.value)" title="Copiar para o próximo dia">
                            <!-- simple copy icon -->
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16"><path d="M13 1H3a1 1 0 0 0-1 1v9h1V2h10V1z"/><path d="M11 4H4a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1zm-1 9H5V6h5v7z"/></svg>
                          </button>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div v-else class="small text-muted">A loja está marcada como aberta 24 horas — os horários estão ocultos.</div>
              </div>
            </div>
          </div>

                  <div v-show="activeTab==='fiscal'">
                    <div class="mb-2"><label class="form-label">CNPJ</label><input class="form-control" v-model="form.cnpj" placeholder="Apenas dígitos" /></div>
                    <div class="mb-2"><label class="form-label">Inscrição Estadual</label><input class="form-control" v-model="form.ie" /></div>
                    <div class="mb-2"><label class="form-label">Timezone (IANA)</label><input class="form-control" v-model="form.timezone" /></div>

                    <div class="card mt-3 p-3">
                      <h6 class="mb-2">Certificado NF-e (PFX)</h6>
                      <div class="mb-2 small text-muted">Faça upload do arquivo .pfx da loja para emitir NF-e com o CNPJ desta loja. Você também pode limpar a senha do certificado.</div>

                      <div class="mb-2">
                        <input ref="certInput" type="file" accept=".pfx,.p12" @change="onCertFileChange($event)" />
                      </div>

                      <div v-if="form.certFileName || form.certBase64" class="mb-2">
                        <div><strong>Arquivo selecionado:</strong> {{ form.certFileName || 'Selecionado' }}</div>
                        <div class="mt-2 d-flex gap-2">
                          <button class="btn btn-sm btn-outline-secondary" type="button" @click="clearSelectedCert">Remover arquivo</button>
                        </div>
                      </div>

                      <div v-else-if="form.storedCertExists" class="mb-2">
                        <div><strong>Certificado armazenado:</strong> {{ form.storedCertFilename || 'arquivo.pfx' }}</div>
                        <div class="small text-muted">Senha armazenada: <strong>{{ form.storedCertPasswordStored ? 'Sim' : 'Não' }}</strong></div>
                        <div class="mt-2 d-flex gap-2">
                          <button class="btn btn-sm btn-outline-primary" type="button" @click.prevent="triggerCertInput" :disabled="saving">Substituir certificado</button>
                          <button class="btn btn-sm btn-outline-danger" type="button" @click.prevent="confirmDeleteCert" :disabled="saving">Remover certificado</button>
                        </div>
                      </div>

                      <div class="mb-2">
                        <label class="form-label">Senha do PFX (opcional)</label>
                        <input class="form-control" type="password" v-model="form.certPassword" placeholder="Senha do certificado (deixe vazio para manter/limpar)" />
                      </div>

                      <div class="form-check">
                        <input class="form-check-input" type="checkbox" id="clearCert" v-model="form.clearCert">
                        <label class="form-check-label small" for="clearCert">Limpar certificado armazenado (enviar senha vazia ao salvar)</label>
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
import { assetUrl } from '../utils/assetUrl.js'
import ImageUploader from '../components/ImageUploader.vue'
import { useRoute, useRouter } from 'vue-router'

const route = useRoute()
const router = useRouter()
const id = route.params.id || null
const isNew = !id

const loading = ref(false)
const saving = ref(false)
const message = ref('')
const messageClass = ref('')

const DEFAULT_TZ = 'America/Sao_Paulo'
const defaultWeek = Array.from({ length: 7 }).map((_, i) => ({ day: i, enabled: false, from: '', to: '' }))
const form = ref({ name: '', address: '', phone: '', whatsapp: '', bannerUrl: '', logoUrl: '', bannerBase64: null, logoBase64: null, timezone: DEFAULT_TZ, weeklySchedule: defaultWeek, cnpj: '', ie: '', certBase64: null, certFileName: '', certPassword: '', clearCert: false, storedCertExists: false, storedCertFilename: null, storedCertPasswordStored: false, open24Hours: false })

const activeTab = ref('geral')
const weekDays = [ { value:0,label:'Domingo'},{value:1,label:'Segunda'},{value:2,label:'Terça'},{value:3,label:'Quarta'},{value:4,label:'Quinta'},{value:5,label:'Sexta'},{value:6,label:'Sábado'} ]

// Note: banner/logo cropper is now handled by ImageUploader component
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
  form.value.timezone = s.timezone || DEFAULT_TZ
    // weekly schedule (may be null)
    form.value.weeklySchedule = s.weeklySchedule && Array.isArray(s.weeklySchedule) ? s.weeklySchedule : JSON.parse(JSON.stringify(defaultWeek))
    // open24Hours flag
  form.value.open24Hours = !!s.open24Hours
      // populate certificate state if present
      form.value.storedCertExists = !!s.certExists
      form.value.storedCertFilename = s.certFilename || null
      form.value.storedCertPasswordStored = !!s.certPasswordStored
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

function copyToNext(dayIndex){
  try{
    const next = dayIndex + 1
    if (next > 6) return
    const src = form.value.weeklySchedule[dayIndex]
    if (!src) return
    // copy values to next day
    form.value.weeklySchedule[next].enabled = !!src.enabled
    form.value.weeklySchedule[next].from = src.from || ''
    form.value.weeklySchedule[next].to = src.to || ''
  } catch (e) {
    console.warn('copyToNext failed', e)
  }
}

// handlers used by ImageUploader
// handlers used by ImageUploader
function onBannerCropped(dataUrl){
  try{ console.log('[StoreForm] onBannerCropped received dataUrl length=', dataUrl ? dataUrl.length : 0) }catch(e){}
  // when creating a new store we keep base64 until post-create upload
  if (isNew) {
    form.value.bannerBase64 = dataUrl
    form.value.bannerUrl = dataUrl
  } else {
    // for existing stores we expect ImageUploader to upload and emit uploaded; keep preview only
    form.value.bannerBase64 = null
  }
}
function onLogoCropped(dataUrl){
  try{ console.log('[StoreForm] onLogoCropped received dataUrl length=', dataUrl ? dataUrl.length : 0) }catch(e){}
  if (isNew) {
    form.value.logoBase64 = dataUrl
    form.value.logoUrl = dataUrl
  } else {
    form.value.logoBase64 = null
  }
}

function onBannerUploaded(url){
  try{ console.log('[StoreForm] onBannerUploaded url=', url) }catch(e){}
  form.value.bannerUrl = assetUrl(url)
  form.value.bannerBase64 = null
}

function onLogoUploaded(url){
  try{ console.log('[StoreForm] onLogoUploaded url=', url) }catch(e){}
  form.value.logoUrl = assetUrl(url)
  form.value.logoBase64 = null
}

async function save(){
  try{
    saving.value = true;
    // If user provided banner/logo via the cropper (base64), upload them to settings first
    let uploaded = {}
    try {
        if (!isNew && (form.value.logoBase64 || form.value.bannerBase64)) {
          try{ console.log('[StoreForm] about to POST /stores/' + id + '/settings/upload', { hasLogo: !!form.value.logoBase64, hasBanner: !!form.value.bannerBase64 }) }catch(e){}
          const up = await api.post(`/stores/${id}/settings/upload`, { logoBase64: form.value.logoBase64, bannerBase64: form.value.bannerBase64 })
          try{ console.log('[StoreForm] upload response', up && up.data) }catch(e){}
          uploaded = up.data && up.data.saved ? up.data.saved : {}
          if (uploaded.logo) form.value.logoUrl = assetUrl(uploaded.logo)
          if (uploaded.banner) form.value.bannerUrl = assetUrl(uploaded.banner)
        }
    } catch (e) {
      console.warn('Upload to settings failed', e)
    }

    const payload = {
      name: form.value.name || undefined,
      slug: form.value.slug !== undefined ? (form.value.slug || undefined) : undefined,
      address: form.value.address || undefined,
      timezone: form.value.timezone || undefined,
      cnpj: form.value.cnpj || undefined,
      open24Hours: !!form.value.open24Hours,
      // prefer persisted settings-stored logo URL when available; fall back to existing logoUrl
      logoUrl: form.value.logoUrl || undefined,
      // include banner URL when present
      bannerUrl: form.value.bannerUrl || undefined,
      weeklySchedule: form.value.open24Hours ? null : form.value.weeklySchedule,
    }

    // certificate handling: include certBase64 when selected
    if (form.value.certBase64) payload.certBase64 = form.value.certBase64
    // include certPassword when user provided one OR when clearCert is checked (to clear stored password)
    if (form.value.clearCert) {
      payload.certPassword = ''
    } else if (form.value.certPassword && String(form.value.certPassword).length > 0) {
      payload.certPassword = form.value.certPassword
    }

    if (isNew) {
      try{ console.log('[StoreForm] creating new store with payload', payload) }catch(e){}
      const { data } = await api.post('/stores', payload)
      const newId = data && data.id
      // for newly created store, upload banner/logo after creation if present
      try {
        if ((form.value.logoBase64 || form.value.bannerBase64) && newId) {
          const up = await api.post(`/stores/${newId}/settings/upload`, { logoBase64: form.value.logoBase64, bannerBase64: form.value.bannerBase64 })
          const saved = up.data && up.data.saved ? up.data.saved : {}
          if (saved.logo || saved.banner) {
            const toPut = {}
            if (saved.logo) toPut.logoUrl = saved.logo
            if (saved.banner) toPut.bannerUrl = saved.banner
            // update preview to absolute URLs
            if (saved.logo) form.value.logoUrl = assetUrl(saved.logo)
            if (saved.banner) form.value.bannerUrl = assetUrl(saved.banner)
            try{ console.log('[StoreForm] patching newly created store with', toPut) }catch(e){}
            await api.put(`/stores/${newId}`, toPut)
          }
        }
      } catch (e) { console.warn('Post-create upload failed', e) }
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

onMounted(()=>{ load() })
onBeforeUnmount(()=>{ /* nothing to clean here; ImageUploader handles object URLs */ })
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