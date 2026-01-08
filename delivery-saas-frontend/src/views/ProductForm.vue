<template>
  <div class="container py-4">
    <h2>{{ isEdit ? 'Editar produto' : 'Novo produto' }}</h2>
    <div class="card p-4 mt-3">
      <form @submit.prevent="save">
        <div class="mb-3">
          <TextInput label="Nome do Produto" labelClass="form-label" v-model="form.name" placeholder="Ex: Coxinha" required maxlength="80" />
        </div>
        <div class="mb-3">
          <label class="form-label">Descrição</label>
          <TextareaInput v-model="form.description" placeholder="Descrição" rows="4" maxlength="1000" />
        </div>
        <div class="row mb-3">
          <div class="col-md-4">
            <CurrencyInput label="Preço" labelClass="form-label" v-model="form.price" inputClass="form-control" placeholder="0,00" />
          </div>
          <div v-if="cashbackEnabled" class="col-md-4">
            <label class="form-label">Cashback (%)</label>
            <input type="number" step="0.01" class="form-control" v-model.number="form.cashbackPercent" placeholder="Ex: 3.5" />
            <div class="small text-muted">Deixe vazio para usar o percentual padrão da loja</div>
          </div>
          <div class="col-md-4">
            <label class="form-label">Categoria</label>
            <SelectInput   v-model="form.categoryId"  class="form-control">
              <option :value="null">Sem categoria</option>
              <option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option>
            </SelectInput>
          </div>
            <div class="col-md-4">
              <label class="form-label">Menu (opcional)</label>
              <SelectInput   v-model="form.menuId"  class="form-control">
                <option :value="null">-- Nenhum --</option>
                <option v-for="m in menus" :key="m.id" :value="m.id">{{ m.name }}</option>
              </SelectInput>
            </div>
            <div class="col-md-4">
              <label class="form-label">Ficha Técnica (opcional)</label>
              <SelectInput v-model="form.technicalSheetId" class="form-control">
                <option :value="null">-- Nenhuma --</option>
                <option v-for="s in technicalSheets" :key="s.id" :value="s.id">{{ s.name }} ({{ s.itemCount || 0 }} itens)</option>
              </SelectInput>
              <div class="small text-muted mt-1">
                <div v-if="sheetCost !== undefined && sheetCost !== null">Custo da ficha: <strong>{{ sheetCost.toFixed(2) }}</strong></div>
                <div v-if="cmvPercent !== null">CMV: <strong>{{ cmvPercent.toFixed(2) }}%</strong> (R$ {{ sheetCost.toFixed(2) }})</div>
                <div v-else class="text-muted">Preencha o preço para ver o CMV</div>
              </div>
            </div>
          <div class="col-md-4">
            <label class="form-label">Posição</label>
            <input v-model.number="form.position" type="number" class="form-control" />
          </div>
          <div class="col-md-4 d-flex align-items-end">
            <div class="form-check form-switch">
              <input class="form-check-input" type="checkbox" id="prodActive" v-model="form.isActive" />
              <label class="form-check-label small text-muted" for="prodActive">Ativo</label>
            </div>
          </div>
        </div>

        <div class="mb-3">
          <label class="form-label">Grupos de complementos</label>
          <div v-if="groups.length===0" class="small text-muted">Nenhum grupo cadastrado.</div>
          <div v-else>
            <div class="form-check" v-for="g in groups" :key="g.id">
              <input class="form-check-input" type="checkbox" :id="'grp-'+g.id" :value="g.id" v-model="form.optionGroupIds" />
              <label class="form-check-label" :for="'grp-'+g.id">{{ g.name }} <small class="text-muted">(min: {{ g.min || 0 }} / max: {{ g.max ?? '∞' }})</small></label>
            </div>
          </div>
        </div>

        <div class="mb-3">
          <label class="form-label">Imagem do produto</label>
          <ImageUploader :initialUrl="form.image" label="Imagem do produto" :aspect="1" :targetWidth="600" :targetHeight="600" @cropped="onProductImageCropped" />
          <div v-if="isUploading" class="mt-2">
            <div class="progress">
              <div class="progress-bar" role="progressbar" :style="{ width: uploadProgress + '%' }">{{ uploadProgress }}%</div>
            </div>
          </div>
        </div>

        <div class="d-flex justify-content-between align-items-center">
          <div>
            <button class="btn btn-secondary" type="button" @click="cancel">Voltar</button>
          </div>
          <div>
            <button class="btn btn-primary" :disabled="saving">{{ isEdit ? 'Salvar alterações' : 'Criar produto' }}</button>
          </div>
        </div>

        <div v-if="error" class="alert alert-danger mt-3">{{ error }}</div>
      </form>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, nextTick, onBeforeUnmount, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import api from '../api'
