# CMV correto, Sugestão de Preço e Saúde Global — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Corrigir o cálculo de CMV via snapshot de custo no consumo, adicionar calculadora de preço sugerido por produto e entregar painel consolidado de saúde global do negócio.

**Architecture:** 3 fases sequenciais e reversíveis. Fase 1 corrige a base (snapshot `unitCost` no `OUT`, reversão em cancelamento, `calculateCMV` baseado em consumo). Fase 2 adiciona `StorePricingDefaults` + cálculo de preço sugerido (ProductForm + StoreSettings). Fase 3 consome Fases 1+2 num único endpoint `business-health` e nova view default do módulo Financeiro.

**Tech Stack:** Express.js (ESM) + Prisma + PostgreSQL (backend), Vue 3 + Bootstrap 5 + Pinia + axios (frontend), `node --test` (tests).

**Design doc:** [2026-04-15-cmv-pricing-business-health-design.md](2026-04-15-cmv-pricing-business-health-design.md)

**Dev environment:** Docker (`docker compose up -d`). Backend port 3000, frontend 5173, db 5433. Schema: `delivery-saas-backend/prisma/schema.prisma`. Após editar schema rodar `npx prisma db push --skip-generate` dentro do container backend.

---

## FASE 1 — Fundação (CMV correto)

### Task 1.1: Schema — `reversedAt` / `reversedBy` em `StockMovement`

**Files:**
- Modify: `delivery-saas-backend/prisma/schema.prisma:1529-1544`

**Step 1: Adicionar campos**

Em `model StockMovement`, depois de `note String?` e antes de `createdAt`:

```prisma
  reversedAt      DateTime?
  reversedBy      String?
```

**Step 2: Aplicar no banco dev**

```bash
docker compose exec backend npx prisma db push --skip-generate
docker compose exec backend npx prisma generate
```

Expected: "The database is now in sync with the Prisma schema."

**Step 3: Verificar coluna criada**

```bash
docker compose exec db psql -U postgres -d projetodelivery -c "\d \"StockMovement\"" | grep reversed
```

Expected: duas linhas `reversedAt | timestamp` e `reversedBy | text`.

**Step 4: Commit**

```bash
git add delivery-saas-backend/prisma/schema.prisma
git commit -m "feat(stock): add reversedAt/reversedBy to StockMovement"
```

---

### Task 1.2: Snapshot de `unitCost` no OUT em `stockFromOrder.js`

**Files:**
- Modify: `delivery-saas-backend/src/services/stockFromOrder.js:187-198`
- Test: `delivery-saas-backend/tests/stockFromOrder.snapshot.test.mjs`

**Step 1: Escrever teste falhante**

Criar `delivery-saas-backend/tests/stockFromOrder.snapshot.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAndPersistStockMovementFromOrderItems } from '../src/services/stockFromOrder.js';

// Mock prisma in-memory: registra ingrediente com avgCost, produto com ficha,
// chama a função, valida que o StockMovementItem criado tem unitCost = avgCost do ingrediente no momento.
test('OUT movement snapshots ingredient.avgCost into StockMovementItem.unitCost', async () => {
  const ingredient = { id: 'ing1', avgCost: 12.50, controlsStock: true, unit: 'GR', currentStock: 1000 };
  const sheet = { id: 's1', items: [{ ingredientId: 'ing1', quantity: 100, unit: 'GR', ingredient }] };
  const product = { id: 'p1', companyId: 'c1', technicalSheetId: 's1' };

  const created = [];
  const prismaMock = {
    product: { findFirst: async () => product },
    technicalSheet: { findUnique: async () => sheet },
    ingredient: { findUnique: async () => ingredient, update: async () => {} },
    stockMovement: { create: async ({ data }) => ({ id: 'mv1', ...data }), findUnique: async () => ({ id: 'mv1', items: created }) },
    stockMovementItem: { create: async ({ data }) => { created.push(data); return data; } },
    productOptionGroup: { findMany: async () => [] },
    $transaction: async (fn) => fn(prismaMock),
  };

  await buildAndPersistStockMovementFromOrderItems(prismaMock, {
    id: 'o1', companyId: 'c1', items: [{ productId: 'p1', quantity: 1 }],
  });

  assert.equal(created.length, 1);
  assert.equal(Number(created[0].unitCost), 12.50);
});
```

**Step 2: Rodar teste para confirmar falha**

```bash
docker compose exec backend node --test tests/stockFromOrder.snapshot.test.mjs
```

Expected: FAIL — `unitCost` é `null`.

**Step 3: Implementar snapshot**

Em `delivery-saas-backend/src/services/stockFromOrder.js:193`, trocar:

```js
await tx.stockMovementItem.create({ data: { stockMovementId: movement.id, ingredientId: it.ingredientId, quantity: qty, unitCost: null } });
```

por:

```js
await tx.stockMovementItem.create({ data: { stockMovementId: movement.id, ingredientId: it.ingredientId, quantity: qty, unitCost: ingredient.avgCost ?? null } });
```

(O `ingredient` já é lido logo acima — `tx.ingredient.findUnique(...)` em `:190`.)

**Step 4: Rodar teste para confirmar passagem**

```bash
docker compose exec backend node --test tests/stockFromOrder.snapshot.test.mjs
```

Expected: PASS.

**Step 5: Commit**

```bash
git add delivery-saas-backend/src/services/stockFromOrder.js delivery-saas-backend/tests/stockFromOrder.snapshot.test.mjs
git commit -m "feat(stock): snapshot ingredient avgCost into OUT movement items"
```

---

### Task 1.3: Função `reverseStockMovementForOrder`

**Files:**
- Modify: `delivery-saas-backend/src/services/stockFromOrder.js` (adicionar export ao final)
- Test: `delivery-saas-backend/tests/stockFromOrder.reverse.test.mjs`

**Step 1: Escrever teste falhante**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reverseStockMovementForOrder } from '../src/services/stockFromOrder.js';

test('reverseStockMovementForOrder creates IN mirror and marks original OUT reversed', async () => {
  const original = {
    id: 'mv-out', type: 'OUT', companyId: 'c1', storeId: null, note: 'Order:o1',
    reversedAt: null,
    items: [{ ingredientId: 'ing1', quantity: 100, unitCost: 12.5 }],
  };
  const updates = [];
  const inserts = [];
  const prismaMock = {
    stockMovement: {
      findFirst: async () => original,
      update: async ({ where, data }) => { updates.push({ where, data }); return { ...original, ...data }; },
      create: async ({ data }) => { inserts.push(data); return { id: 'mv-in', ...data }; },
    },
    stockMovementItem: { create: async () => {} },
    ingredient: {
      findUnique: async () => ({ id: 'ing1', currentStock: 900 }),
      update: async () => {},
    },
    $transaction: async (fn) => fn(prismaMock),
  };

  const result = await reverseStockMovementForOrder(prismaMock, 'o1', 'user-1');
  assert.ok(result, 'returns the new IN movement');
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0].type, 'IN');
  assert.equal(inserts[0].note, 'Reverse:Order:o1');
  assert.equal(updates.length, 1);
  assert.equal(updates[0].data.reversedBy, 'user-1');
  assert.ok(updates[0].data.reversedAt instanceof Date);
});

