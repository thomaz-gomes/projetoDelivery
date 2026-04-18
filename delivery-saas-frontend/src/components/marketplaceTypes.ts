export type Coupon =
  | { type: 'fixed'; value: number } // R$
  | { type: 'percent'; value: number } // % as 0-100

export interface MarketplaceDTO {
  marketplaceFeePercent: number // 0-100
  paymentFeePercent: number // 0-100
  contributionMarginPercent: number // 0-100 (margem de contribuição)
  salesTaxPercent: number // 0-100
  otherFeesPercent: number // 0-100
  coupon: Coupon | null
  freeDelivery: boolean
  deliveryCostForRestaurant: number
  packagingCost: number
  // legacy compat
  desiredMarginPercent?: number
}

export interface ComputeResult {
  suggestedPrice: number | null
  marketplaceFeeAmount: number
  paymentFeeAmount: number
  salesTaxAmount: number
  otherFeesAmount: number
  couponAmount: number
  deliveryCostAmount: number
  totalDeductionPercent: number
  netProfit: number | null
  denominatorValid: boolean
  denominator: number
}

/**
 * Marketplace pricing based on store price (preço de balcão).
 *
 * Logic (same as iFood's own calculator):
 *   preço marketplace = preço balcão / (1 - total_deduções%)
 *
 * Where total deductions = marketplace fee + payment fee + sales tax + other fees + coupon%
 * The contribution margin is NOT added to deductions — it's the margin that should
 * be preserved after applying the markup.
 *
 * If the store doesn't have a store price yet, falls back to CMV-based calculation.
 */
export function computeMarketplacePrice(
  storePrice: number,
  cmv: number,
  packagingCost: number,
  deliveryCostForRestaurant: number,
  marketplaceFeePercent: number,
  paymentFeePercent: number,
  contributionMarginPercent: number,
  coupon: Coupon | null,
  salesTaxPercent: number = 0,
  otherFeesPercent: number = 0
): ComputeResult {
  const toDecimal = (p: number) => p / 100

  const mkt = toDecimal(marketplaceFeePercent)
  const pay = toDecimal(paymentFeePercent)
  const tax = toDecimal(salesTaxPercent)
  const other = toDecimal(otherFeesPercent)
  const couponPercent = coupon && coupon.type === 'percent' ? toDecimal(coupon.value) : 0
  const couponFixed = coupon && coupon.type === 'fixed' ? coupon.value : 0

  // Total percentage deductions on the marketplace price
  const totalDeductionPct = mkt + pay + tax + other + couponPercent

  // The denominator: what fraction of the price the restaurant keeps
  const denominator = 1 - totalDeductionPct

  const denominatorValid = denominator > 0

  let suggestedPrice: number | null = null
  let mktAmt = 0
  let payAmt = 0
  let taxAmt = 0
  let otherAmt = 0
  let couponAmt = couponFixed
  let netProfit: number | null = null

  if (denominatorValid && storePrice > 0) {
    // iFood approach: markup from store price to cover marketplace fees
    suggestedPrice = (storePrice + deliveryCostForRestaurant + couponFixed) / denominator
    mktAmt = suggestedPrice * mkt
    payAmt = suggestedPrice * pay
    taxAmt = suggestedPrice * tax
    otherAmt = suggestedPrice * other
    if (coupon && coupon.type === 'percent') couponAmt = suggestedPrice * couponPercent

    const totalCosts = cmv + packagingCost + deliveryCostForRestaurant + mktAmt + payAmt + taxAmt + otherAmt + couponAmt
    netProfit = suggestedPrice - totalCosts
  }

  return {
    suggestedPrice: suggestedPrice !== null ? round(suggestedPrice) : null,
    marketplaceFeeAmount: round(mktAmt),
    paymentFeeAmount: round(payAmt),
    salesTaxAmount: round(taxAmt),
    otherFeesAmount: round(otherAmt),
    couponAmount: round(couponAmt),
    deliveryCostAmount: round(deliveryCostForRestaurant),
    totalDeductionPercent: round(totalDeductionPct * 100),
    netProfit: netProfit !== null ? round(netProfit) : null,
    denominatorValid,
    denominator
  }
}

// Legacy compat alias
export function computeSuggestedPrice(
  cmv: number,
  packagingCost: number,
  deliveryCostForRestaurant: number,
  marketplaceFeePercent: number,
  paymentFeePercent: number,
  desiredMarginPercent: number,
  coupon: Coupon | null,
  salesTaxPercent: number = 0,
  otherFeesPercent: number = 0
): ComputeResult {
  // Fallback: use CMV-based when no store price available
  return computeMarketplacePrice(
    0, cmv, packagingCost, deliveryCostForRestaurant,
    marketplaceFeePercent, paymentFeePercent, desiredMarginPercent,
    coupon, salesTaxPercent, otherFeesPercent
  )
}

function round(v: number) {
  return Math.round((v + Number.EPSILON) * 100) / 100
}

export function mapToDTO(state: Partial<MarketplaceDTO>): MarketplaceDTO {
  return {
    marketplaceFeePercent: state.marketplaceFeePercent ?? 0,
    paymentFeePercent: state.paymentFeePercent ?? 0,
    contributionMarginPercent: state.contributionMarginPercent ?? state.desiredMarginPercent ?? 0,
    salesTaxPercent: state.salesTaxPercent ?? 0,
    otherFeesPercent: state.otherFeesPercent ?? 0,
    coupon: state.coupon ?? null,
    freeDelivery: state.freeDelivery ?? false,
    deliveryCostForRestaurant: state.deliveryCostForRestaurant ?? 0,
    packagingCost: state.packagingCost ?? 0
  }
}
