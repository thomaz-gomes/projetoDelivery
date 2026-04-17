# Implementation Plan: Direct Stock Deduction for Resale Products

**Design:** [2026-04-16-direct-stock-deduction-design.md](2026-04-16-direct-stock-deduction-design.md)

## Steps

### Step 1 — Prisma Schema
**File:** `delivery-saas-backend/prisma/schema.prisma` (line ~934, after `technicalSheetId`)

Add:
```prisma
stockIngredientId   String?
stockIngredient     Ingredient?  @relation("ProductStockIngredient", fields: [stockIngredientId], references: [id])
```

Also add the inverse relation on the `Ingredient` model:
```prisma
stockProducts       Product[]    @relation("ProductStockIngredient")
```

Then run `prisma db push` inside the backend Docker container.

### Step 2 — Stock Deduction Logic
**File:** `delivery-saas-backend/src/services/stockFromOrder.js` (line 47, after the closing `}` of `if (product && product.technicalSheetId)`)

Insert `else if` block:
```js
else if (product && product.stockIngredientId) {
  try {
    const ing = await prismaInstance.ingredient.findUnique({ where: { id: product.stockIngredientId } });
    if (ing && ing.controlsStock) {
      addDed(product.stockIngredientId, itemQty);
    }
  } catch (e) { /* ignore */ }
}
```

Also update the product query at line 26 to include `stockIngredientId` in the select (currently uses `findFirst` without select, so it already returns all fields — no change needed).

### Step 3 — Backend Route Validation (POST)
**File:** `delivery-saas-backend/src/routes/menu.js` (line 395)

- Destructure `stockIngredientId` from `body` (add to existing destructure at line 395, default `null`)
- After the `technicalSheetId` validation block (line 413), add:
```js
if (stockIngredientId && technicalSheetId) {
  return res.status(400).json({ message: 'Produto não pode ter ficha técnica e ingrediente de estoque ao mesmo tempo' })
}
if (stockIngredientId) {
  const ing = await prisma.ingredient.findFirst({ where: { id: stockIngredientId, companyId, controlsStock: true } })
  if (!ing) return res.status(400).json({ message: 'Ingrediente de estoque inválido' })
}
```
- Add `stockIngredientId` to the `prisma.product.create({ data: { ... } })` call at line 415

### Step 4 — Backend Route Validation (PATCH)
**File:** `delivery-saas-backend/src/routes/menu.js` (line 477)

- Destructure `stockIngredientId` from `req.body` (add to existing destructure at line 477)
- After `technicalSheetId` validation block (line 533), add same mutual-exclusion + ingredient validation
- Add `stockIngredientId` to the `prisma.product.update({ data: { ... } })` call at line 535:
```js
stockIngredientId: stockIngredientId !== undefined ? stockIngredientId : existing.stockIngredientId
```
- For mutual exclusion in PATCH, also check the resolved values (considering existing):
```js
const finalTechSheet = technicalSheetId !== undefined ? technicalSheetId : existing.technicalSheetId
const finalStockIng = stockIngredientId !== undefined ? stockIngredientId : existing.stockIngredientId
if (finalTechSheet && finalStockIng) {
  return res.status(400).json({ message: 'Produto não pode ter ficha técnica e ingrediente de estoque ao mesmo tempo' })
}
```

### Step 5 — Frontend: Load Ingredients
**File:** `delivery-saas-frontend/src/views/ProductForm.vue`

- Add `stockIngredients` ref (line ~217): `const stockIngredients = ref([])`
- Add `stockIngredientId: null` to `form` ref (line 210)
- In `load()` function (after line 276, where technicalSheets are loaded), add:
```js
try {
  const si = await api.get('/ingredients')
  stockIngredients.value = (si.data || []).filter(i => i.controlsStock && i.unit === 'UN')
} catch(e) { stockIngredients.value = [] }
```
- When loading existing product (line 267), include `stockIngredientId` in the form spread

### Step 6 — Frontend: Select + Mutual Exclusion UI
**File:** `delivery-saas-frontend/src/views/ProductForm.vue` (line 73, after the Ficha Técnica `</div>`)

Replace the Dados Fiscais column to make room, or add a new row. Add select:
```vue
<div class="col-md-4">
  <label class="form-label">Ingrediente de Estoque (opcional)</label>
  <SelectInput v-model="form.stockIngredientId" class="form-control" :disabled="!!form.technicalSheetId">
    <option :value="null">-- Nenhum --</option>
    <option v-for="i in stockIngredients" :key="i.id" :value="i.id">
      {{ i.description }} ({{ Number(i.currentStock || 0) }} un)
    </option>
  </SelectInput>
  <div class="small text-muted mt-1">Para produtos de revenda (1 vendido = 1 baixa)</div>
</div>
```

Add watchers for mutual exclusion:
```js
watch(() => form.value.technicalSheetId, (v) => { if (v) form.value.stockIngredientId = null })
watch(() => form.value.stockIngredientId, (v) => { if (v) form.value.technicalSheetId = null })
```

### Step 7 — Frontend: Include in Save Payload
**File:** `delivery-saas-frontend/src/views/ProductForm.vue`

- Line 309 (edit payload): add `stockIngredientId: form.value.stockIngredientId`
- Line 329 (create payload): add `stockIngredientId: form.value.stockIngredientId`

### Step 8 — Test
- Create an ingredient "Coca-Cola 350ml" with `controlsStock=true`, `unit=UN`, `currentStock=50`
- Create a product "Coca-Cola 350ml" and link via `stockIngredientId`
- Place an order with qty=2 of that product
- Verify stock goes from 50 → 48
- Cancel the order, verify stock returns to 50
