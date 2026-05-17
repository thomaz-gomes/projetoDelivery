# Combo Products Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Permitir cadastro de produtos do tipo combo (slots variáveis com escolha) que são vendidos ao cliente com preço fechado, mas declarados na NFe com cada componente em seu próprio `<det>` com valor fiscal rateado.

**Architecture:** Novo modelo `Combo`/`ComboSlot`/`ComboSlotOption` aninhado em `Product` (com flag `isCombo`). OrderItem mantém estrutura atual (1 linha + `options[]` JSON com discriminador `kind: 'combo_slot' | 'addon'`). O serviço de NFe expande slots em `<det>` separados via rateio proporcional dos `vUnComReferencia` cadastrados, mantendo o total fechado no preço do combo. Addons continuam expandindo como hoje (commit 93e6a4c).

**Tech Stack:** Express, Prisma 6, PostgreSQL, Vue 3 + Pinia, Socket.IO, Node test runner (`node --test`).

**Design doc:** `docs/plans/2026-05-16-combo-products-design.md`

---

## Fase A — Backend: schema, rateio, NFe

### Task A1: Migration Prisma — adicionar Combo/ComboSlot/ComboSlotOption

**Files:**
- Modify: `delivery-saas-backend/prisma/schema.prisma`
- Run: `prisma db push` (dev)

**Step 1: Editar o schema**

No final do arquivo (ou perto do `model Product`), adicionar o flag e os novos modelos. Em `model Product`, adicionar dois campos antes do bloco `@@index`:

```prisma
  isCombo  Boolean @default(false)
  combo    Combo?
```

E adicionar a relação inversa em `Product` para `linkedFromComboOptions`:

```prisma
  comboSlotLinks ComboSlotOption[] @relation("ComboLinkedProduct")
```

Adicionar os modelos novos:

```prisma
model Combo {
  id        String      @id @default(uuid())
  productId String      @unique
  product   Product     @relation(fields: [productId], references: [id])
  companyId String
  company   Company     @relation(fields: [companyId], references: [id])
  slots     ComboSlot[]
  createdAt DateTime    @default(now())
  updatedAt DateTime    @updatedAt

  @@index([companyId])
}

model ComboSlot {
  id        String            @id @default(uuid())
  comboId   String
  combo     Combo             @relation(fields: [comboId], references: [id], onDelete: Cascade)
  name      String
  minSelect Int               @default(1)
  maxSelect Int               @default(1)
  position  Int               @default(0)
  options   ComboSlotOption[]

  @@index([comboId])
}

model ComboSlotOption {
  id               String    @id @default(uuid())
  slotId           String
  slot             ComboSlot @relation(fields: [slotId], references: [id], onDelete: Cascade)
  linkedProductId  String
  linkedProduct    Product   @relation("ComboLinkedProduct", fields: [linkedProductId], references: [id])
  vUnComReferencia Decimal
  integrationCode  String?
  position         Int       @default(0)

  @@index([slotId])
  @@index([linkedProductId])
}
```

Adicionar a relação inversa em `model Company` (procurar a linha onde estão as outras relações):

```prisma
  combos Combo[]
```

**Step 2: Rodar prisma db push**

Run: `docker compose exec backend npx prisma db push --skip-generate`
Expected: "Your database is now in sync with your Prisma schema."

**Step 3: Regenerar client**

Run: `docker compose exec backend npx prisma generate`
Expected: "Generated Prisma Client (v6.x.x)"

**Step 4: Commit**

```bash
git add delivery-saas-backend/prisma/schema.prisma
git commit -m "feat(schema): add Combo/ComboSlot/ComboSlotOption models"
```

---

### Task A2: Utility puro de rateio — teste falhando

**Files:**
- Create: `delivery-saas-backend/tests/comboRateio.test.mjs`

**Step 1: Escrever teste failing**

```javascript
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
```

**Step 2: Rodar teste — deve falhar**

Run: `cd delivery-saas-backend && node --test tests/comboRateio.test.mjs`
Expected: ERR_MODULE_NOT_FOUND ou similar (módulo não existe)

