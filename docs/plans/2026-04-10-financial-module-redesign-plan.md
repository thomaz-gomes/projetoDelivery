# Financial Module Redesign — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reestruturar o módulo financeiro para suportar múltiplos caixas por usuário, vínculo pedido↔caixa, estorno automático, auditoria de bridge, rastreabilidade por loja e conciliação bancária com IA.

**Architecture:** CashSession passa a ter dono (ownerId), operadores (N:N), canais e lojas. Order ganha cashSessionId (nullable). Cancelamento pós-CONCLUIDO reverte automaticamente todas as transações financeiras. Bridge loga em tabela de auditoria. Conciliação OFX usa match exato + OpenAI para ambíguos.

**Tech Stack:** Prisma ORM, Express.js, Socket.IO, OpenAI API, Vue 3 + Bootstrap 5

**Design doc:** `docs/plans/2026-04-10-financial-module-redesign-design.md`

---

## Task 1: Schema — Novos modelos e campos no Prisma

**Files:**
- Modify: `delivery-saas-backend/prisma/schema.prisma`

**Step 1: Adicionar campos ao CashSession (linha 1918)**

Após o campo `openedBy` (linha 1925), adicionar `ownerId`, `label`, `channels`:

```prisma
model CashSession {
  id        String  @id @default(uuid())
  companyId String
  company   Company @relation(fields: [companyId], references: [id])

  // Abertura
  openedAt      DateTime @default(now())
  openedBy      String
  openingAmount Decimal  @default(0)
  openingNote   String?

  // Responsável (único que pode fechar)
  ownerId  String
  owner    User   @relation("CashSessionOwner", fields: [ownerId], references: [id])
  // Nome descritivo do caixa
  label    String @default("Caixa")
  // Canais atendidos: ["BALCAO","IFOOD","AIQFOME","WHATSAPP"]
  channels String[] @default(["BALCAO","IFOOD","AIQFOME","WHATSAPP"])

  // Saldo corrente (atualizado por movimentos)
  currentBalance Decimal @default(0)

  // Status e fechamento
  status      CashSessionStatus @default(OPEN)
  closedAt    DateTime?
  closedBy    String?
  closingNote String?

  // Contagem cega
  blindClose Boolean @default(false)

  // Valores de fechamento (JSON por forma de pagamento)
  declaredValues Json?
  expectedValues Json?
  differences    Json?

  // Relações
  movements             CashMovement[]
  financialTransactions FinancialTransaction[]
  operators             CashSessionOperator[]
  stores                CashSessionStore[]
  orders                Order[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([companyId, status], name: "idx_cash_session_company_status")
  @@index([companyId, openedAt], name: "idx_cash_session_company_opened")
  @@index([ownerId, status], name: "idx_cash_session_owner_status")
}
```

**Step 2: Criar modelo CashSessionOperator (após CashMovement, linha 1975)**

```prisma
model CashSessionOperator {
  id            String      @id @default(uuid())
  cashSessionId String
  cashSession   CashSession @relation(fields: [cashSessionId], references: [id])
  userId        String
  user          User        @relation("CashSessionOperators", fields: [userId], references: [id])
  addedAt       DateTime    @default(now())
  addedBy       String

  @@unique([cashSessionId, userId])
  @@index([userId], name: "idx_cash_op_user")
}
```

**Step 3: Criar modelo CashSessionStore (após CashSessionOperator)**

```prisma
model CashSessionStore {
  id            String      @id @default(uuid())
  cashSessionId String
  cashSession   CashSession @relation(fields: [cashSessionId], references: [id])
  storeId       String
  store         Store       @relation(fields: [storeId], references: [id])

  @@unique([cashSessionId, storeId])
  @@index([storeId], name: "idx_cash_store_store")
}
```

**Step 4: Adicionar campos ao Order (linha 181)**

Após o campo `closedByIfoodCode` (linha 223):

```prisma
  // Vínculo com sessão de caixa
  cashSessionId String?
  cashSession   CashSession? @relation(fields: [cashSessionId], references: [id])
  outOfSession  Boolean      @default(false)
```

**Step 5: Adicionar campos ao FinancialTransaction (linha 1663)**

Após o campo `sourceId` (linha 1697):

```prisma
  // Estorno: referência à transação original revertida
  reversedTransactionId String?
  reversedTransaction   FinancialTransaction?  @relation("TransactionReversal", fields: [reversedTransactionId], references: [id])
  reversals             FinancialTransaction[] @relation("TransactionReversal")

  // Loja de origem
  storeId String?
  store   Store?  @relation(fields: [storeId], references: [id])
```

**Step 6: Adicionar storeId ao CashFlowEntry (após linha 1742)**

```prisma
  // Loja de origem
  storeId String?
  store   Store?  @relation(fields: [storeId], references: [id])
```

**Step 7: Adicionar status REVERSED ao enum (linha 1546)**

```prisma
enum FinancialTransactionStatus {
  PENDING
  CONFIRMED
  PAID
  OVERDUE
  CANCELED
  PARTIALLY
  REVERSED // Estornado por cancelamento
}
```

**Step 8: Adicionar matchMethod e aiReasoning ao OfxReconciliationItem (linha 1798)**

Após o campo `matchNotes` (linha 1822):

```prisma
  // Método de match
  matchMethod String? // 'EXACT' | 'AI_AUTO' | 'AI_SUGGESTED' | 'MANUAL'
  // Explicação da IA
  aiReasoning String?
```

**Step 9: Criar modelo FinancialBridgeLog**

```prisma
model FinancialBridgeLog {
  id           String   @id @default(uuid())
  companyId    String
  company      Company  @relation(fields: [companyId], references: [id])
  sourceType   String   // 'ORDER' | 'CASH_SESSION' | 'ORDER_REVERSAL'
  sourceId     String
  status       String   // 'SUCCESS' | 'FAILED' | 'RETRY_SUCCESS'
  errorMessage String?
  retryCount   Int      @default(0)
  createdAt    DateTime @default(now())
  resolvedAt   DateTime?
  resolvedBy   String?

  @@index([companyId, status], name: "idx_bridge_log_status")
  @@index([sourceType, sourceId], name: "idx_bridge_log_source")
}
```

**Step 10: Adicionar relações inversas no modelo User**

No modelo `User`, adicionar:

```prisma
  ownedCashSessions    CashSession[]         @relation("CashSessionOwner")
  operatorCashSessions CashSessionOperator[] @relation("CashSessionOperators")
```

**Step 11: Adicionar relações inversas no modelo Store**

No modelo `Store`, adicionar:

