'use strict'
const { autoUpdater } = require('electron-updater')
const config = require('./config')

let intervalHandle = null
let listenersBound = false

function buildFeedUrl() {
  const cfg = config.load()
  if (!cfg || !cfg.backendUrl) return null
  const base = String(cfg.backendUrl).replace(/\/+$/, '')
  return `${base}/downloads/ifood-agent/`
}

function bindListenersOnce() {
  if (listenersBound) return
  autoUpdater.on('error', (err) => console.warn('[updater] error:', err && err.message))
  autoUpdater.on('update-available', (info) => console.log('[updater] update available:', info && info.version))
  autoUpdater.on('update-not-available', () => console.log('[updater] up to date'))
  autoUpdater.on('update-downloaded', () => console.log('[updater] downloaded; will install on quit'))
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  listenersBound = true
}

// `start` is idempotent — safe to call again whenever backendUrl may have changed.
// It re-sets the feed URL (cheap) and triggers an immediate check, then ensures
// the periodic 60-min interval is running exactly once.
function start() {
  const url = buildFeedUrl()
  if (!url) {
    console.warn('[updater] no backendUrl set yet, skipping update check')
    return
  }
  try {
    bindListenersOnce()
    autoUpdater.setFeedURL({ provider: 'generic', url })
    autoUpdater.checkForUpdates().catch((e) => console.warn('[updater] check failed:', e && e.message))
    if (!intervalHandle) {
      intervalHandle = setInterval(() => {
        autoUpdater.checkForUpdates().catch((e) => console.warn('[updater] periodic check failed:', e && e.message))
      }, 60 * 60 * 1000)
    }
  } catch (e) {
    console.warn('[updater] start failed:', e && e.message)
  }
}

module.exports = { start }