**Step 3: Commit do teste**

```bash
git add delivery-saas-backend/tests/comboRateio.test.mjs
git commit -m "test(combo): rateio fiscal — failing"
```

---

### Task A3: Implementar `rateioCombo`

**Files:**
- Create: `delivery-saas-backend/src/utils/comboRateio.js`

**Step 1: Implementar**

```javascript
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
```

**Step 2: Rodar testes — deve passar**

Run: `cd delivery-saas-backend && node --test tests/comboRateio.test.mjs`
Expected: `pass 5` (todos os 5 testes verdes)

**Step 3: Commit**

```bash
git add delivery-saas-backend/src/utils/comboRateio.js
git commit -m "feat(combo): rateio fiscal util"
```

---

### Task A4: Routes — POST/PATCH `/menu/products` aceitando payload combo

**Files:**
- Modify: `delivery-saas-backend/src/routes/menu.js:503-680` (handlers POST e PATCH `/products`)

**Step 1: Estender o handler POST**

Logo após `prisma.product.create(...)`, dentro de uma transação, se `req.body.isCombo === true && Array.isArray(req.body.combo?.slots)`, criar Combo + ComboSlot + ComboSlotOption.

Substituir o `prisma.product.create({...})` atual por:

```javascript
const created = await prisma.$transaction(async (tx) => {
  const product = await tx.product.create({
    data: {
      // ... os campos atuais
      isCombo: Boolean(req.body.isCombo),
    },
  })

  if (req.body.isCombo && Array.isArray(req.body.combo?.slots)) {
    const combo = await tx.combo.create({
      data: {
        productId: product.id,
        companyId: product.companyId,
      },
    })
    for (const [sIdx, slot] of req.body.combo.slots.entries()) {
      const created = await tx.comboSlot.create({
        data: {
          comboId: combo.id,
          name: String(slot.name || `Slot ${sIdx + 1}`),
          minSelect: Number(slot.minSelect ?? 1),
          maxSelect: Number(slot.maxSelect ?? 1),
          position: sIdx,
        },
      })
      for (const [oIdx, opt] of (slot.options || []).entries()) {
        if (!opt.linkedProductId || !(Number(opt.vUnComReferencia) > 0)) {
          throw new Error(`Slot ${sIdx + 1}: opção ${oIdx + 1} inválida`)
        }
        await tx.comboSlotOption.create({
          data: {
            slotId: created.id,
            linkedProductId: opt.linkedProductId,
            vUnComReferencia: opt.vUnComReferencia,
            integrationCode: opt.integrationCode || null,
            position: oIdx,
          },
        })
      }
    }
  }

  return tx.product.findUnique({
    where: { id: product.id },
    include: {
      combo: { include: { slots: { include: { options: true }, orderBy: { position: 'asc' } } } },
    },
  })
})
res.json(created)
```

**Step 2: Estender o handler PATCH (`/products/:id`)**

Mesma lógica: se `req.body.isCombo === true` e combo já existe, fazer `delete + recreate` dos slots/options dentro da transação (substituição completa é mais simples e cobre add/remove/edit). Se `isCombo` mudar de true→false, apagar o `Combo` em cascata.

```javascript
if (typeof req.body.isCombo === 'boolean') {
  await tx.product.update({ where: { id }, data: { isCombo: req.body.isCombo } })
}
if (req.body.isCombo && req.body.combo) {
  await tx.combo.deleteMany({ where: { productId: id } })
  // mesma criação do POST
}
if (req.body.isCombo === false) {
  await tx.combo.deleteMany({ where: { productId: id } })
}
```

**Step 3: GET `/products/:id` inclui combo**

Procurar GET `/products/:id` no arquivo (se existir; senão é o `findUnique` em outro handler que retorna o produto). Adicionar `include: { combo: { include: { slots: { include: { options: { include: { linkedProduct: { select: { id, name, price, integrationCode } } } }, orderBy: { position: 'asc' } } } } } }`.

