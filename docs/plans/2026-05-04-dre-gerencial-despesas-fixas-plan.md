# DRE Gerencial + Despesas Fixas Recorrentes — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Adicionar campo `natureza` (FIXA/VARIAVEL) aos centros de custo, reestruturar o DRE para exibir Margem de Contribuição e Ponto de Equilíbrio, e criar engine de despesas fixas recorrentes com geração automática de lançamentos.

**Architecture:** Campo `natureza` no `CostCenter` direciona a lógica do DRE para separar custos variáveis de fixos. Uma nova tabela `RecurringExpense` armazena templates de despesas recorrentes. Um job diário (registrado em `cron.js`) gera os `FinancialTransaction` correspondentes 3 dias antes do vencimento, usando `sourceType='RECURRING'` para idempotência. O DRE é recalculado com Custeio Variável: `MC = Receita Líquida - Custos Variáveis`, `PE = Despesas Fixas / MC%`.

**Tech Stack:** Express.js, Prisma ORM, PostgreSQL, Vue 3, node-cron (já presente via cron.js), Docker Compose para dev.

**Design doc:** `docs/plans/2026-05-04-dre-gerencial-despesas-fixas-design.md`

---

## Task 1: Schema — campo `natureza` em CostCenter + tabela RecurringExpense

**Files:**
- Modify: `delivery-saas-backend/prisma/schema.prisma`

**Contexto:** O `CostCenter` está em torno da linha 1868. A `Company` tem relações com muitos modelos financeiros — precisamos adicionar `recurringExpenses` lá também. O `FinancialAccount` e `CostCenter` precisam de relação inversa com `RecurringExpense`.

### Step 1: Adicionar `natureza` ao model CostCenter

Localize o model `CostCenter` no schema. Adicione o campo `natureza` após `dreGroup`:

```prisma
model CostCenter {
  id          String    @id @default(uuid())
  companyId   String
  company     Company   @relation(fields: [companyId], references: [id])
  code        String
  name        String
  parentId    String?
  parent      CostCenter?  @relation("CostCenterParent", fields: [parentId], references: [id])
  children    CostCenter[] @relation("CostCenterParent")
  dreGroup    String?
  natureza    String?      // "FIXA" | "VARIAVEL" | null
  isActive    Boolean   @default(true)
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  transactions FinancialTransaction[]
  recurringExpenses RecurringExpense[]   // ← nova relação

  @@unique([companyId, code])
  @@index([companyId], name: "idx_costcenter_company")
}
```

### Step 2: Adicionar model RecurringExpense ao schema

Adicione após o model `CashFlowEntry` (ou qualquer posição lógica no bloco financeiro):

```prisma
model RecurringExpense {
  id              String           @id @default(uuid())
  companyId       String
  company         Company          @relation(fields: [companyId], references: [id])
  description     String
  grossAmount     Decimal          @db.Decimal(10, 2)
  accountId       String?
  account         FinancialAccount? @relation(fields: [accountId], references: [id])
  costCenterId    String?
  costCenter      CostCenter?      @relation(fields: [costCenterId], references: [id])
  supplierId      String?
  supplier        Supplier?        @relation(fields: [supplierId], references: [id])
  recurrence      String           // "MONTHLY" | "BIWEEKLY" | "WEEKLY" | "QUARTERLY" | "ANNUAL"
  dayOfMonth      Int?             // 1-28, dia do mês para MONTHLY/QUARTERLY/ANNUAL
  notes           String?
  isActive        Boolean          @default(true)
  lastGeneratedAt DateTime?
  nextDueDate     DateTime
  createdAt       DateTime         @default(now())
  updatedAt       DateTime         @updatedAt

  @@index([companyId, isActive], name: "idx_recurring_company_active")
  @@index([nextDueDate], name: "idx_recurring_next_due")
}
```

### Step 3: Adicionar relações inversas nos models existentes

No model `Company`, adicione:
```prisma
recurringExpenses RecurringExpense[]
```

No model `FinancialAccount`, adicione:
```prisma
recurringExpenses RecurringExpense[]
```

No model `Supplier` (se existir), adicione:
```prisma
recurringExpenses RecurringExpense[]
```

### Step 4: Aplicar migration

```bash
cd delivery-saas-backend
npx prisma db push --skip-generate
npx prisma generate
```

Esperado: saída sem erros, schema sincronizado com o banco.

### Step 5: Verificar

```bash
npx prisma studio
```

Confirmar que `CostCenter` tem coluna `natureza` e que tabela `RecurringExpense` aparece.

### Step 6: Commit

```bash
git add prisma/schema.prisma
git commit -m "feat(schema): add natureza to CostCenter and RecurringExpense model"
```

---

## Task 2: Backend — atualizar costCenters.js (PUT + seed-default com natureza)

**Files:**
- Modify: `delivery-saas-backend/src/routes/financial/costCenters.js`

### Step 1: Atualizar PUT /:id para aceitar `natureza`

Localize o endpoint `router.put('/:id', ...)`. A desestruturação do body atualmente é:
```javascript
const { code, name, parentId, dreGroup, isActive } = req.body;
```

Altere para:
```javascript
const { code, name, parentId, dreGroup, isActive, natureza } = req.body;
```

E no objeto `data` do update, adicione:
```javascript
...(natureza !== undefined && { natureza: natureza || null }),
```

### Step 2: Atualizar seed-default com natureza

Localize o array `defaults` no endpoint `router.post('/seed-default', ...)`. Cada item deve ganhar o campo `natureza`. Substitua o array inteiro por:

