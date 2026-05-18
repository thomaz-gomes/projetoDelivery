import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildDanfeText } from '../src/utils/danfeText.js'

// XML mínimo que a função extrai por regex
const fakeRawXml = `
<?xml version="1.0" encoding="UTF-8"?>
<nfeProc>
  <NFe><infNFe>
    <ide><nNF>123</nNF><serie>1</serie><tpAmb>2</tpAmb></ide>
  </infNFe></NFe>
  <protNFe><infProt>
    <chNFe>29260400000000000000000000000000000000000123</chNFe>
    <nProt>135250000123456</nProt>
    <dhRecbto>2026-05-04T21:30:15-03:00</dhRecbto>
  </infProt></protNFe>
</nfeProc>
`

function makeFixture(overrides = {}) {
  return {
    protocol: { rawXml: fakeRawXml, nProt: '135250000123456' },
    order: {
      total: 56.0,
      deliveryFee: 0,
      discount: 0,
      payload: { payment: { method: 'CREDIT_CARD' } },
      items: [
        { name: 'X-BURGUER ESPECIAL', quantity: 2, price: 25.0 },
        { name: 'COCA-COLA 350ML', quantity: 1, price: 6.0 },
      ],
      customer: null,
      customerName: null,
      store: { name: 'Loja Teste' },
      company: { name: 'Empresa Teste LTDA' },
      ...overrides.order,
    },
    fiscalConfig: { cnpj: '12345678000190', ie: '999999999', ...overrides.fiscalConfig },
    emitenteConfig: {
      xNome: 'Empresa Teste LTDA',
      enderEmit: { xLgr: 'Rua Teste', nro: '123', xMun: 'Salvador', UF: 'BA' },
      ...overrides.emitenteConfig,
    },
  }
}

test('DANFE — título da divisão II usa "DANFE NFC-e"', () => {
  const out = buildDanfeText(makeFixture())
  assert.match(out, /DANFE NFC-e/)
  assert.match(out, /Documento Auxiliar da Nota Fiscal/i)
  assert.match(out, /de Consumidor Eletronica/i)
})

test('DANFE — itens enumerados 001/002 com nome do produto', () => {
  const out = buildDanfeText(makeFixture())
  assert.match(out, /^001 X-BURGUER ESPECIAL/m)
  assert.match(out, /^002 COCA-COLA 350ML/m)
})

test('DANFE — segunda linha do item mostra "qty UN x R$ unit" e total à direita', () => {
  const out = buildDanfeText(makeFixture())
  // item 1: 2 UN x R$ 25,00 ... R$ 50,00
  assert.match(out, /2 UN\s+x R\$ 25,00.*R\$ 50,00/)
  // item 2: 1 UN x R$ 6,00 ... R$ 6,00
  assert.match(out, /1 UN\s+x R\$ 6,00.*R\$ 6,00/)
})

test('DANFE — bloco de totais tem "Subtotal" e "TOTAL"', () => {
  const out = buildDanfeText(makeFixture())
  assert.match(out, /Subtotal:/)
  assert.match(out, /^TOTAL:/m)
  assert.match(out, /R\$ 56,00/)
})

test('DANFE — linha "Desconto" agrega couponDiscount + discountMerchant', () => {
  const semDesc = buildDanfeText(makeFixture())
  assert.doesNotMatch(semDesc, /Desconto:/)

  // Apenas couponDiscount
  const comCupom = buildDanfeText(makeFixture({
    order: { couponDiscount: 6.0, total: 50.0 },
  }))
  assert.match(comCupom, /Desconto:/)
  assert.match(comCupom, /-\s*R\$ 6,00/)

  // Apenas discountMerchant
  const comMerchant = buildDanfeText(makeFixture({
    order: { discountMerchant: 4.0, total: 52.0 },
  }))
  assert.match(comMerchant, /Desconto:/)
  assert.match(comMerchant, /-\s*R\$ 4,00/)

  // Ambos somados
  const comAmbos = buildDanfeText(makeFixture({
    order: { couponDiscount: 6.0, discountMerchant: 4.0, total: 46.0 },
  }))
  assert.match(comAmbos, /-\s*R\$ 10,00/)
})

test('DANFE — linha "Acrescimo" aparece quando deliveryFee > 0', () => {
  const out = buildDanfeText(makeFixture({
    order: { deliveryFee: 5.0, total: 61.0 },
  }))
  assert.match(out, /Acrescimo:/)
  assert.match(out, /\+\s*R\$ 5,00/)
})

test('DANFE — linha "Troco" aparece quando changeFor > total', () => {
  // total=56,00, cliente entregou R$ 64,00 → troco = R$ 8,00
  const out = buildDanfeText(makeFixture({
    order: { payload: { payment: { method: 'CASH', changeFor: 64.0 } } },
  }))
  assert.match(out, /Troco:/)
  assert.match(out, /R\$ 8,00/)
})

test('DANFE — linha "Troco" omitida quando changeFor === total (sem troco)', () => {
  // total=56,00, cliente entregou R$ 56,00 → sem troco
  const out = buildDanfeText(makeFixture({
    order: { payload: { payment: { method: 'CASH', changeFor: 56.0 } } },
  }))
  assert.doesNotMatch(out, /Troco:/)
})

test('DANFE — usa vírgula decimal (pt-BR)', () => {
  const out = buildDanfeText(makeFixture())
  assert.match(out, /R\$ 50,00/)
  assert.doesNotMatch(out, /R\$50\.00/)
})

test('DANFE — texto de consulta MOC: "Consulte pela Chave de Acesso em"', () => {
  const out = buildDanfeText(makeFixture())
  assert.match(out, /Consulte pela Chave de Acesso em/)
  assert.doesNotMatch(out, /Consulte a NF-e pelo QR Code/)
})

