import { findOrCreateCustomer } from '../services/customers.js';
import { prisma } from '../prisma.js';

async function run() {
  const companyId = process.env.TEST_COMPANY_ID || process.env.DEFAULT_COMPANY_ID || null;
  if (!companyId) {
    console.error('Please set TEST_COMPANY_ID or DEFAULT_COMPANY_ID env var to an existing company id and re-run.');
    process.exit(1);
  }

  const payload = {
    companyId,
    fullName: 'Teste Cliente AI',
    cpf: null,
    whatsapp: '08007051020',
    phone: null,
    addressPayload: {
      delivery: { deliveryAddress: { formattedAddress: 'R. Teste, 123, Casa', coordinates: { latitude: null, longitude: null } } }
    }
  };

  try {
    console.log('Attempting to findOrCreateCustomer with payload:', JSON.stringify(payload, null, 2));
    const customer = await findOrCreateCustomer(payload);
    console.log('Result customer:', customer);
  } catch (e) {
    console.error('Error during findOrCreateCustomer:', e);
    if (e?.code) console.error('Error code:', e.code);
    if (e?.meta) console.error('Error meta:', e.meta);
  } finally {
    await prisma.$disconnect().catch(()=>{});
  }
}

run();
