<template>
  <div class="container py-4">
    <h2>{{ isEdit ? 'Editar opção' : 'Nova opção' }}</h2>
    <div class="card p-4 mt-3">
      <form @submit.prevent="save">
        <div class="mb-3">
          <label class="form-label">Nome</label>
          <TextInput v-model="form.name" placeholder="Ex: Extra queijo" required maxlength="80" />
        </div>

        <div class="mb-3">
          <label class="form-label">Descrição (opcional)</label>
          <TextareaInput v-model="form.description" rows="3" maxlength="400" placeholder="Detalhes da opção" />
        </div>

        <div class="row mb-3">
          <div class="col-md-3">
            <label class="form-label">Preço</label>
            <CurrencyInput v-model="form.price" inputClass="form-control" :min="0" placeholder="0,00" />
          </div>
            <div class="col-md-3">
              <label class="form-label">Ficha Técnica (opcional)</label>
              <SelectInput v-model="form.technicalSheetId" class="form-select">
                <option :value="null">-- Nenhuma --</option>
                <option v-for="s in technicalSheets" :key="s.id" :value="s.id">{{ s.name }} ({{ s.itemCount || 0 }} itens)</option>
              </SelectInput>
              <div class="small text-muted mt-1">
                <div v-if="sheetCost !== undefined && sheetCost !== null">Custo: <strong>{{ sheetCost.toFixed(2) }}</strong></div>
                <div v-if="cmvPercent !== null">CMV: <strong>{{ cmvPercent.toFixed(2) }}%</strong> (R$ {{ sheetCost.toFixed(2) }})</div>
                <div v-else class="text-muted">Preencha o preço para ver o CMV</div>
              </div>
            </div>
          <div class="col-md-3">
            <label class="form-label">Posição</label>
            <input v-model.number="form.position" type="number" class="form-control" />
          </div>
          <div class="col-md-3 d-flex align-items-end">
            <div class="form-check form-switch">
              <input class="form-check-input" type="checkbox" id="optActive" v-model="form.isAvailable" />
              <label class="form-check-label small text-muted" for="optActive">Disponível</label>
            </div>
          </div>
          <div class="col-md-3 d-flex align-items-end">
            <div class="form-check">
              <input class="form-check-input" type="checkbox" id="optAlways" v-model="form.alwaysAvailable" />
              <label class="form-check-label small text-muted" for="optAlways">Sempre disponível</label>
            </div>
          </div>
        </div>

        <div v-if="!form.alwaysAvailable && !form.linkedProductId" class="mb-3">
          <label class="form-label small">Dias disponíveis</label>
          <div class="d-flex flex-wrap gap-2">
            <div v-for="(d, idx) in daysOfWeek" :key="idx" class="form-check">
              <input class="form-check-input" type="checkbox" :id="'day-'+idx" :value="idx" v-model="form.availableDays" />
              <label class="form-check-label" :for="'day-'+idx">{{ d }}</label>
            </div>
          </div>
        </div>

        <div v-if="!form.alwaysAvailable && !form.linkedProductId" class="row mb-3">
          <div class="col-md-6">
            <label class="form-label small">Início</label>
            <input type="time" v-model="form.availableFrom" class="form-control" />
          </div>
          <div class="col-md-6">
            <label class="form-label small">Fim</label>
            <input type="time" v-model="form.availableTo" class="form-control" />
          </div>
        </div>

        <div class="mb-3">
          <label class="form-label">Vincular a produto (opcional)</label>
          <SelectInput   v-model="form.linkedProductId"  class="form-select">
            <option :value="null">Nenhum</option>
            <option v-for="p in productsList" :key="p.id" :value="p.id">{{ p.name }}</option>
          </SelectInput>
        </div>

        <div class="mb-3">
          <label class="form-label">Imagem da opção (opcional)</label>
          <div class="upload-dropzone" :class="{ 'drag-over': isDragOver }" @click="fileInputClick" @dragover.prevent="onDragOver" @dragleave.prevent="onDragLeave" @drop.prevent="onDrop">
            <div class="upload-inner text-center">
              <template v-if="!form.image">
                <div class="upload-illustration">
                  <svg width="72" height="56" viewBox="0 0 72 56" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M36 8v20" stroke="#7b61ff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M24 20l12-12 12 12" stroke="#7b61ff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M60 32c0-7.732-6.268-14-14-14-1.9 0-3.72.36-5.36 1.03C38.66 12.53 30.8 8 22 8 11.5 8 3 16.5 3 27s8.5 19 19 19h38c6.627 0 12-5.373 12-12 0-6.627-5.373-12-12-12z" stroke="#bfbffb" stroke-width="0" fill="#efe9ff"/></svg>
                </div>
                <div class="upload-message small text-muted">Nenhuma imagem selecionada</div>
                <div class="mt-3">
                  <button type="button" class="btn btn-upload" @click.stop="fileInputClick">ESCOLHER IMAGEM</button>
                </div>
              </template>
                          <template v-else>
                            <div class="upload-preview">
                              <img :src="assetUrl(form.image)" alt="Preview" class="upload-preview-img" />
                              <div class="image-preview-overlay">TROCAR IMAGEM</div>
                            </div>
                          </template>
            </div>
          </div>
          <input ref="fileInput" type="file" accept="image/*" @change="onFileChange" style="display:none" aria-label="Selecionar imagem" />
          <div v-if="showCropper" class="cropper-modal" role="dialog" aria-modal="true">
            <div class="cropper-modal-content modal-content-padding">
              <div class="cropper-canvas-wrapper">
                <div ref="cropContainer" class="crop-image-container">
                  <img ref="cropperImage" :src="currentObjectUrl" alt="Preview" class="crop-image" @load="onImageLoaded" />
                  <div ref="cropBox" class="crop-box" :style="cropBoxStyle" @pointerdown.stop.prevent="startDrag"></div>
                </div>
              </div>
              <div class="mt-2 d-flex align-items-center" style="gap:8px;">
                <label class="small text-muted mb-0">Tamanho</label>
                <input type="range" min="50" max="100" v-model.number="cropSizePct" @input="onSizeChange" />
              </div>
              <div class="cropper-actions mt-3 d-flex justify-content-end" style="gap:8px;">
                <button type="button" class="btn btn-secondary" @click="cancelCrop">Cancelar</button>
                <button type="button" class="btn btn-primary" @click="confirmCrop">Usar imagem</button>
              </div>
            </div>
          </div>
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
            <button class="btn btn-primary" :disabled="saving">{{ isEdit ? 'Salvar alterações' : 'Criar opção' }}</button>
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
import { assetUrl } from '../utils/assetUrl.js'
import TextInput from '../components/form/input/TextInput.vue'
import TextareaInput from '../components/form/input/TextareaInput.vue'

