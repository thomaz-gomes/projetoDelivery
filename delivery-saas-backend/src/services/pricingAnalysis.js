export function computePricingAnalysis({ currentPrice, sheetCost, productPackagingCost, productTargetMargin, storeDefaults }) {
  const C = Number(sheetCost || 0);
  const E = Number(productPackagingCost ?? storeDefaults.defaultPackagingCost ?? 0);
  const M = Number(productTargetMargin ?? storeDefaults.targetMarginPercent ?? 0);
  const taxes = {
    salesTax: Number(storeDefaults.salesTaxPercent || 0),
    otherFees: Number(storeDefaults.otherFeesPercent || 0),
    marketplaceFee: Number(storeDefaults.marketplaceFeePercent || 0),
    cardFee: Number(storeDefaults.cardFeePercent || 0),
  };
  const totalDeductionPct = taxes.salesTax + taxes.otherFees + taxes.marketplaceFee + taxes.cardFee;
  const denom = 1 - (totalDeductionPct + M) / 100;
  const suggestedPrice = denom > 0 ? (C + E) / denom : null;
  const price = Number(currentPrice || 0);
  const cmvPercent = price > 0 ? (C / price) * 100 : null;
  const min = Number(storeDefaults.cmvHealthyMin || 0);
  const max = Number(storeDefaults.cmvHealthyMax || 0);
  const crit = Number(storeDefaults.cmvCriticalAbove || 0);
  let cmvStatus = 'unknown';
  if (cmvPercent != null) {
    if (cmvPercent > crit) cmvStatus = 'critical';
    else if (cmvPercent > max) cmvStatus = 'warning';
    else if (cmvPercent >= min) cmvStatus = 'healthy';
    else cmvStatus = 'over_priced';
  }
  const actualMarginPercent = price > 0 ? ((price - C - E) / price) * 100 - totalDeductionPct : null;
  return {
    currentPrice: price,
    sheetCost: C,
    packagingCost: E,
    taxBreakdown: { ...taxes, totalDeductionPct },
    targetMarginPercent: M,
    suggestedPrice,
    delta: suggestedPrice != null && price ? price - suggestedPrice : null,
    cmvPercent,
    cmvStatus,
    actualMarginPercent,
  };
}
