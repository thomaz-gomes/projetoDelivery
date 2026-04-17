# Purchase Imports — Suppliers, Payables & Reconciliation — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Connect purchase imports to the financial module — Supplier CRUD, auto-generate accounts payable with installments, and show reconciliation status in listing.

**Architecture:** New Supplier model linked to PurchaseImport and FinancialTransaction. A bridge service (`purchaseFinancialBridge.js`) creates PAYABLE transactions on apply, reusing `installmentCalculator.js` for date calculation. Frontend adds payment terms UI in Step 3 and reconciliation columns in listing.

**Tech Stack:** Prisma + Express.js backend, Vue 3 + Bootstrap 5 frontend, existing `installmentCalculator.js` for installment dates.

**Design doc:** [2026-04-17-purchase-payables-design.md](2026-04-17-purchase-payables-design.md)

---

## Task 1: Supplier Model + Schema Changes

**Files:**
- Modify: `delivery-saas-backend/prisma/schema.prisma`

### Step 1: Add Supplier model

After the `PurchaseImport` model (~line 1601), add:

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

### Step 2: Add relations to existing models

**Company model** (~line 67, after `purchaseImports`):
```prisma
suppliers            Supplier[]
```

**PurchaseImport model** (~line 1572, after `storeId`/`store`):
```prisma
supplierId      String?
supplier        Supplier? @relation(fields: [supplierId], references: [id])
```

**FinancialTransaction model** (~line 1812, after `sourceId`):
```prisma
supplierId            String?
supplier              Supplier? @relation(fields: [supplierId], references: [id])
```

### Step 3: Push schema

```bash
docker compose exec backend ./node_modules/.bin/prisma db push
docker compose exec backend ./node_modules/.bin/prisma generate
```

### Step 4: Commit

```bash
git add delivery-saas-backend/prisma/schema.prisma
git commit -m "feat(schema): add Supplier model + supplierId on PurchaseImport and FinancialTransaction"
```

---

## Task 2: Supplier CRUD Backend Routes

**Files:**
- Create: `delivery-saas-backend/src/routes/stock/suppliers.js`
- Modify: `delivery-saas-backend/src/server.js` (register route)

### Step 1: Create suppliers route file

```javascript
import { Router } from 'express'
import prisma from '../../prisma.js'
import { requireRole } from '../../middleware/auth.js'

const router = Router()

// GET /suppliers — list all suppliers for company
router.get('/', requireRole('ADMIN'), async (req, res) => {
  const companyId = req.user.companyId
  const rows = await prisma.supplier.findMany({
    where: { companyId },
    orderBy: { name: 'asc' },
  })
  res.json(rows)
})

// POST /suppliers — create supplier
router.post('/', requireRole('ADMIN'), async (req, res) => {
  const companyId = req.user.companyId
  const { name, cnpj, phone, email, notes } = req.body || {}
  if (!name) return res.status(400).json({ message: 'Nome é obrigatório' })

  // Check unique CNPJ within company
  if (cnpj) {
    const cleanCnpj = cnpj.replace(/\D/g, '')
    const existing = await prisma.supplier.findUnique({
      where: { companyId_cnpj: { companyId, cnpj: cleanCnpj } },
    })
    if (existing) return res.status(400).json({ message: 'Fornecedor com este CNPJ já existe' })
  }

  const created = await prisma.supplier.create({
    data: {
      companyId,
      name,
      cnpj: cnpj ? cnpj.replace(/\D/g, '') : null,
      phone: phone || null,
      email: email || null,
      notes: notes || null,
    },
  })
  res.status(201).json(created)
})

// PATCH /suppliers/:id — update supplier
router.patch('/:id', requireRole('ADMIN'), async (req, res) => {
  const { id } = req.params
  const companyId = req.user.companyId
  const existing = await prisma.supplier.findFirst({ where: { id, companyId } })
  if (!existing) return res.status(404).json({ message: 'Fornecedor não encontrado' })

  const { name, cnpj, phone, email, notes, isActive } = req.body || {}

  if (cnpj !== undefined && cnpj) {
    const cleanCnpj = cnpj.replace(/\D/g, '')
    const dup = await prisma.supplier.findUnique({
      where: { companyId_cnpj: { companyId, cnpj: cleanCnpj } },
    })
    if (dup && dup.id !== id) return res.status(400).json({ message: 'Outro fornecedor já usa este CNPJ' })
  }

  const updated = await prisma.supplier.update({
    where: { id },
    data: {
      name: name ?? existing.name,
      cnpj: cnpj !== undefined ? (cnpj ? cnpj.replace(/\D/g, '') : null) : existing.cnpj,
      phone: phone !== undefined ? (phone || null) : existing.phone,
      email: email !== undefined ? (email || null) : existing.email,
      notes: notes !== undefined ? (notes || null) : existing.notes,
      isActive: isActive !== undefined ? Boolean(isActive) : existing.isActive,
    },
  })
  res.json(updated)
})

// DELETE /suppliers/:id — soft delete (deactivate)
router.delete('/:id', requireRole('ADMIN'), async (req, res) => {
  const { id } = req.params
  const companyId = req.user.companyId
  const existing = await prisma.supplier.findFirst({ where: { id, companyId } })
  if (!existing) return res.status(404).json({ message: 'Fornecedor não encontrado' })

  await prisma.supplier.update({ where: { id }, data: { isActive: false } })
  res.json({ message: 'Fornecedor desativado' })
})

export default router
```

