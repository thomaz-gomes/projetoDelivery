# Módulo Financeiro - Delivery SaaS

## Visão Geral

O módulo financeiro é um módulo **plugável** (ativado/desativado via `ModuleKey.FINANCIAL` no sistema SaaS) que gerencia o fluxo financeiro completo de restaurantes: Contas a Pagar, Contas a Receber, Fluxo de Caixa, DRE e Conciliação Bancária via OFX.

## Arquitetura de Integração

O módulo financeiro **não altera** nenhum módulo legado. Ele se conecta aos módulos existentes via um padrão **Event Bridge** (chamadas no service layer):

```
┌──────────────┐     ┌───────────────────────┐     ┌────────────────────┐
│  Orders.js   │────▶│ orderFinancialBridge   │────▶│ FinancialTransaction│
│  (CONCLUIDO) │     │ .createForOrder()      │     │ (RECEIVABLE)       │
└──────────────┘     └───────────────────────┘     └────────────────────┘

┌──────────────┐     ┌───────────────────────┐     ┌────────────────────┐
│  Riders.js   │────▶│ orderFinancialBridge   │────▶│ FinancialTransaction│
│  (pagamento) │     │ .createForRider()      │     │ (PAYABLE)          │
└──────────────┘     └───────────────────────┘     └────────────────────┘

┌──────────────┐     ┌───────────────────────┐     ┌────────────────────┐
│ Affiliates   │────▶│ orderFinancialBridge   │────▶│ FinancialTransaction│
│ (pagamento)  │     │ .createForAffiliate()  │     │ (PAYABLE)          │
└──────────────┘     └───────────────────────┘     └────────────────────┘

┌──────────────┐     ┌───────────────────────┐     ┌────────────────────┐
│ StockMovement│────▶│ (futuro bridge CMV)    │────▶│ FinancialTransaction│
│ (IN = compra)│     │                        │     │ (PAYABLE / COGS)   │
└──────────────┘     └───────────────────────┘     └────────────────────┘
```

### Como integrar sem quebrar módulos existentes

1. **Não modifique as tabelas legadas**: O financeiro usa `sourceType` + `sourceId` para rastrear a origem (polimorfismo por convenção).
2. **Adicione chamadas opcionais**: No handler de `CONCLUIDO` em `orders.js`, adicione uma chamada `try/catch` ao bridge. Se o módulo financeiro não estiver ativo, a chamada simplesmente não executa.
3. **Idempotência**: Todas as funções do bridge verificam se já existe transação para o `sourceId` antes de criar.

```javascript
// Exemplo de integração em orders.js (handler de status CONCLUIDO):
try {
  const { createFinancialEntriesForOrder } = await import('../services/financial/orderFinancialBridge.js');
  await createFinancialEntriesForOrder(order);
} catch (e) {
  // Não bloqueia o fluxo do pedido
  console.warn('Financial bridge skipped:', e?.message);
}
```

## Estrutura de Pastas

```
src/
├── routes/financial/
│   ├── index.js          # Router principal (monta sub-rotas)
│   ├── accounts.js       # CRUD contas financeiras (caixas, bancos, marketplaces)
│   ├── costCenters.js    # CRUD centros de custo + seed DRE padrão
│   ├── transactions.js   # CRUD transações (títulos a pagar/receber) + pagamento
│   ├── cashFlow.js       # Fluxo de caixa (realizado + previsto)
│   ├── gateways.js       # Configuração de taxas por operadora
│   ├── ofx.js            # Importação e conciliação OFX
│   ├── reports.js        # DRE, CMV, resumo financeiro
│   └── README.md         # Este arquivo
│
├── services/financial/
│   ├── feeCalculator.js       # Cálculo de taxas (%, fixa, mista) + D+N
│   ├── ofxProcessor.js        # Parser OFX + algoritmo de match automático
│   └── orderFinancialBridge.js # Bridge pedidos/riders/afiliados → financeiro
```

## Esquema de Banco de Dados (ERD)

