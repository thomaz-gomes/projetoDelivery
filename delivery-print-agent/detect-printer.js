require('dotenv').config();
let ThermalPrinter = null;
let PrinterTypes = { EPSON: 'EPSON', STAR: 'STAR' };
try {
  const ntp = require('node-thermal-printer');
  ThermalPrinter = ntp.printer || ntp.ThermalPrinter || ntp.Printer || ntp;
  PrinterTypes = ntp.types || ntp.PrinterTypes || ntp.Types || PrinterTypes;
} catch (e) {
  console.warn('node-thermal-printer not available; detect-printer will be limited:', e && e.message);
}

const PRINTER_INTERFACE = process.env.PRINTER_INTERFACE || 'printer:default';
const PRINTER_TYPE = (process.env.PRINTER_TYPE || 'EPSON').toUpperCase();
const type = PRINTER_TYPE === 'STAR' ? PrinterTypes.STAR : PrinterTypes.EPSON;

(async () => {
  if (!ThermalPrinter) {
    console.log('ThermalPrinter module not present — skipping detect-printer checks.');
    process.exit(0);
  }
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
