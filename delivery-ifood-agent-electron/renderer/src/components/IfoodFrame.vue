<script setup>
import { ref, onMounted, watch } from 'vue'
import { buildSendScript } from '../injectedScript.js'

const props = defineProps({
  reloadKey: { type: Number, default: 0 },
})

const emit = defineEmits(['queue-change'])

const webviewRef = ref(null)
const ready = ref(false)

const queue = []
let processing = false

function pushMessage(payload) {
  queue.push(payload)
  emit('queue-change', queue.length)
  drain()
}

defineExpose({ pushMessage })

async function drain() {
  if (processing) return
  if (!ready.value || !webviewRef.value) return
  processing = true
  try {
    while (queue.length) {
      const payload = queue.shift()
      emit('queue-change', queue.length)
      const code = buildSendScript(payload)
      let result = null
      try {
        // executeJavaScript returns a promise that resolves with the IIFE return value
        result = await webviewRef.value.executeJavaScript(code, true)
      } catch (err) {
        result = { ok: false, error: err && err.message ? err.message : String(err) }
      }
      if (window.agentApi && window.agentApi.reportSendResult) {
        window.agentApi.reportSendResult({
          key: payload._routeKey,
          success: !!(result && result.ok),
          orderNumber: payload.orderNumber,
          kind: payload.kind,
          error: result && result.error,
        })
      }
      // Throttle between messages
      await new Promise((r) => setTimeout(r, 2500))
    }
  } finally {
    processing = false
  }
}

function onDomReady() {
  ready.value = true
  drain()
}

function reload() {
  if (webviewRef.value) {
    try { webviewRef.value.reload() } catch (e) {}
  }
}

function onConsoleMessage(e) {
  // Repassa o console do webview pro DevTools do app (Ctrl+Shift+I) com prefixo
  // pra ficar fácil filtrar. Útil pra diagnosticar quando o chat do iFood não
  // carrega (loading infinito) e queremos ver as mensagens da página.
  const level = e.level === 2 ? 'error' : e.level === 1 ? 'warn' : 'log'
  // eslint-disable-next-line no-console
  console[level](`[ifood-webview]`, e.message)
}

onMounted(() => {
  const wv = webviewRef.value
  if (wv) {
    wv.addEventListener('dom-ready', onDomReady)
    wv.addEventListener('did-fail-load', (e) => {
      ready.value = false
      console.warn('[ifood-webview] did-fail-load:', e.errorCode, e.errorDescription, e.validatedURL)
    })
    wv.addEventListener('did-finish-load', () => { ready.value = true; drain() })
    wv.addEventListener('console-message', onConsoleMessage)
  }
})

watch(() => props.reloadKey, (newVal, oldVal) => {
  if (newVal !== oldVal) reload()
})
</script>

<template>
  <!--
    useragent: o iFood detecta UA "Electron/..." e quebra o WebSocket do chat
    (fica em loading infinito). Passamos um UA de Chrome estável pra parecer
    um Chromium normal. A versão do Chrome aqui deve ficar próxima da versão
    do Chromium embarcado no Electron usado (Electron 28 = Chromium 120).
  -->
  <webview
    ref="webviewRef"
    src="https://gestordepedidos.ifood.com.br/"
    partition="persist:ifood"
    useragent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    allowpopups
    class="ifood-webview"
  />
</template>

<style scoped>
.ifood-webview { flex: 1; width: 100%; height: 100%; border: 0; }
</style>
