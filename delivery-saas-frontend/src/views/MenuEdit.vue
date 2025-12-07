<template>
  <div class="container py-4">
    <h2>{{ isEdit ? 'Editar cardápio' : 'Novo cardápio' }}</h2>
    <div class="card p-4 mt-3">
      <form @submit.prevent="save">
        <div class="mb-3">
          <label class="form-label">Nome</label>
          <TextInput v-model="form.name" placeholder="Nome do cardápio" maxlength="120" inputClass="form-control" required />
        </div>

        <div class="mb-3">
          <label class="form-label">Loja</label>
          <SelectInput   v-model="form.storeId"  class="form-select" required>
            <option :value="null">-- Selecione uma loja --</option>
            <option v-for="s in stores" :key="s.id" :value="s.id">{{ s.name }}</option>
          </SelectInput>
        </div>

        <div class="mb-3">
          <label class="form-label">Slug público (opcional)</label>
          <TextInput v-model="form.slug" placeholder="ex: festival-de-verao" maxlength="80" inputClass="form-control" />
          <div class="form-text">Se preenchido, o cardápio ficará acessível em /public/&lt;slug&gt;</div>
        </div>

        <div class="mb-3">
          <label class="form-label">Descrição (opcional)</label>
          <TextInput v-model="form.description" inputClass="form-control" />
        </div>

        <div class="mb-3">
          <label class="form-label">Endereço (opcional)</label>
          <TextInput v-model="form.address" placeholder="Endereço associado a este cardápio" inputClass="form-control" />
        </div>

        <div class="mb-3">
          <label class="form-label">Telefone (opcional)</label>
          <TextInput v-model="form.phone" placeholder="(00) 0000-0000" maxlength="15" inputClass="form-control" @input="handlePhoneInput" />
        </div>

        <div class="mb-3">
          <label class="form-label">WhatsApp (opcional)</label>
          <TextInput v-model="form.whatsapp" placeholder="(00) 0 0000-0000" maxlength="16" inputClass="form-control" @input="handleWhatsAppInput" />
        </div>

        <div class="mb-3 border rounded p-3">
          <label class="form-label">Horário de Funcionamento (opcional)</label>
          <div class="form-check mb-2">
            <input class="form-check-input" type="checkbox" id="open24" v-model="form.open24Hours" />
            <label class="form-check-label" for="open24">Aberto 24 horas</label>
          </div>
            <div class="row gx-2">
              <div class="col mb-2">
                <label class="form-label small">Fuso horário</label>
                <TextInput v-model="form.timezone" placeholder="America/Sao_Paulo" inputClass="form-control" />
              </div>
            </div>
          <div class="mt-2">
            <label class="form-label small">Horário por dia (opcional)</label>
            <div class="form-text mb-2">Defina dias/intervalos. Se preenchido, terá precedência sobre 'De/Até'.</div>
            <div v-if="!form.open24Hours" class="table-responsive">
              <table class="table table-borderless align-middle">
                <thead>
                  <tr>
                    <th>Dia</th>
                    <th class="text-center">Ativo</th>
                    <th>De</th>
                    <th>Até</th>
                    <th style="width:48px"></th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(d, idx) in weeklySchedule" :key="idx">
                    <td>{{ dayNames[idx] }}</td>
                    <td class="text-center"><input class="form-check-input" type="checkbox" v-model="weeklySchedule[idx].enabled" /></td>
                    <td><input type="time" class="form-control form-control-sm" v-model="weeklySchedule[idx].from" :disabled="!weeklySchedule[idx].enabled" /></td>
                    <td><input type="time" class="form-control form-control-sm" v-model="weeklySchedule[idx].to" :disabled="!weeklySchedule[idx].enabled" /></td>
                    <td class="text-end">
                      <button type="button" class="btn btn-outline-secondary btn-sm" :disabled="idx===0" @click="copyFromPrev(idx)" title="Copiar horário do dia acima">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-files" viewBox="0 0 16 16">
                          <path d="M13 1a1 1 0 0 1 1 1v9.5a.5.5 0 0 1-.5.5H9.5A1.5 1.5 0 0 1 8 11.5V10H3.5A1.5 1.5 0 0 1 2 8.5V2A1 1 0 0 1 3 1h10z"/>
                          <path d="M3 2a1 1 0 0 0-1 1v6.5A.5.5 0 0 0 2.5 10H8v1.5A1.5 1.5 0 0 0 9.5 13H13V3a1 1 0 0 0-1-1H3z"/>
                        </svg>
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div class="row">
          <div class="col-md-6 mb-3">
            <ImageUploader label="Banner" :initialUrl="form.bannerUrl" :aspect="1200/400" :targetWidth="1200" :targetHeight="400" uploadKey="bannerBase64" @cropped="onBannerCropped" />
          </div>
          <div class="col-md-6 mb-3">
            <ImageUploader label="Logotipo (450x450)" :initialUrl="form.logoUrl" :aspect="1" :targetWidth="450" :targetHeight="450" uploadKey="logoBase64" @cropped="onLogoCropped" />
          </div>
        </div>

        <div class="d-flex justify-content-between">
          <div>
            <button class="btn btn-secondary me-2" type="button" @click="cancel">Cancelar</button>
            <button v-if="isEdit" class="btn btn-outline-primary" type="button" @click="openStructure">Editar estrutura</button>
          </div>
          <div>
            <button class="btn btn-primary" type="submit" :disabled="saving">{{ isEdit ? 'Salvar alterações' : 'Criar cardápio' }}</button>
          </div>
        </div>

        <div v-if="error" class="alert alert-danger mt-3">{{ error }}</div>
      </form>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import api from '../api'
