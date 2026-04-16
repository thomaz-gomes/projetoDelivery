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

/**
 * Retorna true se as duas unidades pertencem à mesma família (weight/volume/unit)
 * ou forem idênticas. Valores vazios são considerados compatíveis (fallback na
 * unidade do ingrediente). Unidades desconhecidas retornam false.
 */
export function areUnitsCompatible(unitA, unitB) {
  const a = String(unitA || '').toUpperCase()
  const b = String(unitB || '').toUpperCase()
  if (!a || !b) return true
  if (a === b) return true
  if (!FAMILY[a] || !FAMILY[b]) return false
  return FAMILY[a] === FAMILY[b]
}

/** Retorna as unidades compatíveis com a unidade base do ingrediente. */
export function compatibleUnits(ingredientUnit) {
  const u = String(ingredientUnit || '').toUpperCase()
  if (!FAMILY[u]) return [u].filter(Boolean)
  const family = FAMILY[u]
  return Object.keys(FAMILY).filter(k => FAMILY[k] === family)
}

/**
 * Retorna a "granularidade preferida" para a unidade de um ingrediente
 * ao ser usado numa ficha técnica.
 *  KG → GR (mais comum em receitas)
 *  L  → ML
 *  demais → ela mesma
 */
export function preferredSheetUnit(ingredientUnit) {
  const u = String(ingredientUnit || '').toUpperCase()
  if (u === 'KG') return 'GR'
  if (u === 'L') return 'ML'
  return u
}
