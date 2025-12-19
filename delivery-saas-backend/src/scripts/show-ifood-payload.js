#!/usr/bin/env node
import { prisma } from '../prisma.js';

async function main() {
  const id = process.argv[2];
  if (!id) {
    console.error('Usage: node src/scripts/show-ifood-payload.js <webhookEventId>');
    process.exit(2);
  }

  const evt = await prisma.webhookEvent.findUnique({ where: { id } });
  if (!evt) {
    console.error('WebhookEvent not found for id:', id);
    process.exit(3);
  }

  console.log('WebhookEvent id:', evt.id);
  console.log('eventId:', evt.eventId);
  console.log('status:', evt.status, 'receivedAt:', evt.receivedAt, 'processedAt:', evt.processedAt);
  if (evt.error) console.log('error:', evt.error);

  const p = evt.payload || {};
  console.log('\n--- payload (truncated to 4000 chars) ---');
  try {
    const s = JSON.stringify(p, null, 2).slice(0, 4000);
    console.log(s);
  } catch (e) {
    console.log(String(p).slice(0, 2000));
  }

  console.log('\n--- merchant-related fields synthesis ---');
  const hints = [];
  if (p.merchantId) hints.push(`payload.merchantId = ${p.merchantId}`);
  if (p.merchant && p.merchant.id) hints.push(`payload.merchant.id = ${p.merchant.id}`);
  if (p.order && p.order.merchant && p.order.merchant.id) hints.push(`payload.order.merchant.id = ${p.order.merchant.id}`);
  if (p.storeId) hints.push(`payload.storeId = ${p.storeId}`);
  if (p.order && p.order.id) hints.push(`payload.order.id = ${p.order.id}`);
  if (Object.keys(p).length === 0) hints.push('payload is empty object');

  if (hints.length === 0) {
    console.log('No obvious merchant fields found in payload. Keys present:', Object.keys(p).slice(0,50));
  } else {
    console.log(hints.join('\n'));
  }

  process.exit(0);
}

main().catch(e => { console.error('Failed to show payload:', e); process.exit(1); });
