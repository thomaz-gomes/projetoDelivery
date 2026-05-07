# Design: DRE Gerencial, Despesas Fixas e Recorrência Automática

**Data:** 2026-05-04
**Status:** Aprovado
**Escopo:** delivery-saas-backend + delivery-saas-frontend

---

## Contexto

O módulo financeiro atual tem DRE funcional mas sem distinção entre custos fixos e variáveis, sem Margem de Contribuição e sem geração automática de despesas recorrentes. O usuário precisa lançar manualmente aluguel, energia e outras despesas fixas todo mês, e o DRE não responde à pergunta mais estratégica de um delivery: *"a partir de quanto faturamento paro de perder dinheiro?"*

Referências consultadas: F360, Conta Azul, eGestor, Sebrae, Porter Contabilidade — todos convergem para o modelo de **Custeio Variável com Margem de Contribuição** como padrão gerencial para restaurantes/delivery.

---

## Objetivo

1. Classificar centros de custo como FIXA ou VARIÁVEL
2. Reestruturar o DRE para exibir Margem de Contribuição e Ponto de Equilíbrio
3. Criar engine de despesas recorrentes com geração automática de lançamentos

---

## Seção 1 — Modelo de Dados

### 1.1 Campo `natureza` em `CostCenter`

```prisma
model CostCenter {
  // ...campos existentes...
  natureza  String?  // "FIXA" | "VARIAVEL" | null
}
```

Migração: campo nullable, sem impacto em dados existentes.

Seed padrão (`POST /financial/cost-centers/seed-default`) atualizado com `natureza`:

| Código | Nome                  | dreGroup   | natureza  |
|--------|-----------------------|------------|-----------|
| 1.x    | Receitas              | REVENUE    | —         |
| 2.x    | Deduções              | DEDUCTIONS | VARIAVEL  |
| 3.01   | Insumos/Matéria-Prima | COGS       | VARIAVEL  |
| 3.02   | Embalagens            | COGS       | VARIAVEL  |
| 4.01   | Folha Pagamento       | OPEX       | FIXA      |
| 4.02   | Aluguel               | OPEX       | FIXA      |
| 4.03   | Utilities             | OPEX       | FIXA      |
| 4.04   | Marketing             | OPEX       | FIXA      |
| 4.05   | Motoboys              | OPEX       | VARIAVEL  |
| 4.06   | Comissões Afiliados   | OPEX       | VARIAVEL  |
| 4.07   | Manutenção            | OPEX       | FIXA      |
| 4.08   | Software              | OPEX       | FIXA      |
| 4.09   | Outras Despesas       | OPEX       | null      |
| 5.x    | Resultado Financeiro  | FINANCIAL  | —         |

### 1.2 Nova tabela `RecurringExpense`

```prisma
model RecurringExpense {
  id              String    @id @default(uuid())
  companyId       String
  company         Company   @relation(fields: [companyId], references: [id])
  description     String
  grossAmount     Decimal   @db.Decimal(10, 2)
  accountId       String?
  account         FinancialAccount? @relation(fields: [accountId], references: [id])
  costCenterId    String?
  costCenter      CostCenter? @relation(fields: [costCenterId], references: [id])
  supplierId      String?
  supplier        Supplier? @relation(fields: [supplierId], references: [id])
  recurrence      String    // MONTHLY | WEEKLY | BIWEEKLY | QUARTERLY | ANNUAL
  dayOfMonth      Int?      // 1-28, para MONTHLY/QUARTERLY/ANNUAL
  notes           String?
  isActive        Boolean   @default(true)
  lastGeneratedAt DateTime?
  nextDueDate     DateTime
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  @@index([companyId, isActive], name: "idx_recurring_company_active")
  @@index([nextDueDate], name: "idx_recurring_next_due")
}
```

`FinancialTransaction` ganha `sourceType = 'RECURRING'` e `sourceId = recurringExpense.id` nas transações geradas automaticamente. O campo `sourceType` já é String livre no schema atual — nenhuma mudança de enum necessária.

---

## Seção 2 — DRE Gerencial Reestruturado

### 2.1 Nova estrutura de cálculo

```
RECEITA BRUTA
  └─ dreGroup = REVENUE (RECEIVABLE, soma netAmount)

(-) DEDUÇÕES
  └─ dreGroup = DEDUCTIONS (PAYABLE, soma netAmount)

(=) RECEITA LÍQUIDA = Bruta - Deduções

(-) CUSTOS E DESPESAS VARIÁVEIS
  ├─ dreGroup = COGS (sempre variável)
  └─ dreGroup = OPEX AND natureza = 'VARIAVEL'

(=) MARGEM DE CONTRIBUIÇÃO = Líquida - Variáveis
    Percentual = MC / Receita Bruta × 100

(-) DESPESAS FIXAS
  └─ dreGroup = OPEX AND (natureza = 'FIXA' OR natureza IS NULL)

(=) RESULTADO OPERACIONAL = MC - Despesas Fixas

(+/-) RESULTADO FINANCEIRO
  └─ dreGroup = FINANCIAL

(=) RESULTADO LÍQUIDO = Operacional + Financeiro

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PONTO DE EQUILÍBRIO
  = Despesas Fixas / (MC% / 100)
  Interpretação: faturamento mínimo para cobrir o fixo
```

### 2.2 Regime

Mantém regime de caixa: somente transações com `status IN (PAID, PARTIALLY)` entram no DRE. Sem alteração de comportamento atual.

### 2.3 Aviso de centros não classificados