**Step 4: Smoke test manual**

Run em outro terminal (Postman/cURL):
```bash
curl -X POST http://localhost:3000/menu/products -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{
  "name": "Combo Teste",
  "price": 40,
  "isCombo": true,
  "combo": { "slots": [
    { "name": "Lanche", "minSelect": 1, "maxSelect": 1, "options": [
      { "linkedProductId": "<id>", "vUnComReferencia": 22 }
    ]}
  ]}
}'
```
Expected: 200 com combo aninhado na resposta.

**Step 5: Commit**

```bash
git add delivery-saas-backend/src/routes/menu.js
git commit -m "feat(combo): aceitar payload combo em POST/PATCH /menu/products"
```

---

### Task A5: NFe service — teste falhando para combo

**Files:**
- Create: `delivery-saas-backend/tests/nfeCombo.test.mjs`

**Step 1: Teste**

```javascript
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
      { kind: 'combo_slot', productId: 'p-lanche', name: 'X-Tudo', vUnComReferencia: 25 },
      { kind: 'combo_slot', productId: 'p-bebida', name: 'Coca lata', vUnComReferencia: 7 },
      { kind: 'combo_slot', productId: 'p-batata', name: 'Batata G', vUnComReferencia: 11 },
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
```

**Step 2: Rodar — deve falhar**

Run: `cd delivery-saas-backend && node --test tests/nfeCombo.test.mjs`
Expected: ERR_MODULE_NOT_FOUND

**Step 3: Commit**

```bash
git add delivery-saas-backend/tests/nfeCombo.test.mjs
git commit -m "test(nfe): expandOrderItemsToDet — failing"
```

---

### Task A6: Extrair expansão de det para módulo + suportar combo

**Files:**
- Create: `delivery-saas-backend/src/services/nfeExpansion.js`
- Modify: `delivery-saas-backend/src/services/nfe.js:553-616`

**Step 1: Implementar `nfeExpansion.js`**

Função pura que recebe `orderItems` e `productMap` (já carregado), retorna `det[]` no shape esperado pelo `buildNfePayload`. Internamente:
1. Para cada OrderItem:
   - Se `product.isCombo === true`: separar `slots` (kind=combo_slot) e `addons` (kind=addon || !kind), chamar `rateioCombo({ precoCombo: item.price, slots, quantity: item.quantity })`, montar 1 `det` por slot usando `linkedProduct.dadosFiscais` (com fallback de categoria) + ajustar pelo retorno do rateio (vUnCom, qCom, vProd). Depois montar `det` para cada addon como faz hoje. **NÃO** emitir det para o produto-guarda-chuva.
   - Senão: mesma lógica que existe hoje em `nfe.js:563-616` (expandir options legadas em det e o item principal se tiver preço > R$ 0,10).
2. Reusar a função `resolveFiscalForProduct(product)` extraída para encapsular o merge de `dadosFiscais` product+categoria.

Ver o código atual em `delivery-saas-backend/src/services/nfe.js:553-616` para a lógica de NCM/CFOP/CST. Importar `rateioCombo` de `../utils/comboRateio.js`.

**Step 2: Substituir o trecho em `nfe.js`**

Substituir o map atual por:
```javascript
import { expandOrderItemsToDet } from './nfeExpansion.js'
// ...
const det = expandOrderItemsToDet(order.items, productMap, { tpAmb })
```

E ajustar o `productMap` para incluir `combo: { include: { slots: { include: { options: { include: { linkedProduct: { include: { dadosFiscais: true, category: { include: { dadosFiscais: true } } } } } } } } } }` quando carregando os produtos do pedido — caso o slot precise consultar o dadosFiscais do `linkedProduct` que pode não estar no `order.items.productId`.

Atalho mais simples: já que `options[].productId` aponta para os linkedProducts, **incluir esses ids no `productIds` consultado**:
```javascript
const productIds = [...new Set([
  ...order.items.filter(i => i.productId).map(i => i.productId),
  ...order.items.flatMap(i => (i.options || []).map(o => o.productId).filter(Boolean)),
])]
```

