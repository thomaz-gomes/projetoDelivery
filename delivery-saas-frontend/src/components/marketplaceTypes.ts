export type Coupon =
  | { type: 'fixed'; value: number } // R$
  | { type: 'percent'; value: number } // % as 0-100

export interface MarketplaceDTO {
  marketplaceFeePercent: number // 0-100
  paymentFeePercent: number // 0-100
  desiredMarginPercent: number // 0-100
  coupon: Coupon | null
  freeDelivery: boolean
  deliveryCostForRestaurant: number
  packagingCost: number
}

export interface ComputeResult {
  suggestedPrice: number | null
  marketplaceFeeAmount: number
  paymentFeeAmount: number
  couponAmount: number
  totalCostBase: number
  netProfit: number | null
  denominatorValid: boolean
  denominator: number
}

// Core calculation using Markup Divisor
export function computeSuggestedPrice(
  cmv: number,
  packagingCost: number,
  deliveryCostForRestaurant: number,
  marketplaceFeePercent: number,
  paymentFeePercent: number,
  desiredMarginPercent: number,
  coupon: Coupon | null
): ComputeResult {
  const toDecimal = (p: number) => p / 100

  const mkt = toDecimal(marketplaceFeePercent)
  const pay = toDecimal(paymentFeePercent)
  const margin = toDecimal(desiredMarginPercent)

  const couponPercent = coupon && coupon.type === 'percent' ? toDecimal(coupon.value) : 0
  const couponFixed = coupon && coupon.type === 'fixed' ? coupon.value : 0

  const totalCostBase = cmv + packagingCost + deliveryCostForRestaurant + couponFixed

  const denominator = 1 - (mkt + pay + margin + couponPercent)

  const denominatorValid = denominator > 0

  let suggestedPrice: number | null = null
  let mktAmt = 0
  let payAmt = 0
  let couponAmt = couponFixed
  let netProfit: number | null = null

  if (denominatorValid) {
    suggestedPrice = totalCostBase / denominator
    mktAmt = suggestedPrice * mkt
    payAmt = suggestedPrice * pay
    if (coupon && coupon.type === 'percent') couponAmt = suggestedPrice * couponPercent

    const totalFees = mktAmt + payAmt + couponAmt
    netProfit = suggestedPrice - (cmv + packagingCost + deliveryCostForRestaurant + totalFees)
  }

  return {
    suggestedPrice: suggestedPrice !== null ? round(suggestedPrice) : null,
    marketplaceFeeAmount: round(mktAmt),
    paymentFeeAmount: round(payAmt),
    couponAmount: round(couponAmt),
    totalCostBase: round(totalCostBase),
    netProfit: netProfit !== null ? round(netProfit) : null,
    denominatorValid,
    denominator
  }
}

function round(v: number) {
  return Math.round((v + Number.EPSILON) * 100) / 100
}

export function mapToDTO(state: Partial<MarketplaceDTO>): MarketplaceDTO {
  return {
    marketplaceFeePercent: state.marketplaceFeePercent ?? 0,
    paymentFeePercent: state.paymentFeePercent ?? 0,
    desiredMarginPercent: state.desiredMarginPercent ?? 0,
    coupon: state.coupon ?? null,
    freeDelivery: state.freeDelivery ?? false,
    deliveryCostForRestaurant: state.deliveryCostForRestaurant ?? 0,
    packagingCost: state.packagingCost ?? 0
  }
}
