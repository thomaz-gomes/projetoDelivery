#!/usr/bin/env node
import { prisma } from '../src/prisma.js';

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error('Usage: node scripts/find-ticket.mjs <token|orderId|tokenHash>');
    process.exit(2);
  }

  // Try to find by tokenHash first, then by orderId, then by token substring
  const now = new Date();
  const byHash = await prisma.ticket.findFirst({ where: { tokenHash: arg } });
  if (byHash) {
    console.log('Found by tokenHash:', byHash);
    process.exit(0);
  }

  const byOrder = await prisma.ticket.findFirst({ where: { orderId: arg } });
  if (byOrder) {
    console.log('Found by orderId:', byOrder);
    process.exit(0);
  }

  // fallback: search for tokenHash that contains arg (helpful if arg is a trimmed token)
  const like = await prisma.$queryRaw`SELECT * FROM Ticket WHERE tokenHash LIKE ${'%' + arg + '%'} LIMIT 10`;
  if (Array.isArray(like) && like.length) {
    console.log('Found by LIKE tokenHash:', like);
    process.exit(0);
  }

  console.log('No ticket found for', arg);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