```prisma
  cashSessionStores    CashSessionStore[]
  financialTransactions FinancialTransaction[]
  cashFlowEntries      CashFlowEntry[]
```

**Step 12: Seed do centro de custo 2.04 - Cancelamentos**

No `costCenters.js` (rota `POST /financial/cost-centers/seed-default`), adicionar ao array de defaults:

```javascript
{ code: '2.04', name: 'Cancelamentos / Estornos', dreGroup: 'DEDUCTIONS' }
```

**Step 13: Rodar migration**

```bash
cd delivery-saas-backend
npx prisma db push
npx prisma generate
```

**Step 14: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(financial): add CashSession owner/operators/stores/channels, Order.cashSessionId, reversal fields, bridge log model"
```

---

## Task 2: Backend — Reestruturar abertura de caixa

**Files:**
- Modify: `delivery-saas-backend/src/routes/cash.js:44-90`

**Step 1: Reescrever POST /cash/open**

Substituir o endpoint atual (linhas 44-90) por:

```javascript
// POST /cash/open
router.post('/open', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const userId = req.user.id;
    if (!companyId) return res.status(400).json({ message: 'Usuário sem empresa' });

    const {
      openingAmount,
      note,
      label = 'Caixa',
      channels,
      storeIds,
      operatorIds = [],
    } = req.body;

    // Default: todos os canais
    const allChannels = ['BALCAO', 'IFOOD', 'AIQFOME', 'WHATSAPP'];
    const selectedChannels = (channels && channels.length) ? channels : allChannels;

    // Default: todas as lojas da empresa
    let selectedStoreIds = storeIds;
    if (!selectedStoreIds || !selectedStoreIds.length) {
      const stores = await prisma.store.findMany({
        where: { companyId, isActive: true },
        select: { id: true },
      });
      selectedStoreIds = stores.map(s => s.id);
    }

    // Validar sobreposição: nenhum caixa aberto pode ter mesma combinação loja+canal
    const openSessions = await prisma.cashSession.findMany({
      where: { companyId, status: 'OPEN' },
      include: { stores: true },
    });

    for (const existing of openSessions) {
      const existingStoreIds = existing.stores.map(s => s.storeId);
      const overlappingStores = selectedStoreIds.filter(id => existingStoreIds.includes(id));
      if (overlappingStores.length === 0) continue;

      const overlappingChannels = selectedChannels.filter(ch => existing.channels.includes(ch));
      if (overlappingChannels.length > 0) {
        return res.status(400).json({
          message: `Já existe caixa aberto "${existing.label}" cobrindo ${overlappingChannels.join(', ')} para a(s) mesma(s) loja(s)`,
        });
      }
    }

    // Auto-suggest opening amount from last closed session
    let finalOpeningAmount = openingAmount;
    if (finalOpeningAmount == null) {
      const lastClosed = await prisma.cashSession.findFirst({
        where: { companyId, ownerId: userId, status: 'CLOSED' },
        orderBy: { closedAt: 'desc' },
      });
      if (lastClosed?.declaredValues) {
        const dv = lastClosed.declaredValues;
        const cashKey = Object.keys(dv).find(k => /din|cash|money/i.test(k));
        if (cashKey) finalOpeningAmount = Number(dv[cashKey]);
      }
    }

    const amount = Number(finalOpeningAmount || 0);

    // Criar sessão + operadores + lojas em transação
    const session = await prisma.$transaction(async (tx) => {
      const s = await tx.cashSession.create({
        data: {
          companyId,
          openedBy: userId,
          ownerId: userId,
          label,
          channels: selectedChannels,
          openingAmount: amount,
          currentBalance: amount,
          openingNote: note || null,
          status: 'OPEN',
        },
      });

      // Vincular lojas
      if (selectedStoreIds.length) {
        await tx.cashSessionStore.createMany({
          data: selectedStoreIds.map(storeId => ({
            cashSessionId: s.id,
            storeId,
          })),
        });
      }

      // Vincular operadores adicionais
      if (operatorIds.length) {
        await tx.cashSessionOperator.createMany({
          data: operatorIds.map(opId => ({
            cashSessionId: s.id,
            userId: opId,
            addedBy: userId,
          })),
        });
      }

      return s;
    });

    const full = await prisma.cashSession.findUnique({
      where: { id: session.id },
      include: { stores: { include: { store: true } }, operators: { include: { user: true } } },
    });

    res.status(201).json({ session: full });
  } catch (e) {
    console.error('POST /cash/open error:', e);
    res.status(500).json({ message: 'Erro ao abrir caixa', error: e?.message });
  }
});
```

**Step 2: Adicionar endpoints de operadores**

Após o endpoint de open, adicionar:

```javascript
// POST /cash/operators — vincular operador ao caixa aberto
router.post('/operators', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ message: 'userId é obrigatório' });

    const session = await prisma.cashSession.findFirst({
      where: { companyId, status: 'OPEN', ownerId: req.user.id },
    });
    if (!session) return res.status(400).json({ message: 'Nenhum caixa aberto sob sua responsabilidade' });

    const op = await prisma.cashSessionOperator.create({
      data: { cashSessionId: session.id, userId, addedBy: req.user.id },
    });
    res.status(201).json(op);
  } catch (e) {
    if (e.code === 'P2002') return res.status(400).json({ message: 'Operador já vinculado' });
    res.status(500).json({ message: 'Erro ao vincular operador', error: e?.message });
  }
});

