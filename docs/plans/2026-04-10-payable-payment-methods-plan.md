# Contas a Pagar — Formas de Pagamento e Parcelamento — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Cadastro de formas de pagamento da empresa (cartão de crédito com regras de fatura, boleto parcelado, PIX, dinheiro, transferência) com geração automática de parcelas editáveis e resumo de fatura no dashboard.

**Architecture:** Novo modelo PayablePaymentMethod com regras de cartão (closingDay/dueDay). POST /financial/transactions expandido para gerar parcelas automaticamente com preview. Novo endpoint de fatura agrupa parcelas por cartão/mês para baixa em lote.

**Tech Stack:** Prisma ORM, Express.js, Vue 3 (Options API) + Bootstrap 5

**Design doc:** `docs/plans/2026-04-10-payable-payment-methods-design.md`

---

## Task 1: Schema — PayablePaymentMethod + FK na FinancialTransaction

**Files:**
- Modify: `delivery-saas-backend/prisma/schema.prisma`

**Step 1: Criar enum PayableMethodType**

Após o enum `RecurrenceType` (aproximadamente linha 1594), adicionar:

```prisma
enum PayableMethodType {
  CREDIT_CARD
  BOLETO
  PIX
  DINHEIRO
  TRANSFERENCIA
}
```

**Step 2: Criar modelo PayablePaymentMethod**

Após o modelo `PaymentGatewayConfig`, adicionar:

```prisma
model PayablePaymentMethod {
  id          String             @id @default(uuid())
  companyId   String
  company     Company            @relation(fields: [companyId], references: [id])
  name        String             // Ex: "Visa Itaú", "Bradesco Boleto"
  type        PayableMethodType
  isActive    Boolean            @default(true)

  // Específico de cartão de crédito
  closingDay  Int?               // Dia do fechamento da fatura (1-31)
  dueDay      Int?               // Dia do vencimento/pagamento (1-31)
  cardBrand   String?            // Visa, Mastercard, Elo, etc.
  lastDigits  String?            // Últimos 4 dígitos
  creditLimit Decimal?           // Limite do cartão

  // Conta financeira padrão para baixa
  accountId   String?
  account     FinancialAccount?  @relation(fields: [accountId], references: [id])

  // Relações
  transactions FinancialTransaction[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([companyId, isActive], name: "idx_payable_method_company")
}
```

**Step 3: Adicionar FK no FinancialTransaction**

No modelo `FinancialTransaction`, após a linha de `metadata` (aprox. 1748), adicionar:

```prisma
  // Forma de pagamento (contas a pagar)
  payablePaymentMethodId String?
  payablePaymentMethod   PayablePaymentMethod? @relation(fields: [payablePaymentMethodId], references: [id])
```

**Step 4: Adicionar relação inversa no Company**

No modelo `Company`, adicionar:

```prisma
  payablePaymentMethods PayablePaymentMethod[]
```

**Step 5: Adicionar relação inversa no FinancialAccount**

No modelo `FinancialAccount`, adicionar (se não existir):

```prisma
  payablePaymentMethods PayablePaymentMethod[]
```

**Step 6: Commit**

```bash
git add delivery-saas-backend/prisma/schema.prisma
git commit -m "feat(schema): add PayablePaymentMethod model and FK on FinancialTransaction"
```

---

## Task 2: Backend — CRUD de formas de pagamento

**Files:**
- Create: `delivery-saas-backend/src/routes/financial/paymentMethods.js`
- Modify: `delivery-saas-backend/src/routes/financial/index.js`

**Step 1: Criar rota CRUD**

