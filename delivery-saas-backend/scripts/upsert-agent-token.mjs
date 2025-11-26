#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const root = process.cwd();
  const tokenPath = path.join(root, '.print-agent-token');
  if (!fs.existsSync(tokenPath)) {
    console.error('No .print-agent-token file found in project root:', tokenPath);
    process.exit(1);
  }
  const token = fs.readFileSync(tokenPath, 'utf8').trim();
  if (!token) {
    console.error('.print-agent-token is empty');
    process.exit(1);
  }

  const hash = crypto.createHash('sha256').update(token, 'utf8').digest('hex');
  console.log('Computed token SHA256:', hash);

  // companyId can be passed as first arg, otherwise try .print-agent-company, otherwise pick first company
  let companyId = process.argv[2];
  if (!companyId) {
    const companyFile = path.join(root, '.print-agent-company');
    if (fs.existsSync(companyFile)) {
      companyId = fs.readFileSync(companyFile, 'utf8').trim();
      if (!companyId) companyId = undefined;
    }
  }

  if (!companyId) {
    const first = await prisma.company.findFirst({ select: { id: true } });
    if (!first) {
      console.error('No company found in DB. Create a company first or pass a companyId as argument.');
      process.exit(1);
    }
    companyId = first.id;
    console.log('No companyId provided — using first company in DB:', companyId);
  }

  // Upsert PrinterSetting for this company
  const existing = await prisma.printerSetting.findUnique({ where: { companyId } });
  if (existing) {
    await prisma.printerSetting.update({ where: { companyId }, data: { agentTokenHash: hash, agentTokenCreatedAt: new Date() } });
    console.log('Updated PrinterSetting.agentTokenHash for company', companyId);
  } else {
    await prisma.printerSetting.create({ data: { companyId, agentTokenHash: hash, agentTokenCreatedAt: new Date() } });
    console.log('Created PrinterSetting with agent token for company', companyId);
  }

  await prisma.$disconnect();
}

main().catch(e => { console.error('Error:', e); prisma.$disconnect(); process.exit(1); });
