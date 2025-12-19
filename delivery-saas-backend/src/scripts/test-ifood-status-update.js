#!/usr/bin/env node
import { prisma } from '../prisma.js';
import { updateIFoodOrderStatus } from '../integrations/ifood/orders.js';

async function main() {
  const integ = await prisma.apiIntegration.findFirst({ where: { provider: 'IFOOD', enabled: true } });
  if (!integ) {
    console.error('No IFOOD integration found');
    process.exit(2);
  }
  console.log('Using integration:', { id: integ.id, companyId: integ.companyId, merchantId: integ.merchantId || integ.merchantUuid });

  const order = await prisma.order.findFirst({ where: { companyId: integ.companyId, externalId: { not: null } }, orderBy: { createdAt: 'desc' } });
  if (!order) {
    console.error('No order with externalId found for company', integ.companyId);
    process.exit(3);
  }
  console.log('Using order:', { id: order.id, externalId: order.externalId, status: order.status });

  try {
    const res = await updateIFoodOrderStatus(integ.companyId, order.externalId, 'DISPATCHED', { merchantId: integ.merchantUuid || integ.merchantId, fullCode: 'DISPATCHED' });
    console.log('updateIFoodOrderStatus result:', res && res.ok ? 'ok' : JSON.stringify(res));
  } catch (e) {
    console.error('updateIFoodOrderStatus failed:', e && (e.response?.data || e.message || e));
  }
}

main().then(() => process.exit(0)).catch(e => { console.error('script-failed', e && e.stack || e); process.exit(1) });