```javascript
const defaults = [
  { code: '1',    name: 'Receitas',                        dreGroup: 'REVENUE',     natureza: null },
  { code: '1.01', name: 'Receita de Vendas (Balcão)',       dreGroup: 'REVENUE',     natureza: null, parent: '1' },
  { code: '1.02', name: 'Receita de Vendas (Delivery)',     dreGroup: 'REVENUE',     natureza: null, parent: '1' },
  { code: '1.03', name: 'Receita de Vendas (Marketplace)',  dreGroup: 'REVENUE',     natureza: null, parent: '1' },
  { code: '2',    name: 'Deduções de Receita',              dreGroup: 'DEDUCTIONS',  natureza: 'VARIAVEL' },
  { code: '2.01', name: 'Taxas Marketplace',                dreGroup: 'DEDUCTIONS',  natureza: 'VARIAVEL', parent: '2' },
  { code: '2.02', name: 'Taxas Adquirentes',                dreGroup: 'DEDUCTIONS',  natureza: 'VARIAVEL', parent: '2' },
  { code: '2.03', name: 'Descontos e Cupons',               dreGroup: 'DEDUCTIONS',  natureza: 'VARIAVEL', parent: '2' },
  { code: '2.04', name: 'Impostos sobre Vendas',            dreGroup: 'DEDUCTIONS',  natureza: 'VARIAVEL', parent: '2' },
  { code: '2.05', name: 'Cancelamentos e Estornos',         dreGroup: 'DEDUCTIONS',  natureza: 'VARIAVEL', parent: '2' },
  { code: '3',    name: 'CMV - Custo das Mercadorias',      dreGroup: 'COGS',        natureza: 'VARIAVEL' },
  { code: '3.01', name: 'Insumos e Matéria-Prima',          dreGroup: 'COGS',        natureza: 'VARIAVEL', parent: '3' },
  { code: '3.02', name: 'Embalagens',                       dreGroup: 'COGS',        natureza: 'VARIAVEL', parent: '3' },
  { code: '4',    name: 'Despesas Operacionais',            dreGroup: 'OPEX',        natureza: null },
  { code: '4.01', name: 'Folha de Pagamento',               dreGroup: 'OPEX',        natureza: 'FIXA',     parent: '4' },
  { code: '4.02', name: 'Aluguel',                          dreGroup: 'OPEX',        natureza: 'FIXA',     parent: '4' },
  { code: '4.03', name: 'Energia, Água e Gás',              dreGroup: 'OPEX',        natureza: 'FIXA',     parent: '4' },
  { code: '4.04', name: 'Marketing e Publicidade',          dreGroup: 'OPEX',        natureza: 'FIXA',     parent: '4' },
  { code: '4.05', name: 'Motoboys e Entregadores',          dreGroup: 'OPEX',        natureza: 'VARIAVEL', parent: '4' },
  { code: '4.06', name: 'Comissões de Afiliados',           dreGroup: 'OPEX',        natureza: 'VARIAVEL', parent: '4' },
  { code: '4.07', name: 'Manutenção e Reparos',             dreGroup: 'OPEX',        natureza: 'FIXA',     parent: '4' },
  { code: '4.08', name: 'Software e Licenças',              dreGroup: 'OPEX',        natureza: 'FIXA',     parent: '4' },
  { code: '4.09', name: 'Outras Despesas Operacionais',     dreGroup: 'OPEX',        natureza: null,       parent: '4' },
  { code: '5',    name: 'Resultado Financeiro',             dreGroup: 'FINANCIAL',   natureza: null },
  { code: '5.01', name: 'Receitas Financeiras',             dreGroup: 'FINANCIAL',   natureza: null, parent: '5' },
  { code: '5.02', name: 'Despesas Financeiras',             dreGroup: 'FINANCIAL',   natureza: null, parent: '5' },
];
```

Nas duas fases de criação (roots e children), inclua `natureza` no `data`:

```javascript
// Fase 1 — roots
const created = await prisma.costCenter.create({
  data: { companyId, code: item.code, name: item.name, dreGroup: item.dreGroup, natureza: item.natureza || null }
});

// Fase 2 — children
const created = await prisma.costCenter.create({
  data: { companyId, code: item.code, name: item.name, dreGroup: item.dreGroup, natureza: item.natureza || null, parentId }
});
```

### Step 3: Verificar via curl (com server rodando)

```bash
# Listar centros de custo e confirmar campo natureza
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/financial/cost-centers?flat=true | jq '.[0]'
```

Esperado: objeto com campo `natureza`.

### Step 4: Commit

```bash
git add src/routes/financial/costCenters.js
git commit -m "feat(cost-centers): add natureza field to seed and PUT endpoint"
```

---

## Task 3: Frontend — FinancialCostCenters.vue com coluna Natureza

**Files:**
- Modify: `delivery-saas-frontend/src/views/financial/FinancialCostCenters.vue`

### Step 1: Adicionar coluna Natureza na tabela

Localize o `<thead>` da tabela de centros de custo. Adicione uma coluna após "Grupo DRE":

```html
<th>Natureza</th>
```

Na linha de dados (`<tr v-for="cc in costCenters"`), adicione a célula correspondente:

```html
<td>
  <select class="form-select form-select-sm" style="width:130px"
    :value="cc.natureza || ''"
    @change="updateNatureza(cc, $event.target.value)">
    <option value="">— Não classificado</option>
    <option value="FIXA">FIXA</option>
    <option value="VARIAVEL">VARIÁVEL</option>
  </select>
</td>
```

### Step 2: Adicionar método `updateNatureza` no script

```javascript
async updateNatureza(cc, value) {
  try {
    await api.put(`/financial/cost-centers/${cc.id}`, {
      natureza: value || null,
    });
    cc.natureza = value || null;
  } catch (e) {
    alert(e.response?.data?.message || 'Erro ao atualizar natureza');
  }
},
```

### Step 3: Adicionar campo `natureza` ao modal de criação/edição

No formulário do modal (dentro de `<div class="modal..."`), adicione após o campo dreGroup:

```html
<div class="mb-3">
  <label class="form-label">Natureza</label>
  <SelectInput v-model="form.natureza"
    :options="[{value:'FIXA',label:'Fixa'},{value:'VARIAVEL',label:'Variável'}]"
    placeholder="Não classificado" />
</div>
```

Garanta que `form.natureza` esteja inicializado (provavelmente o form já tem um objeto — adicione `natureza: ''` ao objeto inicial).