```javascript
// delivery-saas-backend/src/routes/financial/paymentMethods.js
import express from 'express';
import { prisma } from '../../prisma.js';

const router = express.Router();

// GET /financial/payment-methods
router.get('/', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { activeOnly } = req.query;
    const where = { companyId };
    if (activeOnly === 'true') where.isActive = true;

    const methods = await prisma.payablePaymentMethod.findMany({
      where,
      include: { account: { select: { id: true, name: true } } },
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
    });
    res.json(methods);
  } catch (e) {
    console.error('GET /financial/payment-methods error:', e);
    res.status(500).json({ message: 'Erro ao listar formas de pagamento', error: e?.message });
  }
});

// POST /financial/payment-methods
router.post('/', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { name, type, closingDay, dueDay, cardBrand, lastDigits, creditLimit, accountId } = req.body;

    if (!name || !type) {
      return res.status(400).json({ message: 'name e type são obrigatórios' });
    }

    // Validar campos de cartão de crédito
    if (type === 'CREDIT_CARD') {
      if (!closingDay || !dueDay) {
        return res.status(400).json({ message: 'closingDay e dueDay são obrigatórios para cartão de crédito' });
      }
      if (closingDay < 1 || closingDay > 31 || dueDay < 1 || dueDay > 31) {
        return res.status(400).json({ message: 'closingDay e dueDay devem estar entre 1 e 31' });
      }
    }

    const method = await prisma.payablePaymentMethod.create({
      data: {
        companyId,
        name,
        type,
        closingDay: type === 'CREDIT_CARD' ? closingDay : null,
        dueDay: type === 'CREDIT_CARD' ? dueDay : null,
        cardBrand: cardBrand || null,
        lastDigits: lastDigits || null,
        creditLimit: creditLimit ? Number(creditLimit) : null,
        accountId: accountId || null,
      },
      include: { account: { select: { id: true, name: true } } },
    });
    res.status(201).json(method);
  } catch (e) {
    console.error('POST /financial/payment-methods error:', e);
    res.status(500).json({ message: 'Erro ao criar forma de pagamento', error: e?.message });
  }
});

// PUT /financial/payment-methods/:id
router.put('/:id', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const existing = await prisma.payablePaymentMethod.findFirst({
      where: { id: req.params.id, companyId },
    });
    if (!existing) return res.status(404).json({ message: 'Forma de pagamento não encontrada' });

    const { name, closingDay, dueDay, cardBrand, lastDigits, creditLimit, accountId, isActive } = req.body;
    const data = {};
    if (name !== undefined) data.name = name;
    if (closingDay !== undefined) data.closingDay = closingDay;
    if (dueDay !== undefined) data.dueDay = dueDay;
    if (cardBrand !== undefined) data.cardBrand = cardBrand;
    if (lastDigits !== undefined) data.lastDigits = lastDigits;
    if (creditLimit !== undefined) data.creditLimit = creditLimit ? Number(creditLimit) : null;
    if (accountId !== undefined) data.accountId = accountId || null;
    if (isActive !== undefined) data.isActive = isActive;

    const updated = await prisma.payablePaymentMethod.update({
      where: { id: req.params.id },
      data,
      include: { account: { select: { id: true, name: true } } },
    });
    res.json(updated);
  } catch (e) {
    console.error('PUT /financial/payment-methods error:', e);
    res.status(500).json({ message: 'Erro ao atualizar', error: e?.message });
  }
});

// DELETE /financial/payment-methods/:id (soft delete)
router.delete('/:id', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    await prisma.payablePaymentMethod.updateMany({
      where: { id: req.params.id, companyId },
      data: { isActive: false },
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ message: 'Erro ao desativar', error: e?.message });
  }
});

export default router;
```

**Step 2: Registrar no index.js**

Em `delivery-saas-backend/src/routes/financial/index.js`, adicionar:

```javascript
import paymentMethodsRouter from './paymentMethods.js';
// ...
financialRouter.use('/payment-methods', paymentMethodsRouter);
```

**Step 3: Commit**

```bash
git add delivery-saas-backend/src/routes/financial/paymentMethods.js delivery-saas-backend/src/routes/financial/index.js
git commit -m "feat(financial): CRUD for payable payment methods (credit card, boleto, PIX, etc.)"
```

---

## Task 3: Backend — Helper de cálculo de datas de parcelas

**Files:**
- Create: `delivery-saas-backend/src/services/financial/installmentCalculator.js`

**Step 1: Criar o helper**

