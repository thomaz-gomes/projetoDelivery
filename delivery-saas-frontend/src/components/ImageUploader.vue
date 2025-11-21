<template>
  <div>
    <label class="form-label">{{ label }}</label>
    <div class="upload-dropzone" :class="{ 'drag-over': isDragOver }" @click="triggerFileInput" @dragover.prevent="onDragOver" @dragleave.prevent="onDragLeave" @drop.prevent="onDrop">
      <div class="upload-inner text-center">
        <template v-if="!previewUrl">
          <div class="upload-illustration">
            <svg width="72" height="56" viewBox="0 0 72 56" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M36 8v20" stroke="#7b61ff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M24 20l12-12 12 12" stroke="#7b61ff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M60 32c0-7.732-6.268-14-14-14-1.9 0-3.72.36-5.36 1.03C38.66 12.53 30.8 8 22 8 11.5 8 3 16.5 3 27s8.5 19 19 19h38c6.627 0 12-5.373 12-12 0-6.627-5.373-12-12-12z" stroke="#bfbffb" stroke-width="0" fill="#efe9ff"/></svg>
          </div>
          <div class="upload-message small text-muted">Nenhuma imagem selecionada</div>
          <div class="mt-3">
            <button type="button" class="btn btn-upload" @click.stop="triggerFileInput">SELECIONAR</button>
          </div>
        </template>
        <template v-else>
          <div class="upload-preview">
            <img :src="assetUrl(previewUrl)" alt="Preview" class="upload-preview-img" />
            <div class="image-preview-overlay">TROCAR IMAGEM</div>
          </div>
        </template>
      </div>
    </div>
    <input ref="fileInput" type="file" :accept="accept" @change="onFileChange" style="display:none" />

    <!-- cropper modal -->
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

  </div>
</template>

<script setup>
import { ref, computed, nextTick, onBeforeUnmount } from 'vue'
const props = defineProps({ initialUrl: { type: String, default: null }, label: { type: String, default: 'Imagem' }, accept: { type: String, default: 'image/*' }, aspect: { type: Number, default: 1 }, targetWidth: { type: Number, default: 450 }, targetHeight: { type: Number, default: 450 }, uploadUrl: { type: String, default: null }, uploadKey: { type: String, default: 'imageBase64' } })
// declared emits to avoid Vue runtime warnings
const emit = defineEmits(['cropped', 'uploaded', 'upload-error'])

const fileInput = ref(null)
const previewUrl = ref(props.initialUrl || null)

// keep preview in sync if parent updates initialUrl after mount
import { watch } from 'vue'
watch(() => props.initialUrl, (v) => {
  previewUrl.value = v || null
})
// debug: log when initialUrl changes
watch(() => props.initialUrl, (v, old) => {
  try{ console.log('[ImageUploader] initialUrl changed', { new: v, old }) }catch(e){}
})
const isDragOver = ref(false)

// cropper state
const showCropper = ref(false)
const cropperImage = ref(null)
const cropContainer = ref(null)
const cropBox = ref(null)
let currentObjectUrl = null
const cropSizePct = ref(80)
const cropPos = ref({ x: 0, y: 0 })
let dragging = false
let dragStart = null
const imgDisplay = { w: 0, h: 0, leftInContainer: 0, topInContainer: 0, naturalW: 0, naturalH: 0 }

function triggerFileInput(){ if(fileInput.value) fileInput.value.click() }
function onDragOver(e){ isDragOver.value = true }
function onDragLeave(e){ isDragOver.value = false }
function onDrop(e){ isDragOver.value = false; const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if(f) processFile(f) }
function onFileChange(e){ const f = e.target.files && e.target.files[0]; if(!f) return; processFile(f); try{ e.target.value = '' }catch{} }

function processFile(file){ if(!file) return; const objectUrl = URL.createObjectURL(file); currentObjectUrl = objectUrl; showCropper.value = true; nextTick(()=>{ cropSizePct.value = 80; cropPos.value = { x:0, y:0 } }) }

function onImageLoaded(){ const img = cropperImage.value; if(!img) return; const imgRect = img.getBoundingClientRect(); const containerRect = cropContainer.value ? cropContainer.value.getBoundingClientRect() : imgRect; imgDisplay.w = imgRect.width; imgDisplay.h = imgRect.height; imgDisplay.leftInContainer = imgRect.left - containerRect.left; imgDisplay.topInContainer = imgRect.top - containerRect.top; imgDisplay.naturalW = img.naturalWidth || img.width; imgDisplay.naturalH = img.naturalHeight || img.height; cropPos.value = { x:0, y:0 } }

const cropBoxStyle = computed(()=>{ const dw = imgDisplay.w || 0; const dh = imgDisplay.h || 0; const aspect = props.aspect || 1; const base = Math.min(dh, dw / aspect); const hDisplay = base * (cropSizePct.value/100); const wDisplay = hDisplay * aspect; const offsetX = imgDisplay.leftInContainer || 0; const offsetY = imgDisplay.topInContainer || 0; const left = offsetX + (dw - wDisplay)/2 + (cropPos.value.x || 0); const top = offsetY + (dh - hDisplay)/2 + (cropPos.value.y || 0); return { left: `${left}px`, top: `${top}px`, width: `${wDisplay}px`, height: `${hDisplay}px` } })

