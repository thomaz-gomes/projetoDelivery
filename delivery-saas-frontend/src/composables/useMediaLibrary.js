import { ref } from 'vue'

const isOpen = ref(false)
const activeFieldId = ref(null)
const activeTab = ref('library')
const callbacks = new Map()
const currentUrl = ref(null)
const cropAspect = ref(1)
const cropTargetWidth = ref(600)
const cropTargetHeight = ref(600)

export function useMediaLibrary() {
  function openFor(fieldId, onSelect, options = {}) {
    activeFieldId.value = fieldId
    callbacks.set(fieldId, onSelect)
    currentUrl.value = options.currentUrl || null
    cropAspect.value = options.cropAspect ?? 1
    cropTargetWidth.value = options.targetWidth ?? 600
    cropTargetHeight.value = options.targetHeight ?? 600
    activeTab.value = 'library'
    isOpen.value = true
  }

  function select(url) {
    const cb = callbacks.get(activeFieldId.value)
    if (cb) cb(url)
    close()
  }

  function close() {
    isOpen.value = false
    activeFieldId.value = null
  }

  return { isOpen, activeFieldId, activeTab, currentUrl, cropAspect, cropTargetWidth, cropTargetHeight, openFor, select, close }
}
