'use strict'
const { app, BrowserWindow, ipcMain, session } = require('electron')
const path = require('path')

let mainWindow = null

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
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