test('reverseStockMovementForOrder is idempotent (returns null if already reversed)', async () => {
  const prismaMock = { stockMovement: { findFirst: async () => null } };
  const result = await reverseStockMovementForOrder(prismaMock, 'o1', 'user-1');
  assert.equal(result, null);
});
```

**Step 2: Rodar teste para confirmar falha**

```bash
docker compose exec backend node --test tests/stockFromOrder.reverse.test.mjs
```

Expected: FAIL — função não existe.

**Step 3: Implementar a função**

Adicionar em `delivery-saas-backend/src/services/stockFromOrder.js` (antes do `export default`):

```js
export async function reverseStockMovementForOrder(prismaInstance, orderId, userId = null) {
  const original = await prismaInstance.stockMovement.findFirst({
    where: { type: 'OUT', note: `Order:${orderId}`, reversedAt: null },
    include: { items: true },
  });
  if (!original) return null;

  return await prismaInstance.$transaction(async (tx) => {
    const reverseMv = await tx.stockMovement.create({
      data: {
        companyId: original.companyId,
        storeId: original.storeId,
        type: 'IN',
        reason: 'Cancelamento de pedido',
        note: `Reverse:Order:${orderId}`,
      },
    });
    for (const it of original.items) {
      await tx.stockMovementItem.create({
        data: {
          stockMovementId: reverseMv.id,
          ingredientId: it.ingredientId,
          quantity: it.quantity,
          unitCost: it.unitCost,
        },
      });
      const ing = await tx.ingredient.findUnique({ where: { id: it.ingredientId } });
      if (ing) {
        await tx.ingredient.update({
          where: { id: it.ingredientId },
          data: { currentStock: Number(ing.currentStock || 0) + Number(it.quantity) },
        });
      }
    }
    await tx.stockMovement.update({
      where: { id: original.id },
      data: { reversedAt: new Date(), reversedBy: userId },
    });
    return reverseMv;
  });
}
```

**Step 4: Rodar teste para confirmar passagem**

```bash
docker compose exec backend node --test tests/stockFromOrder.reverse.test.mjs
```

Expected: PASS (2/2).

**Step 5: Commit**

```bash
git add delivery-saas-backend/src/services/stockFromOrder.js delivery-saas-backend/tests/stockFromOrder.reverse.test.mjs
git commit -m "feat(stock): reverseStockMovementForOrder for cancelled orders"
```

---

### Task 1.4: Disparar reversão quando pedido é cancelado

**Files:**
- Modify: `delivery-saas-backend/src/routes/orders.js` (encontrar o handler que muda status para CANCELLED)
- Modify: `delivery-saas-backend/src/services/ifoodWebhookProcessor.js` (status CANCELLED via webhook)

**Step 1: Localizar pontos de cancelamento**

```bash
grep -n "CANCELLED\|cancel" delivery-saas-backend/src/routes/orders.js | head -20
grep -n "CANCELLED\|cancel" delivery-saas-backend/src/services/ifoodWebhookProcessor.js | head -20
```

Identifique todos os trechos onde `order.status` é setado para `CANCELLED` (ou equivalente). Anote os números de linha.

**Step 2: Importar a função**

Em ambos os arquivos, garantir que o import inclua `reverseStockMovementForOrder`:

```js
import { buildAndPersistStockMovementFromOrderItems, reverseStockMovementForOrder } from '../services/stockFromOrder.js';
```

(Em `ifoodWebhookProcessor.js` o caminho relativo é o mesmo; ajuste se necessário.)

**Step 3: Adicionar chamada após o update do status**

Após cada `prisma.order.update({ ... status: 'CANCELLED' ... })`, adicionar:

```js
try {
  await reverseStockMovementForOrder(prisma, order.id, req?.user?.id || null);
} catch (e) {
  console.warn('reverseStockMovementForOrder failed for', order.id, e?.message);
}
```

(Em contextos sem `req`, passar `null` como userId.)

**Step 4: Teste manual**

1. Criar pedido via UI ou API com produto que tem ficha técnica.
2. Verificar `currentStock` do ingrediente: caiu.
3. Cancelar o pedido.
4. Verificar `currentStock`: voltou ao valor original.
5. Verificar tabela: `SELECT id, type, note, "reversedAt" FROM "StockMovement" WHERE note LIKE '%<orderId>%';` — deve mostrar 2 linhas (OUT com reversedAt preenchido, IN com note `Reverse:Order:...`).

**Step 5: Commit**

```bash
git add delivery-saas-backend/src/routes/orders.js delivery-saas-backend/src/services/ifoodWebhookProcessor.js
git commit -m "feat(orders): trigger stock reversal on order cancellation"
```

---

### Task 1.5: Reescrever `calculateCMV` (consumo) e adicionar `calculatePurchases`

**Files:**
- Modify: `delivery-saas-backend/src/routes/financial/reports.js:196-244`
- Test: `delivery-saas-backend/tests/financial.cmv.test.mjs`

**Step 1: Escrever teste falhante**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateCMV, calculatePurchases } from '../src/routes/financial/reports.js';

test('calculateCMV sums OUT items × unitCost where ingredient.composesCmv and not reversed', async () => {
  const prismaMock = {
    stockMovement: {
      findMany: async ({ where }) => {
        assert.equal(where.type, 'OUT');
        assert.deepEqual(where.reversedAt, null);
        return [
          { id: 'm1', createdAt: new Date(), items: [
            { ingredientId: 'a', quantity: 100, unitCost: 0.5, ingredient: { composesCmv: true, description: 'Farinha', unit: 'GR' } },
            { ingredientId: 'b', quantity: 10, unitCost: 2.0, ingredient: { composesCmv: false, description: 'Decoração', unit: 'UN' } },
          ]},
        ];
      },
    },
  };
  const r = await calculateCMV(prismaMock, 'c1', new Date('2026-01-01'), new Date('2026-12-31'), null);
  assert.equal(r.total, -50); // negativo: subtrai do lucro
  assert.equal(r.details.length, 1);
});

test('calculatePurchases sums IN items × unitCost (legacy purchases view)', async () => {
  const prismaMock = {
    stockMovement: {
      findMany: async ({ where }) => {
        assert.equal(where.type, 'IN');
        return [{ id: 'm2', createdAt: new Date(), items: [
          { ingredientId: 'a', quantity: 1000, unitCost: 0.5, ingredient: { composesCmv: true, description: 'Farinha', unit: 'GR' } },
        ]}];
      },
    },
  };
  const r = await calculatePurchases(prismaMock, 'c1', new Date('2026-01-01'), new Date('2026-12-31'), null);
  assert.equal(r.total, 500);
});
```

**Step 2: Rodar teste para confirmar falha**

```bash
docker compose exec backend node --test tests/financial.cmv.test.mjs
```

Expected: FAIL — `calculatePurchases` não existe; `calculateCMV` ainda usa `IN`.

