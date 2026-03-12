# Purchase Import (NFe/Recibo) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable stock entry from NFe (electronic invoices) and receipt photos, using AI to match document items with existing inventory ingredients.

**Architecture:** New `PurchaseImport` model stores imported documents. Backend parses XML (via xml2js) and photos (via GPT-4o Vision), matches items to ingredients with AI. Frontend provides a wizard modal (same pattern as IngredientAiImportModal) and a dedicated list view under the stock module.

**Tech Stack:** Prisma + PostgreSQL, Express.js routes, xml2js for NFe XML parsing, OpenAI GPT-4o for matching, Vue 3 + Bootstrap 5 frontend.

**Design doc:** `docs/plans/2026-03-11-purchase-import-nfe-design.md`

---

## Task 1: Prisma Schema — PurchaseImport Model

**Files:**
- Modify: `delivery-saas-backend/prisma/schema.prisma`

**Step 1: Add PurchaseImport model to schema**

Add after the `StockMovementItem` model (around line 1270):

```prisma
model PurchaseImport {
  id              String         @id @default(uuid())
  companyId       String
  company         Company        @relation(fields: [companyId], references: [id])
  storeId         String
  store           Store          @relation(fields: [storeId], references: [id])
  source          String         // MDE | XML | ACCESS_KEY | RECEIPT_PHOTO
  status          String         @default("PENDING") // PENDING | MATCHED | APPLIED | ERROR

  accessKey       String?        @unique
  nfeNumber       String?
  nfeSeries       String?
  issueDate       DateTime?
  supplierCnpj    String?
  supplierName    String?
  totalValue      Float?
  rawXml          String?        @db.Text

  photoUrl        String?

  parsedItems     Json?

  stockMovementId String?
  stockMovement   StockMovement? @relation(fields: [stockMovementId], references: [id])

  createdAt       DateTime       @default(now())
  updatedAt       DateTime       @updatedAt

  @@index([companyId])
  @@index([storeId])
  @@index([status])
}
```

**Step 2: Add reverse relations**

Add `purchaseImports PurchaseImport[]` to:
- `Company` model (around line 34)
- `Store` model (around line 508)
- `StockMovement` model (around line 1254) — add `purchaseImports PurchaseImport[]`

**Step 3: Push schema**

```bash
cd delivery-saas-backend
npx prisma db push --skip-generate
npx prisma generate
```

**Step 4: Add AI credit service keys**

Add to `AI_SERVICE_COSTS` in `delivery-saas-backend/src/services/aiCreditManager.js`:

```javascript
NFE_IMPORT_MATCH:    1,  // por item matched com IA
NFE_RECEIPT_PHOTO:   5,  // por foto de recibo processada
```

Also add labels in `delivery-saas-backend/src/routes/saas.js` in the `CREDIT_SERVICE_LABELS` object:

```javascript
NFE_IMPORT_MATCH: 'Matching NFe→Estoque com IA',
NFE_RECEIPT_PHOTO: 'Importar recibo por foto com IA',
```

**Step 5: Commit**

```bash
git add prisma/schema.prisma src/services/aiCreditManager.js src/routes/saas.js
git commit -m "feat(stock): add PurchaseImport model and AI credit keys for NFe import"
```

---

## Task 2: Backend — XML Parser Service

**Files:**
- Create: `delivery-saas-backend/src/services/purchaseImportService.js`

**Step 1: Create the service file with parseXml function**

This service extracts structured data from NFe XML strings using `xml2js` (already a dependency via nfe-module).

