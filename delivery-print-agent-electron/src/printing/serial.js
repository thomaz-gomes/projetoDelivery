'use strict';
/**
 * Impressão via porta serial (COM).
 * Requer pacote 'serialport' instalado.
 *
 * Configuração típica para impressoras térmicas:
 *  baudRate: 9600 ou 19200
 *  dataBits: 8
 *  parity:   'none'
 *  stopBits: 1
 */
const logger = require('../logger');

// serialport é opcional — graceful degradation se não instalado
let SerialPort;
try {
  SerialPort = require('serialport').SerialPort;
} catch (_) {
  SerialPort = null;
}

/**
 * @param {object} printer  - { comPort, baudRate?, dataBits?, parity?, stopBits? }
 * @param {Buffer} data     - Bytes ESC/POS
 */
function print(printer, data) {
  return new Promise((resolve, reject) => {
    if (!SerialPort) {
      return reject(new Error(
        'Pacote "serialport" não instalado. Execute: npm install serialport'
      ));
    }

    const comPort = printer.comPort;
    if (!comPort) return reject(new Error('comPort não configurado'));

    logger.info(`[serial] Abrindo ${comPort} @ ${printer.baudRate || 9600} bps...`);

    const port = new SerialPort({
      path: comPort,
      baudRate: printer.baudRate || 9600,
      dataBits: printer.dataBits || 8,
      parity:   printer.parity   || 'none',
      stopBits: printer.stopBits || 1,
      autoOpen: false,
    });

    port.open((err) => {
      if (err) {
        return reject(new Error(`[serial] Falha ao abrir ${comPort}: ${err.message}`));
      }

      logger.debug(`[serial] ${comPort} aberto. Enviando ${data.length} bytes...`);

      port.write(data, (writeErr) => {
        if (writeErr) {
          port.close();
          return reject(new Error(`[serial] Erro ao escrever em ${comPort}: ${writeErr.message}`));
        }

        port.drain((drainErr) => {
          port.close((closeErr) => {
            if (drainErr) {
              reject(new Error(`[serial] drain error em ${comPort}: ${drainErr.message}`));
            } else {
              logger.info(`[serial] Enviado com sucesso para ${comPort}`);
              resolve();
            }
          });
        });
      });
    });
  });
}

/**
 * Lista portas COM disponíveis no sistema.
 * @returns {Promise<string[]>}
 */
async function listPorts() {
  if (!SerialPort) return [];
  try {
    const ports = await SerialPort.list();
    return ports.map((p) => p.path);
  } catch (_) {
    return [];
  }
}

module.exports = { print, listPorts };
