import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildDanfeText } from '../src/utils/danfeText.js'

// XML mínimo que a função extrai por regex. A chave segue o layout SEFAZ —
// posições 22-24 são serie (001), 25-33 são nNF (000000123) — para que o
// template possa derivar esses valores via slice().
const fakeRawXml = `
<?xml version="1.0" encoding="UTF-8"?>
<nfeProc>
  <NFe><infNFe>
    <ide><nNF>123</nNF><serie>1</serie><tpAmb>2</tpAmb></ide>
  </infNFe></NFe>
  <protNFe><infProt>
    <chNFe>29260400000000000000650010000001231123456789</chNFe>
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

test('DANFE — cabeçalho dos itens com colunas (# Cod Descricao + Qtd x Vl Unit / Vl Total)', () => {
  const out = buildDanfeText(makeFixture())
  assert.match(out, /# Cod\s+Descricao/)
  assert.match(out, /Qtd x Vl Unit\s+Vl Total/)
})

test('DANFE — largura configurável via opts.cols (32 cols para 58mm)', () => {
  const out = buildDanfeText(makeFixture(), { cols: 32 })
  // URLs e o placeholder [QR:...] são longos demais para se ajustar a 32
  // colunas — confiamos no agente para fazer a quebra com _wordBreakSmart.
  for (const line of out.split('\n')) {
    if (/^https?:|^\[QR:/.test(line.trimStart())) continue
    assert.ok(line.length <= 32, `linha excedeu 32 cols (${line.length}): ${line}`)
  }
})

test('DANFE — itens enumerados com SKU padrão 123123 + nome do produto', () => {
  const out = buildDanfeText(makeFixture())
  assert.match(out, /^001 123123 X-BURGUER ESPECIAL/m)
  assert.match(out, /^002 123123 COCA-COLA 350ML/m)
})

test('DANFE — segunda linha do item mostra "qty UN x R$ unit" e total à direita', () => {
  const out = buildDanfeText(makeFixture())
  // item 1: 2 UN x R$ 25,00 ............... R$ 50,00
  assert.match(out, /2 UN\s+x R\$ 25,00.*R\$ 50,00/)
  // item 2: 1 UN x R$ 6,00 ............... R$ 6,00
  assert.match(out, /1 UN\s+x R\$ 6,00.*R\$ 6,00/)
})

test('DANFE — bloco de totais tem "QTD. TOTAL DE ITENS", "VALOR TOTAL R$" e "VALOR A PAGAR R$"', () => {
  const out = buildDanfeText(makeFixture())
  assert.match(out, /QTD\. TOTAL DE ITENS\s+002/)
  assert.match(out, /VALOR TOTAL R\$\s+56,00/)
  assert.match(out, /VALOR A PAGAR R\$\s+56,00/)
})

test('DANFE — linha "Descontos R$" agrega couponDiscount + discountMerchant', () => {
  const semDesc = buildDanfeText(makeFixture())
  assert.doesNotMatch(semDesc, /Descontos R\$/)

  // Apenas couponDiscount
  const comCupom = buildDanfeText(makeFixture({
    order: { couponDiscount: 6.0, total: 50.0 },
  }))
  assert.match(comCupom, /Descontos R\$\s+-\s+6,00/)

  // Apenas discountMerchant
  const comMerchant = buildDanfeText(makeFixture({
    order: { discountMerchant: 4.0, total: 52.0 },
  }))
  assert.match(comMerchant, /Descontos R\$\s+-\s+4,00/)

  // Ambos somados
  const comAmbos = buildDanfeText(makeFixture({
    order: { couponDiscount: 6.0, discountMerchant: 4.0, total: 46.0 },
  }))
  assert.match(comAmbos, /Descontos R\$\s+-\s+10,00/)
})

test('DANFE — linha "Acrescimos R$" aparece quando deliveryFee > 0', () => {
  const out = buildDanfeText(makeFixture({
    order: { deliveryFee: 5.0, total: 61.0 },
  }))
  assert.match(out, /Acrescimos R\$\s+\+\s+5,00/)
})

test('DANFE — bloco "FORMA DE PAGAMENTO" lista métodos e troco', () => {
  // total=56,00, cliente entregou R$ 64,00 → troco = R$ 8,00
  const out = buildDanfeText(makeFixture({
    order: { payload: { payment: { method: 'CASH', changeFor: 64.0 } } },
  }))
  assert.match(out, /FORMA DE PAGAMENTO\s+Valor Pago/)
  assert.match(out, /Dinheiro\s+56,00/)
  assert.match(out, /Troco\s+8,00/)
})

test('DANFE — linha "Troco" omitida quando changeFor === total (sem troco)', () => {
  // total=56,00, cliente entregou R$ 56,00 → sem troco
  const out = buildDanfeText(makeFixture({
    order: { payload: { payment: { method: 'CASH', changeFor: 56.0 } } },
  }))
  assert.doesNotMatch(out, /^Troco/m)
})

test('DANFE — usa vírgula decimal (pt-BR)', () => {
  const out = buildDanfeText(makeFixture())
  assert.match(out, /R\$ 50,00/)
  assert.doesNotMatch(out, /R\$50\.00/)
})

test('DANFE — texto de consulta MOC: "Consulte pela Chave de Acesso em"', () => {
  const out = buildDanfeText(makeFixture())
  assert.match(out, /Consulte pela Chave de Acesso em/)
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

test('DANFE — formas de pagamento aceitam label em portugues "Dinheiro" / "Crédito"', () => {
  const dinheiro = buildDanfeText(makeFixture({
    order: { payload: { payment: { method: 'Dinheiro' } } },
  }))
  assert.match(dinheiro, /Dinheiro\s+56,00/)

  const credito = buildDanfeText(makeFixture({
    order: { payload: { payment: { method: 'Crédito' } } },
  }))
  assert.match(credito, /Cartao Credito\s+56,00/)
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
  // uma linha se exceder 48 cols. Verificamos início + cauda da chave.
  assert.match(out, /2926 0400 0000 0000/)
  assert.match(out, /2345 6789/)
})

test('DANFE — bloco do protocolo de autorização + NFC-e nº + série + emissão', () => {
  const out = buildDanfeText(makeFixture())
  assert.match(out, /Protocolo de Autorizacao:/)
  assert.match(out, /135250000123456/)
  // serie/nNF agora vêm da chNFe (posições 22-24 e 25-33). Para a chave de
  // teste 29260400000000000000000000000000000000000123 → serie=0 nNF=123.
  // O template normaliza serie com padStart(3) e nNF com padStart(9).
  assert.match(out, /NFC-e n\.\s*0*123\s+Serie/)
  assert.match(out, /Emissao:.*04\/05\/2026/)
})

test('DANFE — placeholder QR preserva a URL de consulta SEFAZ-BA', () => {
  const out = buildDanfeText(makeFixture())
  // homologação usa hnfe.sefaz.ba.gov.br
  assert.match(out, /\[QR:http:\/\/hnfe\.sefaz\.ba\.gov\.br\/servicos\/nfce\/qrcode\.aspx\?p=29260400000000000000650010000001231123456789\]/)
})

test('DANFE — rodapé "Tributos Aproximados" (Lei 12.741 / IBPT)', () => {
  const out = buildDanfeText(makeFixture())
  assert.match(out, /Tributos Aproximados/)
  assert.match(out, /Federal/)
  assert.match(out, /Estadual/)
  assert.match(out, /Fonte: IBPT/)
})

test('DANFE — Taxa de entrega aparece no rodapé quando deliveryFee > 0', () => {
  const out = buildDanfeText(makeFixture({
    order: { deliveryFee: 5.99, total: 61.99 },
  }))
  assert.match(out, /Taxa de entrega: R\$ 5,99/)
})

test('DANFE — payload.payments[] (multi-pagamento) lista cada método separadamente', () => {
  const out = buildDanfeText(makeFixture({
    order: {
      total: 56.0,
      payload: {
        payments: [
          { method: 'PIX', amount: 30.0 },
          { method: 'CASH', amount: 26.0 },
        ],
      },
    },
  }))
  assert.match(out, /PIX\s+30,00/)
  assert.match(out, /Dinheiro\s+26,00/)
})

test('DANFE — combo expande slots com label do slot e addons como itens próprios', () => {
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
  // Slots de combo viram sub-linhas indentadas "    Lanche: X-Tudo" (sem preço).
  assert.match(out, /\s{4}Lanche: X-Tudo/, 'slot Lanche deve aparecer indentado')
  assert.match(out, /\s{4}Bebida: Coca/, 'slot Bebida deve aparecer indentado')
  // Addon entra como linha numerada própria.
  assert.ok(out.includes('Molho extra'), 'cupom deve conter o addon "Molho extra"')
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
  // Linha principal "Refrigerantes" suprimida; options entram como itens próprios.
  assert.ok(!/Refrigerantes/.test(out), 'linha principal "Refrigerantes" deve ser suprimida')
  assert.ok(out.includes('Coca lata'), 'cupom deve conter "Coca lata"')
  assert.ok(out.includes('Guarana lata'), 'cupom deve conter "Guarana lata"')
})

test('DANFE — produto não-combo com options pagas: linha principal + linhas das options', () => {
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
  // Formato atual: "001 <sku> X-Burguer" (sku é qualquer string)
  assert.match(out, /^001\s+\S+\s+X-Burguer/m, 'linha principal deve aparecer numerada')
  assert.ok(out.includes('Bacon'), 'cupom deve conter "Bacon"')
  assert.ok(!out.includes('Sem cebola'), 'options gratuitas devem ser ignoradas')
})
