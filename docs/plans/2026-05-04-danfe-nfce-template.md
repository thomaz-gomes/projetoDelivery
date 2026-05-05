# DANFE NFC-e Template Redesign — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Redesenhar o gerador de texto do DANFE NFC-e (`formatDanfeText`) para aderir ao padrão do MOC v6.0 (cabeçalho correto, tabela de itens em 2 linhas com #/UN/valor unit, bloco de totais expandido com desconto/troco, mensagem "Consulte pela Chave de Acesso em…", bloco de identificação do consumidor).

**Architecture:** Extrair a lógica de formatação pura para um módulo testável `src/utils/danfeText.js` com função `buildDanfeText(data)`. `agentPrint.js` mantém `formatDanfeText(orderId)` como orquestrador (carrega DB + chama a função pura). Tests usam `node:test` (mesmo framework dos demais tests do backend) sem precisar de DB.

**Tech Stack:** Node.js (ESM), `node:test`, Prisma (apenas no orquestrador). Sem novas dependências.

---

### Task 0: Branch já criada

Já estamos em `feat/danfe-nfce-template-redesign` (criada na fase de brainstorm, design comitado em `52ee3f9`). Verificar e seguir.

**Step 1: Confirmar branch e estado**

```bash
git branch --show-current
git log --oneline -3
```

Esperado: branch `feat/danfe-nfce-template-redesign`; topo de commit é `52ee3f9 docs(plan): design para redesenhar DANFE NFC-e ao padrão MOC v6.0`.

**Atenção a estado sujo pré-existente:** `delivery-saas-backend/nfe-module/dist/*.js` aparece com diff por causa de CRLF/LF no Windows — **não staga isso em nenhum commit deste plano**. Se aparecer no `git status`, é ruído de checkout.

---

### Task 1: Extrair `buildDanfeText` para módulo testável (refactor sem mudança de comportamento)

**Files:**
- Create: `delivery-saas-backend/src/utils/danfeText.js`
- Modify: `delivery-saas-backend/src/routes/agentPrint.js:115-243`
- Test: `delivery-saas-backend/tests/danfeText.test.mjs` (criado na Task 2 — só smoke aqui)

**Step 1: Ler o arquivo atual**

Read `delivery-saas-backend/src/routes/agentPrint.js` linhas 115-243 para reproduzir 100% da lógica atual no extracted module. Não mudar comportamento neste task — apenas mover.

**Step 2: Criar `src/utils/danfeText.js` com a lógica pura**

O módulo exporta `buildDanfeText(data)` onde `data` é exatamente:

```javascript
// data = { protocol, order, fiscalConfig, emitenteConfig }
// protocol: { rawXml, nProt }
// order:    { items, total, payload, ... } (igual ao retorno do prisma.order.findUnique com items)
// fiscalConfig: { cnpj, ie }
// emitenteConfig: { xNome, enderEmit }
```

Conteúdo do arquivo:

