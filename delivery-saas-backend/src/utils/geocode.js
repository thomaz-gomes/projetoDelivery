import { prisma } from '../prisma.js';

/**
 * Forward geocode using Nominatim structured query for precision.
 * @param {string} addressText - Full address string (street, number, neighborhood)
 * @param {{ city?: string, state?: string }} [context] - City/state for disambiguation
 * Returns { lat, lng } or null if not found.
 */
export async function geocodeAddress(addressText, context = null) {
  if (!addressText || addressText.length < 5) return null;

  // Parse city/state from context (can be string "City, ST" or object { city, state })
  let city = null, state = null;
  if (context && typeof context === 'object') {
    city = context.city;
    state = context.state;
  } else if (typeof context === 'string' && context.includes(',')) {
    const parts = context.split(',').map(s => s.trim());
    city = parts[0];
    state = parts[1];
  }

  // Extract neighborhood from address patterns like "Street, 123 - Bairro" or "Street, 123, Bairro"
  function extractNeighborhood(addr) {
    // Pattern: "... - Bairro, Cidade" or "... - Bairro"
    const dashMatch = addr.match(/[-–]\s*([^,]+)/);
    if (dashMatch) return dashMatch[1].trim();
    // Pattern: "Street, Number, Bairro" (3rd comma-separated part)
    const parts = addr.split(',').map(s => s.trim());
    if (parts.length >= 3) return parts[2];
    return null;
  }

  async function nominatimSearch(params) {
    try {
      const url = `https://nominatim.openstreetmap.org/search?${params}`;
      const resp = await fetch(url, {
        headers: { 'User-Agent': 'DeliveryWL/1.0' },
        signal: AbortSignal.timeout(5000),
      });
      const results = await resp.json();
      if (results && results.length > 0) {
        return { lat: parseFloat(results[0].lat), lng: parseFloat(results[0].lon) };
      }
    } catch (e) {
      console.warn('[geocode] nominatim error:', e?.message || e);
    }
    return null;
  }

  // Strategy 1: Structured query (most precise — street + city)
  if (city) {
    const params = new URLSearchParams({
      format: 'json', limit: '1', countrycodes: 'br',
      street: addressText.split(',')[0].trim(),
      city: city,
    });
    if (state) params.set('state', state);
    const r = await nominatimSearch(params);
    if (r) return r;
  }

  // Strategy 2: Free-form with city appended
  {
    const query = city ? `${addressText}, ${city}, ${state || 'Brasil'}` : addressText;
    const params = new URLSearchParams({ format: 'json', limit: '1', countrycodes: 'br', q: query });
    const r = await nominatimSearch(params);
    if (r) return r;
  }

  // Strategy 3: Neighborhood + city fallback (when street not found in Nominatim)
  if (city) {
    const neighborhood = extractNeighborhood(addressText);
    if (neighborhood) {
      const query = `${neighborhood}, ${city}, ${state || 'Brasil'}`;
      const params = new URLSearchParams({ format: 'json', limit: '1', countrycodes: 'br', q: query });
      const r = await nominatimSearch(params);
      if (r) return r;
    }
  }

  // Strategy 4: City-level fallback (last resort — at least pin is in the right city)
  if (city) {
    const query = `${city}, ${state || 'Brasil'}`;
    const params = new URLSearchParams({ format: 'json', limit: '1', countrycodes: 'br', q: query });
    const r = await nominatimSearch(params);
    if (r) return r;
  }

  return null;
}

/**
 * Resolve city/state context from the store linked to an order.
 * Returns { city, state } object or null.
 */
async function resolveStoreCity(order) {
  try {
    if (order.storeId) {
      const store = await prisma.store.findUnique({
        where: { id: order.storeId },
        select: { city: true, state: true },
      });
      if (store?.city) return { city: store.city, state: store.state };
    }
    if (order.companyId) {
      const company = await prisma.company.findUnique({
        where: { id: order.companyId },
        select: { city: true, state: true },
      });
      if (company?.city) return { city: company.city, state: company.state };
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
