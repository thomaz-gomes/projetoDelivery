// Shared utilities for normalizing order payloads used by multiple views/components
export function normalizeOrderItems(o){
  if(!o) return [];
  // Prefer iFood rich items from payload.order.items (has subitems/observations)
  // Fall back to DB items (o.items) which have simpler shape but already include notes
  const rawItems = o.payload?.order?.items || o.items || o.payload?.items || o.payload?.orderItems || o.orderItems || [];
  const arr = Array.isArray(rawItems) ? rawItems : [];
  return arr.map(it => {
    const qty = Number(it.quantity || it.qty || it.q || 1) || 1;
    const unitPrice = (Number(it.unitPrice || it.unit_price || it.price || 0) || 0) || (Number(it.total || it.amount || 0) ? Number(it.total || it.amount || 0) / qty : 0);
    const name = it.name || it.title || it.productName || (it.product && it.product.name) || '';
    // subitems: iFood uses "subitems" for combo sub-items/garnish (additions/removals)
    const subitems = (it.subitems || it.garnishItems || it.garnishes || []).map(s => ({
      name: s.name || s.description || '',
      quantity: Number(s.quantity || 1),
      price: Number(s.unitPrice || s.price || s.totalPrice || 0),
    }));
    const options = [...(it.options || it.addons || []), ...subitems];
    return {
      id: it.id || it.productId || it.product_id || null,
      name,
      quantity: qty,
      unitPrice,
      options,
      notes: it.notes || it.observations || it.note || null,
    }
  })
}

export default { normalizeOrderItems };