// DELETE /cash/operators/:userId — desvincular operador
router.delete('/operators/:userId', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const session = await prisma.cashSession.findFirst({
      where: { companyId, status: 'OPEN', ownerId: req.user.id },
    });
    if (!session) return res.status(400).json({ message: 'Nenhum caixa aberto sob sua responsabilidade' });

    await prisma.cashSessionOperator.deleteMany({
      where: { cashSessionId: session.id, userId: req.params.userId },
    });
    res.json({ message: 'Operador desvinculado' });
  } catch (e) {
    res.status(500).json({ message: 'Erro ao desvincular operador', error: e?.message });
  }
});
```

**Step 3: Ajustar GET /cash/current para retornar caixa do usuário (dono OU operador)**

```javascript
// GET /cash/current — busca caixa aberto onde o usuário é dono OU operador
router.get('/current', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const userId = req.user.id;

    const session = await prisma.cashSession.findFirst({
      where: {
        companyId,
        status: 'OPEN',
        OR: [
          { ownerId: userId },
          { operators: { some: { userId } } },
        ],
      },
      include: {
        movements: { orderBy: { createdAt: 'desc' } },
        stores: { include: { store: { select: { id: true, name: true } } } },
        operators: { include: { user: { select: { id: true, name: true } } } },
      },
    });

    res.json({ session });
  } catch (e) {
    res.status(500).json({ message: 'Erro ao buscar caixa', error: e?.message });
  }
});
```

**Step 4: Ajustar POST /cash/close/finalize para validar ownerId**

Na linha 141 de `cash.js`, após buscar a sessão, adicionar validação:

```javascript
if (session.ownerId !== req.user.id) {
  return res.status(403).json({ message: 'Apenas o responsável pelo caixa pode fechá-lo' });
}
```

**Step 5: Commit**

```bash
git add delivery-saas-backend/src/routes/cash.js
git commit -m "feat(cash): multi-session per company, owner/operators/channels/stores, overlap validation"
```

---

## Task 3: Backend — Vínculo pedido ↔ caixa ao concluir

**Files:**
- Modify: `delivery-saas-backend/src/routes/orders.js:799-803`
- Create: `delivery-saas-backend/src/services/cash/sessionMatcher.js`

**Step 1: Criar helper de resolução de canal**

```javascript
// delivery-saas-backend/src/services/cash/sessionMatcher.js
import { prisma } from '../../prisma.js';

/**
 * Identifica o canal do pedido baseado na origem.
 */
export function resolveOrderChannel(order) {
  const source = order.customerSource?.toUpperCase();
  if (source === 'IFOOD') return 'IFOOD';
  if (source === 'AIQFOME') return 'AIQFOME';

  const payloadSource = order.payload?.source?.toLowerCase();
  if (payloadSource === 'whatsapp') return 'WHATSAPP';

  return 'BALCAO';
}

/**
 * Busca CashSession aberto que cubra o canal e a loja do pedido.
 * Prioriza sessão onde o operador logado está vinculado.
 */
export async function findMatchingSession(order, userId) {
  const channel = resolveOrderChannel(order);
  const companyId = order.companyId;

  const where = {
    companyId,
    status: 'OPEN',
    channels: { has: channel },
  };

  // Se o pedido tem loja, filtra por sessões que atendem essa loja
  if (order.storeId) {
    where.stores = { some: { storeId: order.storeId } };
  }

  const candidates = await prisma.cashSession.findMany({
    where,
    include: { operators: true },
  });

  if (candidates.length === 0) return null;

  // Prioriza sessão do usuário (dono ou operador)
  const userSession = candidates.find(
    s => s.ownerId === userId || s.operators.some(op => op.userId === userId)
  );

  return userSession || candidates[0];
}
```

**Step 2: Usar no fluxo de CONCLUIDO em orders.js**

Após a linha 801 (`createFinancialEntriesForOrder`), adicionar vinculação ao caixa:

```javascript
// Vincular ao caixa
const { findMatchingSession } = await import('../services/cash/sessionMatcher.js');
const matchedSession = await findMatchingSession(updated, req.user.id);

if (matchedSession) {
  const isImmediate = (() => {
    const payments = updated.payload?.paymentConfirmed || [];
    if (!payments.length && updated.payload?.payment?.method) {
      return /din|pix|cash|money/i.test(updated.payload.payment.method);
    }
    return payments.every(p => /din|pix|cash|money/i.test(p.method));
  })();

  await prisma.order.update({
    where: { id: updated.id },
    data: { cashSessionId: matchedSession.id, outOfSession: false },
  });

  // Atualizar saldo do caixa se pagamento imediato
  if (isImmediate) {
    await prisma.cashSession.update({
      where: { id: matchedSession.id },
      data: { currentBalance: { increment: Number(updated.total) } },
    });
  }
} else {
  await prisma.order.update({
    where: { id: updated.id },
    data: { outOfSession: true },
  });

  // Alerta via Socket.IO
  const io = req.app.get('io');
  if (io) {
    io.to(`company_${companyId}`).emit('order:out-of-session', {
      orderId: updated.id,
      displayId: updated.displayId,
      total: updated.total,
      channel: (await import('../services/cash/sessionMatcher.js')).resolveOrderChannel(updated),
    });
  }
}
```

**Step 3: Commit**

```bash
git add delivery-saas-backend/src/services/cash/sessionMatcher.js delivery-saas-backend/src/routes/orders.js
git commit -m "feat(orders): link order to cash session on CONCLUIDO, emit alert if out-of-session"
```

---

## Task 4: Backend — Estorno automático no cancelamento

**Files:**
- Create: `delivery-saas-backend/src/services/financial/reversalBridge.js`
- Modify: `delivery-saas-backend/src/routes/orders.js` (trecho de cancelamento ~linha 580)

**Step 1: Criar reversalBridge.js**

```javascript
// delivery-saas-backend/src/services/financial/reversalBridge.js
import { prisma } from '../../prisma.js';

/**
 * Reverte todas as transações financeiras de um pedido cancelado pós-CONCLUIDO.
 * Cria transações de estorno e ajusta saldo do caixa.
 */
