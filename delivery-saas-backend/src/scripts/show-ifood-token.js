#!/usr/bin/env node
import { prisma } from '../prisma.js';

async function main() {
  try {
    const integ = await prisma.apiIntegration.findFirst({ where: { provider: 'IFOOD' }, orderBy: { updatedAt: 'desc' } });
    if (!integ) {
      console.error('Nenhuma integração IFOOD encontrada.');
      process.exit(2);
    }
    console.log('Integration id:', integ.id);
    console.log('companyId:', integ.companyId);
    console.log('merchantId:', integ.merchantId || integ.merchantUuid || '<none>');
    console.log('\n--- TOKEN (FULL) ---');
    console.log(integ.accessToken || '<no accessToken>');
    console.log('\n--- REFRESH TOKEN (FULL) ---');
    console.log(integ.refreshToken || '<no refreshToken>');
    console.log('\n--- END ---');
  } catch (e) {
    console.error('Erro ao buscar integração:', e && e.message || e);
    process.exit(1);
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e && e.stack || e); process.exit(1) });