No método `save()`, o campo `natureza` já será enviado automaticamente junto com o resto do form.

### Step 4: Verificar no browser

Acessar `/financial/cost-centers`, confirmar que a coluna aparece e que o select inline salva sem recarregar a página.

### Step 5: Commit

```bash
git add src/views/financial/FinancialCostCenters.vue
git commit -m "feat(frontend): add natureza column to cost centers table"
```

---

## Task 4: Backend — refatorar DRE report com Custeio Variável

**Files:**
- Modify: `delivery-saas-backend/src/routes/financial/reports.js`

### Step 1: Substituir a lógica do endpoint `GET /dre`

O endpoint atual (linhas ~8-120) agrupa por `dreGroup` e calcula Lucro Bruto + Despesas Operacionais. A nova lógica separa OPEX em FIXA vs VARIAVEL.

Substitua **todo o bloco de cálculo** (após buscar `transactions` e `costCenters`) pelo seguinte:

```javascript
// Mapear totais por costCenterId
const ccTotals = {};
for (const tx of transactions) {
  const ccId = tx.costCenterId;
  if (!ccTotals[ccId]) ccTotals[ccId] = 0;
  const value = tx.type === 'RECEIVABLE'
    ? Number(tx.paidAmount || tx.netAmount)
    : -Number(tx.paidAmount || tx.netAmount);
  ccTotals[ccId] += value;
}

// Classificar cada centro de custo nos grupos do novo DRE
const groups = {
  REVENUE:    { items: [], total: 0 },
  DEDUCTIONS: { items: [], total: 0 },
  VARIAVEL:   { items: [], total: 0 },  // COGS + OPEX natureza=VARIAVEL
  FIXA:       { items: [], total: 0 },  // OPEX natureza=FIXA ou null
  FINANCIAL:  { items: [], total: 0 },
};

const unclassifiedCenters = [];

for (const cc of costCenters) {
  if (!cc.dreGroup) continue;
  const total = ccTotals[cc.id] || 0;
  const item = { costCenterId: cc.id, code: cc.code, name: cc.name, total, natureza: cc.natureza };

  if (cc.dreGroup === 'REVENUE') {
    groups.REVENUE.items.push(item);
    groups.REVENUE.total += total;
  } else if (cc.dreGroup === 'DEDUCTIONS') {
    groups.DEDUCTIONS.items.push(item);
    groups.DEDUCTIONS.total += total;
  } else if (cc.dreGroup === 'COGS') {
    // CMV é sempre variável
    groups.VARIAVEL.items.push(item);
    groups.VARIAVEL.total += total;
  } else if (cc.dreGroup === 'OPEX') {
    if (cc.natureza === 'VARIAVEL') {
      groups.VARIAVEL.items.push(item);
      groups.VARIAVEL.total += total;
    } else {
      // FIXA ou null → tratado como FIXA (conservador)
      if (!cc.natureza && total !== 0) unclassifiedCenters.push(cc.name);
      groups.FIXA.items.push(item);
      groups.FIXA.total += total;
    }
  } else if (cc.dreGroup === 'FINANCIAL') {
    groups.FINANCIAL.items.push(item);
    groups.FINANCIAL.total += total;
  }
}

// Calcular CMV via stock movements (já existia)
const cmv = await calculateCMV(prisma, companyId, from, to, storeId);
if (cmv.total) {
  // Se já há COGS no grupos.VARIAVEL via transações, cmv pode ser 0
  // Adicionar CMV de estoque apenas se não houver transações COGS
  const hasCogsTx = groups.VARIAVEL.items.some(i => {
    const cc = costCenters.find(c => c.id === i.costCenterId);
    return cc?.dreGroup === 'COGS';
  });
  if (!hasCogsTx && cmv.total !== 0) {
    groups.VARIAVEL.total += cmv.total;
    groups.VARIAVEL.items.push({ costCenterId: null, code: '3.x', name: 'CMV (Estoque)', total: cmv.total });
  }
}

// Calcular métricas do DRE Gerencial
const receitaBruta   = groups.REVENUE.total;
const deducoes       = groups.DEDUCTIONS.total;        // negativo
const receitaLiquida = receitaBruta + deducoes;
const custosVariaveis = groups.VARIAVEL.total;         // negativo
const margemContribuicao = receitaLiquida + custosVariaveis;
const margemContribuicaoPct = receitaBruta !== 0
  ? (margemContribuicao / receitaBruta) * 100
  : 0;
const despesasFixas       = groups.FIXA.total;         // negativo
const resultadoOperacional = margemContribuicao + despesasFixas;
const resultadoFinanceiro  = groups.FINANCIAL.total;
const resultadoLiquido     = resultadoOperacional + resultadoFinanceiro;

// Ponto de Equilíbrio: Fixas / (MC% / 100)
// MC% é calculado sobre Receita Bruta. Resultado positivo = faturamento mínimo.
const pontoEquilibrio = margemContribuicaoPct > 0
  ? Math.abs(despesasFixas) / (margemContribuicaoPct / 100)
  : null;

res.json({
  period: { from, to },
  receitaBruta,
  deducoes,
  receitaLiquida,
  custosVariaveis,
  margemContribuicao,
  margemContribuicaoPct: Number(margemContribuicaoPct.toFixed(2)),
  despesasFixas,
  resultadoOperacional,
  resultadoFinanceiro,
  resultadoLiquido,
  pontoEquilibrio: pontoEquilibrio ? Number(pontoEquilibrio.toFixed(2)) : null,
  hasUnclassified: unclassifiedCenters.length > 0,
  unclassifiedCenters,
  groups,
  margins: {
    grossMargin: receitaBruta ? ((margemContribuicao / receitaBruta) * 100).toFixed(2) + '%' : '0%',
    operatingMargin: receitaBruta ? ((resultadoOperacional / receitaBruta) * 100).toFixed(2) + '%' : '0%',
    netMargin: receitaBruta ? ((resultadoLiquido / receitaBruta) * 100).toFixed(2) + '%' : '0%',
  },
});
```