**Step 3: Reescrever `calculateCMV`**

Em `delivery-saas-backend/src/routes/financial/reports.js:196`, substituir a função `calculateCMV` por:

```js
export async function calculateCMV(prismaArg, companyId, from, to, storeId) {
  const prismaInstance = prismaArg && prismaArg.stockMovement ? prismaArg : prisma;
  // Para manter compat com chamadas existentes que passam (companyId, from, to, storeId):
  if (typeof prismaArg === 'string') {
    return calculateCMV(prisma, prismaArg, companyId, from, to);
  }
  try {
    const mvWhere = {
      companyId,
      type: 'OUT',
      reversedAt: null,
      createdAt: { gte: from, lte: to },
    };
    if (storeId) mvWhere.storeId = storeId;

    const movements = await prismaInstance.stockMovement.findMany({
      where: mvWhere,
      include: {
        items: { include: { ingredient: { select: { id: true, description: true, composesCmv: true, unit: true } } } },
      },
    });

    let total = 0;
    const details = [];
    for (const mv of movements) {
      for (const item of mv.items) {
        if (!item.ingredient?.composesCmv) continue;
        if (item.unitCost == null) continue; // pré-snapshot: ignora
        const cost = Number(item.quantity) * Number(item.unitCost);
        total += cost;
        details.push({
          ingredientId: item.ingredientId,
          description: item.ingredient.description,
          unit: item.ingredient.unit,
          quantity: Number(item.quantity),
          unitCost: Number(item.unitCost),
          totalCost: cost,
          movementDate: mv.createdAt,
        });
      }
    }
    return { total: -total, details, period: { from, to } };
  } catch (e) {
    console.error('calculateCMV error:', e);
    return { total: 0, details: [], error: e?.message };
  }
}

export async function calculatePurchases(prismaInstance, companyId, from, to, storeId) {
  try {
    const mvWhere = { companyId, type: 'IN', createdAt: { gte: from, lte: to } };
    if (storeId) mvWhere.storeId = storeId;
    const movements = await prismaInstance.stockMovement.findMany({
      where: mvWhere,
      include: { items: { include: { ingredient: { select: { composesCmv: true } } } } },
    });
    let total = 0;
    for (const mv of movements) {
      for (const item of mv.items) {
        if (!item.ingredient?.composesCmv) continue;
        total += Number(item.quantity) * Number(item.unitCost || 0);
      }
    }
    return { total, period: { from, to } };
  } catch (e) {
    console.error('calculatePurchases error:', e);
    return { total: 0, error: e?.message };
  }
}
```

E ajustar a chamada em `:81` no handler `/dre`:

```js
const cmv = await calculateCMV(prisma, companyId, from, to, storeId);
```

**Step 4: Rodar teste para confirmar passagem**

```bash
docker compose exec backend node --test tests/financial.cmv.test.mjs
```

Expected: PASS (2/2).

**Step 5: Validação manual no DRE**

Subir backend, abrir `GET /financial/reports/cmv?dateFrom=2026-04-01&dateTo=2026-04-30` (com auth) e conferir que o número agora reflete vendas, não compras.

**Step 6: Commit**

```bash
git add delivery-saas-backend/src/routes/financial/reports.js delivery-saas-backend/tests/financial.cmv.test.mjs
git commit -m "fix(financial): CMV based on consumption (OUT × unitCost) instead of purchases"
```

---

### Task 1.6: Endpoint `GET /financial/reports/cmv-by-product`

**Files:**
- Modify: `delivery-saas-backend/src/routes/financial/reports.js` (adicionar handler)
- Test: `delivery-saas-backend/tests/financial.cmvByProduct.test.mjs`

**Step 1: Escrever teste falhante**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateCmvByProduct } from '../src/routes/financial/reports.js';

test('calculateCmvByProduct aggregates OUT cost by product via Order linkage', async () => {
  const prismaMock = {
    stockMovement: {
      findMany: async () => [
        { id: 'mv1', note: 'Order:o1', items: [
          { quantity: 100, unitCost: 0.5, ingredient: { composesCmv: true } },
        ]},
      ],
    },
    order: {
      findUnique: async ({ where }) => ({
        id: where.id,
        items: [{ productId: 'p1', quantity: 2, totalPrice: 30 }],
      }),
    },
    product: { findUnique: async ({ where }) => ({ id: where.id, name: 'X-Bacon', price: 15 }) },
  };
  const r = await calculateCmvByProduct(prismaMock, 'c1', new Date('2026-01-01'), new Date('2026-12-31'), null);
  assert.ok(Array.isArray(r));
  assert.equal(r.length, 1);
  assert.equal(r[0].productId, 'p1');
  assert.equal(r[0].cmvTotal, 50);
  assert.equal(r[0].revenueTotal, 30);
  assert.ok(Math.abs(r[0].marginPct - ((30 - 50) / 30) * 100) < 0.01);
});
```

**Step 2: Rodar teste para confirmar falha**

```bash
docker compose exec backend node --test tests/financial.cmvByProduct.test.mjs
```

Expected: FAIL — função inexistente.

**Step 3: Implementar `calculateCmvByProduct` + handler**

Adicionar em `reports.js`:

```js
export async function calculateCmvByProduct(prismaInstance, companyId, from, to, storeId) {
  const mvWhere = { companyId, type: 'OUT', reversedAt: null, createdAt: { gte: from, lte: to } };
  if (storeId) mvWhere.storeId = storeId;
  const movements = await prismaInstance.stockMovement.findMany({ where: mvWhere });

  // mv.note formato 'Order:<id>' — extrair orderId, somar custo total do movimento
  const cmvByOrder = new Map();
  for (const mv of movements) {
    if (!mv.note?.startsWith('Order:')) continue;
    const orderId = mv.note.slice('Order:'.length);
    let mvCost = 0;
    for (const it of mv.items || []) {
      if (it.unitCost == null) continue;
      mvCost += Number(it.quantity) * Number(it.unitCost);
    }
    cmvByOrder.set(orderId, (cmvByOrder.get(orderId) || 0) + mvCost);
  }

  // Para cada order, distribuir CMV pelos products proporcionalmente à receita
  const byProduct = new Map();
  for (const [orderId, orderCmv] of cmvByOrder.entries()) {
    const order = await prismaInstance.order.findUnique({
      where: { id: orderId },
      select: { items: true },
    }).catch(() => null);
    if (!order || !Array.isArray(order.items)) continue;
    const orderRevenue = order.items.reduce((s, it) => s + Number(it.totalPrice || 0), 0) || 1;
    for (const it of order.items) {
      const productId = it.productId;
      if (!productId) continue;
      const share = Number(it.totalPrice || 0) / orderRevenue;
      const entry = byProduct.get(productId) || { productId, qtySold: 0, cmvTotal: 0, revenueTotal: 0 };
      entry.qtySold += Number(it.quantity || 0);
      entry.cmvTotal += orderCmv * share;
      entry.revenueTotal += Number(it.totalPrice || 0);
      byProduct.set(productId, entry);
    }
  }

  // Hidratar nome do produto e calcular margens
  const result = [];
  for (const entry of byProduct.values()) {
    const product = await prismaInstance.product.findUnique({ where: { id: entry.productId }, select: { name: true } }).catch(() => null);
    const marginAbs = entry.revenueTotal - entry.cmvTotal;
    const marginPct = entry.revenueTotal ? (marginAbs / entry.revenueTotal) * 100 : 0;
    result.push({ ...entry, productName: product?.name || '?', marginAbs, marginPct });
  }
  return result;
}
```

E o handler:

```js
router.get('/cmv-by-product', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { dateFrom, dateTo, storeId } = req.query;
    if (!dateFrom || !dateTo) return res.status(400).json({ message: 'dateFrom e dateTo são obrigatórios' });
    const data = await calculateCmvByProduct(prisma, companyId, new Date(dateFrom), new Date(dateTo), storeId);
    res.json(data);
  } catch (e) {
    console.error('GET /financial/reports/cmv-by-product error:', e);
    res.status(500).json({ message: 'Erro ao calcular CMV por produto', error: e?.message });
  }
});
```

**Step 4: Rodar teste**

```bash
docker compose exec backend node --test tests/financial.cmvByProduct.test.mjs
```

Expected: PASS.

**Step 5: Commit**

```bash
git add delivery-saas-backend/src/routes/financial/reports.js delivery-saas-backend/tests/financial.cmvByProduct.test.mjs
git commit -m "feat(financial): GET /financial/reports/cmv-by-product"
```

---

## FASE 2 — Sugestão de Preço

### Task 2.1: Schema — `StorePricingDefaults` + campos em `Product`

**Files:**
- Modify: `delivery-saas-backend/prisma/schema.prisma`

**Step 1: Adicionar modelo + relação**

Localizar `model Store` e adicionar a relação reversa:

```prisma
  pricingDefaults StorePricingDefaults?
