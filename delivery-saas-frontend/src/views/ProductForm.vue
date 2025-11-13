<template>
  <div class="container py-4">
    <h2>{{ isEdit ? 'Editar produto' : 'Novo produto' }}</h2>
    <div class="card p-4 mt-3">
      <form @submit.prevent="save">
        <div class="mb-3">
          <label class="form-label">Nome do Produto</label>
          <input v-model="form.name" class="form-control" placeholder="Ex: Coxinha" required maxlength="80" />
        </div>
        <div class="mb-3">
          <label class="form-label">Descrição</label>
          <textarea v-model="form.description" class="form-control" placeholder="Descrição" rows="4" maxlength="1000"></textarea>
        </div>
        <div class="row mb-3">
          <div class="col-md-4">
            <label class="form-label">Preço</label>
            <input v-model.number="form.price" type="number" step="0.01" class="form-control" />
          </div>
          <div class="col-md-4">
            <label class="form-label">Categoria</label>
            <select v-model="form.categoryId" class="form-control">
              <option :value="null">Sem categoria</option>
              <option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option>
            </select>
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
          <div class="upload-dropzone" :class="{ 'drag-over': isDragOver }" @click="fileInputClick" @dragover.prevent="onDragOver" @dragleave.prevent="onDragLeave" @drop.prevent="onDrop">
            <div class="upload-inner text-center">
              <template v-if="!form.image">
                <div class="upload-illustration">
                  <!-- simple cloud upload SVG -->
                  <svg width="72" height="56" viewBox="0 0 72 56" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M36 8v20" stroke="#7b61ff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M24 20l12-12 12 12" stroke="#7b61ff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M60 32c0-7.732-6.268-14-14-14-1.9 0-3.72.36-5.36 1.03C38.66 12.53 30.8 8 22 8 11.5 8 3 16.5 3 27s8.5 19 19 19h38c6.627 0 12-5.373 12-12 0-6.627-5.373-12-12-12z" stroke="#bfbffb" stroke-width="0" fill="#efe9ff"/></svg>
                </div>
                <div class="upload-message small text-muted">No file chosen, yet!</div>
                <div class="mt-3">
                  <button type="button" class="btn btn-upload" @click.stop="fileInputClick">CHOOSE A FILE</button>
                </div>
              </template>
              <template v-else>
                <div class="upload-preview">
                  <img :src="form.image" alt="Preview" class="upload-preview-img" />
                  <div class="image-preview-overlay">TROCAR IMAGEM</div>
                </div>
              </template>
            </div>
          </div>
          <!-- always-available hidden file input -->
          <input ref="fileInput" type="file" accept="image/*" @change="onFileChange" style="display:none" aria-label="Selecionar imagem" />
          <!-- always-available hidden file input (placed after templates so it's present whether or not an image exists) -->
          <input ref="fileInput" type="file" accept="image/*" @change="onFileChange" style="display:none" aria-label="Selecionar imagem" />
          <!-- Cropper modal -->
          <div v-if="showCropper" class="cropper-modal" role="dialog" aria-modal="true">
            <div class="cropper-modal-content">
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

const route = useRoute()
const router = useRouter()
const id = route.params.id || null
const isEdit = Boolean(id)

const form = ref({ id: null, name: '', description: '', price: 0, position: 0, isActive: true, image: null, optionGroupIds: [], categoryId: null })
const groups = ref([])
const categories = ref([])
const saving = ref(false)
const error = ref('')
const fileInput = ref(null)
const showCropper = ref(false)
const cropperImage = ref(null)
const cropContainer = ref(null)
const cropBox = ref(null)
let currentObjectUrl = null
// crop box state: percentage-based relative to displayed image
const cropSizePct = ref(80) // percent of the smaller dimension
const cropPos = ref({ x: 0, y: 0 })
let dragging = false
let dragStart = null
let imgDisplay = { w: 0, h: 0, left: 0, top: 0, naturalW: 0, naturalH: 0 }
  const uploadProgress = ref(0)
const isUploading = ref(false)
  const isDragOver = ref(false)

async function load(){
  try{
    const gr = await api.get('/menu/options')
    groups.value = gr.data || []
    if(isEdit){
      const res = await api.get('/menu/products')
      const all = res.data || []
      const p = all.find(x=>x.id===id)
      if(p){ form.value = { ...p, optionGroupIds: [], categoryId: p.categoryId || (p.category && p.category.id) || null } }
      // load attached groups
      try{ const att = await api.get(`/menu/products/${id}/option-groups`); form.value.optionGroupIds = att.data.attachedIds || [] }catch(e){}
    }
    // load categories for select
    try{ const cr = await api.get('/menu/categories'); categories.value = cr.data || [] }catch(e){ categories.value = [] }
    // prefill category if passed in query
    if(!isEdit && route.query.categoryId){ form.value.categoryId = route.query.categoryId }
  }catch(e){ console.error(e); error.value = 'Falha ao carregar dados' }
}

function cancel(){ router.push({ path: '/menu/admin' }) }

async function save(){
  error.value = ''
  saving.value = true
  try{
    if(!form.value.name) { error.value = 'Nome é obrigatório'; return }
    if(isEdit){
      const payload = { name: form.value.name, description: form.value.description, price: form.value.price, position: form.value.position, isActive: form.value.isActive }
      await api.patch(`/menu/products/${id}`, payload)
      // update category if present
      try{ await api.patch(`/menu/products/${id}`, { categoryId: form.value.categoryId }) }catch(e){}
      // sync groups
      try{ await api.post(`/menu/products/${id}/option-groups`, { groupIds: form.value.optionGroupIds || [] }) }catch(e){ console.warn('Failed to sync groups', e) }
      Swal.fire({ icon: 'success', text: 'Produto atualizado' })
      router.push({ path: '/menu/admin' })
    } else {
  const payload = { name: form.value.name, description: form.value.description, price: form.value.price, position: form.value.position, isActive: form.value.isActive, categoryId: form.value.categoryId }
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
      router.push({ path: '/menu/admin' })
    }
  }catch(e){ console.error(e); error.value = e?.response?.data?.message || e.message || 'Erro' }
  finally{ saving.value = false }
}

function processFile(file){
  if(!file) return
  const objectUrl = URL.createObjectURL(file)
  currentObjectUrl = objectUrl
  showCropper.value = true
  nextTick(() => {
    cropSizePct.value = 80
    cropPos.value = { x: 0, y: 0 }
  })
}

function onFileChange(e){
  const f = e.target.files && e.target.files[0]
  if(!f) return
  processFile(f)
}

function fileInputClick(){ if(fileInput.value) fileInput.value.click() }

function onDragOver(e){ isDragOver.value = true }
function onDragLeave(e){ isDragOver.value = false }
function onDrop(e){ isDragOver.value = false; const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if(f) processFile(f) }

function onImageLoaded(e){
  // compute displayed image metrics
  const img = cropperImage.value
  if(!img) return
  const imgRect = img.getBoundingClientRect()
  const containerRect = cropContainer.value ? cropContainer.value.getBoundingClientRect() : imgRect
  imgDisplay.w = imgRect.width
  imgDisplay.h = imgRect.height
  // left/top relative to container (not viewport) so overlay positioning aligns
  imgDisplay.leftInContainer = imgRect.left - containerRect.left
  imgDisplay.topInContainer = imgRect.top - containerRect.top
  imgDisplay.naturalW = img.naturalWidth || img.width
  imgDisplay.naturalH = img.naturalHeight || img.height
  // center crop box and reset pos
  cropPos.value = { x: 0, y: 0 }
}

const cropBoxStyle = computed(() => {
  const dw = imgDisplay.w || 0
  const dh = imgDisplay.h || 0
  const side = Math.min(dw, dh) * (cropSizePct.value / 100)
  const offsetX = imgDisplay.leftInContainer || 0
  const offsetY = imgDisplay.topInContainer || 0
  const left = offsetX + (dw - side) / 2 + (cropPos.value.x || 0)
  const top = offsetY + (dh - side) / 2 + (cropPos.value.y || 0)
  return { left: `${left}px`, top: `${top}px`, width: `${side}px`, height: `${side}px` }
})

function startDrag(e){
  // pointerdown on crop box
  const p = e
  dragging = true
  dragStart = { x: p.clientX, y: p.clientY, startPos: { ...cropPos.value } }
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', endDrag)
}

function onPointerMove(e){
  if(!dragging || !dragStart) return
  const dx = e.clientX - dragStart.x
  const dy = e.clientY - dragStart.y
  const dw = imgDisplay.w || 0
  const dh = imgDisplay.h || 0
  const side = Math.min(dw, dh) * (cropSizePct.value / 100)
  const limitX = Math.max(0, (dw - side) / 2)
  const limitY = Math.max(0, (dh - side) / 2)
  let nx = dragStart.startPos.x + dx
  let ny = dragStart.startPos.y + dy
  nx = Math.max(-limitX, Math.min(limitX, nx))
  ny = Math.max(-limitY, Math.min(limitY, ny))
  cropPos.value = { x: nx, y: ny }
}

function endDrag(){
  dragging = false
  dragStart = null
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', endDrag)
}

function onSizeChange(){
  // ensure position remains valid after size change
  const dw = imgDisplay.w || 0
  const dh = imgDisplay.h || 0
  const side = Math.min(dw, dh) * (cropSizePct.value / 100)
  const limitX = Math.max(0, (dw - side) / 2)
  const limitY = Math.max(0, (dh - side) / 2)
  cropPos.value.x = Math.max(-limitX, Math.min(limitX, cropPos.value.x || 0))
  cropPos.value.y = Math.max(-limitY, Math.min(limitY, cropPos.value.y || 0))
}

async function applyCrop(){
  try{
    // compute crop in image coordinates using displayed image box
    const img = cropperImage.value
    if(!img) return null
  const { w: dw, h: dh, leftInContainer: dl, topInContainer: dt, naturalW, naturalH } = imgDisplay
  const sideDisplay = Math.min(dw, dh) * (cropSizePct.value / 100)
  const cx = (dl || 0) + (dw - sideDisplay) / 2 + (cropPos.value.x || 0)
  const cy = (dt || 0) + (dh - sideDisplay) / 2 + (cropPos.value.y || 0)
  // relative to displayed image
  const sx = Math.max(0, Math.round((cx - (dl || 0)) * (naturalW / dw)))
  const sy = Math.max(0, Math.round((cy - (dt || 0)) * (naturalH / dh)))
  const sSide = Math.max(1, Math.round(sideDisplay * (naturalW / dw)))
    const canvas = document.createElement('canvas')
    canvas.width = 600; canvas.height = 600
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#fff'; ctx.fillRect(0,0,600,600)
    ctx.drawImage(img, sx, sy, sSide, sSide, 0, 0, 600, 600)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9)
    return dataUrl
  }catch(e){ console.error('Failed to crop', e); return null }
}