```javascript
'use strict'

/**
 * Gera o texto do DANFE NFC-e a partir dos dados do pedido + protocolo SEFAZ.
 * Função pura (sem I/O) para permitir testes sem DB.
 *
 * @param {object} data
 * @param {object} data.protocol      - { rawXml, nProt }
 * @param {object} data.order         - resultado de prisma.order.findUnique com `items`
 * @param {object} [data.fiscalConfig]- { cnpj, ie }
 * @param {object} [data.emitenteConfig] - { xNome, enderEmit: { xLgr, nro, xMun, UF } }
 * @returns {string} Texto multilinha pronto para impressão térmica (48 col).
 */
export function buildDanfeText(data) {
  const { protocol, order, fiscalConfig = {}, emitenteConfig = null } = data
  const rawXml = protocol?.rawXml || ''

  const extract = (tag, xml) => {
    const m = xml.match(new RegExp(`<${tag}[^>]*>([^<]+)</${tag}>`))
    return m ? m[1].trim() : ''
  }
  const chNFe = extract('chNFe', rawXml) || ''
  const dhRecbto = extract('dhRecbto', rawXml) || new Date().toISOString()
  const nProt = protocol?.nProt || extract('nProt', rawXml) || ''
  const nNF = extract('nNF', rawXml) || ''
  const serie = extract('serie', rawXml) || '1'
  const tpAmb = extract('tpAmb', rawXml) || '2'

  const enderEmit = (emitenteConfig && emitenteConfig.enderEmit) || {}
  const cnpj = fiscalConfig.cnpj || ''
  const cnpjFormatted = cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
  const ie = fiscalConfig.ie || 'ISENTO'
  const xNome = (emitenteConfig && emitenteConfig.xNome) || (order.store && order.store.name) || (order.company && order.company.name) || ''
  const xFant = (order.store && order.store.name) || xNome
  const logradouro = [enderEmit.xLgr, enderEmit.nro].filter(Boolean).join(', ')
  const municipio = [enderEmit.xMun, enderEmit.UF].filter(Boolean).join(' - ')

  const W = 48
  const sep = '-'.repeat(W)
  const dbl = '='.repeat(W)
  const center = (s) => { const sp = Math.max(0, W - s.length); return ' '.repeat(Math.floor(sp / 2)) + s }
  const ljust = (s, n) => { const str = String(s); return str.length >= n ? str.slice(0, n) : str + ' '.repeat(n - str.length) }
  const rjust = (s, n) => { const str = String(s); return str.length >= n ? str.slice(0, n) : ' '.repeat(n - str.length) + str }

  let emissaoStr = ''
  try {
    const d = new Date(dhRecbto)
    emissaoStr = d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  } catch {
    emissaoStr = dhRecbto
  }

  const lines = []
  lines.push(dbl)
  lines.push(center(xFant))
  if (cnpjFormatted) lines.push(center(`CNPJ: ${cnpjFormatted}`))
  if (xNome && xNome !== xFant) lines.push(center(xNome))
  if (logradouro) lines.push(center(logradouro))
  if (municipio) lines.push(center(municipio))
  lines.push(sep)
  lines.push(center('DOCUMENTO AUXILIAR DA NOTA'))
  lines.push(center('FISCAL DE CONSUMIDOR ELETRONICO'))
  lines.push(sep)
  if (tpAmb === '2') {
    lines.push(center('** HOMOLOGACAO - SEM VALOR FISCAL **'))
    lines.push(sep)
  }

  lines.push(ljust('DESCRICAO', 24) + rjust('QTD', 6) + rjust('TOTAL', 18))
  lines.push(sep)
  const items = order.items || []
  let totalItens = 0
  for (const it of items) {
    const qty = Number(it.quantity || 1)
    totalItens += qty
    const unit = Number(it.price || 0)
    const total = qty * unit
    const totalStr = `R$${total.toFixed(2)}`
    const qtyStr = `${qty}x`
    const nameWidth = W - qtyStr.length - totalStr.length - 2
    lines.push(ljust(it.name || '', nameWidth) + ' ' + qtyStr + ' ' + totalStr)
    if (qty > 1) lines.push(`  @ R$${unit.toFixed(2)}/un`)
  }
  lines.push(sep)

  const vNF = Number(order.total || 0)
  lines.push(ljust(`Qtd itens: ${totalItens}`, W - 20) + rjust(`TOTAL R$${vNF.toFixed(2)}`, 20))
  lines.push('')

  const TPAG_MAP = { '01': 'Dinheiro', '03': 'Cartao Credito', '04': 'Cartao Debito', '17': 'PIX', '99': 'Outros' }
  const PAYKEY_MAP = { CASH: '01', MONEY: '01', CREDIT_CARD: '03', DEBIT_CARD: '04', PIX: '17', VOUCHER: '05', ONLINE: '99' }
  const payRaw = (order.payload && order.payload.payment) || {}
  const payMethod = payRaw.methodCode || payRaw.method || payRaw.type || ''
  const tPagCode = PAYKEY_MAP[payMethod] || '99'
  const payDesc = TPAG_MAP[tPagCode] || payMethod || 'Outros'
  lines.push(ljust('Pagamento:', W - 20) + rjust(payDesc, 20))
  lines.push(sep)

  const consultaUrl = tpAmb === '1'
    ? 'https://nfce.svrs.rs.gov.br/consulta/consultaPublica.jsp'
    : 'https://nfce-homologacao.svrs.rs.gov.br/consulta/consultaPublica.jsp'
  const qrData = chNFe ? `${consultaUrl}?chave=${chNFe}` : consultaUrl
  lines.push(center('Consulte a NF-e pelo QR Code'))
  lines.push(`[QR:${qrData}]`)
  lines.push(sep)

  lines.push(center('CHAVE DE ACESSO'))
  const chaveFormatted = chNFe.replace(/(\d{4})(?=\d)/g, '$1 ')
  const chaveWords = chaveFormatted.split(' ')
  let cur = ''
  for (const w of chaveWords) {
    if (cur && (cur + ' ' + w).length > W) {
      lines.push(center(cur))
      cur = w
    } else {
      cur = cur ? cur + ' ' + w : w
    }
  }
  if (cur) lines.push(center(cur))
  lines.push(sep)

  lines.push(`Prot.: ${nProt}`)
  lines.push(`NFC-e n.${nNF} Serie: ${serie}`)
  lines.push(`Emissao: ${emissaoStr}`)
  lines.push(`I.E.: ${ie}`)
  lines.push(dbl)

  return lines.join('\n')
}
```