import Swal from 'sweetalert2'
import ImageUploader from '../components/ImageUploader.vue'
import TextInput from '../components/form/input/TextInput.vue'
import TextareaInput from '../components/form/input/TextareaInput.vue'
import CurrencyInput from '../components/form/input/CurrencyInput.vue'
import SelectInput from '../components/form/select/SelectInput.vue'

const route = useRoute()
const router = useRouter()
const id = route.params.id || null
const isEdit = Boolean(id)

const form = ref({ id: null, name: '', description: '', price: 0, position: 0, isActive: true, image: null, optionGroupIds: [], categoryId: null, technicalSheetId: null, cashbackPercent: null })
const cashbackEnabled = ref(false)
const groups = ref([])
const categories = ref([])
const menus = ref([])
const technicalSheets = ref([])
const saving = ref(false)
const error = ref('')
const uploadProgress = ref(0)
const isUploading = ref(false)

async function load(){
  try{
    const gr = await api.get('/menu/options')
    groups.value = gr.data || []
    if(isEdit){
      const res = await api.get('/menu/products')
      const all = res.data || []
      const p = all.find(x=>x.id===id)
      if(p){ form.value = { ...p, optionGroupIds: [], categoryId: p.categoryId || (p.category && p.category.id) || null, cashbackPercent: (p.cashbackPercent !== undefined ? p.cashbackPercent : (p.cashback || null)) } }
      // load attached groups
      try{ const att = await api.get(`/menu/products/${id}/option-groups`); form.value.optionGroupIds = att.data.attachedIds || [] }catch(e){}
    }
    // load categories for select — if a menuId was provided in the query, request categories scoped to that menu
    try{
      const menuQuery = route.query.menuId ? `?menuId=${encodeURIComponent(route.query.menuId)}` : ''
      const cr = await api.get(`/menu/categories${menuQuery}`)
      categories.value = cr.data || []
    }catch(e){ categories.value = [] }
    // load menus for select
    try{ const mr = await api.get('/menu/menus'); menus.value = mr.data || [] }catch(e){ menus.value = [] }
    // load technical sheets for select and CMV calc
    try{ const ts = await api.get('/technical-sheets'); technicalSheets.value = ts.data || [] }catch(e){ technicalSheets.value = [] }
    // prefill category and menu if passed in query
    if(!isEdit){
      if(route.query.categoryId){ form.value.categoryId = route.query.categoryId }
      if(route.query.menuId){ form.value.menuId = route.query.menuId }
    }
    // load cashback settings to decide whether to show product-level input
    try{
      const cr = await api.get('/cashback/settings')
      const s = cr.data || null
      cashbackEnabled.value = !!(s && (s.enabled || s.isEnabled))
    }catch(e){ cashbackEnabled.value = false }
  }catch(e){ console.error(e); error.value = 'Falha ao carregar dados' }
}

function cancel(){
  const prevHistory = (typeof window !== 'undefined' && window.history && window.history.length > 1)
  if(prevHistory){ router.back(); return }
  // preserve menuId query when returning to the admin structure view
  const q = {}
  const mid = form.value.menuId || route.query.menuId
  if(mid) q.menuId = mid
  router.push({ path: '/menu/admin', query: q })
}

async function save(){
  error.value = ''
  saving.value = true
  try{
    if(!form.value.name) { error.value = 'Nome é obrigatório'; return }
    if(isEdit){
      const payload = { name: form.value.name, description: form.value.description, price: form.value.price, position: form.value.position, isActive: form.value.isActive, categoryId: form.value.categoryId, menuId: form.value.menuId, technicalSheetId: form.value.technicalSheetId }
      // include cashbackPercent when cashback module is enabled (allow null to clear)
      if(typeof form.value.cashbackPercent !== 'undefined') payload.cashbackPercent = form.value.cashbackPercent === '' ? null : form.value.cashbackPercent
      await api.patch(`/menu/products/${id}`, payload)
      // sync groups
      try{ await api.post(`/menu/products/${id}/option-groups`, { groupIds: form.value.optionGroupIds || [] }) }catch(e){ console.warn('Failed to sync groups', e) }
      Swal.fire({ icon: 'success', text: 'Produto atualizado' })
      // preserve menuId when navigating back to admin
      try{
        const q = {}
        const mid = form.value.menuId || route.query.menuId
        if(mid) q.menuId = mid
        router.push({ path: '/menu/admin', query: q })
      }catch(e){
        const prevHistory = (typeof window !== 'undefined' && window.history && window.history.length > 1)
        if(prevHistory){ router.back(); }
        else { router.push({ path: '/menu/admin' }) }
      }
    } else {
  const payload = { name: form.value.name, description: form.value.description, price: form.value.price, position: form.value.position, isActive: form.value.isActive, categoryId: form.value.categoryId, menuId: form.value.menuId, technicalSheetId: form.value.technicalSheetId }
  if(typeof form.value.cashbackPercent !== 'undefined') payload.cashbackPercent = form.value.cashbackPercent === '' ? null : form.value.cashbackPercent
      const res = await api.post('/menu/products', payload)
      const newId = res.data.id
      // attach groups
      try{ if((form.value.optionGroupIds||[]).length) await api.post(`/menu/products/${newId}/option-groups`, { groupIds: form.value.optionGroupIds }) }catch(e){ console.warn('Failed to attach groups', e) }
      // if image provided as base64, send via upload endpoint
      if(form.value.image){
        try{
          isUploading.value = true
          await api.post(`/menu/products/${newId}/image`, { imageBase64: form.value.image, filename: 'upload.jpg' })
        }catch(e){ console.warn('image upload failed', e) }
        finally{ isUploading.value = false }
      }
      Swal.fire({ icon: 'success', text: 'Produto criado' })
      try{
        const q = {}
        const mid = form.value.menuId || route.query.menuId
        if(mid) q.menuId = mid
        router.push({ path: '/menu/admin', query: q })
      }catch(e){
        const prevHistory = (typeof window !== 'undefined' && window.history && window.history.length > 1)
        if(prevHistory){ router.back(); }
        else { router.push({ path: '/menu/admin' }) }
      }
    }
  }catch(e){ console.error(e); error.value = e?.response?.data?.message || e.message || 'Erro' }
  finally{ saving.value = false }
}

