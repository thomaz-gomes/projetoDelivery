# Composite Ingredient Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add "insumo composto" (composite ingredient) — an `Ingredient` built from other ingredients with a yield, whose unit cost is derived from the cost of its bases. Also standardize the ingredient form with shared `TextInput`/`SelectInput` components and explicit labels.

**Architecture:** Composite ingredients live in the same `Ingredient` table with new fields (`isComposite`, `yieldQuantity`, `yieldUnit`) and a new `CompositeIngredientItem` table linking composites to base ingredients. Cost is recomputed reactively via a dependency graph walk whenever a `StockMovement` changes any `avgCost`. A "Produzir" flow creates two linked `StockMovement`s (OUT for bases, IN for composite) in one transaction. Nested composites are allowed; cycles are rejected at save-time via DFS.

**Tech Stack:** Prisma ORM, PostgreSQL, Express.js, Vue 3 (Options API + `<script setup>`), Bootstrap 5. No test framework is configured — verification is manual (REST client + UI) plus small ad-hoc Node scripts for pure-logic modules.

**Reference:** Design doc — `docs/plans/2026-04-15-composite-ingredient-design.md`

**Working directory:** all paths are relative to repo root `d:\Users\gomes\Documents\GitHub\projetoDelivery`. Backend container must be running for Prisma/migration steps: `docker compose up -d`.

---

## Task 1: Prisma schema — add composite fields and table

**Files:**
- Modify: `delivery-saas-backend/prisma/schema.prisma` (Ingredient model around line 1440; add new model after it)

**Step 1: Edit the `Ingredient` model**

Add these three fields just before `createdAt`:

```prisma
isComposite   Boolean          @default(false)
yieldQuantity Decimal?
yieldUnit     String?          // GR, KG, ML, L, UN
```

Add two named relation fields to disambiguate the self-relation via `CompositeIngredientItem` (Prisma requires explicit relation names for two FKs targeting the same model):

```prisma
// items this ingredient is COMPOSED OF (only populated when isComposite)
compositionItems    CompositeIngredientItem[] @relation("CompositeParent")
// items where this ingredient is USED AS A BASE inside other composites
usedInCompositions  CompositeIngredientItem[] @relation("CompositeChild")
```

**Step 2: Add new model after `Ingredient`**

```prisma
model CompositeIngredientItem {
  id           String     @id @default(uuid())
  compositeId  String
  composite    Ingredient @relation("CompositeParent", fields: [compositeId], references: [id], onDelete: Cascade)
  ingredientId String
  ingredient   Ingredient @relation("CompositeChild", fields: [ingredientId], references: [id])
  quantity     Decimal
  unit         String
  createdAt    DateTime   @default(now())
  updatedAt    DateTime   @updatedAt

  @@index([compositeId], name: "idx_composite_item_parent")
  @@index([ingredientId], name: "idx_composite_item_child")
}
```

**Step 3: Add `PRODUCTION` to `MovementType` enum**

```prisma
enum MovementType {
  IN
  OUT
  PRODUCTION
}
```

**Step 4: Push schema to dev DB**

Run:
```bash
docker compose exec backend npx prisma db push --skip-generate
docker compose exec backend npx prisma generate
```

Expected: "Your database is now in sync with your Prisma schema." If `prisma generate` fails with EPERM, restart the backend container (`docker compose restart backend`) and retry.

**Step 5: Commit**

```bash
git add delivery-saas-backend/prisma/schema.prisma
git commit -m "feat(schema): add composite ingredient fields and table"
```

---

## Task 2: Unit conversion utility

**Files:**
- Create: `delivery-saas-backend/src/services/unitConversion.js`

**Step 1: Write the module**

```js
// Convert a quantity between compatible units. Returns null if units are incompatible.
// Rules: GR<->KG (x1000), ML<->L (x1000), UN<->UN only.
const BASE_FACTORS = {
  GR: { base: 'MASS', factor: 1 },
  KG: { base: 'MASS', factor: 1000 },
  ML: { base: 'VOLUME', factor: 1 },
  L:  { base: 'VOLUME', factor: 1000 },
  UN: { base: 'UNIT', factor: 1 },
};

export function convertQuantity(quantity, fromUnit, toUnit) {
  if (quantity == null) return null;
  const from = BASE_FACTORS[fromUnit];
  const to = BASE_FACTORS[toUnit];
  if (!from || !to) return null;
  if (from.base !== to.base) return null;
  if (fromUnit === toUnit) return Number(quantity);
  return (Number(quantity) * from.factor) / to.factor;
}

export function areUnitsCompatible(a, b) {
  const fa = BASE_FACTORS[a];
  const fb = BASE_FACTORS[b];
  if (!fa || !fb) return false;
  return fa.base === fb.base;
}
```

