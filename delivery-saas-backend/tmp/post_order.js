// Posts a sample public order to the running backend, ignores TLS validation for self-signed certs
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const fetch = global.fetch || require('node-fetch');

(async () => {
  try {
    const productId = 'product-default-1';
    const payload = {
      customer: {
        name: 'Test Customer',
        address: { neighborhood: 'Centro', formattedAddress: 'Rua Teste, 1 - Centro' },
        contact: '11999999999'
      },
      items: [
        { productId, name: 'Produto A', price: 10.0, quantity: 1 }
      ],
      payment: { methodCode: 'CASH', amount: 10.0 },
      neighborhood: 'Centro'
    };

    const res = await fetch('https://localhost:3000/public/1/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const text = await res.text();
    console.log('Status:', res.status);
    console.log('Response:', text);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();
