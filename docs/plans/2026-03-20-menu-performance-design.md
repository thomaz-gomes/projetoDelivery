# Design: Desempenho do Cardápio

**Data:** 2026-03-20
**Status:** Aprovado

## Objetivo

Criar relatório de desempenho do cardápio com funil de conversão, métricas de vendas e ranking de itens. Requer instrumentação do cardápio público para tracking de eventos de comportamento do cliente.

## Decisões

- **Tracking real** com instrumentação do PublicMenu.vue (não apenas dados de pedidos)
- **Híbrido**: sessão anônima (sessionId) + associação ao customerId quando logado
- **PostgreSQL direto** (sem Redis/fila) com batching no frontend e agregação diária
- **Retenção**: eventos brutos 90 dias, resumos diários permanentes
- **Localização**: Relatórios → Desempenho do Cardápio (`/reports/menu-performance`)

## Modelo de Dados

### MenuEvent (eventos brutos, 90 dias)

| Campo | Tipo | Descrição |
|-------|------|-----------|
| id | UUID | PK |
| companyId | UUID | FK Company |
| menuId | UUID | FK Menu |
| sessionId | String | ID gerado no browser |
| customerId | UUID? | FK Customer (null se anônimo) |
| eventType | Enum | VISIT, ITEM_VIEW, ADD_TO_CART, CHECKOUT_START, ORDER_COMPLETE |
| productId | UUID? | FK Product (ITEM_VIEW, ADD_TO_CART) |
| metadata | JSON? | Dados extras |
| createdAt | DateTime | Timestamp |

**Índices:** `(companyId, menuId, createdAt)`, `(companyId, menuId, eventType, createdAt)`

### MenuEventDailySummary (agregação permanente)

| Campo | Tipo | Descrição |
|-------|------|-----------|
| id | UUID | PK |
| companyId | UUID | FK Company |
| menuId | UUID | FK Menu |
| date | DateTime | Dia |
| visits | Int | Sessões únicas |
| itemViews | Int | Visualizações de item |
| addToCarts | Int | Adições ao carrinho |
| checkoutStarts | Int | Inícios de checkout |
| orderCompletes | Int | Pedidos concluídos |
| uniqueCustomers | Int | Clientes únicos |
| newCustomers | Int | Novos clientes |
| totalRevenue | Decimal | Receita total |
| avgTicket | Decimal | Ticket médio |

**Índice:** `(companyId, menuId, date)` unique

## Backend

### Endpoints

**Tracking (público, sem auth):**
- `POST /api/public/tracking/events` — batch de eventos `[{eventType, menuId, sessionId, productId?, metadata?}]`

**Relatório (admin, auth):**
- `GET /api/reports/menu-performance` — params: `menuId`, `startDate`, `endDate`
  - Retorna: funil, vendas (total, valor, ticket médio, novos clientes), série temporal com comparação, horários, dias da semana, ranking de itens

### Job de Agregação

- Cron diário ou ao inicializar backend
- Agrega eventos do dia anterior → MenuEventDailySummary
- Remove eventos brutos > 90 dias

## Frontend — Instrumentação (PublicMenu.vue)

### Eventos

| Evento | Trigger |
|--------|---------|
| VISIT | Mount do componente (1x por sessão) |
| ITEM_VIEW | Abrir modal de produto |
| ADD_TO_CART | Adicionar item ao carrinho |
| CHECKOUT_START | Iniciar revisão do pedido |
| ORDER_COMPLETE | Concluir pedido |

### Batching

- Buffer local acumula eventos
- Envio em batch a cada 10 segundos
- Flush no `beforeunload`
- `sessionId` via `crypto.randomUUID()` em `sessionStorage`

## Frontend — Dashboard (MenuPerformanceReport.vue)

### Filtros

- Seletor de cardápio
- Período: Hoje / Últ. 7 dias (default) / Últ. 30 dias / Personalizado (date range)

### Layout (top → bottom)

1. **Funil de conversão** — 5 cards horizontais (Visitas → Visualizações → Carrinho → Revisão → Concluídos) com número absoluto, % conversão entre etapas, barra visual proporcional, variação vs período anterior
2. **Vendas** — 4 KPIs (total vendas, valor total, ticket médio, novos clientes) + gráfico de linha com comparação período anterior
3. **Horários com mais vendas** — barras horizontais por faixa de 2h, toggle semana/fim de semana
4. **Dias com mais vendas** — barras por dia da semana (Seg-Dom)
5. **Ranking de itens** — tabela: posição, produto, qtd vendida, receita, ordenável

### Comparação

- Automática com período anterior equivalente
- Percentual de variação em cada métrica (verde ↑ / vermelho ↓)
