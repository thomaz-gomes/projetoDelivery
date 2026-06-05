# Sector Printing Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Each sectoral printer receives only the items whose MenuCategory matches the printer's configured `categories`, instead of the full order.

**Architecture:** Two focused changes — (1) backend `enrichOrderForAgent` batches a single Prisma query to attach `category` to each `OrderItem` before emitting to the agent; (2) agent `printQueue` filters `order.items` per printer before rendering. No schema changes, no new tables.

**Tech Stack:** Node.js ESM (backend), Node.js CommonJS (agent), Prisma ORM, ESC/POS thermal printing

---

### Task 1: Backend — attach category to order items in `enrichOrderForAgent`

**Files:**
- Modify: `delivery-saas-backend/src/enrichOrderForAgent.js` (after step 1 item fetch, before `_enriched = true`)

**Context:** `Product` has `categoryId` and `category: MenuCategory { id, name }`. `OrderItem` has `productId`. We batch-fetch all product categories in one query and attach them to items. Items with no `productId` (iFood without DB match) get no category → go only to `"all"` printers.

**Step 1: Locate insertion point**

In `enrichOrderForAgent.js`, find the block that sets `order._enriched = true` (line ~266). The new code goes in the `try` block, just before that line.

**Step 2: Add batch category resolution**

Insert this block (ESM, uses already-imported `prisma`):

```js
// 6. Resolver categoria dos itens via Product.category (para impressão setorial)
if (Array.isArray(order.items) && order.items.length > 0) {
  try {
    const productIds = order.items
      .filter(i => i.productId && !i.category)
      .map(i => i.productId);

    if (productIds.length > 0) {
      const products = await prisma.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, category: { select: { id: true, name: true } } }
      });
      const productMap = Object.fromEntries(products.map(p => [p.id, p]));

      for (const item of order.items) {
        const prod = item.productId ? productMap[item.productId] : null;
        if (prod?.category) {
          item.categoryId  = prod.category.id;
          item.category    = prod.category.name.toLowerCase();
          item.categories  = [prod.category.name.toLowerCase()];
        }
      }
    }
  } catch (e) {
    console.warn('enrichOrderForAgent: category resolution failed:', e?.message);
  }
}
```

**Step 3: Verify it doesn't break the `_enriched` guard**

The guard `if (order._enriched) return order` is at line 20. Items already enriched by a previous call won't re-fetch categories because `!i.category` skips them.

**Step 4: Manual test (no test runner needed for this step)**

Trigger a reprint from the SaaS panel for an order with known products. Check backend logs for `enrichOrderForAgent` — no new errors. The agent should receive items with `category` field populated.

**Step 5: Commit**

```bash
git add delivery-saas-backend/src/enrichOrderForAgent.js
git commit -m "feat(print): attach MenuCategory to order items before agent emission"
```

---

### Task 2: Agent — filter items by printer category in `printQueue`

**Files:**
- Modify: `delivery-print-agent-electron/src/printQueue.js` (inside `for (const printer of targets)` loop, around line 142)

**Context:** `printer.categories` is an array like `["lanches", "bebidas"]` or `["all"]`. Items now carry `item.category` (string) and `item.categories` (string[]). If the printer is setorial (no `"all"`), filter items and skip the printer if no items match.

**Step 1: Locate the `o = { ...order }` line**

Find this block in `_handleJob` (around line 142):

```js
// Injetar cabeçalho local se o pedido não trouxe do backend
const o = { ...order };
if (!o.headerName && cfg.headerName) o.headerName = cfg.headerName;
if (!o.headerCity && cfg.headerCity) o.headerCity = cfg.headerCity;
```

**Step 2: Add item filtering immediately after `const o = { ...order }`**

```js
// Injetar cabeçalho local se o pedido não trouxe do backend
const o = { ...order };
if (!o.headerName && cfg.headerName) o.headerName = cfg.headerName;
if (!o.headerCity && cfg.headerCity) o.headerCity = cfg.headerCity;

// ── Filtro setorial: impressoras com categorias específicas recebem só seus itens ──
const isSetorial = Array.isArray(printer.categories)
  && printer.categories.length > 0
  && !printer.categories.includes('all');

if (isSetorial && Array.isArray(o.items)) {
  const printerCats = printer.categories.map(c => String(c).toLowerCase());
  const filtered = o.items.filter(item => {
    const itemCat  = item.category ? String(item.category).toLowerCase() : null;
    const itemCats = Array.isArray(item.categories)
      ? item.categories.map(c => String(c).toLowerCase())
      : [];
    return printerCats.some(c => c === itemCat || itemCats.includes(c));
  });

  if (filtered.length === 0) {
    logger.info(`[queue] Impressora "${printer.alias}" sem itens para este pedido — pulando.`);
    continue;
  }

  o.items = filtered;
}
```

**Step 3: Verify `continue` is valid here**

