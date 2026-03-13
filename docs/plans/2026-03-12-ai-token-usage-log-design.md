# AI Token Usage Log & Dashboard — Design

**Date**: 2026-03-12
**Status**: Approved

## Goal

Create a SaaS Admin page (`/saas/ai-usage`) that tracks real API token consumption per activity/user, shows cost vs revenue with profit/loss indicators, and provides a dashboard with margin simulation.

## Key Decisions

- **Real token tracking** (not estimates) — capture `usage` from OpenAI/Gemini responses
- **Single credit price** — one BRL price per credit (already exists in settings), services vary by credit quantity
- **Provider pricing configurable** — input/output price per million tokens, editable in SaaS Settings
- **USD→BRL exchange rate** — manual field in SaaS Settings (admin updates as needed)

## Database Changes

### New model: `AiTokenUsage`

```prisma
model AiTokenUsage {
  id           String   @id @default(uuid())
  companyId    String
  company      Company  @relation(fields: [companyId], references: [id])
  userId       String?
  user         User?    @relation(fields: [userId], references: [id])
  serviceKey   String
  provider     String   // "openai" | "gemini"
  model        String   // "gpt-4o-mini", "gemini-2.5-flash", etc.
  inputTokens  Int
  outputTokens Int
  totalTokens  Int
  creditsSpent Int
  metadata     Json?
  createdAt    DateTime @default(now())

  @@index([companyId, createdAt])
  @@index([createdAt])
  @@index([serviceKey])
}
```

### New model: `AiProviderPricing`

```prisma
model AiProviderPricing {
  id                   String  @id @default(uuid())
  provider             String  // "openai" | "gemini"
  model                String  // "gpt-4o-mini", "gemini-2.5-flash"
  inputPricePerMillion  Decimal // USD per 1M input tokens
  outputPricePerMillion Decimal // USD per 1M output tokens
  isActive             Boolean @default(true)

  @@unique([provider, model])
}
```

### New field in SaasSettings (JSON)

```
usdToBrl: Decimal  // Manual exchange rate (e.g., 5.80)
```

Already exists: `creditPriceBrl` (price per credit in BRL).

## Backend Changes

### 1. Token capture in `aiProvider.js`

After each OpenAI/Gemini API call, extract `usage` from response and return it alongside the result:

```js
// OpenAI
const { prompt_tokens, completion_tokens, total_tokens } = response.usage

// Gemini
const { promptTokenCount, candidatesTokenCount, totalTokenCount } = response.usageMetadata
```

### 2. Token logging in `aiCreditManager.js`

Extend `debitCredits()` (or add companion function `logTokenUsage()`) to persist `AiTokenUsage` in the same transaction as the credit debit.

### 3. New routes in `saas.js`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/saas/ai-usage` | Paginated token usage log with filters |
| GET | `/saas/ai-usage/summary` | Aggregated stats for dashboard (by period) |
| GET | `/saas/ai-usage/by-service` | Cost breakdown by service |
| GET | `/saas/ai-provider-pricing` | List provider pricing configs |
| PUT | `/saas/ai-provider-pricing/:id` | Update pricing for a provider/model |
| POST | `/saas/ai-provider-pricing` | Add new provider/model pricing |

### 4. Cost calculation (server-side)

```
costUsd = (inputTokens / 1_000_000 * inputPricePerMillion) + (outputTokens / 1_000_000 * outputPricePerMillion)
costBrl = costUsd * usdToBrl
revenueBrl = creditsSpent * creditPriceBrl
profitBrl = revenueBrl - costBrl
```

## Frontend: `/saas/ai-usage` (SaasAiUsage.vue)

### Tab 1: Log

**Filters**: date range, company, service, provider
**Table columns**:

| Data | Empresa | Usuário | Serviço | Provider/Model | Tokens (in/out) | Custo (BRL) | Créditos | Receita (BRL) | Lucro |
|------|---------|---------|---------|----------------|-----------------|-------------|----------|---------------|-------|

- Lucro column: green badge if positive, red if negative
- Pagination (25 per page)
- Summary row at bottom with totals

### Tab 2: Dashboard

**Summary cards**:
- Total custo (BRL)
- Total receita (BRL)
- Margem %
- Lucro absoluto (BRL)

**Charts** (chart.js):
- Bar chart: Custo vs Receita by month (last 6 months)
- Line chart: Profit trend over time
- Pie/doughnut chart: Cost distribution by service

**Margin simulator**:
- Input field: desired margin % (default: current real margin)
- On change, recalculates:
  - New suggested credit price (BRL)
  - Projected profit with new margin applied to current volume
  - Table showing each service: credits consumed, current price, new price, projected revenue

## UI Pattern

Follows existing SaaS admin pattern:
- Bootstrap 5 layout, `bi-*` icons
- `<TextInput>` / `<SelectInput>` wrappers
- Chart.js for visualizations (already in project)
- SweetAlert2 for confirmations
- Pinia store not needed (data is admin-only, fetch on mount)
