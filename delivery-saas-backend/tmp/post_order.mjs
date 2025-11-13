import https from 'https';

const payload = JSON.stringify({
  customer: {
    name: 'Test Customer',
    address: { neighborhood: 'Centro', formattedAddress: 'Rua Teste, 1 - Centro' },
    contact: '11999999999'
  },
  items: [ { productId: 'product-default-1', name: 'Produto A', price: 10.0, quantity: 1 } ],
  payment: { methodCode: 'CASH', amount: 10.0 },
  neighborhood: 'Centro'
});

const companyId = 'bd6a5381-6b90-4cc9-bc8f-24890c491693';

const options = {
  hostname: 'localhost',
  port: 3000,
  path: `/public/${companyId}/orders`,
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload)
  },
  agent: new https.Agent({ rejectUnauthorized: false })
};

const req = https.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => data += chunk);
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    console.log('Response:', data);
    process.exit(0);
  });
});

req.on('error', (e) => {
  console.error('Request error:', e);
  process.exit(1);
});

req.write(payload);
req.end();
