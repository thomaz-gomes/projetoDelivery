'use strict'
// Preload do <webview> — roda ANTES de qualquer script da página do iFood.
// Aplica overrides de "stealth" pra evitar que o iFood detecte que estamos
// dentro de um Electron e dispare CAPTCHA / desafio de bot.
//
// Refs: técnicas comuns do puppeteer-extra-plugin-stealth.
// Cada bloco mira UM sinal específico que sites de bot-detection checam.

;(() => {
  try {
    // 1) navigator.webdriver = false
    // Este é o sinal mais comum. Em Chromium "normal" é false; em ambientes
    // automatizados (selenium, puppeteer com --enable-automation) é true.
    // Em Electron por padrão é false, mas sobrescrevemos defensivamente.
    try {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => false,
        configurable: true,
      })
    } catch (e) {}

    // 2) window.chrome — Chrome real tem um objeto rico aqui
    try {
      if (!window.chrome) window.chrome = {}
      if (!window.chrome.runtime) {
        window.chrome.runtime = {
          // Stubs mínimos que sites de detecção costumam ler
          OnInstalledReason: {},
          OnRestartRequiredReason: {},
          PlatformArch: {},
          PlatformNaclArch: {},
          PlatformOs: {},
          RequestUpdateCheckStatus: {},
          connect: () => {},
          sendMessage: () => {},
        }
      }
      if (!window.chrome.loadTimes) window.chrome.loadTimes = function () { return {} }
      if (!window.chrome.csi) window.chrome.csi = function () { return {} }
      if (!window.chrome.app) window.chrome.app = { isInstalled: false, InstallState: {}, RunningState: {} }
    } catch (e) {}

    // 3) navigator.plugins — em Electron embarcado costuma vir vazio (array de 0).
    //    Chrome real tem PDF Plugin, etc. Devolvemos um array com length > 0.
    try {
      const fakePlugins = [
        { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format', length: 1 },
        { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '', length: 1 },
        { name: 'Native Client', filename: 'internal-nacl-plugin', description: '', length: 2 },
      ]
      Object.defineProperty(navigator, 'plugins', {
        get: () => fakePlugins,
        configurable: true,
      })
      Object.defineProperty(navigator, 'mimeTypes', {
        get: () => [{ type: 'application/pdf', suffixes: 'pdf', description: '' }],
        configurable: true,
      })
    } catch (e) {}

    // 4) navigator.languages — alguns sites comparam com Accept-Language.
    //    Forçamos pt-BR como primary.
    try {
      Object.defineProperty(navigator, 'languages', {
        get: () => ['pt-BR', 'pt', 'en-US', 'en'],
        configurable: true,
      })
    } catch (e) {}

    // 5) Permissions API quirk — em ambientes automatizados, query('notifications')
    //    às vezes retorna 'denied' enquanto Notification.permission é 'default',
    //    o que é um sinal. Alinhamos os dois.
    try {
      const origQuery = navigator.permissions && navigator.permissions.query
      if (origQuery) {
        navigator.permissions.query = (params) => {
          if (params && params.name === 'notifications') {
            return Promise.resolve({ state: Notification.permission, onchange: null })
          }
          return origQuery.call(navigator.permissions, params)
        }
      }
    } catch (e) {}

    // 6) WebGL vendor/renderer — Chrome real expõe a GPU. Em alguns Electrons
    //    o renderer vem como "Google SwiftShader". Substituímos por algo plausível.
    try {
      const getParameter = WebGLRenderingContext.prototype.getParameter
      WebGLRenderingContext.prototype.getParameter = function (param) {
        // UNMASKED_VENDOR_WEBGL
        if (param === 37445) return 'Intel Inc.'
        // UNMASKED_RENDERER_WEBGL
        if (param === 37446) return 'Intel Iris OpenGL Engine'
        return getParameter.call(this, param)
      }
    } catch (e) {}

    // 7) Remove o sinal de iframe-from-webdriver (se algum site checa)
    try {
      Object.defineProperty(navigator, 'maxTouchPoints', {
        get: () => 0,
        configurable: true,
      })
    } catch (e) {}

    // Log discreto pra confirmar via DevTools que rodou
    // eslint-disable-next-line no-console
    console.log('[webview-preload] stealth aplicado')
  } catch (e) {
    // Nunca quebrar a página
    // eslint-disable-next-line no-console
    console.warn('[webview-preload] falha ao aplicar stealth:', e && e.message)
  }
})()