### Step 2: Verificar via curl

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/financial/reports/dre?dateFrom=2026-01-01&dateTo=2026-01-31" | jq '{mc: .margemContribuicao, mc_pct: .margemContribuicaoPct, pe: .pontoEquilibrio}'
```

Esperado: objeto com `margemContribuicao` e `pontoEquilibrio` calculados.

### Step 3: Commit

```bash
git add src/routes/financial/reports.js
git commit -m "feat(dre): restructure to custeio variavel with margemContribuicao and pontoEquilibrio"
```

---

## Task 5: Frontend — atualizar FinancialDRE.vue

**Files:**
- Modify: `delivery-saas-frontend/src/views/financial/FinancialDRE.vue`

### Step 1: Substituir a tabela do DRE no template

A view atual exibe `dre.lines.receitaBruta`, etc. Reescreva a seção de resultado para consumir a nova estrutura. Substitua a tabela existente por:

```html
<!-- Alerta centros não classificados -->
<div v-if="dre.hasUnclassified" class="alert alert-warning mb-3">
  <i class="bi-exclamation-triangle me-2"></i>
  Centros de custo sem classificação (tratados como Fixo):
  <strong>{{ dre.unclassifiedCenters.join(', ') }}</strong>.
  <router-link to="/financial/cost-centers" class="ms-2">Classificar agora</router-link>
</div>

<div class="card">
  <div class="table-responsive">
    <table class="table mb-0">
      <thead class="table-light">
        <tr><th>Descrição</th><th class="text-end">Valor (R$)</th><th class="text-end">%</th></tr>
      </thead>
      <tbody>
        <!-- Receita Bruta -->
        <tr class="fw-bold">
          <td>(+) Receita Bruta</td>
          <td class="text-end text-success">{{ fmt(dre.receitaBruta) }}</td>
          <td class="text-end">100%</td>
        </tr>
        <tr v-for="item in dre.groups?.REVENUE?.items" :key="item.costCenterId" class="table-sm text-muted small">
          <td class="ps-4">{{ item.code }} — {{ item.name }}</td>
          <td class="text-end">{{ fmt(item.total) }}</td>
          <td></td>
        </tr>

        <!-- Deduções -->
        <tr class="fw-bold">
          <td>(-) Deduções de Receita</td>
          <td class="text-end text-danger">{{ fmt(dre.deducoes) }}</td>
          <td class="text-end text-danger">{{ pct(dre.deducoes, dre.receitaBruta) }}</td>
        </tr>
        <tr v-for="item in dre.groups?.DEDUCTIONS?.items" :key="item.costCenterId" class="text-muted small">
          <td class="ps-4">{{ item.code }} — {{ item.name }}</td>
          <td class="text-end">{{ fmt(item.total) }}</td>
          <td></td>
        </tr>

        <!-- Receita Líquida -->
        <tr class="table-secondary fw-bold">
          <td>(=) Receita Líquida</td>
          <td class="text-end">{{ fmt(dre.receitaLiquida) }}</td>
          <td class="text-end">{{ pct(dre.receitaLiquida, dre.receitaBruta) }}</td>
        </tr>

        <!-- Custos Variáveis -->
        <tr class="fw-bold">
          <td>(-) Custos e Despesas Variáveis</td>
          <td class="text-end text-danger">{{ fmt(dre.custosVariaveis) }}</td>
          <td class="text-end text-danger">{{ pct(dre.custosVariaveis, dre.receitaBruta) }}</td>
        </tr>
        <tr v-for="item in dre.groups?.VARIAVEL?.items" :key="item.costCenterId || item.code" class="text-muted small">
          <td class="ps-4">{{ item.code }} — {{ item.name }}</td>
          <td class="text-end">{{ fmt(item.total) }}</td>
          <td></td>
        </tr>

        <!-- Margem de Contribuição ★ -->
        <tr class="table-primary fw-bold fs-6">
          <td>★ (=) Margem de Contribuição</td>
          <td class="text-end">{{ fmt(dre.margemContribuicao) }}</td>
          <td class="text-end">{{ dre.margemContribuicaoPct?.toFixed(1) }}%</td>
        </tr>

        <!-- Despesas Fixas -->
        <tr class="fw-bold">
          <td>(-) Despesas Fixas</td>
          <td class="text-end text-danger">{{ fmt(dre.despesasFixas) }}</td>
          <td class="text-end text-danger">{{ pct(dre.despesasFixas, dre.receitaBruta) }}</td>
        </tr>
        <tr v-for="item in dre.groups?.FIXA?.items" :key="item.costCenterId" class="text-muted small">
          <td class="ps-4">{{ item.code }} — {{ item.name }}</td>
          <td class="text-end">{{ fmt(item.total) }}</td>
          <td></td>
        </tr>

        <!-- Resultado Operacional -->
        <tr class="table-secondary fw-bold">
          <td>(=) Resultado Operacional (EBITDA)</td>
          <td class="text-end" :class="dre.resultadoOperacional >= 0 ? 'text-success' : 'text-danger'">
            {{ fmt(dre.resultadoOperacional) }}
          </td>
          <td class="text-end">{{ pct(dre.resultadoOperacional, dre.receitaBruta) }}</td>
        </tr>

        <!-- Resultado Financeiro -->
        <tr class="fw-bold">
          <td>(+/-) Resultado Financeiro</td>
          <td class="text-end">{{ fmt(dre.resultadoFinanceiro) }}</td>
          <td class="text-end">{{ pct(dre.resultadoFinanceiro, dre.receitaBruta) }}</td>
        </tr>

        <!-- Resultado Líquido -->
        <tr class="table-dark fw-bold fs-5">
          <td>(=) Resultado Líquido</td>
          <td class="text-end" :class="dre.resultadoLiquido >= 0 ? 'text-success' : 'text-danger'">
            {{ fmt(dre.resultadoLiquido) }}
          </td>
          <td class="text-end">{{ pct(dre.resultadoLiquido, dre.receitaBruta) }}</td>
        </tr>
      </tbody>
    </table>
  </div>

  <!-- Ponto de Equilíbrio -->
  <div v-if="dre.pontoEquilibrio" class="p-3 border-top bg-light">
    <div class="row text-center">
      <div class="col-md-4">
        <div class="small text-muted">Margem de Contribuição</div>
        <div class="fw-bold fs-5">{{ dre.margemContribuicaoPct?.toFixed(1) }}%</div>
      </div>
      <div class="col-md-4">
        <div class="small text-muted">★ Ponto de Equilíbrio</div>
        <div class="fw-bold fs-5 text-primary">{{ fmt(dre.pontoEquilibrio) }}</div>
        <div class="small text-muted">faturamento mínimo para cobrir fixos</div>
      </div>
      <div class="col-md-4">
        <div class="small text-muted">Margem Líquida</div>
        <div class="fw-bold fs-5" :class="dre.resultadoLiquido >= 0 ? 'text-success' : 'text-danger'">
          {{ pct(dre.resultadoLiquido, dre.receitaBruta) }}
        </div>
      </div>
    </div>
  </div>
