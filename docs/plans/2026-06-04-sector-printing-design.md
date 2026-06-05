# Sector Printing — Design

**Date:** 2026-06-04  
**Status:** Approved

## Problem

`OrderItem` has no `category` field. The agent's `_extractCategories()` always returns `['all']` because `item.category` is never set. Every printer with `"all"` receives the full order. Items are never filtered per printer.

## Goal

Each sectoral printer receives only the items belonging to its configured categories. A kitchen printer prints only food items; a bar printer prints only drinks.

## Architecture

Three touch points — no new tables, no schema changes.

### 1. Backend: `enrichOrderForAgent.js`

After fetching order items from the DB, resolve each item's category via `productId → Product.categories (MenuCategory)`.

```js
for (const item of order.items) {
  if (item.productId && !item.category) {
    const prod = await prisma.product.findUnique({
      where: { id: item.productId },
      select: { categories: { select: { id: true, name: true } } }
    });
    if (prod?.categories?.length > 0) {
      item.categoryId = prod.categories[0].id;
      item.category   = prod.categories[0].name.toLowerCase();
      item.categories = prod.categories.map(c => c.name.toLowerCase());
    }
  }
}
```

**Items without `productId`** (external/iFood items with no DB match) remain without a category and are received only by `"all"` printers.

**Performance note:** N queries for N items. Acceptable for typical order sizes (2–10 items). Can be batched if needed later.

### 2. Agent: `printQueue.js`

Before calling `templateEngine.render()`, filter `order.items` to only include items matching the printer's categories.

```js
const isSetorial = !printer.categories.includes('all');
const filteredItems = isSetorial
  ? order.items.filter(item =>
      printer.categories.some(c =>
        item.category === c ||
        (Array.isArray(item.categories) && item.categories.includes(c))
      )
    )
  : order.items;

// Skip printer if it has no items for this order
if (isSetorial && filteredItems.length === 0) continue;

const o = { ...order, items: filteredItems };
// render using `o` instead of `order`
```

The rendered receipt shows: full header (order number, customer, address) + filtered items only. Totals reflect filtered items only (partial totals are acceptable for internal kitchen use).

### 3. Agent: `config.json` — printer configuration

No code change. Category names in the printer config must match `MenuCategory.name` (case-insensitive).

```json
"printers": [
  { "alias": "Cozinha", "categories": ["lanches", "pratos", "porcoes"], ... },
  { "alias": "Bar",     "categories": ["bebidas", "drinks"], ... },
  { "alias": "Caixa",   "categories": ["all"], ... }
]
```

## Data Flow

```
Order arrives at agent (Socket.IO)
  └─ enrichOrderForAgent (backend)
       └─ items[].category resolved from MenuCategory
  └─ printQueue._handleJob
       └─ getTargetPrinters → printers with matching categories
       └─ for each printer:
            ├─ filter order.items by printer.categories
            ├─ skip if no items
            └─ render + print filtered order
```

## What Does NOT Change

- `printerManager.getTargetPrinters()` — already reads `item.category` correctly, just had no data
- `templateEngine` — renders `order.items`, works with filtered list
- `receiptTemplate` (JSON v2 blocks) — items block renders whatever is in `order.items`
- `OrderItem` schema — no migration needed

## Edge Cases

| Scenario | Behavior |
|---|---|
| Item has no `productId` | No category → only `"all"` printers receive it |
| Item belongs to multiple categories | All matching printers receive it |
| Printer has `"all"` | Receives unfiltered order (current behavior) |
| Filtered order has 0 items for printer | Printer is skipped silently |
| iFood order (no DB product match) | Category lookup fails gracefully, item goes to `"all"` printers |