function startDrag(e){ dragging = true; dragStart = { x: e.clientX, y: e.clientY, startPos: { ...cropPos.value } }; window.addEventListener('pointermove', onPointerMove); window.addEventListener('pointerup', endDrag) }
function onPointerMove(e){ if(!dragging || !dragStart) return; const dx = e.clientX - dragStart.x; const dy = e.clientY - dragStart.y; const dw = imgDisplay.w || 0; const dh = imgDisplay.h || 0; const aspect = props.aspect || 1; const base = Math.min(dh, dw / aspect); const hDisplay = base * (cropSizePct.value/100); const wDisplay = hDisplay * aspect; const limitX = Math.max(0, (dw - wDisplay)/2); const limitY = Math.max(0, (dh - hDisplay)/2); let nx = dragStart.startPos.x + dx; let ny = dragStart.startPos.y + dy; nx = Math.max(-limitX, Math.min(limitX, nx)); ny = Math.max(-limitY, Math.min(limitY, ny)); cropPos.value = { x: nx, y: ny } }
function endDrag(){ dragging = false; dragStart = null; window.removeEventListener('pointermove', onPointerMove); window.removeEventListener('pointerup', endDrag) }
function onSizeChange(){ const dw = imgDisplay.w || 0; const dh = imgDisplay.h || 0; const aspect = props.aspect || 1; const base = Math.min(dh, dw / aspect); const hDisplay = base * (cropSizePct.value/100); const wDisplay = hDisplay * aspect; const limitX = Math.max(0, (dw - wDisplay)/2); const limitY = Math.max(0, (dh - hDisplay)/2); cropPos.value.x = Math.max(-limitX, Math.min(limitX, cropPos.value.x || 0)); cropPos.value.y = Math.max(-limitY, Math.min(limitY, cropPos.value.y || 0)); }

async function applyCrop(){ try{ const img = cropperImage.value; if(!img) return null; const { w: dw, h: dh, leftInContainer: dl, topInContainer: dt, naturalW, naturalH } = imgDisplay; const aspect = props.aspect || 1; const base = Math.min(dh, dw / aspect); const hDisplay = base * (cropSizePct.value/100); const wDisplay = hDisplay * aspect; const cx = (dl || 0) + (dw - wDisplay)/2 + (cropPos.value.x || 0); const cy = (dt || 0) + (dh - hDisplay)/2 + (cropPos.value.y || 0); const sx = Math.max(0, Math.round((cx - (dl || 0)) * (naturalW / dw))); const sy = Math.max(0, Math.round((cy - (dt || 0)) * (naturalH / dh))); const sWidth = Math.max(1, Math.round(wDisplay * (naturalW / dw))); const sHeight = Math.max(1, Math.round(hDisplay * (naturalH / dh))); const canvas = document.createElement('canvas'); const targetW = props.targetWidth || 450; const targetH = props.targetHeight || 450; canvas.width = targetW; canvas.height = targetH; const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0,0,targetW,targetH); ctx.drawImage(img, sx, sy, sWidth, sHeight, 0, 0, targetW, targetH); const dataUrl = canvas.toDataURL('image/jpeg', 0.9); return dataUrl } catch(e){ console.error('Failed to crop', e); return null } }

import api from '../api'
import { assetUrl } from '../utils/assetUrl.js'

async function confirmCrop(){
  try{
    const dataUrl = await applyCrop()
    if (!dataUrl) return
    // emit cropped for parent to react if needed
    emit('cropped', dataUrl)
    // if uploadUrl provided, upload and emit uploaded with returned URL
    if (props.uploadUrl) {
      try{
        const payload = { [props.uploadKey]: dataUrl }
        try{ console.log('[ImageUploader] uploading to', props.uploadUrl, 'with key', props.uploadKey) }catch(e){}
        const res = await api.post(props.uploadUrl, payload)
        const saved = res && res.data && res.data.saved ? res.data.saved : {}
        // prefer the returned path for preview
        const maybeUrl = saved.logo || saved.banner || (Object.values(saved)[0])
        if (maybeUrl) {
          previewUrl.value = maybeUrl
          emit('uploaded', maybeUrl)
        }
      }catch(e){ console.error('[ImageUploader] upload failed', e); emit('upload-error', e) }
    } else {
      previewUrl.value = dataUrl
    }
  } catch(e){ console.error(e) }
  finally { cancelCrop() }
}
// debug: log when user confirms crop
watch(previewUrl, (v) => { try{ if(v) console.log('[ImageUploader] preview updated (cropped?)', v && v.length && v.substring ? v.substring(0,80) : v) }catch(e){} })
function cancelCrop(){ showCropper.value = false; if (currentObjectUrl){ try{ URL.revokeObjectURL(currentObjectUrl) }catch{} currentObjectUrl = null } }

onBeforeUnmount(()=>{ if (currentObjectUrl){ try{ URL.revokeObjectURL(currentObjectUrl) }catch{} currentObjectUrl = null } })
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
.upload-preview { width:160px; height:160px; margin:0 auto; position:relative; border-radius:6px; overflow:hidden }
.upload-preview-img { width:100%; height:100%; object-fit:cover; display:block }
.image-preview-overlay { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; background: rgba(0,0,0,0.45); color:#fff; font-weight:700; letter-spacing:0.6px; opacity:0; transition: opacity .14s ease, transform .14s ease; transform: translateY(6px) }
.upload-preview:hover .image-preview-overlay, .upload-preview:focus .image-preview-overlay { opacity:1; transform: translateY(0) }
</style>
