# Direct Stock Deduction for Resale Products

**Date:** 2026-04-16
**Status:** Approved

## Problem

Products without a TechnicalSheet (resale items like sodas, beers, packaged goods) generate no stock movements when sold. There is no way to track inventory for these items.

## Solution

Add a `stockIngredientId` field to the Product model, creating a direct 1:1 link between a product and a stock ingredient. Each unit sold deducts 1 unit from the linked ingredient.

## Design

### Schema

New field on `Product`:

```prisma
stockIngredientId   String?
stockIngredient     Ingredient?  @relation(fields: [stockIngredientId], references: [id])
```

Mutually exclusive with `technicalSheetId` — a product uses one or the other, not both.

### Backend — Stock Deduction (stockFromOrder.js)

After the `if (product.technicalSheetId)` block, add:

```js
else if (product.stockIngredientId) {
  const ing = await prismaInstance.ingredient.findUnique({
    where: { id: product.stockIngredientId }
  });
  if (ing && ing.controlsStock) {
    addDed(product.stockIngredientId, itemQty);
  }
}
```

Reversal logic (`reverseStockMovementForOrder`) needs no changes — it already reverses by StockMovementItem.

### Backend — Product Routes (menu.js)

POST and PATCH validations:
- If `stockIngredientId` provided: verify ingredient exists, belongs to same company, has `controlsStock = true`
- If both `technicalSheetId` and `stockIngredientId` provided: reject with 400
- Include `stockIngredientId` in prisma create/update data

### Frontend — ProductForm.vue

New select field next to TechnicalSheet:
- Shows only ingredients with `controlsStock = true` and `unit = 'UN'`
- Disabled when `technicalSheetId` is set (and vice-versa)
- Displays current stock next to ingredient name

### Flow

```
Setup:  Product "Coca 350ml" → stockIngredientId = ingredient "Coca-Cola 350ml"
Sale:   Order with 3x "Coca 350ml" → addDed(ingredientId, 3) → -3 UN in stock
Cancel: Auto-reversal → +3 UN back
```

### Files Impacted

| File | Change |
|------|--------|
| `schema.prisma` | +2 lines (field + relation) |
| `stockFromOrder.js` | +5 lines (else if block) |
| `menu.js` (backend) | +10 lines (validation in POST and PATCH) |
| `ProductForm.vue` | +15 lines (select + mutual exclusion logic) |