```javascript
import { parseStringPromise } from 'xml2js';

/**
 * Parse NFe XML and extract header + items.
 * Supports both standalone <nfeProc> (authorized) and raw <NFe> formats.
 */
export async function parseNfeXml(xmlString) {
  const parsed = await parseStringPromise(xmlString, {
    explicitArray: false,
    ignoreAttrs: false,
  });

  // Navigate: nfeProc > NFe > infNFe  OR  NFe > infNFe
  const nfeProc = parsed.nfeProc || parsed;
  const nfe = nfeProc.NFe || nfeProc;
  const infNFe = nfe.infNFe || {};

  const ide = infNFe.ide || {};
  const emit = infNFe.emit || {};
  const det = infNFe.det; // single object or array
  const total = infNFe.total?.ICMSTot || {};

  // Access key from protNFe or from infNFe.$
  const protNFe = nfeProc.protNFe?.infProt || {};
  const accessKey = protNFe.chNFe || infNFe.$?.Id?.replace('NFe', '') || null;

  // Normalize det to array
  const detArray = Array.isArray(det) ? det : det ? [det] : [];

  const items = detArray.map((d) => {
    const prod = d.prod || {};
    return {
      nItem:    d.$.nItem || null,
      cProd:    prod.cProd || '',
      xProd:    prod.xProd || '',
      ncm:      prod.NCM || '',
      cfop:     prod.CFOP || '',
      uCom:     prod.uCom || '',
      qCom:     parseFloat(prod.qCom) || 0,
      vUnCom:   parseFloat(prod.vUnCom) || 0,
      vProd:    parseFloat(prod.vProd) || 0,
    };
  });

  return {
    accessKey,
    nfeNumber:    ide.nNF || null,
    nfeSeries:    ide.serie || null,
    issueDate:    ide.dhEmi ? new Date(ide.dhEmi) : null,
    supplierCnpj: emit.CNPJ || emit.CPF || null,
    supplierName: emit.xNome || null,
    totalValue:   parseFloat(total.vNF) || 0,
    items,
  };
}
```

**Step 2: Add matchItemsWithAI function**

```javascript
import { checkCredits, debitCredits } from './aiCreditManager.js';

/**
 * Use GPT-4o to match NFe item names with existing ingredients.
 * Returns items enriched with matchedIngredientId + confidence.
 */
export async function matchItemsWithAI(companyId, nfeItems, existingIngredients, userId) {
  const itemCount = nfeItems.length;
  if (itemCount === 0) return [];

  // Check credits
  const check = await checkCredits(companyId, 'NFE_IMPORT_MATCH', itemCount);
  if (!check.ok) {
    const err = new Error(`Créditos insuficientes. Necessário: ${check.totalCost}, Disponível: ${check.balance}`);
    err.statusCode = 402;
    throw err;
  }

  const catalogJson = existingIngredients.map(i => ({
    id: i.id,
    description: i.description,
    unit: i.unit,
    group: i.group?.name || null,
  }));

  const nfeItemsJson = nfeItems.map((it, idx) => ({
    index: idx,
    xProd: it.xProd,
    uCom: it.uCom,
    ncm: it.ncm || '',
  }));

  const systemPrompt = `You are an ingredient matching assistant for a restaurant inventory system.
You receive two lists:
1. "nfeItems" — items from a Brazilian NFe (electronic invoice) with product names (xProd), units (uCom), and NCM codes.
2. "catalog" — existing ingredients in the restaurant's inventory with id, description, unit, and group.

For each NFe item, find the best matching ingredient from the catalog using semantic similarity.
Consider that NFe names are often abbreviated or use commercial names (e.g., "TOMATE CARMEM KG" should match "Tomate").
NCM codes can help disambiguate (e.g., NCM 0702 = tomatoes).

Return a JSON array with one object per NFe item:
{
  "index": <number>,
  "matchedIngredientId": <string UUID or null>,
  "confidence": <number 0-1>,
  "suggestedName": <string — clean name for creating a new ingredient if no match>,
  "suggestedUnit": <string — one of UN, GR, KG, ML, L>
}