import Swal from 'sweetalert2'
import ImageUploader from '../components/ImageUploader.vue'
import { applyPhoneMask } from '../utils/phoneMask'
import { assetUrl } from '../utils/assetUrl.js'

const route = useRoute()
const router = useRouter()
const id = route.params.id || null
const isEdit = Boolean(id)

const form = ref({ id: null, name: '', storeId: null, description: '', slug: '', address: '', phone: '', whatsapp: '', bannerUrl: '', logoUrl: '', bannerBase64: null, logoBase64: null, open24Hours: false, timezone: '' })
const dayNames = ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado']
const weeklySchedule = ref(Array.from({length:7}).map((_,i)=>({ day: i, enabled: false, from: '', to: '' })))

function copyFromPrev(idx){
  try{
    if(!Array.isArray(weeklySchedule.value) || idx<=0) return
    const prev = weeklySchedule.value[idx-1]
    if(!prev) return
    // copy enabled, from and to
    weeklySchedule.value[idx].enabled = !!prev.enabled
    weeklySchedule.value[idx].from = prev.from || ''
    weeklySchedule.value[idx].to = prev.to || ''
  }catch(e){ console.warn('copyFromPrev failed', e) }
}
const stores = ref([])
const saving = ref(false)
const error = ref('')

async function load(){
  try{
    const st = await api.get('/stores')
    stores.value = st.data || []
    if(isEdit){
      const res = await api.get(`/menu/menus/${id}`)
      const d = res.data || {}
      form.value = { id: d.id, name: d.name || '', storeId: d.storeId || null, description: d.description || '', slug: d.slug || '', address: '', phone: '', whatsapp: '', bannerUrl: d.banner || d.bannerUrl || '', logoUrl: d.logo || d.logoUrl || '', bannerBase64: null, logoBase64: null }
      // Try to fetch store settings to prefill menu-specific metadata (menus map)
      try {
        if (d.storeId) {
          const stResp = await api.get(`/stores/${d.storeId}`)
          const sdata = stResp.data || {}
          if (sdata.menus && sdata.menus[String(d.id)]) {
            const mmeta = sdata.menus[String(d.id)] || {}
            form.value.address = mmeta.address || form.value.address
            form.value.phone = mmeta.phone || form.value.phone
            form.value.whatsapp = mmeta.whatsapp || form.value.whatsapp
            // schedule/meta
            if (typeof mmeta.open24Hours !== 'undefined') form.value.open24Hours = !!mmeta.open24Hours
            // legacy top-level openFrom/openTo are not used when weeklySchedule is set
            if (mmeta.timezone) form.value.timezone = mmeta.timezone
            if (mmeta.weeklySchedule) {
              try {
                // normalize into weeklySchedule array of 7 items
                const parsed = Array.isArray(mmeta.weeklySchedule) ? mmeta.weeklySchedule : JSON.parse(String(mmeta.weeklySchedule || '[]'))
                weeklySchedule.value = Array.from({length:7}).map((_,i)=>({ day: i, enabled: false, from: '', to: '' }))
                if (Array.isArray(parsed)) {
                  parsed.forEach(item => {
                    const idx = Number(item.day) || 0
                    if (idx >=0 && idx < 7) {
                      weeklySchedule.value[idx] = {
                        day: idx,
                        enabled: !!item.enabled,
                        from: item.from || '',
                        to: item.to || ''
                      }
                    }
                  })
                }
              } catch(e) { /* ignore */ }
            }
            // prefer menu-level saved banner/logo when present
            if (mmeta.banner) form.value.bannerUrl = assetUrl(mmeta.banner)
            if (mmeta.logo) form.value.logoUrl = assetUrl(mmeta.logo)
          }
        }
      } catch (e) { /* ignore */ }
    }
  }catch(e){ console.error(e); error.value = e.response?.data?.message || 'Falha ao carregar dados' }
}

