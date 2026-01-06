<template>
  <div class="container mt-3">
    <div class="alert alert-info">A página "/settings/company" foi removida. Use as outras opções em Configurações.</div>
  </div>
</template>

<script setup>
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
const router = useRouter()
onMounted(() => {
  try { router.replace('/settings/neighborhoods') } catch (e) {}
})
</script>

<style scoped></style>
        // store base64 (data:*;base64,...) and filename
        form.value.certBase64 = String(r)
        form.value.certFilename = f.name
        // mark as new upload (not yet persisted)
        form.value.certExists = false
      }
      try { e.target.value = '' } catch (e) {}
    }

    function removeCert() {
      // clear client-side selection and mark for removal on save
      form.value.certBase64 = null
      form.value.certFilename = null
      form.value.certPassword = ''
      form.value.certExists = false
      certRemoveRequested.value = true
      // notify user to save to persist change
      message.value = 'Certificado removido localmente. Clique em Salvar para persistir a remoção.'
      messageClass.value = 'alert-warning'
    }

    function onImageLoaded(e) {
      const img = cropperImage.value
      if (!img) return
      const imgRect = img.getBoundingClientRect()
      const containerRect = cropContainer.value ? cropContainer.value.getBoundingClientRect() : imgRect
      imgDisplay.w = imgRect.width
      imgDisplay.h = imgRect.height
      imgDisplay.leftInContainer = imgRect.left - containerRect.left
      imgDisplay.topInContainer = imgRect.top - containerRect.top
      imgDisplay.naturalW = img.naturalWidth || img.width
      imgDisplay.naturalH = img.naturalHeight || img.height
      cropPos.value = { x: 0, y: 0 }
    }

    const imgDisplay = { w: 0, h: 0, leftInContainer: 0, topInContainer: 0, naturalW: 0, naturalH: 0 }

    const cropBoxStyle = computed(() => {
      const dw = imgDisplay.w || 0
      const dh = imgDisplay.h || 0
      const aspect = pendingField.value === 'banner' ? (1200 / 400) : 1
      // compute displayed crop height respecting aspect ratio
      const base = Math.min(dh, dw / aspect)
      const hDisplay = base * (cropSizePct.value / 100)
      const wDisplay = hDisplay * aspect
      const offsetX = imgDisplay.leftInContainer || 0
      const offsetY = imgDisplay.topInContainer || 0
      const left = offsetX + (dw - wDisplay) / 2 + (cropPos.value.x || 0)
      const top = offsetY + (dh - hDisplay) / 2 + (cropPos.value.y || 0)
      return { left: `${left}px`, top: `${top}px`, width: `${wDisplay}px`, height: `${hDisplay}px` }
    })

    function startDrag(e) {
      dragging = true
      dragStart = { x: e.clientX, y: e.clientY, startPos: { ...cropPos.value } }
      window.addEventListener('pointermove', onPointerMove)
      window.addEventListener('pointerup', endDrag)
    }

    function onPointerMove(e) {
      if (!dragging || !dragStart) return
      const dx = e.clientX - dragStart.x
      const dy = e.clientY - dragStart.y
      const dw = imgDisplay.w || 0
      const dh = imgDisplay.h || 0
      const aspect = pendingField.value === 'banner' ? (1200 / 400) : 1
      const base = Math.min(dh, dw / aspect)
      const hDisplay = base * (cropSizePct.value / 100)
      const wDisplay = hDisplay * aspect
      const limitX = Math.max(0, (dw - wDisplay) / 2)
      const limitY = Math.max(0, (dh - hDisplay) / 2)
      let nx = dragStart.startPos.x + dx
      let ny = dragStart.startPos.y + dy
      nx = Math.max(-limitX, Math.min(limitX, nx))
      ny = Math.max(-limitY, Math.min(limitY, ny))
      cropPos.value = { x: nx, y: ny }
    }

    function endDrag() {
      dragging = false
      dragStart = null
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', endDrag)
    }

    function onSizeChange() {
      const dw = imgDisplay.w || 0
      const dh = imgDisplay.h || 0
      const aspect = pendingField.value === 'banner' ? (1200 / 400) : 1
      const base = Math.min(dh, dw / aspect)
      const hDisplay = base * (cropSizePct.value / 100)
      const wDisplay = hDisplay * aspect
      const limitX = Math.max(0, (dw - wDisplay) / 2)
      const limitY = Math.max(0, (dh - hDisplay) / 2)
      cropPos.value.x = Math.max(-limitX, Math.min(limitX, cropPos.value.x || 0))
      cropPos.value.y = Math.max(-limitY, Math.min(limitY, cropPos.value.y || 0))
    }

    async function applyCrop() {
      try {
        const img = cropperImage.value
        if (!img) return null
  const { w: dw, h: dh, leftInContainer: dl, topInContainer: dt, naturalW, naturalH } = imgDisplay
  const aspect = pendingField.value === 'banner' ? (1200 / 400) : 1
  // compute displayed crop size
  const base = Math.min(dh, dw / aspect)
  const hDisplay = base * (cropSizePct.value / 100)
  const wDisplay = hDisplay * aspect
  const cx = (dl || 0) + (dw - wDisplay) / 2 + (cropPos.value.x || 0)
  const cy = (dt || 0) + (dh - hDisplay) / 2 + (cropPos.value.y || 0)
  const sx = Math.max(0, Math.round((cx - (dl || 0)) * (naturalW / dw)))
  const sy = Math.max(0, Math.round((cy - (dt || 0)) * (naturalH / dh)))
  const sWidth = Math.max(1, Math.round(wDisplay * (naturalW / dw)))
  const sHeight = Math.max(1, Math.round(hDisplay * (naturalH / dh)))
  const canvas = document.createElement('canvas')
  // target size depends on field
  const targetW = pendingField.value === 'logo' ? 450 : 1200
  const targetH = pendingField.value === 'logo' ? 450 : 400
  canvas.width = targetW; canvas.height = targetH
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#fff'; ctx.fillRect(0,0,targetW,targetH)
  ctx.drawImage(img, sx, sy, sWidth, sHeight, 0, 0, targetW, targetH)
  const dataUrl = canvas.toDataURL('image/jpeg', 0.9)
  return dataUrl
      } catch (e) { console.error('Failed to crop', e); return null }
    }

    async function confirmCrop() {
      try {
        isUploading.value = true
        const dataUrl = await applyCrop()
        if (dataUrl) {
          if (pendingField.value === 'banner') {
            form.value.bannerBase64 = dataUrl
            form.value.bannerUrl = dataUrl
          } else if (pendingField.value === 'logo') {
            form.value.logoBase64 = dataUrl
            form.value.logoUrl = dataUrl
          }
        }
      } catch (e) { console.error(e); message.value = 'Falha ao processar imagem' }
      finally {
        isUploading.value = false
        closeCropper()
      }
    }

    function cancelCrop() { closeCropper() }

    function closeCropper() {
      showCropper.value = false
      pendingField.value = null
      if (currentObjectUrl.value) { try { URL.revokeObjectURL(currentObjectUrl.value) } catch (e) {} currentObjectUrl.value = null }
    }

    function setActiveTab(tabKey) {
      activeTab.value = tabKey
      try { localStorage.setItem('companySettingsActiveTab', tabKey) } catch (e) {}
    }

  onBeforeUnmount(()=>{ if (currentObjectUrl.value){ try{ URL.revokeObjectURL(currentObjectUrl.value) }catch(e){} currentObjectUrl.value = null } })

    return { loading, saving, form, message, messageClass, save, reload, weekDays, invalidDays, invalidMessages,
      showCropper, cropperImage, cropContainer, cropBox, cropBoxStyle, onImageLoaded, startDrag, cropSizePct, onSizeChange, cancelCrop, confirmCrop, currentObjectUrl, removeCert,
      setActiveTab, activeTab, handlePhoneInput, handleWhatsAppInput
    }
  }
}
</script>

<style scoped>
.form-text code{background:#f1f1f1;padding:2px 6px;border-radius:4px}
.cropper-modal { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display:flex; align-items:center; justify-content:center; z-index:2000 }
.cropper-modal-content { background: #fff; border-radius:8px; max-width:92vw; width:720px; max-height:92vh; overflow:auto }
.cropper-canvas-wrapper { width:100%; height: auto; display:flex; align-items:center; justify-content:center }
.crop-image-container { position: relative; width:100%; max-height:64vh; display:flex; align-items:center; justify-content:center; overflow:hidden; background:#f5f5f5 }
.crop-image { max-width:100%; max-height:64vh; user-select:none; -webkit-user-drag:none }
.crop-box { position:absolute; border:2px dashed #fff; box-shadow: 0 6px 18px rgba(0,0,0,0.2); background: rgba(255,255,255,0.02); touch-action: none }
.crop-actions { display:flex; gap:8px }
.cropper-actions .btn { min-width:100px }
</style>