Rules:
- confidence >= 0.7 means a good match
- confidence < 0.5 means no match (set matchedIngredientId to null)
- If the catalog is empty, return all with null matchedIngredientId
- Output ONLY the JSON array, no other text`;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not configured');

  const model = process.env.OPENAI_IMPORT_MODEL || 'gpt-4o';
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: JSON.stringify({ nfeItems: nfeItemsJson, catalog: catalogJson }) },
      ],
    }),
  });

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content || '[]';

  let matches;
  try {
    const cleaned = content.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    matches = JSON.parse(cleaned);
  } catch {
    matches = nfeItems.map((_, idx) => ({
      index: idx, matchedIngredientId: null, confidence: 0,
      suggestedName: nfeItems[idx].xProd, suggestedUnit: 'UN',
    }));
  }

  // Debit credits
  await debitCredits(companyId, 'NFE_IMPORT_MATCH', itemCount, {
    source: 'nfe_import', itemCount,
  }, userId);

  // Merge matches back into items
  return nfeItems.map((item, idx) => {
    const m = matches.find(x => x.index === idx) || {};
    return {
      ...item,
      matchedIngredientId: m.matchedIngredientId || null,
      confidence: m.confidence || 0,
      suggestedName: m.suggestedName || item.xProd,
      suggestedUnit: m.suggestedUnit || 'UN',
      createNew: false,
    };
  });
}
```

**Step 3: Add parseReceiptPhoto function**

```javascript
/**
 * Extract items from a receipt photo using GPT-4o Vision + match with ingredients.
 */
export async function parseReceiptPhoto(companyId, base64Images, existingIngredients, userId) {
  const photoCount = Array.isArray(base64Images) ? base64Images.length : 1;
  const images = Array.isArray(base64Images) ? base64Images : [base64Images];

  // Check credits for photo processing
  const check = await checkCredits(companyId, 'NFE_RECEIPT_PHOTO', photoCount);
  if (!check.ok) {
    const err = new Error(`Créditos insuficientes. Necessário: ${check.totalCost}, Disponível: ${check.balance}`);
    err.statusCode = 402;
    throw err;
  }

  const catalogJson = existingIngredients.map(i => ({
    id: i.id,
    description: i.description,
    unit: i.unit,
    group: i.group?.name || null,
  }));

  const systemPrompt = `You are a receipt/invoice reader for a restaurant inventory system.
Analyze the receipt photo(s) and extract each purchased item line.
Also try to match each item with the existing ingredient catalog provided.

Existing ingredient catalog:
${JSON.stringify(catalogJson)}

For each item found in the receipt, return:
{
  "xProd": <product name as shown on receipt>,
  "qCom": <quantity>,
  "uCom": <unit as shown>,
  "vUnCom": <unit price>,
  "vProd": <total price for this line>,
  "matchedIngredientId": <UUID from catalog or null>,
  "confidence": <0-1>,
  "suggestedName": <clean name for new ingredient>,
  "suggestedUnit": <one of UN, GR, KG, ML, L>
}

Return ONLY a JSON array. Extract ALL visible item lines.`;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not configured');

  const imageContent = images.map(img => {
    const isDataUrl = img.startsWith('data:');
    return {
      type: 'image_url',
      image_url: { url: isDataUrl ? img : `data:image/jpeg;base64,${img}` },
    };
  });

  const model = process.env.OPENAI_IMPORT_MODEL || 'gpt-4o';
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      max_tokens: 4096,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: [
          ...imageContent,
          { type: 'text', text: 'Extract all items from this receipt and match with the ingredient catalog.' },
        ]},
      ],
    }),
  });

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content || '[]';

  let items;
  try {
    const cleaned = content.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    items = JSON.parse(cleaned);
  } catch {
    items = [];
  }

  // Debit credits
  await debitCredits(companyId, 'NFE_RECEIPT_PHOTO', photoCount, {
    source: 'receipt_photo', photoCount,
  }, userId);

  return items.map(item => ({
    ...item,
    createNew: false,
  }));
}
```

**Step 4: Commit**

```bash
git add src/services/purchaseImportService.js
git commit -m "feat(stock): add purchaseImportService with XML parser, AI matching, and receipt photo extraction"
```

---

## Task 3: Backend — Purchase Import Routes

**Files:**
- Create: `delivery-saas-backend/src/routes/stock/purchaseImport.js`
- Modify: `delivery-saas-backend/src/routes/stock/index.js`

**Step 1: Create the routes file**

Follow the same async job pattern as `ingredientImport.js`. Endpoints:

- `GET /purchase-imports` — list (filter: storeId, status, from/to)
- `GET /purchase-imports/:id` — detail
- `DELETE /purchase-imports/:id` — remove if PENDING/ERROR
- `POST /purchase-imports/parse` — start async parse job (XML upload, access key, receipt photo)
- `GET /purchase-imports/parse/:jobId` — poll job status
- `POST /purchase-imports/:id/match` — trigger AI matching on a PENDING import
- `POST /purchase-imports/:id/apply` — confirm: create new ingredients + StockMovement IN

Key implementation details:
- `parse` route: accepts `{ method: 'xml'|'access_key'|'receipt_photo', storeId, input }`
  - For `xml`: input is the XML string (or base64 of XML file)
  - For `access_key`: input is the 44-digit key (SEFAZ consultation — future, for now return error)
  - For `receipt_photo`: input is base64 image array
- `parse` creates `PurchaseImport` record and returns `{ jobId, importId }`
- `match` loads existing ingredients, calls `matchItemsWithAI()`, updates `parsedItems` and `status=MATCHED`
- `apply` creates ingredients marked `createNew`, then creates `StockMovement` type IN with all items in a Prisma transaction (same weighted average cost logic as existing `stockMovements.js`)

**Step 2: Register in stock index.js**

Add to `delivery-saas-backend/src/routes/stock/index.js`:

```javascript
export { purchaseImportRouter } from './purchaseImport.js'
```

Mount in the main app (check `src/app.js` or `src/server.js` where stock routes are mounted) with prefix `/purchase-imports`.

**Step 3: Commit**

```bash
git add src/routes/stock/purchaseImport.js src/routes/stock/index.js
git commit -m "feat(stock): add purchase import routes (parse, match, apply)"
```

---

## Task 4: Backend — MDe Service

**Files:**
- Create: `delivery-saas-backend/src/services/mdeService.js`
- Modify: `delivery-saas-backend/src/routes/stock/purchaseImport.js` (add mde/sync and mde/status routes)

**Step 1: Create MDe service**

Uses the store's certificate (from `secure/certs/` + settings.json) to call the SEFAZ NFeDistribuicaoDFe webservice (Ambiente Nacional — AN).

Key functions:
- `syncMde(storeId, companyId)` — loads store cert, calls DistribuicaoDFe, parses response, creates PurchaseImport records for new NFe
- Uses SOAP envelope format for the DFe Distribution webservice
- Endpoint: `https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx` (production)
- Homologation: `https://hom1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx`

**Important:** Check how the existing `nfe-module/` loads certificates. The cert path and encrypted password are in a settings file. Reuse the same loading logic (decrypt password with CERT_STORE_KEY env var).

Response parsing:
- `loteDistDFeInt > docZip` contains gzipped XML documents
- Each `docZip` has `@_schema` attribute indicating type (resNFe = summary, procNFe = full authorized NFe)
- For `resNFe` summaries: extract chNFe (access key), CNPJ, value, date
- For `procNFe` full: parse complete XML via `parseNfeXml()`

**Step 2: Add MDe routes to purchaseImport.js**

```
POST /purchase-imports/mde/sync   — body: { storeId } → calls syncMde, returns { fetched, newImports }
GET  /purchase-imports/mde/status — query: storeId → returns last sync time + pending count per store
```

**Step 3: Commit**

```bash
git add src/services/mdeService.js src/routes/stock/purchaseImport.js
git commit -m "feat(stock): add MDe service for automatic NFe retrieval from SEFAZ"
```

---

## Task 5: Frontend — Router and Nav

**Files:**
- Modify: `delivery-saas-frontend/src/router.js`
- Modify: `delivery-saas-frontend/src/config/nav.js`
- Create: `delivery-saas-frontend/src/views/stock/PurchaseImports.vue` (stub)

**Step 1: Add route**

In `router.js`, add import:
```javascript
import PurchaseImports from './views/stock/PurchaseImports.vue';
```

