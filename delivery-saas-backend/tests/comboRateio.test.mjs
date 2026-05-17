import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rateioCombo } from '../src/utils/comboRateio.js'

test('rateioCombo: somaRef === precoCombo -> sem ajuste', () => {
  const result = rateioCombo({
    precoCombo: 40,
    slots: [
      { id: 'a', vUnComReferencia: 22 },
      { id: 'b', vUnComReferencia: 7 },
      { id: 'c', vUnComReferencia: 11 },
    ],
    quantity: 1,
  })
  assert.equal(result.length, 3)
  assert.equal(Number(result[0].vUnCom), 22)
  assert.equal(Number(result[1].vUnCom), 7)
  assert.equal(Number(result[2].vUnCom), 11)
  const total = result.reduce((s, r) => s + Number(r.vProd), 0)
  assert.equal(Math.round(total * 100) / 100, 40)
})

test('rateioCombo: somaRef > precoCombo -> comprime proporcional', () => {
  const result = rateioCombo({
    precoCombo: 40,
    slots: [
      { id: 'a', vUnComReferencia: 25 },
      { id: 'b', vUnComReferencia: 7 },
      { id: 'c', vUnComReferencia: 11 },
    ],
    quantity: 1,
  })
  const total = result.reduce((s, r) => s + Number(r.vProd), 0)
  assert.equal(Math.round(total * 100) / 100, 40)
})

test('rateioCombo: quantity > 1 -> mantém um item por componente com qCom = quantity', () => {
  const result = rateioCombo({
    precoCombo: 40,
    slots: [
      { id: 'a', vUnComReferencia: 22 },
      { id: 'b', vUnComReferencia: 7 },
      { id: 'c', vUnComReferencia: 11 },
    ],
    quantity: 3,
  })
  assert.equal(result.length, 3)
  for (const r of result) {
    assert.equal(Number(r.qCom), 3)
  }
  const total = result.reduce((s, r) => s + Number(r.vProd), 0)
  assert.equal(Math.round(total * 100) / 100, 120)
})

test('rateioCombo: diferença de centavos cai no último item', () => {
  const result = rateioCombo({
    precoCombo: 100,
    slots: [
      { id: 'a', vUnComReferencia: 33.33 },
      { id: 'b', vUnComReferencia: 33.33 },
      { id: 'c', vUnComReferencia: 33.34 },
    ],
    quantity: 1,
  })
  const total = result.reduce((s, r) => s + Number(r.vProd), 0)
  assert.equal(Math.round(total * 100) / 100, 100)
})

test('rateioCombo: somaRef === 0 -> throw', () => {
  assert.throws(() => rateioCombo({
    precoCombo: 40,
    slots: [{ id: 'a', vUnComReferencia: 0 }],
    quantity: 1,
  }), /somaRef.*zero/i)
})
