/**
 * useAiStudio — Composable global para gerenciar o estado do AI Studio Modal.
 *
 * Uso:
 *   const { openStudio } = useAiStudio()
 *   openStudio(mediaItem, (newMediaItem) => { ... })
 */
import { ref } from 'vue'

const isOpen = ref(false)
const mediaItem = ref(null)
const onEnhancedCallback = ref(null)

export function useAiStudio() {
  /**
   * Abre o AI Studio para aprimorar um item de mídia.
   * @param {object} item         - Objeto Media da biblioteca ({ id, url, filename, ... })
   * @param {function} [onDone]   - Callback chamado com o novo Media item após salvar
   */
  function openStudio(item, onDone = null) {
    mediaItem.value = item
    onEnhancedCallback.value = onDone
    isOpen.value = true
  }

  function closeStudio() {
    isOpen.value = false
    mediaItem.value = null
    onEnhancedCallback.value = null
  }

  function notifyEnhanced(newItem) {
    if (onEnhancedCallback.value) {
      onEnhancedCallback.value(newItem)
    }
    closeStudio()
  }

  return { isOpen, mediaItem, openStudio, closeStudio, notifyEnhanced }
}
