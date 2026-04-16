// Unit conversion helpers for composite ingredients.
// Rules: GR<->KG (x1000), ML<->L (x1000), UN<->UN only.
//
// NOTE: `areUnitsCompatible` is re-exported from `utils/unitConversion.js`
// (single source of truth). The utils version treats empty/null unit as
// compatible (fallback to ingredient unit), which is the correct behavior.

export { areUnitsCompatible, assertCompatibleUnit } from '../utils/unitConversion.js';

const BASE_FACTORS = {
  GR: { base: 'MASS', factor: 1 },
  KG: { base: 'MASS', factor: 1000 },
  ML: { base: 'VOLUME', factor: 1 },
  L:  { base: 'VOLUME', factor: 1000 },
  UN: { base: 'UNIT', factor: 1 },
};

export function convertQuantity(quantity, fromUnit, toUnit) {
  if (quantity == null) return null;
  const from = BASE_FACTORS[fromUnit];
  const to = BASE_FACTORS[toUnit];
  if (!from || !to) return null;
  if (from.base !== to.base) return null;
  if (fromUnit === toUnit) return Number(quantity);
  return (Number(quantity) * from.factor) / to.factor;
}