**Step 3: Modify `agentPrint.js` to call the new module**

Find the block at lines 115-243 (`async function formatDanfeText(orderId) { ... }`). Replace it with:

```javascript
import { buildDanfeText } from '../utils/danfeText.js'

// Generates a thermal-printer-friendly DANFE text for a given orderId.
// Loads order + protocol + fiscal/emitente config from DB/disk and delegates
// the formatting to the pure helper in src/utils/danfeText.js (testable).
async function formatDanfeText(orderId) {
  const protocol = await prisma.nfeProtocol.findFirst({ where: { orderId }, orderBy: { createdAt: 'desc' } })
  if (!protocol) throw new Error(`NF-e não emitida para o pedido ${orderId}`)

  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { items: true, store: true, company: true } })
  if (!order) throw new Error(`Pedido não encontrado: ${orderId}`)

  let fiscalConfig = {}
  let emitenteConfig = null
  try {
    const nfeSvc = await import('../services/nfe.js')
    fiscalConfig = await nfeSvc.getFiscalConfigForOrder(orderId).catch(() => ({}))
    emitenteConfig = order.storeId
      ? nfeSvc.getEmitenteConfig(order.companyId, order.storeId)
      : nfeSvc.getEmitenteConfig(order.companyId)
  } catch (e) {
    console.warn('formatDanfeText: failed to load fiscal config:', e && e.message)
  }

  return buildDanfeText({ protocol, order, fiscalConfig, emitenteConfig })
}
```

The `import { buildDanfeText }` goes near the top of the file with other imports (after the existing `import` lines). The function body shrinks from ~125 lines to ~25.

**Step 4: Verificar parsing**

```bash
cd delivery-saas-backend && node --check src/utils/danfeText.js && node --check src/routes/agentPrint.js
```

Esperado: ambos passam (sem stdout).

**Step 5: Commit**

```bash
git add delivery-saas-backend/src/utils/danfeText.js delivery-saas-backend/src/routes/agentPrint.js
git commit -m "refactor(danfe): extrair buildDanfeText para módulo testável

Sem mudança de comportamento — apenas move a lógica de formatação
para src/utils/danfeText.js, abrindo caminho para testes sem DB."
```

---