```javascript
// delivery-saas-backend/src/services/financial/installmentCalculator.js

/**
 * Calcula datas de vencimento de parcelas de cartão de crédito.
 *
 * Regra: se purchaseDate < closingDay do mês, a primeira parcela vence no dueDay do mesmo mês.
 *        se purchaseDate >= closingDay, a primeira parcela vence no dueDay do mês seguinte.
 *        Parcelas seguintes: +1 mês cada.
 *
 * @param {Date} purchaseDate - data da compra
 * @param {number} closingDay - dia do fechamento da fatura (1-31)
 * @param {number} dueDay - dia do vencimento (1-31)
 * @param {number} installmentCount - número de parcelas
 * @returns {{ installments: Array<{ number: number, dueDate: Date }> }}
 */
export function calculateCreditCardInstallments(purchaseDate, closingDay, dueDay, installmentCount) {
  const purchase = new Date(purchaseDate);
  const purchaseDayOfMonth = purchase.getDate();

  // Determinar mês base da primeira parcela
  let baseMonth = purchase.getMonth();
  let baseYear = purchase.getFullYear();

  if (purchaseDayOfMonth >= closingDay) {
    // Compra no dia do fechamento ou depois → próximo ciclo
    baseMonth += 1;
    if (baseMonth > 11) {
      baseMonth = 0;
      baseYear += 1;
    }
  }

  const installments = [];
  for (let i = 0; i < installmentCount; i++) {
    let month = baseMonth + i;
    let year = baseYear;
    while (month > 11) {
      month -= 12;
      year += 1;
    }

    // Ajustar dia para meses com menos de 31 dias
    const lastDayOfMonth = new Date(year, month + 1, 0).getDate();
    const day = Math.min(dueDay, lastDayOfMonth);

    installments.push({
      number: i + 1,
      dueDate: new Date(year, month, day),
    });
  }

  return { installments };
}

/**
 * Calcula datas de vencimento de parcelas de boleto com templates de intervalo.
 *
 * @param {Date} purchaseDate - data da compra/emissão
 * @param {number} installmentCount - número de parcelas
 * @param {string} template - '30d' | '7_14_21' | '7_15' | 'custom'
 * @param {Date[]} [customDates] - datas manuais (para template 'custom')
 * @returns {{ installments: Array<{ number: number, dueDate: Date }> }}
 */
export function calculateBoletoInstallments(purchaseDate, installmentCount, template, customDates = []) {
  const purchase = new Date(purchaseDate);
  const installments = [];

  if (template === 'custom' && customDates.length) {
    for (let i = 0; i < customDates.length; i++) {
      installments.push({
        number: i + 1,
        dueDate: new Date(customDates[i]),
      });
    }
    return { installments };
  }

  // Templates predefinidos: intervalos em dias entre parcelas
  const intervalMaps = {
    '30d': () => Array.from({ length: installmentCount }, (_, i) => (i + 1) * 30),
    '7_14_21': () => Array.from({ length: installmentCount }, (_, i) => (i + 1) * 7),
    '7_15': () => {
      const days = [];
      let acc = 0;
      for (let i = 0; i < installmentCount; i++) {
        acc += i % 2 === 0 ? 7 : 15;
        days.push(acc);
      }
      return days;
    },
  };

  const daysFn = intervalMaps[template] || intervalMaps['30d'];
  const daysArray = daysFn();

  for (let i = 0; i < installmentCount; i++) {
    const dueDate = new Date(purchase);
    dueDate.setDate(dueDate.getDate() + daysArray[i]);
    installments.push({
      number: i + 1,
      dueDate,
    });
  }

  return { installments };
}

/**
 * Calcula parcelas genérico — delega para o tipo correto.
 */
export function calculateInstallmentDates(method, purchaseDate, installmentCount, template, customDates) {
  if (method.type === 'CREDIT_CARD') {
    return calculateCreditCardInstallments(purchaseDate, method.closingDay, method.dueDay, installmentCount);
  }
  if (method.type === 'BOLETO') {
    return calculateBoletoInstallments(purchaseDate, installmentCount, template || '30d', customDates);
  }
  // PIX, DINHEIRO, TRANSFERENCIA → 1 parcela à vista
  return {
    installments: [{
      number: 1,
      dueDate: new Date(purchaseDate),
    }],
  };
}
```

**Step 2: Commit**

