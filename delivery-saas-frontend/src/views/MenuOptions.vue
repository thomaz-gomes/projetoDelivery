<template>
  <div class="container py-4">
    <h2>Opções e Complementos</h2>
    <p class="text-muted">Gerencie grupos de complementos (option groups) e as opções disponíveis.</p>

    <div class="row">
      <div class="col-12 mb-3 d-flex justify-content-between align-items-center">
        <h5 class="m-0">Grupos de opções</h5>
        <div>
          <button class="btn btn-outline-secondary me-2" @click="goNewGroup">Adicionar grupo</button>
        </div>
      </div>

      <div class="col-12">
        <div v-if="loading" class="text-center py-3">Carregando...</div>
        <div v-else>
          <div class="category-box" v-for="g in groups" :key="g.id">
            <div :id="'grp-header-'+g.id" class="category-header d-flex align-items-center justify-content-between">
              <div class="d-flex align-items-center">
                <button class="btn btn-sm btn-light me-3 category-toggle" @click.stop="toggleGroup(g.id)" :aria-expanded="!collapsed[g.id]" :aria-controls="'grp-body-'+g.id">
                  <i class="bi bi-chevron-down chevron-icon" :class="{ 'rotated': collapsed[g.id] }"></i>
                </button>
                <div>
                  <div class="category-title">{{ g.name }}</div>
                  <div class="small text-muted">{{ (g.options || []).length }} opção(s)</div>
                </div>
              </div>
              <div class="category-actions">
                <button class="btn btn-sm btn-outline-primary" @click.stop="editGroup(g)"><i class="bi bi-pencil me-1"></i>Editar</button>
                <button class="btn btn-sm btn-primary" @click.stop="newOptionForGroup(g)"><i class="bi bi-plus-circle me-1"></i>Novo</button>
                <button class="btn btn-sm btn-outline-secondary" @click.stop="duplicateGroup(g)"><i class="bi bi-files me-1"></i>Duplicar</button>
                <button class="btn btn-sm btn-danger" @click.stop="removeGroup(g)"><i class="bi bi-trash me-1"></i>Remover</button>
              </div>
            </div>

            <transition name="collapse">
              <div class="category-body" v-if="!collapsed[g.id]" :id="'grp-body-'+g.id">
                <ul class="list-group mb-3">
                  <li v-for="opt in g.options" :key="opt.id" class="list-group-item p-0">
                    <div :class="['product-card mb-2 d-flex align-items-start', { inactive: opt.isAvailable === false }]">
                      <div class="option-switch me-3 d-flex align-items-start">
                        <div class="form-check form-switch">
                          <input
                            class="form-check-input"
                            type="checkbox"
                            :id="'opt-active-'+opt.id"
                            v-model="opt.isAvailable"
                            :aria-checked="opt.isAvailable"
                            :disabled="togglingIds.includes(opt.id)"
                            @change.stop="toggleOptionActive(opt)"
                          />
                        </div>
                      </div>

                      <div class="product-thumb me-3">
                        <img v-if="opt.image" :src="assetUrl(opt.image)" class="admin-product-image" loading="lazy" />
                        <div v-else class="bg-light admin-product-image-placeholder d-flex align-items-center justify-content-center" role="button" tabindex="0" @click.stop="fileInputClick(opt)" @keydown.enter.stop.prevent="fileInputClick(opt)" aria-label="Adicionar imagem para opção">
                          <i class="bi bi-camera" style="font-size:20px;color:#6c6c6c"></i>
                        </div>
                      </div>

                      <div class="product-card-body">
                        <h6 class="mb-1 product-title">{{ opt.name }}</h6>
                        <div class="small text-muted product-desc">{{ opt.description || '' }}</div>
                        <div class="small text-muted mt-1">
                          <span v-if="opt.availableDays && opt.availableDays.length">Dias: {{ opt.availableDays.map(d=>daysOfWeek[d]).join(', ') }}</span>
                          <span v-if="opt.availableFrom || opt.availableTo"> {{ opt.availableFrom || '--' }} até {{ opt.availableTo || '--' }}</span>
                        </div>
                      </div>

                      <div class="product-card-media d-flex align-items-center">
                        <div class="me-3 d-flex flex-column align-items-end">
                          <div class="price-pill">{{ Number(opt.price) > 0 ? formatCurrency(opt.price) : 'Grátis' }}</div>
                        </div>
                        <div class="product-actions d-flex align-items-center" style="gap:8px">
                          <button class="btn btn-sm btn-outline-primary" @click.stop="editOption(opt)"><i class="bi bi-pencil me-1"></i>Editar</button>
                          <button class="btn btn-sm btn-danger" @click.stop="removeOption(opt)"><i class="bi bi-trash me-1"></i>Remover</button>
                        </div>
                      </div>
                    </div>
                  </li>
                </ul>
              </div>
            </transition>
          </div>
        </div>
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
          <button type="button" class="btn btn-primary" @click="confirmCrop" :disabled="isUploading">{{ isUploading ? 'Enviando...' : 'Usar imagem' }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, reactive, nextTick, onBeforeUnmount, computed } from 'vue'