### Task 2: Tests TDD para o novo layout MOC v6.0

**Files:**
- Create: `delivery-saas-backend/tests/danfeText.test.mjs`

**Step 1: Criar fixture de dados de teste**

No topo do arquivo:

```javascript
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
```

**Step 2: Escrever testes FALHOS — eles descrevem o novo layout**

Adicionar ao mesmo arquivo:

```javascript
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

test('DANFE — linha "Desconto" só aparece quando discount > 0', () => {
  const semDesc = buildDanfeText(makeFixture())
  assert.doesNotMatch(semDesc, /Desconto:/)

  const comDesc = buildDanfeText(makeFixture({
    order: { discount: 6.0, total: 50.0 },
  }))
  assert.match(comDesc, /Desconto:/)
  assert.match(comDesc, /-\s*R\$ 6,00/)
})

test('DANFE — linha "Acrescimo" aparece quando deliveryFee > 0', () => {
  const out = buildDanfeText(makeFixture({
    order: { deliveryFee: 5.0, total: 61.0 },
  }))
  assert.match(out, /Acrescimo:/)
  assert.match(out, /\+\s*R\$ 5,00/)
})

test('DANFE — linha "Troco" aparece quando troco > 0', () => {
  const out = buildDanfeText(makeFixture({
    order: { payload: { payment: { method: 'CASH', change: 8.0 } } },
  }))
  assert.match(out, /Troco:/)
  assert.match(out, /R\$ 8,00/)
})

test('DANFE — usa vírgula decimal (pt-BR)', () => {
  const out = buildDanfeText(makeFixture())
  assert.match(out, /R\$ 50,00/)        // não R$50.00
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

test('DANFE — homologação imprime aviso obrigatório', () => {
  const out = buildDanfeText(makeFixture())
  assert.match(out, /HOMOLOGACAO - SEM VALOR FISCAL/)
})

test('DANFE — em produção (tpAmb=1) NÃO imprime aviso de homologação', () => {
  const prodXml = fakeRawXml.replace('<tpAmb>2</tpAmb>', '<tpAmb>1</tpAmb>')
  const out = buildDanfeText(makeFixture({ order: {} })) // overrides sobre order, mas precisamos sobrescrever protocol
  // Ajustar: criar fixture diretamente
  const fixture = makeFixture()
  fixture.protocol = { rawXml: prodXml, nProt: '135250000123456' }
  const outProd = buildDanfeText(fixture)
  assert.doesNotMatch(outProd, /HOMOLOGACAO/)
})

test('DANFE — chave de acesso em grupos de 4 dígitos', () => {
  const out = buildDanfeText(makeFixture())
  // 44 dígitos com espaço a cada 4
  assert.match(out, /2926 0400 0000 0000 0000 0000 0000 0000 0000 0000 0123/)
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
```

**Step 3: Rodar os testes — TODOS devem falhar (TDD red phase)**

```bash
cd delivery-saas-backend && node --test tests/danfeText.test.mjs
```

Esperado: a maioria dos testes falha (porque `buildDanfeText` ainda tem o layout antigo). É **esperado e desejado** nesta etapa. Anotar quantos passam só como sanity (alguns passam por coincidência, ex.: `homologacao` warning, chave em grupos de 4, placeholder QR).

**Step 4: Commit (testes vermelhos)**

```bash
git add delivery-saas-backend/tests/danfeText.test.mjs
git commit -m "test(danfe): especificar layout MOC v6.0 (red phase)

Tests descrevem o novo layout esperado: titulo DANFE NFC-e, itens
enumerados, totais com Subtotal/Desconto/Troco, mensagem MOC
\"Consulte pela Chave de Acesso em\", bloco do consumidor."
```

---

### Task 3: Implementar o novo layout (TDD green phase)

**Files:**
- Modify: `delivery-saas-backend/src/utils/danfeText.js`

**Step 1: Reescrever `buildDanfeText`**