**Step 2: Verify with ad-hoc script**

Create throwaway `delivery-saas-backend/scripts/test-unit-conversion.js`:

```js
import { convertQuantity, areUnitsCompatible } from '../src/services/unitConversion.js';

console.assert(convertQuantity(1, 'KG', 'GR') === 1000, 'KG->GR');
console.assert(convertQuantity(500, 'GR', 'KG') === 0.5, 'GR->KG');
console.assert(convertQuantity(2, 'L', 'ML') === 2000, 'L->ML');
console.assert(convertQuantity(1, 'GR', 'UN') === null, 'GR->UN incompatible');
console.assert(areUnitsCompatible('GR', 'KG') === true, 'GR/KG compatible');
console.assert(areUnitsCompatible('GR', 'ML') === false, 'GR/ML incompatible');
console.log('OK');
```

Run: `docker compose exec backend node scripts/test-unit-conversion.js`
Expected output: `OK`

**Step 3: Delete the script and commit**

```bash
rm delivery-saas-backend/scripts/test-unit-conversion.js
git add delivery-saas-backend/src/services/unitConversion.js
git commit -m "feat(stock): add unit conversion utility for composites"
```

---

## Task 3: Composite cost & cycle-detection service

**Files:**
- Create: `delivery-saas-backend/src/services/compositeCost.js`

**Step 1: Write the module**