import api from '../api'
import { bindLoading } from '../state/globalLoading.js'
import Swal from 'sweetalert2'
import { useRouter } from 'vue-router'
import { assetUrl } from '../utils/assetUrl.js'

const groups = ref([])
const productsList = ref([])
const loading = ref(false)
bindLoading(loading)

const collapsed = reactive({})
const togglingIds = ref([])
const optionError = ref('')
const optionSuccess = ref('')
const router = useRouter()
const daysOfWeek = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb']

// image / crop state (inline for list upload)
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
const currentOpt = ref(null)

// legacy reset helpers removed (forms are handled on separate pages)

async function load(){
  loading.value = true
  try{
    const res = await api.get('/menu/options')
    groups.value = res.data || []
    // load products to allow linking options to products
    try{
      const pr = await api.get('/menu/products')
      productsList.value = pr.data || []
    }catch(e){ productsList.value = [] }
  }catch(e){ console.error('Error loading option groups', e) }
  finally{ loading.value = false }
}

function selectGroup(g){
  // keep for compatibility (not used in new layout)
}

function goNewGroup(){ router.push({ path: '/menu/options/groups/new' }) }
function editGroup(g){ if(!g || !g.id) return; router.push({ path: `/menu/options/groups/${g.id}` }) }
function newOptionForGroup(g){ const q = g && g.id ? { groupId: g.id } : {}; router.push({ path: '/menu/options/new', query: q }) }
function editOption(opt){ if(!opt || !opt.id) return; router.push({ path: `/menu/options/${opt.id}` }) }

async function removeGroup(g){
  const r = await Swal.fire({ title: 'Remover grupo?', text: `Remover "${g.name}"? Esta ação removerá todas as opções vinculadas.`, icon: 'warning', showCancelButton: true, confirmButtonText: 'Sim, remover', cancelButtonText: 'Cancelar' })
  if(!r.isConfirmed) return
  try{
    await api.delete(`/menu/options/${g.id}`)
    await load()
    Swal.fire({ icon: 'success', text: 'Grupo removido' })
  }catch(e){
    console.error('removeGroup failed', e)
    // prefer backend-provided message when available
    const msg = (e && e.response && (e.response.data && (e.response.data.message || e.response.data.error))) || e.message || 'Falha ao remover grupo'
    Swal.fire({ icon: 'error', text: String(msg) })
  }
}

async function removeOption(opt){
  const r = await Swal.fire({ title: 'Remover opção?', text: `Remover "${opt.name}"?`, icon:'warning', showCancelButton:true, confirmButtonText:'Sim', cancelButtonText:'Cancelar' })
  if(!r.isConfirmed) return
  try{
    await api.delete(`/menu/options/options/${opt.id}`)
    await load()
    Swal.fire({ icon: 'success', text: 'Opção removida' })
  }catch(e){ console.error(e); Swal.fire({ icon: 'error', text: 'Falha ao remover opção' }) }
}

// inline edit/remove helpers removed — navigation + single removeOption kept above

onMounted(()=> load())