Substituir TODO o conteúdo do arquivo criado na Task 1 por esta versão:

```javascript
'use strict'

/**
 * Gera o texto do DANFE NFC-e conforme MOC v6.0 (Manual de Especificações
 * Técnicas do DANFE NFC-e + QR Code).
 *
 * Layout (48 colunas — impressora térmica 80mm):
 *   I   Cabeçalho (razão social, CNPJ, endereço)
 *   II  Identificação (DANFE NFC-e)
 *   III Itens (2 linhas por item: # nome / qty UN x unit ... total)
 *   IV  Totais (Subtotal, Desconto, Acréscimo, TOTAL, Pagamento, Troco)
 *   V   Consulta por chave de acesso
 *   VI  QR Code
 *   VII NFC-e + Protocolo
 *   VIII Consumidor (CPF/CNPJ ou "NAO IDENTIFICADO")
 *
 * @param {object} data
 * @returns {string} Texto multilinha pronto para impressão.
 */
export function buildDanfeText(data) {
  const { protocol, order, fiscalConfig = {}, emitenteConfig = null } = data
  const rawXml = protocol?.rawXml || ''

  const extract = (tag, xml) => {
    const m = xml.match(new RegExp(`<${tag}[^>]*>([^<]+)</${tag}>`))
    return m ? m[1].trim() : ''
  }
  const chNFe = extract('chNFe', rawXml) || ''
  const dhRecbto = extract('dhRecbto', rawXml) || new Date().toISOString()
  const nProt = protocol?.nProt || extract('nProt', rawXml) || ''
  const nNF = extract('nNF', rawXml) || ''
  const serie = extract('serie', rawXml) || '1'
  const tpAmb = extract('tpAmb', rawXml) || '2'

  const enderEmit = (emitenteConfig && emitenteConfig.enderEmit) || {}
  const cnpj = fiscalConfig.cnpj || ''
  const cnpjFormatted = cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
  const ie = fiscalConfig.ie || 'ISENTO'
  const xNome = (emitenteConfig && emitenteConfig.xNome) || (order.store && order.store.name) || (order.company && order.company.name) || ''
  const xFant = (order.store && order.store.name) || xNome
  const logradouro = [enderEmit.xLgr, enderEmit.nro].filter(Boolean).join(', ')
  const municipio = [enderEmit.xMun, enderEmit.UF].filter(Boolean).join(' - ')

  const W = 48
  const sep = '-'.repeat(W)
  const dbl = '='.repeat(W)
  const center = (s) => { const sp = Math.max(0, W - s.length); return ' '.repeat(Math.floor(sp / 2)) + s }
  const ljust = (s, n) => { const str = String(s); return str.length >= n ? str.slice(0, n) : str + ' '.repeat(n - str.length) }
  const rjust = (s, n) => { const str = String(s); return str.length >= n ? str.slice(0, n) : ' '.repeat(n - str.length) + str }

  // Formata valor com vírgula decimal (pt-BR): 50.00 → "R$ 50,00"
  const money = (n) => 'R$ ' + Number(n || 0).toFixed(2).replace('.', ',')

  let emissaoStr = ''
  let emissaoDate = ''
  try {
    const d = new Date(dhRecbto)
    emissaoDate = d.toLocaleDateString('pt-BR')
    emissaoStr = emissaoDate + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  } catch {
    emissaoStr = dhRecbto
    emissaoDate = ''
  }

  const lines = []

  // ── Divisão I: Cabeçalho ─────────────────────────────────────────────
  lines.push(dbl)
  lines.push(center(xFant))
  if (cnpjFormatted) lines.push(center(`CNPJ: ${cnpjFormatted}`))
  if (xNome && xNome !== xFant) lines.push(center(xNome))
  if (logradouro) lines.push(center(logradouro))
  if (municipio) lines.push(center(municipio))
  lines.push(sep)

  // ── Divisão II: Identificação do documento ──────────────────────────
  lines.push(center('DANFE NFC-e'))
  lines.push(center('Documento Auxiliar da Nota Fiscal'))
  lines.push(center('de Consumidor Eletronica'))
  lines.push(sep)
  if (tpAmb === '2') {
    lines.push(center('** HOMOLOGACAO - SEM VALOR FISCAL **'))
    lines.push(sep)
  }

  // ── Divisão III: Itens (2 linhas por item) ──────────────────────────
  lines.push('ITENS')
  lines.push(sep)
  const items = order.items || []
  let totalItens = 0
  let subtotal = 0
  items.forEach((it, idx) => {
    const num = String(idx + 1).padStart(3, '0')
    const qty = Number(it.quantity || 1)
    const unit = Number(it.price || 0)
    const total = qty * unit
    totalItens += qty
    subtotal += total

    // Linha 1: "001 NOME DO ITEM" (truncado em 44 chars; UTF chars contam por 1)
    const nameMax = W - 4 // 4 = "001 "
    const name = String(it.name || '').slice(0, nameMax)
    lines.push(`${num} ${name}`)

    // Linha 2: "    qty UN x R$ unit ... R$ total" (right-aligned)
    const left = `    ${qty} UN x ${money(unit)}`
    const right = money(total)
    const pad = Math.max(1, W - left.length - right.length)
    lines.push(left + ' '.repeat(pad) + right)
  })
  lines.push(sep)

  // ── Divisão IV: Totais ──────────────────────────────────────────────
  const vNF = Number(order.total || subtotal)
  const desconto = Number(order.discount || 0)
  const acrescimo = Number(order.deliveryFee || 0)
  const payRaw = (order.payload && order.payload.payment) || {}
  const troco = Number(payRaw.change || 0)

  const totalLine = (label, amount, prefix = '') => {
    const left = label
    const right = prefix + money(amount)
    return ljust(left, W - right.length) + right
  }

  lines.push(`Qtd itens: ${totalItens}`)
  lines.push(totalLine('Subtotal:', subtotal))
  if (desconto > 0) lines.push(totalLine('Desconto:', desconto, '- '))
  if (acrescimo > 0) lines.push(totalLine('Acrescimo:', acrescimo, '+ '))
  lines.push(totalLine('TOTAL:', vNF))

  // Pagamento
  const TPAG_MAP = { '01': 'Dinheiro', '03': 'Cartao Credito', '04': 'Cartao Debito', '17': 'PIX', '99': 'Outros' }
  const PAYKEY_MAP = { CASH: '01', MONEY: '01', CREDIT_CARD: '03', DEBIT_CARD: '04', PIX: '17', VOUCHER: '05', ONLINE: '99' }
  const payMethod = payRaw.methodCode || payRaw.method || payRaw.type || ''
  const tPagCode = PAYKEY_MAP[payMethod] || '99'
  const payDesc = TPAG_MAP[tPagCode] || payMethod || 'Outros'
  lines.push(ljust('Pagamento:', W - payDesc.length) + payDesc)
  if (troco > 0) lines.push(totalLine('Troco:', troco))
  lines.push(sep)

  // ── Divisão V: Consulta por chave de acesso ────────────────────────
  lines.push(center('Consulte pela Chave de Acesso em'))
  const consultaUrl = tpAmb === '1'
    ? 'nfce.svrs.rs.gov.br/consulta'
    : 'nfce-homologacao.svrs.rs.gov.br/consulta'
  lines.push(center(consultaUrl))
  lines.push('')
  lines.push(center('CHAVE DE ACESSO'))
  const chaveFormatted = chNFe.replace(/(\d{4})(?=\d)/g, '$1 ')
  // Wrap se passar de W
  const chaveWords = chaveFormatted.split(' ')
  let cur = ''
  for (const w of chaveWords) {
    if (cur && (cur + ' ' + w).length > W) {
      lines.push(center(cur))
      cur = w
    } else {
      cur = cur ? cur + ' ' + w : w
    }
  }
  if (cur) lines.push(center(cur))
  lines.push(sep)

  // ── Divisão VI: QR Code ─────────────────────────────────────────────
  const qrUrlBase = tpAmb === '1'
    ? 'https://nfce.svrs.rs.gov.br/consulta/consultaPublica.jsp'
    : 'https://nfce-homologacao.svrs.rs.gov.br/consulta/consultaPublica.jsp'
  const qrData = chNFe ? `${qrUrlBase}?chave=${chNFe}` : qrUrlBase
  lines.push(`[QR:${qrData}]`)
  lines.push(sep)

  // ── Divisão VII: NFC-e + Protocolo ──────────────────────────────────
  lines.push(`NFC-e nro. ${nNF} Serie ${serie}`)
  lines.push(`Emissao: ${emissaoStr}`)
  lines.push(`Protocolo: ${nProt} ${emissaoDate}`)
  lines.push(`I.E.: ${ie}`)
  lines.push(sep)

  // ── Divisão VIII: Consumidor ────────────────────────────────────────
  const cpf = (order.customer && order.customer.cpf)
    || (order.payload && order.payload.customer && order.payload.customer.cpf)
    || ''
  const cnpjConsumidor = (order.customer && order.customer.cnpj)
    || (order.payload && order.payload.customer && order.payload.customer.cnpj)
    || ''
  const consumerName = (order.customer && order.customer.fullName)
    || order.customerName
    || (order.payload && order.payload.customer && order.payload.customer.name)
    || ''

  if (cpf) {
    const cpfFmt = cpf.replace(/\D/g, '').replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')
    lines.push(`CONSUMIDOR CPF: ${cpfFmt}`)
    if (consumerName) lines.push(consumerName)
  } else if (cnpjConsumidor) {
    const cnpjFmt = cnpjConsumidor.replace(/\D/g, '').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
    lines.push(`CONSUMIDOR CNPJ: ${cnpjFmt}`)
    if (consumerName) lines.push(consumerName)
  } else {
    lines.push(center('CONSUMIDOR NAO IDENTIFICADO'))
  }

  lines.push(dbl)

  return lines.join('\n')
}
```