```js
import { prisma } from '../prisma.js';
import { convertQuantity } from './unitConversion.js';

/**
 * Throws if adding `ingredientId` as a direct child of `compositeId`
 * would introduce a cycle. DFS the composition graph starting from
 * `ingredientId` and bail out if we reach `compositeId`.
 */
export async function assertNoCycle(compositeId, ingredientId, tx = prisma) {
  if (compositeId === ingredientId) {
    throw new Error('Um insumo composto não pode referenciar a si mesmo');
  }
  const visited = new Set();
  const stack = [ingredientId];
  while (stack.length) {
    const current = stack.pop();
    if (visited.has(current)) continue;
    visited.add(current);
    if (current === compositeId) {
      throw new Error('Ciclo detectado: esta composição criaria uma dependência circular');
    }
    const children = await tx.compositeIngredientItem.findMany({
      where: { compositeId: current },
      select: { ingredientId: true },
    });
    for (const c of children) stack.push(c.ingredientId);
  }
}

/**
 * Compute the derived avgCost for a composite ingredient.
 * Formula: sum( item.quantity * convert(item.ingredient.avgCost, item.ingredient.unit, item.unit) ) / convert(yieldQuantity, yieldUnit, composite.unit)
 * Returns null if any base ingredient lacks avgCost or if any unit is incompatible.
 */
export async function computeCompositeAvgCost(compositeId, tx = prisma) {
  const composite = await tx.ingredient.findUnique({
    where: { id: compositeId },
    include: {
      compositionItems: { include: { ingredient: true } },
    },
  });
  if (!composite || !composite.isComposite) return null;
  if (!composite.yieldQuantity || !composite.yieldUnit) return null;
  if (!composite.compositionItems.length) return null;

  let totalCost = 0;
  for (const item of composite.compositionItems) {
    const baseCost = item.ingredient.avgCost;
    if (baseCost == null) return null;
    // avgCost is a cost-per-base-unit value (Ingredient.unit). Multiply by item.quantity
    // expressed in the base ingredient's unit.
    const qtyInBaseUnit = convertQuantity(item.quantity, item.unit, item.ingredient.unit);
    if (qtyInBaseUnit == null) return null;
    totalCost += qtyInBaseUnit * Number(baseCost);
  }

  const yieldInCompositeUnit = convertQuantity(composite.yieldQuantity, composite.yieldUnit, composite.unit);
  if (!yieldInCompositeUnit || yieldInCompositeUnit <= 0) return null;

  return totalCost / yieldInCompositeUnit;
}

/**
 * Returns all composite IDs that depend (directly or transitively) on `ingredientId`,
 * in topological order from deepest (closest to base) to root.
 */
export async function findDependentComposites(ingredientId, tx = prisma) {
  // BFS upwards through usedInCompositions to collect all composite ancestors
  const affected = new Set();
  const queue = [ingredientId];
  while (queue.length) {
    const current = queue.shift();
    const parents = await tx.compositeIngredientItem.findMany({
      where: { ingredientId: current },
      select: { compositeId: true },
    });
    for (const p of parents) {
      if (!affected.has(p.compositeId)) {
        affected.add(p.compositeId);
        queue.push(p.compositeId);
      }
    }
  }

  // topological sort: composite A must be recomputed before any composite B that contains A
  const ids = [...affected];
  const depth = new Map();
  async function computeDepth(id) {
    if (depth.has(id)) return depth.get(id);
    const items = await tx.compositeIngredientItem.findMany({
      where: { compositeId: id },
      select: { ingredientId: true },
    });
    let max = 0;
    for (const it of items) {
      if (affected.has(it.ingredientId)) {
        max = Math.max(max, 1 + (await computeDepth(it.ingredientId)));
      }
    }
    depth.set(id, max);
    return max;
  }
  for (const id of ids) await computeDepth(id);
  ids.sort((a, b) => depth.get(a) - depth.get(b));
  return ids;
}

/**
 * Recompute and persist avgCost for all composites that depend on the given base ingredient(s).
 * Call this from any code path that changes an ingredient's avgCost.
 */
export async function cascadeRecomputeComposites(changedIngredientIds, tx = prisma) {
  const seen = new Set();
  for (const id of changedIngredientIds) {
    const deps = await findDependentComposites(id, tx);
    for (const d of deps) seen.add(d);
  }
  // sort again globally by depth relative to the whole affected set
  const idsInOrder = [...seen];
  // simple re-sort using findDependentComposites with a synthetic starting point won't help;
  // instead, iterate to a fixed point (safe because the graph is a DAG after cycle check).
  let changed = true;
  let iterations = 0;
  while (changed && iterations < idsInOrder.length + 1) {
    changed = false;
    iterations++;
    for (const id of idsInOrder) {
      const newCost = await computeCompositeAvgCost(id, tx);
      const current = await tx.ingredient.findUnique({ where: { id }, select: { avgCost: true } });
      const currentNum = current?.avgCost == null ? null : Number(current.avgCost);
      if (newCost !== currentNum) {
        await tx.ingredient.update({ where: { id }, data: { avgCost: newCost } });
        changed = true;
      }
    }
  }
}
```

**Step 2: Commit**

```bash
git add delivery-saas-backend/src/services/compositeCost.js
git commit -m "feat(stock): add composite cost recalc and cycle detection services"
```

---

## Task 4: Wire cascade recalc into stock movements

**Files:**
- Modify: `delivery-saas-backend/src/routes/stock/stockMovements.js` (around line 30-65)

**Step 1: Import the service**

At the top of the file:

```js
import { cascadeRecomputeComposites } from '../../services/compositeCost.js';
```

**Step 2: After the per-item loop inside the `$transaction`, before `return await tx.stockMovement.findUnique`**

```js
      const changedIngredientIds = items.map(it => it.ingredientId);
      await cascadeRecomputeComposites(changedIngredientIds, tx);
```

**Step 3: Manual verification**

Start the dev stack (`docker compose up -d`), then:
1. Create two base ingredients via the UI with known `avgCost` values.
2. Via REST, create a composite ingredient (Task 6 exposes this) whose composition references them.
3. Create a stock-movement of type `IN` that changes the `avgCost` of one base.
4. Re-GET the composite and confirm its `avgCost` changed proportionally.

**Step 4: Commit**

```bash
git add delivery-saas-backend/src/routes/stock/stockMovements.js
git commit -m "feat(stock): recalc composite costs when stock movements change avgCost"
```

---

## Task 5: Ingredient routes — accept composite payload and items

**Files:**
- Modify: `delivery-saas-backend/src/routes/stock/ingredients.js`

**Step 1: Inspect current `POST /ingredients` and `PATCH /ingredients/:id` handlers**

Read the file and locate the create / update handlers.

**Step 2: Extend payload parsing**

Accept these additional fields on both POST and PATCH:

