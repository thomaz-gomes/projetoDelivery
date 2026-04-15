# Composite Ingredient ("Insumo Composto") — Design

Date: 2026-04-15
Scope: Stock module (ingredients, technical sheets)

## Goals

1. Standardize the ingredient form to use shared `TextInput`/`SelectInput` components with explicit labels (consistent with the rest of the system).
2. Introduce a new kind of ingredient — **insumo composto** — which is itself built from other ingredients with a yield, and whose unit cost is derived from the cost of its bases divided by the yield. Composite ingredients behave like any other ingredient when referenced from technical sheets.

## Form standardization

Replace raw `<input>` / `<select>` elements in `IngredientForm.vue` with `<TextInput>` / `<SelectInput>` wrappers, and add explicit `<label>` to every field. Group fields into sections:

- **Identificação** — descrição, unidade, grupo
- **Estoque** — controla estoque, estoque mínimo, estoque atual, custo médio, compõe CMV
- **Composição** (only when `isComposite = true`) — rendimento + itens

When `isComposite = true`, the "Custo médio" field becomes read-only (derived from composition).

## Data model

### Ingredient — new fields

```prisma
isComposite    Boolean   @default(false)
yieldQuantity  Decimal?  // produced amount per preparation (only for composites)
yieldUnit      String?   // GR / KG / ML / L / UN
```

`avgCost` keeps its meaning (unit cost); for composites it is derived, not user-edited.

### CompositeIngredientItem — new table

```prisma
model CompositeIngredientItem {
  id             String     @id @default(uuid())
  compositeId    String     // the parent composite Ingredient
  composite      Ingredient @relation("CompositeParent", fields: [compositeId], references: [id])
  ingredientId   String     // the base ingredient (can itself be composite)
  ingredient     Ingredient @relation("CompositeChild", fields: [ingredientId], references: [id])
  quantity       Decimal
  unit           String
  createdAt      DateTime   @default(now())
  updatedAt      DateTime   @updatedAt

  @@index([compositeId])
  @@index([ingredientId])
}
```

## Cost recalculation

`avgCost` of a composite:

```
avgCost(composite) = Σ( item.quantity × convert(item.ingredient.avgCost, item.ingredient.unit, item.unit) ) / convert(yieldQuantity, yieldUnit, composite.unit)
```

Recalculation triggers whenever a `StockMovement` that alters `avgCost` of any ingredient is confirmed:

1. Collect all composites that depend (direct or transitively) on the changed ingredient via `CompositeIngredientItem`.
2. Compute a topological order (deepest dependency first).
3. Recompute `avgCost` for each composite in order; persist to `Ingredient.avgCost`.

### Unit conversion

Supported conversions:
- `GR ↔ KG` (× 1000)
- `ML ↔ L` (× 1000)
- `UN` does not convert

If an item's unit is incompatible with its base ingredient's unit (e.g. item in `GR`, base is `UN`), reject on save with a validation error.

### Cycle detection

On save of a `CompositeIngredientItem`, run DFS starting at `ingredientId` following `CompositeIngredientItem` edges. If `compositeId` appears in the traversal, reject with `400 "Ciclo detectado: X depende de Y"`.

## "Produzir" flow

A **Produzir** button appears only on composites (in the ingredient list and in the form).

It opens a modal:

- Input: **Quantidade produzida** (unit fixed to composite `yieldUnit`).
- Live preview of each base consumed: `(X / yieldQuantity) × item.quantity`.
- Validation: blocks when any base has insufficient stock (an advanced "permitir estoque negativo" switch is available but hidden by default).
- Confirm: creates **one `StockMovement` of type `PRODUCTION`** atomically, containing:
  - one OUT item per base ingredient (proportional amount)
  - one IN item for the composite (produced amount)

Manual stock-in for the composite remains available via the normal stock-movement flow (registers entry without debiting bases).

## UI — Composição section

Revealed when **"Insumo composto"** toggle is on.

- **Rendimento**: numeric + unit select, side-by-side.
- **Itens table** with columns: Ingrediente (searchable select; excludes self and any composite that would create a cycle), Quantidade, Unidade, Custo atual (readonly, live-computed), Remover.
- **+ Adicionar ingrediente** button.
- Section footer shows: **Custo total dos insumos** and **Custo por unidade do composto** (live preview as the user types).

## Listing

- Composite ingredients show a visible `Composto` badge next to the description.
- Composites have an extra action button: **Produzir** (opens the production modal described above).

## Out of scope

- Automatic periodic recalculation (cost is only recalculated on stock movement events).
- Importing composite ingredients via AI (existing AI import flow keeps creating simple ingredients only).
- Bulk "production" (produce from a list of composites at once).
