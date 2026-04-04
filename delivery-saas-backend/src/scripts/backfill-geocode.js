import { prisma } from '../prisma.js';
import { geocodeAddress } from '../utils/geocode.js';

/**
 * Backfill lat/lng for orders that have address text but no coordinates.
 * Uses Nominatim with 1s delay between requests to respect rate limits.
 */
async function run() {
  const orders = await prisma.order.findMany({
    where: {
      address: { not: null },
      latitude: null,
    },
    select: { id: true, address: true, customerId: true, deliveryNeighborhood: true },
    orderBy: { createdAt: 'desc' },
    take: 500, // batch size
  });

  console.log(`Found ${orders.length} orders without coordinates`);

  let geocoded = 0;
  for (const order of orders) {
    const coords = await geocodeAddress(order.address);
    if (coords) {
      await prisma.order.update({
        where: { id: order.id },
        data: { latitude: coords.lat, longitude: coords.lng },
      });
      geocoded++;
      console.log(`[${geocoded}/${orders.length}] Order ${order.id} -> ${coords.lat}, ${coords.lng}`);

      // Also update matching customer address
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

    // Nominatim rate limit: max 1 request/second
    await new Promise(r => setTimeout(r, 1100));
  }

  console.log(`Done. Geocoded ${geocoded}/${orders.length} orders.`);
  process.exit(0);
}

run().catch(e => { console.error('Backfill failed:', e); process.exit(1); });
