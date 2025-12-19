#!/usr/bin/env node
import { prisma } from '../prisma.js';
import { processIFoodWebhook } from '../services/ifoodWebhookProcessor.js';

async function main() {
  const id = process.argv[2];
  if (!id) {
    console.error('Usage: node src/scripts/reprocess-ifood-event.js <webhookEventId>');
    process.exit(2);
  }

  const evt = await prisma.webhookEvent.findUnique({ where: { id } });
  if (!evt) {
    console.error('WebhookEvent not found for id:', id);
    process.exit(3);
  }

  console.log('Reprocessing WebhookEvent', id, 'status:', evt.status, 'receivedAt:', evt.receivedAt);
  try {
    await processIFoodWebhook(id);
    const updated = await prisma.webhookEvent.findUnique({ where: { id } });
    console.log('Done. New status:', updated.status, 'processedAt:', updated.processedAt, 'error:', updated.error);
  } catch (e) {
    console.error('Processing failed:', e);
  }
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
