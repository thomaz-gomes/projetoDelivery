import { ref } from 'vue'

const isOpen = ref(false)
const activeFieldId = ref(null)
const activeTab = ref('upload')
const callbacks = new Map()

export function useMediaLibrary() {
  function openFor(fieldId, onSelect) {
    activeFieldId.value = fieldId
    callbacks.set(fieldId, onSelect)
    activeTab.value = 'upload'
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

  return { isOpen, activeFieldId, activeTab, openFor, select, close }
}