**Step 3: Rodar testes**

Run: `cd delivery-saas-backend && node --test tests/nfeCombo.test.mjs tests/danfeText.test.mjs`
Expected: ambos pass

**Step 4: Commit**

```bash
git add delivery-saas-backend/src/services/nfeExpansion.js delivery-saas-backend/src/services/nfe.js
git commit -m "feat(nfe): expand combos com rateio fiscal nos <det>"
```

---

### Task A7: DANFE térmica — espelhar expansão

**Files:**
- Modify: `delivery-saas-backend/src/utils/danfeText.js`
- Modify: `delivery-saas-backend/tests/danfeText.test.mjs` (adicionar caso de combo)

**Step 1: Teste do cupom para combo**

Adicionar ao `danfeText.test.mjs`:

```javascript
test('danfe text: combo expande slots com label do slot', () => {
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
          { kind: 'combo_slot', slotName: 'Lanche', name: 'X-Tudo', vUnComReferencia: 25 },
          { kind: 'combo_slot', slotName: 'Bebida', name: 'Coca', vUnComReferencia: 7 },
          { kind: 'combo_slot', slotName: 'Acomp', name: 'Batata', vUnComReferencia: 11 },
          { kind: 'addon', name: 'Molho extra', price: 3 },
        ],
      }],
    },
  })
  const out = buildDanfeText(fixture)
  assert.ok(out.includes('Combo X'))
  assert.ok(out.includes('Lanche'))
  assert.ok(out.includes('X-Tudo'))
  assert.ok(out.includes('+ Molho extra'))
})
```

**Step 2: Rodar — deve falhar**

Run: `cd delivery-saas-backend && node --test tests/danfeText.test.mjs`
Expected: fail no novo caso

**Step 3: Implementar o suporte**

Editar `danfeText.js` no bloco que renderiza items. Onde hoje renderiza options com `+ {nome}`, adicionar: se `option.kind === 'combo_slot'`, renderizar `  {slotName}: {nome}` (sem o `+` e sem o preço). Se `kind === 'addon'` ou ausente, manter `+ {nome} ... R$ X,XX` (atual).

**Step 4: Rodar testes**

Run: `cd delivery-saas-backend && node --test tests/danfeText.test.mjs`
Expected: pass

**Step 5: Commit**

```bash
git add delivery-saas-backend/src/utils/danfeText.js delivery-saas-backend/tests/danfeText.test.mjs
git commit -m "feat(danfe): renderizar slots de combo no cupom"
```

---

### Task A8: integrationMatcher — categorizar subitens (slot vs addon)

**Files:**
- Modify: `delivery-saas-backend/src/utils/integrationMatcher.js`

**Step 1: Adicionar lookup de ComboSlotOption**

Após o lookup de `optionMap`, adicionar lookup `comboSlotOptionMap` por `integrationCode` e por `linkedProduct.integrationCode`:

```javascript
const comboSlotOptionMap = {}
if (subCodes.length > 0) {
  const slotOpts = await prisma.comboSlotOption.findMany({
    where: {
      slot: { combo: { companyId } },
      OR: [
        { integrationCode: { in: subCodes } },
        { linkedProduct: { integrationCode: { in: subCodes } } },
      ],
    },
    include: { linkedProduct: { select: { id: true, name: true, integrationCode: true } } },
  })
  for (const s of slotOpts) {
    const codes = [s.integrationCode, s.linkedProduct?.integrationCode].filter(Boolean)
    for (const c of codes) comboSlotOptionMap[c] = s
  }
}
```

**Step 2: Categorizar subitens**

No loop de `subs.map(sub => {...})`, antes do `matchedOpt`/`matchedProd`, tentar `comboSlotOptionMap` primeiro **apenas se `result._isCombo === true`** (definido pelo match do item principal: se `matched.isCombo === true`, marcar `result._isCombo = true`). Adicionar campos no resultado:

```javascript
const slotMatch = result._isCombo && subCode ? comboSlotOptionMap[String(subCode)] : null
if (slotMatch) {
  return {
    ...sub,
    name: slotMatch.linkedProduct.name,
    _matchedProductId: slotMatch.linkedProductId,
    _kind: 'combo_slot',
    _vUnComReferencia: Number(slotMatch.vUnComReferencia),
  }
}
// fallback existente
const matchedOpt = ...
const matchedProd = ...
const match = matchedOpt || matchedProd
if (match) {
  return { ...sub, name: match.name, _matchedProductId: match.id, _kind: 'addon' }
}
return { ...sub, _kind: 'addon' }
```

E ajustar a busca de products para marcar `isCombo`:
```javascript
const products = await prisma.product.findMany({
  where: { companyId, integrationCode: { in: allCodes } },
  select: { id: true, name: true, integrationCode: true, isCombo: true }
})
```

**Step 3: Smoke test manual**

Simular um webhook iFood com 1 item combo + subitem com `externalCode` igual ao `Product.integrationCode` de um componente. Verificar nos logs que sai `(combo_slot)` ao invés de `(option)`/`(product)`.

**Step 4: Commit**

```bash
git add delivery-saas-backend/src/utils/integrationMatcher.js
git commit -m "feat(integration): categorizar subitens como combo_slot vs addon"
```

---

### Task A9: ifoodWebhookProcessor — propagar `kind` nas options

**Files:**
- Modify: `delivery-saas-backend/src/services/ifoodWebhookProcessor.js`

**Step 1: Localizar o ponto onde options[] é montado para OrderItem**

Grep por `_matchedProductId` ou `subItems` no arquivo. Onde monta o JSON `options` para o OrderItem, copiar `_kind` (renomeando para `kind`) e `_vUnComReferencia` (renomeando para `vUnComReferencia`).

Exemplo:
```javascript
options: subs.map(s => ({
  productId: s._matchedProductId || null,
  name: s.name,
  price: Number(s.price || 0),
  kind: s._kind || 'addon',
  vUnComReferencia: s._vUnComReferencia,
})).filter(o => o.kind === 'combo_slot' || o.price > 0)
```

**Step 2: Smoke test manual**

Disparar um webhook iFood de teste; abrir o pedido no banco e ver se `OrderItem.options` tem `kind` nos subitens.

**Step 3: Commit**

```bash
git add delivery-saas-backend/src/services/ifoodWebhookProcessor.js
git commit -m "feat(ifood): propagar kind nas options dos OrderItems"
```

---

## Fase B — Frontend

### Task B1: Modal "tipo: produto/combo" no cadastro

**Files:**
- Modify: a view de cadastro de produto (provavelmente `delivery-saas-frontend/src/views/ProductForm.vue` ou equivalente; localizar via `grep -rn "isActive" delivery-saas-frontend/src/views | grep -i prod`)

**Step 1: Localizar o componente**

Run: `grep -rln "POST.*products\|/menu/products" delivery-saas-frontend/src/`
Identificar a view que faz a chamada de criação.

**Step 2: Inserir modal de tipo**

Quando o usuário clica em "Novo produto", abrir modal com 2 cards:
- "Produto" (default) — fluxo atual
- "Combo" — abre form com aba extra "Componentes"

Persistir escolha em variável `productType` no setup. Se `productType === 'combo'`, setar `form.isCombo = true` antes do submit e renderizar a aba "Componentes".

**Skill check:** invocar `frontend-deliverywl` antes para garantir consistência visual (cards/Bootstrap/cor).

**Step 3: Smoke test no navegador**

Abrir `http://localhost:5173`, ir em Cardápio → Novo produto, verificar que o modal aparece.

**Step 4: Commit**

```bash
git add delivery-saas-frontend/src/views/<arquivo>.vue
git commit -m "feat(combo): seletor produto/combo no cadastro"
```

---

### Task B2: Aba "Componentes do combo"