- `isComposite: boolean`
- `yieldQuantity: number | null`
- `yieldUnit: string | null`
- `compositionItems: [{ id?, ingredientId, quantity, unit }]`  (only used when `isComposite === true`)

Validation rules (reject with 400 on violation):
- If `isComposite === true`: `yieldQuantity` must be > 0, `yieldUnit` must be in `['UN','GR','KG','ML','L']`, and `compositionItems` must be non-empty.
- Every item must reference an ingredient belonging to the same `companyId`.
- Every item's `unit` must be compatible with that base ingredient's `unit` (use `areUnitsCompatible`). Reject otherwise with `"Unidade incompatível com o ingrediente X"`.
- Call `assertNoCycle(compositeId, item.ingredientId, tx)` for every item (skip on POST-with-new id — call after the ingredient is created but before items are inserted).

**Step 3: Persist inside a transaction**

```js
await prisma.$transaction(async (tx) => {
  // upsert ingredient
  // delete existing compositionItems for this composite (on update)
  // create new compositionItems from payload
  // assertNoCycle for each item
  // cascadeRecomputeComposites([ingredient.id]) so composites that contain this one re-evaluate
});
```

**Step 4: Expand `GET /ingredients/:id` to include `compositionItems` with nested `ingredient`**

```js
include: { compositionItems: { include: { ingredient: true } }, group: true }
```

**Step 5: Commit**

```bash
git add delivery-saas-backend/src/routes/stock/ingredients.js
git commit -m "feat(api): accept composite fields and items on ingredient create/update"
```

---

## Task 6: "Produzir" endpoint

**Files:**
- Modify: `delivery-saas-backend/src/routes/stock/ingredients.js` (add new endpoint)

**Step 1: Add route**

```js
// POST /ingredients/:id/produce — create a PRODUCTION movement that
// debits bases proportionally and credits the composite.
router.post('/:id/produce', async (req, res) => {
  try {
    const { id } = req.params;
    const { quantity, storeId, note, allowNegative } = req.body;
    const companyId = req.user.companyId;
    const qty = Number(quantity);
    if (!qty || qty <= 0) return res.status(400).json({ message: 'Quantidade inválida' });

    const composite = await prisma.ingredient.findFirst({
      where: { id, companyId, isComposite: true },
      include: { compositionItems: { include: { ingredient: true } } },
    });
    if (!composite) return res.status(404).json({ message: 'Insumo composto não encontrado' });
    if (!composite.yieldQuantity || Number(composite.yieldQuantity) <= 0) {
      return res.status(400).json({ message: 'Composto sem rendimento definido' });
    }

    const ratio = qty / Number(composite.yieldQuantity);
    const baseConsumption = composite.compositionItems.map(item => {
      const consumedInItemUnit = Number(item.quantity) * ratio;
      // debit the base ingredient in its own unit
      const consumedInBaseUnit = convertQuantity(consumedInItemUnit, item.unit, item.ingredient.unit);
      return { ingredientId: item.ingredientId, qtyInBaseUnit: consumedInBaseUnit, baseIngredient: item.ingredient };
    });

    if (!allowNegative) {
      for (const c of baseConsumption) {
        if (Number(c.baseIngredient.currentStock || 0) < c.qtyInBaseUnit) {
          return res.status(400).json({ message: `Estoque insuficiente para ${c.baseIngredient.description}` });
        }
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      const movement = await tx.stockMovement.create({
        data: { companyId, storeId: storeId || null, type: 'PRODUCTION', note: note || null },
      });

      // debit bases
      for (const c of baseConsumption) {
        await tx.stockMovementItem.create({
          data: { stockMovementId: movement.id, ingredientId: c.ingredientId, quantity: c.qtyInBaseUnit, unitCost: null },
        });
        const base = await tx.ingredient.findUnique({ where: { id: c.ingredientId } });
        await tx.ingredient.update({
          where: { id: c.ingredientId },
          data: { currentStock: Number(base.currentStock || 0) - c.qtyInBaseUnit },
        });
      }

      // credit composite
      await tx.stockMovementItem.create({
        data: { stockMovementId: movement.id, ingredientId: composite.id, quantity: qty, unitCost: null },
      });
      await tx.ingredient.update({
        where: { id: composite.id },
        data: { currentStock: Number(composite.currentStock || 0) + qty },
      });

      // recalc any composites that depend on the bases we just changed
      const changedIds = [...baseConsumption.map(c => c.ingredientId), composite.id];
      await cascadeRecomputeComposites(changedIds, tx);

      return tx.stockMovement.findUnique({ where: { id: movement.id }, include: { items: { include: { ingredient: true } } } });
    });

    res.json(result);
  } catch (e) {
    console.error('POST /ingredients/:id/produce error', e);
    res.status(500).json({ message: e.message || 'Erro ao registrar produção' });
  }
});
```

