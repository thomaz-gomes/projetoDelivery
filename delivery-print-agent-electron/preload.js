'use strict';
/**
 * Preload script — expõe uma API segura para o renderer via contextBridge.
 * O renderer NUNCA acessa Node.js diretamente.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // ── Config ──────────────────────────────────────────────────────────────
  loadConfig: () => ipcRenderer.invoke('config:load'),
  saveConfig: (cfg) => ipcRenderer.invoke('config:save', cfg),

  // ── Printers ────────────────────────────────────────────────────────────
  listSystemPrinters: () => ipcRenderer.invoke('printers:list-system'),
  testPrint: (printerId) => ipcRenderer.invoke('printers:test', printerId),

  // ── Status ──────────────────────────────────────────────────────────────
  getStatus: () => ipcRenderer.invoke('status:get'),
  onStatusChange: (cb) => {
    const handler = (_, data) => cb(data);
    ipcRenderer.on('status-change', handler);
    return () => ipcRenderer.removeListener('status-change', handler);
  },

  // ── Auto-start ──────────────────────────────────────────────────────────
  getAutoStart: () => ipcRenderer.invoke('autostart:get'),
  setAutoStart: (enabled) => ipcRenderer.invoke('autostart:set', enabled),

  // ── Pairing ─────────────────────────────────────────────────────────────
  // Troca código de 6 chars por token via backend /api/agent-setup/pair
  pairWithCode: (serverUrl, code) => ipcRenderer.invoke('agent:pair', { serverUrl, code }),

  // ── Logs ────────────────────────────────────────────────────────────────
  openLogs: () => ipcRenderer.invoke('logs:open'),

  // ── Window ──────────────────────────────────────────────────────────────
  closeSetup: (savedConfig) => ipcRenderer.send('window:close-setup', savedConfig),
  openConfig: () => ipcRenderer.send('window:open-config'),
});