export async function reverseFinancialEntriesForOrder(order) {
  try {
    const companyId = order.companyId;

    // 1. Buscar transação original de receita
    const originalTx = await prisma.financialTransaction.findFirst({
      where: { companyId, sourceType: 'ORDER', sourceId: order.id },
    });

    if (!originalTx || originalTx.status === 'REVERSED') {
      console.log(`[reversalBridge] Nenhuma transação para reverter (order ${order.id})`);
      return { reversed: false, reason: 'no_transaction' };
    }

    // 2. Buscar centro de custo de cancelamentos (2.04)
    let cancelCC = await prisma.costCenter.findFirst({
      where: { companyId, code: '2.04', isActive: true },
    });
    if (!cancelCC) {
      cancelCC = await prisma.costCenter.create({
        data: {
          companyId,
          code: '2.04',
          name: 'Cancelamentos / Estornos',
          dreGroup: 'DEDUCTIONS',
          isActive: true,
        },
      });
    }

    const now = new Date();
    const results = [];

    // 3. Marcar original como REVERSED e criar estorno da receita
    await prisma.$transaction(async (tx) => {
      await tx.financialTransaction.update({
        where: { id: originalTx.id },
        data: { status: 'REVERSED' },
      });

      const reversal = await tx.financialTransaction.create({
        data: {
          companyId,
          type: 'PAYABLE',
          status: 'PAID',
          description: `Estorno - Venda #${order.displayId || order.id} (cancelamento)`,
          accountId: originalTx.accountId,
          costCenterId: cancelCC.id,
          grossAmount: originalTx.grossAmount,
          feeAmount: 0,
          netAmount: originalTx.grossAmount,
          paidAmount: originalTx.grossAmount,
          issueDate: now,
          dueDate: now,
          paidAt: now,
          sourceType: 'ORDER_REVERSAL',
          sourceId: order.id,
          reversedTransactionId: originalTx.id,
          storeId: order.storeId || null,
          createdBy: 'system',
        },
      });
      results.push(reversal);

      // 4. Se tem caixa vinculado e pagamento era imediato, ajustar saldo
      if (order.cashSessionId) {
        const payments = order.payload?.paymentConfirmed || [];
        const isImmediate = payments.length
          ? payments.every(p => /din|pix|cash|money/i.test(p.method))
          : /din|pix|cash|money/i.test(order.payload?.payment?.method || '');

        if (isImmediate) {
          await tx.cashSession.update({
            where: { id: order.cashSessionId },
            data: { currentBalance: { decrement: Number(order.total) } },
          });

          // CashFlowEntry de estorno
          if (originalTx.accountId) {
            const account = await tx.financialAccount.update({
              where: { id: originalTx.accountId },
              data: { currentBalance: { decrement: Number(order.total) } },
            });

            await tx.cashFlowEntry.create({
              data: {
                companyId,
                accountId: originalTx.accountId,
                transactionId: reversal.id,
                type: 'OUTFLOW',
                amount: Number(order.total),
                balanceAfter: account.currentBalance,
                entryDate: now,
                description: `Estorno pedido #${order.displayId || order.id}`,
                storeId: order.storeId || null,
              },
            });
          }
        }
      }
    });

    // 5. Reverter transações dependentes (rider, afiliado)
    const dependentTxs = await prisma.financialTransaction.findMany({
      where: {
        companyId,
        sourceId: order.id,
        sourceType: { in: ['RIDER', 'AFFILIATE', 'COUPON'] },
        status: { not: 'REVERSED' },
      },
    });

    for (const depTx of dependentTxs) {
      await prisma.$transaction(async (tx) => {
        await tx.financialTransaction.update({
          where: { id: depTx.id },
          data: { status: 'REVERSED' },
        });

        await tx.financialTransaction.create({
          data: {
            companyId,
            type: depTx.type === 'PAYABLE' ? 'RECEIVABLE' : 'PAYABLE',
            status: 'PAID',
            description: `Estorno - ${depTx.description} (cancelamento pedido)`,
            accountId: depTx.accountId,
            costCenterId: depTx.costCenterId,
            grossAmount: depTx.grossAmount,
            feeAmount: 0,
            netAmount: depTx.grossAmount,
            paidAmount: depTx.grossAmount,
            issueDate: now,
            dueDate: now,
            paidAt: now,
            sourceType: 'ORDER_REVERSAL',
            sourceId: order.id,
            reversedTransactionId: depTx.id,
            storeId: order.storeId || null,
            createdBy: 'system',
          },
        });
      });
    }

    // 6. Reverter cashback (se existir)
    try {
      const cashbackTxs = await prisma.cashbackTransaction.findMany({
        where: { orderId: order.id, type: 'CREDIT' },
      });
      for (const cbTx of cashbackTxs) {
        await prisma.cashbackTransaction.create({
          data: {
            walletId: cbTx.walletId,
            orderId: order.id,
            type: 'DEBIT',
            amount: cbTx.amount,
            description: `Estorno cashback - pedido #${order.displayId || order.id} cancelado`,
          },
        });
        await prisma.cashbackWallet.update({
          where: { id: cbTx.walletId },
          data: { balance: { decrement: Number(cbTx.amount) } },
        });
      }
    } catch (e) {
      console.error('[reversalBridge] cashback reversal error:', e.message);
    }

    console.log(`[reversalBridge] Reversed ${results.length + dependentTxs.length} transactions for order ${order.id}`);
    return { reversed: true, count: results.length + dependentTxs.length };
  } catch (e) {
    console.error('[reversalBridge] Error:', e);
    return { reversed: false, error: e.message };
  }
}
```

**Step 2: Integrar no fluxo de cancelamento em orders.js**

No trecho de PATCH /orders/:id/status, quando o status muda para CANCELADO e o pedido anterior era CONCLUIDO, adicionar após a atualização do status:

```javascript
// Estorno financeiro se pedido estava CONCLUIDO
if (existing.status === 'CONCLUIDO' && status === 'CANCELADO') {
  const { reverseFinancialEntriesForOrder } = await import('../services/financial/reversalBridge.js');
  const result = await reverseFinancialEntriesForOrder(updated);

  if (result.reversed) {
    const io = req.app.get('io');
    if (io) {
      io.to(`company_${companyId}`).emit('order:reversed', {
        orderId: updated.id,
        displayId: updated.displayId,
        total: updated.total,
        reversedCount: result.count,
      });
    }
  }
}
```

**Step 3: Commit**

```bash
git add delivery-saas-backend/src/services/financial/reversalBridge.js delivery-saas-backend/src/routes/orders.js
git commit -m "feat(financial): auto-reverse all financial entries on order cancellation post-CONCLUIDO"
```

---

## Task 5: Backend — Auditoria do bridge e storeId

**Files:**
- Modify: `delivery-saas-backend/src/services/financial/orderFinancialBridge.js`
- Modify: `delivery-saas-backend/src/services/financial/cashSessionBridge.js`

**Step 1: Adicionar logging e storeId ao orderFinancialBridge.js**

Envolver a função `createFinancialEntriesForOrder` com log de auditoria. No início da função (linha 21), após a verificação de duplicatas:

```javascript
// Adicionar ao import no topo do arquivo
import { prisma } from '../../prisma.js';

