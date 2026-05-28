# Pizza Product Type Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Adicionar tipo de produto `PIZZA` ao Delivery SaaS com modos de precificação BY_FLAVOR/FIXED, matriz sabor×tamanho, bordas/massas/adicionais (reusando `ComboSlot`), engine de preço compartilhada cliente/servidor e impressão térmica.

**Architecture:** Pizza estende a estrutura de combo. Novos modelos `Pizza`, `PizzaSize`, `PizzaFlavorPrice`. `ComboSlot` ganha `slotKind` (FLAVOR/BORDER/DOUGH/EXTRA) e `pizzaSizeId?` opcional. Engine de preço pura (`pizzaPricing.js`) é duplicada server (Node) e client (Vue) — backend é fonte da verdade e rejeita `computedPrice` divergente. Persistência via `OrderItem.options` JSON. Fiscal: 1 linha NFC-e por pizza.

**Tech Stack:** Express + Prisma + PostgreSQL + Socket.IO (backend), Vue 3 + Pinia + Vite (frontend), Jest (testes backend), Node print agent.

**Design doc:** [docs/plans/2026-05-28-pizza-product-type-design.md](2026-05-28-pizza-product-type-design.md)

---

## Phase 1 — Schema e Migração

### Task 1.1: Adicionar enums e modelos ao schema.prisma

**Files:**
- Modify: `delivery-saas-backend/prisma/schema.prisma`

**Step 1:** Adicione no topo (junto aos outros enums):

```prisma
enum ProductKind {
  SIMPLE
  COMBO
  PIZZA
}

enum PizzaPricingMode {
  BY_FLAVOR
  FIXED
}

enum PizzaHalfPriceRule {
  MAX
  AVG
}

enum PizzaFlavorAddRule {
  MAX_ADD
  SUM_ADD
  AVG_ADD
}

enum ComboSlotKind {
  GENERIC
  FLAVOR
  BORDER
  DOUGH
  EXTRA
}
```

**Step 2:** No `model Product`, adicione:

```prisma
  kind        ProductKind @default(SIMPLE)
  pizza       Pizza?
```

**Step 3:** No `model Store`, adicione:

```prisma
  pizzaHalfPriceRule PizzaHalfPriceRule @default(MAX)
```

**Step 4:** No `model ComboSlot`, adicione:

```prisma
  slotKind    ComboSlotKind @default(GENERIC)
  pizzaSizeId String?
  pizzaSize   PizzaSize?    @relation(fields: [pizzaSizeId], references: [id], onDelete: Cascade)
```

**Step 5:** Adicione modelos novos no fim do schema:

```prisma
model Pizza {
  id                    String               @id @default(cuid())
  product               Product              @relation(fields: [productId], references: [id], onDelete: Cascade)
  productId             String               @unique
  pricingMode           PizzaPricingMode
  halfPriceRuleOverride PizzaHalfPriceRule?
  flavorAddRule         PizzaFlavorAddRule?
  sizes                 PizzaSize[]
  createdAt             DateTime             @default(now())
  updatedAt             DateTime             @updatedAt
}

model PizzaSize {
  id              String              @id @default(cuid())
  pizza           Pizza               @relation(fields: [pizzaId], references: [id], onDelete: Cascade)
  pizzaId         String
  name            String
  position        Int                 @default(0)
  maxFlavors      Int
  basePrice       Decimal             @db.Decimal(10,2)
  vUnComDeclarado Decimal             @db.Decimal(10,2)
  flavorPrices    PizzaFlavorPrice[]
  comboSlots      ComboSlot[]
  @@unique([pizzaId, name])
}

model PizzaFlavorPrice {
  id             String           @id @default(cuid())
  size           PizzaSize        @relation(fields: [sizeId], references: [id], onDelete: Cascade)
  sizeId         String
  flavorOption   ComboSlotOption  @relation(fields: [flavorOptionId], references: [id], onDelete: Cascade)
  flavorOptionId String
  price          Decimal          @db.Decimal(10,2)
  @@unique([sizeId, flavorOptionId])
}
```

**Step 6:** Em `model ComboSlotOption`, adicione a relação reversa:

```prisma
  flavorPrices PizzaFlavorPrice[]
```

**Step 7:** Run: `docker compose exec backend npx prisma format`
Expected: arquivo formatado, sem erro.

**Step 8:** Commit:

```bash
git add delivery-saas-backend/prisma/schema.prisma
git commit -m "feat(schema): add Pizza/PizzaSize/PizzaFlavorPrice models + ComboSlotKind enum"
```

---

### Task 1.2: Aplicar schema no banco dev

**Step 1:** Run: `docker compose exec backend npx prisma db push --skip-generate`
Expected: "Your database is now in sync with your Prisma schema." e nenhum prompt de data loss (apenas adições).

**Step 2:** Run: `docker compose exec backend npx prisma generate`
Expected: "Generated Prisma Client"

**Step 3:** Verificar via psql:

