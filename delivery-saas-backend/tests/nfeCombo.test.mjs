import { test } from 'node:test'
import assert from 'node:assert/strict'
import { expandOrderItemsToDet } from '../src/services/nfeExpansion.js'

test('expandOrderItemsToDet: combo expande slots com rateio e suprime guarda-chuva', () => {
  const orderItems = [{
    id: 'oi1',
    productId: 'p-combo',
    name: 'Combo X',
    quantity: 1,
    price: 40,
    options: [
      { kind: 'combo_slot', productId: 'p-lanche', name: 'X-Tudo', vUnComDeclarado: 25 },
      { kind: 'combo_slot', productId: 'p-bebida', name: 'Coca lata', vUnComDeclarado: 7 },
      { kind: 'combo_slot', productId: 'p-batata', name: 'Batata G', vUnComDeclarado: 11 },
      { kind: 'addon', name: 'Molho extra', price: 3 },
    ],
  }]
  const productMap = new Map([
    ['p-combo',  { id: 'p-combo',  isCombo: true,  dadosFiscais: null }],
    ['p-lanche', { id: 'p-lanche', dadosFiscais: { ncm: '21069090', cfops: '[{"code":"5102"}]' } }],
    ['p-bebida', { id: 'p-bebida', dadosFiscais: { ncm: '22021000', cfops: '[{"code":"5405"}]' } }],
    ['p-batata', { id: 'p-batata', dadosFiscais: null }],
  ])
  const det = expandOrderItemsToDet(orderItems, productMap)
  // Espera: 3 slots + 1 addon, total = 43 (40 do combo + 3 do addon)
  assert.equal(det.length, 4)
  const total = det.reduce((s, d) => s + Number(d.prod.vProd), 0)
  assert.equal(Math.round(total * 100) / 100, 43)
  // NCM do lanche vem do dadosFiscais do linkedProduct
  assert.equal(det[0].prod.NCM, '21069090')
})

test('expandOrderItemsToDet: produto comum (não-combo) passa direto', () => {
  const orderItems = [{
    id: 'oi2',
    productId: 'p-x',
    name: 'Produto X',
    quantity: 2,
    price: 10,
    options: [],
  }]
  const productMap = new Map([['p-x', { id: 'p-x', isCombo: false, dadosFiscais: null }]])
  const det = expandOrderItemsToDet(orderItems, productMap)
  assert.equal(det.length, 1)
  assert.equal(Number(det[0].prod.vProd), 20)
})