```

Localizar `model Product` e adicionar:

```prisma
  packagingCost        Decimal?
  targetMarginPercent  Decimal?
```

No final do arquivo (próximo aos outros models de configuração):

```prisma
model StorePricingDefaults {
  storeId               String   @id
  store                 Store    @relation(fields: [storeId], references: [id])

  salesTaxPercent       Decimal  @default(0)
  salesTaxLabel         String?

  marketplaceFeePercent Decimal  @default(0)
  cardFeePercent        Decimal  @default(0)

  defaultPackagingCost  Decimal  @default(0)

  targetMarginPercent   Decimal  @default(30)

  cmvHealthyMin         Decimal  @default(25)
  cmvHealthyMax         Decimal  @default(35)
  cmvCriticalAbove      Decimal  @default(40)

  updatedAt             DateTime @updatedAt
}
```

**Step 2: Aplicar e regenerar**

```bash
docker compose exec backend npx prisma db push --skip-generate
docker compose exec backend npx prisma generate
```

Expected: "in sync".

**Step 3: Verificar**

```bash
docker compose exec db psql -U postgres -d projetodelivery -c "\d \"StorePricingDefaults\""
docker compose exec db psql -U postgres -d projetodelivery -c "\d \"Product\"" | grep -E "packagingCost|targetMarginPercent"
```

Expected: tabela criada e duas colunas novas em Product.

**Step 4: Commit**

```bash
git add delivery-saas-backend/prisma/schema.prisma
git commit -m "feat(pricing): StorePricingDefaults + product overrides"
```

---

### Task 2.2: Rotas `GET/PUT /stores/:id/pricing-defaults`

**Files:**
- Create: `delivery-saas-backend/src/routes/storePricingDefaults.js`
- Modify: `delivery-saas-backend/src/server.js` ou onde rotas são registradas (achar com `grep -n "stores" delivery-saas-backend/src/server.js`)
- Test: `delivery-saas-backend/tests/storePricingDefaults.test.mjs`

**Step 1: Escrever teste falhante**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getOrCreateDefaults, applyUpdate } from '../src/routes/storePricingDefaults.js';

test('getOrCreateDefaults returns existing or creates with defaults', async () => {
  const created = [];
  const prismaMock = {
    storePricingDefaults: {
      findUnique: async () => null,
      create: async ({ data }) => { created.push(data); return data; },
    },
  };
  const r = await getOrCreateDefaults(prismaMock, 'store-1');
  assert.equal(created.length, 1);
  assert.equal(r.storeId, 'store-1');
  assert.equal(Number(r.targetMarginPercent), 30);
});

test('applyUpdate validates numeric ranges', async () => {
  await assert.rejects(() => applyUpdate({}, 'store-1', { targetMarginPercent: -5 }), /targetMarginPercent/);
  await assert.rejects(() => applyUpdate({}, 'store-1', { cmvHealthyMin: 50, cmvHealthyMax: 30 }), /cmvHealthy/);
});
```

**Step 2: Rodar teste**

```bash
docker compose exec backend node --test tests/storePricingDefaults.test.mjs
```

Expected: FAIL — módulo não existe.

**Step 3: Implementar**

Criar `delivery-saas-backend/src/routes/storePricingDefaults.js`:

```js
import express from 'express';
import { prisma } from '../prisma.js';

const router = express.Router();

const DEFAULTS = {
  salesTaxPercent: 0, salesTaxLabel: null,
  marketplaceFeePercent: 0, cardFeePercent: 0,
  defaultPackagingCost: 0, targetMarginPercent: 30,
  cmvHealthyMin: 25, cmvHealthyMax: 35, cmvCriticalAbove: 40,
};

export async function getOrCreateDefaults(prismaInstance, storeId) {
  const existing = await prismaInstance.storePricingDefaults.findUnique({ where: { storeId } });
  if (existing) return existing;
  return await prismaInstance.storePricingDefaults.create({ data: { storeId, ...DEFAULTS } });
}

export async function applyUpdate(prismaInstance, storeId, body) {
  const numFields = ['salesTaxPercent','marketplaceFeePercent','cardFeePercent','defaultPackagingCost','targetMarginPercent','cmvHealthyMin','cmvHealthyMax','cmvCriticalAbove'];
  const data = {};
  for (const f of numFields) {
    if (body[f] != null) {
      const n = Number(body[f]);
      if (Number.isNaN(n) || n < 0) throw new Error(`Campo inválido: ${f}`);
      data[f] = n;
    }
  }
  if (body.salesTaxLabel != null) data.salesTaxLabel = String(body.salesTaxLabel);
  const min = data.cmvHealthyMin ?? null, max = data.cmvHealthyMax ?? null;
  if (min != null && max != null && min >= max) throw new Error('cmvHealthyMin deve ser menor que cmvHealthyMax');
  return await prismaInstance.storePricingDefaults.update({ where: { storeId }, data });
}

router.get('/:storeId/pricing-defaults', async (req, res) => {
  try {
    const data = await getOrCreateDefaults(prisma, req.params.storeId);
    res.json(data);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

router.put('/:storeId/pricing-defaults', async (req, res) => {
  try {
    await getOrCreateDefaults(prisma, req.params.storeId);
    const data = await applyUpdate(prisma, req.params.storeId, req.body || {});
    res.json(data);
  } catch (e) { res.status(400).json({ message: e.message }); }
});

export default router;
```

