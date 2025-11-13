#!/usr/bin/env node
import { PrismaClient } from '@prisma/client';

(async () => {
  // allow self-signed local certs for this test
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

  const prisma = new PrismaClient();
  try {
    const company = await prisma.company.findFirst();
    if (!company) {
      console.error('No company found in the database. Create a company first.');
      process.exit(1);
    }
    console.log('Using company:', company.id, company.name);

    // find or create a product
    let product = await prisma.product.findFirst({ where: { companyId: company.id } });
    if (!product) {
      product = await prisma.product.create({ data: { companyId: company.id, name: 'E2E Test Product', price: 10 } });
      console.log('Created product:', product.id);
    } else {
      console.log('Found product:', product.id, product.name);
    }

    // create an option group
    const group = await prisma.optionGroup.create({ data: { companyId: company.id, name: 'E2E Group', min: 0, max: 2 } });
    console.log('Created option group:', group.id);

    // create two options: one free and one paid
    const optFree = await prisma.option.create({ data: { groupId: group.id, name: 'Free Option', price: 0 } });
    const optPaid = await prisma.option.create({ data: { groupId: group.id, name: 'Paid Option', price: 5.5 } });
    console.log('Created options:', optFree.id, optPaid.id);

    // associate group with product (create if not exists)
    const existingAssoc = await prisma.productOptionGroup.findFirst({ where: { productId: product.id, groupId: group.id } });
    if (!existingAssoc) {
      await prisma.productOptionGroup.create({ data: { productId: product.id, groupId: group.id } });
      console.log('Associated group to product');
    } else {
      console.log('Association already exists');
    }

    // Build public order payload selecting the paid option
    const payload = {
      customerName: 'E2E Tester',
      customerPhone: '5511999999999',
      address: { formatted: 'Rua Teste, 123', neighborhood: 'Centro' },
      items: [
        {
          productId: product.id,
          name: product.name,
          quantity: 1,
          price: Number(product.price || 0),
          options: [ { id: optPaid.id, name: optPaid.name, price: Number(optPaid.price || 0) } ]
        }
      ],
      payment: { methodCode: 'CASH', amount: Number(product.price || 0) + Number(optPaid.price || 0) }
    };

  const port = process.env.TEST_PORT || 3000;
  const url = `https://localhost:${port}/public/${company.id}/orders`;
    console.log('Posting order to', url);

    // use global fetch (Node 18+); allow self-signed cert by env var above
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    const body = await res.text();
    let parsed = null;
    try { parsed = JSON.parse(body); } catch (e) { parsed = body; }
    console.log('HTTP', res.status, parsed);

    if (res.status === 201 && parsed && parsed.id) {
      const order = await prisma.order.findUnique({ where: { id: parsed.id }, include: { items: true } });
      console.log('Order stored in DB:', { id: order.id, total: order.total, items: order.items.map(i => ({ id: i.id, name: i.name, quantity: i.quantity, price: i.price, options: i.options })) });
    } else {
      console.error('Order creation failed or returned non-201');
    }

  } catch (e) {
    console.error('E2E script error', e);
  } finally {
    await prisma.$disconnect();
    process.exit(0);
  }
})();
