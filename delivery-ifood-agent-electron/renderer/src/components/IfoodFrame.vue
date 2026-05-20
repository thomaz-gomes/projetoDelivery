<script setup>
import { ref, onMounted, watch } from 'vue'
import { buildSendScript } from '../injectedScript.js'

const props = defineProps({
  reloadKey: { type: Number, default: 0 },
})

const emit = defineEmits(['queue-change'])

const webviewRef = ref(null)
const ready = ref(false)
const webviewPreloadUrl = ref('')

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

// Watcher injetado na página do iFood pra detectar o modal "Ação necessária"
// que aparece quando a sessão do chat expira. Tenta clicar em "Reiniciar
// sistema" automaticamente; se o botão não funcionar, loga um sentinel que
// o host captura via console-message e dá reload no webview inteiro.
//
// Self-contained — sem imports nem chrome.* APIs. Roda em escopo da página.
const REINIT_WATCHER_SCRIPT = `
(() => {
  if (window.__ifoodAgentReinitWatcher) return
  window.__ifoodAgentReinitWatcher = true

  let lastClickAt = 0
  function maybeAct() {
    const now = Date.now()
    // throttle: no máx. 1 ação a cada 15s pra evitar loop
    if (now - lastClickAt < 15000) return

    const bodyText = document.body && document.body.innerText || ''
    if (!/Ação necessária/i.test(bodyText)) return
    if (!/Reiniciar sistema/i.test(bodyText)) return

    // Procura o botão "Reiniciar sistema" — varre <button> e <a> visíveis
    const candidates = Array.from(document.querySelectorAll('button, a, [role="button"]'))
    const target = candidates.find((el) => {
      const t = (el.innerText || el.textContent || '').trim()
      return /Reiniciar sistema/i.test(t)
    })

    if (target) {
      lastClickAt = now
      console.log('[ifood-agent-reinit] clicando em "Reiniciar sistema"')
      try { target.click() } catch (e) {
        console.warn('[ifood-agent-reinit] falha ao clicar:', e && e.message)
        console.log('[ifood-agent-needs-reload]')
      }
      return
    }

    // Detectou o texto mas não achou o botão — pede reload via host
    lastClickAt = now
    console.log('[ifood-agent-needs-reload]')
  }

  // Observa mudanças no DOM (o modal entra dinamicamente). Throttle via debounce.
  let debounce = null
  const observer = new MutationObserver(() => {
    if (debounce) return
    debounce = setTimeout(() => { debounce = null; maybeAct() }, 400)
  })
  observer.observe(document.body, { childList: true, subtree: true, characterData: true })

  // Fallback: polling a cada 30s caso o observer não pegue algum caso de borda
  setInterval(maybeAct, 30000)

  // Primeira checagem imediata (caso o modal já esteja na tela ao carregar)
  setTimeout(maybeAct, 1000)
})()
`

let lastAutoReloadAt = 0

function onDomReady() {
  ready.value = true
  drain()
  // (Re-)injeta o watcher após cada dom-ready (navegação interna, reload, etc.)
  if (webviewRef.value) {
    webviewRef.value.executeJavaScript(REINIT_WATCHER_SCRIPT, true).catch((e) => {
      console.warn('[ifood-webview] falha ao injetar reinit watcher:', e && e.message)
    })
  }
}

function reload() {
  if (webviewRef.value) {
    try { webviewRef.value.reload() } catch (e) {}
  }
}

function onConsoleMessage(e) {
  const msg = e.message || ''

  // Sentinel do watcher: detectou "Ação necessária" mas o botão "Reiniciar
  // sistema" não está disponível ou não funcionou. Reloda o webview inteiro,
  // com throttle de 60s pra evitar loop.
  if (msg.includes('[ifood-agent-needs-reload]')) {
    const now = Date.now()
    if (now - lastAutoReloadAt > 60000) {
      lastAutoReloadAt = now
      console.log('[ifood-webview] auto-reload disparado pelo watcher de "Ação necessária"')
      reload()
    }
    return
  }

  // Repassa o console do webview pro DevTools do app (Ctrl+Shift+I) com prefixo
  // pra ficar fácil filtrar.
  const level = e.level === 2 ? 'error' : e.level === 1 ? 'warn' : 'log'
  // eslint-disable-next-line no-console
  console[level](`[ifood-webview]`, msg)
}

onMounted(async () => {
  // Busca o caminho do preload (file://) antes de montar o webview. O <webview>
  // só aparece depois que temos esse caminho — assim o stealth roda antes da
  // página do iFood. Se a API não existir (cenários de dev sem electron),
  // monta sem preload (vai fallback pro UA hack apenas).
  if (window.agentApi && window.agentApi.getWebviewPreloadUrl) {
    try {
      webviewPreloadUrl.value = await window.agentApi.getWebviewPreloadUrl()
    } catch (e) {
      console.warn('[ifood-frame] falha ao obter webview preload URL:', e && e.message)
    }
  }
  // Após o próximo tick, o <webview> está no DOM (graças ao v-if abaixo).
  // O attachListeners observa via watch.
  attachListeners()
})

function attachListeners() {
  const wv = webviewRef.value
  if (!wv) return
  wv.addEventListener('dom-ready', onDomReady)
  wv.addEventListener('did-fail-load', (e) => {
    ready.value = false
    console.warn('[ifood-webview] did-fail-load:', e.errorCode, e.errorDescription, e.validatedURL)
  })
  wv.addEventListener('did-finish-load', () => { ready.value = true; drain() })
  wv.addEventListener('console-message', onConsoleMessage)
}

// Quando o <webview> aparece (depois que temos preloadUrl), re-anexa listeners.
watch(() => webviewRef.value, (wv) => {
  if (wv) attachListeners()
})

watch(() => props.reloadKey, (newVal, oldVal) => {
  if (newVal !== oldVal) reload()
})
</script>

<template>
  <!--
    useragent: o iFood detecta UA "Electron/..." e quebra o WebSocket do chat.
    Passamos UA de Chrome estável (E28 = Chromium 120).

    preload: webview-preload.js aplica stealth (navigator.webdriver=false,
    window.chrome.runtime, fake plugins) ANTES da página do iFood carregar,
    pra não disparar CAPTCHA / desafio de bot.

    v-if espera o preload URL chegar via IPC antes de criar o <webview>.
  -->
  <webview
    v-if="webviewPreloadUrl"
    ref="webviewRef"
    src="https://gestordepedidos.ifood.com.br/"
    partition="persist:ifood"
    :preload="webviewPreloadUrl"
    useragent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    allowpopups
    class="ifood-webview"
  />
  <div v-else class="loading-shell">Inicializando…</div>
</template>

<style scoped>
.ifood-webview { flex: 1; width: 100%; height: 100%; border: 0; }
.loading-shell {
  flex: 1; display: flex; align-items: center; justify-content: center;
  color: var(--fg); opacity: 0.7;
}
</style>