// receive cropped image from ImageUploader
async function onProductImageCropped(dataUrl){
  try{ console.log('[ProductForm] onProductImageCropped received length=', dataUrl ? dataUrl.length : 0) }catch(e){}
  form.value.image = dataUrl
  // if editing, upload immediately
  if(isEdit){
    try{
      isUploading.value = true
      const res = await api.post(`/menu/products/${id}/image`, { imageBase64: dataUrl, filename: 'crop.jpg' })
      try{ console.log('[ProductForm] upload response', res && res.data) }catch(e){}
    }catch(e){ console.warn('upload failed', e) }
    finally{ isUploading.value = false }
  }
}

onMounted(()=> load())
onBeforeUnmount(()=>{
  // nothing to clean here; ImageUploader handles object URLs
})

// register components
const __components = { ImageUploader, TextInput, TextareaInput }

// computed helpers for CMV
const selectedTechnicalSheet = computed(() => {
  try{ return technicalSheets.value.find(s => String(s.id) === String(form.value.technicalSheetId)) || null }catch(e){ return null }
})
function sheetTotalCost(sheet){
  if(!sheet || !sheet.items) return 0
  return sheet.items.reduce((acc, it) => {
    const cost = (it.ingredient && it.ingredient.avgCost) ? Number(it.ingredient.avgCost) : 0
    const qty = Number(it.quantity || 0)
    return acc + (cost * qty)
  }, 0)
}
const sheetCost = computed(() => sheetTotalCost(selectedTechnicalSheet.value))
const cmvPercent = computed(() => {
  const price = Number(form.value.price || 0)
  if(!price || price <= 0) return null
  return (sheetCost.value / price) * 100
})
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

/* upload dropzone styles */
.upload-dropzone { border: 2px dashed #d9d9e6; border-radius:12px; padding:28px; cursor:pointer; background: #fff; display:block }
.upload-dropzone.drag-over { background: #f3f4ff; border-color: #b9afff }
.upload-inner { display:flex; align-items:center; justify-content:center; flex-direction:column; gap:12px; min-height:120px }
.upload-illustration svg { display:block }
.upload-message { color:#6b6b7b }
.btn-upload { background: linear-gradient(90deg,#5c6cff,#9b6bff); color: #fff; border: none; padding: .6rem 1.4rem; border-radius: 28px }
.btn-upload:hover { opacity: .95 }
/* preview with hover overlay */
.image-preview-wrapper { position: relative; width:160px; height:160px; border-radius:6px; overflow:hidden; cursor:pointer; display:inline-block }
.image-preview-img { width:100%; height:100%; object-fit:cover; display:block }
.image-preview-overlay { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; background: rgba(0,0,0,0.45); color:#fff; font-weight:700; letter-spacing:0.6px; opacity:0; transition: opacity .14s ease, transform .14s ease; transform: translateY(6px) }
.image-preview-wrapper:hover .image-preview-overlay, .image-preview-wrapper:focus .image-preview-overlay { opacity:1; transform: translateY(0) }
/* upload-preview inside dropzone */
.upload-preview { width:160px; height:160px; margin:0 auto; position:relative; border-radius:6px; overflow:hidden }
.upload-preview-img { width:100%; height:100%; object-fit:cover; display:block }
.upload-preview .image-preview-overlay { opacity:0; transition: opacity .14s ease, transform .14s ease; transform: translateY(6px); position:absolute; inset:0; display:flex; align-items:center; justify-content:center; background: rgba(0,0,0,0.45); color:#fff; font-weight:700; letter-spacing:0.6px }
.upload-preview:hover .image-preview-overlay, .upload-preview:focus .image-preview-overlay { opacity:1; transform: translateY(0) }
</style>