async function toggleOptionActive(opt){
  if(!opt || !opt.id) return
  const prev = opt.isAvailable === undefined ? false : opt.isAvailable
  const newVal = opt.isAvailable
  togglingIds.value.push(opt.id)
  try{
    await api.patch(`/menu/options/options/${opt.id}`, { isAvailable: newVal })
    Swal.fire({ toast: true, position: 'top-end', showConfirmButton: false, timer: 1200, icon: 'success', title: newVal ? 'Opção ativada' : 'Opção desativada' })
  }catch(e){
    console.error('Failed to toggle option availability', e)
    // revert ui
    opt.isAvailable = !newVal
    await Swal.fire({ icon: 'error', text: 'Falha ao atualizar status da opção' })
  }finally{
    togglingIds.value = togglingIds.value.filter(id => id !== opt.id)
  }
}

function toggleGroup(id){
  if(!id) return
  collapsed[id] = !collapsed[id]
  try{ localStorage.setItem('menu_options_collapsed', JSON.stringify(collapsed)) }catch(e){}
}

async function duplicateGroup(g){
  if(!g) return
  const res = await Swal.fire({ title: 'Duplicar grupo?', text: `Criar uma cópia de "${g.name}" juntamente com suas opções?`, icon: 'question', showCancelButton:true, confirmButtonText:'Sim, duplicar' })
  if(!res.isConfirmed) return
  try{
    Swal.fire({ title: 'Duplicando...', html: 'Por favor aguarde', allowOutsideClick: false, didOpen: () => { Swal.showLoading() } })
    const payload = { name: `${g.name} (copy)`, min: g.min || 0, max: g.max || null, position: (g.position || 0) + 1 }
    const grpRes = await api.post('/menu/options', payload)
    const newGrp = grpRes.data
    // copy options
    for(const opt of (g.options||[])){
      try{
        const p = { name: opt.name, price: opt.price || 0, position: (opt.position||0)+1, isAvailable: opt.isAvailable }
        await api.post(`/menu/options/${newGrp.id}/options`, p)
      }catch(e){ console.warn('failed to copy option', e) }
    }
    await load()
    Swal.fire({ icon: 'success', text: 'Grupo duplicado' })
  }catch(e){ Swal.close(); console.error(e); Swal.fire({ icon: 'error', text: 'Falha ao duplicar grupo' }) }
}

function formatCurrency(v){
  try{ return new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(v)); }catch(e){ return v }
}

// --- Image crop/upload handlers (adapted from OptionForm.vue)
function processFile(file){
  if(!file) return
  const objectUrl = URL.createObjectURL(file)
  currentObjectUrl = objectUrl
  showCropper.value = true
  nextTick(() => { cropSizePct.value = 80; cropPos.value = { x:0, y:0 } })
}

function onFileChange(e){ const f = e.target.files && e.target.files[0]; if(!f) return; processFile(f) }
function fileInputClick(opt){ currentOpt.value = opt || null; if(fileInput.value) fileInput.value.click() }

function onImageLoaded(e){ const img = cropperImage.value; if(!img) return; const imgRect = img.getBoundingClientRect(); const containerRect = cropContainer.value ? cropContainer.value.getBoundingClientRect() : imgRect; imgDisplay.w = imgRect.width; imgDisplay.h = imgRect.height; imgDisplay.leftInContainer = imgRect.left - containerRect.left; imgDisplay.topInContainer = imgRect.top - containerRect.top; imgDisplay.naturalW = img.naturalWidth || img.width; imgDisplay.naturalH = img.naturalHeight || img.height; cropPos.value = { x:0, y:0 } }

const cropBoxStyle = computed(() => {
  const dw = imgDisplay.w || 0; const dh = imgDisplay.h || 0; const side = Math.min(dw, dh) * (cropSizePct.value / 100); const offsetX = imgDisplay.leftInContainer || 0; const offsetY = imgDisplay.topInContainer || 0; const left = offsetX + (dw - side) / 2 + (cropPos.value.x || 0); const top = offsetY + (dh - side) / 2 + (cropPos.value.y || 0); return { left: `${left}px`, top: `${top}px`, width: `${side}px`, height: `${side}px` }
})

