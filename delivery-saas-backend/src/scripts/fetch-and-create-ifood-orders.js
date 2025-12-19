#!/usr/bin/env node
import { prisma } from '../prisma.js';
import { getIFoodOrderDetails } from '../integrations/ifood/orders.js';
import { processIFoodWebhook } from '../services/ifoodWebhookProcessor.js';

async function resolveCompanyForPayload(payload) {
  const merchantIdRaw = payload?.merchantId || payload?.merchant?.id || payload?.order?.merchant?.id || payload?.storeId || null;
  if (!merchantIdRaw) return null;
  const cand = String(merchantIdRaw).trim();
  const noDashes = cand.replace(/-/g, '');
  const candidates = Array.from(new Set([cand, noDashes]));
  const integ = await prisma.apiIntegration.findFirst({
    where: { provider: 'IFOOD', OR: [ { merchantId: { in: candidates } }, { merchantUuid: { in: candidates } } ] },
    orderBy: { updatedAt: 'desc' }
  });
  return integ ? integ.companyId : null;
}

async function main() {
  console.log('Scanning processed IFOOD events for missing orders...');
  const events = await prisma.webhookEvent.findMany({ where: { provider: 'IFOOD', status: 'PROCESSED' }, orderBy: { receivedAt: 'asc' } });
  let processed = 0;
  for (const ev of events) {
    const payload = ev.payload || {};
    const orderId = payload.orderId || payload.order?.id || payload.id || null;
    if (!orderId) continue;
    const existing = await prisma.order.findUnique({ where: { externalId: orderId } });
    if (existing) continue;

    console.log('Will try to fetch order details for event', ev.id, 'orderId', orderId);
    // resolve companyId
    let companyId = await resolveCompanyForPayload(payload);
    if (!companyId) {
      // fallback: pick most recent integration
      const integ = await prisma.apiIntegration.findFirst({ where: { provider: 'IFOOD' }, orderBy: { updatedAt: 'desc' } });
      if (integ) companyId = integ.companyId;
    }
    if (!companyId) {
      console.warn('No companyId could be resolved for event', ev.id, 'skipping');
      continue;
    }

    try {
      const details = await getIFoodOrderDetails(companyId, orderId);
      if (!details) {
        console.warn('No details returned for order', orderId);
        continue;
      }
      // store fetched details into webhookEvent.payload.order (preserve original event fields)
      const newPayload = { ...payload, order: details };
      await prisma.webhookEvent.update({ where: { id: ev.id }, data: { payload: newPayload } });
      // re-run processor which will upsert the order
      await processIFoodWebhook(ev.id);
      console.log('Processed event', ev.id, '-> order should be created');
      processed++;
    } catch (e) {
      console.error('Failed fetching/processing orderId', orderId, e?.response?.data || e?.message || e);
    }
  }

  console.log(`Done. Processed ${processed} events.`);
}

main().catch(e => { console.error('Script failed:', e); process.exit(1); });