```bash
git add delivery-saas-backend/src/services/financial/installmentCalculator.js
git commit -m "feat(financial): installment date calculator for credit card (closing/due day) and boleto templates"
```

---

## Task 4: Backend — Endpoint de criação de transação com parcelas

**Files:**
- Modify: `delivery-saas-backend/src/routes/financial/transactions.js:78-136`

**Step 1: Adicionar endpoint de preview de parcelas**

Adicionar ANTES do POST / existente:

```javascript
// POST /financial/transactions/preview-installments — calcular preview de parcelas
router.post('/preview-installments', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { payablePaymentMethodId, purchaseDate, grossAmount, installmentCount, template, customDates } = req.body;

    if (!payablePaymentMethodId || !purchaseDate || !grossAmount || !installmentCount) {
      return res.status(400).json({ message: 'payablePaymentMethodId, purchaseDate, grossAmount e installmentCount são obrigatórios' });
    }

    const method = await prisma.payablePaymentMethod.findFirst({
      where: { id: payablePaymentMethodId, companyId },
    });
    if (!method) return res.status(404).json({ message: 'Forma de pagamento não encontrada' });

    const { calculateInstallmentDates } = await import('../../services/financial/installmentCalculator.js');
    const { installments } = calculateInstallmentDates(method, new Date(purchaseDate), installmentCount, template, customDates);

    const amountPerInstallment = Math.round((Number(grossAmount) / installmentCount) * 100) / 100;
    const remainder = Math.round((Number(grossAmount) - amountPerInstallment * installmentCount) * 100) / 100;

    const preview = installments.map((inst, idx) => ({
      number: inst.number,
      totalInstallments: installmentCount,
      dueDate: inst.dueDate.toISOString().split('T')[0],
      amount: idx === 0 ? amountPerInstallment + remainder : amountPerInstallment,
    }));

    res.json({ method, preview });
  } catch (e) {
    console.error('POST /financial/transactions/preview-installments error:', e);
    res.status(500).json({ message: 'Erro ao calcular parcelas', error: e?.message });
  }
});
```

**Step 2: Expandir POST / para aceitar parcelas**

Substituir o POST / existente (linhas 78-136) para aceitar opcionalmente `installments` (array editado pelo admin):

