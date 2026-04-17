/**
 * useBarcodeScanner — Composable global para detectar leitura de código de barras (44 dígitos).
 *
 * Detecta entrada rápida de 44 dígitos via leitor de código de barras usando keydown global.
 * Ignora digitação em campos de texto (INPUT, TEXTAREA, contentEditable).
 *
 * Uso:
 *   const { onScan, start, stop } = useBarcodeScanner()
 *   onScan((barcode) => { console.log('Scanned:', barcode) })
 *   start()
 */
import { ref } from 'vue'

const buffer = ref('')
const listening = ref(false)
const callbacks = ref([])

let lastKeyTime = 0
let resetTimer = null

function handleKeydown(e) {
  // Ignore when typing in form fields
  const tag = e.target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA') return
  if (e.target.isContentEditable) return

  const now = Date.now()

  // Reset buffer if gap between keystrokes exceeds 80ms
  if (lastKeyTime && (now - lastKeyTime) > 80) {
    buffer.value = ''
  }
  lastKeyTime = now

  // Clear any pending reset timer
  if (resetTimer) {
    clearTimeout(resetTimer)
    resetTimer = null
  }

  if (e.key === 'Enter') {
    if (buffer.value.length === 44) {
      const barcode = buffer.value

      // Notify registered callbacks
      callbacks.value.forEach((cb) => cb(barcode))

      // Dispatch custom event for global listeners
      window.dispatchEvent(new CustomEvent('barcode:scanned', { detail: { accessKey: barcode } }))

      // Prevent Enter from triggering other actions when we captured a barcode
      e.preventDefault()
      e.stopPropagation()
    }
    buffer.value = ''
    lastKeyTime = 0
    return
  }

  // Only accumulate digits
  if (/^\d$/.test(e.key)) {
    buffer.value += e.key

    // Auto-reset after 80ms of inactivity
    resetTimer = setTimeout(() => {
      buffer.value = ''
      lastKeyTime = 0
    }, 80)
  }
}

export function useBarcodeScanner() {
  function onScan(callback) {
    if (typeof callback === 'function' && !callbacks.value.includes(callback)) {
      callbacks.value.push(callback)
    }
  }

  function start() {
    if (listening.value) return
    document.addEventListener('keydown', handleKeydown, { capture: true })
    listening.value = true
  }

  function stop() {
    document.removeEventListener('keydown', handleKeydown, { capture: true })
    listening.value = false
    buffer.value = ''
    lastKeyTime = 0
    if (resetTimer) {
      clearTimeout(resetTimer)
      resetTimer = null
    }
  }

  return { onScan, start, stop }
}