**Step 2: Verificar parsing**

```bash
cd delivery-saas-backend && node --check src/utils/danfeText.js
```

Esperado: passa.

**Step 3: Rodar os testes — TODOS devem passar (green phase)**

```bash
cd delivery-saas-backend && node --test tests/danfeText.test.mjs
```

Esperado: todos os testes passam. Se algum falhar, **NÃO** ajustar o teste para passar — o bug está na implementação. Reler o teste, ler a saída do `--test`, corrigir o código.

**Step 4: Inspeção visual de uma saída**

Gerar e imprimir uma amostra para ver:

```bash
cd delivery-saas-backend && node -e "
import('./src/utils/danfeText.js').then(m => {
  const out = m.buildDanfeText({
    protocol: { rawXml: '<chNFe>29260400000000000000000000000000000000000123</chNFe><nNF>123</nNF><serie>1</serie><tpAmb>2</tpAmb><dhRecbto>2026-05-04T21:30:15-03:00</dhRecbto>', nProt: '135250000123456' },
    order: {
      total: 56,
      payload: { payment: { method: 'CREDIT_CARD' } },
      items: [
        { name: 'X-BURGUER ESPECIAL', quantity: 2, price: 25 },
        { name: 'COCA-COLA 350ML', quantity: 1, price: 6 },
      ],
      store: { name: 'Hamburgueria Teste' },
      company: { name: 'Hamburgueria Teste LTDA' },
    },
    fiscalConfig: { cnpj: '12345678000190', ie: '999999999' },
    emitenteConfig: {
      xNome: 'Hamburgueria Teste LTDA',
      enderEmit: { xLgr: 'Rua Teste', nro: '123', xMun: 'Salvador', UF: 'BA' },
    },
  })
  console.log(out)
})
"
```