```bash
docker compose exec db psql -U postgres -d projetodelivery -c "\d \"Pizza\""
docker compose exec db psql -U postgres -d projetodelivery -c "\d \"PizzaSize\""
docker compose exec db psql -U postgres -d projetodelivery -c "\d \"PizzaFlavorPrice\""
```
Expected: tabelas listadas com colunas corretas.

**Step 4:** Sem commit (db push só altera dev local).

---

### Task 1.3: Backfill de Product.kind

**Files:**
- Create: `delivery-saas-backend/prisma/seeds/backfill_product_kind.js`

**Step 1:** Crie o arquivo:

```javascript
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const updated = await prisma.$executeRaw`
    UPDATE "Product" SET kind = CASE WHEN "isCombo" THEN 'COMBO'::"ProductKind" ELSE 'SIMPLE'::"ProductKind" END
  `;
  console.log(`Updated ${updated} products`);

  const slots = await prisma.$executeRaw`
    UPDATE "ComboSlot" SET "slotKind" = 'GENERIC'::"ComboSlotKind" WHERE "slotKind" IS NULL
  `;
  console.log(`Updated ${slots} combo slots`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
```

**Step 2:** Run: `docker compose exec backend node prisma/seeds/backfill_product_kind.js`
Expected: contagens > 0 se houver produtos/combos preexistentes.

**Step 3:** Verifique:

```bash
docker compose exec db psql -U postgres -d projetodelivery -c "SELECT kind, COUNT(*) FROM \"Product\" GROUP BY kind"
```
Expected: SIMPLE/COMBO somam total de produtos; nenhum NULL.

**Step 4:** Commit:

```bash
git add delivery-saas-backend/prisma/seeds/backfill_product_kind.js
git commit -m "chore(seeds): backfill Product.kind and ComboSlot.slotKind"
```

---

## Phase 2 — Backend: Engine de Preço (TDD)

### Task 2.1: Setup do arquivo de teste de pricing

**Files:**
- Create: `delivery-saas-backend/tests/utils/pizzaPricing.test.js`

**Step 1:** Crie arquivo com 1 teste mínimo que falha:

```javascript
const { computePizzaPrice } = require('../../src/utils/pizzaPricing');

describe('computePizzaPrice', () => {
  test('exports function', () => {
    expect(typeof computePizzaPrice).toBe('function');
  });
});
```

**Step 2:** Run: `docker compose exec backend npm test -- pizzaPricing`
Expected: FAIL com "Cannot find module '../../src/utils/pizzaPricing'"

**Step 3:** Crie `delivery-saas-backend/src/utils/pizzaPricing.js` com stub:

```javascript
function computePizzaPrice() {
  throw new Error('not implemented');
}
module.exports = { computePizzaPrice };
```

**Step 4:** Run: `docker compose exec backend npm test -- pizzaPricing`
Expected: PASS (só checa export).

**Step 5:** Commit:

```bash
git add delivery-saas-backend/src/utils/pizzaPricing.js delivery-saas-backend/tests/utils/pizzaPricing.test.js
git commit -m "test(pizza): scaffold pizzaPricing test suite"
```

---

### Task 2.2: Modo BY_FLAVOR + rule MAX

**Step 1:** Adicione no teste:

```javascript
const samplePizza = (overrides = {}) => ({
  pricingMode: 'BY_FLAVOR',
  halfPriceRuleOverride: null,
  flavorAddRule: null,
  sizes: [{
    id: 'sz_g',
    name: 'Grande',
    maxFlavors: 3,
    basePrice: 0,
    flavorPrices: [
      { flavorOptionId: 'f_mus', price: 40 },
      { flavorOptionId: 'f_cal', price: 40 },
      { flavorOptionId: 'f_cam', price: 55 },
    ],
  }],
  ...overrides,
});

test('BY_FLAVOR MAX: returns max flavor price between selected', () => {
  const price = computePizzaPrice(samplePizza(), { pizzaHalfPriceRule: 'MAX' }, {
    pizzaSizeId: 'sz_g',
    flavors: [{ optionId: 'f_mus' }, { optionId: 'f_cam' }],
    border: null, dough: null, extras: [],
  });
  expect(price).toBe(55);
});
```

**Step 2:** Run test: FAIL.

**Step 3:** Implemente em `pizzaPricing.js`:

```javascript
function computePizzaPrice(pizza, store, selection) {
  const size = pizza.sizes.find(s => s.id === selection.pizzaSizeId);
  if (!size) throw new Error('Invalid pizzaSizeId');

  const flavorPrices = selection.flavors.map(f => {
    const fp = size.flavorPrices.find(p => p.flavorOptionId === f.optionId);
    if (!fp) throw new Error(`No price for flavor ${f.optionId} in size ${size.name}`);
    return Number(fp.price);
  });

  let base;
  if (pizza.pricingMode === 'BY_FLAVOR') {
    const rule = pizza.halfPriceRuleOverride ?? store.pizzaHalfPriceRule;
    base = rule === 'MAX' ? Math.max(...flavorPrices) : avg(flavorPrices);
  } else {
    throw new Error('FIXED not implemented yet');
  }

  return round2(base);
}

function avg(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }
function round2(n) { return Math.round(n * 100) / 100; }

module.exports = { computePizzaPrice };
```