Add route after the stock-movements routes (around line 149):
```javascript
{ path: '/stock/purchase-imports', component: PurchaseImports, meta: { requiresAuth: true } },
```

**Step 2: Add nav entry**

In `nav.js`, add to the Estoque/Ingredientes section (the `children` array around line 30-34), or add as a sibling to "Movimentos de Estoque" (line 11):

```javascript
{ name: 'Importação de Compras', to: '/stock/purchase-imports', icon: 'bi bi-receipt', moduleKey: 'stock', lockable: true },
```

**Step 3: Create stub view**

Create `PurchaseImports.vue` with just the page title and a placeholder. This will be fleshed out in Task 6.

**Step 4: Commit**

```bash
git add src/router.js src/config/nav.js src/views/stock/PurchaseImports.vue
git commit -m "feat(stock): add purchase imports route and nav entry"
```

---

## Task 6: Frontend — PurchaseImports List View

**Files:**
- Modify: `delivery-saas-frontend/src/views/stock/PurchaseImports.vue`

**Step 1: Implement the list view**

Follow the same patterns as `StockMovements.vue` and `Ingredients.vue`:

- Top bar: Title "Importação de Compras" + button "Nova Importação" (opens PurchaseImportModal)
- Filters row: Store select (loads from `/stores`), status dropdown, date range (from/to)
- MDe sync card: per-store "Sincronizar NFe" button (calls `POST /purchase-imports/mde/sync`), shows last sync + pending count
- Table columns: Data | Fonte (badge) | Fornecedor | Loja | Nº Nota | Valor | Status (badge) | Ações
- Status badges with colors: PENDING=warning, MATCHED=info, APPLIED=success, ERROR=danger
- Actions: "Processar com IA" (PENDING), "Revisar" (MATCHED), "Ver Movimento" link (APPLIED)
- Pagination (same pattern as StockMovements)

API calls:
- `GET /purchase-imports?storeId=&status=&from=&to=&page=&limit=`
- `POST /purchase-imports/mde/sync` (for MDe button)
- `GET /purchase-imports/mde/status` (on mount, for each store)

**Step 2: Commit**

```bash
git add src/views/stock/PurchaseImports.vue
git commit -m "feat(stock): implement PurchaseImports list view with MDe sync and filters"
```

---

## Task 7: Frontend — PurchaseImportModal (Steps 1-2)

**Files:**
- Create: `delivery-saas-frontend/src/components/PurchaseImportModal.vue`
- Modify: `delivery-saas-frontend/src/views/stock/PurchaseImports.vue` (import + wire modal)

**Step 1: Create modal with Step 1 (method selection) and Step 2 (input)**

Follow the exact same wizard pattern as `MenuAiImportModal.vue`:

- 3-step progress bar (Método → Entrada → Revisão)
- Step 1: 4 method cards:
  - MDe Automático (`bi-cloud-download`) — select store, sync button
  - Upload XML (`bi-file-earmark-code`) — dropzone for .xml files
  - Chave de Acesso (`bi-key`) — input with 44-digit mask
  - Foto de Recibo (`bi-camera`) — photo upload (gallery/camera), shows credit cost
- Step 2: Input fields per method:
  - MDe: store select → "Sincronizar" → list of fetched NFe with checkboxes
  - XML: dropzone (multiple .xml), preview filenames
  - Chave: text input, validation (exactly 44 digits)
  - Foto: photo upload with gallery/camera buttons (same as MenuAiImportModal photo upload)
- Footer: "Cancelar" | "Voltar" | "Analisar" (triggers parse)

On "Analisar": calls `POST /purchase-imports/parse`, polls `GET /purchase-imports/parse/:jobId`, then calls `POST /purchase-imports/:id/match` for AI matching, then moves to Step 3.

Load AI credit costs from `/ai-credits/services` on mount (same pattern as MenuAiImportModal).

**Step 2: Wire modal into PurchaseImports.vue**

Add import, `showImportModal` ref, button click handler, and `@imported` event to refresh list.

**Step 3: Commit**