```javascript
// POST /financial/transactions - criar título financeiro (com suporte a parcelas)
router.post('/', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const {
      type, description, accountId, costCenterId, gatewayConfigId,
      grossAmount, dueDate, sourceType, sourceId, notes,
      recurrence, installmentNumber, totalInstallments, parentTransactionId,
      // Novos campos para parcelamento
      payablePaymentMethodId, installments,
    } = req.body;

    if (!type || !description || !grossAmount) {
      return res.status(400).json({ message: 'type, description e grossAmount são obrigatórios' });
    }

    // Calcular taxas se gatewayConfigId fornecido
    let feeAmount = 0;
    let netAmount = Number(grossAmount);
    let expectedDate = null;

    if (gatewayConfigId) {
      const result = await calculateFees(gatewayConfigId, Number(grossAmount), new Date(dueDate || new Date()));
      feeAmount = result.feeAmount;
      netAmount = result.netAmount;
      expectedDate = result.expectedDate;
    }

    // Se tem array de parcelas editadas → criar mãe + filhas
    if (Array.isArray(installments) && installments.length > 1) {
      const result = await prisma.$transaction(async (tx) => {
        // Criar transação mãe (agrupadora)
        const parent = await tx.financialTransaction.create({
          data: {
            companyId,
            type,
            status: 'CONFIRMED',
            description,
            accountId: accountId || null,
            costCenterId: costCenterId || null,
            gatewayConfigId: gatewayConfigId || null,
            grossAmount: Number(grossAmount),
            feeAmount,
            netAmount,
            dueDate: new Date(installments[0].dueDate),
            expectedDate,
            sourceType: sourceType || 'MANUAL',
            sourceId: sourceId || null,
            notes: notes || null,
            recurrence: 'MONTHLY',
            totalInstallments: installments.length,
            payablePaymentMethodId: payablePaymentMethodId || null,
            createdBy: req.user.id,
          },
        });

        // Criar parcelas filhas
        const children = [];
        for (const inst of installments) {
          const child = await tx.financialTransaction.create({
            data: {
              companyId,
              type,
              status: 'PENDING',
              description: `${description} (${inst.number}/${installments.length})`,
              accountId: accountId || null,
              costCenterId: costCenterId || null,
              grossAmount: Number(inst.amount),
              feeAmount: 0,
              netAmount: Number(inst.amount),
              dueDate: new Date(inst.dueDate),
              sourceType: sourceType || 'MANUAL',
              sourceId: sourceId || null,
              recurrence: 'MONTHLY',
              installmentNumber: inst.number,
              totalInstallments: installments.length,
              parentTransactionId: parent.id,
              payablePaymentMethodId: payablePaymentMethodId || null,
              createdBy: req.user.id,
            },
          });
          children.push(child);
        }

        return { parent, children };
      });

      return res.status(201).json(result);
    }

    // Criação simples (sem parcelas ou 1x)
    if (!dueDate) {
      return res.status(400).json({ message: 'dueDate é obrigatório para lançamento avulso' });
    }

    const tx = await prisma.financialTransaction.create({
      data: {
        companyId,
        type,
        description,
        accountId: accountId || null,
        costCenterId: costCenterId || null,
        gatewayConfigId: gatewayConfigId || null,
        grossAmount: Number(grossAmount),
        feeAmount,
        netAmount,
        dueDate: new Date(dueDate),
        expectedDate,
        sourceType: sourceType || 'MANUAL',
        sourceId: sourceId || null,
        notes: notes || null,
        recurrence: recurrence || 'NONE',
        installmentNumber: installmentNumber || null,
        totalInstallments: totalInstallments || null,
        parentTransactionId: parentTransactionId || null,
        payablePaymentMethodId: payablePaymentMethodId || null,
        createdBy: req.user.id,
      },
      include: {
        account: { select: { id: true, name: true } },
        costCenter: { select: { id: true, code: true, name: true } },
      },
    });
    res.status(201).json(tx);
  } catch (e) {
    console.error('POST /financial/transactions error:', e);
    res.status(500).json({ message: 'Erro ao criar transação', error: e?.message });
  }
});
```

**Step 3: Commit**

```bash
git add delivery-saas-backend/src/routes/financial/transactions.js
git commit -m "feat(financial): installment preview endpoint + auto-create parent+child transactions"
```

---

## Task 5: Backend — Endpoints de fatura (resumo + pagar)

**Files:**
- Create: `delivery-saas-backend/src/routes/financial/invoices.js`
- Modify: `delivery-saas-backend/src/routes/financial/index.js`

**Step 1: Criar rotas de fatura**