**Step 4:** Run test: PASS.

**Step 5:** Commit:

```bash
git add -u
git commit -m "feat(pizza): implement BY_FLAVOR MAX pricing"
```

---

### Task 2.3: BY_FLAVOR + rule AVG e override por pizza

**Step 1:** Adicione testes:

```javascript
test('BY_FLAVOR AVG: returns average of selected flavors', () => {
  const price = computePizzaPrice(samplePizza(), { pizzaHalfPriceRule: 'AVG' }, {
    pizzaSizeId: 'sz_g',
    flavors: [{ optionId: 'f_mus' }, { optionId: 'f_cam' }],
    border: null, dough: null, extras: [],
  });
  expect(price).toBe(47.5);
});

test('BY_FLAVOR pizza override beats store rule', () => {
  const pizza = samplePizza({ halfPriceRuleOverride: 'AVG' });
  const price = computePizzaPrice(pizza, { pizzaHalfPriceRule: 'MAX' }, {
    pizzaSizeId: 'sz_g',
    flavors: [{ optionId: 'f_mus' }, { optionId: 'f_cam' }],
    border: null, dough: null, extras: [],
  });
  expect(price).toBe(47.5);
});

test('BY_FLAVOR 3 flavors: averages all three', () => {
  const price = computePizzaPrice(samplePizza(), { pizzaHalfPriceRule: 'AVG' }, {
    pizzaSizeId: 'sz_g',
    flavors: [{ optionId: 'f_mus' }, { optionId: 'f_cal' }, { optionId: 'f_cam' }],
    border: null, dough: null, extras: [],
  });
  expect(price).toBe(45);
});
```

**Step 2:** Run: PASS (já implementado).

**Step 3:** Commit:

```bash
git add -u
git commit -m "test(pizza): cover BY_FLAVOR AVG and pizza-level override"
```

---

### Task 2.4: Modo FIXED com MAX_ADD/SUM_ADD/AVG_ADD

**Step 1:** Adicione no teste:

```javascript
const fixedPizza = () => ({
  pricingMode: 'FIXED',
  halfPriceRuleOverride: null,
  flavorAddRule: 'MAX_ADD',
  sizes: [{
    id: 'sz_g',
    name: 'Grande',
    maxFlavors: 3,
    basePrice: 50,
    flavorPrices: [
      { flavorOptionId: 'f_mus', price: 0 },
      { flavorOptionId: 'f_cal', price: 0 },
      { flavorOptionId: 'f_cam', price: 7 },
    ],
  }],
});

test('FIXED MAX_ADD: base + max add', () => {
  const price = computePizzaPrice(fixedPizza(), {}, {
    pizzaSizeId: 'sz_g',
    flavors: [{ optionId: 'f_mus' }, { optionId: 'f_cam' }],
    border: null, dough: null, extras: [],
  });
  expect(price).toBe(57);
});

test('FIXED SUM_ADD: base + sum of adds', () => {
  const pizza = { ...fixedPizza(), flavorAddRule: 'SUM_ADD' };
  pizza.sizes[0].flavorPrices.find(p => p.flavorOptionId === 'f_cal').price = 4;
  const price = computePizzaPrice(pizza, {}, {
    pizzaSizeId: 'sz_g',
    flavors: [{ optionId: 'f_cal' }, { optionId: 'f_cam' }],
    border: null, dough: null, extras: [],
  });
  expect(price).toBe(61); // 50 + 4 + 7
});

test('FIXED AVG_ADD: base + average of adds', () => {
  const pizza = { ...fixedPizza(), flavorAddRule: 'AVG_ADD' };
  const price = computePizzaPrice(pizza, {}, {
    pizzaSizeId: 'sz_g',
    flavors: [{ optionId: 'f_mus' }, { optionId: 'f_cam' }],
    border: null, dough: null, extras: [],
  });
  expect(price).toBe(53.5); // 50 + (0+7)/2
});
```

**Step 2:** Run: FAIL (FIXED throw).

**Step 3:** Substitua o else em `pizzaPricing.js`:

```javascript
  } else {
    if (!pizza.flavorAddRule) throw new Error('flavorAddRule required for FIXED mode');
    const rule = pizza.flavorAddRule;
    const add = rule === 'MAX_ADD' ? Math.max(0, ...flavorPrices)
              : rule === 'SUM_ADD' ? flavorPrices.reduce((a, b) => a + b, 0)
              : avg(flavorPrices);
    base = Number(size.basePrice) + add;
  }
```

**Step 4:** Run: PASS.

**Step 5:** Commit:

```bash
git add -u
git commit -m "feat(pizza): implement FIXED mode with MAX/SUM/AVG add rules"
```

---

### Task 2.5: Acréscimos de borda/massa/extras

**Step 1:** Adicione teste:

```javascript
test('adds border/dough/extras priceAdjust', () => {
  const price = computePizzaPrice(samplePizza(), { pizzaHalfPriceRule: 'MAX' }, {
    pizzaSizeId: 'sz_g',
    flavors: [{ optionId: 'f_mus' }],
    border: { priceAdjust: 8 },
    dough:  { priceAdjust: 0 },
    extras: [{ priceAdjust: 5 }, { priceAdjust: 3 }],
  });
  expect(price).toBe(56); // 40 + 8 + 0 + 5 + 3
});
```

