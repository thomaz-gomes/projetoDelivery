const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('agentApi', {
  // Renderer → Main
  saveConfig: (cfg) => ipcRenderer.invoke('config:save', cfg),
  getConfig: () => ipcRenderer.invoke('config:get'),
  reconnect: (cfg) => ipcRenderer.invoke('socket:reconnect', cfg),
  reportSendResult: (result) => ipcRenderer.invoke('chat:result', result),
  getFailures: () => ipcRenderer.invoke('failures:list'),
  clearFailures: () => ipcRenderer.invoke('failures:clear'),

  // Main → Renderer (subscribe)
  onChatMessage: (cb) => {
    const handler = (_evt, payload) => cb(payload)
    ipcRenderer.on('chat:message', handler)
    return () => ipcRenderer.removeListener('chat:message', handler)
  },
  onSocketStatus: (cb) => {
    const handler = (_evt, st) => cb(st)
    ipcRenderer.on('socket:status', handler)
    return () => ipcRenderer.removeListener('socket:status', handler)
  },
})