const route = useRoute()
const router = useRouter()
const id = route.params.id || null
const isEdit = Boolean(id)
const query = route.query || {}
const groupId = query.groupId || null

const form = ref({ id: null, name: '', description: '', price: 0, position: 0, isAvailable: true, alwaysAvailable: true, availableDays: [], availableFrom: '', availableTo: '', linkedProductId: null, image: null, technicalSheetId: null })
const productsList = ref([])
const technicalSheets = ref([])
const saving = ref(false)
const error = ref('')

// image / crop state
const fileInput = ref(null)
const showCropper = ref(false)
const cropperImage = ref(null)
const cropContainer = ref(null)
const cropBox = ref(null)
let currentObjectUrl = null
const cropSizePct = ref(80)
const cropPos = ref({ x: 0, y: 0 })
let dragging = false
let dragStart = null
let imgDisplay = { w: 0, h: 0, leftInContainer: 0, topInContainer: 0, naturalW: 0, naturalH: 0 }
const uploadProgress = ref(0)
const isUploading = ref(false)
const isDragOver = ref(false)

const daysOfWeek = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb']

async function load(){
  try{
    try{ const pr = await api.get('/menu/products'); productsList.value = pr.data || [] }catch(e){ productsList.value = [] }
    if(isEdit){
      const res = await api.get(`/menu/options/options/${id}`)
      const o = res.data
      if(o){
        form.value = {
          id: o.id,
          name: o.name || '',
          description: o.description || '',
          price: Number(o.price||0),
          position: o.position || 0,
          isAvailable: o.isAvailable === undefined ? true : o.isAvailable,
          alwaysAvailable: !(o.availableDays && o.availableDays.length) && !o.availableFrom && !o.availableTo,
          availableDays: o.availableDays || [],
          availableFrom: o.availableFrom || '',
          availableTo: o.availableTo || '',
          linkedProductId: o.linkedProductId || null,
          image: o.image || null,
          technicalSheetId: o.technicalSheetId || null
        }
      }
    } else if(groupId){
      // prefill groupId context if provided
    }
    // load technical sheets
    try{ const ts = await api.get('/technical-sheets'); technicalSheets.value = ts.data || [] }catch(e){ technicalSheets.value = [] }
  }catch(e){ console.error(e); error.value = 'Falha ao carregar dados' }
}

function cancel(){ router.push({ path: '/menu/options' }) }