```javascript
// delivery-saas-backend/src/routes/financial/invoices.js
import express from 'express';
import { prisma } from '../../prisma.js';

const router = express.Router();

// GET /financial/invoices/summary — resumo de faturas por cartão de crédito
router.get('/summary', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { month } = req.query; // formato YYYY-MM, default mês atual

    const now = new Date();
    let year, mon;
    if (month) {
      [year, mon] = month.split('-').map(Number);
    } else {
      year = now.getFullYear();
      mon = now.getMonth() + 1;
    }
    const from = new Date(year, mon - 1, 1);
    const to = new Date(year, mon, 0, 23, 59, 59);

    // Buscar todos os cartões de crédito ativos
    const cards = await prisma.payablePaymentMethod.findMany({
      where: { companyId, type: 'CREDIT_CARD', isActive: true },
      include: { account: { select: { id: true, name: true } } },
    });

    const summaries = [];
    for (const card of cards) {
      const parcelas = await prisma.financialTransaction.findMany({
        where: {
          companyId,
          payablePaymentMethodId: card.id,
          type: 'PAYABLE',
          status: { in: ['PENDING', 'CONFIRMED', 'OVERDUE'] },
          dueDate: { gte: from, lte: to },
          parentTransactionId: { not: null }, // só parcelas filhas
        },
        orderBy: { dueDate: 'asc' },
        select: {
          id: true, description: true, grossAmount: true,
          dueDate: true, status: true, installmentNumber: true, totalInstallments: true,
        },
      });

      const total = parcelas.reduce((sum, p) => sum + Number(p.grossAmount), 0);

      summaries.push({
        card: {
          id: card.id,
          name: card.name,
          cardBrand: card.cardBrand,
          lastDigits: card.lastDigits,
          dueDay: card.dueDay,
          accountId: card.accountId,
        },
        month: `${year}-${String(mon).padStart(2, '0')}`,
        dueDate: new Date(year, mon - 1, Math.min(card.dueDay, to.getDate())),
        parcelasCount: parcelas.length,
        total,
        parcelas,
      });
    }

    res.json(summaries);
  } catch (e) {
    console.error('GET /financial/invoices/summary error:', e);
    res.status(500).json({ message: 'Erro ao gerar resumo de faturas', error: e?.message });
  }
});

// POST /financial/invoices/pay — pagar fatura inteira (todas parcelas de um cartão no mês)
router.post('/pay', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { payablePaymentMethodId, month, accountId } = req.body;

    if (!payablePaymentMethodId || !month) {
      return res.status(400).json({ message: 'payablePaymentMethodId e month são obrigatórios' });
    }

    const [year, mon] = month.split('-').map(Number);
    const from = new Date(year, mon - 1, 1);
    const to = new Date(year, mon, 0, 23, 59, 59);

    // Buscar método e conta de destino
    const method = await prisma.payablePaymentMethod.findFirst({
      where: { id: payablePaymentMethodId, companyId },
    });
    if (!method) return res.status(404).json({ message: 'Forma de pagamento não encontrada' });

    const targetAccountId = accountId || method.accountId;
    if (!targetAccountId) {
      return res.status(400).json({ message: 'accountId é obrigatório (nenhuma conta padrão configurada no cartão)' });
    }

    // Buscar parcelas pendentes do mês
    const parcelas = await prisma.financialTransaction.findMany({
      where: {
        companyId,
        payablePaymentMethodId,
        type: 'PAYABLE',
        status: { in: ['PENDING', 'CONFIRMED', 'OVERDUE'] },
        dueDate: { gte: from, lte: to },
        parentTransactionId: { not: null },
      },
    });

    if (parcelas.length === 0) {
      return res.status(400).json({ message: 'Nenhuma parcela pendente neste mês' });
    }

    const totalAmount = parcelas.reduce((sum, p) => sum + Number(p.grossAmount), 0);
    const now = new Date();

    const result = await prisma.$transaction(async (tx) => {
      // Atualizar saldo da conta
      const account = await tx.financialAccount.update({
        where: { id: targetAccountId },
        data: { currentBalance: { decrement: totalAmount } },
      });

      // Criar CashFlowEntry única para a fatura inteira
      const entry = await tx.cashFlowEntry.create({
        data: {
          companyId,
          accountId: targetAccountId,
          type: 'OUTFLOW',
          amount: totalAmount,
          balanceAfter: account.currentBalance,
          entryDate: now,
          description: `Fatura ${method.name} - ${month}`,
          createdBy: req.user.id,
        },
      });

      // Dar baixa em cada parcela
      for (const parcela of parcelas) {
        await tx.financialTransaction.update({
          where: { id: parcela.id },
          data: {
            status: 'PAID',
            paidAt: now,
            paidAmount: parcela.grossAmount,
            accountId: targetAccountId,
            updatedBy: req.user.id,
          },
        });
      }

      return { entry, paidCount: parcelas.length, totalAmount };
    });

    res.json(result);
  } catch (e) {
    console.error('POST /financial/invoices/pay error:', e);
    res.status(500).json({ message: 'Erro ao pagar fatura', error: e?.message });
  }
});

export default router;
```

**Step 2: Registrar no index.js**

```javascript
import invoicesRouter from './invoices.js';
// ...
financialRouter.use('/invoices', invoicesRouter);
```

**Step 3: Commit**

```bash
git add delivery-saas-backend/src/routes/financial/invoices.js delivery-saas-backend/src/routes/financial/index.js
git commit -m "feat(financial): invoice summary by credit card + pay entire invoice endpoint"
```

---

## Task 6: Frontend — Tela de cadastro de formas de pagamento