Conferir visualmente que:
- Largura de 48 col em todas as linhas
- Itens enumerados 001, 002
- Bloco "ITENS" → separador → itens → separador
- Bloco de totais com Subtotal e TOTAL alinhados à direita
- "Consulte pela Chave de Acesso em"
- "CONSUMIDOR NAO IDENTIFICADO" centralizado
- Aviso de homologação centralizado em destaque

**Step 5: Commit**

```bash
git add delivery-saas-backend/src/utils/danfeText.js
git commit -m "feat(danfe): novo layout DANFE NFC-e conforme MOC v6.0

- Tabela de itens em 2 linhas com numeração 001/002
- Totais expandidos: Subtotal, Desconto (se >0), Acrescimo (se >0),
  TOTAL, Troco (se >0)
- Mensagem MOC \"Consulte pela Chave de Acesso em\"
- Bloco do consumidor: CONSUMIDOR CPF/CNPJ ou NAO IDENTIFICADO
- Valores em formato pt-BR (virgula decimal)"
```

---

### Task 4: Smoke test do orquestrador (sem mudanças, só confirmar que segue funcionando)

**Files:** nenhum (apenas verificação)

**Step 1: Rodar `node --check` no orquestrador**

```bash
cd delivery-saas-backend && node --check src/routes/agentPrint.js
```

