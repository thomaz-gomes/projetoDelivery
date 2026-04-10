# Financial Module Redesign — Design Document

**Data:** 2026-04-10
**Abordagem:** B — Reestruturação do Caixa + Conciliação IA

---

## Diagnóstico dos Problemas Atuais

### Integridade Financeira (graves)

| # | Problema | Impacto |
|---|----------|---------|
| 1 | Caixa é por empresa, não por usuário | Impossível ter caixa de balcão e delivery simultâneos |
| 2 | Pedido não tem vínculo com caixa | Dinheiro entra no financeiro mas ninguém presta contas no fechamento |
| 3 | Cancelamento pós-CONCLUIDO não reverte financeiro | Receita fantasma no DRE, caixa fecha com diferença inexplicável |
| 4 | Pedidos concluídos sem caixa aberto | Valores "invisíveis" — não aparecem em nenhum fechamento |
| 5 | Bridge é non-blocking (try-catch silencioso) | Pedido concluído pode não gerar registro financeiro e ninguém fica sabendo |
| 6 | Sem reconciliação automática | Não existe forma de detectar pedidos órfãos (sem transação financeira) |

### Modelo de Dados

| # | Problema | Impacto |
|---|----------|---------|
| 7 | CashSession sem `ownerId` | Não sabe quem é responsável |
| 8 | CashSession sem operadores vinculados | Não suporta múltiplos operadores por caixa |
| 9 | CashSession sem canais | Não sabe se cobre iFood, balcão, ou ambos |
| 10 | Order sem `cashSessionId` | Vínculo pedido↔caixa é por timestamp, frágil |
| 11 | Sem rastreabilidade por loja (Store) | Relatórios não separam resultados por unidade |

---

## Seção 1: Novo Modelo do CashSession

### Mudanças no Schema

```
CashSession (atual → novo)
─────────────────────────────────
+ ownerId        → userId que abriu (responsável, único que fecha)
+ channels[]     → String[] ex: ["BALCAO","IFOOD","AIQFOME","WHATSAPP"]
+ label          → nome do caixa ex: "Caixa Delivery", "Caixa 1 Balcão"
─ (mantém companyId, openedAt, closedAt, status, etc.)

CashSessionOperator (novo)
─────────────────────────────────
  id
  cashSessionId  → FK CashSession
  userId         → FK User
  addedAt        → DateTime
  addedBy        → quem vinculou

CashSessionStore (novo)
─────────────────────────────────
  id
  cashSessionId  → FK CashSession
  storeId        → FK Store

Order (adicionar)
─────────────────────────────────
+ cashSessionId  → FK CashSession (nullable)
+ outOfSession   → Boolean default false (flag "fora de caixa")
```

### Regras de Negócio

| Regra | Comportamento |
|-------|---------------|
| Múltiplos caixas por empresa | Permitido — cada um com dono e canais diferentes |
| Canais e lojas sem sobreposição | Na abertura, valida que nenhum outro caixa aberto já cobre a mesma combinação loja + canal |
| Pedido → Caixa | Ao concluir pedido, busca caixa aberto que cubra o canal E a loja do pedido. Se não encontrar → `outOfSession = true` |
| Quem fecha | Só o `ownerId` pode fechar |
| Operadores | Qualquer operador vinculado pode criar pedidos, lançar sangrias/reforços naquele caixa |
| Pedidos "fora de caixa" | Dashboard exibe alerta com lista de pedidos órfãos para o admin resolver |
| Defaults na abertura | Lojas e canais vêm pré-selecionados como "Todos" — operador ajusta se necessário |

### Fluxo de Abertura de Caixa

```
Operador clica "Abrir Caixa"
    → Informa: label, valor de abertura, nota (opcional)
    → Lojas: pré-selecionadas "Todas" (editável)
    → Canais: pré-selecionados "Todos" (editável)
    → Sistema valida: algum caixa aberto já tem mesma combinação loja+canal? → erro
    → Cria CashSession com ownerId = req.user.id
    → (Opcional) Vincula operadores adicionais
```

---

## Seção 2: Vínculo Pedido ↔ Caixa e Pedidos "Fora de Caixa"

### Lógica ao concluir pedido (CONCLUIDO)