**Files:**
- Create: `delivery-saas-frontend/src/components/ComboSlotsEditor.vue`
- Modify: a view de cadastro (mesmo arquivo de B1)

**Step 1: Componente ComboSlotsEditor**

Props: `modelValue` (array de slots), `companyId`.
Emit: `update:modelValue`.

Layout:
- Lista de slots; cada slot tem: nome, minSelect, maxSelect, lista de opções, botão remover.
- Cada opção: select de Product (autocomplete via `GET /menu/products`), campo `vUnComReferencia` (number, BRL), campo opcional `integrationCode`, botão remover.
- Botão "Adicionar slot" e "Adicionar opção" em cada slot.

Ao selecionar um Product na opção, pré-preencher `vUnComReferencia` com `product.price`.

**Skill check:** invocar `frontend-deliverywl` para padrões de tabela/inputs/cards.

**Step 2: Integrar na view de cadastro**

Quando `form.isCombo === true`, exibir uma aba "Componentes" com `<ComboSlotsEditor v-model="form.combo.slots" :company-id="companyId" />`.

**Step 3: Submit**

Ao salvar, enviar `{ ...form, isCombo: true, combo: { slots: form.combo.slots } }`. Para edição, o GET já retorna `combo.slots` aninhado (Task A4).

**Step 4: Smoke test**

Criar um combo no admin. Validar payload e resposta no Network tab. Editar o combo, salvar, validar persistência.

**Step 5: Commit**

```bash
git add delivery-saas-frontend/src/components/ComboSlotsEditor.vue delivery-saas-frontend/src/views/<arquivo>.vue
git commit -m "feat(combo): editor de slots no admin"
```

---

### Task B3: Public menu (Cardápio) — renderizar slots antes de complementos

**Files:**
- Modify: view do cardápio público (provavelmente `delivery-saas-frontend/src/views/PublicMenu.vue` ou similar; `grep -rln "addToCart\|productOptionGroups" delivery-saas-frontend/src/views/`)

**Step 1: Localizar o componente**

Identificar onde o modal do produto é montado com options.

**Step 2: Renderização condicional**

Se `product.isCombo === true && product.combo?.slots`:
1. Renderizar primeiro os slots (radio, 1 de N quando minSelect===maxSelect===1; checkbox quando maxSelect>1). Não exibir preço por opção.
2. Em seguida, renderizar os `productOptionGroups` (complementos tradicionais) — código existente, sem mudança.
3. Subtotal = `product.price + soma(addons.selecionados.price)`.
4. Botão "Adicionar" desabilitado até que todos os slots tenham `min..max` escolhidos.

**Step 3: Payload addToCart**

Montar `options[]` com:
- 1 entrada por slot escolhido: `{ kind: 'combo_slot', slotId, optionId, productId: linkedProductId, name: linkedProduct.name, vUnComReferencia }`.
- N entradas por addon escolhido: `{ kind: 'addon', optionId, name, price }`.

**Step 4: Smoke test**

Abrir cardápio público → adicionar um combo ao carrinho → verificar payload no Network. Conferir que o subtotal soma corretamente quando addon é marcado.

**Step 5: Commit**

```bash
git add delivery-saas-frontend/src/views/<arquivo>.vue
git commit -m "feat(combo): cardápio público renderiza slots de combo"
```

---

### Task B4: PDV/Orders/SaleDetails — exibir componentes do combo

**Files:**
- Modify: `delivery-saas-frontend/src/views/Orders.vue`
- Modify: `delivery-saas-frontend/src/views/SaleDetails.vue`
- (eventualmente) modal de criação PDV

**Step 1: Detectar combo no item exibido**

Na linha do OrderItem, separar `options` em `slots = options.filter(o => o.kind === 'combo_slot')` e `addons = options.filter(o => o.kind !== 'combo_slot')`. Renderizar:
```
1× Combo X-Bacon ──────── R$ 40,00
    Lanche: X-Tudo
    Bebida: Coca lata
    + Molho extra ─────── R$ 3,00
```

Reutilizar o componente que já renderiza options hoje, passando flag para distinguir.

