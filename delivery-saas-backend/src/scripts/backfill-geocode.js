import { prisma } from '../prisma.js';
import { geocodeAddress } from '../utils/geocode.js';

/**
 * Backfill lat/lng for orders that have address text but no coordinates.
 * Uses store/company city as context for accurate geocoding.
 * Nominatim rate limit: 1 request/second.
 */
async function run() {
  // Pre-load store and company cities for context
  const stores = await prisma.store.findMany({ select: { id: true, city: true, state: true, companyId: true } });
  const companies = await prisma.company.findMany({ select: { id: true, city: true, state: true } });
  const storeCityMap = {};
  for (const s of stores) {
    storeCityMap[s.id] = s.city ? [s.city, s.state].filter(Boolean).join(', ') : null;
  }
  const companyCityMap = {};
  for (const c of companies) {
    companyCityMap[c.id] = c.city ? [c.city, c.state].filter(Boolean).join(', ') : null;
  }

  const orders = await prisma.order.findMany({
    where: { address: { not: null }, latitude: null },
    select: { id: true, address: true, customerId: true, deliveryNeighborhood: true, storeId: true, companyId: true },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });

  console.log(`Found ${orders.length} orders without coordinates`);

  let geocoded = 0;
  for (const order of orders) {
    const cityContext = (order.storeId && storeCityMap[order.storeId]) || companyCityMap[order.companyId] || null;
    const coords = await geocodeAddress(order.address, cityContext);

    if (coords) {
      await prisma.order.update({
        where: { id: order.id },
        data: { latitude: coords.lat, longitude: coords.lng },
      });
      geocoded++;
      console.log(`[${geocoded}/${orders.length}] Order ${order.id} -> ${coords.lat}, ${coords.lng} (ctx: ${cityContext || 'none'})`);

      if (order.customerId) {
        try {
          const addrs = await prisma.customerAddress.findMany({
            where: { customerId: order.customerId, latitude: null },
          });
          for (const addr of addrs) {
            const needle = (addr.neighborhood || '').toLowerCase();
            if (needle && order.address.toLowerCase().includes(needle)) {
              await prisma.customerAddress.update({
                where: { id: addr.id },
                data: { latitude: coords.lat, longitude: coords.lng },
              });
              console.log(`  -> Updated CustomerAddress ${addr.id}`);
              break;
            }
          }
        } catch (e) { /* skip */ }
      }
    } else {
      console.log(`[skip] Order ${order.id} — could not geocode: "${order.address.slice(0, 60)}..."`);
    }

    await new Promise(r => setTimeout(r, 1100));
  }

  console.log(`Done. Geocoded ${geocoded}/${orders.length} orders.`);
  process.exit(0);
}

run().catch(e => { console.error('Backfill failed:', e); process.exit(1); });