Registrar em `server.js` (achar onde `/stores` é montado e adicionar):

```js
import storePricingDefaultsRouter from './routes/storePricingDefaults.js';
app.use('/stores', authMiddleware, storePricingDefaultsRouter);
```

(use exatamente o padrão de auth/middleware existente; veja como `/stores` é montado hoje.)

**Step 4: Rodar teste**

```bash
docker compose exec backend node --test tests/storePricingDefaults.test.mjs
```

Expected: PASS.

**Step 5: Commit**

```bash
git add delivery-saas-backend/src/routes/storePricingDefaults.js delivery-saas-backend/src/server.js delivery-saas-backend/tests/storePricingDefaults.test.mjs
git commit -m "feat(pricing): GET/PUT /stores/:id/pricing-defaults"
```

---

### Task 2.3: Endpoint `GET /products/:id/pricing-analysis`

**Files:**
- Modify: `delivery-saas-backend/src/routes/products.js` (adicionar handler — confirmar caminho com `grep -rln "products.js" delivery-saas-backend/src/routes`)
- Create: `delivery-saas-backend/src/services/pricingAnalysis.js`
- Test: `delivery-saas-backend/tests/pricingAnalysis.test.mjs`

**Step 1: Escrever teste falhante**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePricingAnalysis } from '../src/services/pricingAnalysis.js';

test('computePricingAnalysis applies override + tax + margin correctly', () => {
  const r = computePricingAnalysis({
    currentPrice: 16.90,
    sheetCost: 8,
    productPackagingCost: null,
    productTargetMargin: null,
    storeDefaults: {
      defaultPackagingCost: 1, targetMarginPercent: 30,
      salesTaxPercent: 6, marketplaceFeePercent: 12, cardFeePercent: 3.5,
      cmvHealthyMin: 25, cmvHealthyMax: 35, cmvCriticalAbove: 40,
    },
  });
  assert.equal(r.packagingCost, 1);
  assert.equal(r.targetMarginPercent, 30);
  assert.equal(r.taxBreakdown.totalDeductionPct, 21.5);
  assert.ok(Math.abs(r.suggestedPrice - 18.5567) < 0.01);
  assert.equal(r.cmvStatus, 'critical'); // 8/16.90 = 47.3%
});
```

**Step 2: Rodar teste**

Expected: FAIL.

**Step 3: Implementar**

`delivery-saas-backend/src/services/pricingAnalysis.js`:

```js
export function computePricingAnalysis({ currentPrice, sheetCost, productPackagingCost, productTargetMargin, storeDefaults }) {
  const C = Number(sheetCost || 0);
  const E = Number(productPackagingCost ?? storeDefaults.defaultPackagingCost ?? 0);
  const M = Number(productTargetMargin ?? storeDefaults.targetMarginPercent ?? 0);
  const taxes = {
    salesTax: Number(storeDefaults.salesTaxPercent || 0),
    marketplaceFee: Number(storeDefaults.marketplaceFeePercent || 0),
    cardFee: Number(storeDefaults.cardFeePercent || 0),
  };
  const totalDeductionPct = taxes.salesTax + taxes.marketplaceFee + taxes.cardFee;
  const denom = 1 - (totalDeductionPct + M) / 100;
  const suggestedPrice = denom > 0 ? (C + E) / denom : null;
  const price = Number(currentPrice || 0);
  const cmvPercent = price > 0 ? (C / price) * 100 : null;
  const min = Number(storeDefaults.cmvHealthyMin || 0);
  const max = Number(storeDefaults.cmvHealthyMax || 0);
  const crit = Number(storeDefaults.cmvCriticalAbove || 0);
  let cmvStatus = 'unknown';
  if (cmvPercent != null) {
    if (cmvPercent > crit) cmvStatus = 'critical';
    else if (cmvPercent > max) cmvStatus = 'warning';
    else if (cmvPercent >= min) cmvStatus = 'healthy';
    else cmvStatus = 'over_priced'; // CMV abaixo da faixa: pode estar caro demais
  }
  const actualMarginPercent = price > 0 ? ((price - C - E) / price) * 100 - totalDeductionPct : null;
  return {
    currentPrice: price,
    sheetCost: C,
    packagingCost: E,
    taxBreakdown: { ...taxes, totalDeductionPct },
    targetMarginPercent: M,
    suggestedPrice,
    delta: suggestedPrice != null && price ? price - suggestedPrice : null,
    cmvPercent,
    cmvStatus,
    actualMarginPercent,
  };
}
```

E em `routes/products.js` adicionar handler:

```js
import { computePricingAnalysis } from '../services/pricingAnalysis.js';
import { getOrCreateDefaults } from './storePricingDefaults.js';

router.get('/:id/pricing-analysis', async (req, res) => {
  try {
    const product = await prisma.product.findFirst({
      where: { id: req.params.id, companyId: req.user.companyId },
      include: { technicalSheet: { include: { items: { include: { ingredient: true } } } } },
    });
    if (!product) return res.status(404).json({ message: 'Produto não encontrado' });

    // Calcular sheetCost (Σ items × ingredient.avgCost com conversão de unidade — reutilizar util já existente em stockFromOrder)
    let sheetCost = 0;
    for (const si of product.technicalSheet?.items || []) {
      if (si.ingredient) sheetCost += Number(si.quantity || 0) * Number(si.ingredient.avgCost || 0);
      // (Se houver normalização de unidade, reaproveitar normalizeToIngredientUnit)
    }

    const storeId = product.storeId || (await prisma.store.findFirst({ where: { companyId: req.user.companyId } }))?.id;
    const storeDefaults = await getOrCreateDefaults(prisma, storeId);

    const analysis = computePricingAnalysis({
      currentPrice: product.price,
      sheetCost,
      productPackagingCost: product.packagingCost,
      productTargetMargin: product.targetMarginPercent,
      storeDefaults,
    });
    res.json(analysis);
  } catch (e) {
    console.error('GET pricing-analysis error:', e);
    res.status(500).json({ message: e.message });
  }
});
```

**Step 4: Rodar teste**

```bash
docker compose exec backend node --test tests/pricingAnalysis.test.mjs
```

Expected: PASS.

**Step 5: Commit**

```bash
git add delivery-saas-backend/src/services/pricingAnalysis.js delivery-saas-backend/src/routes/products.js delivery-saas-backend/tests/pricingAnalysis.test.mjs
git commit -m "feat(pricing): GET /products/:id/pricing-analysis"
```

---

### Task 2.4: UI — Aba "Precificação" no `ProductForm.vue`

**Files:**
- Modify: `delivery-saas-frontend/src/views/ProductForm.vue`
- Create: `delivery-saas-frontend/src/components/PricingPanel.vue`

**REQUIRED SUB-SKILL:** Use `frontend-deliverywl` para garantir aderência ao design system (Bootstrap 5, `<TextInput>`, `<CurrencyInput>`, espaçamento, badges).

**Step 1: Criar componente isolado**

`delivery-saas-frontend/src/components/PricingPanel.vue` que recebe `productId` e `currentPrice` como props e:

- chama `GET /products/:id/pricing-analysis` no mount e quando `currentPrice` muda
- renderiza as 4 seções: Composição de custo, Deduções, Margem-alvo, Resultado
- emite `apply-suggested-price` (number) quando usuário clica no botão

Seções (ver design doc 2.4 para layout):
1. Card "Composição de custo" — linhas de ficha técnica + embalagem + total
2. Card "Deduções" — read-only com link para configurações da loja
3. Card "Margem-alvo" — slider (0–80) com input vinculado, override por produto via checkbox
4. Card "Resultado" — preço sugerido + delta colorido + CMV% com badge (`bg-success`/`bg-warning`/`bg-danger`) + botão "Aplicar preço sugerido"

Seguir convenções: usar `<TextInput>`, `<CurrencyInput>`, `<SelectInput>`. Cards em `card p-3 mb-3 bg-light`. Badges Bootstrap.

**Step 2: Adicionar tab no `ProductForm.vue`**

Em `ProductForm.vue:6-13` adicionar terceiro `<li>`:

```html
<li class="nav-item" role="presentation">
  <button :class="['nav-link', { active: activeTab === 'pricing' }]" type="button" @click="activeTab = 'pricing'">PRECIFICAÇÃO</button>