function cancel(){ router.push({ path: '/menu/menus' }) }

function handlePhoneInput(e) {
  form.value.phone = applyPhoneMask(e.target.value)
}

function handleWhatsAppInput(e) {
  form.value.whatsapp = applyPhoneMask(e.target.value)
}

function onBannerCropped(dataUrl){
  form.value.bannerBase64 = dataUrl
  form.value.bannerUrl = dataUrl
}

function onLogoCropped(dataUrl){
  form.value.logoBase64 = dataUrl
  form.value.logoUrl = dataUrl
}

async function save(){
  error.value = ''
  if(!form.value.name) { error.value = 'Nome é obrigatório'; return }
  if(!form.value.storeId) { error.value = 'Loja é obrigatória'; return }
  saving.value = true
    try{
    const payload = { name: form.value.name, description: form.value.description, storeId: form.value.storeId }
    if (form.value.slug !== undefined) payload.slug = form.value.slug || null
      let res = null
      if(isEdit){
        res = await api.patch(`/menu/menus/${id}`, payload)
        Swal.fire({ icon: 'success', text: 'Cardápio atualizado' })
      } else {
        res = await api.post('/menu/menus', payload)
        Swal.fire({ icon: 'success', text: 'Cardápio criado' })
      }
      // After saving, redirect to the same menu we just edited/created so the user
      // continues working on that menu instead of returning to the list view.
    try{
      const targetId = isEdit ? id : (res && res.data && res.data.id ? res.data.id : null)
      // If user provided menu-specific images, contact metadata or schedule, persist them into the store settings
      try {
        const toUpload = {}
        if (form.value.logoBase64) toUpload.logoBase64 = form.value.logoBase64
        if (form.value.bannerBase64) toUpload.bannerBase64 = form.value.bannerBase64
        // include menu meta so it is stored under settings/stores/<storeId>/menus/<menuId>
        const meta = {}
        if (form.value.address) meta.address = form.value.address
        if (form.value.phone) meta.phone = form.value.phone
        if (form.value.whatsapp) meta.whatsapp = form.value.whatsapp
        // schedule fields
        if (typeof form.value.open24Hours !== 'undefined') meta.open24Hours = !!form.value.open24Hours
        // include weeklySchedule only if at least one day enabled; if present, it takes precedence over openFrom/openTo
        let ws = []
        try {
          ws = Array.isArray(weeklySchedule.value) ? weeklySchedule.value.map(w=>({ day: Number(w.day)||0, enabled: !!w.enabled, from: String(w.from||''), to: String(w.to||'') })) : []
          if (ws.length === 7 && ws.some(w => !!w.enabled)) {
            meta.weeklySchedule = ws
          } else {
            // fallback to top-level openFrom/openTo when weeklySchedule is empty or all days disabled
            if (form.value.openFrom) meta.openFrom = form.value.openFrom
            if (form.value.openTo) meta.openTo = form.value.openTo
          }
        } catch (e) { /* ignore */ }
        if (form.value.timezone) meta.timezone = form.value.timezone
        if (Object.keys(meta).length) toUpload.menuMeta = meta
        if (Object.keys(toUpload).length && form.value.storeId && targetId) {
          toUpload.menuId = targetId
          const up = await api.post(`/stores/${form.value.storeId}/settings/upload`, toUpload)
          const saved = up.data && up.data.saved ? up.data.saved : {}
          // if upload returned a logo path, persist it to the menu record (menu.logoUrl supported)
          if (saved.logo && targetId) {
            try{ await api.patch(`/menu/menus/${targetId}`, { logoUrl: saved.logo }) }catch(e){ /* non-fatal */ }
          }
        }
      } catch (e) {
        console.warn('Menu image/meta upload failed', e)
      }
      if(targetId){
        // Redirect the user directly to the menu structure editor for the saved menu
        router.push({ path: '/menu/admin', query: { menuId: targetId } })
      } else {
        router.push({ path: '/menu/menus' })
      }
    }catch(e){ router.push({ path: '/menu/menus' }) }
  }catch(e){ console.error(e); error.value = e.response?.data?.message || 'Falha ao salvar' }
  finally{ saving.value = false }
}

onMounted(load)

function openStructure(){
  if(!form.value.id) return
  router.push({ path: '/menu/admin', query: { menuId: form.value.id } })
}
</script>

<style scoped>
.container { max-width: 900px }
</style>