// Dentro de createFinancialEntriesForOrder, envolver tudo em try-catch com log
export async function createFinancialEntriesForOrder(order) {
  const logData = {
    companyId: order.companyId,
    sourceType: 'ORDER',
    sourceId: order.id,
  };

  try {
    if (!order.companyId) return;

    // ... (lógica existente mantida) ...

    // Na criação da FinancialTransaction principal, adicionar:
    // storeId: order.storeId || null,

    // No final, após sucesso:
    await prisma.financialBridgeLog.create({
      data: { ...logData, status: 'SUCCESS' },
    });
  } catch (e) {
    console.error('[orderFinancialBridge] Error:', e);
    await prisma.financialBridgeLog.create({
      data: { ...logData, status: 'FAILED', errorMessage: e.message },
    }).catch(() => {});

    // Emitir alerta Socket.IO (se io disponível globalmente)
    try {
      const { getIO } = await import('../../socket.js');
      const io = getIO();
      if (io) {
        io.to(`company_${order.companyId}`).emit('financial:bridge-error', {
          sourceType: 'ORDER',
          sourceId: order.id,
          displayId: order.displayId,
          error: e.message,
        });
      }
    } catch (_) {}
  }
}
```

**Step 2: Adicionar storeId à criação da FinancialTransaction principal**

Na chamada `prisma.financialTransaction.create` dentro do bridge, adicionar o campo:

```javascript
storeId: order.storeId || null,
```

**Step 3: Aplicar mesmo padrão ao cashSessionBridge.js**

Adicionar log de auditoria similar ao `createFinancialEntriesForCashSession`.

**Step 4: Commit**

```bash
git add delivery-saas-backend/src/services/financial/orderFinancialBridge.js delivery-saas-backend/src/services/financial/cashSessionBridge.js
git commit -m "feat(financial): add bridge audit logging, storeId tracking, Socket.IO error alerts"
```

---

## Task 6: Backend — Job de reconciliação periódico

**Files:**
- Create: `delivery-saas-backend/src/jobs/financialReconciliation.js`
- Modify: `delivery-saas-backend/src/routes/financial/index.js` (adicionar endpoint manual)

**Step 1: Criar job de reconciliação**

```javascript
// delivery-saas-backend/src/jobs/financialReconciliation.js
import { prisma } from '../prisma.js';
import { createFinancialEntriesForOrder } from '../services/financial/orderFinancialBridge.js';

/**
 * Detecta pedidos órfãos (CONCLUIDO sem FinancialTransaction) e retenta bridges falhos.
 * Roda a cada 1h via setInterval ou sob demanda via endpoint.
 */
export async function runReconciliation(companyId = null) {
  const results = { orphansFound: 0, orphansFixed: 0, retriesAttempted: 0, retriesFixed: 0 };

  try {
    const companyFilter = companyId ? { companyId } : {};
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);

    // 1. Pedidos CONCLUIDO sem transação financeira
    const allConcluidos = await prisma.order.findMany({
      where: {
        ...companyFilter,
        status: 'CONCLUIDO',
        updatedAt: { lt: fiveMinAgo },
      },
      select: { id: true, companyId: true },
    });

    const existingTxSourceIds = await prisma.financialTransaction.findMany({
      where: {
        ...companyFilter,
        sourceType: 'ORDER',
        sourceId: { in: allConcluidos.map(o => o.id) },
      },
      select: { sourceId: true },
    });

    const coveredIds = new Set(existingTxSourceIds.map(t => t.sourceId));
    const orphans = allConcluidos.filter(o => !coveredIds.has(o.id));
    results.orphansFound = orphans.length;

    for (const orphan of orphans) {
      try {
        const fullOrder = await prisma.order.findUnique({
          where: { id: orphan.id },
          include: { items: true },
        });
        await createFinancialEntriesForOrder(fullOrder);
        results.orphansFixed++;
      } catch (e) {
        console.error(`[reconciliation] Failed to fix orphan ${orphan.id}:`, e.message);
      }
    }

    // 2. Retries de bridges falhos (max 3 tentativas)
    const failedLogs = await prisma.financialBridgeLog.findMany({
      where: {
        ...companyFilter,
        status: 'FAILED',
        retryCount: { lt: 3 },
      },
    });

    results.retriesAttempted = failedLogs.length;

    for (const log of failedLogs) {
      try {
        if (log.sourceType === 'ORDER') {
          const order = await prisma.order.findUnique({
            where: { id: log.sourceId },
            include: { items: true },
          });
          if (order && order.status === 'CONCLUIDO') {
            await createFinancialEntriesForOrder(order);
            await prisma.financialBridgeLog.update({
              where: { id: log.id },
              data: { status: 'RETRY_SUCCESS', resolvedAt: new Date() },
            });
            results.retriesFixed++;
            continue;
          }
        }
        // Incrementar retry count se não resolveu
        await prisma.financialBridgeLog.update({
          where: { id: log.id },
          data: { retryCount: { increment: 1 } },
        });
      } catch (e) {
        await prisma.financialBridgeLog.update({
          where: { id: log.id },
          data: { retryCount: { increment: 1 }, errorMessage: e.message },
        }).catch(() => {});
      }
    }

    console.log('[reconciliation] Results:', results);
    return results;
  } catch (e) {
    console.error('[reconciliation] Error:', e);
    return { ...results, error: e.message };
  }
}

// Auto-start: roda a cada 1 hora
let intervalId = null;
export function startReconciliationJob() {
  if (intervalId) return;
  intervalId = setInterval(() => runReconciliation(), 60 * 60 * 1000);
  console.log('[reconciliation] Job started — runs every 1h');
}
```

**Step 2: Adicionar endpoint manual ao financial/index.js**

```javascript
// POST /financial/reconciliation/run — rodar reconciliação sob demanda
router.post('/reconciliation/run', async (req, res) => {
  try {
    const { runReconciliation } = await import('../../jobs/financialReconciliation.js');
    const results = await runReconciliation(req.user.companyId);
    res.json(results);
  } catch (e) {
    res.status(500).json({ message: 'Erro na reconciliação', error: e?.message });
  }
});