**Step 2:** Run: FAIL.

**Step 3:** Antes do return em `computePizzaPrice`:

```javascript
  const borderAdd = selection.border ? Number(selection.border.priceAdjust ?? 0) : 0;
  const doughAdd  = selection.dough  ? Number(selection.dough.priceAdjust  ?? 0) : 0;
  const extrasAdd = (selection.extras ?? []).reduce((s, e) => s + Number(e.priceAdjust ?? 0), 0);
  return round2(base + borderAdd + doughAdd + extrasAdd);
```

Remova o return atual de `round2(base)`.

**Step 4:** Run: PASS. Rode todos os testes para garantir não quebrou nada: `docker compose exec backend npm test -- pizzaPricing`

**Step 5:** Commit:

```bash
git add -u
git commit -m "feat(pizza): add border/dough/extras priceAdjust to pricing"
```

---

### Task 2.6: Validações de erro

**Step 1:** Testes:

```javascript
test('throws when flavors exceed maxFlavors', () => {
  const pizza = samplePizza();
  pizza.sizes[0].maxFlavors = 1;
  expect(() => computePizzaPrice(pizza, { pizzaHalfPriceRule: 'MAX' }, {
    pizzaSizeId: 'sz_g',
    flavors: [{ optionId: 'f_mus' }, { optionId: 'f_cal' }],
    border: null, dough: null, extras: [],
  })).toThrow(/maxFlavors/i);
});

test('throws when flavors.length < 1', () => {
  expect(() => computePizzaPrice(samplePizza(), { pizzaHalfPriceRule: 'MAX' }, {
    pizzaSizeId: 'sz_g', flavors: [], border: null, dough: null, extras: [],
  })).toThrow(/at least one flavor/i);
});
```

**Step 2:** Run: FAIL.

**Step 3:** Adicione no início de `computePizzaPrice` (após size lookup):

```javascript
  if (!selection.flavors || selection.flavors.length < 1) {
    throw new Error('Pizza requires at least one flavor');
  }
  if (selection.flavors.length > size.maxFlavors) {
    throw new Error(`Selected ${selection.flavors.length} flavors but size ${size.name} allows maxFlavors=${size.maxFlavors}`);
  }
```

**Step 4:** Run: PASS.

**Step 5:** Commit:

```bash
git add -u
git commit -m "feat(pizza): validate flavor count against size.maxFlavors"
```

---

## Phase 3 — Backend: Render e Graph

### Task 3.1: pizzaRender — geração de OrderItem.name

**Files:**
- Create: `delivery-saas-backend/src/utils/pizzaRender.js`
- Create: `delivery-saas-backend/tests/utils/pizzaRender.test.js`

**Step 1:** Crie teste com casos:

```javascript
const { renderPizzaName } = require('../../src/utils/pizzaRender');

test('single flavor', () => {
  expect(renderPizzaName({
    pizzaSizeName: 'Grande',
    flavors: [{ name: 'Mussarela' }],
  })).toBe('Pizza Grande - Mussarela');
});

test('two flavors → 1/2 + 1/2', () => {
  expect(renderPizzaName({
    pizzaSizeName: 'Grande',
    flavors: [{ name: 'Mussarela' }, { name: 'Calabresa' }],
  })).toBe('Pizza Grande - 1/2 Mussarela + 1/2 Calabresa');
});

test('three flavors → 1/3 each', () => {
  expect(renderPizzaName({
    pizzaSizeName: 'Grande',
    flavors: [{ name: 'A' }, { name: 'B' }, { name: 'C' }],
  })).toBe('Pizza Grande - 1/3 A + 1/3 B + 1/3 C');
});

test('appends border when present', () => {
  expect(renderPizzaName({
    pizzaSizeName: 'Grande',
    flavors: [{ name: 'Mussarela' }],
    border: { name: 'Catupiry' },
  })).toBe('Pizza Grande - Mussarela - Borda Catupiry');
});
```

**Step 2:** Run: FAIL (no module).

**Step 3:** Implemente:

```javascript
function renderPizzaName(options) {
  const { pizzaSizeName, flavors, border } = options;
  const parts = [`Pizza ${pizzaSizeName}`];

  if (flavors.length === 1) {
    parts.push(flavors[0].name);
  } else {
    const n = flavors.length;
    const frac = `1/${n}`;
    parts.push(flavors.map(f => `${frac} ${f.name}`).join(' + '));
  }

  if (border && border.name) parts.push(`Borda ${border.name}`);

  return parts.join(' - ');
}

module.exports = { renderPizzaName };
```

**Step 4:** Run: PASS.

**Step 5:** Commit:

```bash
git add delivery-saas-backend/src/utils/pizzaRender.js delivery-saas-backend/tests/utils/pizzaRender.test.js
git commit -m "feat(pizza): renderPizzaName for OrderItem.name"
```

---

### Task 3.2: pizzaGraph — createPizzaGraph

