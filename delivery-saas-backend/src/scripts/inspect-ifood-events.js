#!/usr/bin/env node
import { prisma } from '../prisma.js';

async function main() {
  const recentEvents = await prisma.webhookEvent.findMany({
    where: { provider: 'IFOOD' },
    orderBy: { receivedAt: 'desc' },
    take: 20,
  });

  console.log('Recent iFood WebhookEvents:');
  for (const e of recentEvents) {
    const id = e.id;
    const ev = e.payload;
    const evId = e.eventId || (ev && ev.id) || (ev && ev.order && ev.order.id) || null;
    console.log('---');
    console.log('id:', id);
    console.log('eventId:', evId);
    console.log('receivedAt:', e.receivedAt);
    console.log('status:', e.status, 'processedAt:', e.processedAt);
    if (e.error) console.log('error:', e.error);

    // try to find corresponding order by externalId
    const externalId = (ev && (ev.order?.id || ev.id || ev.referenceId)) || null;
    if (externalId) {
      const order = await prisma.order.findUnique({ where: { externalId } });
      console.log('mapped externalId:', externalId, 'order found:', !!order, order ? `orderId=${order.id}` : '');
    } else {
      console.log('no externalId extracted from payload sample');
    }
  }

  // show last 10 created orders for context
  const orders = await prisma.order.findMany({ orderBy: { createdAt: 'desc' }, take: 10 });
  console.log('\nRecent Orders:');
  for (const o of orders) {
    console.log(`- id=${o.id} externalId=${o.externalId} companyId=${o.companyId} storeId=${o.storeId} status=${o.status} createdAt=${o.createdAt}`);
  }

  process.exit(0);
}

main().catch(e => {
  console.error('Failed to inspect events:', e);
  process.exit(2);
});