test('DANFE — bloco do consumidor sem CPF: "CONSUMIDOR NAO IDENTIFICADO"', () => {
  const out = buildDanfeText(makeFixture())
  assert.match(out, /CONSUMIDOR NAO IDENTIFICADO/)
})

test('DANFE — bloco do consumidor com CPF formatado', () => {
  const out = buildDanfeText(makeFixture({
    order: { customer: { cpf: '12345678901', fullName: 'Joao da Silva' } },
  }))
  assert.match(out, /CONSUMIDOR CPF: 123\.456\.789-01/)
  assert.match(out, /Joao da Silva/)
})

test('DANFE — Pagamento: aceita label em portugues "Dinheiro" / "Crédito"', () => {
  const dinheiro = buildDanfeText(makeFixture({
    order: { payload: { payment: { method: 'Dinheiro' } } },
  }))
  assert.match(dinheiro, /Pagamento:.*Dinheiro/)

  const credito = buildDanfeText(makeFixture({
    order: { payload: { payment: { method: 'Crédito' } } },
  }))
  assert.match(credito, /Pagamento:.*Cartao Credito/)
})

test('DANFE — homologação imprime aviso obrigatório', () => {
  const out = buildDanfeText(makeFixture())
  assert.match(out, /HOMOLOGACAO - SEM VALOR FISCAL/)
})

test('DANFE — em produção (tpAmb=1) NÃO imprime aviso de homologação', () => {
  const fixture = makeFixture()
  fixture.protocol = { rawXml: fakeRawXml.replace('<tpAmb>2</tpAmb>', '<tpAmb>1</tpAmb>'), nProt: '135250000123456' }
  const outProd = buildDanfeText(fixture)
  assert.doesNotMatch(outProd, /HOMOLOGACAO/)
})

test('DANFE — chave de acesso em grupos de 4 dígitos', () => {
  const out = buildDanfeText(makeFixture())
  // A chave (44 dígitos) é formatada em grupos de 4 e pode quebrar em mais de
  // uma linha se exceder 48 cols. Verificamos os grupos do início + final.
  assert.match(out, /2926 0400 0000 0000/)
  assert.match(out, /0000 0123/)
})

test('DANFE — protocolo + NFC-e nº + série + emissão', () => {
  const out = buildDanfeText(makeFixture())
  assert.match(out, /Protocolo: 135250000123456/)
  assert.match(out, /NFC-e n[ro\.]* 123/)
  assert.match(out, /Serie 1/)
  assert.match(out, /Emissao:.*04\/05\/2026/)
})

test('DANFE — placeholder QR é preservado', () => {
  const out = buildDanfeText(makeFixture())
  assert.match(out, /\[QR:https:\/\/nfce-homologacao\.svrs\.rs\.gov\.br\/consulta\/consultaPublica\.jsp\?chave=29260400000000000000000000000000000000000123\]/)
})

test('DANFE — combo expande slots com label do slot e addons indentados', () => {
  const fixture = makeFixture({
    order: {
      total: 43,
      items: [{
        name: 'Combo X',
        quantity: 1,
        price: 40,
        productId: 'p-combo',
        _product: { isCombo: true },
        options: [
          { kind: 'combo_slot', slotName: 'Lanche', name: 'X-Tudo', vUnComDeclarado: 25 },
          { kind: 'combo_slot', slotName: 'Bebida', name: 'Coca', vUnComDeclarado: 7 },
          { kind: 'combo_slot', slotName: 'Acomp', name: 'Batata', vUnComDeclarado: 11 },
          { kind: 'addon', name: 'Molho extra', price: 3 },
        ],
      }],
    },
  })
  const out = buildDanfeText(fixture)
  assert.ok(out.includes('Combo X'), 'cupom deve conter "Combo X"')
  assert.ok(out.includes('Lanche'), 'cupom deve conter label "Lanche"')
  assert.ok(out.includes('X-Tudo'), 'cupom deve conter "X-Tudo"')
  assert.ok(out.includes('+ Molho extra'), 'cupom deve conter "+ Molho extra"')
})

test('DANFE — produto não-combo com guarda-chuva (basePrice <= 0,10) suprime linha principal', () => {
  const fixture = makeFixture({
    order: {
      total: 8,
      items: [{
        name: 'Refrigerantes',
        quantity: 1,
        price: 0.01,
        options: [
          { name: 'Coca lata', price: 5 },
          { name: 'Guarana lata', price: 3 },
        ],
      }],
    },
  })
  const out = buildDanfeText(fixture)
  // Linha principal "Refrigerantes" suprimida; options renderizadas como sub-linhas
  assert.ok(!/^001 Refrigerantes/m.test(out), 'linha principal "Refrigerantes" deve ser suprimida')
  assert.ok(out.includes('+ Coca lata'), 'cupom deve conter "+ Coca lata"')
  assert.ok(out.includes('+ Guarana lata'), 'cupom deve conter "+ Guarana lata"')
})

test('DANFE — produto não-combo com options pagas: linha principal + sub-linhas', () => {
  const fixture = makeFixture({
    order: {
      total: 18,
      items: [{
        name: 'X-Burguer',
        quantity: 1,
        price: 15,
        options: [
          { name: 'Bacon', price: 3 },
          { name: 'Sem cebola', price: 0 }, // free → skip
        ],
      }],
    },
  })
  const out = buildDanfeText(fixture)
  assert.match(out, /^001 X-Burguer/m, 'linha principal deve aparecer')
  assert.ok(out.includes('+ Bacon'), 'cupom deve conter "+ Bacon"')
  assert.ok(!out.includes('+ Sem cebola'), 'options gratuitas devem ser ignoradas')
})
