'use strict';
/**
 * Impressão via TCP/IP (porta RAW 9100).
 * Método mais confiável para impressoras de rede — envia bytes diretamente,
 * sem driver, sem diálogo do Windows.
 */
const net = require('net');
const logger = require('../logger');

const DEFAULT_PORT = 9100;
const CONNECT_TIMEOUT_MS = 8000;
const WRITE_TIMEOUT_MS = 15000;

/**
 * @param {object} printer  - { host, port?, ... }
 * @param {Buffer} data     - Bytes ESC/POS
 */
function print(printer, data) {
  return new Promise((resolve, reject) => {
    const host = printer.host;
    const port = printer.port || DEFAULT_PORT;

    if (!host) return reject(new Error('Impressora de rede sem host configurado'));

    logger.info(`[network] Conectando a ${host}:${port} ...`);

    const socket = new net.Socket();
    let done = false;

    const cleanup = () => {
      if (!socket.destroyed) socket.destroy();
    };

    const fail = (err) => {
      if (done) return;
      done = true;
      cleanup();
      reject(err);
    };

    const succeed = () => {
      if (done) return;
      done = true;
      cleanup();
      resolve();
    };

    // Timeout de conexão
    const connectTimer = setTimeout(() => {
      fail(new Error(`Timeout ao conectar a ${host}:${port}`));
    }, CONNECT_TIMEOUT_MS);

    socket.connect(port, host, () => {
      clearTimeout(connectTimer);
      logger.debug(`[network] Conectado. Enviando ${data.length} bytes...`);

      // Timeout de envio
      const writeTimer = setTimeout(() => {
        fail(new Error(`Timeout ao enviar dados para ${host}:${port}`));
      }, WRITE_TIMEOUT_MS);

      socket.write(data, (err) => {
        clearTimeout(writeTimer);
        if (err) return fail(err);
        // Aguarda drain para garantir que todos os bytes foram enviados
        socket.end(succeed);
      });
    });

    socket.on('error', (err) => {
      clearTimeout(connectTimer);
      fail(new Error(`Erro de socket em ${host}:${port}: ${err.message}`));
    });

    socket.on('close', () => {
      if (!done) succeed(); // fechou normalmente após o envio
    });
  });
}

module.exports = { print };