</div>
```

### Step 2: Atualizar métodos no script

No objeto `data()`, garanta que `dre` começa como `null`:
```javascript
dre: null,
```

No método `load()`, o response já é o novo formato — sem mudança necessária no fetch.

Adicione os helpers de formatação (se não existirem):

```javascript
fmt(value) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value || 0);
},
pct(value, total) {
  if (!total) return '0%';
  return ((value / total) * 100).toFixed(1) + '%';
},
```

### Step 3: Verificar no browser

Acesse `/financial/dre`, selecione um período, confirme que a tabela exibe:
- Linha "Margem de Contribuição" em destaque azul
- Seção "Ponto de Equilíbrio" no rodapé

### Step 4: Commit

```bash
git add src/views/financial/FinancialDRE.vue
git commit -m "feat(frontend): update DRE to custeio variavel with MC and break-even"
```

---

## Task 6: Backend — CRUD de RecurringExpense

**Files:**
- Create: `delivery-saas-backend/src/routes/financial/recurring.js`
- Modify: `delivery-saas-backend/src/routes/financial/index.js`

### Step 1: Criar o arquivo de rotas

Crie `delivery-saas-backend/src/routes/financial/recurring.js`:

```javascript
import express from 'express';
import { prisma } from '../../prisma.js';
import { generateForTemplate } from '../../jobs/generateRecurringExpenses.js';

const router = express.Router();

// GET /financial/recurring
router.get('/', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { isActive } = req.query;
    const where = { companyId };
    if (isActive !== undefined) where.isActive = isActive === 'true';

    const items = await prisma.recurringExpense.findMany({
      where,
      include: {
        account: { select: { id: true, name: true } },
        costCenter: { select: { id: true, code: true, name: true, natureza: true } },
        supplier: { select: { id: true, name: true } },
      },
      orderBy: { nextDueDate: 'asc' },
    });
    res.json(items);
  } catch (e) {
    res.status(500).json({ message: 'Erro ao listar despesas recorrentes', error: e?.message });
  }
});

// POST /financial/recurring
router.post('/', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { description, grossAmount, accountId, costCenterId, supplierId, recurrence, dayOfMonth, notes, nextDueDate } = req.body;

    if (!description || !grossAmount || !recurrence || !nextDueDate) {
      return res.status(400).json({ message: 'description, grossAmount, recurrence e nextDueDate são obrigatórios' });
    }

    const item = await prisma.recurringExpense.create({
      data: {
        companyId,
        description,
        grossAmount: Number(grossAmount),
        accountId: accountId || null,
        costCenterId: costCenterId || null,
        supplierId: supplierId || null,
        recurrence,
        dayOfMonth: dayOfMonth ? Number(dayOfMonth) : null,
        notes: notes || null,
        nextDueDate: new Date(nextDueDate),
      },
    });

    // Gera o primeiro lançamento imediatamente se nextDueDate <= hoje + 3 dias
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + 3);
    if (new Date(nextDueDate) <= cutoff) {
      await generateForTemplate(item, companyId);
    }

    res.status(201).json(item);
  } catch (e) {
    res.status(500).json({ message: 'Erro ao criar despesa recorrente', error: e?.message });
  }
});

// PUT /financial/recurring/:id
router.put('/:id', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const existing = await prisma.recurringExpense.findFirst({ where: { id: req.params.id, companyId } });
    if (!existing) return res.status(404).json({ message: 'Não encontrado' });

    const { description, grossAmount, accountId, costCenterId, supplierId, recurrence, dayOfMonth, notes, nextDueDate, isActive } = req.body;
    const data = {};
    if (description !== undefined) data.description = description;
    if (grossAmount !== undefined) data.grossAmount = Number(grossAmount);
    if (accountId !== undefined) data.accountId = accountId || null;
    if (costCenterId !== undefined) data.costCenterId = costCenterId || null;
    if (supplierId !== undefined) data.supplierId = supplierId || null;
    if (recurrence !== undefined) data.recurrence = recurrence;
    if (dayOfMonth !== undefined) data.dayOfMonth = dayOfMonth ? Number(dayOfMonth) : null;
    if (notes !== undefined) data.notes = notes || null;
    if (nextDueDate !== undefined) data.nextDueDate = new Date(nextDueDate);
    if (isActive !== undefined) data.isActive = isActive;

    const updated = await prisma.recurringExpense.update({ where: { id: req.params.id }, data });
    res.json(updated);
  } catch (e) {
    res.status(500).json({ message: 'Erro ao atualizar', error: e?.message });
  }
});

// DELETE /financial/recurring/:id  (soft delete)
router.delete('/:id', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const existing = await prisma.recurringExpense.findFirst({ where: { id: req.params.id, companyId } });
    if (!existing) return res.status(404).json({ message: 'Não encontrado' });
    await prisma.recurringExpense.update({ where: { id: req.params.id }, data: { isActive: false } });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ message: 'Erro ao desativar', error: e?.message });
  }
});

