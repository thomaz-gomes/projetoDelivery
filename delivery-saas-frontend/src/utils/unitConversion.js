/**
 * unitConversion.js — Conversão entre unidades de medida
 *
 * Converte quantidades entre unidades compatíveis (peso e volume).
 * Exemplo: ingrediente em KG, ficha usa 60 GR → converte para 0.06 KG
 */

const TO_BASE = { GR: 1, KG: 1000, ML: 1, L: 1000, UN: 1 }
const FAMILY  = { GR: 'weight', KG: 'weight', ML: 'volume', L: 'volume', UN: 'unit' }

export function convertUnit(quantity, fromUnit, toUnit) {
  const from = String(fromUnit || '').toUpperCase()
  const to = String(toUnit || '').toUpperCase()
  if (from === to || !TO_BASE[from] || !TO_BASE[to]) return quantity
  if (FAMILY[from] !== FAMILY[to]) return quantity
  if (from === 'UN' || to === 'UN') return quantity
  return (quantity * TO_BASE[from]) / TO_BASE[to]
}

/**
 * Retorna a quantidade normalizada para a unidade do ingrediente.
 * @param {number} quantity - quantidade na ficha
 * @param {string|null} itemUnit - unidade da ficha (pode ser null)
 * @param {string} ingredientUnit - unidade do ingrediente
 */
export function normalizeToIngredientUnit(quantity, itemUnit, ingredientUnit) {
  if (!itemUnit || itemUnit === ingredientUnit) return quantity
  return convertUnit(quantity, itemUnit, ingredientUnit)
}
