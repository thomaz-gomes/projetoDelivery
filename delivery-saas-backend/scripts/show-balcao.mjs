#!/usr/bin/env node
import { prisma } from '../src/prisma.js';

async function main() {
  const bal = await prisma.customer.findFirst({ where: { OR: [ { fullName: 'Balcão' }, { fullName: 'Balcao' }, { fullName: 'balcão' }, { fullName: 'balcao' } ] } });
  if (!bal) {
    console.log('Nenhum cliente "Balcão" encontrado para este banco.');
    process.exit(0);
  }
  console.log('Balcão customer:', { id: bal.id, companyId: bal.companyId, fullName: bal.fullName, whatsapp: bal.whatsapp, phone: bal.phone, createdAt: bal.createdAt });
  const orders = await prisma.order.findMany({ where: { customerId: bal.id }, orderBy: { createdAt: 'desc' }, take: 20 });
  console.log('Pedidos associados (até 20):', orders.map(o => ({ id: o.id, externalId: o.externalId, displayId: o.displayId, status: o.status, createdAt: o.createdAt })));
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