// POST /financial/recurring/:id/generate  (gerar manualmente)
router.post('/:id/generate', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const item = await prisma.recurringExpense.findFirst({ where: { id: req.params.id, companyId } });
    if (!item) return res.status(404).json({ message: 'Não encontrado' });
    const tx = await generateForTemplate(item, companyId);
    res.json({ ok: true, transaction: tx });
  } catch (e) {
    res.status(500).json({ message: 'Erro ao gerar lançamento', error: e?.message });
  }
});

export default router;
```

### Step 2: Registrar a rota no financial index

Abra `delivery-saas-backend/src/routes/financial/index.js`. Localize onde os outros routers são importados e registrados. Adicione:

```javascript
import recurringRouter from './recurring.js';
// ...
financialRouter.use('/recurring', recurringRouter);
```

### Step 3: Verificar

```bash
curl -X GET -H "Authorization: Bearer $TOKEN" http://localhost:3000/financial/recurring
```

Esperado: array vazio `[]` sem erro 404.

### Step 4: Commit

```bash
git add src/routes/financial/recurring.js src/routes/financial/index.js
git commit -m "feat(recurring): add CRUD endpoints for recurring expenses"
```

---

## Task 7: Backend — job generateRecurringExpenses.js + registro no cron

**Files:**
- Create: `delivery-saas-backend/src/jobs/generateRecurringExpenses.js`
- Modify: `delivery-saas-backend/src/cron.js`

### Step 1: Criar o job

Crie `delivery-saas-backend/src/jobs/generateRecurringExpenses.js`:

```javascript
import { prisma } from '../prisma.js';

/**
 * Calcula o próximo nextDueDate com base na recorrência e dayOfMonth.
 */
function calcNextDueDate(current, recurrence, dayOfMonth) {
  const d = new Date(current);
  switch (recurrence) {
    case 'WEEKLY':    d.setDate(d.getDate() + 7);   break;
    case 'BIWEEKLY':  d.setDate(d.getDate() + 14);  break;
    case 'MONTHLY':   d.setMonth(d.getMonth() + 1);  break;
    case 'QUARTERLY': d.setMonth(d.getMonth() + 3);  break;
    case 'ANNUAL':    d.setFullYear(d.getFullYear() + 1); break;
    default:          d.setMonth(d.getMonth() + 1);  break;
  }
  // Aplicar dayOfMonth se definido (clamp para último dia do mês)
  if (dayOfMonth && ['MONTHLY', 'QUARTERLY', 'ANNUAL'].includes(recurrence)) {
    const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(dayOfMonth, lastDay));
  }
  return d;
}

/**
 * Gera o FinancialTransaction para um template, se ainda não existir.
 * Exportada para uso no endpoint de geração manual.
 */
export async function generateForTemplate(template, companyId) {
  const dueDate = new Date(template.nextDueDate);

  // Anti-duplicata: verifica se já existe para esta data
  const existing = await prisma.financialTransaction.findFirst({
    where: {
      companyId,
      sourceType: 'RECURRING',
      sourceId: template.id,
      dueDate: { gte: new Date(dueDate.toISOString().slice(0, 10)), lte: new Date(dueDate.toISOString().slice(0, 10) + 'T23:59:59Z') },
    },
  });
  if (existing) return existing;

  const tx = await prisma.financialTransaction.create({
    data: {
      companyId,
      type: 'PAYABLE',
      status: 'CONFIRMED',
      description: template.description,
      accountId: template.accountId || null,
      costCenterId: template.costCenterId || null,
      grossAmount: Number(template.grossAmount),
      feeAmount: 0,
      netAmount: Number(template.grossAmount),
      dueDate,
      issueDate: new Date(),
      sourceType: 'RECURRING',
      sourceId: template.id,
      notes: template.notes || null,
    },
  });

  // Avançar nextDueDate
  const next = calcNextDueDate(dueDate, template.recurrence, template.dayOfMonth);
  await prisma.recurringExpense.update({
    where: { id: template.id },
    data: { lastGeneratedAt: new Date(), nextDueDate: next },
  });

  return tx;
}

/**
 * Job principal: gera lançamentos para todos os templates com nextDueDate <= hoje+3 dias.
 * Idempotente — pode ser chamado múltiplas vezes sem duplicar.
 */
export async function generateRecurringExpenses() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + 3);

  const templates = await prisma.recurringExpense.findMany({
    where: { isActive: true, nextDueDate: { lte: cutoff } },
  });

  let generated = 0;
  for (const template of templates) {
    try {
      const tx = await generateForTemplate(template, template.companyId);
      if (tx) generated++;
    } catch (e) {
      console.error(`[RecurringExpenses] Erro no template ${template.id}:`, e.message);
    }
  }

  if (generated > 0) {
    console.log(`[RecurringExpenses] ${generated} lançamento(s) gerado(s)`);
  }
  return generated;
}
```

### Step 2: Registrar no cron.js

Abra `delivery-saas-backend/src/cron.js`. Localize onde outros jobs são importados (ex: `financialReconciliation`). Adicione:

```javascript
import { generateRecurringExpenses } from './jobs/generateRecurringExpenses.js';

// Executar uma vez no startup
generateRecurringExpenses().catch(console.error);

// Agendar para todo dia às 06:00 BRT (09:00 UTC)
cron.schedule('0 9 * * *', () => {
  generateRecurringExpenses().catch(console.error);
});
```

Se `cron.js` usa `node-cron` (`import cron from 'node-cron'`), a sintaxe acima funciona direto. Se usa outro scheduler, adaptar conforme o padrão já em uso no arquivo.

### Step 3: Testar o job manualmente

Com o servidor rodando, chamar a geração via endpoint (que chama `generateForTemplate`):

```bash
# Criar um template de teste primeiro
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  http://localhost:3000/financial/recurring \
  -d '{"description":"Aluguel Teste","grossAmount":1500,"recurrence":"MONTHLY","dayOfMonth":10,"nextDueDate":"2026-05-07"}'

