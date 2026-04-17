# Purchase Imports — Suppliers, Payables & Reconciliation

**Date:** 2026-04-17
**Status:** Approved

## Problem

Purchase imports (notas de entrada) currently only create stock movements. There is no:
- Dedicated Supplier model (supplier data stored as loose strings)
- Automatic accounts payable (contas a pagar) generation
- Installment/payment term management
- Financial or stock reconciliation status in the listing

## Solution

Add Supplier model, bridge purchase imports to FinancialTransaction (PAYABLE), support installments with credit card billing cycle logic, and show dual reconciliation status in the listing.

## Design

### 1. Supplier Model

```prisma
model Supplier {
  id          String   @id @default(uuid())
  companyId   String
  company     Company  @relation(fields: [companyId], references: [id])
  cnpj        String?
  name        String
  phone       String?
  email       String?
  notes       String?
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  purchaseImports       PurchaseImport[]
  financialTransactions FinancialTransaction[]

  @@unique([companyId, cnpj])
  @@index([companyId])
}
```

- Auto-created when importing a note with a new CNPJ
- `PurchaseImport` gains `supplierId` (optional FK)
- `FinancialTransaction` gains `supplierId` (optional FK)
- Basic CRUD: list, create, edit, deactivate

### 2. Payment Terms & Installments

Added to the import review step (Step 3 of PurchaseImportModal):

- **PayablePaymentMethod select** (boleto, PIX, credit card, cash, transfer)
- **Installment count** input (default: 1)
- **First due date** input (default: note issue date)
- **"Generate installments" button** — auto-calculates:
  - **Boleto/PIX/Transfer**: monthly due dates from first date
  - **Credit card**: respects `closingDay` and `dueDay` from PayablePaymentMethod
    - Purchase before closing → falls on next month's due date
    - Purchase after closing → falls on month+2 due date
  - **Cash**: single installment, due date = purchase date
- **Editable installment table**: user can adjust amount, date, and method per installment before saving

### 3. Purchase → Financial Bridge

On apply (after stock movement creation):

1. **Upsert Supplier** by company + CNPJ
2. **Create FinancialTransaction[]** (type: PAYABLE) — one per installment:
   - `sourceType: 'STOCK_PURCHASE'`
   - `sourceId: purchaseImport.id`
   - `supplierId: supplier.id`
   - `payablePaymentMethodId: selected method`
   - `grossAmount: installment value`
   - `netAmount: installment value`
   - `dueDate: calculated date`
   - `status: 'PENDING'`
   - `installmentNumber` / `totalInstallments`
   - `costCenterId`: auto-link to COGS cost center if exists
   - `description: "Compra NFe #${nfeNumber} - ${supplierName} (${n}/${total})"`
3. **Update PurchaseImport** with `supplierId`

### 4. Reconciliation Columns in Listing

**CONC. ESTOQ.** (Stock Reconciliation):
- `APPLIED` status → green "Sim"
- Any other status → red "Não"

**CONC. FIN.** (Financial Reconciliation):
- All linked transactions `PAID` → green "Sim"
- Some `PAID` → yellow "Parcial"
- None created or all `PENDING`/`OVERDUE` → red "Não"

Automatic: when a FinancialTransaction is marked PAID (manually or via OFX reconciliation), the listing updates.

### 5. Listing Columns (Final)

| NÚMERO | FORNECEDOR | CNPJ/CPF | VALOR TOTAL | ENTRADA | EMISSÃO | CADASTRO | CONC. FIN. | CONC. ESTOQ. | AÇÕES |

Actions: edit, view stock movement, view financial transactions, delete

### 6. Complete Flow

```
Import (XML/Key/MDe/Photo)
  → Parse + Match ingredients (existing)
  → Select/auto-create supplier (by CNPJ)
  → Define payment terms + installments
  → Apply
    → StockMovement IN (stock)
    → Supplier upsert
    → FinancialTransaction[] PAYABLE (accounts payable)
  → Listing shows dual reconciliation

Financial reconciliation:
  → Transaction marked PAID → CONC. FIN. updates
  → OFX import matches installment → reconciles

Stock reconciliation:
  → PurchaseImport.status = APPLIED → CONC. ESTOQ. = Sim
```

### 7. Files Impacted

| Area | File | Change |
|------|------|--------|
| Schema | `schema.prisma` | Supplier model, supplierId on PurchaseImport + FinancialTransaction |
| Backend | `routes/stock/suppliers.js` | New CRUD routes |
| Backend | `routes/stock/purchaseImport.js` | Installment params in apply, supplier upsert |
| Backend | `services/financial/purchaseFinancialBridge.js` | New bridge service (analogous to orderFinancialBridge) |
| Frontend | `PurchaseImports.vue` | Reconciliation columns, supplier column |
| Frontend | `PurchaseImportModal.vue` | Payment terms section in Step 3 |
| Frontend | `Suppliers.vue` | New CRUD view |
