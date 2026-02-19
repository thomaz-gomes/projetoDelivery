'use strict';
/**
 * Gerenciamento de configuração.
 * Armazena em %APPDATA%\DeliveryPrintAgent\config.json
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_DIR = process.env.APPDATA
  ? path.join(process.env.APPDATA, 'DeliveryPrintAgent')
  : path.join(os.homedir(), '.delivery-print-agent');

const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

const DEFAULT_CONFIG = {
  serverUrl: '',         // Ex: https://meudelivery.com
  token: '',             // Token JWT do agente (gerado no painel)
  autoStart: true,
  printers: [],          // Array de PrinterConfig (ver abaixo)
};

/**
 * Estrutura de PrinterConfig:
 * {
 *   id: string,              // UUID gerado localmente
 *   alias: string,           // Ex: "Cozinha 1", "Bar", "Expedição"
 *   categories: string[],    // Ex: ["food","drink"] ou ["all"]
 *   interface: 'network' | 'usb' | 'serial',
 *   // Network:
 *   host: string,            // IP da impressora
 *   port: number,            // Padrão: 9100
 *   // USB (Windows spooler - RAW):
 *   windowsPrinterName: string, // Nome exato em Dispositivos e Impressoras
 *   // Serial (COM):
 *   comPort: string,         // Ex: "COM3"
 *   baudRate: number,        // Ex: 9600 ou 19200
 *   // Layout:
 *   width: 58 | 80,          // Largura em mm
 *   characterSet: 'PC850' | 'UTF8', // Codepage
 *   marginLeft: number,      // Colunas extras à esquerda (0 = sem margem)
 *   density: number,         // Densidade de aquecimento: 0-15 (padrão 8)
 *   copies: number,          // Número de vias (padrão 1)
 *   enabled: boolean,
 * }
 */

function load() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
      return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
    }
  } catch (e) {
    console.error('[config] Erro ao carregar:', e.message);
  }
  return { ...DEFAULT_CONFIG };
}

function save(cfg) {
  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
  } catch (e) {
    console.error('[config] Erro ao salvar:', e.message);
    throw e;
  }
}

function getConfigDir() {
  return CONFIG_DIR;
}

module.exports = { load, save, getConfigDir, CONFIG_FILE };