```
┌─────────────────────┐       ┌──────────────────────┐
│  FinancialAccount   │       │     CostCenter       │
│─────────────────────│       │──────────────────────│
│ id (UUID, PK)       │       │ id (UUID, PK)        │
│ companyId (FK)      │       │ companyId (FK)        │
│ name                │       │ code (ex: "3.01")     │
│ type (enum)         │       │ name                  │
│ bankCode, agency    │       │ parentId (self-ref)   │
│ currentBalance      │       │ dreGroup              │
│ isDefault           │       │ isActive              │
└────────┬────────────┘       └──────────┬───────────┘
         │                               │
         │ 1:N                           │ 1:N
         ▼                               ▼
┌──────────────────────────────────────────────────────┐
│              FinancialTransaction                    │
│──────────────────────────────────────────────────────│
│ id (UUID, PK)                                        │
│ companyId (FK)                                       │
│ type (PAYABLE | RECEIVABLE)                          │
│ status (PENDING | CONFIRMED | PAID | OVERDUE | ...)  │
│ description                                          │
│ accountId (FK → FinancialAccount)                    │
│ costCenterId (FK → CostCenter)                       │
│ gatewayConfigId (FK → PaymentGatewayConfig)          │
│ grossAmount, feeAmount, netAmount, paidAmount        │
│ issueDate, dueDate, paidAt, expectedDate             │
│ sourceType ("ORDER"|"RIDER"|"AFFILIATE"|"MANUAL")    │
│ sourceId (polimórfico → qualquer tabela)             │
│ recurrence, installmentNumber, totalInstallments     │
└───────────────────────┬──────────────────────────────┘
                        │
                        │ 1:N
                        ▼
┌──────────────────────────────────────────────────────┐
│                  CashFlowEntry                       │
│──────────────────────────────────────────────────────│
│ id (UUID, PK)                                        │
│ companyId (FK)                                       │
│ accountId (FK → FinancialAccount)                    │
│ transactionId (FK → FinancialTransaction, nullable)  │
│ type (INFLOW | OUTFLOW)                              │
│ amount                                               │
│ balanceAfter (snapshot do saldo após movimentação)    │
│ entryDate                                            │
│ reconciled (bool) ←── conciliação OFX                │
└──────────────────────────────────────────────────────┘

┌─────────────────────────┐     ┌──────────────────────────┐
│  PaymentGatewayConfig   │     │       OfxImport          │
│─────────────────────────│     │──────────────────────────│
│ id (UUID, PK)           │     │ id (UUID, PK)            │
│ companyId (FK)          │     │ companyId (FK)            │
│ provider ("IFOOD", ...) │     │ accountId (FK)            │
│ feeType (%, FIXED, MIX) │     │ fileName                  │
│ feePercent, feeFixed    │     │ periodStart, periodEnd    │
│ settlementDays (D+N)    │     │ totalItems, matchedItems  │
│ anticipationFeePercent  │     │ status                    │
└─────────────────────────┘     └────────────┬─────────────┘
                                             │ 1:N
                                             ▼
                                ┌──────────────────────────┐
                                │  OfxReconciliationItem   │
                                │──────────────────────────│
                                │ id (UUID, PK)            │
                                │ importId (FK)            │
                                │ fitId (ID do banco)      │
                                │ ofxType, amount, ofxDate │
                                │ memo, checkNum, refNum   │
                                │ matchStatus (enum)       │
                                │ transactionId (FK, match)│
                                │ cashFlowEntryId (FK)     │
                                │ matchConfidence (0-1.0)  │
                                └──────────────────────────┘
```

## Endpoints da API

### Contas Financeiras (`/financial/accounts`)
| Método | Path | Descrição |
|--------|------|-----------|
| GET | `/financial/accounts` | Listar contas (filtro: type, isActive) |
| GET | `/financial/accounts/:id` | Detalhe de uma conta |
| POST | `/financial/accounts` | Criar conta |
| PUT | `/financial/accounts/:id` | Atualizar conta |
| DELETE | `/financial/accounts/:id` | Desativar conta (soft delete) |

### Centros de Custo (`/financial/cost-centers`)
| Método | Path | Descrição |
|--------|------|-----------|
| GET | `/financial/cost-centers` | Listar (árvore ou flat) |
| POST | `/financial/cost-centers` | Criar centro de custo |
| PUT | `/financial/cost-centers/:id` | Atualizar |
| DELETE | `/financial/cost-centers/:id` | Desativar |
| POST | `/financial/cost-centers/seed-default` | Gerar estrutura DRE padrão |