# Confirmar que um FinancialTransaction foi criado com sourceType=RECURRING
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/financial/transactions?sourceType=RECURRING" | jq '.data | length'
```

Esperado: `1` (um lançamento criado).

### Step 4: Commit

```bash
git add src/jobs/generateRecurringExpenses.js src/cron.js
git commit -m "feat(jobs): add generateRecurringExpenses job with cron scheduling"
```

---

## Task 8: Frontend — FinancialRecurring.vue

**Files:**
- Create: `delivery-saas-frontend/src/views/financial/FinancialRecurring.vue`

### Step 1: Criar o componente

Crie `delivery-saas-frontend/src/views/financial/FinancialRecurring.vue`:

```vue
<template>
  <div class="container py-3">
    <div class="d-flex justify-content-between align-items-center mb-3">
      <h3>Despesas Fixas Recorrentes</h3>
      <button class="btn btn-primary" @click="openCreate">+ Nova Despesa</button>
    </div>

    <div class="card">
      <div class="table-responsive">
        <table class="table table-hover mb-0">
          <thead class="table-light">
            <tr>
              <th>Descrição</th>
              <th>Valor</th>
              <th>Periodicidade</th>
              <th>Próximo Vencimento</th>
              <th>Centro de Custo</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in items" :key="item.id" :class="{'table-secondary opacity-50': !item.isActive}">
              <td>
                <div>{{ item.description }}</div>
                <small class="text-muted" v-if="item.supplier">{{ item.supplier.name }}</small>
              </td>
              <td>{{ fmt(item.grossAmount) }}</td>
              <td>{{ recurrenceLabel(item.recurrence) }}</td>
              <td>
                <span :class="dueBadge(item.nextDueDate)">{{ formatDate(item.nextDueDate) }}</span>
              </td>
              <td>
                <small v-if="item.costCenter">{{ item.costCenter.code }} — {{ item.costCenter.name }}</small>
                <small v-else class="text-muted">—</small>
              </td>
              <td>
                <span :class="item.isActive ? 'badge bg-success' : 'badge bg-secondary'">
                  {{ item.isActive ? 'Ativo' : 'Inativo' }}
                </span>
              </td>
              <td class="text-end">
                <div class="btn-group btn-group-sm">
                  <button class="btn btn-outline-primary" @click="openEdit(item)"><i class="bi-pencil"></i></button>
                  <button class="btn btn-outline-success" title="Gerar agora" @click="generateNow(item)"><i class="bi-lightning"></i></button>
                  <button v-if="item.isActive" class="btn btn-outline-danger" @click="deactivate(item)"><i class="bi-x-lg"></i></button>
                </div>
              </td>
            </tr>
            <tr v-if="items.length === 0">
              <td colspan="7" class="text-center py-4 text-muted">Nenhuma despesa recorrente cadastrada.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Modal criar/editar -->
    <div v-if="showForm" class="modal d-block" tabindex="-1" style="background:rgba(0,0,0,0.5)">
      <div class="modal-dialog">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">{{ form.id ? 'Editar' : 'Nova' }} Despesa Recorrente</h5>
            <button type="button" class="btn-close" @click="showForm = false"></button>
          </div>
          <div class="modal-body">
            <div class="row g-3">
              <div class="col-12">
                <label class="form-label">Descrição *</label>
                <TextInput v-model="form.description" placeholder="Ex: Aluguel do espaço" />
              </div>
              <div class="col-md-6">
                <label class="form-label">Valor (R$) *</label>
                <input type="number" class="form-control" v-model.number="form.grossAmount" step="0.01" min="0">
              </div>
              <div class="col-md-6">
                <label class="form-label">Periodicidade *</label>
                <SelectInput v-model="form.recurrence" :options="recurrenceOptions" />
              </div>
              <div class="col-md-6" v-if="['MONTHLY','QUARTERLY','ANNUAL'].includes(form.recurrence)">
                <label class="form-label">Dia do mês</label>
                <input type="number" class="form-control" v-model.number="form.dayOfMonth" min="1" max="28" placeholder="Ex: 10">
              </div>
              <div class="col-md-6">
                <label class="form-label">Próximo vencimento *</label>
                <input type="date" class="form-control" v-model="form.nextDueDate">
              </div>
              <div class="col-md-6">
                <label class="form-label">Conta</label>
                <SelectInput v-model="form.accountId" :options="accountOptions" optionValueKey="id" optionLabelKey="name" placeholder="Selecionar conta" />
              </div>
              <div class="col-md-6">
                <label class="form-label">Centro de Custo (Fixo)</label>
                <SelectInput v-model="form.costCenterId" :options="fixedCostCenterOptions" optionValueKey="id" optionLabelKey="label" placeholder="Selecionar" />
              </div>
              <div class="col-12">
                <label class="form-label">Observações</label>
                <textarea class="form-control" v-model="form.notes" rows="2"></textarea>
              </div>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-outline-secondary" @click="showForm = false">Cancelar</button>
            <button class="btn btn-primary" @click="save" :disabled="saving">{{ saving ? 'Salvando...' : 'Salvar' }}</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import api from '../../api';
import TextInput from '../../components/form/input/TextInput.vue';
import SelectInput from '../../components/form/select/SelectInput.vue';

