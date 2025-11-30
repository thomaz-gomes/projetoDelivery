#!/usr/bin/env node
import 'dotenv/config';
import { prisma } from '../src/prisma.js';

async function main(){
  const companyId = process.env.COMPANY_ID || null;
  const where = companyId ? { companyId, provider: 'IFOOD' } : { provider: 'IFOOD' };
  const rows = await prisma.apiIntegration.findMany({ where, orderBy: { updatedAt: 'desc' } });
  if(!rows || rows.length === 0){
    console.log('Nenhuma integração iFood encontrada.');
    process.exit(0);
  }
  for(const r of rows){
    console.log('---');
    console.log('id:', r.id);
    console.log('companyId:', r.companyId);
    console.log('clientId:', !!r.clientId);
    console.log('clientSecret:', !!r.clientSecret);
    console.log('merchantId:', r.merchantId || null);
    console.log('codeVerifier:', !!r.codeVerifier);
    console.log('linkCode:', r.linkCode || null);
    console.log('accessToken:', !!r.accessToken);
    console.log('refreshToken:', !!r.refreshToken);
    console.log('tokenExpiresAt:', r.tokenExpiresAt || null);
    console.log('updatedAt:', r.updatedAt);
  }
  process.exit(0);
}

main().catch(e=>{ console.error(e); process.exit(1) });