```
Pedido muda para CONCLUIDO
    ↓
Identifica canal do pedido:
    - customerSource === 'IFOOD'   → canal "IFOOD"
    - customerSource === 'AIQFOME' → canal "AIQFOME"
    - source === 'whatsapp'        → canal "WHATSAPP"
    - senão                        → canal "BALCAO"
    ↓
Identifica loja do pedido:
    - order.storeId
    ↓
Busca CashSession aberto na empresa onde:
    - status = 'OPEN'
    - channels contém o canal do pedido
    - stores (CashSessionStore) contém a loja do pedido
    - (se operador logado é vinculado ao caixa, prioriza esse)
    ↓
Encontrou?
    SIM → order.cashSessionId = session.id
          session.currentBalance += valor (se pagamento imediato)
    NÃO → order.outOfSession = true
          order.cashSessionId = null
          Emite alerta via Socket.IO para admins
```

### Resolução de Pedidos "Fora de Caixa"

O admin vê no dashboard financeiro uma lista de pedidos com `outOfSession = true`:
- **Vincular a caixa**: atribui a um caixa aberto ou já fechado (reajustando expectedValues)
- **Ignorar**: marca como resolvido sem vincular (ex: marketplace que repassa depois)

### Impacto no Fechamento

O `calculateExpectedValues` muda de query por timestamp para query por `cashSessionId`:

```
ANTES: WHERE updatedAt BETWEEN openedAt AND closedAt
DEPOIS: WHERE cashSessionId = session.id AND status = 'CONCLUIDO'
```

---

## Seção 3: Estorno Automático no Cancelamento Pós-CONCLUIDO

### Fluxo de Estorno

```
Pedido CONCLUIDO → CANCELADO
    ↓
1. Busca FinancialTransaction original (sourceType='ORDER', sourceId=order.id)
    ↓
2. Marca original como status = 'REVERSED'
    ↓
3. Cria transação de estorno:
    - type: PAYABLE
    - status: PAID
    - grossAmount: mesmo valor da original
    - description: "Estorno - Venda #123 (cancelamento)"
    - sourceType: 'ORDER_REVERSAL'
    - sourceId: order.id
    - costCenter: DEDUCTIONS (2.04 - Cancelamentos)
    - reversedTransactionId: FK → transação original
    ↓
4. Se pedido estava vinculado a CashSession:
    - session.currentBalance -= valor (se pagamento era imediato)
    - Cria CashFlowEntry type=OUTFLOW "Estorno pedido #123"
    ↓
5. Estorna dependentes:
    - Rider: cria RECEIVABLE revertendo o PAYABLE do entregador
    - Afiliado: cria RECEIVABLE revertendo comissão
    - Cashback: debita do wallet do cliente
    ↓
6. Emite Socket.IO para admin
```

### Campos Novos

```
FinancialTransaction (adicionar)
─────────────────────────────────
+ reversedTransactionId  → FK self-reference (nullable)
+ sourceType enum        → adicionar 'ORDER_REVERSAL'
+ status enum            → adicionar 'REVERSED'

+ storeId                → FK Store (nullable) — herdado do pedido
```

### No DRE

O estorno aparece em Deduções (grupo 2) com centro de custo "2.04 - Cancelamentos".
A transação original marcada como REVERSED é excluída do DRE (filtro status IN ['PAID','PARTIALLY']).

---

## Seção 4: Auditoria do Bridge e Reconciliação

### Tabela de Auditoria

```
FinancialBridgeLog (novo)
─────────────────────────────────
  id
  companyId
  sourceType     → 'ORDER' | 'CASH_SESSION' | 'ORDER_REVERSAL'
  sourceId       → id do pedido ou sessão
  status         → 'SUCCESS' | 'FAILED' | 'RETRY_SUCCESS'
  errorMessage   → mensagem do erro (se falhou)
  retryCount     → quantas vezes tentou
  createdAt
  resolvedAt     → quando foi corrigido
  resolvedBy     → userId de quem resolveu (se manual)
```

### Fluxo com Auditoria

```
Bridge tenta criar FinancialTransaction
    ↓
Sucesso? → FinancialBridgeLog(status='SUCCESS')
Falhou?  → FinancialBridgeLog(status='FAILED', errorMessage)
           Emite Socket.IO alerta para admins
```

### Job de Reconciliação Periódico (a cada 1h ou sob demanda)

```
1. Busca pedidos CONCLUIDO sem FinancialTransaction correspondente
   (updatedAt < NOW() - 5min para evitar race condition)
2. Tenta recriar via bridge
3. Busca FinancialBridgeLog com status='FAILED' e retryCount < 3
   - Retenta
4. Resultado disponível no dashboard
```

### Dashboard de Saúde Financeira

