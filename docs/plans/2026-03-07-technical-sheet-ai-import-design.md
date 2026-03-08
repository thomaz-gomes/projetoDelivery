# Import de Fichas Técnicas com IA

**Data:** 2026-03-07
**Status:** Aprovado

## Objetivo

Permitir cadastro em massa de fichas técnicas a partir de fotos, planilhas, PDFs e documentos Word, usando IA (GPT-4o) para extrair dados e fazer matching inteligente com ingredientes existentes.

## Abordagem

Replica o padrão do `MenuAiImportModal` — job assíncrono no backend, polling no frontend, GPT-4o para parsing. A IA faz todo o matching automaticamente e apresenta tela de revisão final.

## Schema (Prisma)

Adicionar campo `yield` ao `TechnicalSheet`:

```prisma
model TechnicalSheet {
  ...campos existentes...
  yield     String?    // Ex: "10 porções", "2kg"
}
```

## Backend — Rota `/technical-sheets/ai-import`

### Endpoints

**`POST /technical-sheets/ai-import/parse`** — Inicia job assíncrono
- Input: `{ method: "photo"|"spreadsheet"|"pdf"|"docx", files: [base64...] }`
- Suporta múltiplos arquivos
- GPT-4o com prompt que:
  1. Extrai fichas técnicas (nome, rendimento, ingredientes+quantidade+unidade)
  2. Recebe a lista de ingredientes existentes da empresa
  3. Faz matching inteligente (retorna `matchedIngredientId` ou `newIngredient: true`)
- Job armazena resultado em Map in-memory, expira em 15min

**`GET /technical-sheets/ai-import/parse/:jobId`** — Poll status
- Retorna: `{ done, sheets: [...], error, stage }`

**`POST /technical-sheets/ai-import/apply`** — Aplica fichas aprovadas
- Input: `{ sheets: [{ name, yield, items: [{ ingredientId?, newIngredient?, description, unit, quantity }] }] }`
- Cria ingredientes novos (marcados pelo usuário)
- Cria TechnicalSheet + TechnicalSheetItems
- Debita créditos de IA

### Output Schema do GPT-4o

```json
{
  "sheets": [{
    "name": "Molho de Tomate",
    "yield": "2kg",
    "items": [{
      "description": "Tomate italiano",
      "quantity": 1.5,
      "unit": "KG",
      "matchedIngredientId": "uuid-existente",
      "confidence": 0.95
    }, {
      "description": "Azeite extra virgem",
      "quantity": 50,
      "unit": "ML",
      "matchedIngredientId": null,
      "newIngredient": true
    }]
  }]
}
```

### Prompt do GPT-4o

O prompt do sistema deve:
1. Instruir a extrair TODAS as fichas técnicas do documento
2. Para cada ficha: nome, rendimento, lista de ingredientes (descrição, quantidade, unidade)
3. Unidades normalizadas para: UN, GR, KG, ML, L
4. Receber a lista de ingredientes existentes (id + description + unit) como contexto
5. Tentar casar cada ingrediente extraído com um existente (por similaridade semântica)
6. Retornar `matchedIngredientId` quando encontrar match, `null` quando for novo
7. Incluir `confidence` (0-1) para cada match

### Processamento por tipo de arquivo

- **Foto**: Enviar base64 como image content no GPT-4o vision
- **PDF**: Enviar como base64 (GPT-4o suporta PDF nativo) ou converter páginas em imagens
- **Word (.docx)**: Extrair texto com biblioteca (mammoth/docx) → enviar como texto ao GPT-4o
- **Planilha (.xlsx/.csv)**: Parse com `xlsx` → converter para texto estruturado → enviar ao GPT-4o

## Créditos de IA

Novos service keys no `aiCreditManager.js`:
- `TECHNICAL_SHEET_IMPORT_PARSE`: 5 créditos por arquivo processado
- `TECHNICAL_SHEET_IMPORT_ITEM`: 1 crédito por ficha aplicada

## Frontend — `TechnicalSheetAiImportModal.vue`

Modal com 3 steps (mesmo padrão do `MenuAiImportModal`):

### Step 1 — Método de entrada
- 4 opções: Foto, Planilha, PDF, Documento Word
- Mostra custo estimado em créditos
- Drag-and-drop ou click para upload (múltiplos arquivos)

### Step 2 — Processando
- Spinner com estágio atual ("Analisando documento...", "Identificando ingredientes...", "Fazendo matching...")
- Polling do job a cada 2s

### Step 3 — Revisão e aplicação
- Lista de fichas extraídas em cards/accordion
- Cada ficha mostra: nome (editável), rendimento (editável), tabela de ingredientes
- Tabela de ingredientes por ficha:
  - Coluna "Ingrediente extraído" (texto original)
  - Coluna "Match" — dropdown com:
    - Ingrediente existente matched (pré-selecionado, com badge de confiança)
    - "Criar novo" (checkbox)
    - Busca para selecionar outro ingrediente existente
  - Coluna "Qtd" (editável)
  - Coluna "Unidade" (dropdown: UN, GR, KG, ML, L)
- Botão "Aplicar X fichas selecionadas"

### Entry Point
- Botão "Importar com IA" na tela `TechnicalSheets.vue` (lista de fichas)

## Fluxo de Dados

```
Usuário → Upload arquivo(s) → POST /parse → Job assíncrono
  → GPT-4o (arquivo + lista de ingredientes existentes)
  → Resultado com fichas + matches
  → GET /parse/:jobId (polling)
  → Tela de revisão (editar, confirmar matches, marcar novos)
  → POST /apply
  → Criar ingredientes novos + fichas + items
  → Debitar créditos
```

## Arquivos a criar/modificar

### Backend
- `src/routes/stock/technicalSheetImport.js` — Nova rota de import
- `src/routes/stock/technicalSheets.js` — Adicionar campo yield no CRUD
- `prisma/schema.prisma` — Adicionar yield ao TechnicalSheet
- `src/services/aiCreditManager.js` — Novos service keys
- `src/index.js` — Montar nova rota

### Frontend
- `src/components/TechnicalSheetAiImportModal.vue` — Novo modal de import
- `src/views/stock/TechnicalSheets.vue` — Botão "Importar com IA"
- `src/views/stock/TechnicalSheetEdit.vue` — Mostrar campo yield