### Transações (`/financial/transactions`)
| Método | Path | Descrição |
|--------|------|-----------|
| GET | `/financial/transactions` | Listar com filtros e paginação |
| GET | `/financial/transactions/:id` | Detalhe com movimentações |
| POST | `/financial/transactions` | Criar título (a pagar/receber) |
| PUT | `/financial/transactions/:id` | Atualizar título |
| POST | `/financial/transactions/:id/pay` | Registrar pagamento/recebimento |
| POST | `/financial/transactions/:id/cancel` | Cancelar título |
| DELETE | `/financial/transactions/:id` | Excluir (somente PENDING) |

### Fluxo de Caixa (`/financial/cash-flow`)
| Método | Path | Descrição |
|--------|------|-----------|
| GET | `/financial/cash-flow` | Fluxo realizado + previsto (daily/weekly/monthly) |
| POST | `/financial/cash-flow/manual` | Lançamento manual |

### Gateways/Taxas (`/financial/gateways`)
| Método | Path | Descrição |
|--------|------|-----------|
| GET | `/financial/gateways` | Listar configurações de taxas |
| POST | `/financial/gateways` | Criar configuração |
| PUT | `/financial/gateways/:id` | Atualizar |
| DELETE | `/financial/gateways/:id` | Desativar |
| POST | `/financial/gateways/simulate` | Simular cálculo de taxas |

### Conciliação OFX (`/financial/ofx`)
| Método | Path | Descrição |
|--------|------|-----------|
| POST | `/financial/ofx/import` | Importar arquivo OFX |
| GET | `/financial/ofx/imports` | Listar importações |
| GET | `/financial/ofx/imports/:id/items` | Itens de uma importação |
| POST | `/financial/ofx/items/:id/match` | Match manual / ignorar |

### Relatórios (`/financial/reports`)
| Método | Path | Descrição |
|--------|------|-----------|
| GET | `/financial/reports/dre` | DRE por período |
| GET | `/financial/reports/summary` | Resumo financeiro do mês |
| GET | `/financial/reports/cmv` | CMV detalhado por período |

## Regras de Negócio

### Cálculo de Taxas (feeCalculator.js)
- **PERCENTAGE**: `feeAmount = grossAmount × feePercent` (ex: 12% do iFood)
- **FIXED**: `feeAmount = feeFixed` (ex: R$0,50 por transação PIX)
- **MIXED**: `feeAmount = (grossAmount × feePercent) + feeFixed`
- **D+N**: `expectedDate = transactionDate + settlementDays` (dias úteis, pula sáb/dom)

### Conciliação OFX (ofxProcessor.js)
Algoritmo de match automático com score de confiança (0.0 a 1.0):
- **Valor** (peso 0.5): Score 1.0 se diferença ≤ R$0.05
- **Data** (peso 0.3): Score 1.0 no mesmo dia, 0.9 com 1 dia de diferença
- **Descrição** (peso 0.2): Comparação de palavras do memo com descrição
- **Threshold**: Score ≥ 0.7 = match automático (`MATCHED`)

### CMV (reports.js)
- Calcula a partir de `StockMovement` (type=IN) × `StockMovementItem.unitCost`
- Filtra apenas ingredientes com `composesCmv = true`
- Usa o campo existente `IngredientGroup.composesCmv` e `Ingredient.composesCmv`

### Rastreabilidade (sourceType + sourceId)
Todo registro financeiro gerado automaticamente carrega:
- `sourceType`: `"ORDER"`, `"RIDER"`, `"AFFILIATE"`, `"COUPON"`, `"STOCK_PURCHASE"`, `"MANUAL"`
- `sourceId`: UUID do registro de origem

Isso permite rastrear de volta ao registro original sem foreign keys diretas (polimorfismo por convenção).

## Gating por Plano SaaS

O módulo é protegido pela função `requireModule('FINANCIAL')` em `index.js`.
Para ativar, adicione `FINANCIAL` na enum `ModuleKey` (já feito) e associe ao plano desejado via `SaasPlanModule`.
