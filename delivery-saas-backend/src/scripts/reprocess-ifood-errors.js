#!/usr/bin/env node
import { prisma } from '../prisma.js';
import { processIFoodWebhook } from '../services/ifoodWebhookProcessor.js';

async function main() {
  console.log('Scanning for IFOOD WebhookEvents with status ERROR...');
  const rows = await prisma.webhookEvent.findMany({ where: { provider: 'IFOOD', status: 'ERROR' }, orderBy: { receivedAt: 'asc' } });
  console.log(`Found ${rows.length} events`);
  let success = 0;
  for (const r of rows) {
    try {
      console.log('Reprocessing', r.id, 'eventId:', r.eventId, 'receivedAt:', r.receivedAt);
      await processIFoodWebhook(r.id);
      const updated = await prisma.webhookEvent.findUnique({ where: { id: r.id } });
      console.log(' -> new status:', updated.status, 'processedAt:', updated.processedAt);
      if (updated.status === 'PROCESSED') success++;
    } catch (e) {
      console.error('Failed to process', r.id, e?.message || e);
    }
  }
  console.log(`Done. Successfully processed ${success} / ${rows.length}`);
  process.exit(0);
}

main().catch(e => { console.error('Error running reprocess-ifood-errors:', e); process.exit(1); });