Centros OPEX com `natureza = null` são tratados como FIXA (conservador) mas o endpoint retorna flag `hasUnclassified: true` e lista os centros sem classificação, para que o frontend exiba um alerta orientando o usuário a classificar.

### 2.4 Resposta do endpoint `GET /financial/reports/dre`

```json
{
  "receitaBruta": 50000,
  "deducoes": 3000,
  "receitaLiquida": 47000,
  "custosVariaveis": 18000,
  "margemContribuicao": 29000,
  "margemContribuicaoPct": 61.7,
  "despesasFixas": 12000,
  "resultadoOperacional": 17000,
  "resultadoFinanceiro": -500,
  "resultadoLiquido": 16500,
  "pontoEquilibrio": 19448,
  "hasUnclassified": false,
  "unclassifiedCenters": [],
  "lines": [ ...detalhes por centro de custo... ]
}
```

---

## Seção 3 — Engine de Recorrência

### 3.1 Job `generateRecurringExpenses.js`

**Localização:** `src/jobs/generateRecurringExpenses.js`

**Trigger:** chamado no startup do servidor e agendado via `node-cron` para rodar às 06:00 BRT todos os dias.

**Algoritmo:**

```
Para cada empresa ativa:
  Buscar RecurringExpense onde isActive=true AND nextDueDate <= hoje+3dias
  Para cada template:
    Verificar se já existe FinancialTransaction com
      sourceType='RECURRING' AND sourceId=template.id AND dueDate=template.nextDueDate
    Se NÃO existe:
      Criar FinancialTransaction (PAYABLE, CONFIRMED)
        description: template.description
        grossAmount/netAmount: template.grossAmount
        accountId: template.accountId
        costCenterId: template.costCenterId
        dueDate: template.nextDueDate
        issueDate: hoje
        sourceType: 'RECURRING'
        sourceId: template.id
    Calcular próximo nextDueDate com base em recurrence + dayOfMonth
    Atualizar template: lastGeneratedAt=agora, nextDueDate=próximo
```

**Cálculo de nextDueDate:**

| recurrence | Lógica |
|------------|--------|
| MONTHLY    | Mesmo `dayOfMonth` do mês seguinte |
| BIWEEKLY   | +14 dias |
| WEEKLY     | +7 dias |
| QUARTERLY  | +3 meses, mesmo dia |
| ANNUAL     | +1 ano, mesmo dia |

Para meses com menos dias que `dayOfMonth` (ex: fevereiro com dia 31), usar último dia do mês.

### 3.2 Novos endpoints REST

```
GET    /financial/recurring          Lista templates (isActive filter)
POST   /financial/recurring          Cria template + gera primeira instância imediata
PUT    /financial/recurring/:id      Atualiza template
DELETE /financial/recurring/:id      Soft delete (isActive = false)
POST   /financial/recurring/generate Dispara geração manual (admin/debug)
```

### 3.3 Frontend: nova view `FinancialRecurring.vue`

**Rota:** `/financeiro/despesas-fixas`

Funcionalidades:
- Tabela com: Descrição, Valor, Periodicidade, Próximo Vencimento, Centro de Custo, Status (Ativo/Inativo)
- Badge de próximo vencimento: verde (>7 dias), amarelo (≤7 dias), vermelho (vencido)
- Modal criar/editar: descrição, valor, periodicidade, dia do mês, conta, centro de custo (filtrado para natureza=FIXA), fornecedor, observações
- Botão "Desativar" (soft delete) com confirmação
- Botão "Gerar agora" por template (dispara `POST /financial/recurring/generate` com id)

### 3.4 Fluxo de Caixa

O endpoint `GET /financial/cash-flow` já inclui transações CONFIRMED no forecast. Nenhuma mudança necessária — as transações geradas pelo job aparecem automaticamente.

Melhoria opcional (fase 2): incluir os templates ainda não gerados (com `nextDueDate` futuro além da janela de 3 dias) como linhas de forecast identificadas visualmente no gráfico.

---

## Seção 4 — Centros de Custo: Coluna Natureza

A view `FinancialCostCenters.vue` recebe:
- Coluna "Natureza" na tabela com badge: `FIXA` (azul), `VARIÁVEL` (laranja), `—` (cinza)
- Seletor inline para alterar sem abrir modal completo
- O endpoint `PUT /financial/cost-centers/:id` aceita o campo `natureza`

---

## Impacto e Riscos

| Item | Impacto |
|------|---------|
| Schema | 1 campo nullable em CostCenter + 1 nova tabela |
| DRE existente | Mudança de estrutura da resposta JSON — frontend precisa ser atualizado junto |
| Dados existentes | Centros sem `natureza` → tratados como FIXA, sem perda de dados |
| Job recorrente | Idempotente por design (anti-duplicata por sourceType+sourceId+dueDate) |
| Fluxo de caixa | Sem alteração de lógica — aproveita comportamento existente |

---

## Ordem de Implementação Sugerida

1. Migration: campo `natureza` em `CostCenter`
2. Migration: tabela `RecurringExpense`
3. Atualizar seed de centros de custo com `natureza`
4. Atualizar endpoint `PUT /financial/cost-centers/:id` para aceitar `natureza`
5. Atualizar frontend `FinancialCostCenters.vue` (coluna + seletor inline)
6. Refatorar `GET /financial/reports/dre` com nova estrutura
7. Atualizar frontend `FinancialDRE.vue`
8. Criar `src/jobs/generateRecurringExpenses.js`
9. Criar endpoints REST `/financial/recurring`
10. Criar frontend `FinancialRecurring.vue`
11. Registrar job no startup do servidor
12. Adicionar rota na navegação lateral
