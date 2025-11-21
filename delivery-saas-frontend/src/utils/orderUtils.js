// Shared utilities for normalizing order payloads used by multiple views/components
export function normalizeOrderItems(o){
  if(!o) return [];
  const rawItems = o.items || o.payload?.items || o.payload?.orderItems || o.orderItems || [];
  const arr = Array.isArray(rawItems) ? rawItems : [];
  return arr.map(it => {
    const qty = Number(it.quantity || it.qty || it.q || 1) || 1;
    const unitPrice = (Number(it.unitPrice || it.unit_price || it.price || 0) || 0) || (Number(it.total || it.amount || 0) ? Number(it.total || it.amount || 0) / qty : 0);
    const name = it.name || it.title || it.productName || (it.product && it.product.name) || '';
    return {
      id: it.id || it.productId || it.product_id || null,
      name,
      quantity: qty,
      unitPrice,
      options: it.options || it.addons || []
    }
  })
}

export default { normalizeOrderItems };