| Indicador | Descrição |
|-----------|-----------|
| Pedidos sem registro financeiro | Orphan count |
| Pedidos fora de caixa | outOfSession count |
| Falhas de bridge pendentes | FAILED with retryCount < 3 |
| Última reconciliação | Timestamp |

---

## Seção 5: Conciliação Bancária com IA

### Fluxo de Conciliação

```
Admin importa arquivo OFX
    ↓
Parser extrai lançamentos: { date, description, amount, fitId }
    ↓
Etapa 1 — Match Exato (sem IA):
  - Busca FinancialTransaction onde amount == lançamento.amount (±3 dias úteis)
  - Match único com confiança → concilia automaticamente
    ↓
Etapa 2 — Match por IA (quando ambíguo):
  - Monta contexto para OpenAI:
    - Descrição do extrato bancário
    - Lista de candidatas não conciliadas
  - Prompt estruturado pedindo: matchId, confidence (0-100), reasoning
    ↓
Etapa 3 — Decisão:
  - confidence >= 85 → concilia automaticamente (AI_AUTO)
  - confidence 50-84 → sugere ao admin para revisão (AI_SUGGESTED)
  - confidence < 50 ou NONE → não conciliado (MANUAL)
```

### Campos Novos

```
OfxReconciliationItem (adicionar)
─────────────────────────────────
+ matchMethod    → 'EXACT' | 'AI_AUTO' | 'AI_SUGGESTED' | 'MANUAL'
+ aiConfidence   → Float (0-100, nullable)
+ aiReasoning    → String (explicação da IA, nullable)
```

### Custo de IA

- Usa OPENAI_API_KEY já configurada
- Batch: até 10 lançamentos ambíguos por chamada
- Estimativa: ~R$0,05 por importação típica (50 lançamentos)

---

## Seção 6: Rastreabilidade por Loja (Store)

### Campos por Modelo

| Modelo | Campo | Origem |
|--------|-------|--------|
| CashSession | CashSessionStore[] (N:N) | Selecionado na abertura (default: todas) |
| FinancialTransaction | storeId (FK, nullable) | Herdado do pedido |
| CashFlowEntry | storeId (FK, nullable) | Herdado da transação |

### Relatórios

- DRE, Fluxo de Caixa e Summary ganham filtro opcional por `storeId`
- DRE comparativo lado-a-lado por loja disponível

---

## Resumo de Mudanças

### Schema Prisma

| Modelo | Alteração |
|--------|-----------|
| CashSession | + ownerId, + channels[], + label |
| CashSessionOperator | Novo (N:N CashSession ↔ User) |
| CashSessionStore | Novo (N:N CashSession ↔ Store) |
| Order | + cashSessionId (nullable FK), + outOfSession (Boolean) |
| FinancialTransaction | + reversedTransactionId (self FK), + storeId, + status REVERSED, + sourceType ORDER_REVERSAL |
| FinancialBridgeLog | Novo (auditoria) |
| OfxReconciliationItem | + matchMethod, + aiConfidence, + aiReasoning |
| CostCenter seed | + 2.04 Cancelamentos |

### Backend

| Área | Mudança |
|------|---------|
| POST /cash/open | channels[], label, stores[], ownerId, validação sobreposição |
| POST /cash/operators | Novo — vincular/desvincular operadores |
| POST /cash/close/finalize | Valida ownerId |
| PATCH /orders/:id/status → CONCLUIDO | Busca caixa por canal+loja, vincula cashSessionId |
| PATCH /orders/:id/status → CANCELADO | Chama reverseFinancialEntriesForOrder() |
| orderFinancialBridge | Loga em FinancialBridgeLog, emite Socket.IO em falha |
| calculateExpectedValues | Query por cashSessionId |
| Novo: reversal bridge | Estorno completo (receita + rider + afiliado + cashback) |
| Novo: reconciliation job | Detecta órfãos, retenta bridges falhos |
| OFX reconciliation | Match exato + OpenAI para ambíguos |

### Frontend

| Área | Mudança |
|------|---------|
| CashControl.vue | Abertura com channels[], stores[], label, operadores |
| CashClosingWizard.vue | expectedValues por cashSessionId |
| FinancialDashboard.vue | Cards de saúde financeira |
| FinancialOFX.vue | Fluxo completo com IA |
| Relatórios | Filtro por storeId, DRE comparativo |
| Alertas Socket.IO | Pedido fora de caixa, falha bridge, estorno |

### Migração

- CashSession existentes: ownerId = openedBy
- Order existentes: cashSessionId = null, outOfSession = false
- FinancialTransaction existentes: reversedTransactionId = null, storeId = null
