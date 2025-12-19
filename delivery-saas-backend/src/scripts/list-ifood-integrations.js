#!/usr/bin/env node
import { prisma } from '../prisma.js';

async function main() {
  const rows = await prisma.apiIntegration.findMany({ where: { provider: 'IFOOD' }, orderBy: { updatedAt: 'desc' } });
  console.log(`Found ${rows.length} IFOOD integrations:`);
  for (const r of rows) {
    console.log('---');
    console.log('id:', r.id);
    console.log('companyId:', r.companyId);
    console.log('storeId:', r.storeId);
    console.log('merchantId:', r.merchantId);
    console.log('merchantUuid:', r.merchantUuid);
    console.log('enabled:', r.enabled, 'hasToken:', !!r.accessToken, 'updatedAt:', r.updatedAt);
  }
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