Also import at top of file:
```js
import { convertQuantity } from '../../services/unitConversion.js';
import { cascadeRecomputeComposites } from '../../services/compositeCost.js';
```

**Step 2: Manual verification**

- POST `/ingredients/<compositeId>/produce` with `{ quantity: 2500 }`.
- Confirm: new `StockMovement` of type `PRODUCTION` exists; each base's `currentStock` decreased by `(qty / yield) * item.quantity` (converted to base unit); composite's `currentStock` increased by `qty`.

**Step 3: Commit**

```bash
git add delivery-saas-backend/src/routes/stock/ingredients.js
git commit -m "feat(api): add POST /ingredients/:id/produce for composites"
```

---

## Task 7: Refactor IngredientForm — shared components + labels

**Files:**
- Modify: `delivery-saas-frontend/src/views/stock/IngredientForm.vue`

**Step 1: Check existing `TextInput` / `SelectInput` signatures**

```bash
grep -n "defineProps" delivery-saas-frontend/src/components/TextInput.vue delivery-saas-frontend/src/components/SelectInput.vue
```

Note: modelValue prop, `label`, `placeholder`, `required`, `type`, etc. Adapt usage below to match.

**Step 2: Rewrite the template — section 1 (Identificação)**

Replace the current flat row with a clearly labeled grid:

```vue
<fieldset class="mb-3">
  <legend class="h6 text-muted border-bottom pb-1 mb-3">Identificação</legend>
  <div class="row g-3">
    <div class="col-md-5">
      <label class="form-label">Descrição <span class="text-danger">*</span></label>
      <TextInput v-model="form.description" placeholder="Ex: Feijão cru" required />
    </div>
    <div class="col-md-3">
      <label class="form-label">Unidade</label>
      <SelectInput v-model="form.unit" :options="UNITS.map(u => ({ value: u, label: u }))" />
    </div>
    <div class="col-md-4">
      <label class="form-label">Grupo</label>
      <SelectInput v-model="form.groupId"
        :options="[{ value: null, label: '-- Sem grupo --' }, ...groups.map(g => ({ value: g.id, label: g.name }))]" />
    </div>
  </div>
</fieldset>
```

**Step 3: Section 2 (Estoque)**

```vue
<fieldset class="mb-3">
  <legend class="h6 text-muted border-bottom pb-1 mb-3">Estoque</legend>
  <div class="row g-3">
    <div class="col-md-3 d-flex align-items-end">
      <div class="form-check">
        <input class="form-check-input" type="checkbox" v-model="form.controlsStock" id="ctrlstock" />
        <label class="form-check-label" for="ctrlstock">Controla estoque</label>
      </div>
    </div>
    <div class="col-md-3">
      <label class="form-label">Estoque mínimo</label>
      <TextInput v-model="form.minStock" type="number" step="any" :disabled="!form.controlsStock" />
    </div>
    <div class="col-md-3">
      <label class="form-label">Estoque atual</label>
      <TextInput v-model="form.currentStock" type="number" step="any" :disabled="!form.controlsStock" />
    </div>
    <div class="col-md-3">
      <label class="form-label">Custo médio</label>
      <TextInput v-model="form.avgCost" type="number" step="0.01" :disabled="form.isComposite" />
      <small v-if="form.isComposite" class="text-muted">Derivado da composição</small>
    </div>
    <div class="col-md-3">
      <div class="form-check">
        <input class="form-check-input" type="checkbox" v-model="form.composesCmv" id="composes" />
        <label class="form-check-label" for="composes">Compõe CMV</label>
      </div>
    </div>
  </div>
</fieldset>
```

**Step 4: Add `isComposite` to the reactive form default**

```js
const form = ref({
  id: null,
  description: '',
  unit: 'UN',
  groupId: null,
  controlsStock: true,
  composesCmv: false,
  minStock: '',
  currentStock: '',
  avgCost: '',
  isComposite: false,
  yieldQuantity: '',
  yieldUnit: 'GR',
  compositionItems: [],
});
```