async function save(){
  error.value = ''
  saving.value = true
  try{
    if(!form.value.name) { error.value = 'Nome é obrigatório'; saving.value = false; return }
    if(isNaN(Number(form.value.price)) || Number(form.value.price) < 0){ error.value = 'Preço inválido'; saving.value = false; return }

    const payload = {
      name: form.value.name,
      description: form.value.description,
      technicalSheetId: form.value.technicalSheetId || null,
      price: Number(form.value.price || 0),
      position: Number(form.value.position || 0),
      isAvailable: !!form.value.isAvailable,
      linkedProductId: form.value.linkedProductId || null
    }
    if(!form.value.linkedProductId){
      payload.availableDays = form.value.alwaysAvailable ? null : (form.value.availableDays || [])
      payload.availableFrom = form.value.alwaysAvailable ? null : form.value.availableFrom || null
      payload.availableTo = form.value.alwaysAvailable ? null : form.value.availableTo || null
    }

    if(isEdit){
      await api.patch(`/menu/options/options/${id}`, payload)
      // upload image if present and changed
      if(form.value.image && typeof form.value.image === 'string' && form.value.image.startsWith('data:')){
        // ASSUMPTION: backend exposes an image upload endpoint similar to products
        try{ isUploading.value = true; await api.post(`/menu/options/options/${id}/image`, { imageBase64: form.value.image, filename: 'option-image.jpg' }) }catch(e){ console.warn('image upload failed', e) } finally{ isUploading.value = false }
      }
      Swal.fire({ icon: 'success', text: 'Opção atualizada' })
    } else {
      if(!groupId){ await Swal.fire({ icon: 'warning', text: 'Grupo não especificado para a nova opção' }); saving.value = false; return }
      const res = await api.post(`/menu/options/${groupId}/options`, payload)
      const newId = res.data && res.data.id
      if(form.value.image && typeof form.value.image === 'string' && form.value.image.startsWith('data:') && newId){
        try{ isUploading.value = true; await api.post(`/menu/options/${newId}/image`, { imageBase64: form.value.image, filename: 'option-image.jpg' }) }catch(e){ console.warn('image upload failed', e) } finally{ isUploading.value = false }
      }
      Swal.fire({ icon: 'success', text: 'Opção criada' })
    }
    router.push({ path: '/menu/options' })
  }catch(e){ console.error(e); error.value = e?.response?.data?.message || e.message || 'Erro ao salvar' }
  finally{ saving.value = false }
}

// image handlers (copied/simplified from ProductForm)
function processFile(file){
  if(!file) return
  const objectUrl = URL.createObjectURL(file)
  currentObjectUrl = objectUrl
  showCropper.value = true
  nextTick(() => { cropSizePct.value = 80; cropPos.value = { x:0, y:0 } })
}

function onFileChange(e){ const f = e.target.files && e.target.files[0]; if(!f) return; processFile(f) }
function fileInputClick(){ if(fileInput.value) fileInput.value.click() }
function onDragOver(e){ isDragOver.value = true }
function onDragLeave(e){ isDragOver.value = false }
function onDrop(e){ isDragOver.value = false; const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if(f) processFile(f) }

function onImageLoaded(e){ const img = cropperImage.value; if(!img) return; const imgRect = img.getBoundingClientRect(); const containerRect = cropContainer.value ? cropContainer.value.getBoundingClientRect() : imgRect; imgDisplay.w = imgRect.width; imgDisplay.h = imgRect.height; imgDisplay.leftInContainer = imgRect.left - containerRect.left; imgDisplay.topInContainer = imgRect.top - containerRect.top; imgDisplay.naturalW = img.naturalWidth || img.width; imgDisplay.naturalH = img.naturalHeight || img.height; cropPos.value = { x:0, y:0 } }

const cropBoxStyle = computed(() => {
  const dw = imgDisplay.w || 0; const dh = imgDisplay.h || 0; const side = Math.min(dw, dh) * (cropSizePct.value / 100); const offsetX = imgDisplay.leftInContainer || 0; const offsetY = imgDisplay.topInContainer || 0; const left = offsetX + (dw - side) / 2 + (cropPos.value.x || 0); const top = offsetY + (dh - side) / 2 + (cropPos.value.y || 0); return { left: `${left}px`, top: `${top}px`, width: `${side}px`, height: `${side}px` }
})

// CMV helpers for option
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

function startDrag(e){ const p = e; dragging = true; dragStart = { x: p.clientX, y: p.clientY, startPos: { ...cropPos.value } }; window.addEventListener('pointermove', onPointerMove); window.addEventListener('pointerup', endDrag) }
function onPointerMove(e){ if(!dragging || !dragStart) return; const dx = e.clientX - dragStart.x; const dy = e.clientY - dragStart.y; const dw = imgDisplay.w || 0; const dh = imgDisplay.h || 0; const side = Math.min(dw, dh) * (cropSizePct.value / 100); const limitX = Math.max(0, (dw - side) / 2); const limitY = Math.max(0, (dh - side) / 2); let nx = dragStart.startPos.x + dx; let ny = dragStart.startPos.y + dy; nx = Math.max(-limitX, Math.min(limitX, nx)); ny = Math.max(-limitY, Math.min(limitY, ny)); cropPos.value = { x: nx, y: ny } }
function endDrag(){ dragging = false; dragStart = null; window.removeEventListener('pointermove', onPointerMove); window.removeEventListener('pointerup', endDrag) }

