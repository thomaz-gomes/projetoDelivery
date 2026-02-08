require('dotenv').config();
const printerService = require('./printerService');

(async () => {
  try {
    // Test 1: Dados completos (simula pedido ideal com todos os campos)
    const sample1 = {
      id: 'TEST-' + Date.now(),
      displaySimple: '03',
      customerName: 'THOMAZ',
      customerPhone: '73991429676',
      address: 'Rua das Flores, 456, Apt 12, Centro, Ilheus',
      payload: {
        orderType: 'DELIVERY',
        delivery: {
          deliveryAddress: {
            streetName: 'Rua das Flores',
            streetNumber: '456',
            neighborhood: 'Centro',
            city: 'Ilheus',
            complement: 'Apt 12'
          }
        },
        payment: { method: 'PIX', amount: 42.40 },
        qrText: 'http://localhost:5173/orders/TEST-123'
      },
      items: [
        { name: 'Pizza Margherita', quantity: 1, price: 29.9, options: [{ name: 'Borda recheada', quantity: 1, price: 6.0 }] },
        { name: 'Coca-Cola 350ml', quantity: 1, price: 6.5 }
      ],
      total: 42.40
    };

    console.log('=== Test 1: Dados completos (address top-level + qrText no payload) ===');
    console.log('DRY_RUN=%s', process.env.DRY_RUN);
    await printerService.printOrder(sample1);
    console.log('Test 1 OK\n');

    // Test 2: Simula dados parciais (como vem do DB - sem qrText top-level, address só no DB)
    const sample2 = {
      id: 'TEST2-' + Date.now(),
      displaySimple: '04',
      customerName: 'MARIA',
      customerPhone: '73988887777',
      address: null, // address vazio - deve resolver de payload.delivery.deliveryAddress
      payload: {
        orderType: 'DELIVERY',
        delivery: {
          deliveryAddress: {
            streetName: 'Av. Brasil',
            streetNumber: '100',
            neighborhood: 'Pontal',
            city: 'Ilheus',
            complement: 'Casa 2'
          }
        },
        payment: { method: 'DINHEIRO', amount: 25.00 },
        qrText: 'http://localhost:5173/orders/TEST2-456'
      },
      items: [
        { name: 'X-Burger', quantity: 2, price: 12.50 }
      ],
      total: 25.00
    };

    console.log('=== Test 2: address=null, qrText apenas em payload ===');
    await printerService.printOrder(sample2);
    console.log('Test 2 OK\n');

    console.log('All print tests finished successfully');
  } catch (e) {
    console.error('print-test failed', e && e.message ? e.message : e);
    process.exit(1);
  }
})();
