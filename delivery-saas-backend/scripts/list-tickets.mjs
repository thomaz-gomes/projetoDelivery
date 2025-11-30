#!/usr/bin/env node
import { prisma } from '../src/prisma.js';

async function main() {
  const limit = Number(process.argv[2] || 50);
  const recent = await prisma.ticket.findMany({ orderBy: { createdAt: 'desc' }, take: limit, include: { order: true } });
  if (!recent || !recent.length) {
    console.log('No tickets found');
    process.exit(0);
  }
  for (const t of recent) {
    console.log('---');
    console.log('id:', t.id);
    console.log('orderId:', t.orderId);
    console.log('tokenHash:', t.tokenHash);
    console.log('expiresAt:', t.expiresAt);
    console.log('usedAt:', t.usedAt);
    console.log('createdAt:', t.createdAt);
    if (t.order) console.log('order.displayId:', t.order.displayId, 'order.status:', t.order.status);
  }
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
