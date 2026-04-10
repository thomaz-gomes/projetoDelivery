# Contas a Pagar — Formas de Pagamento e Parcelamento

**Data:** 2026-04-10

---

## Contexto

O módulo financeiro já tem FinancialTransaction com campos de parcelas (installmentNumber, totalInstallments, parentTransactionId) mas sem lógica automática de geração. Não existe cadastro de formas de pagamento para contas a pagar (apenas PaymentMethod para checkout de pedidos e PaymentGatewayConfig para taxas de marketplace).

## O que será construído

1. Cadastro de formas de pagamento da empresa (cartão de crédito, boleto, PIX, dinheiro, transferência)
2. Cartão de crédito com regras de fechamento/vencimento de fatura
3. Geração automática de parcelas com preview editável
4. Boleto parcelado com templates de intervalo (30 dias, 7/14/21, 7/15, personalizado)
5. Resumo de fatura por cartão no dashboard
6. Baixa de fatura inteira ou parcela individual

---

## Seção 1: Cadastro de Formas de Pagamento

### Modelo: PayablePaymentMethod

```
PayablePaymentMethod
─────────────────────────────────
  id              String @id @default(uuid())
  companyId       String → FK Company
  name            String (ex: "Visa Itaú", "Bradesco Boleto")
  type            PayableMethodType enum: CREDIT_CARD | BOLETO | PIX | DINHEIRO | TRANSFERENCIA
  isActive        Boolean @default(true)

  // Específico de cartão de crédito
  closingDay      Int? (dia do fechamento da fatura, 1-31)
  dueDay          Int? (dia do vencimento/pagamento, 1-31)
  cardBrand       String? (Visa, Mastercard, Elo, etc.)
  lastDigits      String? (últimos 4 dígitos, opcional)
  creditLimit     Decimal? (limite, opcional)

  // Conta financeira padrão para baixa
  accountId       String? → FK FinancialAccount?

  createdAt, updatedAt
```

### Regras do Cartão de Crédito

```
Exemplo: Visa Itaú, fechamento dia 08, vencimento dia 20

Compra em 07/04 (ANTES do fechamento):
  → Entra na fatura que fecha 08/04
  → Vencimento parcela 1: 20/04

Compra em 08/04 (NO DIA ou DEPOIS do fechamento):
  → Entra na fatura que fecha 08/05
  → Vencimento parcela 1: 20/05

Parcelas seguintes: +1 mês cada
```

### Regras do Boleto Parcelado

Templates de intervalo (admin escolhe):

| Template | Exemplo para 3x (compra 10/04) |
|----------|-------------------------------|
| A cada 30 dias | 10/05, 09/06, 09/07 |
| 7/14/21 dias | 17/04, 24/04, 01/05 |
| 7/15 dias | 17/04, 25/04 |
| Personalizado | Admin edita cada data |

### PIX / Dinheiro / Transferência

Sempre à vista — 1 parcela, vencimento na data informada.

---

## Seção 2: Criação de Conta a Pagar com Parcelas

### Fluxo

```
Admin clica "Nova Conta a Pagar"
    ↓
Preenche: descrição, valor total, centro de custo, forma de pagamento, data da compra
    ↓
Se CREDIT_CARD:
  - Seleciona número de parcelas (1x a 24x)
  - Sistema calcula datas automaticamente (closingDay/dueDay)
  - Preview editável (valor e data por parcela)
    ↓
Se BOLETO:
  - Seleciona número de parcelas
  - Seleciona template de intervalo (30d | 7/14/21 | 7/15 | personalizado)
  - Preview editável
    ↓
Se PIX | DINHEIRO | TRANSFERENCIA:
  - 1 parcela, data de vencimento manual
    ↓
Admin confirma → Sistema cria transações
```

### O que é criado no banco

Para R$1.200 em 3x no Visa Itaú (compra em 07/04, fechamento dia 08, vencimento dia 20):

```
FinancialTransaction (mãe — agrupadora)
  type: PAYABLE, status: CONFIRMED
  description: "Compra de insumos Fornecedor X"
  grossAmount: 1200.00, totalInstallments: 3
  payablePaymentMethodId: [Visa Itaú]
  sourceType: 'MANUAL'

FinancialTransaction (parcela 1)
  type: PAYABLE, status: PENDING
  description: "Compra de insumos Fornecedor X (1/3)"
  grossAmount: 400.00, dueDate: 2026-04-20
  installmentNumber: 1, totalInstallments: 3
  parentTransactionId: [mãe]
  payablePaymentMethodId: [Visa Itaú]

FinancialTransaction (parcela 2)
  dueDate: 2026-05-20, installmentNumber: 2

FinancialTransaction (parcela 3)
  dueDate: 2026-06-20, installmentNumber: 3
```

### Campo novo no FinancialTransaction

```
+ payablePaymentMethodId  → FK PayablePaymentMethod? (nullable)
```

---

## Seção 3: Resumo de Fatura no Dashboard

### Card por cartão de crédito

```
┌─────────────────────────────────────────────┐
│ Visa Itaú (final 4532)                      │
│ Fatura atual: vence 20/04/2026              │
│                                             │
│ 8 parcelas ─────────────── R$ 2.340,00      │
│                                             │
│ [Ver detalhes]  [Pagar fatura]              │
└─────────────────────────────────────────────┘
```

### Lógica de fatura atual

Busca parcelas pendentes do cartão no mês corrente:
```
WHERE payablePaymentMethodId = cartão
  AND dueDate entre primeiro e último dia do mês
  AND status IN ['PENDING', 'CONFIRMED', 'OVERDUE']
```

### "Ver detalhes"

Lista de parcelas da fatura com possibilidade de pagar individualmente.

### "Pagar fatura"

Dá baixa em todas as parcelas pendentes do mês em uma $transaction:
- Cada parcela: status='PAID', paidAt=now(), paidAmount=grossAmount
- Cria CashFlowEntry OUTFLOW total
- Atualiza saldo da FinancialAccount

---

## Seção 4: Resumo de Mudanças

### Schema Prisma

| Modelo | Alteração |
|--------|-----------|
| PayablePaymentMethod | Novo modelo |
| FinancialTransaction | + payablePaymentMethodId (FK nullable) |
| Company | + relação inversa |

### Backend

| Área | Mudança |
|------|---------|
| CRUD /financial/payment-methods | Novo — criar, listar, editar, desativar |
| POST /financial/transactions | Aceitar payablePaymentMethodId, installments, template. Gerar parcelas com preview |
| POST /financial/invoices/pay | Novo — pagar fatura inteira |
| GET /financial/invoices/summary | Novo — resumo de faturas por cartão |
| Helper calculateInstallmentDates | Novo — cálculo de datas por tipo/regras |

### Frontend

| Área | Mudança |
|------|---------|
| PayablePaymentMethods.vue | Nova view — CRUD formas de pagamento |
| FinancialTransactions.vue | Modal de criação com parcelas e preview |
| FinancialDashboard.vue | Cards de fatura por cartão |
| Router | Nova rota /financial/payment-methods |
