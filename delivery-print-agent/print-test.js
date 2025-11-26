require('dotenv').config();
const printerService = require('./printerService');

(async () => {
  try {
    const sample = {
      id: 'TEST-' + Date.now(),
      displaySimple: 'TT',
      customerName: 'Cliente Teste',
      address: 'Rua Exemplo, 123',
      items: [
        { name: 'Pizza Margherita', quantity: 1, price: 29.9 },
        { name: 'Coca-Cola 350ml', quantity: 1, price: 6.5 }
      ],
      total: 36.4
    };

    console.log('Running print-test with DRY_RUN=%s', process.env.DRY_RUN);
    await printerService.printOrder(sample);
    console.log('print-test finished');
  } catch (e) {
    console.error('print-test failed', e && e.message ? e.message : e);
    process.exit(1);
  }
})();