### Step 2: Register route in server.js

Find where stock routes are imported (search for `purchaseImport` import) and add:

```javascript
import suppliersRouter from './routes/stock/suppliers.js'
// ... in the app.use section:
app.use('/suppliers', suppliersRouter)
```

### Step 3: Commit

```bash
git add delivery-saas-backend/src/routes/stock/suppliers.js delivery-saas-backend/src/server.js
git commit -m "feat(suppliers): CRUD routes for supplier management"
```

---

## Task 3: Purchase Financial Bridge Service

**Files:**
- Create: `delivery-saas-backend/src/services/financial/purchaseFinancialBridge.js`

### Step 1: Create bridge service

Pattern follows `orderFinancialBridge.js`. Uses `calculateInstallmentDates()` from `installmentCalculator.js`.

```javascript
import prisma from '../../prisma.js'
import { calculateInstallmentDates } from './installmentCalculator.js'

/**
 * Creates PAYABLE financial transactions for a purchase import.
 *
 * @param {string} purchaseImportId - The purchase import ID
 * @param {Object} paymentParams - Payment parameters from frontend
 * @param {string} paymentParams.payablePaymentMethodId - Selected payment method ID
 * @param {number} paymentParams.installmentCount - Number of installments (default 1)
 * @param {string} paymentParams.firstDueDate - First due date ISO string
 * @param {Array}  [paymentParams.installments] - Optional user-edited installments override
 * @returns {Object} { supplierId, transactionIds }
 */
export async function createFinancialEntriesForPurchase(purchaseImportId, paymentParams = {}) {
  const importRecord = await prisma.purchaseImport.findUnique({
    where: { id: purchaseImportId },
    include: { store: true },
  })
  if (!importRecord) throw new Error('Importação não encontrada')

  const companyId = importRecord.companyId
  const totalValue = Number(importRecord.totalValue || 0)
  if (totalValue <= 0) return { supplierId: null, transactionIds: [] }

  // 1. Upsert Supplier
  let supplierId = importRecord.supplierId || null
  if (!supplierId && importRecord.supplierCnpj) {
    const cleanCnpj = importRecord.supplierCnpj.replace(/\D/g, '')
    if (cleanCnpj.length === 14) {
      let supplier = await prisma.supplier.findUnique({
        where: { companyId_cnpj: { companyId, cnpj: cleanCnpj } },
      })
      if (!supplier) {
        supplier = await prisma.supplier.create({
          data: {
            companyId,
            cnpj: cleanCnpj,
            name: importRecord.supplierName || `Fornecedor ${cleanCnpj}`,
          },
        })
      }
      supplierId = supplier.id
      await prisma.purchaseImport.update({
        where: { id: purchaseImportId },
        data: { supplierId },
      })
    }
  }

  // 2. Load payment method for installment calculation
  const { payablePaymentMethodId, installmentCount = 1, firstDueDate } = paymentParams
  let method = null
  if (payablePaymentMethodId) {
    method = await prisma.payablePaymentMethod.findUnique({
      where: { id: payablePaymentMethodId },
    })
  }

  // 3. Calculate installment dates
  let installments
  if (paymentParams.installments && Array.isArray(paymentParams.installments) && paymentParams.installments.length > 0) {
    // User-edited installments override
    installments = paymentParams.installments.map((inst, i) => ({
      number: i + 1,
      dueDate: new Date(inst.dueDate),
      amount: Number(inst.amount),
    }))
  } else {
    const baseDate = firstDueDate ? new Date(firstDueDate) : (importRecord.issueDate || new Date())
    const methodType = method?.type || 'BOLETO'
    const result = calculateInstallmentDates(methodType, baseDate, installmentCount, {
      closingDay: method?.closingDay || 1,
      dueDay: method?.dueDay || 10,
      template: '30d',
    })
    // Distribute total value across installments
    const perInstallment = Math.floor((totalValue / installmentCount) * 100) / 100
    const remainder = Math.round((totalValue - perInstallment * installmentCount) * 100) / 100
    installments = result.installments.map((inst, i) => ({
      ...inst,
      amount: i === 0 ? perInstallment + remainder : perInstallment,
    }))
  }

  // 4. Find COGS cost center (if exists)
  let costCenterId = null
  try {
    const cogs = await prisma.costCenter.findFirst({
      where: { companyId, dreGroup: 'COGS', isActive: true },
    })
    if (cogs) costCenterId = cogs.id
  } catch (e) { /* ignore */ }

  // 5. Find default financial account
  let accountId = null
  if (method?.accountId) {
    accountId = method.accountId
  } else {
    try {
      const defaultAcc = await prisma.financialAccount.findFirst({
        where: { companyId, isDefault: true, isActive: true },
      })
      if (defaultAcc) accountId = defaultAcc.id
    } catch (e) { /* ignore */ }
  }

  // 6. Create transactions
  const nfeLabel = importRecord.nfeNumber ? `NFe #${importRecord.nfeNumber}` : 'Compra'
  const supplierLabel = importRecord.supplierName || 'Fornecedor'
  const totalInstallments = installments.length

  const transactionIds = []

  await prisma.$transaction(async (tx) => {
    for (const inst of installments) {
      const suffix = totalInstallments > 1 ? ` (${inst.number}/${totalInstallments})` : ''
      const txn = await tx.financialTransaction.create({
        data: {
          companyId,
          type: 'PAYABLE',
          status: 'PENDING',
          description: `${nfeLabel} - ${supplierLabel}${suffix}`,
          sourceType: 'STOCK_PURCHASE',
          sourceId: purchaseImportId,
          supplierId: supplierId || null,
          accountId,
          costCenterId,
          payablePaymentMethodId: payablePaymentMethodId || null,
          grossAmount: inst.amount,
          feeAmount: 0,
          netAmount: inst.amount,
          issueDate: importRecord.issueDate || new Date(),
          dueDate: inst.dueDate,
          storeId: importRecord.storeId || null,
          installmentNumber: inst.number,
          totalInstallments,
        },
      })
      transactionIds.push(txn.id)
    }
  })

  return { supplierId, transactionIds }
}
```

### Step 2: Commit

```bash
git add delivery-saas-backend/src/services/financial/purchaseFinancialBridge.js
git commit -m "feat(financial): bridge service to create PAYABLE transactions from purchase imports"
```

---

## Task 4: Integrate Bridge into Apply Route

**Files:**
- Modify: `delivery-saas-backend/src/routes/stock/purchaseImport.js` (POST /:id/apply, ~line 379)

### Step 1: Import bridge at top of file

```javascript
import { createFinancialEntriesForPurchase } from '../../services/financial/purchaseFinancialBridge.js'
```

### Step 2: Accept payment params in apply body

In the POST `/:id/apply` handler (~line 379), the route already reads `req.body`. Add destructuring of payment params:

```javascript
const { items, paymentParams } = req.body || {}
```

Note: currently `items` is read from `req.body.items` — check the exact destructuring and add `paymentParams` alongside it.

### Step 3: Call bridge after stock movement creation

After the stock movement is created and the PurchaseImport status is updated to APPLIED (~line 495), add:

```javascript
// Create financial transactions (accounts payable) if payment params provided
let financialResult = null
if (paymentParams) {
  try {
    financialResult = await createFinancialEntriesForPurchase(id, paymentParams)
  } catch (e) {
    console.warn('[purchaseImport] Failed to create financial entries:', e?.message || e)
    // Non-fatal — stock was already applied
  }
}
```

Include `financialResult` in the response JSON.

### Step 4: Commit

```bash
git add delivery-saas-backend/src/routes/stock/purchaseImport.js
git commit -m "feat(purchase): integrate financial bridge into apply route"
```

---

## Task 5: Reconciliation Columns in GET /purchase-imports

**Files:**
- Modify: `delivery-saas-backend/src/routes/stock/purchaseImport.js` (GET /, ~line 28)

### Step 1: Add financial reconciliation data to listing query

In the GET `/` handler, after fetching purchase imports, add a pass to compute reconciliation status. For each import with status APPLIED, query linked financial transactions:

```javascript
// After fetching rows, compute reconciliation status
const enriched = await Promise.all(rows.map(async (row) => {
  // Stock reconciliation: simple status check
  const stockReconciled = row.status === 'APPLIED'

  // Financial reconciliation: check linked transactions
  let financialStatus = 'NONE' // NONE | PARTIAL | FULL
  if (row.status === 'APPLIED') {
    const txns = await prisma.financialTransaction.findMany({
      where: { companyId, sourceType: 'STOCK_PURCHASE', sourceId: row.id },
      select: { status: true },
    })
    if (txns.length > 0) {
      const allPaid = txns.every(t => t.status === 'PAID')
      const somePaid = txns.some(t => t.status === 'PAID')
      if (allPaid) financialStatus = 'FULL'
      else if (somePaid) financialStatus = 'PARTIAL'
      else financialStatus = 'PENDING'
    }
  }

  return { ...row, stockReconciled, financialStatus }
}))

