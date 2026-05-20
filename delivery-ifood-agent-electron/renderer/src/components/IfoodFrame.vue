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

onMounted(() => {
  const wv = webviewRef.value
  if (wv) {
    wv.addEventListener('dom-ready', onDomReady)
    wv.addEventListener('did-fail-load', () => { ready.value = false })
    wv.addEventListener('did-finish-load', () => { ready.value = true; drain() })
  }
})

watch(() => props.reloadKey, (newVal, oldVal) => {
  if (newVal !== oldVal) reload()
})
</script>

<template>
  <webview
    ref="webviewRef"
    src="https://gestordepedidos.ifood.com.br/"
    partition="persist:ifood"
    allowpopups
    class="ifood-webview"
  />
</template>

<style scoped>
.ifood-webview { flex: 1; width: 100%; height: 100%; border: 0; }
</style>
