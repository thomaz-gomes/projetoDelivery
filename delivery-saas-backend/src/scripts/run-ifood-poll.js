#!/usr/bin/env node
import { prisma } from '../prisma.js';
import { ifoodPoll } from '../integrations/ifood/client.js';

async function main() {
  // allow optional companyId argument
  const arg = process.argv[2];
  let companyId = arg || null;

  if (!companyId) {
    // pick most recently updated IFOOD integration
    const integ = await prisma.apiIntegration.findFirst({ where: { provider: 'IFOOD' }, orderBy: { updatedAt: 'desc' } });
    if (!integ) {
      console.error('No IFOOD integration found in DB. Provide a companyId as argument.');
      process.exit(2);
    }
    companyId = integ.companyId;
    console.log('Selected companyId from integration:', companyId);
  }

  try {
    console.log('Calling ifoodPoll for companyId', companyId);
    const r = await ifoodPoll(companyId);
    console.log('Poll result:', JSON.stringify(r, null, 2));
  } catch (e) {
    console.error('ifoodPoll failed:', e?.response?.data || e?.message || e);
    process.exit(3);
  }
}

main().catch(e => { console.error('Script error:', e); process.exit(1); });