```bash
git add src/components/PurchaseImportModal.vue src/views/stock/PurchaseImports.vue
git commit -m "feat(stock): add PurchaseImportModal wizard (method selection + input steps)"
```

---

## Task 8: Frontend — PurchaseImportModal (Step 3: Review & Apply)

**Files:**
- Modify: `delivery-saas-frontend/src/components/PurchaseImportModal.vue`

**Step 1: Implement review table**

Step 3 shows a table of parsed items with match results:

Each row:
- Item NFe (xProd) — read-only text
- Qtd — editable number input
- Und — editable select (UN/GR/KG/ML/L)
- Custo Unit. — editable number input (vUnCom)
- Match Estoque — shows matched ingredient name + confidence bar
  - Green (>=90%): accepted auto
  - Yellow (70-89%): suggestion, user confirms
  - Red/None (<70%): "Criar novo" button
- Ação column:
  - Ingredient autocomplete select (to change match)
  - "Criar novo" toggle → inline fields: name, unit, group select

**Step 2: Implement inline ingredient creation**

When user clicks "Criar novo":
- Row expands with fields: Nome (pre-filled from suggestedName), Unidade (select), Grupo (select loaded from `/ingredient-groups`), Custo médio (pre-filled from vUnCom)
- Set `createNew: true` on the item

**Step 3: Implement credit estimate display**

Show badge at top of Step 3:
- "Custo: X crédito(s) de IA" (only if method is receipt_photo, or if matching was done)
- Balance check with canApply computed

**Step 4: Implement apply action**

On "Aplicar ao Estoque" button:
- Call `POST /purchase-imports/:id/apply` with final parsedItems (edited by user)
- Backend creates new ingredients (where createNew=true) and StockMovement IN
- On success: show Swal toast, emit `imported`, close modal
- On 402: show insufficient credits error

**Step 5: Commit**

```bash
git add src/components/PurchaseImportModal.vue
git commit -m "feat(stock): implement review table with AI matching, inline ingredient creation, and apply"
```

---

## Task 9: Integration Testing and Polish

**Files:**
- Various (bug fixes across backend + frontend)

**Step 1: Test XML import flow end-to-end**

1. Upload a sample NFe XML file
2. Verify parsedItems are extracted correctly
3. Trigger AI matching
4. Review matches in modal
5. Apply → verify StockMovement IN created, ingredient stocks updated

**Step 2: Test receipt photo flow**

1. Upload a receipt photo
2. Verify items are extracted via GPT-4o Vision
3. Review and correct matches
4. Apply → verify stock updated

**Step 3: Test MDe sync flow**

1. Configure a store with certificate
2. Trigger MDe sync
3. Verify NFe records appear in list with PENDING status
4. Process through matching and apply

**Step 4: Test edge cases**

- Duplicate access key (should be rejected)
- Empty XML / invalid XML (should return error)
- No existing ingredients (all items should show "Criar novo")
- Insufficient AI credits (should block at matching step)
- Multi-store: verify each import is correctly linked to storeId

**Step 5: Commit**

```bash
git add -A
git commit -m "fix(stock): polish purchase import flows and fix edge cases"
```

---

## Summary of New Files

| File | Type | Description |
|------|------|-------------|
| `schema.prisma` (modify) | Backend | PurchaseImport model + relations |
| `src/services/purchaseImportService.js` | Backend | XML parser, AI matching, receipt photo extraction |
| `src/services/mdeService.js` | Backend | MDe SEFAZ sync service |
| `src/routes/stock/purchaseImport.js` | Backend | REST routes for purchase imports |
| `src/routes/stock/index.js` (modify) | Backend | Export new router |
| `src/services/aiCreditManager.js` (modify) | Backend | New service keys |
| `src/routes/saas.js` (modify) | Backend | New credit labels |
| `src/views/stock/PurchaseImports.vue` | Frontend | List view with MDe sync + filters |
| `src/components/PurchaseImportModal.vue` | Frontend | Wizard modal (3 steps) |
| `src/router.js` (modify) | Frontend | New route |
| `src/config/nav.js` (modify) | Frontend | New nav entry |
