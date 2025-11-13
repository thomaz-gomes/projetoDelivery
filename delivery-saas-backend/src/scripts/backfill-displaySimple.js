import { prisma } from '../../prisma.js';

async function run() {
  console.log('Starting backfill of displaySimple for orders...');
  const companies = await prisma.company.findMany({ select: { id: true } });
  for (const c of companies) {
    console.log('Processing company', c.id);
    const orders = await prisma.order.findMany({ where: { companyId: c.id }, orderBy: { createdAt: 'asc' } });
    const map = new Map();
    for (const o of orders) {
      const d = new Date(o.createdAt || o.updatedAt || Date.now());
      const key = d.toISOString().slice(0, 10);
      const cur = map.get(key) || 0;
      const next = cur + 1;
      map.set(key, next);
      if (o.displaySimple == null) {
        try {
          await prisma.order.update({ where: { id: o.id }, data: { displaySimple: next } });
          console.log(`Updated order ${o.id} (${key}) -> ${next}`);
        } catch (e) {
          console.error('Failed to update order', o.id, e?.message || e);
        }
      }
    }
  }
  console.log('Backfill complete.');
  process.exit(0);
}

run().catch((e) => {
  console.error('Backfill failed:', e);
  process.exit(1);
});