export default {
  name: 'FinancialRecurring',
  components: { TextInput, SelectInput },
  data() {
    return {
      items: [],
      accounts: [],
      costCenters: [],
      showForm: false,
      saving: false,
      form: this.emptyForm(),
      recurrenceOptions: [
        { value: 'WEEKLY',    label: 'Semanal' },
        { value: 'BIWEEKLY',  label: 'Quinzenal' },
        { value: 'MONTHLY',   label: 'Mensal' },
        { value: 'QUARTERLY', label: 'Trimestral' },
        { value: 'ANNUAL',    label: 'Anual' },
      ],
    };
  },
  computed: {
    accountOptions() { return this.accounts.filter(a => a.isActive); },
    fixedCostCenterOptions() {
      return this.costCenters
        .filter(cc => cc.natureza === 'FIXA' || !cc.natureza)
        .map(cc => ({ id: cc.id, label: `${cc.code} — ${cc.name}` }));
    },
  },
  async mounted() {
    await Promise.all([this.load(), this.loadLookups()]);
  },
  methods: {
    emptyForm() {
      return { id: null, description: '', grossAmount: 0, recurrence: 'MONTHLY', dayOfMonth: null, nextDueDate: '', accountId: '', costCenterId: '', notes: '' };
    },
    async load() {
      const { data } = await api.get('/financial/recurring');
      this.items = data;
    },
    async loadLookups() {
      const [acc, cc] = await Promise.all([
        api.get('/financial/accounts'),
        api.get('/financial/cost-centers', { params: { flat: 'true' } }),
      ]);
      this.accounts = acc.data;
      this.costCenters = cc.data;
    },
    openCreate() { this.form = this.emptyForm(); this.showForm = true; },
    openEdit(item) {
      this.form = {
        id: item.id,
        description: item.description,
        grossAmount: Number(item.grossAmount),
        recurrence: item.recurrence,
        dayOfMonth: item.dayOfMonth || null,
        nextDueDate: item.nextDueDate ? item.nextDueDate.slice(0, 10) : '',
        accountId: item.accountId || '',
        costCenterId: item.costCenterId || '',
        notes: item.notes || '',
      };
      this.showForm = true;
    },
    async save() {
      if (!this.form.description || !this.form.grossAmount || !this.form.nextDueDate) {
        alert('Preencha descrição, valor e próximo vencimento');
        return;
      }
      this.saving = true;
      try {
        if (this.form.id) {
          await api.put(`/financial/recurring/${this.form.id}`, this.form);
        } else {
          await api.post('/financial/recurring', this.form);
        }
        this.showForm = false;
        await this.load();
      } catch (e) {
        alert(e.response?.data?.message || 'Erro ao salvar');
      } finally {
        this.saving = false;
      }
    },
    async deactivate(item) {
      if (!confirm(`Desativar "${item.description}"?`)) return;
      await api.delete(`/financial/recurring/${item.id}`);
      await this.load();
    },
    async generateNow(item) {
      try {
        await api.post(`/financial/recurring/${item.id}/generate`);
        alert('Lançamento gerado com sucesso!');
        await this.load();
      } catch (e) {
        alert(e.response?.data?.message || 'Erro ao gerar lançamento');
      }
    },
    recurrenceLabel(r) {
      const m = { WEEKLY: 'Semanal', BIWEEKLY: 'Quinzenal', MONTHLY: 'Mensal', QUARTERLY: 'Trimestral', ANNUAL: 'Anual' };
      return m[r] || r;
    },
    dueBadge(date) {
      if (!date) return 'badge bg-secondary';
      const d = new Date(date);
      const today = new Date();
      const diff = (d - today) / (1000 * 60 * 60 * 24);
      if (diff < 0) return 'badge bg-danger';
      if (diff <= 7) return 'badge bg-warning text-dark';
      return 'badge bg-success';
    },
    fmt(v) { return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0); },
    formatDate(d) { return d ? new Date(d).toLocaleDateString('pt-BR') : '—'; },
  },
};
</script>
```

### Step 2: Verificar no browser

Criar uma despesa recorrente pelo modal e confirmar que aparece na tabela com o badge de vencimento correto.

### Step 3: Commit

```bash
git add src/views/financial/FinancialRecurring.vue
git commit -m "feat(frontend): add FinancialRecurring.vue for recurring expense management"
```

---

## Task 9: Frontend — rota + navegação

**Files:**
- Modify: `delivery-saas-frontend/src/router.js`
- Modify: `delivery-saas-frontend/src/config/nav.js`

### Step 1: Adicionar rota no router.js

Localize o bloco de rotas financeiras. Após a rota de `cost-centers`, adicione:

```javascript
{
  path: '/financial/recurring',
  name: 'FinancialRecurring',
  component: () => import('@/views/financial/FinancialRecurring.vue'),
  meta: { requiresAuth: true, role: 'ADMIN', requiresModule: 'FINANCIAL' }
},
```

Se o arquivo usa um mapa de títulos de página (objeto com `['/financial/recurring', 'Título']`), adicione:
```javascript
['/financial/recurring', 'Despesas Fixas'],
```

### Step 2: Adicionar item na sidebar (nav.js)

Localize o array `children` do item "Financeiro" em `src/config/nav.js`. Adicione após "Contas a Pagar/Receber":

```javascript
{ name: 'Despesas Fixas', to: '/financial/recurring', icon: 'bi bi-arrow-repeat' },
```

### Step 3: Verificar no browser

Recarregar a aplicação, confirmar que o item "Despesas Fixas" aparece no menu lateral e que a rota `/financial/recurring` carrega a view corretamente.

### Step 4: Commit final

```bash
git add src/router.js src/config/nav.js
git commit -m "feat(nav): add Despesas Fixas route and sidebar entry"
```

---

## Resumo de Commits

```
feat(schema): add natureza to CostCenter and RecurringExpense model
feat(cost-centers): add natureza field to seed and PUT endpoint
feat(frontend): add natureza column to cost centers table
feat(dre): restructure to custeio variavel with margemContribuicao and pontoEquilibrio
feat(frontend): update DRE to custeio variavel with MC and break-even
feat(recurring): add CRUD endpoints for recurring expenses
feat(jobs): add generateRecurringExpenses job with cron scheduling
feat(frontend): add FinancialRecurring.vue for recurring expense management
feat(nav): add Despesas Fixas route and sidebar entry
```

## Ordem de implementação

Seguir a ordem das tasks (1→9) pois cada uma depende da anterior:
- Task 1 (schema) precede tudo
- Task 2 precede Task 3 (PUT backend antes do frontend)
- Task 4 (DRE backend) precede Task 5 (DRE frontend)
- Task 6 (CRUD recurring) precede Tasks 7 e 8
- Task 9 pode ser feita junto com Task 8