**Files:**
- Create: `delivery-saas-backend/src/utils/pizzaGraph.js`
- Create: `delivery-saas-backend/tests/utils/pizzaGraph.test.js`

**Step 1:** Estude `delivery-saas-backend/src/utils/comboGraph.js` para reusar padrão de transação.

**Step 2:** Teste mínimo — criação de pizza válida (use uma factory de tenant fixture do projeto):

```javascript
const { createPizzaGraph } = require('../../src/utils/pizzaGraph');
const { prisma, createTestCompany } = require('../helpers');

test('creates Pizza + sizes + flavorPrices in a transaction', async () => {
  const { companyId } = await createTestCompany();
  const product = await prisma.product.create({
    data: { name: 'Pizza Teste', companyId, price: 0, kind: 'PIZZA' },
  });
  const flavor1 = await prisma.product.create({
    data: { name: 'Mussarela', companyId, price: 0 },
  });

  await prisma.$transaction(async tx => {
    await createPizzaGraph(tx, product.id, companyId, {
      pricingMode: 'BY_FLAVOR',
      sizes: [{
        name: 'Grande', position: 0, maxFlavors: 2, basePrice: 0, vUnComDeclarado: 30,
        flavors: [{ linkedProductId: flavor1.id, price: 40 }],
      }],
      slots: [],
    });
  });

  const pizza = await prisma.pizza.findUnique({
    where: { productId: product.id },
    include: { sizes: { include: { flavorPrices: true } } },
  });
  expect(pizza.sizes).toHaveLength(1);
  expect(pizza.sizes[0].flavorPrices).toHaveLength(1);
  expect(Number(pizza.sizes[0].flavorPrices[0].price)).toBe(40);
});
```

**Step 3:** Run: FAIL.

**Step 4:** Implemente `pizzaGraph.js`. Estrutura mínima:

```javascript
async function createPizzaGraph(tx, productId, companyId, dto) {
  validatePizzaDto(dto);

  const pizza = await tx.pizza.create({
    data: {
      productId,
      pricingMode: dto.pricingMode,
      halfPriceRuleOverride: dto.halfPriceRuleOverride ?? null,
      flavorAddRule: dto.flavorAddRule ?? null,
    },
  });

  // Cria ComboSlot FLAVOR único agregando todos os sabores
  const flavorOptions = new Map(); // linkedProductId -> ComboSlotOption
  if (dto.sizes.some(s => s.flavors.length > 0)) {
    const flavorSlot = await tx.comboSlot.create({
      data: {
        // ComboSlot precisa de comboId; em pizza, criamos um Combo "wrapper" ou alteramos schema
        // VER: schema atual exige Combo. Decisão: criar Combo wrapper para reusar slots.
        // ...
      },
    });
  }
  // implementação completa: ver design doc seções "Modelo de dados" e "Validações"
}

function validatePizzaDto(dto) {
  if (!dto.pricingMode) throw new Error('pricingMode required');
  if (dto.pricingMode === 'FIXED' && !dto.flavorAddRule) {
    throw new Error('flavorAddRule required for FIXED mode');
  }
  if (dto.pricingMode === 'BY_FLAVOR' && dto.flavorAddRule) {
    throw new Error('flavorAddRule not allowed in BY_FLAVOR mode');
  }
  if (!dto.sizes || dto.sizes.length < 1) throw new Error('sizes required');
}

module.exports = { createPizzaGraph, validatePizzaDto };
```

**IMPORTANTE — decisão de schema:** `ComboSlot` referencia `Combo`. Pizza precisa criar um `Combo` wrapper OU mudar `ComboSlot` para aceitar `pizzaId` direto. Recomendação: alterar `ComboSlot` para que `comboId` seja opcional E adicionar `pizzaId` opcional. **Antes de seguir, faça o ajuste de schema e re-aplique db push.** Ajuste:

```prisma
model ComboSlot {
  comboId    String?
  combo      Combo?  @relation(fields: [comboId], references: [id], onDelete: Cascade)
  pizzaId    String?
  pizza      Pizza?  @relation(fields: [pizzaId], references: [id], onDelete: Cascade)
  // ...
}
```

E em `Pizza` adicione `slots ComboSlot[]`. Atualize `Combo.slots` para `slots ComboSlot[]` continua funcionando.

**Step 5:** Aplique schema, regenere client, faça o teste passar. Itere.

**Step 6:** Commit incremental por subteste:

```bash
git add -u
git commit -m "feat(pizza): createPizzaGraph with validation"
```

---

### Task 3.3: Validação completa de matriz e fiscal

**Step 1:** Testes que validam:
- Matriz incompleta (sabor sem preço para algum tamanho) → erro
- Soma `vUnComDeclarado` > menor `basePrice` (Modo FIXED) → erro
- Override regra em modo errado → erro

**Step 2:** Run: FAIL.

**Step 3:** Implemente as validações em `validatePizzaDto` e `createPizzaGraph`.

**Step 4:** Run: PASS.

**Step 5:** Commit:

```bash
git add -u
git commit -m "feat(pizza): validate flavor matrix completeness and fiscal invariant"
```

