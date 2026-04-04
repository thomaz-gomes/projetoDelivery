import { prisma } from '../prisma.js';

/**
 * Forward geocode an address string to lat/lng using Nominatim (OpenStreetMap).
 * Returns { lat, lng } or null if not found.
 */
export async function geocodeAddress(addressText) {
  if (!addressText || addressText.length < 5) return null;
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=br&q=${encodeURIComponent(addressText)}`;
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
 * Async geocode an order that has address but no coordinates.
 * Updates the order and optionally the customer's address record.
 * Fire-and-forget — never blocks order creation.
 */
export async function geocodeOrderIfNeeded(orderId) {
  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, address: true, latitude: true, longitude: true, customerId: true, deliveryNeighborhood: true },
    });
    if (!order || !order.address) return;
    if (order.latitude != null && order.longitude != null) return; // already has coordinates

    const coords = await geocodeAddress(order.address);
    if (!coords) return;

    // Update order with coordinates
    await prisma.order.update({
      where: { id: orderId },
      data: { latitude: coords.lat, longitude: coords.lng },
    });

    // Also update customer address if it exists and lacks coordinates
    if (order.customerId) {
      try {
        const customerAddresses = await prisma.customerAddress.findMany({
          where: { customerId: order.customerId, latitude: null },
        });
        for (const addr of customerAddresses) {
          // Match by neighborhood or partial address text
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

    console.log(`[geocode] Order ${orderId} geocoded: ${coords.lat}, ${coords.lng}`);
  } catch (e) {
    console.warn('[geocode] geocodeOrderIfNeeded failed:', e?.message || e);
  }
}
