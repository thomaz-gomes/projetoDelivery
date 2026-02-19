'use strict';
/**
 * Dispatcher de impressão.
 * Roteia para o módulo correto baseado em printer.interface.
 */
const logger = require('../logger');
const network = require('./network');
const usb     = require('./usb');
const serial  = require('./serial');

/**
 * @param {PrinterConfig} printer
 * @param {Buffer}        data     - Bytes ESC/POS prontos
 */
async function dispatch(printer, data) {
  switch (printer.interface) {
    case 'network':
      return network.print(printer, data);

    case 'usb':
      return usb.print(printer, data);

    case 'serial':
      return serial.print(printer, data);

    default:
      throw new Error(`Interface de impressora desconhecida: "${printer.interface}"`);
  }
}

module.exports = dispatch;