Also load `isComposite`, `yieldQuantity`, `yieldUnit`, `compositionItems` in the edit path, and send them in the `save()` payload.

**Step 5: Manual verification**

Open `/ingredients/new` and `/ingredients/<id>/edit`, confirm labels display, required asterisk appears, `TextInput`/`SelectInput` styling matches the rest of the system.

**Step 6: Commit**

```bash
git add delivery-saas-frontend/src/views/stock/IngredientForm.vue
git commit -m "refactor(frontend): standardize IngredientForm with shared inputs and labels"
```

---

## Task 8: Composição section in IngredientForm

**Files:**
- Modify: `delivery-saas-frontend/src/views/stock/IngredientForm.vue`

**Step 1: Load ingredient list for the item picker**

In `onMounted`, also fetch the full ingredients list (excluding the current one if editing) to use as the dropdown for items.

```js
const allIngredients = ref([]);
// inside fetch():
const { data: all } = await api.get('/ingredients');
allIngredients.value = all.filter(i => !id || i.id !== id);
```

**Step 2: Add the toggle above the Composição section**

```vue
<div class="form-check form-switch mb-2">
  <input class="form-check-input" type="checkbox" v-model="form.isComposite" id="isComp" />
  <label class="form-check-label fw-semibold" for="isComp">Insumo composto (montado a partir de outros)</label>
</div>
```

**Step 3: Composição fieldset**

```vue
<fieldset v-if="form.isComposite" class="mb-3">
  <legend class="h6 text-muted border-bottom pb-1 mb-3">Composição</legend>
  <div class="row g-3 mb-2">
    <div class="col-md-3">
      <label class="form-label">Rendimento <span class="text-danger">*</span></label>
      <TextInput v-model="form.yieldQuantity" type="number" step="any" required />
    </div>
    <div class="col-md-3">
      <label class="form-label">Unidade do rendimento</label>
      <SelectInput v-model="form.yieldUnit" :options="UNITS.map(u => ({ value: u, label: u }))" />
    </div>
  </div>

  <table class="table table-sm table-hover align-middle">
    <thead>
      <tr>
        <th style="min-width:220px">Ingrediente</th>
        <th style="width:120px">Quantidade</th>
        <th style="width:100px">Unidade</th>
        <th style="width:120px" class="text-end">Custo atual</th>
        <th style="width:40px"></th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="(item, idx) in form.compositionItems" :key="idx">
        <td>
          <SelectInput v-model="item.ingredientId"
            :options="allIngredients.map(i => ({ value: i.id, label: i.description + (i.isComposite ? ' (composto)' : '') }))" />
        </td>
        <td><TextInput v-model="item.quantity" type="number" step="any" /></td>
        <td><SelectInput v-model="item.unit" :options="UNITS.map(u => ({ value: u, label: u }))" /></td>
        <td class="text-end text-muted small">{{ itemCostDisplay(item) }}</td>
        <td>
          <button type="button" class="btn btn-sm btn-outline-danger" @click="form.compositionItems.splice(idx, 1)">
            <i class="bi bi-x-lg"></i>
          </button>
        </td>
      </tr>
    </tbody>
    <tfoot>
      <tr>
        <td colspan="5">
          <button type="button" class="btn btn-sm btn-outline-primary" @click="addCompositionItem">
            <i class="bi bi-plus-lg me-1"></i>Adicionar ingrediente
          </button>
        </td>
      </tr>
      <tr>
        <td colspan="3" class="text-end fw-semibold">Custo total dos insumos:</td>
        <td class="text-end fw-semibold">{{ totalCompositionCost.toFixed(4) }}</td>
        <td></td>
      </tr>
      <tr>
        <td colspan="3" class="text-end fw-semibold">Custo por {{ form.yieldUnit || '—' }} do composto:</td>
        <td class="text-end fw-semibold text-primary">{{ derivedAvgCost.toFixed(4) }}</td>
        <td></td>
      </tr>
    </tfoot>
  </table>
</fieldset>
```

**Step 4: Helper functions**