**Step 2: PDV criação (se aplicável)**

Se for possível criar combo via PDV (não obrigatório nesta fase): mesma lógica do public menu. Se ficar para depois, deixar TODO no código.

**Step 3: Smoke test**

Pedido com combo aparece na lista de Orders com componentes corretamente; SaleDetails exibe slots e addons.

**Step 4: Commit**

```bash
git add delivery-saas-frontend/src/views/Orders.vue delivery-saas-frontend/src/views/SaleDetails.vue
git commit -m "feat(combo): exibir componentes do combo em Orders e SaleDetails"
```

---

## Fase C — Print Agent

### Task C1: Template — slot vs addon

**Files:**
- Modify: `delivery-print-agent-electron/src/defaultTemplate.js`
- (talvez) `delivery-print-agent-electron/src/templateEngine.js`

**Step 1: Preparar dados**

Idealmente, o backend (em `enrichOrderForAgent.js`) já entrega `item.options` com `kind`. Verificar se isso passa direto. Se sim, o template pode usar `{{#each options}}` + `{{#if isComboSlot}}` (após adicionar helper). Se não, adicionar enrichment no backend.

**Step 2: Ajustar `defaultTemplate.js`**

No bloco que itera options, distinguir:
- `kind === 'combo_slot'`: `  {{slotName}}: {{name}}`
- senão: `  + {{name}} ............. R$ {{price}}`

**Step 3: Test local com `test-render-local.js`**

Run: `cd delivery-print-agent-electron && node test-render-local.js`
Validar saída.

**Step 4: Commit**

```bash
git add delivery-print-agent-electron/src/defaultTemplate.js
git commit -m "feat(print-agent): renderizar slots de combo no cupom"
```

---

## Fase D — QA

### Task D1: Teste manual end-to-end

**Passos:**

1. Criar um combo no admin com 2 slots (Lanche, Bebida) e 2 opções cada, com `vUnComReferencia` diferentes por opção. Salvar.
2. Abrir cardápio público, adicionar o combo ao carrinho escolhendo combinações diferentes. Validar que o preço pago é sempre o do combo (fixo).
3. Adicionar 1 addon (Bacon extra +R$3). Subtotal deve subir R$3.
4. Finalizar o pedido. Verificar no banco: `OrderItem.options` tem `kind` e `vUnComReferencia`.
5. Emitir NFC-e em homologação. Conferir XML: 1 `<det>` por componente do slot + 1 `<det>` por addon, total fecha em (precoCombo + addons).
6. Conferir DANFE térmica impressa via print agent.
7. Disparar um webhook iFood de teste com SKU do combo. Conferir matcher categorizou subitens corretamente.
8. Emitir NFC-e do pedido iFood.

**Validar:**
- Soma dos `vProd` = total pago.
- `dadosFiscais` (NCM/CFOP) por componente conforme cadastro.
- Cupom térmico mostra `Lanche: X-Bacon`, `Bebida: Coca`, `+ Molho extra`.

### Task D2: Doc de operação curto

**Files:**
- Create: `docs/operacao/cadastrar-combo.md`

**Conteúdo:**
- Passo a passo do admin (capturas se possível).
- Diferença combo vs produto.
- Como migrar combo legado (criar novo, despublicar antigo).

**Commit:**
```bash
git add docs/operacao/cadastrar-combo.md
git commit -m "docs(operacao): cadastrar combo (passo a passo)"
```

---

## Notas finais

- Cada task é independente em termos de teste (commits frequentes).
- Após Fase A inteira, backend está completo e pode ser validado sem UI via cURL/Postman.
- Fase B só depende de A4 (rotas) e A6 (NFe expansion); pode rodar em paralelo com A7-A9 se quiser.
- Manter a regra: **uma migration por tarefa, commits pequenos, testes verdes antes de seguir**.
- Quando algo no schema mudar, o pipeline é: editar `schema.prisma` → `prisma db push` → `prisma generate` → reiniciar container do backend.
