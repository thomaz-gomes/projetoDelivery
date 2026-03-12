# Importação de Compras via NFe / Recibo — Design

**Data:** 2026-03-11
**Status:** Aprovado

## Objetivo

Permitir a entrada de estoque a partir de notas fiscais eletrônicas (NFe) e recibos não-fiscais, usando IA para fazer o matching semântico entre os itens do documento e os ingredientes cadastrados no estoque.

## Decisões de Design

| Decisão | Escolha |
|---------|---------|
| Fonte principal | MDe (Manifestação do Destinatário) — consulta automática via certificado A1 |
| Fallbacks manuais | Upload XML, chave de acesso (44 dígitos), foto de recibo |
| Matching sem correspondência | Criação inline na tela de revisão (pré-preenchido com dados da NFe) |
| Foto de recibo | Extração + match automático via GPT-4o Vision |
| UI principal | Nova view dedicada `/stock/purchase-imports` vinculada ao módulo de estoque |
| Multi-CNPJ | Cada PurchaseImport vinculada a uma Store (CNPJ). MDe consulta por loja. |

## 1. Modelo de Dados

### Novo model: `PurchaseImport`

```prisma
model PurchaseImport {
  id            String   @id @default(uuid())
  companyId     String
  company       Company  @relation(fields: [companyId], references: [id])
  storeId       String
  store         Store    @relation(fields: [storeId], references: [id])
  source        String   // 'MDE' | 'XML' | 'ACCESS_KEY' | 'RECEIPT_PHOTO'
  status        String   // 'PENDING' | 'MATCHED' | 'APPLIED' | 'ERROR'

  // Dados da NFe
  accessKey     String?  @unique
  nfeNumber     String?
  nfeSeries     String?
  issueDate     DateTime?
  supplierCnpj  String?
  supplierName  String?
  totalValue    Float?
  rawXml        String?  @db.Text

  // Recibos não-fiscais
  photoUrl      String?

  // Itens extraídos (JSON intermediário antes do apply)
  // [{name, quantity, unit, unitCost, totalCost, ncm, matchedIngredientId, confidence, createNew}]
  parsedItems   Json?

  // Vínculo com StockMovement após aplicação
  stockMovementId String?
  stockMovement   StockMovement? @relation(fields: [stockMovementId], references: [id])

  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@index([companyId])
  @@index([storeId])
  @@index([status])
}
```

**Pontos-chave:**
- `storeId` vincula ao CNPJ (cada Store tem seu CNPJ e certificado)
- `accessKey` unique previne importação duplicada
- `parsedItems` como JSON armazena estado intermediário (itens + matches da IA)
- Após confirmação, `stockMovementId` vincula ao StockMovement tipo IN criado

## 2. Backend — Rotas e Serviços

### Novo módulo: `src/routes/stock/purchaseImport.js`

| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/purchase-imports` | Lista importações (filtro: storeId, status, período) |
| `GET` | `/purchase-imports/:id` | Detalhe com parsedItems |
| `DELETE` | `/purchase-imports/:id` | Remove importação pendente |
| `POST` | `/purchase-imports/parse` | Inicia job async (XML, chave, foto) |
| `GET` | `/purchase-imports/parse/:jobId` | Polling do job |
| `POST` | `/purchase-imports/:id/match` | Matching com IA (debita créditos) |
| `POST` | `/purchase-imports/:id/apply` | Cria ingredientes novos + StockMovement IN |
| `POST` | `/purchase-imports/mde/sync` | Consulta MDe para uma loja (por storeId) |
| `GET` | `/purchase-imports/mde/status` | Status da última sincronização por loja |

### Novo serviço: `src/services/purchaseImportService.js`

- `parseXml(xmlString)` — extrai chave, número, série, data, fornecedor, itens (cProd, xProd, qCom, uCom, vUnCom, vProd)
- `parseAccessKey(key44)` — consulta SEFAZ NfeConsultaProtocolo → obtém XML → delega parseXml()
- `parseReceiptPhoto(base64, existingIngredients[])` — GPT-4o Vision extrai itens + match semântico
- `matchItemsWithAI(nfeItems[], existingIngredients[])` — GPT-4o compara nomes NFe com catálogo, retorna matchedIngredientId + confidence

### Novo serviço: `src/services/mdeService.js`

- `syncMde(storeId)` — carrega cert A1 da loja → chama NFeDistribuicaoDFe (AN) → filtra resNFe → baixa XMLs → cria PurchaseImports PENDING

### Créditos de IA (novos service keys)

| Key | Custo | Quando |
|-----|-------|--------|
| `NFE_IMPORT_MATCH` | 1 / item | Matching semântico NFe→ingredientes |
| `NFE_RECEIPT_PHOTO` | 5 / foto | Extração + match de foto de recibo |

Parse de XML e chave de acesso NÃO consomem créditos (extração estruturada).

## 3. Frontend — View e Modal

### Nova view: `src/views/stock/PurchaseImports.vue`

**Rota:** `/stock/purchase-imports`

**Layout:**
- Topo: título + filtros (loja, período, status) + botão "Nova Importação"
- Card MDe: botão "Sincronizar NFe" por loja (última sync, quantas novas)
- Tabela: Data | Fonte (badge) | Fornecedor | Loja/CNPJ | Nº Nota | Valor Total | Status | Ações

**Status badges:** PENDING (amarelo), MATCHED (azul), APPLIED (verde), ERROR (vermelho)

**Ações por linha:**
- PENDING → "Processar com IA"
- MATCHED → "Revisar e Aplicar"
- APPLIED → "Ver Movimento" (link para StockMovement)

### Novo componente: `src/components/PurchaseImportModal.vue`

**Wizard 3 steps:**

**Step 1 — Método (4 cards):**
- MDe Automático (bi-cloud-download) — seleciona loja, sincroniza
- Upload XML (bi-file-earmark-code) — dropzone .xml
- Chave de Acesso (bi-key) — input 44 dígitos
- Foto de Recibo (bi-camera) — upload foto, usa créditos

**Step 2 — Input:**
- MDe: select loja → sync → lista notas com checkbox
- XML: dropzone múltiplos .xml
- Chave: input com máscara 44 dígitos
- Foto: upload galeria/câmera

**Step 3 — Revisão e Match:**

Tabela editável:
- Item NFe (xProd) | Qtd | Und | Custo Unit. | Match Estoque | Confiança | Ação
- Verde (>=90%): aceito auto | Amarelo (70-89%): sugestão | Vermelho (<70%): "Criar novo"
- Criação inline: campos pré-preenchidos (nome, unidade, grupo, custo)
- Select de ingrediente: autocomplete para trocar match
- Estimativa de créditos no topo

Footer: "Cancelar" | "Aplicar ao Estoque"

## 4. Fluxo de Dados

### NFe (MDe/XML/Chave):

```
Importação → parseXml() → PurchaseImport (PENDING) [sem créditos]
    ↓
"Processar com IA" → matchItemsWithAI() → PurchaseImport (MATCHED) [debita créditos]
    ↓
Revisão no frontend → usuário corrige/confirma matches
    ↓
Apply → cria ingredientes novos + StockMovement IN → PurchaseImport (APPLIED)
```

### Foto de recibo:

```
Upload → GPT-4o Vision extrai + match → PurchaseImport (MATCHED) [debita créditos]
    ↓
Revisão → Apply → StockMovement IN → PurchaseImport (APPLIED)
```

### Custo médio ponderado (já existente):

```
newAvgCost = ((currentStock * avgCost) + (inQty * unitCost)) / (currentStock + inQty)
```

Reusa a lógica existente do `POST /stock-movements` via Prisma transaction.

## 5. Navegação

```
Estoque
  ├── Ingredientes          (/ingredients)
  ├── Grupos                (/ingredient-groups)
  ├── Fichas Técnicas       (/technical-sheets)
  ├── Movimentações         (/stock-movements)
  └── Importação de Compras (/stock/purchase-imports)  ← NOVO
```

## 6. Dependências

- Módulo `ESTOQUE` habilitado no plano
- MDe requer certificado A1 configurado na loja (se ausente, card MDe aparece desabilitado)
- Multi-CNPJ: cada Store tem seu certificado e CNPJ; PurchaseImport sempre vinculada a uma Store