async function confirmCrop(){
  // convert cropped area to dataUrl and assign
  try{
    isUploading.value = true
    const dataUrl = await applyCrop()
    if(dataUrl){
      form.value.image = dataUrl
      // upload immediately if editing
      if(isEdit && form.value.id){
        try{ await api.post(`/menu/products/${id}/image`, { imageBase64: dataUrl, filename: 'crop.jpg' }) }catch(e){ console.warn('upload failed', e) }
      }
    }
  }catch(e){ console.error(e); error.value = 'Falha ao processar imagem' }
  finally{
    isUploading.value = false
    closeCropper()
  }
}

function cancelCrop(){
  // close modal and clean up
  closeCropper()
}

function closeCropper(){
  showCropper.value = false
  if(currentObjectUrl){ try{ URL.revokeObjectURL(currentObjectUrl) }catch(e){} currentObjectUrl = null }
  // reset file input so same file can be reselected
  if(fileInput.value){ fileInput.value.value = '' }
}

// resize helper
async function cropAndResizeImage(file, maxWidth = 1200, maxHeight = 1200, quality = 0.8){
  const objectUrl = URL.createObjectURL(file)
  const img = await new Promise((resolve,reject)=>{
    const i = new Image(); i.onload = ()=>resolve(i); i.onerror = e=>reject(e); i.src = objectUrl
  })
  // center-crop to square (1:1)
  const side = Math.min(img.width, img.height)
  const sx = Math.round((img.width - side) / 2)
  const sy = Math.round((img.height - side) / 2)
  // target size: do not upscale, respect provided max dims
  const target = Math.min(maxWidth, maxHeight, side)
  const canvas = document.createElement('canvas'); canvas.width = target; canvas.height = target
  const ctx = canvas.getContext('2d')
  // white background for JPEG
  ctx.fillStyle = '#fff'
  ctx.fillRect(0,0,target,target)
  // draw the cropped region scaled to target
  ctx.drawImage(img, sx, sy, side, side, 0, 0, target, target)
  const dataUrl = canvas.toDataURL('image/jpeg', Math.max(0.5, Math.min(quality,0.95)))
  URL.revokeObjectURL(objectUrl)
  return dataUrl
}

onMounted(()=> load())

onBeforeUnmount(()=>{
  // nothing to destroy from vue-cropperjs; component will be unmounted normally
  if(currentObjectUrl){ try{ URL.revokeObjectURL(currentObjectUrl) }catch(e){} currentObjectUrl = null }
})
</script>

<style scoped>
.cropper-modal { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display:flex; align-items:center; justify-content:center; z-index:2000 }
.cropper-modal-content { background: #fff; padding: 16px; border-radius:8px; max-width:92vw; width:720px; max-height:92vh; overflow:auto }
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