---

### Task 3.4: updatePizzaGraph (delete + recreate)

Espelhe `comboGraph.js` que faz delete-and-recreate dentro de transação.

**Step 1:** Teste: editar pizza muda sizes/sabores; estado final reflete dto.

**Step 2:** Implemente `updatePizzaGraph(tx, productId, dto)`.

**Step 3:** Commit:

```bash
git add -u
git commit -m "feat(pizza): updatePizzaGraph (atomic recreate)"
```

---

## Phase 4 — Backend: Rotas

### Task 4.1: POST /menu/products aceita pizza

**Files:**
- Modify: `delivery-saas-backend/src/routes/menu.js`
- Create: `delivery-saas-backend/tests/routes/menu.pizza.test.js`

**Step 1:** Teste HTTP:

```javascript
test('POST /menu/products creates pizza', async () => {
  const res = await request(app)
    .post('/menu/products')
    .set('Authorization', `Bearer ${token}`)
    .send({
      name: 'Pizza',
      kind: 'PIZZA',
      pizza: {
        pricingMode: 'BY_FLAVOR',
        sizes: [{ name: 'Grande', maxFlavors: 2, basePrice: 0, vUnComDeclarado: 30,
          flavors: [{ linkedProductId: flavorProductId, price: 40 }] }],
        slots: [],
      },
    });
  expect(res.status).toBe(201);
  expect(res.body.kind).toBe('PIZZA');
});
```

**Step 2:** Run: FAIL.

**Step 3:** Em `routes/menu.js`, na rota POST `/products`, após o handle de combo, adicione:

```javascript
if (body.kind === 'PIZZA' || body.pizza) {
  await createPizzaGraph(tx, product.id, companyId, body.pizza);
}
```

**Step 4:** Run: PASS.

**Step 5:** Commit:

```bash
git add -u
git commit -m "feat(menu): POST /menu/products handles kind=PIZZA"
```

---

### Task 4.2: PATCH /products/:id atualiza pizza

Espelhe lógica existente para combo (delete + recreate em transação).

**Step 1:** Teste de update.
**Step 2:** Implemente.
**Step 3:** Commit.

---

### Task 4.3: GET /menu/products inclui pizza completa

Atualize includes nas queries de listagem/detail para retornar `pizza.sizes.flavorPrices` e slots com `slotKind`.

**Step 1:** Teste assertando shape.
**Step 2:** Adicione includes.
**Step 3:** Commit.

---

### Task 4.4: POST /orders valida pizza com pricing server-side

**Files:**
- Modify: `delivery-saas-backend/src/routes/orders.js`
- Create: `delivery-saas-backend/tests/routes/orders.pizza.test.js`

**Step 1:** Teste:

```javascript
test('POST /orders accepts pizza item when computedPrice matches', async () => {
  // ... setup pizza ...
  const res = await request(app).post('/orders').send({
    items: [{
      productId: pizzaProductId,
      quantity: 1,
      options: {
        kind: 'PIZZA',
        pizzaSizeId: 'sz_g',
        flavors: [{ optionId: 'f_mus', fraction: 1 }],
        border: null, dough: null, extras: [],
        computedPrice: 40,
      },
    }],
  });
  expect(res.status).toBe(201);
  expect(Number(res.body.items[0].price)).toBe(40);
});

test('POST /orders rejects pizza when computedPrice diverges', async () => {
  // ... mesmo setup, mas computedPrice: 1
  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/price/i);
});
```

**Step 2:** Run: FAIL.

**Step 3:** Em `orders.js`, ao iterar items, se `productKind === 'PIZZA'`:

```javascript
const product = await prisma.product.findUnique({
  where: { id: item.productId },
  include: { pizza: { include: { sizes: { include: { flavorPrices: true } } }, slots: { include: { options: true } } } },
});
const store = await prisma.store.findUnique({ where: { id: storeId } });
const computed = computePizzaPrice(product.pizza, store, item.options);
if (Math.abs(computed - Number(item.options.computedPrice)) > 0.01) {
  throw new ValidationError('Pizza price mismatch');
}
item.price = computed;
item.name = renderPizzaName(item.options);
```

**Step 4:** Run: PASS.

**Step 5:** Commit:

```bash
git add -u
git commit -m "feat(orders): validate pizza pricing server-side"
```

---

### Task 4.5: enrichOrderForAgent inclui dados de pizza

**Files:**
- Modify: `delivery-saas-backend/src/utils/enrichOrderForAgent.js`

**Step 1:** Teste: snapshot do payload enviado ao agent inclui `flavors`, `border`, `dough` para itens de pizza.

**Step 2:** Implemente: como `OrderItem.options` já carrega tudo, basta garantir que não filtra; possivelmente adicione `renderPizzaName` rerun se algo mudou.

**Step 3:** Commit:

```bash
git add -u
git commit -m "feat(agent): include pizza options in enriched order payload"
```

---

## Phase 5 — Frontend: Cadastro

### Task 5.1: utils/pizzaPricing.js (cliente)

**Files:**
- Create: `delivery-saas-frontend/src/utils/pizzaPricing.js`

