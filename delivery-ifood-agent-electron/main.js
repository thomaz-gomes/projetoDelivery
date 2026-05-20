'use strict'
const { app, BrowserWindow, ipcMain, session } = require('electron')
const path = require('path')
const config = require('./src/config')
const socketClient = require('./src/socketClient')
const router = require('./src/ifoodRouter')
const { dedupKey } = require('./src/ttlDedupe')
const updater = require('./src/updater')

let mainWindow = null

function emitToRenderer(channel, payload) {
  if (mainWindow && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send(channel, payload)
  }
}

function attemptConnect() {
  const cfg = config.load()
  if (!cfg) {
    emitToRenderer('socket:status', { status: 'disconnected', reason: 'no-config' })
    return
  }
  socketClient.connect(cfg, {
    onStatus: (payload) => emitToRenderer('socket:status', payload),
    onChat: (payload) => {
      router.handleIncomingChat(payload, {
        forwardToRenderer: (p) => {
          const key = dedupKey(p)
          emitToRenderer('chat:message', { ...p, _routeKey: key })
        },
      })
    },
  })
}

// ── IPC: config storage ───────────────────────────────────────────────
ipcMain.handle('config:get', () => config.load())
ipcMain.handle('config:save', (_evt, cfg) => {
  const ok = config.save(cfg)
  attemptConnect()
  if (app.isPackaged) {
    // backendUrl may have changed → re-point updater feed and check again.
    // updater.start() is idempotent and safe to call repeatedly.
    updater.start()
  }
  return ok
})

// ── IPC: socket control ───────────────────────────────────────────────
ipcMain.handle('socket:reconnect', () => {
  attemptConnect()
  return true
})

// ── IPC: chat result + failures ───────────────────────────────────────
ipcMain.handle('chat:result', (_evt, result) => router.handleSendResult(result))
ipcMain.handle('failures:list', () => router.getFailures())
ipcMain.handle('failures:clear', () => router.clearFailures())

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true, // necessário para usar <webview>
    },
  })

  // Em dev: se a env VITE_DEV_SERVER_URL existir, carrega do Vite (HMR).
  // Caso contrário, sempre carrega o build estático em renderer/dist (vale para dev e produção).
  const devUrl = process.env.VITE_DEV_SERVER_URL
  if (devUrl) {
    mainWindow.loadURL(devUrl).catch((err) => {
      console.warn('[main] loadURL failed:', err.message)
    })
  } else {
    const indexHtml = path.join(__dirname, 'renderer', 'dist', 'index.html')
    mainWindow.loadFile(indexHtml).catch((err) => {
      console.warn('[main] loadFile failed (rode `cd renderer && npm run build` primeiro):', err.message)
    })
  }
}

app.whenReady().then(() => {
  createWindow()
  attemptConnect()
  // Only run the auto-updater in packaged builds — in `npm start` dev mode,
  // the build-time placeholder URL would noisy-error.
  if (app.isPackaged) {
    updater.start()
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  socketClient.disconnect()
  if (process.platform !== 'darwin') app.quit()
})