```js
function addCompositionItem() {
  form.value.compositionItems.push({ ingredientId: null, quantity: '', unit: 'GR' });
}

function findIngredient(id) {
  return allIngredients.value.find(i => i.id === id);
}

function itemCostDisplay(item) {
  const ing = findIngredient(item.ingredientId);
  if (!ing || ing.avgCost == null || !item.quantity) return '—';
  return (Number(ing.avgCost) * Number(item.quantity)).toFixed(4);
}

const totalCompositionCost = computed(() => {
  return form.value.compositionItems.reduce((acc, it) => {
    const ing = findIngredient(it.ingredientId);
    if (!ing || ing.avgCost == null || !it.quantity) return acc;
    return acc + Number(ing.avgCost) * Number(it.quantity);
  }, 0);
});

const derivedAvgCost = computed(() => {
  const y = Number(form.value.yieldQuantity);
  if (!y) return 0;
  return totalCompositionCost.value / y;
});
```

Remember to import `computed` from vue.

**Step 5: Manual verification**

1. Toggle "Insumo composto" — Composição section appears.
2. Add 2 items with valid quantities. Confirm "Custo atual" and totals render live.
3. Save — reload — composition round-trips correctly.
4. Try to save a composition that references the ingredient being edited (indirectly) — backend should reject with cycle error (wire error message to a snack/alert).

**Step 6: Commit**

```bash
git add delivery-saas-frontend/src/views/stock/IngredientForm.vue
git commit -m "feat(frontend): add Composição section to IngredientForm"
```

---

## Task 9: Listing — "Composto" badge and "Produzir" action

**Files:**
- Modify: `delivery-saas-frontend/src/views/stock/Ingredients.vue`

**Step 1: Show a badge next to the description for composites**

Find the row that renders `ing.description` and add:

```vue
<span v-if="ing.isComposite" class="badge bg-info ms-2">Composto</span>
```

**Step 2: Action column — add "Produzir" button only for composites**

Beside the existing "Editar" button:

```vue
<button v-if="ing.isComposite" class="btn btn-sm btn-outline-success ms-1" @click="openProduce(ing)">
  <i class="bi bi-arrow-repeat me-1"></i>Produzir
</button>
```

**Step 3: Stub the handler for next task**

```js
function openProduce(ing) {
  produceTarget.value = ing;
  showProduce.value = true;
}
```

Declare `produceTarget = ref(null)` and `showProduce = ref(false)`.

**Step 4: Commit**

```bash
git add delivery-saas-frontend/src/views/stock/Ingredients.vue
git commit -m "feat(frontend): show Composto badge and Produzir button in ingredient list"
```

---

## Task 10: "Produzir" modal

**Files:**
- Create: `delivery-saas-frontend/src/components/ProduceCompositeModal.vue`
- Modify: `delivery-saas-frontend/src/views/stock/Ingredients.vue` (mount the modal)

**Step 1: Create the modal component**

```vue
<template>
  <div class="modal d-block" tabindex="-1" @click.self="$emit('close')">
    <div class="modal-dialog">
      <div class="modal-content">
        <div class="modal-header">
          <h5 class="modal-title">Produzir — {{ composite?.description }}</h5>
          <button type="button" class="btn-close" @click="$emit('close')"></button>
        </div>
        <div class="modal-body">
          <div class="mb-3">
            <label class="form-label">Quantidade produzida ({{ composite?.yieldUnit }})</label>
            <TextInput v-model="qty" type="number" step="any" required />
            <small class="text-muted">Rendimento padrão da receita: {{ composite?.yieldQuantity }} {{ composite?.yieldUnit }}</small>
          </div>

          <div v-if="ratio > 0">
            <p class="small fw-semibold mb-1">Consumo estimado:</p>
            <ul class="small mb-0">
              <li v-for="item in composite?.compositionItems || []" :key="item.id">
                {{ item.ingredient.description }}: {{ (Number(item.quantity) * ratio).toFixed(3) }} {{ item.unit }}
                <span v-if="insufficientStock(item)" class="text-danger">⚠ estoque insuficiente</span>
              </li>
            </ul>
          </div>

          <div v-if="error" class="alert alert-danger small mt-3 mb-0">{{ error }}</div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-outline-secondary" @click="$emit('close')">Cancelar</button>
          <button class="btn btn-success" :disabled="!canSubmit || submitting" @click="submit">
            <span v-if="submitting" class="spinner-border spinner-border-sm me-1"></span>Confirmar produção
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import api from '../api';
import TextInput from './TextInput.vue';

const props = defineProps({ composite: Object });
const emit = defineEmits(['close', 'produced']);

const qty = ref('');
const error = ref('');
const submitting = ref(false);

const ratio = computed(() => {
  const q = Number(qty.value);
  const y = Number(props.composite?.yieldQuantity || 0);
  return q > 0 && y > 0 ? q / y : 0;
});

function insufficientStock(item) {
  if (!item.ingredient) return false;
  const needed = Number(item.quantity) * ratio.value;
  // (simplification) compare in item.unit vs base unit — backend does the conversion and enforces strictly.
  return Number(item.ingredient.currentStock || 0) < needed;
}

const canSubmit = computed(() => ratio.value > 0);

async function submit() {
  submitting.value = true;
  error.value = '';
  try {
    await api.post(`/ingredients/${props.composite.id}/produce`, { quantity: Number(qty.value) });
    emit('produced');
    emit('close');
  } catch (e) {
    error.value = e?.response?.data?.message || 'Erro ao registrar produção';
  } finally {
    submitting.value = false;
  }
}
</script>
```