res.json(enriched)
```

### Step 2: Commit

```bash
git add delivery-saas-backend/src/routes/stock/purchaseImport.js
git commit -m "feat(purchase): add stock and financial reconciliation status to listing"
```

---

## Task 6: Frontend — Supplier Select in PurchaseImportModal Step 3

**Files:**
- Modify: `delivery-saas-frontend/src/views/stock/PurchaseImportModal.vue` (in `-crud` repo)

Note: this file is at `delivery-saas-frontend/src/components/PurchaseImportModal.vue` — verify exact path.

### Step 1: Add data refs

In the script section, add:

```javascript
const suppliers = ref([])
const payablePaymentMethods = ref([])
const paymentMethod = ref(null)
const installmentCount = ref(1)
const firstDueDate = ref(null)
const installments = ref([])
```

### Step 2: Load suppliers and payment methods

In the `loadReviewData()` function or `onMounted`, add:

```javascript
try { const s = await api.get('/suppliers'); suppliers.value = s.data || [] } catch (e) { suppliers.value = [] }
try { const pm = await api.get('/payable-payment-methods'); payablePaymentMethods.value = pm.data || [] } catch (e) { payablePaymentMethods.value = [] }
```

### Step 3: Add payment terms section in Step 3 template

After the items review table (after ~line 390), before the modal footer, add a payment terms section:

```html
<!-- Payment Terms -->
<div class="card mt-3" v-if="step === 3">
  <div class="card-header"><strong>Condições de Pagamento</strong></div>
  <div class="card-body">
    <div class="row g-3">
      <div class="col-md-4">
        <label class="form-label">Método de Pagamento</label>
        <SelectInput v-model="paymentMethod" class="form-control">
          <option :value="null">-- Selecione --</option>
          <option v-for="pm in payablePaymentMethods" :key="pm.id" :value="pm.id">
            {{ pm.name }}
          </option>
        </SelectInput>
      </div>
      <div class="col-md-4">
        <label class="form-label">Parcelas</label>
        <input v-model.number="installmentCount" type="number" min="1" max="48" class="form-control" />
      </div>
      <div class="col-md-4">
        <label class="form-label">Primeiro Vencimento</label>
        <input v-model="firstDueDate" type="date" class="form-control" />
      </div>
    </div>
    <button class="btn btn-outline-primary btn-sm mt-2" @click="generateInstallments">
      Gerar Parcelas
    </button>

    <!-- Installment table (editable) -->
    <table class="table table-sm mt-3" v-if="installments.length > 0">
      <thead>
        <tr>
          <th>Parcela</th>
          <th>Vencimento</th>
          <th>Valor (R$)</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(inst, idx) in installments" :key="idx">
          <td>{{ inst.number }}/{{ installments.length }}</td>
          <td><input v-model="inst.dueDate" type="date" class="form-control form-control-sm" /></td>
          <td><input v-model.number="inst.amount" type="number" step="0.01" class="form-control form-control-sm" /></td>
        </tr>
      </tbody>
      <tfoot>
        <tr>
          <td colspan="2" class="text-end"><strong>Total</strong></td>
          <td><strong>{{ installments.reduce((s, i) => s + Number(i.amount || 0), 0).toFixed(2) }}</strong></td>
        </tr>
      </tfoot>
    </table>
  </div>
