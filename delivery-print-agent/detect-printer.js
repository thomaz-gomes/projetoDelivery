require('dotenv').config();
const { printer: ThermalPrinter, types: PrinterTypes } = require('node-thermal-printer');

const PRINTER_INTERFACE = process.env.PRINTER_INTERFACE || 'printer:default';
const PRINTER_TYPE = (process.env.PRINTER_TYPE || 'EPSON').toUpperCase();
const type = PRINTER_TYPE === 'STAR' ? PrinterTypes.STAR : PrinterTypes.EPSON;

(async () => {
  try {
    const printer = new ThermalPrinter({ type, interface: PRINTER_INTERFACE, options: { timeout: 3000 } });
    if (typeof printer.isPrinterConnected === 'function') {
      const ok = await printer.isPrinterConnected();
      console.log('isPrinterConnected =>', ok);
    } else {
      console.log('printer.isPrinterConnected not available in this version; attempting execute dry-run');
      try {
        printer.println('TEST PRINTER CHECK');
        printer.cut();
        console.log('Build commands OK — this does not guarantee physical connection. Run print-test with DRY_RUN=false to attempt actual print.');
      } catch (e) {
        console.error('Failed building print commands', e && e.message ? e.message : e);
      }
    }
  } catch (e) {
    console.error('Detect printer error', e && e.message ? e.message : e);
    process.exit(1);
  }
})();