function startDrag(e){ const p = e; dragging = true; dragStart = { x: p.clientX, y: p.clientY, startPos: { ...cropPos.value } }; window.addEventListener('pointermove', onPointerMove); window.addEventListener('pointerup', endDrag) }
function onPointerMove(e){ if(!dragging || !dragStart) return; const dx = e.clientX - dragStart.x; const dy = e.clientY - dragStart.y; const dw = imgDisplay.w || 0; const dh = imgDisplay.h || 0; const side = Math.min(dw, dh) * (cropSizePct.value / 100); const limitX = Math.max(0, (dw - side) / 2); const limitY = Math.max(0, (dh - side) / 2); let nx = dragStart.startPos.x + dx; let ny = dragStart.startPos.y + dy; nx = Math.max(-limitX, Math.min(limitX, nx)); ny = Math.max(-limitY, Math.min(limitY, ny)); cropPos.value = { x: nx, y: ny } }
function endDrag(){ dragging = false; dragStart = null; window.removeEventListener('pointermove', onPointerMove); window.removeEventListener('pointerup', endDrag) }

function onSizeChange(){ const dw = imgDisplay.w || 0; const dh = imgDisplay.h || 0; const side = Math.min(dw, dh) * (cropSizePct.value / 100); const limitX = Math.max(0, (dw - side) / 2); const limitY = Math.max(0, (dh - side) / 2); cropPos.value.x = Math.max(-limitX, Math.min(limitX, cropPos.value.x || 0)); cropPos.value.y = Math.max(-limitY, Math.min(limitY, cropPos.value.y || 0)) }

async function applyCrop(){ try{ const img = cropperImage.value; if(!img) return null; const { w: dw, h: dh, leftInContainer: dl, topInContainer: dt, naturalW, naturalH } = imgDisplay; const sideDisplay = Math.min(dw, dh) * (cropSizePct.value / 100); const cx = (dl || 0) + (dw - sideDisplay) / 2 + (cropPos.value.x || 0); const cy = (dt || 0) + (dh - sideDisplay) / 2 + (cropPos.value.y || 0); const sx = Math.max(0, Math.round((cx - (dl || 0)) * (naturalW / dw))); const sy = Math.max(0, Math.round((cy - (dt || 0)) * (naturalH / dh))); const sSide = Math.max(1, Math.round(sideDisplay * (naturalW / dw))); const canvas = document.createElement('canvas'); canvas.width = 600; canvas.height = 600; const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0,0,600,600); ctx.drawImage(img, sx, sy, sSide, sSide, 0, 0, 600, 600); const dataUrl = canvas.toDataURL('image/jpeg', 0.9); return dataUrl }catch(e){ console.error('Failed to crop', e); return null } }

async function confirmCrop(){ try{ isUploading.value = true; const dataUrl = await applyCrop(); if(dataUrl && currentOpt.value){ try{ const res = await api.post(`/menu/options/options/${currentOpt.value.id}/image`, { imageBase64: dataUrl, filename: 'option-image.jpg' }); // update UI — prefer server URL if returned
          if(res && res.data && res.data.image) currentOpt.value.image = res.data.image
          else currentOpt.value.image = dataUrl
        }catch(e){ console.warn('upload failed', e); // fallback to setting preview locally
          currentOpt.value.image = dataUrl
        } }
    }catch(e){ console.error(e); optionError.value = 'Falha ao processar imagem' } finally{ isUploading.value = false; closeCropper() } }

function cancelCrop(){ closeCropper() }
function closeCropper(){ showCropper.value = false; currentOpt.value = null; if(currentObjectUrl){ try{ URL.revokeObjectURL(currentObjectUrl) }catch(e){} currentObjectUrl = null } if(fileInput.value){ fileInput.value.value = '' } }

onBeforeUnmount(()=>{ if(currentObjectUrl){ try{ URL.revokeObjectURL(currentObjectUrl) }catch(e){} currentObjectUrl = null } })
</script>

<style scoped>
/* reuse admin shared styles for upload/crop visuals */
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