</div>
```

### Step 4: Add generateInstallments function

```javascript
async function generateInstallments() {
  if (!paymentMethod.value || !installmentCount.value) return
  try {
    const { data } = await api.post('/financial/transactions/preview-installments', {
      payablePaymentMethodId: paymentMethod.value,
      installmentCount: installmentCount.value,
      purchaseDate: firstDueDate.value || importData.value?.issueDate || new Date().toISOString(),
      totalAmount: importData.value?.totalValue || 0,
    })
    installments.value = (data.installments || []).map(i => ({
      ...i,
      dueDate: i.dueDate ? i.dueDate.substring(0, 10) : '',
      amount: Number(i.amount || 0),
    }))
  } catch (e) {
    console.error('Failed to generate installments:', e)
  }
}
```

### Step 5: Include payment params in apply call

In the `applyToStock()` function (~line 723), add payment params to the request body:

```javascript
const paymentParams = installments.value.length > 0 ? {
  payablePaymentMethodId: paymentMethod.value,
  installmentCount: installmentCount.value,
  firstDueDate: firstDueDate.value,
  installments: installments.value,
} : null

// In the api.post call, add paymentParams to the body:
await api.post(`/purchase-imports/${importId}/apply`, { items: ..., paymentParams })
```

### Step 6: Commit

```bash
git add delivery-saas-frontend/src/components/PurchaseImportModal.vue
git commit -m "feat(purchase-ui): payment terms and installments in import review step"
```

---

## Task 7: Frontend — Preview Installments Endpoint

**Files:**
- Modify: `delivery-saas-backend/src/routes/financial/transactions.js` (~line 58)

### Step 1: Extend preview-installments to accept totalAmount

The existing `POST /financial/transactions/preview-installments` endpoint (~line 58) already calculates dates. Verify it also accepts `totalAmount` and distributes the value. If not, add amount distribution:

```javascript
// After calculating installment dates, distribute totalAmount
const totalAmount = Number(req.body.totalAmount || 0)
const perInstallment = Math.floor((totalAmount / count) * 100) / 100
const remainder = Math.round((totalAmount - perInstallment * count) * 100) / 100
const withAmounts = result.installments.map((inst, i) => ({
  ...inst,
  amount: i === 0 ? perInstallment + remainder : perInstallment,
}))
res.json({ installments: withAmounts })
```

### Step 2: Commit

```bash
git add delivery-saas-backend/src/routes/financial/transactions.js
git commit -m "feat(financial): add totalAmount distribution to preview-installments endpoint"
```

---

## Task 8: Frontend — Reconciliation Columns in PurchaseImports.vue

**Files:**
- Modify: `delivery-saas-frontend/src/views/stock/PurchaseImports.vue` (in `-crud` repo)

### Step 1: Add reconciliation column headers

In the table header section (~line 112-121), add after the existing status column:

```html
<th>CONC. FIN.</th>
<th>CONC. ESTOQ.</th>
```

### Step 2: Add reconciliation column cells

In the table body row (~line 124-159), add:

```html
<!-- Financial Reconciliation -->
<td>
  <span v-if="row.financialStatus === 'FULL'" class="badge bg-success">Sim</span>
  <span v-else-if="row.financialStatus === 'PARTIAL'" class="badge bg-warning">Parcial</span>
  <span v-else class="badge bg-danger">Não</span>
