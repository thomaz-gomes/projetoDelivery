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
 * Detecta se o pedido foi pago de forma online/prepaga (gateway iFood, PIX
 * online, link de pagamento). Nesses casos a `additionalFees` é retida pelo
 * marketplace antes do repasse. Em pagamentos "cobrar do cliente"
 * (dinheiro/cartão na entrega), o cliente paga o total cheio ao motoboy e a
 * loja recebe inclusive a taxa de serviço — não devemos descontar.
 */
function isPrepaidOrOnlineOrder(order) {
  if (!order) return false;
  const pl = order.payload || {};
  if (pl?.payments?.prepaid === true) return true;
  if (pl?.order?.payments?.prepaid === true) return true;
  if (pl?.payment?.prepaid === true) return true;
  if (pl?.payment?.isOnline === true) return true;
  const checkOne = (p) => {
    if (!p || typeof p !== 'object') return false;
    if (p.prepaid === true || p.isOnline === true) return true;
    const raw = String(p.method || p.methodCode || p.name || '').toLowerCase();
    if (raw === 'online' || raw.startsWith('online')) return true;
    if (raw === 'prepaid' || raw === 'prepago') return true;
    if (typeof p.paymentType === 'string' && p.paymentType.toUpperCase().includes('PREPAID')) return true;
    return false;
  };
  if (checkOne(order.payment)) return true;
  if (checkOne(pl.payment)) return true;
  const methods = pl?.order?.payments?.methods || pl?.payments?.methods;
  if (Array.isArray(methods) && methods.some(checkOne)) return true;
  return false;
}

/**
 * Calcula o total real faturado pela loja.
 * total (o que o cliente pagou) + discountIfood (o que o marketplace repassa).
 * Subtrai `additionalFees` (taxa de serviço retida pelo iFood) APENAS quando
 * o pagamento é online/prepaid — pra cash-on-delivery o cliente paga o total
 * cheio ao motoboy, então a loja recebe a taxa também.
 * O desconto da loja (discountMerchant) NÃO entra — a loja absorve.
 */
export function storeRevenue(order) {
  const v = splitVoucherDiscounts(order);
  const orderTotal = Number(order?.total || 0);
  const addFees = Number(order?.additionalFees || 0);
  const feeDeduction = isPrepaidOrOnlineOrder(order) ? addFees : 0;
  return orderTotal + v.discountIfood - feeDeduction;
}

/**
 * Calcula o troco que o entregador deve devolver ao cliente.
 * `changeFor` (= paymentChange) é o valor com que o cliente vai pagar
 * (ex.: cliente paga com R$ 50 num pedido de R$ 38).
 * Troco devido = changeFor − total. Retorna 0 se não houver troco.
 */
export function changeDue(order) {
  if (!order) return 0
  const total = Number(order.total || 0)
  let changeFor = 0
  const pickChange = (o) => Number(o?.changeFor ?? o?.change_for ?? o?.change ?? 0) || 0
  // Try several payload shapes (mirrors Orders.vue normalizeOrder logic)
  changeFor = pickChange(order.payment)
    || pickChange(order.payload?.payment)
    || pickChange(order.payload?.payments?.[0])
  // iFood: payments.methods[].changeFor (cash method)
  if (!changeFor) {
    const methods = order.payload?.order?.payments?.methods
      || order.payload?.payments?.methods
    if (Array.isArray(methods)) {
      const cashMethod = methods.find(m => {
        const s = String(m?.method || m?.type || '').toLowerCase()
        return s.includes('cash') || s.includes('dinheiro')
      })
      if (cashMethod?.changeFor) changeFor = Number(cashMethod.changeFor) || 0
    }
  }
  const diff = changeFor - total
  return diff > 0 ? Math.round(diff * 100) / 100 : 0
}

export default { normalizeOrderItems, splitVoucherDiscounts, storeRevenue, changeDue };
