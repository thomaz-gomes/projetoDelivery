#!/usr/bin/env node
import { prisma } from '../src/prisma.js';
import { findOrCreateCustomer } from '../src/services/customers.js';

async function main(){
  const company = await prisma.company.findFirst();
  if(!company){
    console.error('No company found in DB. Create one first.');
    process.exit(1);
  }

  // Simulate PDV flow: customerName 'Balcão' and no phone
  const fullName = 'Balcão';
  const whatsapp = null;
  const phone = null;

  const customer = await findOrCreateCustomer({ companyId: company.id, fullName, cpf: null, whatsapp, phone });
  console.log('findOrCreateCustomer returned:', { id: customer.id, fullName: customer.fullName, phone: customer.phone, whatsapp: customer.whatsapp });

  // create an order referencing this customer
  const created = await prisma.order.create({ data: {
    companyId: company.id,
    customerSource: 'MANUAL',
    customerId: customer.id,
    customerName: fullName,
    customerPhone: null,
    total: 5,
    orderType: 'BALCAO',
    status: 'EM_PREPARO',
    items: { create: [ { name: 'Teste Balcão', quantity: 1, price: 5 } ] },
    histories: { create: { from: null, to: 'EM_PREPARO', byUserId: null, reason: 'Test script' } }
  }, include: { items: true } });

  console.log('Created order:', { id: created.id, customerId: created.customerId, customerName: created.customerName });

  // verify the customer in DB is the Balcão default
  const bal = await prisma.customer.findFirst({ where: { companyId: company.id, fullName: 'Balcão' } });
  console.log('Default Balcão customer in DB:', bal ? { id: bal.id, fullName: bal.fullName } : null);

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1) });