Esperado: passa.

**Step 2: Rodar suite de testes do backend**

```bash
cd delivery-saas-backend && node --test tests/danfeText.test.mjs
```

Esperado: todos passam.

**Step 3: Confirmar que `formatDanfeText` (orquestrador) ainda exporta corretamente**

```bash
cd delivery-saas-backend && node -e "
import('./src/routes/agentPrint.js').then(m => console.log('Module loaded ok'))
" 2>&1
```

Esperado: `Module loaded ok`. (Se importar falhar, o caminho de import do `buildDanfeText` no orquestrador está errado.)

---

### Task 5: Validação visual em homologação + push

**Files:** nenhum (validação manual)

**Step 1: Subir o stack dev**

```bash
docker compose up -d
docker compose ps
```

Esperado: `db`, `backend`, `frontend` todos `Up`.

**Step 2: Emitir uma NF-e de teste em homologação**

1. Abrir `http://localhost:5173/orders`.
2. Pedido CONCLUIDO sem nota → "Emitir NF-e".
3. Após cStat=100, clicar **"Imprimir DANFE"** no card.

**Verificar (no papel ou no preview do agente):**

| Item | Esperado |
|---|---|
| Cabeçalho centralizado: nome da loja, CNPJ formatado, endereço | ✅ |
| Linha "DANFE NFC-e" centralizada em destaque | ✅ |
| "EMITIDA EM AMBIENTE DE HOMOLOGAÇÃO - SEM VALOR FISCAL" | ✅ |
| Itens enumerados 001, 002… com nome + linha "qty UN x R$ unit ... R$ total" | ✅ |
| Bloco de totais com TOTAL alinhado à direita | ✅ |
| "Consulte pela Chave de Acesso em" + URL | ✅ |
| Chave de acesso em grupos de 4 dígitos | ✅ |
| Linhas "NFC-e nro. NNN Serie 1" + "Protocolo: NNN dd/mm/yyyy" | ✅ |
| "CONSUMIDOR NAO IDENTIFICADO" (se pedido sem CPF) | ✅ |
| "CONSUMIDOR CPF: NNN.NNN.NNN-NN" + nome (se pedido com CPF) | ✅ |
| Valor em formato pt-BR `R$ 50,00` (vírgula) | ✅ |

**Step 3: Push**

```bash
git push -u origin feat/danfe-nfce-template-redesign
```

**Step 4: Hand off**

Anunciar: "Implementação completa. Próximo passo: superpowers:finishing-a-development-branch."

Use the **superpowers:finishing-a-development-branch** skill.