**Files:**
- Create: `delivery-saas-frontend/src/views/financial/PayablePaymentMethods.vue`
- Modify: `delivery-saas-frontend/src/router.js`

**Step 1: Criar a view**

Use Vue 3 Options API com Bootstrap 5. A tela deve ter:

- Lista de formas de pagamento (tabela com nome, tipo, status, ações)
- Modal de criação/edição com:
  - Nome (TextInput)
  - Tipo (SelectInput: Cartão de Crédito, Boleto, PIX, Dinheiro, Transferência)
  - Se tipo = CREDIT_CARD: campos de closingDay, dueDay (inputs numéricos 1-31), cardBrand, lastDigits, creditLimit
  - Conta financeira padrão (SelectInput com contas ativas)
- Botão de ativar/desativar

Template de referência: seguir o padrão de `FinancialAccounts.vue` e `FinancialGateways.vue` (Options API, Bootstrap 5, api import).

**Step 2: Adicionar rota ao router**

Em `delivery-saas-frontend/src/router.js`, adicionar dentro das rotas `/financial/*`:

```javascript
{
  path: '/financial/payment-methods',
  name: 'FinancialPaymentMethods',
  component: () => import('./views/financial/PayablePaymentMethods.vue'),
  meta: { requiresAuth: true, role: 'ADMIN', requiresModule: 'FINANCIAL' },
},
```

**Step 3: Adicionar link na sidebar/nav**

Verificar onde os links de navegação financeira são definidos e adicionar "Formas de Pagamento".

**Step 4: Commit**

```bash
git add delivery-saas-frontend/src/views/financial/PayablePaymentMethods.vue delivery-saas-frontend/src/router.js
git commit -m "feat(financial-ui): payable payment methods CRUD view with credit card rules"
```

---

## Task 7: Frontend — Modal de criação de transação com parcelas

**Files:**
- Modify: `delivery-saas-frontend/src/views/financial/FinancialTransactions.vue`

**Step 1: Expandir o modal de criação**

Adicionar ao formulário existente (após os campos atuais):

- **Forma de pagamento** (SelectInput com PayablePaymentMethods, carregado via `GET /financial/payment-methods?activeOnly=true`)
- **Data da compra/emissão** (input date — aparece quando forma de pagamento selecionada)
- **Parcelas** (SelectInput com opções 1x a 24x — aparece quando tipo = CREDIT_CARD ou BOLETO)
- **Template de intervalo** (SelectInput: 30 dias, 7/14/21, 7/15, Personalizado — aparece só quando tipo = BOLETO e parcelas > 1)
- **Preview de parcelas** (tabela editável — aparece após calcular)

**Step 2: Lógica de preview**

Quando o admin seleciona forma de pagamento + parcelas + data, fazer:

```javascript
async previewInstallments() {
  const { data } = await api.post('/financial/transactions/preview-installments', {
    payablePaymentMethodId: this.form.payablePaymentMethodId,
    purchaseDate: this.form.purchaseDate,
    grossAmount: this.form.grossAmount,
    installmentCount: this.form.installmentCount,
    template: this.form.boletoTemplate,
  });
  this.installmentPreview = data.preview;
},
```

**Step 3: Preview editável no template**

```html
<div v-if="installmentPreview.length > 1" class="mt-3">
  <h6>Parcelas</h6>
  <table class="table table-sm">
    <thead><tr><th>Parcela</th><th>Valor</th><th>Vencimento</th></tr></thead>
    <tbody>
      <tr v-for="inst in installmentPreview" :key="inst.number">
        <td>{{ inst.number }}/{{ inst.totalInstallments }}</td>
        <td><input type="number" class="form-control form-control-sm" v-model.number="inst.amount" step="0.01"></td>
        <td><input type="date" class="form-control form-control-sm" v-model="inst.dueDate"></td>
      </tr>
    </tbody>
  </table>
</div>
```

**Step 4: Enviar parcelas editadas no submit**

```javascript
async createTransaction() {
  const payload = { ...this.form };
  if (this.installmentPreview.length > 1) {
    payload.installments = this.installmentPreview;
  }
  await api.post('/financial/transactions', payload);
  // ...
},
```

