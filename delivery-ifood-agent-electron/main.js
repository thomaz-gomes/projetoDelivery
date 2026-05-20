'use strict'
const { app, BrowserWindow, ipcMain, session } = require('electron')
const path = require('path')
const config = require('./src/config')
const socketClient = require('./src/socketClient')

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
    onChat: (payload) => emitToRenderer('ifood:chat', payload),
  })
}

// ── IPC: config storage ───────────────────────────────────────────────
ipcMain.handle('config:get', () => config.load())
ipcMain.handle('config:save', (_evt, cfg) => {
  const ok = config.save(cfg)
  attemptConnect()
  return ok
})

// ── IPC: socket control ───────────────────────────────────────────────
ipcMain.handle('socket:reconnect', () => {
  attemptConnect()
  return true
})

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

  const indexHtml = app.isPackaged
    ? path.join(__dirname, 'renderer', 'dist', 'index.html')
    : path.join(__dirname, 'renderer', 'index.html')

  mainWindow.loadFile(indexHtml).catch((err) => {
    console.warn('[main] loadFile failed (renderer not built yet?):', err.message)
  })
}

app.whenReady().then(() => {
  createWindow()
  attemptConnect()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  socketClient.disconnect()
  if (process.platform !== 'darwin') app.quit()
})
