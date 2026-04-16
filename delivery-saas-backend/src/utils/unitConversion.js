/**
 * unitConversion.js — Conversão entre unidades de medida
 *
 * Converte quantidades entre unidades compatíveis (peso e volume).
 * Usado para calcular custo e deduções de estoque quando a unidade
 * da ficha técnica difere da unidade do ingrediente.
 *
 * Exemplo: ingrediente cadastrado em KG (avgCost = R$10/KG)
 *          ficha técnica usa 60 GR
 *          → converte 60 GR para 0.06 KG antes de multiplicar pelo custo
 */

// Fatores de conversão para a unidade base de cada família
// Peso: base = GR | Volume: base = ML
const TO_BASE = {
  GR: 1,
  KG: 1000,
  ML: 1,
  L:  1000,
  UN: 1,
}

// Famílias de unidades compatíveis
const FAMILY = {
  GR: 'weight',
  KG: 'weight',
  ML: 'volume',
  L:  'volume',
  UN: 'unit',
}

/**
 * Converte uma quantidade de uma unidade para outra.
 * Se as unidades são incompatíveis (ex: KG → ML), retorna a quantidade original sem converter.
 *
 * @param {number} quantity  - quantidade na unidade de origem
 * @param {string} fromUnit  - unidade de origem (GR, KG, ML, L, UN)
 * @param {string} toUnit    - unidade de destino (GR, KG, ML, L, UN)
 * @returns {number} quantidade convertida
 */
export function convertUnit(quantity, fromUnit, toUnit) {
  const from = String(fromUnit || '').toUpperCase()
  const to = String(toUnit || '').toUpperCase()

  // Mesma unidade ou unidades não reconhecidas → sem conversão
  if (from === to) return quantity
  if (!TO_BASE[from] || !TO_BASE[to]) return quantity

  // Famílias incompatíveis → sem conversão
  if (FAMILY[from] !== FAMILY[to]) return quantity

  // UN não converte
  if (from === 'UN' || to === 'UN') return quantity

  // Converter: origem → base → destino
  const inBase = quantity * TO_BASE[from]
  return inBase / TO_BASE[to]
}

/**
 * Calcula a quantidade normalizada para a unidade do ingrediente.
 * Usado para custo e dedução de estoque.
 *
 * @param {number} quantity     - quantidade na ficha técnica
 * @param {string|null} itemUnit      - unidade usada na ficha (pode ser null)
 * @param {string} ingredientUnit     - unidade do ingrediente cadastrado
 * @returns {number} quantidade na unidade do ingrediente
 */
export function normalizeToIngredientUnit(quantity, itemUnit, ingredientUnit) {
  if (!itemUnit || itemUnit === ingredientUnit) return quantity
  return convertUnit(quantity, itemUnit, ingredientUnit)
}

/**
 * Verifica se duas unidades são da mesma família (peso, volume ou unidade).
 * Unidade vazia/nula é considerada compatível (cai para a unidade do ingrediente).
 *
 * @param {string|null|undefined} unitA
 * @param {string|null|undefined} unitB
 * @returns {boolean}
 */
export function areUnitsCompatible(unitA, unitB) {
  const a = String(unitA || '').toUpperCase()
  const b = String(unitB || '').toUpperCase()
  if (!a || !b) return true // empty = use ingredient's unit, always ok
  if (a === b) return true
  const familyA = FAMILY[a]
  const familyB = FAMILY[b]
  if (!familyA || !familyB) return false
  return familyA === familyB
}

/**
 * Lança erro 400 se as unidades não forem compatíveis.
 * Use antes de persistir TechnicalSheetItem / CompositeIngredientItem para
 * impedir salvar UN em ingrediente KG (ou similar), o que causaria corrupção
 * de custo e estoque.
 *
 * @param {string|null|undefined} itemUnit      - unidade informada pelo usuário
 * @param {string} ingredientUnit               - unidade cadastrada no ingrediente
 * @throws {Error} com `status=400` e `code='UNIT_INCOMPATIBLE'`
 */
export function assertCompatibleUnit(itemUnit, ingredientUnit) {
  if (!areUnitsCompatible(itemUnit, ingredientUnit)) {
    const err = new Error(`Unidade incompatível: ${itemUnit} não converte para ${ingredientUnit}`)
    err.status = 400
    err.code = 'UNIT_INCOMPATIBLE'
    throw err
  }
}
