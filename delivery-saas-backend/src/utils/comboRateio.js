/**
 * Rateia o valor fiscal de cada componente do combo de forma proporcional
 * aos vUnComReferencia cadastrados, garantindo que a soma dos vProd seja
 * exatamente igual a precoCombo * quantity.
 *
 * @param {object} args
 * @param {number} args.precoCombo  Preço pago pelo cliente (unitário do combo)
 * @param {Array<{id: string, vUnComReferencia: number}>} args.slots
 * @param {number} args.quantity    Quantidade de combos
 * @returns {Array<{id, vUnCom, qCom, vProd}>}
 */
export function rateioCombo({ precoCombo, slots, quantity }) {
  if (!Array.isArray(slots) || slots.length === 0) {
    throw new Error('rateioCombo: slots vazio')
  }
  const somaRef = slots.reduce((s, sl) => s + Number(sl.vUnComReferencia || 0), 0)
  if (somaRef <= 0) {
    throw new Error('rateioCombo: somaRef zero ou negativa')
  }
  const fator = Number(precoCombo) / somaRef
  const qty = Number(quantity)

  // 1ª passada: cada slot recebe ref * fator com 4 casas
  const partial = slots.map((sl) => {
    const vUnCom = Math.round(Number(sl.vUnComReferencia) * fator * 10000) / 10000
    return {
      id: sl.id,
      vUnCom,
      qCom: qty,
      vProd: Math.round(vUnCom * qty * 100) / 100,
    }
  })

  // 2ª passada: diferença de arredondamento cai no último
  const target = Math.round(Number(precoCombo) * qty * 100) / 100
  const sum = partial.reduce((s, r) => s + r.vProd, 0)
  const diff = Math.round((target - sum) * 100) / 100
  if (diff !== 0) {
    const last = partial[partial.length - 1]
    last.vProd = Math.round((last.vProd + diff) * 100) / 100
    last.vUnCom = Math.round((last.vProd / qty) * 10000) / 10000
  }

  return partial
}
