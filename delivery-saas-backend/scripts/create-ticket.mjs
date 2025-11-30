#!/usr/bin/env node
import { prisma } from '../src/prisma.js';
import { randomToken, sha256 } from '../src/utils.js';

async function main() {
  const orderId = process.argv[2];
  if (!orderId) {
    console.error('Usage: node scripts/create-ticket.mjs <orderId>');
    process.exit(2);
  }

  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) {
    console.error('Order not found:', orderId);
    process.exit(1);
  }

  const token = randomToken(24);
  const tokenHash = sha256(token);
  const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000);

  const created = await prisma.ticket.create({ data: { orderId, tokenHash, expiresAt } });

  const base = process.env.PUBLIC_FRONTEND_URL || `http://localhost:5173`;
  const qrUrl = `${String(base).replace(/\/$/, '')}/rider/claim/${encodeURIComponent(token)}`;

  console.log('Ticket created:', { id: created.id, orderId: created.orderId, expiresAt: created.expiresAt });
  console.log('Token (keep private):', token);
  console.log('QR URL (public):', qrUrl);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