**Step 5: Commit**

```bash
git add delivery-saas-frontend/src/views/financial/FinancialTransactions.vue
git commit -m "feat(financial-ui): installment creation with preview, edit amounts/dates before confirming"
```

---

## Task 8: Frontend — Cards de fatura no dashboard

**Files:**
- Modify: `delivery-saas-frontend/src/views/financial/FinancialDashboard.vue`

**Step 1: Carregar resumo de faturas**

```javascript
async loadInvoices() {
  try {
    const { data } = await api.get('/financial/invoices/summary');
    this.invoiceSummaries = data;
  } catch (e) { console.error(e); }
},
```

**Step 2: Adicionar cards de fatura no template**

Após os cards de summary existentes:

```html
<div v-for="inv in invoiceSummaries" :key="inv.card.id" class="card mb-3">
  <div class="card-body">
    <div class="d-flex justify-content-between align-items-center">
      <div>
        <h6 class="mb-0">{{ inv.card.name }}{{ inv.card.lastDigits ? ` (final ${inv.card.lastDigits})` : '' }}</h6>
        <small class="text-muted">Fatura {{ inv.month }} · vence dia {{ inv.card.dueDay }}</small>
      </div>
      <div class="text-end">
        <div class="fs-5 fw-bold">{{ formatCurrency(inv.total) }}</div>
        <small class="text-muted">{{ inv.parcelasCount }} parcela{{ inv.parcelasCount !== 1 ? 's' : '' }}</small>
      </div>
    </div>
    <div class="mt-2 d-flex gap-2" v-if="inv.parcelasCount > 0">
      <button class="btn btn-sm btn-outline-primary" @click="showInvoiceDetail(inv)">Ver detalhes</button>
      <button class="btn btn-sm btn-success" @click="payInvoice(inv)">Pagar fatura</button>
    </div>
  </div>
</div>
```

**Step 3: Handler de "Pagar fatura"**

```javascript
async payInvoice(inv) {
  if (!confirm(`Pagar fatura ${inv.card.name} de ${this.formatCurrency(inv.total)} (${inv.parcelasCount} parcelas)?`)) return;
  try {
    await api.post('/financial/invoices/pay', {
      payablePaymentMethodId: inv.card.id,
      month: inv.month,
      accountId: inv.card.accountId,
    });
    await this.loadInvoices();
    await this.loadAll();
  } catch (e) {
    alert(e.response?.data?.message || 'Erro ao pagar fatura');
  }
},
```

**Step 4: Handler de "Ver detalhes"**

Abre modal/Swal com a lista de parcelas da fatura, cada uma com botão de pagar individual (reutilizando o endpoint `POST /financial/transactions/:id/pay`).

**Step 5: Commit**

```bash
git add delivery-saas-frontend/src/views/financial/FinancialDashboard.vue
git commit -m "feat(financial-ui): credit card invoice summary cards with pay-all and detail view"
```

---

## Task 9: Prisma push + testes manuais

**Step 1: Aplicar schema**

```bash
cd delivery-saas-backend
npx prisma db push
npx prisma generate
```

**Step 2: Testar fluxo completo**

1. Criar forma de pagamento "Visa Itaú" (CREDIT_CARD, closingDay=8, dueDay=20)
2. Criar conta a pagar "Insumos R$1200" em 3x no Visa Itaú
3. Verificar preview de parcelas (datas corretas pela regra de fechamento)
4. Editar valor de uma parcela e confirmar
5. Ver card de fatura no dashboard
6. Pagar fatura inteira
7. Verificar que todas parcelas ficaram PAID

**Step 3: Commit**

```bash
git add -A
git commit -m "chore: prisma generate after payable payment methods schema"
```

---

## Ordem de Execução

```
Task 1  → Schema (base)
Task 2  → CRUD backend
Task 3  → Calculadora de parcelas
Task 4  → Endpoint de transação com parcelas
Task 5  → Endpoints de fatura
Task 6  → Frontend CRUD formas de pagamento
Task 7  → Frontend modal com parcelas
Task 8  → Frontend cards de fatura no dashboard
Task 9  → Push + testes
```