**Step 1:** Copie a engine de `delivery-saas-backend/src/utils/pizzaPricing.js`, exportada como ESM:

```javascript
export function computePizzaPrice(pizza, store, selection) { /* ... */ }
```

**Step 2:** Smoke manual rápido no console do browser (importe no app shell e teste).

**Step 3:** Commit:

```bash
git add delivery-saas-frontend/src/utils/pizzaPricing.js
git commit -m "feat(frontend): mirror pizzaPricing engine on client"
```

---

### Task 5.2: ComboSlotsEditor — slotKind + pizzaSizeId

**Files:**
- Modify: `delivery-saas-frontend/src/components/ComboSlotsEditor.vue`

**Step 1:** Adicione `<SelectInput>` para `slotKind` (GENERIC/FLAVOR/BORDER/DOUGH/EXTRA) — opcional, padrão GENERIC.

**Step 2:** Quando contexto for Pizza (via prop `context="pizza"`), oculte GENERIC e mostre dropdown opcional para amarrar a um tamanho.

**Step 3:** Smoke no browser: cadastre combo (sem regressão) + cadastre pizza com bordas.

**Step 4:** Commit:

```bash
git add -u
git commit -m "feat(frontend): ComboSlotsEditor supports slotKind and pizzaSizeId"
```

---

### Task 5.3: PizzaSizesEditor.vue

**Files:**
- Create: `delivery-saas-frontend/src/components/PizzaSizesEditor.vue`

**Step 1:** Tabela editável de tamanhos. Props: `v-model="sizes"`, `:pricingMode`. Mostra `basePrice` apenas se `pricingMode === 'FIXED'`.

**Step 2:** Drag-and-drop por `position` (use lib `vuedraggable` já presente — verifique package.json).

**Step 3:** Smoke: adicionar/remover/reordenar tamanhos sem perder dados.

**Step 4:** Commit:

```bash
git add -u
git commit -m "feat(frontend): PizzaSizesEditor component"
```

---

### Task 5.4: PizzaFlavorsMatrix.vue

**Files:**
- Create: `delivery-saas-frontend/src/components/PizzaFlavorsMatrix.vue`

**Step 1:** Tabela: linhas = sabores (cada um é um Product do mesmo company), colunas = tamanhos.

**Step 2:** Inputs numéricos por célula. Header dinâmico ("Preço" vs "Acréscimo") conforme `pricingMode`.

**Step 3:** Botões "Copiar coluna Grande", "Preencher coluna ↓".

**Step 4:** Smoke: matriz 3×3 com preenchimento, verificar binding.

**Step 5:** Commit:

```bash
git add -u
git commit -m "feat(frontend): PizzaFlavorsMatrix component"
```

---

### Task 5.5: ProductForm.vue — fluxo Pizza

**Files:**
- Modify: `delivery-saas-frontend/src/views/ProductForm.vue`

**Step 1:** Modal inicial: adicione opção "Pizza".

**Step 2:** Render condicional de 5 abas quando `kind === 'PIZZA'`:
- Dados (modo de preço + override + flavorAddRule)
- Tamanhos (`<PizzaSizesEditor>`)
- Sabores (`<PizzaFlavorsMatrix>`)
- Opções (`<ComboSlotsEditor context="pizza">`)
- Disponibilidade (reusar existente)

**Step 3:** Validação client antes do submit: matriz completa, soma fiscal.

**Step 4:** Submit envia `{ kind: 'PIZZA', pizza: { ... } }` para `POST /menu/products`.

**Step 5:** Smoke completo: cadastrar pizza ponta a ponta, abrir para edição.

**Step 6:** Commit:

```bash
git add -u
git commit -m "feat(frontend): ProductForm supports kind=PIZZA"
```

---

## Phase 6 — Frontend: Compra

### Task 6.1: PizzaSliceDiagram.vue

**Files:**
- Create: `delivery-saas-frontend/src/components/PizzaSliceDiagram.vue`

**Step 1:** Componente SVG simples. Prop: `flavors` (array de `{ name, color? }`). Renderiza círculo dividido em N fatias iguais com cores rotativas e label do sabor.

**Step 2:** Smoke isolado em StorybookDev ou playground.

**Step 3:** Commit:

```bash
git add -u
git commit -m "feat(frontend): PizzaSliceDiagram SVG"
```

---

### Task 6.2: PizzaConfigurator.vue

**Files:**
- Create: `delivery-saas-frontend/src/components/PizzaConfigurator.vue`

**Step 1:** Props: `pizza` (com sizes/slots/flavorPrices), `store`, `initialSelection?`. Emite `update:value` com selection completa + `computedPrice`.

**Step 2:** Layout: radio de tamanho → checkboxes de sabores (limit dinâmico) → radio borda → radio massa → checkboxes adicionais → preview + diagram + subtotal.

**Step 3:** Computed `subtotal` chama `computePizzaPrice` da `utils/pizzaPricing.js`.

**Step 4:** Smoke: configurar pizza em vários modos, conferir subtotal.

**Step 5:** Commit:

```bash
git add -u
git commit -m "feat(frontend): PizzaConfigurator component"
```

