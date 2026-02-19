'use strict';
/**
 * Gerenciador da System Tray.
 * Exibe ícone na bandeja com menu contextual e indicador de status.
 */
const { Tray, Menu, nativeImage, app } = require('electron');
const path = require('path');

// Ícones inline em Base64 (16x16 PNG minimalistas)
// Verde = conectado, Vermelho = desconectado, Amarelo = conectando
const ICONS = {
  connected:    path.join(__dirname, '..', 'assets', 'tray-green.png'),
  disconnected: path.join(__dirname, '..', 'assets', 'tray-red.png'),
  connecting:   path.join(__dirname, '..', 'assets', 'tray-yellow.png'),
};

class TrayManager {
  constructor() {
    this._tray = null;
    this._status = { connected: false, label: 'Desconectado' };
    this._init();
  }

  _init() {
    // Fallback: se ícone não existir, cria nativeImage vazio
    let icon;
    try {
      icon = nativeImage.createFromPath(ICONS.disconnected);
      if (icon.isEmpty()) icon = nativeImage.createEmpty();
    } catch (_) {
      icon = nativeImage.createEmpty();
    }

    this._tray = new Tray(icon);
    this._tray.setToolTip('Delivery Print Agent');
    this._rebuild();

    this._tray.on('double-click', () => {
      const { openMainWindow } = require('../main');
      openMainWindow();
    });
  }

  setStatus(status) {
    // status: { connected: bool, label: string, queued?: number }
    this._status = status;

    const iconKey = status.connected ? 'connected' : 'disconnected';
    try {
      const icon = nativeImage.createFromPath(ICONS[iconKey]);
      if (!icon.isEmpty()) this._tray.setImage(icon);
    } catch (_) {}

    const tooltip = status.connected
      ? `Delivery Print Agent — Conectado${status.queued ? ` (${status.queued} na fila)` : ''}`
      : `Delivery Print Agent — ${status.label || 'Desconectado'}`;
    this._tray.setToolTip(tooltip);
    this._rebuild();
  }

  _rebuild() {
    const statusLabel = this._status.connected
      ? '🟢  Conectado ao servidor'
      : '🔴  Desconectado';

    const menu = Menu.buildFromTemplate([
      { label: 'Delivery Print Agent', enabled: false },
      { label: statusLabel, enabled: false },
      { type: 'separator' },
      {
        label: 'Abrir Configurações',
        click: () => {
          const { openMainWindow } = require('../main');
          openMainWindow();
        },
      },
      { type: 'separator' },
      {
        label: 'Sair',
        click: () => {
          app.exit(0);
        },
      },
    ]);

    this._tray.setContextMenu(menu);
  }

  destroy() {
    if (this._tray) {
      this._tray.destroy();
      this._tray = null;
    }
  }
}

module.exports = TrayManager;