</li>
```

Adicionar tab pane após o de "marketplace":

```html
<div :class="['tab-pane', activeTab === 'pricing' ? 'show active' : '']" role="tabpanel">
  <PricingPanel
    v-if="isEdit"
    :product-id="productId"
    :current-price="form.price"
    @apply-suggested-price="form.price = $event"
  />
  <div v-else class="alert alert-info">Salve o produto primeiro para ver a análise de precificação.</div>
</div>
```

Importar `PricingPanel`.

**Step 3: Validação manual**

1. Subir frontend (`docker compose up`).
2. Editar produto com ficha técnica.
3. Abrir aba PRECIFICAÇÃO. Verificar:
   - Custo da ficha bate com o calculado
   - Mudar preço no card resultado → CMV% recalcula
   - Slider de margem altera preço sugerido
   - Botão "Aplicar preço sugerido" preenche o campo "Preço" da aba Geral
4. Testar com produto sem ficha técnica → custo zero, sem semáforo.
5. Testar produto novo (não salvo) → mostra alerta amigável.

**Step 4: Commit**

```bash
git add delivery-saas-frontend/src/components/PricingPanel.vue delivery-saas-frontend/src/views/ProductForm.vue
git commit -m "feat(ui): pricing panel tab in ProductForm"
```

---

### Task 2.5: UI — Aba "Precificação" em `StoreSettings`

**Files:**
- Identificar arquivo: `grep -rln "StoreSettings\|store-settings" delivery-saas-frontend/src/views`
- Modify: arquivo encontrado (provavelmente `delivery-saas-frontend/src/views/StoreSettings.vue` ou similar)

**Step 1: Localizar tela de Settings da loja**

```bash
grep -rln "tab" delivery-saas-frontend/src/views | xargs grep -l "loja\|Store" | head -5
```

Anotar o arquivo correto.

**Step 2: Adicionar nova aba "Precificação"**

Seguindo o padrão das abas existentes (Bootstrap nav-tabs), adicionar:

- Form com 9 campos: `salesTaxPercent`, `salesTaxLabel`, `marketplaceFeePercent`, `cardFeePercent`, `defaultPackagingCost`, `targetMarginPercent`, `cmvHealthyMin`, `cmvHealthyMax`, `cmvCriticalAbove`
- Carregar via `GET /stores/:id/pricing-defaults` no mount.
- Salvar via `PUT /stores/:id/pricing-defaults`.
- Toast de sucesso/erro padrão do projeto.

Layout em 3 fieldsets:
- **Impostos sobre venda** — `salesTaxPercent` + `salesTaxLabel`
- **Taxas operacionais médias** — `marketplaceFeePercent` + `cardFeePercent`
- **Defaults de produto** — `defaultPackagingCost` + `targetMarginPercent`
- **Faixas de saúde de CMV** — `cmvHealthyMin` / `cmvHealthyMax` / `cmvCriticalAbove`

Validação client-side: min < max < critical; nenhum valor < 0.

**Step 3: Validação manual**

1. Abrir Configurações da Loja → aba Precificação.
2. Editar valores, salvar.
3. Recarregar — valores persistem.
4. Voltar ao ProductForm e abrir aba Precificação — deduções refletem novos valores.

**Step 4: Commit**

```bash
git add delivery-saas-frontend/src/views/<arquivo-encontrado>.vue
git commit -m "feat(ui): pricing defaults tab in StoreSettings"
```

---

## FASE 3 — Painel Saúde Global

### Task 3.1: Endpoint `GET /financial/reports/business-health`

**Files:**
- Create: `delivery-saas-backend/src/services/businessHealth.js`
- Modify: `delivery-saas-backend/src/routes/financial/reports.js` (adicionar handler)
- Test: `delivery-saas-backend/tests/businessHealth.test.mjs`

**Step 1: Escrever teste falhante**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolvePeriodRange, computeBreakEven, evaluateAlerts } from '../src/services/businessHealth.js';

test('resolvePeriodRange handles all period codes', () => {
  const ref = new Date('2026-04-15T12:00:00Z');
  const m = resolvePeriodRange('current_month', ref);
  assert.equal(m.label, 'Mês atual');
  assert.equal(m.from.getUTCMonth(), 3); // April
  const q = resolvePeriodRange('current_quarter', ref);
  assert.equal(q.label, 'Trimestre atual');
  const y = resolvePeriodRange('current_year', ref);
  assert.equal(y.from.getUTCMonth(), 0);
  assert.throws(() => resolvePeriodRange('foo', ref), /period/);
});

test('computeBreakEven returns expected math', () => {
  const r = computeBreakEven({
    revenue: 45200, cmv: 14800, fixedCosts: 18500,
    storeDefaults: { salesTaxPercent: 6, marketplaceFeePercent: 12, cardFeePercent: 3.5 },
  });
  assert.ok(Math.abs(r.contributionMarginPct - 46.8) < 1);
  assert.ok(Math.abs(r.breakEvenRevenue - 39530) < 500);
  assert.ok(r.safetyMarginPct > 10);
});

test('evaluateAlerts emits CMV critical when cmv pct above threshold', () => {
  const alerts = evaluateAlerts({
    kpis: { cmv: { pct: 45 }, netProfit: { pct: 10 } },
    breakEven: { safetyMarginPct: 12 },
    bottomProducts: [{ marginPct: -5 }],
    storeDefaults: { cmvCriticalAbove: 40 },
    opexDeltaPct: 5,
  });
  const codes = alerts.map(a => a.code);
  assert.ok(codes.includes('CMV_GLOBAL_CRITICAL'));
});
```

