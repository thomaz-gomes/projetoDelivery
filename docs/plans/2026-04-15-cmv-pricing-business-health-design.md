# CMV correto, Sugestão de Preço e Saúde Global do Negócio — Design

Date: 2026-04-15
Scope: Backend (financial reports, stock services, products, stores) + Frontend (ProductForm, StoreSettings, Financial module)
Approach: Incremental em 3 fases (cada fase entrega valor isolado e é reversível).

---

## Diagnóstico

A apuração de CMV de hoje tem 3 falhas que invalidam o número exibido no DRE:

1. **`unitCost: null` no movimento OUT** ([`stockFromOrder.js:193`](../../delivery-saas-backend/src/services/stockFromOrder.js#L193)) — a baixa por venda grava só a quantidade, sem snapshot do custo. Sem snapshot, CMV histórico fica refém do `avgCost` atual.
2. **`calculateCMV` ignora os movimentos `OUT`** ([`reports.js:196-244`](../../delivery-saas-backend/src/routes/financial/reports.js#L196-L244)) — soma apenas movimentos `IN` (compras) do período. O sistema chama isso de CMV, mas é **Compras**. Resultado: CMV inflado em meses de reposição de estoque, deflacionado em meses de queima.
3. **`stockFromOrder` é best-effort silencioso e sem reversão em cancelamento** — produtos sem ficha técnica não geram CMV; pedidos cancelados não devolvem estoque ao histórico.

A baixa de estoque por venda em si **funciona** ([`stockFromOrder.js:3-201`](../../delivery-saas-backend/src/services/stockFromOrder.js#L3-L201)) e cobre produto + opções + linkedProduct + conversão de unidade.

E a Sugestão de Preço **não existe**: o ProductForm exibe apenas o `cmvPercent` retroativo (`sheetCost / price`), sem markup, margem-alvo, impostos sobre venda ou taxas.

---

## Fase 1 — Fundação: CMV correto

### 1.1 Modelo de dados

**`StockMovementItem.unitCost`** — campo já existe; passa a ser preenchido em movimentos `OUT` com o `Ingredient.avgCost` vigente no instante da baixa (snapshot histórico).

**`StockMovement` — dois campos novos:**
```prisma
reversedAt   DateTime?   // marca movimento revertido
reversedBy   String?     // userId que cancelou; null se automático
```

Reversão de venda = criar **um novo movimento `IN`** com `note: "Reverse:Order:<id>"` espelhando os items do OUT original, e marcar o OUT original com `reversedAt`. Preserva auditoria, evita delete físico, permite filtro `WHERE reversedAt IS NULL` em todas as queries de CMV.

### 1.2 Lógica — `stockFromOrder.js`

- Em [`stockFromOrder.js:190-195`](../../delivery-saas-backend/src/services/stockFromOrder.js#L190-L195): ler `Ingredient.avgCost` dentro da transação e gravar em `StockMovementItem.unitCost`.
- Nova função `reverseStockMovementForOrder(prismaInstance, orderId, userId?)` no mesmo módulo: encontra OUT de `note = "Order:<id>"` ainda não revertido, cria IN inverso, marca OUT com `reversedAt` + `reversedBy`.
- Disparo da reversão: gancho onde o status do `Order` muda para `CANCELLED` (a identificar — provavelmente em [`orders.js`](../../delivery-saas-backend/src/routes/orders.js) e em ifoodWebhookProcessor para cancelamentos via marketplace).

### 1.3 `calculateCMV` reescrito

```
CMV (consumo) = Σ (item.quantity × item.unitCost)
WHERE movement.type = 'OUT'
  AND ingredient.composesCmv = true
  AND movement.companyId = X
  AND movement.createdAt BETWEEN from AND to
  AND movement.reversedAt IS NULL
  AND (storeId IS NULL OR movement.storeId = storeId)
```

A função `calculateCMV` antiga (baseada em IN) é renomeada `calculatePurchases` e fica disponível para o DRE expor "(+) Compras do período" como linha auxiliar opcional.

### 1.4 Endpoints

- `GET /financial/reports/cmv` — mantém path; payload passa a refletir consumo. Inclui breakdown por ingrediente.
- `GET /financial/reports/cmv-by-product?dateFrom&dateTo&storeId` — **novo**. Agrega OUT por `Order → OrderItem → productId`. Devolve `{ productId, productName, qtySold, cmvTotal, revenueTotal, marginAbs, marginPct }`. Base para top/bottom da Fase 3.

### 1.5 Backfill

**Não retroagir.** Pedidos antigos têm `unitCost: null` e ficam fora do CMV de consumo. UI do DRE / Saúde Global exibe banner "Dados de CMV disponíveis a partir de DD/MM/AAAA" (data do deploy).

### 1.6 Out of scope da Fase 1

- FIFO/LIFO ou lotes — segue `avgCost`.
- Custo de embalagem por produto (entra na Fase 2).
- Impostos recuperáveis (ICMS/PIS/COFINS) na entrada — fica para fase futura; `avgCost` segue valor cheio de NF.
- Conversão de moeda.

---

## Fase 2 — Sugestão de Preço

### 2.1 Modelo de dados

**Nova tabela `StorePricingDefaults`** (1:1 com `Store`):

```prisma
model StorePricingDefaults {
  storeId               String   @id
  store                 Store    @relation(fields: [storeId], references: [id])

  // Impostos sobre venda (% sobre preço de venda)
  salesTaxPercent       Decimal  @default(0)
  salesTaxLabel         String?

  // Taxas operacionais médias (% sobre preço de venda)
  marketplaceFeePercent Decimal  @default(0)
  cardFeePercent        Decimal  @default(0)

  // Custos fixos por item (R$ absoluto)
  defaultPackagingCost  Decimal  @default(0)

  // Margem-alvo padrão (% líquida sobre preço)
  targetMarginPercent   Decimal  @default(30)

  // Faixas de saúde de CMV
  cmvHealthyMin         Decimal  @default(25)
  cmvHealthyMax         Decimal  @default(35)
  cmvCriticalAbove      Decimal  @default(40)

  updatedAt             DateTime @updatedAt
}
```

**`Product` — dois campos opcionais (override por produto):**
```prisma
packagingCost         Decimal?
targetMarginPercent   Decimal?
```

### 2.2 Fórmula

```
C  = custo da ficha técnica
E  = product.packagingCost ?? store.defaultPackagingCost
T% = salesTaxPercent + marketplaceFeePercent + cardFeePercent
M% = product.targetMarginPercent ?? store.targetMarginPercent

Preço sugerido = (C + E) / (1 - (T% + M%) / 100)
```

CMV% exibido = `C / preçoAtual × 100` (medido sobre preço atual, não sugerido).

Status do CMV: `healthy` se entre `cmvHealthyMin` e `cmvHealthyMax`, `warning` entre `cmvHealthyMax` e `cmvCriticalAbove`, `critical` acima de `cmvCriticalAbove`.

### 2.3 Endpoints

- `GET /stores/:id/pricing-defaults` — lê (cria com defaults se não existir).
- `PUT /stores/:id/pricing-defaults` — atualiza.
- `GET /products/:id/pricing-analysis` — devolve `{ currentPrice, sheetCost, packagingCost, taxBreakdown, targetMarginPercent, suggestedPrice, delta, cmvPercent, cmvStatus, actualMarginPercent }`.

### 2.4 UI — Nova aba "Precificação" no `ProductForm`

Adicionar terceira tab (ao lado de "Geral" e "MARKETPLACE"). Estrutura:

- **Composição de custo**: ficha técnica + embalagem (com campo de override) → custo direto.
- **Deduções sobre venda**: impostos + marketplace + cartão (lidos da loja, somente leitura aqui — link "Editar defaults da loja").
- **Margem-alvo**: slider/input com override por produto.
- **Resultado**: preço sugerido, comparativo com preço atual (delta colorido), CMV% atual com semáforo, margem real, botão **"Aplicar preço sugerido"** (preenche `form.price`, não salva).

Componente Vue reativo via `computed`. Layout segue [`frontend-deliverywl`](#) (Bootstrap 5, `<TextInput>`/`<SelectInput>`/`<CurrencyInput>`).

### 2.5 UI — Aba dentro de StoreSettings existente

Aba **"Precificação"** dentro de Configurações da Loja. Edita `StorePricingDefaults` via `PUT`.

### 2.6 Out of scope da Fase 2

- Markup por categoria.
- Modos alternativos (markup multiplicador).
- Sugestão de preço para opções/adicionais isolados.
- Aplicação em massa (entra na Fase 3 como ação derivada do alerta).

---

## Fase 3 — Painel Saúde Global do Negócio

### 3.1 Endpoint único `GET /financial/reports/business-health`

Query: `?period=current_month|last_30d|last_month|current_quarter|last_quarter|current_year&storeId=...`

Resposta consolidada (1 request → 1 view):

```json
{
  "period": { "from": "...", "to": "...", "label": "Mês atual" },
  "kpis": {
    "revenue":         { "value": 45200, "prev": 38100, "deltaPct": 18.6, "trend": "up" },
    "cmv":             { "value": 14800, "pct": 32.7, "status": "healthy", "band": [25,35] },
    "grossMargin":     { "value": 30400, "pct": 67.3, "status": "healthy" },
    "operatingProfit": { "value": 8200,  "pct": 18.1, "status": "warning" },
    "netProfit":       { "value": 5100,  "pct": 11.3, "status": "warning" },
    "ticketAvg":       { "value": 47.30, "prev": 44.10, "deltaPct": 7.3 },
    "ordersCount":     { "value": 956,   "prev": 864 }
  },
  "breakEven": {
    "fixedCosts": 18500,
    "contributionMarginPct": 46.5,
    "breakEvenRevenue": 39785,
    "currentRevenue": 45200,
    "safetyMarginPct": 12.0
  },
  "topProducts":    [ /* 5 melhores por margem absoluta */ ],
  "bottomProducts": [ /* 5 piores por margem % (alerta de ralo) */ ],
  "alerts": [
    { "level": "danger",  "code": "CMV_CRITICAL_PRODUCT", "message": "...", "actionUrl": "..." },
    { "level": "warning", "code": "OPEX_GROWTH",          "message": "..." },
    { "level": "info",    "code": "BREAK_EVEN_OK",        "message": "..." }
  ]
}
```

### 3.2 Cálculos

- `revenue / cmv / margins`: reusa `/financial/reports/dre` da Fase 1.
- `ticketAvg`: `revenue / ordersCount` (orders DELIVERED no período).
- **Break-even (automático):**
  - `fixedCosts` = soma de `FinancialTransaction` `PAYABLE` em centros de custo do grupo `OPEX` no período.
  - `contributionMarginPct` = `(revenue - cmv - variableCosts) / revenue × 100`, onde `variableCosts = revenue × (salesTaxPercent + marketplaceFeePercent + cardFeePercent) / 100`.
  - `breakEvenRevenue = fixedCosts / (contributionMarginPct/100)`.
  - `safetyMarginPct = (revenue - breakEvenRevenue) / revenue × 100`.
- `topProducts / bottomProducts`: usa `/financial/reports/cmv-by-product` da Fase 1, ordenado por `marginAbs` desc / `marginPct` asc.
- **Alertas (regras fixas no MVP):**
  - `CMV_CRITICAL_PRODUCT` (danger): há produtos com `cmvPct > store.cmvCriticalAbove`.
  - `CMV_GLOBAL_CRITICAL` (danger): `kpis.cmv.pct > store.cmvCriticalAbove`.
  - `OPEX_GROWTH` (warning): OPEX cresceu >20% vs período anterior equivalente.
  - `BREAK_EVEN_BELOW` (danger): `safetyMarginPct < 0`.
  - `BREAK_EVEN_OK` (info): `safetyMarginPct >= 10`.
  - `MARGIN_LOSS` (warning): `kpis.netProfit.pct < 5`.

### 3.3 UI — `BusinessHealth.vue`

Layout vertical mobile-first com 4 zonas:
1. Header com seletor de período (Mês atual | Últimos 30d | Mês anterior | Trimestre atual | Trimestre anterior | Ano atual) + seletor de loja.
2. Banner de alertas (renderiza só os ativos, ordenados por severidade).
3. Grid de KPIs (2×4 desktop, 1 col mobile) — `KpiCard` com valor, delta vs período anterior, semáforo opcional.
4. Card de Ponto de Equilíbrio (barra de progresso `BreakEvenBar`, valores de fixedCosts/contributionMargin/breakEven/safety).
5. Duas colunas: Top 5 por margem R$ | Pior 5 por margem %. Pior 5 traz botão "Sugerir reajuste em massa" (link para listagem filtrada de produtos com pré-aplicação de preço sugerido — implementação fica fora do MVP; só link é entregue).

Componentes a criar/aproveitar:
- `KpiCard.vue` (novo, simples).
- `BreakEvenBar.vue` (novo, simples).
- `AlertBanner.vue` — usar componente existente similar se houver, senão simples.

### 3.4 Navegação

A view **Saúde do Negócio** vira a tela default do módulo Financeiro. Item adicionado no menu lateral acima de "DRE" e "Dashboard". `FinancialDashboard.vue` e `FinancialDRE.vue` continuam acessíveis nas suas rotas.

### 3.5 Cache

Cache em memória (LRU 60s) por `companyId+storeId+period` no endpoint. Cálculos pesados (especialmente `bottomProducts`) não precisam ser tempo real — meio minuto de defasagem é aceitável.

### 3.6 Out of scope da Fase 3

- Comparativos multi-loja side-by-side ranqueados.
- Exportar PDF / e-mail diário automático.
- Drill-down inline (clicar no KPI abre modal com gráfico).
- Sparklines de tendência.
- Customização de regras de alerta pelo usuário.
- Ação de "Aplicar preço sugerido em massa" (só link — implementação posterior).

---

## Decisões registradas

| # | Decisão | Justificativa |
|---|---------|---------------|
| 1 | Backfill de `unitCost` em OUTs antigos: **não fazer** | Honestidade — `avgCost` atual não representa o passado. UI mostra banner com data de início. |
| 2 | Reversão de cancelamento: **novo IN + flag `reversedAt`** | Preserva auditoria; evita delete físico. |
| 3 | Override por produto de `packagingCost` e `targetMarginPercent` | Embalagens caras / produtos premium merecem tratamento próprio. |
| 4 | Tela de defaults de precificação: **aba dentro de StoreSettings** | Coerente com modelo de configuração existente. |
| 5 | Períodos do painel: mês atual, últimos 30d, mês anterior, trimestre atual, trimestre anterior, ano atual | Cobre análise tática (mês) e estratégica (trimestre/ano). |
| 6 | Break-even: **automático** via OPEX + StorePricingDefaults | Sem entrada manual; aproveita dados que o usuário já mantém no Financeiro. |
| 7 | Saúde do Negócio: **default do módulo Financeiro** | É a visão de 5 segundos que substitui o Dashboard atual como entrada. |

---

## Ordem de implementação

1. **Fase 1** — fundação (snapshot + reversão + endpoints corrigidos).
2. **Fase 2** — precificação (defaults + ProductForm + StoreSettings).
3. **Fase 3** — painel (depende de endpoints da Fase 1 e parâmetros da Fase 2).

Cada fase é PR independente, testável e reversível.
