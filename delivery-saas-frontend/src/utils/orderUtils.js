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
      highlightOnSlip: !!it.highlightOnSlip,
    }
  })
}

/**
 * Separa descontos de voucher por sponsor (iFood vs Loja).
 * Retorna { discountIfood, discountMerchant, voucherPayments, storeDiscount }
 *
 * - discountIfood: valor que o iFood repassa à loja (entra no caixa como pagamento)
 * - discountMerchant: valor que a loja absorve (desconto real)
 * - voucherPayments: array de { label, value } para exibir como formas de pagamento
 * - storeDiscount: valor a mostrar como desconto no total (apenas loja)
 */
export function splitVoucherDiscounts(order) {
  const discIfood = Number(order?.discountIfood || 0);
  const discMerch = Number(order?.discountMerchant || 0);
  const couponTotal = Number(order?.couponDiscount || order?.discount || 0);
  const couponCode = order?.couponCode || '';

  // Se o backend já separou por sponsor
  if (discIfood > 0 || discMerch > 0) {
    const payments = [];
    if (discIfood > 0) payments.push({ label: 'Voucher iFood', value: discIfood });
    if (discMerch > 0) payments.push({ label: 'Voucher Loja', value: discMerch });
    return {
      discountIfood: discIfood,
      discountMerchant: discMerch,
      voucherPayments: payments,
      storeDiscount: discMerch,
    };
  }

  // Fallback: tentar separar via benefits no payload
  const pl = order?.payload || {};
  const ip = pl.order || pl;
  const benefits = ip.benefits || ip.discounts || pl.discounts || [];

  if (Array.isArray(benefits) && benefits.length > 0) {
    let ifVal = 0, merchVal = 0;
    for (const b of benefits) {
      if (Array.isArray(b.sponsorshipValues)) {
        for (const sv of b.sponsorshipValues) {
          const svVal = Number(sv.value || sv.amount || 0);
          const name = String(sv.name || '').toUpperCase();
          if (name === 'MERCHANT') merchVal += svVal;
          else if (svVal > 0) ifVal += svVal;
        }
      } else {
        // Sem sponsorshipValues: considerar como iFood (conservador)
        ifVal += Number(b.value || 0);
      }
    }
    if (ifVal > 0 || merchVal > 0) {
      const payments = [];
      if (ifVal > 0) payments.push({ label: 'Voucher iFood', value: ifVal });
      if (merchVal > 0) payments.push({ label: 'Voucher Loja', value: merchVal });
      return {
        discountIfood: ifVal,
        discountMerchant: merchVal,
        voucherPayments: payments,
        storeDiscount: merchVal,
      };
    }
  }

  // Fallback final: tudo como desconto da loja (comportamento legado)
  if (couponTotal > 0) {
    const label = couponCode ? `Voucher (${couponCode})` : 'Voucher Desconto';
    return {
      discountIfood: 0,
      discountMerchant: couponTotal,
      voucherPayments: [{ label, value: couponTotal }],
      storeDiscount: couponTotal,
    };
  }

  return { discountIfood: 0, discountMerchant: 0, voucherPayments: [], storeDiscount: 0 };
}

/**
 * Calcula o total real faturado pela loja.
 * total (o que o cliente pagou) + discountIfood (o que o marketplace repassa).
 * O desconto da loja (discountMerchant) NÃO entra — a loja absorve.
 */
export function storeRevenue(order) {
  const v = splitVoucherDiscounts(order);
  const orderTotal = Number(order?.total || 0);
  return orderTotal + v.discountIfood;
}

export default { normalizeOrderItems, splitVoucherDiscounts, storeRevenue };