**Step 2: Rodar teste**

```bash
docker compose exec backend node --test tests/businessHealth.test.mjs
```

Expected: FAIL.

**Step 3: Implementar `businessHealth.js`**

Funções puras (sem prisma) para período / break-even / alertas; depois um `getBusinessHealth(prisma, ctx)` que orquestra.

```js
export function resolvePeriodRange(code, ref = new Date()) {
  const y = ref.getUTCFullYear(), m = ref.getUTCMonth();
  const startOfMonth = (yy, mm) => new Date(Date.UTC(yy, mm, 1));
  const endOfMonth = (yy, mm) => new Date(Date.UTC(yy, mm + 1, 0, 23, 59, 59, 999));
  const startOfQuarter = (yy, qq) => new Date(Date.UTC(yy, qq * 3, 1));
  const endOfQuarter = (yy, qq) => new Date(Date.UTC(yy, qq * 3 + 3, 0, 23, 59, 59, 999));
  const q = Math.floor(m / 3);
  switch (code) {
    case 'current_month':   return { from: startOfMonth(y,m),   to: endOfMonth(y,m),   label: 'Mês atual' };
    case 'last_month':      return { from: startOfMonth(y,m-1), to: endOfMonth(y,m-1), label: 'Mês anterior' };
    case 'last_30d':        return { from: new Date(ref.getTime() - 30*864e5), to: ref, label: 'Últimos 30 dias' };
    case 'current_quarter': return { from: startOfQuarter(y,q), to: endOfQuarter(y,q), label: 'Trimestre atual' };
    case 'last_quarter': {
      const lq = q === 0 ? 3 : q - 1; const ly = q === 0 ? y - 1 : y;
      return { from: startOfQuarter(ly,lq), to: endOfQuarter(ly,lq), label: 'Trimestre anterior' };
    }
    case 'current_year':    return { from: new Date(Date.UTC(y,0,1)), to: new Date(Date.UTC(y,11,31,23,59,59,999)), label: 'Ano atual' };
    default: throw new Error(`period inválido: ${code}`);
  }
}

export function computeBreakEven({ revenue, cmv, fixedCosts, storeDefaults }) {
  const variablePct = Number(storeDefaults.salesTaxPercent||0) + Number(storeDefaults.marketplaceFeePercent||0) + Number(storeDefaults.cardFeePercent||0);
  const variableCosts = revenue * (variablePct / 100);
  const contributionMargin = revenue - cmv - variableCosts;
  const contributionMarginPct = revenue ? (contributionMargin / revenue) * 100 : 0;
  const breakEvenRevenue = contributionMarginPct > 0 ? fixedCosts / (contributionMarginPct / 100) : null;
  const safetyMarginPct = breakEvenRevenue && revenue ? ((revenue - breakEvenRevenue) / revenue) * 100 : null;
  return { fixedCosts, variableCosts, contributionMarginPct, breakEvenRevenue, currentRevenue: revenue, safetyMarginPct };
}

export function evaluateAlerts({ kpis, breakEven, bottomProducts, storeDefaults, opexDeltaPct }) {
  const alerts = [];
  if (kpis.cmv?.pct > Number(storeDefaults.cmvCriticalAbove || 40)) {
    alerts.push({ level: 'danger', code: 'CMV_GLOBAL_CRITICAL', message: `CMV global em ${kpis.cmv.pct.toFixed(1)}% (acima de ${storeDefaults.cmvCriticalAbove}%)` });
  }
  const criticalProducts = (bottomProducts || []).filter(p => p.marginPct < 0);
  if (criticalProducts.length > 0) {
    alerts.push({ level: 'danger', code: 'CMV_CRITICAL_PRODUCT', message: `${criticalProducts.length} produto(s) com margem negativa`, actionUrl: '/products?filter=cmv_critical' });
  }
  if (opexDeltaPct > 20) {
    alerts.push({ level: 'warning', code: 'OPEX_GROWTH', message: `Despesas operacionais cresceram ${opexDeltaPct.toFixed(1)}% vs período anterior` });
  }
  if (breakEven?.safetyMarginPct != null && breakEven.safetyMarginPct < 0) {
    alerts.push({ level: 'danger', code: 'BREAK_EVEN_BELOW', message: 'Faturamento abaixo do ponto de equilíbrio' });
  } else if (breakEven?.safetyMarginPct != null && breakEven.safetyMarginPct >= 10) {
    alerts.push({ level: 'info', code: 'BREAK_EVEN_OK', message: `Faturamento ${breakEven.safetyMarginPct.toFixed(0)}% acima do ponto de equilíbrio` });
  }
  if (kpis.netProfit?.pct != null && kpis.netProfit.pct < 5) {
    alerts.push({ level: 'warning', code: 'MARGIN_LOSS', message: `Margem líquida em ${kpis.netProfit.pct.toFixed(1)}% (abaixo de 5%)` });
  }
  return alerts;
}

// Orquestrador (usa prisma)
export async function getBusinessHealth(prisma, { companyId, storeId, period }) {
  // 1. resolvePeriodRange
  // 2. Buscar revenue/cmv via DRE helpers (importar calculateCMV de reports.js ou refazer)
  // 3. Fixed costs: financialTransaction PAYABLE em CCs OPEX no período
  // 4. Top/bottom: calculateCmvByProduct
  // 5. Comparativo período anterior para deltas
  // 6. computeBreakEven + evaluateAlerts
  // (Implementar conforme design 3.2)
  // ... ~80 linhas
}
```

Implementar `getBusinessHealth` lendo o design doc seção 3.2.

E o handler em `reports.js`:

```js
router.get('/business-health', async (req, res) => {
  try {
    const { period = 'current_month', storeId } = req.query;
    const data = await getBusinessHealth(prisma, { companyId: req.user.companyId, storeId, period });
    res.json(data);
  } catch (e) {
    console.error('GET business-health error:', e);
    res.status(500).json({ message: e.message });
  }
});
```

**Step 4: Rodar teste**

```bash
docker compose exec backend node --test tests/businessHealth.test.mjs
```

Expected: PASS (3/3).

**Step 5: Validação manual**

```bash
curl -H "Authorization: Bearer <token>" "http://localhost:3000/financial/reports/business-health?period=current_month"
```

Verificar JSON com kpis, breakEven, topProducts, bottomProducts, alerts.

**Step 6: Commit**

```bash
git add delivery-saas-backend/src/services/businessHealth.js delivery-saas-backend/src/routes/financial/reports.js delivery-saas-backend/tests/businessHealth.test.mjs
git commit -m "feat(financial): GET /financial/reports/business-health"
```

---

### Task 3.2: Cache em memória LRU 60s no endpoint

**Files:**
- Modify: `delivery-saas-backend/src/routes/financial/reports.js`

**Step 1: Adicionar cache simples**

No topo do arquivo:

```js
const _bhCache = new Map(); // key -> { expiresAt, data }
const BH_TTL_MS = 60 * 1000;
function _bhKey({ companyId, storeId, period }) { return `${companyId}|${storeId||''}|${period}`; }
```