</td>
<!-- Stock Reconciliation -->
<td>
  <span v-if="row.stockReconciled" class="badge bg-success">Sim</span>
  <span v-else class="badge bg-danger">Não</span>
</td>
```

### Step 3: Update listing columns layout

Replace the current status column with the new reconciliation columns, or keep both. Update table column headers to match the design:

```
NÚMERO | FORNECEDOR | CNPJ/CPF | VALOR TOTAL | ENTRADA | EMISSÃO | CADASTRO | CONC. FIN. | CONC. ESTOQ. | AÇÕES
```

Add supplier CNPJ column. The `supplierCnpj` field already exists on PurchaseImport. Format with mask:

```html
<td>{{ formatCnpj(row.supplierCnpj) }}</td>
```

Add helper:
```javascript
function formatCnpj(cnpj) {
  if (!cnpj) return ''
  const c = cnpj.replace(/\D/g, '')
  if (c.length !== 14) return cnpj
  return c.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')
}
```

### Step 4: Commit

```bash
git add delivery-saas-frontend/src/views/stock/PurchaseImports.vue
git commit -m "feat(purchase-ui): reconciliation columns and supplier CNPJ in listing"
```

---

## Task 9: Frontend — Suppliers CRUD View

**Files:**
- Create: `delivery-saas-frontend/src/views/stock/Suppliers.vue`
- Modify: `delivery-saas-frontend/src/router/index.js` (add route)

### Step 1: Create Suppliers.vue

Standard CRUD table following existing patterns (similar to Ingredients.vue):
- List with columns: Nome, CNPJ, Telefone, Email, Ativo, Ações
- Inline modal for create/edit
- Deactivate (soft delete) action
- CNPJ formatted with mask
- Filter by name/CNPJ

Use `<SelectInput>`, `<TextInput>` component wrappers. Follow the existing pattern in Ingredients.vue or TechnicalSheets.vue for the table layout and modal structure.

### Step 2: Add route

In the router, add alongside other stock routes:

```javascript
{
  path: '/stock/suppliers',
  name: 'Suppliers',
  component: () => import('../views/stock/Suppliers.vue'),
  meta: { requiresAuth: true, roles: ['ADMIN', 'SUPER_ADMIN'] },
}
```

### Step 3: Add menu entry

In the sidebar/nav component, add "Fornecedores" under the Stock section.

### Step 4: Commit

```bash
git add delivery-saas-frontend/src/views/stock/Suppliers.vue delivery-saas-frontend/src/router/index.js
git commit -m "feat(suppliers-ui): CRUD view for supplier management"
```

---

## Task 10: Final Integration Test

### Step 1: Test full flow

1. Create a supplier manually via /stock/suppliers
2. Import a purchase note (XML or access key)
3. In Step 3 review, select payment method, set 2 installments
4. Click "Gerar Parcelas" — verify dates are correct
5. Edit an installment date manually
6. Apply — verify:
   - Stock movement created (existing behavior)
   - Supplier auto-created/linked
   - 2 FinancialTransactions (PAYABLE) created with correct dates/amounts
7. In listing, verify CONC. ESTOQ. = "Sim", CONC. FIN. = "Não"
8. Mark one transaction as PAID in financial module
9. Verify listing shows CONC. FIN. = "Parcial"
10. Mark second transaction as PAID
11. Verify listing shows CONC. FIN. = "Sim"

### Step 2: Test credit card installments

1. Create a PayablePaymentMethod type CREDIT_CARD with closingDay=15, dueDay=25
2. Import a note with issueDate = 10th of month
3. Set 3 installments with credit card method
4. Verify first installment due on 25th of same month (before closing)
5. Verify subsequent installments +1 month each

### Step 3: Final commit

```bash
git add -A
git commit -m "feat(purchase): complete purchase imports with suppliers, payables and reconciliation"
```