// GET /financial/health — dashboard de saúde financeira
router.get('/health', async (req, res) => {
  try {
    const companyId = req.user.companyId;

    const [orphanCount, outOfSessionCount, failedBridges, lastLog] = await Promise.all([
      // Pedidos CONCLUIDO sem transação financeira
      prisma.$queryRaw`
        SELECT COUNT(*) as count FROM "Order" o
        WHERE o."companyId" = ${companyId}
        AND o."status" = 'CONCLUIDO'
        AND o."updatedAt" < NOW() - INTERVAL '5 minutes'
        AND NOT EXISTS (
          SELECT 1 FROM "FinancialTransaction" ft
          WHERE ft."sourceType" = 'ORDER' AND ft."sourceId" = o."id"
        )
      `,
      prisma.order.count({ where: { companyId, outOfSession: true } }),
      prisma.financialBridgeLog.count({ where: { companyId, status: 'FAILED', retryCount: { lt: 3 } } }),
      prisma.financialBridgeLog.findFirst({
        where: { companyId, status: { in: ['SUCCESS', 'RETRY_SUCCESS'] } },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
    ]);

    res.json({
      orphanOrders: Number(orphanCount[0]?.count || 0),
      outOfSessionOrders: outOfSessionCount,
      pendingBridgeFailures: failedBridges,
      lastSuccessfulBridge: lastLog?.createdAt || null,
    });
  } catch (e) {
    res.status(500).json({ message: 'Erro ao buscar saúde financeira', error: e?.message });
  }
});
```

**Step 3: Iniciar job no bootstrap do servidor**

No arquivo de inicialização do servidor (ex: `app.js` ou `server.js`), adicionar:

```javascript
import { startReconciliationJob } from './jobs/financialReconciliation.js';
startReconciliationJob();
```

**Step 4: Commit**

```bash
git add delivery-saas-backend/src/jobs/financialReconciliation.js delivery-saas-backend/src/routes/financial/index.js
git commit -m "feat(financial): add reconciliation job (1h interval + manual trigger), health dashboard endpoint"
```

---

## Task 7: Backend — Ajustar calculateExpectedValues para usar cashSessionId

**Files:**
- Modify: `delivery-saas-backend/src/services/cash/paymentAggregator.js:19-60`

**Step 1: Reescrever aggregatePaymentsByMethod**

Trocar a query por timestamp para query por `cashSessionId`:

```javascript
export async function aggregatePaymentsByMethod(sessionId, companyId) {
  // Buscar pedidos vinculados a esta sessão de caixa
  const orders = await prisma.order.findMany({
    where: {
      companyId,
      cashSessionId: sessionId,
      status: 'CONCLUIDO',
    },
    select: { payload: true, total: true },
  });

  // ... resto da lógica de extração de payment methods mantida ...
}
```

**Step 2: Ajustar calculateExpectedValues**

Receber `sessionId` em vez de `startDate/endDate`:

```javascript
export async function calculateExpectedValues(session) {
  const payments = await aggregatePaymentsByMethod(session.id, session.companyId);

  // ... lógica de cálculo mantida, mas usando session.id para busca ...
}
```

**Step 3: Commit**

```bash
git add delivery-saas-backend/src/services/cash/paymentAggregator.js
git commit -m "refactor(cash): calculateExpectedValues queries by cashSessionId instead of timestamp range"
```

---

## Task 8: Backend — Ajustar relatórios com filtro storeId

**Files:**
- Modify: `delivery-saas-backend/src/routes/financial/reports.js`
- Modify: `delivery-saas-backend/src/routes/financial/cashFlow.js`

**Step 1: Adicionar filtro storeId ao DRE (reports.js:7)**

Na query de transações (linha 26), adicionar filtro opcional:

```javascript
const { dateFrom, dateTo, storeId } = req.query;

// Na where clause:
const txWhere = {
  companyId,
  status: { in: ['PAID', 'PARTIALLY'] },
  issueDate: { gte: from, lte: to },
  costCenterId: { not: null },
};
if (storeId) txWhere.storeId = storeId;
```

**Step 2: Adicionar filtro storeId ao Summary (reports.js:119)**

Mesmo padrão — adicionar `storeId` opcional às 4 queries agregadas.

**Step 3: Adicionar filtro storeId ao Cash Flow (cashFlow.js:7)**

Na query de `CashFlowEntry` e `FinancialTransaction`, adicionar `storeId` opcional.

**Step 4: Commit**

```bash
git add delivery-saas-backend/src/routes/financial/reports.js delivery-saas-backend/src/routes/financial/cashFlow.js
git commit -m "feat(financial): add storeId filter to DRE, summary, and cash flow reports"
```

---

## Task 9: Backend — Conciliação OFX com IA

**Files:**
- Modify: `delivery-saas-backend/src/routes/financial/ofx.js`
- Create: `delivery-saas-backend/src/services/financial/ofxAiMatcher.js`

**Step 1: Criar serviço de match com IA**

```javascript
// delivery-saas-backend/src/services/financial/ofxAiMatcher.js
import { prisma } from '../../prisma.js';
import OpenAI from 'openai';

const BATCH_SIZE = 10;
const HIGH_CONFIDENCE = 85;
const LOW_CONFIDENCE = 50;

/**
 * Tenta match exato primeiro, depois usa IA para ambíguos.
 */
export async function reconcileOfxItems(importId, companyId) {
  const items = await prisma.ofxReconciliationItem.findMany({
    where: { importId, matchStatus: 'PENDING' },
  });

  const results = { exact: 0, aiAuto: 0, aiSuggested: 0, unmatched: 0 };

  // Buscar transações candidatas (não conciliadas, do período)
  const dates = items.map(i => i.ofxDate);
  const minDate = new Date(Math.min(...dates));
  const maxDate = new Date(Math.max(...dates));
  minDate.setDate(minDate.getDate() - 5);
  maxDate.setDate(maxDate.getDate() + 5);

  const candidates = await prisma.financialTransaction.findMany({
    where: {
      companyId,
      status: { in: ['PAID', 'CONFIRMED', 'PARTIALLY'] },
      issueDate: { gte: minDate, lte: maxDate },
    },
    select: {
      id: true, description: true, grossAmount: true, netAmount: true,
      issueDate: true, sourceType: true, type: true,
    },
  });

  // Track already matched
  const matchedTxIds = new Set();
  const ambiguous = [];

  // Etapa 1: Match exato
  for (const item of items) {
    const absAmount = Math.abs(Number(item.amount));
    const exactMatches = candidates.filter(c => {
      if (matchedTxIds.has(c.id)) return false;
      const txAmount = Number(c.netAmount || c.grossAmount);
      if (Math.abs(txAmount - absAmount) > 0.01) return false;
      const daysDiff = Math.abs(item.ofxDate - c.issueDate) / (1000 * 60 * 60 * 24);
      return daysDiff <= 3;
    });

    if (exactMatches.length === 1) {
      await prisma.ofxReconciliationItem.update({
        where: { id: item.id },
        data: {
          matchStatus: 'MATCHED',
          transactionId: exactMatches[0].id,
          matchConfidence: 100,
          matchMethod: 'EXACT',
          matchNotes: 'Match exato por valor e data',
        },
      });
      matchedTxIds.add(exactMatches[0].id);
      results.exact++;
    } else {
      ambiguous.push({ item, candidates: exactMatches.length > 1 ? exactMatches : [] });
    }
  }

  // Etapa 2: Match por IA (em batches)
  if (ambiguous.length > 0) {
    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) {
      // Sem IA: marcar todos como UNMATCHED
      for (const { item } of ambiguous) {
        await prisma.ofxReconciliationItem.update({
          where: { id: item.id },
          data: { matchStatus: 'UNMATCHED', matchMethod: 'MANUAL' },
        });
        results.unmatched++;
      }
      return results;
    }

    const openai = new OpenAI({ apiKey: openaiKey });
    const remainingCandidates = candidates.filter(c => !matchedTxIds.has(c.id));

    for (let i = 0; i < ambiguous.length; i += BATCH_SIZE) {
      const batch = ambiguous.slice(i, i + BATCH_SIZE);

      const prompt = `Você é um assistente de conciliação bancária para restaurantes.

Abaixo estão lançamentos de extrato bancário que precisam ser vinculados a transações financeiras do sistema.

LANÇAMENTOS DO EXTRATO:
${batch.map((b, idx) => `${idx + 1}. Data: ${b.item.ofxDate.toISOString().split('T')[0]}, Valor: R$${Math.abs(Number(b.item.amount)).toFixed(2)}, Tipo: ${b.item.ofxType}, Descrição: "${b.item.memo || 'sem descrição'}"`).join('\n')}

TRANSAÇÕES CANDIDATAS DO SISTEMA:
${remainingCandidates.map(c => `- ID: ${c.id}, Data: ${c.issueDate.toISOString().split('T')[0]}, Valor: R$${Number(c.netAmount).toFixed(2)}, Tipo: ${c.type}, Fonte: ${c.sourceType || 'MANUAL'}, Desc: "${c.description}"`).join('\n')}

Para cada lançamento, responda em JSON array:
[{ "index": 1, "matchId": "id_da_transacao" ou null, "confidence": 0-100, "reasoning": "explicação curta" }]

Se nenhuma transação corresponde, use matchId: null e confidence: 0.`;

      try {
        const response = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          response_format: { type: 'json_object' },
          temperature: 0.1,
        });

        const content = JSON.parse(response.choices[0].message.content);
        const matches = content.matches || content.results || content;

        for (const match of (Array.isArray(matches) ? matches : [])) {
          const batchItem = batch[match.index - 1];
          if (!batchItem) continue;

          const confidence = Number(match.confidence || 0);

          if (match.matchId && confidence >= HIGH_CONFIDENCE) {
            await prisma.ofxReconciliationItem.update({
              where: { id: batchItem.item.id },
              data: {
                matchStatus: 'MATCHED',
                transactionId: match.matchId,
                matchConfidence: confidence,
                matchMethod: 'AI_AUTO',
                aiReasoning: match.reasoning,
                matchNotes: `IA auto-match (${confidence}%)`,
              },
            });
            matchedTxIds.add(match.matchId);
            results.aiAuto++;
          } else if (match.matchId && confidence >= LOW_CONFIDENCE) {
            await prisma.ofxReconciliationItem.update({
              where: { id: batchItem.item.id },
              data: {
                matchStatus: 'PENDING',
                transactionId: match.matchId,
                matchConfidence: confidence,
                matchMethod: 'AI_SUGGESTED',
                aiReasoning: match.reasoning,
                matchNotes: `Sugestão IA (${confidence}%) — aguarda revisão`,
              },
            });
            results.aiSuggested++;
          } else {
            await prisma.ofxReconciliationItem.update({
              where: { id: batchItem.item.id },
              data: {
                matchStatus: 'UNMATCHED',
                matchConfidence: confidence,
                matchMethod: 'MANUAL',
                aiReasoning: match.reasoning || null,
              },
            });
            results.unmatched++;
          }
        }
      } catch (e) {
        console.error('[ofxAiMatcher] AI batch error:', e.message);
        for (const { item } of batch) {
          await prisma.ofxReconciliationItem.update({
            where: { id: item.id },
            data: { matchStatus: 'UNMATCHED', matchMethod: 'MANUAL', matchNotes: 'Erro na IA: ' + e.message },
          });
          results.unmatched++;
        }
      }
    }
  }

  console.log(`[ofxAiMatcher] Reconciliation results for import ${importId}:`, results);
  return results;
}
```

**Step 2: Integrar no endpoint de importação OFX**

No `ofx.js`, após salvar os itens do OFX importado, chamar:

```javascript
const { reconcileOfxItems } = await import('../../services/financial/ofxAiMatcher.js');
const matchResults = await reconcileOfxItems(import_.id, companyId);
```

**Step 3: Commit**

```bash
git add delivery-saas-backend/src/services/financial/ofxAiMatcher.js delivery-saas-backend/src/routes/financial/ofx.js
git commit -m "feat(financial): OFX reconciliation with exact match + OpenAI AI matching"
```

---

## Task 10: Frontend — Abertura de caixa com canais, lojas e operadores

**Files:**
- Modify: `delivery-saas-frontend/src/components/CashControl.vue`

**Step 1: Atualizar modal de abertura**

No método que abre o modal de abertura do caixa, adicionar campos para:
- `label` (text input, default "Caixa")
- `channels` (multi-select checkbox: Balcão, iFood, Aiqfome, WhatsApp — todos selecionados por default)
- `stores` (multi-select checkbox: listar lojas da empresa via `GET /stores` — todas selecionadas por default)
- `operators` (multi-select opcional: listar usuários da empresa)

Usar SweetAlert2 com HTML customizado ou componente Vue dedicado.

**Step 2: Atualizar chamada POST /cash/open**

Enviar os novos campos no body:

```javascript
const { data } = await api.post('/cash/open', {
  openingAmount,
  note,
  label,
  channels: selectedChannels,
  storeIds: selectedStoreIds,
  operatorIds: selectedOperatorIds,
});
```

**Step 3: Exibir info do caixa no dropdown**

Mostrar label, canais ativos e lojas no estado "Caixa aberto":

```html
<span class="badge bg-success">{{ session.label }}</span>
<small class="text-muted">{{ session.channels.join(', ') }}</small>
```

**Step 4: Commit**

```bash
git add delivery-saas-frontend/src/components/CashControl.vue
git commit -m "feat(cash-ui): add channels, stores, operators selection on cash open, default all selected"
```

---

## Task 11: Frontend — Dashboard de saúde financeira

**Files:**
- Modify: `delivery-saas-frontend/src/views/financial/FinancialDashboard.vue`

**Step 1: Adicionar card de saúde financeira**

Fazer GET /financial/health e exibir:

```html
<div class="card border-warning">
  <div class="card-header">Saúde Financeira</div>
  <div class="card-body">
    <div class="d-flex justify-content-between mb-2">
      <span>Pedidos sem registro financeiro</span>
      <span :class="health.orphanOrders > 0 ? 'text-danger fw-bold' : 'text-success'">
        {{ health.orphanOrders }}
      </span>
    </div>
    <div class="d-flex justify-content-between mb-2">
      <span>Pedidos fora de caixa</span>
      <span :class="health.outOfSessionOrders > 0 ? 'text-warning fw-bold' : 'text-success'">
        {{ health.outOfSessionOrders }}
      </span>
    </div>
    <div class="d-flex justify-content-between mb-2">
      <span>Falhas de bridge pendentes</span>
      <span :class="health.pendingBridgeFailures > 0 ? 'text-danger fw-bold' : 'text-success'">
        {{ health.pendingBridgeFailures }}
      </span>
    </div>
    <button v-if="health.orphanOrders > 0 || health.pendingBridgeFailures > 0"
            class="btn btn-sm btn-outline-warning mt-2"
            @click="runReconciliation">
      Executar Reconciliação
    </button>
  </div>