function onSizeChange(){ const dw = imgDisplay.w || 0; const dh = imgDisplay.h || 0; const side = Math.min(dw, dh) * (cropSizePct.value / 100); const limitX = Math.max(0, (dw - side) / 2); const limitY = Math.max(0, (dh - side) / 2); cropPos.value.x = Math.max(-limitX, Math.min(limitX, cropPos.value.x || 0)); cropPos.value.y = Math.max(-limitY, Math.min(limitY, cropPos.value.y || 0)) }

async function applyCrop(){ try{ const img = cropperImage.value; if(!img) return null; const { w: dw, h: dh, leftInContainer: dl, topInContainer: dt, naturalW, naturalH } = imgDisplay; const sideDisplay = Math.min(dw, dh) * (cropSizePct.value / 100); const cx = (dl || 0) + (dw - sideDisplay) / 2 + (cropPos.value.x || 0); const cy = (dt || 0) + (dh - sideDisplay) / 2 + (cropPos.value.y || 0); const sx = Math.max(0, Math.round((cx - (dl || 0)) * (naturalW / dw))); const sy = Math.max(0, Math.round((cy - (dt || 0)) * (naturalH / dh))); const sSide = Math.max(1, Math.round(sideDisplay * (naturalW / dw))); const canvas = document.createElement('canvas'); canvas.width = 600; canvas.height = 600; const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0,0,600,600); ctx.drawImage(img, sx, sy, sSide, sSide, 0, 0, 600, 600); const dataUrl = canvas.toDataURL('image/jpeg', 0.9); return dataUrl }catch(e){ console.error('Failed to crop', e); return null } }

async function confirmCrop(){ try{ isUploading.value = true; const dataUrl = await applyCrop(); if(dataUrl){ form.value.image = dataUrl; if(isEdit && form.value.id){ try{ await api.post(`/menu/options/options/${id}/image`, { imageBase64: dataUrl, filename: 'crop.jpg' }) }catch(e){ console.warn('upload failed', e) } } } }catch(e){ console.error(e); error.value = 'Falha ao processar imagem' } finally{ isUploading.value = false; closeCropper() } }

function cancelCrop(){ closeCropper() }
function closeCropper(){ showCropper.value = false; if(currentObjectUrl){ try{ URL.revokeObjectURL(currentObjectUrl) }catch(e){} currentObjectUrl = null } if(fileInput.value){ fileInput.value.value = '' } }

onMounted(()=> load())
onBeforeUnmount(()=>{ if(currentObjectUrl){ try{ URL.revokeObjectURL(currentObjectUrl) }catch(e){} currentObjectUrl = null } })

</script>

<style scoped>
/* reuse admin shared styles for upload/crop visuals (kept small here) */
.cropper-modal { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display:flex; align-items:center; justify-content:center; z-index:2000 }
.cropper-modal-content { background: #fff; border-radius:8px; max-width:92vw; width:720px; max-height:92vh; overflow:auto }
.cropper-canvas-wrapper { width:100%; height: auto; display:flex; align-items:center; justify-content:center }
.crop-image-container { position: relative; width:100%; max-height:64vh; display:flex; align-items:center; justify-content:center; overflow:hidden; background:#f5f5f5 }
.crop-image { max-width:100%; max-height:64vh; user-select:none; -webkit-user-drag:none }
.crop-box { position:absolute; border:2px dashed #fff; box-shadow: 0 6px 18px rgba(0,0,0,0.2); background: rgba(255,255,255,0.02); touch-action: none }
.upload-dropzone { border: 2px dashed #d9d9e6; border-radius:12px; padding:18px; cursor:pointer; background: #fff; display:block }
.upload-dropzone.drag-over { background: #f3f4ff; border-color: #b9afff }
.upload-inner { display:flex; align-items:center; justify-content:center; flex-direction:column; gap:12px; min-height:100px }
.btn-upload { background: linear-gradient(90deg,#5c6cff,#9b6bff); color: #fff; border: none; padding: .5rem 1rem; border-radius: 20px }
.upload-preview { width:120px; height:120px; margin:0 auto; position:relative; border-radius:6px; overflow:hidden }
.upload-preview-img { width:100%; height:100%; object-fit:cover; display:block }
.image-preview-overlay { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; background: rgba(0,0,0,0.45); color:#fff; font-weight:700; letter-spacing:0.6px; opacity:0; transition: opacity .14s ease, transform .14s ease; transform: translateY(6px) }
.upload-preview:hover .image-preview-overlay, .upload-preview:focus .image-preview-overlay { opacity:1; transform: translateY(0) }
</style>