**Step 2: Mount it in Ingredients.vue**

```vue
<ProduceCompositeModal
  v-if="showProduce"
  :composite="produceTarget"
  @close="showProduce = false"
  @produced="onProduced"
/>
```

```js
import ProduceCompositeModal from '../../components/ProduceCompositeModal.vue';

async function onProduced() {
  // re-fetch list to get updated stock
  await loadIngredients();
}
```

**Step 3: Manual verification**

- Click "Produzir" on a composite in the list.
- Enter a quantity; confirm preview shows proportional consumption.
- Submit — confirm toast/alert success; list refreshes; stock of bases decreased; composite stock increased.
- Try with insufficient stock → backend returns 400 → error shown in the modal.

**Step 4: Commit**

```bash
git add delivery-saas-frontend/src/components/ProduceCompositeModal.vue delivery-saas-frontend/src/views/stock/Ingredients.vue
git commit -m "feat(frontend): add Produce Composite modal"
```

---

## Task 11: Final integration check and memory update

**Step 1: End-to-end manual test**

1. Create base ingredients: "Feijão cru" (GR, avgCost=0.005/g), "Alho" (GR, avgCost=0.03/g), "Óleo" (ML, avgCost=0.01/ml). Populate stock.
2. Create composite "Feijão em caldo": yield=2500/GR, items: 1000g feijão + 20g alho + 50ml óleo.
3. Confirm `avgCost` displayed on the composite matches hand calculation: (1000×0.005 + 20×0.03 + 50×0.01) / 2500 = 6.10 / 2500 = 0.00244.
4. Register an IN movement on "Feijão cru" that changes its avgCost — confirm "Feijão em caldo".avgCost recalculates automatically.
5. Use "Produzir" with quantity=2500 → confirm bases decreased by 1000g/20g/50ml and composite stock +2500g.
6. Create a second composite "Feijoada" that includes "Feijão em caldo" as a base — confirm nested composite cost is derived correctly.
7. Try to save a composition that creates a cycle (composite A → B → A) → confirm 400 error.

**Step 2: Update `MEMORY.md`**

Add one-liner under Architecture / Key Patterns:

```
- [Composite Ingredients](composite_ingredients.md) — ingredients can be composed of other ingredients; cost derived and cascades on stock movements
```

Create `C:\Users\gomes\.claude\projects\d--Users-gomes-Documents-GitHub-projetoDelivery\memory\composite_ingredients.md` with a short `project` memory summarizing the feature and the key files.

**Step 3: Commit and push**

```bash
git add .
git commit -m "docs: end-to-end verification notes for composite ingredients"
git push
```

---

## Post-plan summary

- Schema: `Ingredient.isComposite`, `yieldQuantity`, `yieldUnit`; new `CompositeIngredientItem` table; `MovementType.PRODUCTION`
- New services: `unitConversion.js`, `compositeCost.js`
- API: ingredient endpoints accept composite payload; `POST /ingredients/:id/produce`
- Frontend: refactored `IngredientForm.vue`; new `ProduceCompositeModal.vue`; badge + action in `Ingredients.vue`

YAGNI removed: automatic periodic recalculation, AI import of composites, bulk production. Cycle detection and unit-conversion validation are in from day one.