</div>
```

**Step 2: Adicionar filtro por loja**

Adicionar `<SelectInput>` de loja no topo da página, passando `storeId` como query param para todos os endpoints do dashboard.

**Step 3: Adicionar listener Socket.IO para alertas**

```javascript
socket.on('order:out-of-session', (data) => {
  toast.warning(`Pedido #${data.displayId} concluído fora de caixa (${data.channel})`);
  loadHealth();
});

socket.on('financial:bridge-error', (data) => {
  toast.error(`Falha ao registrar financeiro do pedido #${data.displayId}`);
  loadHealth();
});

socket.on('order:reversed', (data) => {
  toast.info(`Pedido #${data.displayId} cancelado — ${data.reversedCount} transações estornadas`);
  loadSummary();
});
```

**Step 4: Commit**

```bash
git add delivery-saas-frontend/src/views/financial/FinancialDashboard.vue
git commit -m "feat(financial-ui): health dashboard card, store filter, Socket.IO alerts for bridge errors and reversals"
```

---

## Task 12: Frontend — Tela de conciliação OFX completa

**Files:**
- Modify: `delivery-saas-frontend/src/views/financial/FinancialOFX.vue`

**Step 1: Exibir resultados por método de match**

Após importação, mostrar resumo:

```html
<div class="alert alert-info">
  <strong>{{ results.exact }}</strong> conciliados (exato) •
  <strong>{{ results.aiAuto }}</strong> conciliados (IA) •
  <strong>{{ results.aiSuggested }}</strong> sugestões para revisar •
  <strong>{{ results.unmatched }}</strong> sem correspondência