This code is inside `for (const printer of targets) { try { ... } }`. The `continue` must be BEFORE the `try` block opens, or the `try` must be restructured. Check the actual indentation in the file. If `continue` is inside `try`, move the setorial filter to just after `if (!printer.enabled) continue;` (line 127), before the `try`:

```js
for (const printer of targets) {
  if (!printer.enabled) continue;

  // ── Filtro setorial ────────────────────────────────────────────────────────
  const isSetorial = Array.isArray(printer.categories)
    && printer.categories.length > 0
    && !printer.categories.includes('all');

  let itemsForPrinter = order.items;
  if (isSetorial && Array.isArray(order.items)) {
    const printerCats = printer.categories.map(c => String(c).toLowerCase());
    itemsForPrinter = order.items.filter(item => {
      const itemCat  = item.category ? String(item.category).toLowerCase() : null;
      const itemCats = Array.isArray(item.categories)
        ? item.categories.map(c => String(c).toLowerCase())
        : [];
      return printerCats.some(c => c === itemCat || itemCats.includes(c));
    });
    if (itemsForPrinter.length === 0) {
      logger.info(`[queue] Impressora "${printer.alias}" sem itens para este pedido — pulando.`);
      continue;
    }
  }

  try {
    // ... existing code ...
    const o = { ...order, items: itemsForPrinter };
    // replace existing: const o = { ...order };
    // and remove the duplicate o.items assignment if any
```

**Step 4: Update `const o = { ...order }` inside the `try` block**

Replace `const o = { ...order };` with `const o = { ...order, items: itemsForPrinter };` so the filtered items are used for rendering.

**Step 5: Test with two printers configured**

In `config.json`, configure:
```json
"printers": [
  { "alias": "Caixa",   "categories": ["all"],      "enabled": true, ... },
  { "alias": "Cozinha", "categories": ["lanches"],   "enabled": true, ... }
]
```

Send a test order with at least one item in the `"lanches"` category. Expected:
- Caixa → full order (all items)
- Cozinha → only the `"lanches"` item(s)

Send an order with no `"lanches"` items. Expected:
- Caixa → prints normally
- Cozinha → skipped, log: `"sem itens para este pedido"`

**Step 6: Commit**

```bash
git add delivery-print-agent-electron/src/printQueue.js
git commit -m "feat(print): filter order items per sectoral printer category"
```

---

### Task 3: Document printer configuration

**Files:**
- Modify: `delivery-print-agent-electron/src/config.js` (JSDoc comment in `PrinterConfig` struct)

**Step 1: Update the `categories` JSDoc in `config.js`**

Find the comment block around line 27:

```js
/**
 * Estrutura de PrinterConfig:
 * {
 *   ...
 *   // Layout:
```

Update the `categories` line:

```js
 *   categories: string[],    // Categorias aceitas: ["all"] = tudo; ["lanches","bebidas"] = setorial.
 *                            // Nomes devem bater com MenuCategory.name (case-insensitive).
 *                            // Itens sem productId vão apenas para impressoras "all".
```

**Step 2: Commit**

```bash
git add delivery-print-agent-electron/src/config.js
git commit -m "docs(print): document sectoral category config in PrinterConfig JSDoc"
```

---

### Task 4: End-to-end validation

**Step 1: Set up two printers in `config.json`**

```json
"printers": [
  {
    "alias": "POS (Caixa)",
    "categories": ["all"],
    "interface": "usb",
    "windowsPrinterName": "POS80 Printer(2)",
    "width": 80, "columns": 48, "enabled": true
  },
  {
    "alias": "Cozinha",
    "categories": ["lanches"],
    "interface": "usb",
    "windowsPrinterName": "NOME_DA_IMPRESSORA_COZINHA",
    "width": 80, "columns": 48, "enabled": true
  }
]
```

**Step 2: Run agent from source**

```bash
cd delivery-print-agent-electron
npm start
```

**Step 3: Create a test order in the SaaS with mixed items**

- 1x item from category "Lanches"
- 1x item from category "Bebidas"

**Step 4: Trigger print and verify**

| Printer | Expected output |
|---|---|
| POS (Caixa) | Both items printed |
| Cozinha | Only the "Lanches" item |

**Step 5: Check logs for skipped printers**

If there are printers with categories that match no items, look for:
```
[queue] Impressora "..." sem itens para este pedido — pulando.
```

**Step 6: Rebuild agent exe for production**

After validation:
```bash
cd delivery-print-agent-electron
npm run build
```

Install the new `dist/Delivery Print Agent Setup 2.1.0.exe` on the production machine.

---

## Category Name Reference

Category names in `printer.categories` must match `MenuCategory.name` in the DB (case-insensitive). To list all category names:

```sql
SELECT name FROM "MenuCategory" WHERE "companyId" = 'YOUR_COMPANY_ID' ORDER BY name;
```

Or via Prisma Studio: `npx prisma studio` → MenuCategory table.