---

### Task 6.3: OrderForm.vue (PDV) — abrir Configurator ao adicionar pizza

**Files:**
- Modify: `delivery-saas-frontend/src/views/OrderForm.vue`

**Step 1:** Quando atendente clica em produto, se `product.kind === 'PIZZA'`, abre `<PizzaConfigurator>` em modal. Resultado vai para `cart` com `options` completo.

**Step 2:** Smoke no PDV: adicionar pizza, editar, remover.

**Step 3:** Commit:

```bash
git add -u
git commit -m "feat(pdv): integrate PizzaConfigurator in OrderForm"
```

---

### Task 6.4: Menu público delivery — mesma integração

**Files:**
- Localize a view de menu do cliente (provavelmente `delivery-saas-frontend/src/views/Menu.vue` ou `PublicMenu.vue`).
- Integre `<PizzaConfigurator>` no fluxo de "adicionar ao carrinho".

**Step 1:** Smoke: cliente navega menu, configura pizza, conclui pedido.

**Step 2:** Commit:

```bash
git add -u
git commit -m "feat(menu): integrate PizzaConfigurator in public menu"
```

---

### Task 6.5: Pinia stores (products, cart) — adaptar tipagens

**Files:**
- Modify: `delivery-saas-frontend/src/stores/products.js`
- Modify: `delivery-saas-frontend/src/stores/cart.js` (ou equivalente)

**Step 1:** Garanta que `products` aceita `kind` e `pizza`. `cart` serializa item com `options.kind === 'PIZZA'` e preserva ao recarregar (localStorage se aplicável).

**Step 2:** Smoke: F5 no meio do pedido, item persiste.

**Step 3:** Commit:

```bash
git add -u
git commit -m "refactor(stores): support PIZZA kind in products/cart"
```

---

## Phase 7 — Print Agent

### Task 7.1: defaultTemplate inclui sabores

**Files:**
- Modify: `delivery-print-agent/defaultTemplate.js`

**Step 1:** Localize seção de items no template. Quando `item.options.kind === 'PIZZA'`, renderize linhas adicionais:

```
1x {{item.name}}                      R$ {{item.price}}
{{#each item.options.flavors}}
   {{fractionLabel}} {{name}}        R$ {{price}}
{{/each}}
{{#if item.options.border}}
   Borda: {{item.options.border.name}}  +R$ {{item.options.border.priceAdd}}
{{/if}}
```

**Step 2:** Helper `fractionLabel` retorna `"1/N"` baseado em `flavors.length`. Adicione em `templateEngine.js` se faltar.

**Step 3:** Teste: dispare emissão de pedido com pizza, observe impressão local (ou snapshot do output texto).

**Step 4:** Commit:

```bash
git add -u
git commit -m "feat(agent): default template renders pizza flavors"
```

---

## Phase 8 — Smoke End-to-End

### Task 8.1: Smoke test manual completo

**Step 1:** No tenant de homologação:
1. Cadastre 1 pizza em modo BY_FLAVOR (MAX) com 3 tamanhos e 5 sabores.
2. Cadastre 1 pizza em modo FIXED (MAX_ADD) com 2 tamanhos e 4 sabores + bordas.
3. PDV: faça pedido com meio-a-meio. Confira preço e impressão.
4. PDV: faça pedido com 3 sabores. Confira `1/3 cada` no comprovante.
5. Menu público: cliente faz pedido com pizza FIXED + borda.
6. NFC-e: emita o pedido, conferir `xProd` correto e `vUnCom` igual ao preço cobrado.

**Step 2:** Documente bugs em `docs/plans/2026-05-28-pizza-product-type-smoke-notes.md`. Sem commit se passar limpo.

---

### Task 8.2: Atualizar MEMORY.md

**Files:**
- Modify: `C:\Users\gomes\.claude\projects\d--Users-gomes-Documents-GitHub-projetoDelivery\memory\MEMORY.md`

**Step 1:** Adicione 1 linha ao índice:

```markdown
- [Pizza Module](pizza_module.md) — pizza com modos BY_FLAVOR/FIXED, matriz sabor×tamanho, reuso de ComboSlot
```

**Step 2:** Crie `pizza_module.md` resumindo arquivos-chave (engine, configurator, render).

**Step 3:** Commit (se o `memory/` for versionado; caso contrário só salvar):

```bash
git add C:\Users\gomes\.claude\projects\d--Users-gomes-Documents-GitHub-projetoDelivery\memory\pizza_module.md
# memory normalmente não está em git — apenas salvar
```

---

## Notas finais

- **DRY**: `pizzaPricing.js` é a única engine de preço (duplicada server/client por necessidade — mantenha sincronia testando ambos com casos idênticos).
- **YAGNI**: bordas por fatia, frações desiguais, imagem por sabor — fora do escopo.
- **TDD**: cada implementação no backend tem teste antes; frontend testa via smoke em browser.
- **Commits frequentes**: cada Task termina em commit. Não acumule múltiplas tasks num commit.
- **Riscos não cobertos por testes**: ver tabela em [design.md](2026-05-28-pizza-product-type-design.md).