</div>
```

**Step 2: Seção de sugestões IA para revisão**

Listar itens com `matchMethod === 'AI_SUGGESTED'`:

```html
<div v-for="item in aiSuggestions" :key="item.id" class="card mb-2">
  <div class="card-body">
    <div class="d-flex justify-content-between">
      <div>
        <strong>Extrato:</strong> {{ item.memo }} — R$ {{ Math.abs(item.amount).toFixed(2) }}
        <br>
        <strong>Sugestão IA:</strong> {{ item.transaction?.description }} — R$ {{ item.transaction?.netAmount }}
        <br>
        <small class="text-muted">Confiança: {{ item.matchConfidence }}% — {{ item.aiReasoning }}</small>
      </div>
      <div>
        <button class="btn btn-sm btn-success me-1" @click="confirmMatch(item)">Confirmar</button>
        <button class="btn btn-sm btn-outline-danger" @click="rejectMatch(item)">Rejeitar</button>
      </div>
    </div>
  </div>
</div>
```

**Step 3: Commit**

```bash
git add delivery-saas-frontend/src/views/financial/FinancialOFX.vue
git commit -m "feat(financial-ui): complete OFX reconciliation UI with AI match review workflow"
```

---

## Task 13: Frontend — Filtro por loja nos relatórios DRE e Fluxo de Caixa

**Files:**
- Modify: `delivery-saas-frontend/src/views/financial/FinancialDRE.vue`
- Modify: `delivery-saas-frontend/src/views/financial/FinancialCashFlow.vue`

**Step 1: Adicionar SelectInput de loja ao DRE**

```html
<SelectInput v-model="selectedStoreId" label="Loja" :options="storeOptions" placeholder="Todas as lojas" />
```

Passar como query param: `GET /financial/reports/dre?dateFrom=...&dateTo=...&storeId=...`

**Step 2: Mesmo para Fluxo de Caixa**

Adicionar filtro de loja ao `FinancialCashFlow.vue`.

**Step 3: Commit**

```bash
git add delivery-saas-frontend/src/views/financial/FinancialDRE.vue delivery-saas-frontend/src/views/financial/FinancialCashFlow.vue
git commit -m "feat(financial-ui): add storeId filter to DRE and Cash Flow views"
```

---

## Task 14: Seed do centro de custo 2.04 e migração de dados

**Files:**
- Modify: `delivery-saas-backend/src/routes/financial/costCenters.js`

**Step 1: Adicionar 2.04 ao seed**

No array de centros de custo padrão do endpoint `POST /financial/cost-centers/seed-default`:

```javascript
{ code: '2.04', name: 'Cancelamentos / Estornos', dreGroup: 'DEDUCTIONS' },
```

**Step 2: Migration script para dados existentes**

Criar script one-off para popular `ownerId` em CashSessions existentes:

```javascript
// delivery-saas-backend/scripts/migrate-cash-sessions.js
import { prisma } from '../src/prisma.js';

async function migrate() {
  const sessions = await prisma.cashSession.findMany({
    where: { ownerId: null },
  });

  for (const s of sessions) {
    await prisma.cashSession.update({
      where: { id: s.id },
      data: {
        ownerId: s.openedBy,
        label: 'Caixa',
        channels: ['BALCAO', 'IFOOD', 'AIQFOME', 'WHATSAPP'],
      },
    });
  }

  console.log(`Migrated ${sessions.length} cash sessions`);
}

migrate().then(() => process.exit(0));
```

**Step 3: Commit**

```bash
git add delivery-saas-backend/src/routes/financial/costCenters.js delivery-saas-backend/scripts/migrate-cash-sessions.js
git commit -m "feat(financial): add 2.04 cost center seed, migration script for existing cash sessions"
```

---

## Ordem de Execução Recomendada

```
Task 1  → Schema (base de tudo)
Task 14 → Seed + Migration (prepara dados)
Task 2  → Cash open (novo modelo)
Task 3  → Pedido ↔ Caixa
Task 7  → calculateExpectedValues (depende de Task 3)
Task 4  → Estorno automático
Task 5  → Auditoria bridge
Task 6  → Job reconciliação
Task 8  → Filtro storeId relatórios
Task 9  → OFX com IA
Task 10 → Frontend cash open
Task 11 → Frontend dashboard saúde
Task 12 → Frontend OFX
Task 13 → Frontend filtro loja
```