No handler `business-health`, antes de chamar `getBusinessHealth`:

```js
const key = _bhKey({ companyId: req.user.companyId, storeId: req.query.storeId, period: req.query.period || 'current_month' });
const cached = _bhCache.get(key);
if (cached && cached.expiresAt > Date.now()) return res.json(cached.data);
```

E após o cálculo:

```js
_bhCache.set(key, { expiresAt: Date.now() + BH_TTL_MS, data });
if (_bhCache.size > 200) { const firstKey = _bhCache.keys().next().value; _bhCache.delete(firstKey); }
```

**Step 2: Validação manual**

Disparar 3 requests seguidas e verificar via log que apenas o primeiro chamou `getBusinessHealth`.

**Step 3: Commit**

```bash
git add delivery-saas-backend/src/routes/financial/reports.js
git commit -m "perf(financial): in-memory LRU cache (60s) for business-health"
```

---

### Task 3.3: UI — `BusinessHealth.vue` + componentes

**Files:**
- Create: `delivery-saas-frontend/src/views/financial/BusinessHealth.vue`
- Create: `delivery-saas-frontend/src/components/KpiCard.vue`
- Create: `delivery-saas-frontend/src/components/BreakEvenBar.vue`

**REQUIRED SUB-SKILL:** Use `frontend-deliverywl` para garantir consistência visual.

**Step 1: Criar `KpiCard.vue`**

Props: `label` (string), `value` (string|number), `formatter` ('currency'|'percent'|'integer'), `delta` (number?, %), `status` ('healthy'|'warning'|'critical'|null), `band` ([min,max]?).

Renderiza um card Bootstrap com:
- título pequeno em cima
- valor grande
- delta colorido (↑ verde / ↓ vermelho)
- badge de status quando aplicável
- subtitulo "Faixa X-Y%" se `band` presente

**Step 2: Criar `BreakEvenBar.vue`**

Props: `currentRevenue`, `breakEvenRevenue`, `safetyMarginPct`.

Barra de progresso Bootstrap com marca visual no break-even (linha vertical) e tooltip explicativo.

**Step 3: Criar `BusinessHealth.vue`**

Layout das 4 zonas (ver design 3.3):
1. Header: `<select>` período (6 opções) + `<select>` loja
2. Banner alertas (loop em `data.alerts`, badge por `level`)
3. Grid KpiCards (`row g-3`, `col-md-3 col-6`)
4. Card BreakEvenBar
5. Duas colunas Top/Bottom (tabela simples)

```vue
<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import api from '@/api';
import KpiCard from '@/components/KpiCard.vue';
import BreakEvenBar from '@/components/BreakEvenBar.vue';

const period = ref('current_month');
const storeId = ref(null);
const data = ref(null);
const loading = ref(false);

async function load() {
  loading.value = true;
  try {
    const r = await api.get('/financial/reports/business-health', { params: { period: period.value, storeId: storeId.value || undefined } });
    data.value = r.data;
  } finally { loading.value = false; }
}

onMounted(load);
watch([period, storeId], load);
</script>
```

**Step 4: Registrar rota e tornar default do módulo Financeiro**

Em `delivery-saas-frontend/src/router/index.js` (achar com `grep -n "financial" delivery-saas-frontend/src/router/index.js`):

- Adicionar `{ path: '/financial/health', component: () => import('@/views/financial/BusinessHealth.vue'), name: 'BusinessHealth' }`
- Trocar redirect default de `/financial` para apontar para `/financial/health`.

E no menu lateral (achar `grep -rln "financial" delivery-saas-frontend/src/components/layout` ou similar): adicionar item "Saúde do Negócio" no topo do grupo Financeiro.

**Step 5: Validação manual**

1. Acessar Financeiro pelo menu → cair direto na Saúde do Negócio.
2. Trocar período entre as 6 opções → dados recarregam.
3. Verificar com dados reais que KPIs batem com DRE.
4. Forçar produto com margem negativa → alerta `CMV_CRITICAL_PRODUCT` aparece.
5. Mobile (DevTools): layout colapsa para 1 coluna corretamente.

**Step 6: Commit**

```bash
git add delivery-saas-frontend/src/views/financial/BusinessHealth.vue \
        delivery-saas-frontend/src/components/KpiCard.vue \
        delivery-saas-frontend/src/components/BreakEvenBar.vue \
        delivery-saas-frontend/src/router/index.js \
        delivery-saas-frontend/src/components/layout/<menu-file>.vue
git commit -m "feat(ui): BusinessHealth view as default of Financial module"
```

---

### Task 3.4: Banner "Dados disponíveis a partir de DD/MM/AAAA"

**Files:**
- Modify: `delivery-saas-backend/src/services/businessHealth.js` (incluir `dataStartDate` no payload)
- Modify: `delivery-saas-frontend/src/views/financial/BusinessHealth.vue` (renderizar banner condicional)

**Step 1: Calcular data inicial real do snapshot**

No backend, ao montar o response:

```js
const earliest = await prisma.stockMovementItem.findFirst({
  where: { unitCost: { not: null }, stockMovement: { type: 'OUT', companyId } },
  orderBy: { createdAt: 'asc' },
  select: { createdAt: true },
});
data.dataStartDate = earliest?.createdAt || null;
```

**Step 2: UI — banner condicional**

Se `data.dataStartDate` posterior ao `period.from`:

```html
<div class="alert alert-info small mb-3" v-if="data?.dataStartDate && new Date(data.dataStartDate) > new Date(data.period.from)">
  📌 Dados de CMV disponíveis a partir de {{ formatDate(data.dataStartDate) }}.
  Períodos anteriores podem estar incompletos.
</div>
```

**Step 3: Validação manual**

Selecionar período "Ano atual" antes do deploy → banner aparece. Selecionar "Mês atual" pós-deploy → não aparece.

**Step 4: Commit**

```bash
git add delivery-saas-backend/src/services/businessHealth.js delivery-saas-frontend/src/views/financial/BusinessHealth.vue
git commit -m "feat(ui): data availability banner in BusinessHealth"
```

---

## Validação final (após Fase 3)

**Smoke test integrado:**

1. Criar pedido com produto de ficha técnica → verificar `StockMovement OUT` com `unitCost` preenchido.
2. Cancelar pedido → verificar `StockMovement IN` reverso e flag `reversedAt` no OUT.
3. Abrir DRE → CMV reflete consumo (não compras).
4. Abrir Saúde do Negócio → KPIs, semáforo, break-even renderizam.
5. Editar produto na aba Precificação → preço sugerido e CMV% live.
6. Configurar `StorePricingDefaults` → aba Precificação reflete novos valores; alertas no painel mudam de threshold.

**Commit final de release:**

```bash
git tag v-cmv-pricing-health
```

---

## Checklist de PRs

- [ ] PR 1 (Fase 1): tasks 1.1–1.6
- [ ] PR 2 (Fase 2): tasks 2.1–2.5
- [ ] PR 3 (Fase 3): tasks 3.1–3.4

Cada PR é independente, testável e reversível.
