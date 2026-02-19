'use strict';

const { app, BrowserWindow, ipcMain, Menu, shell } = require('electron');
const path = require('path');
const os = require('os');

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
}

// Lazy-loaded modules (initialized after app ready)
let config, logger, tray, socketClient, printQueue, printerManager;
let mainWindow = null;
let setupWindow = null;

// ─── App Ready ────────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  // Initialize core modules
  config = require('./src/config');
  logger = require('./src/logger');
  const TrayManager = require('./src/tray');
  socketClient = require('./src/socketClient');
  printQueue = require('./src/printQueue');
  printerManager = require('./src/printerManager');

  logger.info(`Delivery Print Agent v${app.getVersion()} iniciando...`);
  logger.info(`Plataforma: ${process.platform} | Node: ${process.version}`);

  // Setup IPC handlers
  setupIpcHandlers();

  // Create tray icon
  tray = new TrayManager();

  const cfg = config.load();

  // Show setup if not configured, otherwise run in background
  if (!cfg.serverUrl || !cfg.token) {
    openSetupWindow();
  } else {
    // Start services
    await startServices(cfg);
    // App stays in tray (no main window)
    logger.info('Agente iniciado na bandeja do sistema.');
  }
});

// ─── Second Instance ──────────────────────────────────────────────────────────
app.on('second-instance', () => {
  // Show config window when user tries to open a second instance
  openMainWindow();
});

// ─── Window Management ────────────────────────────────────────────────────────
function openSetupWindow() {
  if (setupWindow) {
    setupWindow.focus();
    return;
  }
  setupWindow = new BrowserWindow({
    width: 520,
    height: 480,
    resizable: false,
    title: 'Configuração Inicial - Delivery Print Agent',
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  setupWindow.loadFile(path.join(__dirname, 'renderer', 'setup.html'));
  setupWindow.setMenu(null);
  setupWindow.on('closed', () => { setupWindow = null; });
}

function openMainWindow() {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }
  mainWindow = new BrowserWindow({
    width: 900,
    height: 680,
    minWidth: 800,
    minHeight: 600,
    title: 'Delivery Print Agent',
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.setMenu(null);
  mainWindow.on('close', (e) => {
    // Minimize to tray instead of closing
    e.preventDefault();
    mainWindow.hide();
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

// ─── Services ─────────────────────────────────────────────────────────────────
async function startServices(cfg) {
  // Initialize printer manager with current config
  printerManager.init(cfg.printers || []);

  // Initialize print queue (binds printerManager)
  printQueue.init(printerManager);

  // Connect Socket.IO to backend
  socketClient.connect(cfg, {
    onOrder: (order) => printQueue.enqueue(order),
    onTestPrint: (data) => printQueue.enqueueTest(data),
    onListPrinters: async (cb) => {
      const list = await printerManager.listSystemPrinters();
      cb(list);
    },
    onStatusChange: (status) => {
      if (tray) tray.setStatus(status);
      // Broadcast status to any open windows
      broadcastToWindows('status-change', status);
    },
  });
}

function broadcastToWindows(event, data) {
  for (const win of [mainWindow, setupWindow]) {
    if (win && !win.isDestroyed()) {
      win.webContents.send(event, data);
    }
  }
}

// ─── IPC Handlers ─────────────────────────────────────────────────────────────
function setupIpcHandlers() {
  // Config operations
  ipcMain.handle('config:load', () => config.load());
  ipcMain.handle('config:save', async (event, newConfig) => {
    config.save(newConfig);
    // Restart services with new config
    if (socketClient) socketClient.disconnect();
    await startServices(newConfig);
    return { ok: true };
  });

  // Printer operations
  ipcMain.handle('printers:list-system', async () => {
    if (!printerManager) return [];
    return printerManager.listSystemPrinters();
  });
  ipcMain.handle('printers:test', async (event, printerId) => {
    if (!printQueue) return { ok: false, error: 'Serviço não iniciado' };
    return printQueue.enqueueTest({ printerId });
  });

  // Status
  ipcMain.handle('status:get', () => {
    if (!socketClient) return { connected: false, queued: 0 };
    return {
      connected: socketClient.isConnected(),
      queued: printQueue ? printQueue.size() : 0,
      serverUrl: config.load().serverUrl,
    };
  });

  // Auto-start
  ipcMain.handle('autostart:get', () => {
    return app.getLoginItemSettings().openAtLogin;
  });
  ipcMain.handle('autostart:set', (event, enabled) => {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      name: 'Delivery Print Agent',
    });
    return { ok: true };
  });

  // Open log file
  ipcMain.handle('logs:open', () => {
    const logPath = require('./src/logger').getLogPath();
    shell.openPath(logPath);
  });

  // Window management from tray / renderer
  ipcMain.on('window:open-config', () => openMainWindow());
  ipcMain.on('window:close-setup', async (event, savedConfig) => {
    if (savedConfig) {
      config.save(savedConfig);
      await startServices(savedConfig);
    }
    if (setupWindow) setupWindow.destroy();
    openMainWindow();
  });
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────
app.on('window-all-closed', (e) => {
  // On macOS keep running; on Windows/Linux keep running in tray
  // Do NOT quit here — app lives in system tray
});

app.on('before-quit', () => {
  if (socketClient) socketClient.disconnect();
  if (printQueue) printQueue.shutdown();
  if (logger) logger.info('Agente encerrado.');
});

// Export for tray access
module.exports = { openMainWindow, openSetupWindow };
