import { prisma } from '../prisma.js';

/**
 * Forward geocode an address string to lat/lng using Nominatim (OpenStreetMap).
 * @param {string} addressText - The address to geocode
 * @param {string} [cityContext] - City + state to append for disambiguation (e.g. "Itabuna, BA")
 * Returns { lat, lng } or null if not found.
 */
export async function geocodeAddress(addressText, cityContext = null) {
  if (!addressText || addressText.length < 5) return null;
  try {
    // Append city context to disambiguate common street names
    const query = cityContext ? `${addressText}, ${cityContext}` : addressText;
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=br&q=${encodeURIComponent(query)}`;
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'DeliveryWL/1.0' },
      signal: AbortSignal.timeout(5000),
    });
    const results = await resp.json();
    if (results && results.length > 0) {
      return {
        lat: parseFloat(results[0].lat),
        lng: parseFloat(results[0].lon),
      };
    }
  } catch (e) {
    console.warn('[geocode] forward geocode failed:', e?.message || e);
  }
  return null;
}

/**
 * Resolve city context from the store linked to an order.
 * Returns "City, STATE" string or null.
 */
async function resolveStoreCity(order) {
  try {
    // Try store directly
    if (order.storeId) {
      const store = await prisma.store.findUnique({
        where: { id: order.storeId },
        select: { city: true, state: true },
      });
      if (store?.city) return [store.city, store.state].filter(Boolean).join(', ');
    }
    // Fallback: company settings
    if (order.companyId) {
      const company = await prisma.company.findUnique({
        where: { id: order.companyId },
        select: { city: true, state: true },
      });
      if (company?.city) return [company.city, company.state].filter(Boolean).join(', ');
    }
  } catch (e) { /* non-blocking */ }
  return null;
}

/**
 * Async geocode an order that has address but no coordinates.
 * Uses the store's city as context to disambiguate common street names.
 * Fire-and-forget — never blocks order creation.
 */
export async function geocodeOrderIfNeeded(orderId) {
  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, address: true, latitude: true, longitude: true, customerId: true, deliveryNeighborhood: true, storeId: true, companyId: true },
    });
    if (!order || !order.address) return;
    if (order.latitude != null && order.longitude != null) return;

    const cityContext = await resolveStoreCity(order);
    const coords = await geocodeAddress(order.address, cityContext);
    if (!coords) return;

    await prisma.order.update({
      where: { id: orderId },
      data: { latitude: coords.lat, longitude: coords.lng },
    });

    // Also update customer address if it lacks coordinates
    if (order.customerId) {
      try {
        const customerAddresses = await prisma.customerAddress.findMany({
          where: { customerId: order.customerId, latitude: null },
        });
        for (const addr of customerAddresses) {
          const addrText = [addr.street, addr.number, addr.neighborhood].filter(Boolean).join(', ').toLowerCase();
          const orderAddr = order.address.toLowerCase();
          if (orderAddr.includes(addr.neighborhood?.toLowerCase() || '___') || addrText.includes(order.deliveryNeighborhood?.toLowerCase() || '___')) {
            await prisma.customerAddress.update({
              where: { id: addr.id },
              data: { latitude: coords.lat, longitude: coords.lng },
            });
            break;
          }
        }
      } catch (e) { /* non-blocking */ }
    }

    console.log(`[geocode] Order ${orderId} geocoded: ${coords.lat}, ${coords.lng} (city: ${cityContext || 'none'})`);
  } catch (e) {
    console.warn('[geocode] geocodeOrderIfNeeded failed:', e?.message || e);
  }
}
