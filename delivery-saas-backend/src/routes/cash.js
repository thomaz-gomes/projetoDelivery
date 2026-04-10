import express from 'express';
import { authMiddleware } from '../auth.js';
import { prisma } from '../prisma.js';
import {
  aggregatePaymentsByMethod,
  calculateExpectedValues,
  calculateDifferences,
} from '../services/cash/paymentAggregator.js';
import { createFinancialEntriesForCashSession } from '../services/financial/cashSessionBridge.js';

export const cashRouter = express.Router();
cashRouter.use(authMiddleware);

// ─── Helpers ───────────────────────────────────────────────────────────

function sessionToJSON(s) {
  return {
    ...s,
    openingAmount: Number(s.openingAmount),
    currentBalance: Number(s.currentBalance),
    movements: (s.movements || []).map(mv => ({
      ...mv,
      amount: Number(mv.amount),
    })),
  };
}

// ─── GET /cash/current ─────────────────────────────────────────────────

cashRouter.get('/current', async (req, res) => {
  const { companyId, id: userId } = req.user;
  if (!companyId) return res.status(400).json({ message: 'Usuário sem empresa' });

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
      movements: { orderBy: { createdAt: 'asc' } },
      stores: { include: { store: { select: { id: true, name: true } } } },
      operators: { include: { user: { select: { id: true, name: true } } } },
      owner: { select: { id: true, name: true } },
    },
  });

  res.json(session ? sessionToJSON(session) : null);
});

// ─── POST /cash/open ───────────────────────────────────────────────────

cashRouter.post('/open', async (req, res) => {
  const { companyId, id: userId } = req.user;
  if (!companyId) return res.status(400).json({ message: 'Usuário sem empresa' });

  let { openingAmount, note, label, channels, storeIds, operatorIds } = req.body || {};

  // Defaults
  label = label || 'Caixa';
  channels = Array.isArray(channels) && channels.length > 0
    ? channels
    : ['BALCAO', 'IFOOD', 'AIQFOME', 'WHATSAPP'];

  // Default storeIds = all stores of the company
  if (!Array.isArray(storeIds) || storeIds.length === 0) {
    const companyStores = await prisma.store.findMany({
      where: { companyId },
      select: { id: true },
    });
    storeIds = companyStores.map(s => s.id);
  }

  if (!Array.isArray(operatorIds)) operatorIds = [];

  // Validate: no two open sessions can serve the same store+channel combination
  const existingOpen = await prisma.cashSession.findMany({
    where: { companyId, status: 'OPEN' },
    include: { stores: true },
  });

  for (const existing of existingOpen) {
    const existingStoreIds = existing.stores.map(s => s.storeId);
    const overlappingStores = storeIds.filter(sid => existingStoreIds.includes(sid));
    if (overlappingStores.length === 0) continue;

    const existingChannels = existing.channels || [];
    const overlappingChannels = channels.filter(ch => existingChannels.includes(ch));
    if (overlappingChannels.length > 0) {
      return res.status(400).json({
        message: `Conflito: já existe caixa aberto ("${existing.label}") atendendo os mesmos canais/lojas`,
        conflictSessionId: existing.id,
        overlappingStores,
        overlappingChannels,
      });
    }
  }

  // Auto-suggest opening from last closed session of the same owner
  if (openingAmount == null) {
    try {
      const lastClosed = await prisma.cashSession.findFirst({
        where: { companyId, ownerId: userId, status: 'CLOSED' },
        orderBy: { closedAt: 'desc' },
      });
      if (lastClosed?.declaredValues) {
        const declared = lastClosed.declaredValues;
        for (const k of Object.keys(declared)) {
          const kl = String(k).toLowerCase();
          if (kl.includes('din') || kl.includes('cash') || kl.includes('money')) {
            openingAmount = Number(declared[k] || 0);
            break;
          }
        }
      }
    } catch (e) { /* ignore */ }
  }

  const amount = Number(openingAmount || 0);

  // Create session + stores + operators in a transaction
  const session = await prisma.$transaction(async (tx) => {
    const created = await tx.cashSession.create({
      data: {
        companyId,
        ownerId: userId,
        openedBy: userId,
        label,
        channels,
        openingAmount: amount,
        currentBalance: amount,
        openingNote: note || null,
        status: 'OPEN',
      },
    });

    // Create CashSessionStore records
    if (storeIds.length > 0) {
      await tx.cashSessionStore.createMany({
        data: storeIds.map(storeId => ({
          cashSessionId: created.id,
          storeId,
        })),
      });
    }

    // Create CashSessionOperator records
    if (operatorIds.length > 0) {
      await tx.cashSessionOperator.createMany({
        data: operatorIds.map(opId => ({
          cashSessionId: created.id,
          userId: opId,
          addedBy: userId,
        })),
      });
    }

    // Return full session with includes
    return tx.cashSession.findUnique({
      where: { id: created.id },
      include: {
        movements: true,
        stores: { include: { store: { select: { id: true, name: true } } } },
        operators: { include: { user: { select: { id: true, name: true } } } },
        owner: { select: { id: true, name: true } },
      },
    });
  });

  res.status(201).json(sessionToJSON(session));
});

// ─── POST /cash/operators — add operator to caller's open session ──────

cashRouter.post('/operators', async (req, res) => {
  const { companyId, id: userId } = req.user;
  if (!companyId) return res.status(400).json({ message: 'Usuário sem empresa' });

  const { userId: operatorUserId } = req.body || {};
  if (!operatorUserId) return res.status(400).json({ message: 'userId é obrigatório' });

  const session = await prisma.cashSession.findFirst({
    where: { companyId, status: 'OPEN', ownerId: userId },
  });
  if (!session) return res.status(400).json({ message: 'Nenhuma sessão de caixa aberta sob sua responsabilidade' });

  try {
    await prisma.cashSessionOperator.create({
      data: {
        cashSessionId: session.id,
        userId: operatorUserId,
        addedBy: userId,
      },
    });
  } catch (e) {
    if (e.code === 'P2002') {
      return res.status(400).json({ message: 'Operador já adicionado a esta sessão' });
    }
    throw e;
  }

  res.status(201).json({ ok: true });
});

// ─── DELETE /cash/operators/:userId — remove operator ──────────────────

cashRouter.delete('/operators/:userId', async (req, res) => {
  const { companyId, id: callerId } = req.user;
  if (!companyId) return res.status(400).json({ message: 'Usuário sem empresa' });

  const { userId: operatorUserId } = req.params;

  const session = await prisma.cashSession.findFirst({
    where: { companyId, status: 'OPEN', ownerId: callerId },
  });
  if (!session) return res.status(400).json({ message: 'Nenhuma sessão de caixa aberta sob sua responsabilidade' });

  const deleted = await prisma.cashSessionOperator.deleteMany({
    where: {
      cashSessionId: session.id,
      userId: operatorUserId,
    },
  });

  if (deleted.count === 0) {
    return res.status(404).json({ message: 'Operador não encontrado nesta sessão' });
  }

  res.json({ ok: true });
});

// ─── POST /cash/movement ──────────────────────────────────────────────

cashRouter.post('/movement', async (req, res) => {
  const { companyId, id: userId } = req.user;
  if (!companyId) return res.status(400).json({ message: 'Usuário sem empresa' });
  const { type, amount, account, note } = req.body || {};
  if (!type || !amount) return res.status(400).json({ message: 'type e amount são obrigatórios' });

  // Find session where user is owner or operator
  const session = await prisma.cashSession.findFirst({
    where: {
      companyId,
      status: 'OPEN',
      OR: [
        { ownerId: userId },
        { operators: { some: { userId } } },
      ],
    },
  });
  if (!session) return res.status(400).json({ message: 'Nenhuma sessão de caixa aberta' });

  // Normalize type
  const t = String(type).toLowerCase();
  const movementType = (t.includes('retir') || t.includes('withdraw'))
    ? 'WITHDRAWAL'
    : (t.includes('refor') || t.includes('reinfor') || t.includes('refo'))
      ? 'REINFORCEMENT'
      : 'ADJUSTMENT';

  const absAmount = Math.abs(Number(amount));
  const balanceDelta = movementType === 'WITHDRAWAL' ? -absAmount : absAmount;

  // Atomic: create movement + update balance
  const [movement, updatedSession] = await prisma.$transaction([
    prisma.cashMovement.create({
      data: {
        sessionId: session.id,
        type: movementType,
        amount: absAmount,
        note: note || null,
        createdBy: req.user.id,
        accountId: account || null,
      },
    }),
    prisma.cashSession.update({
      where: { id: session.id },
      data: { currentBalance: { increment: balanceDelta } },
      include: { movements: { orderBy: { createdAt: 'asc' } } },
    }),
  ]);

  res.json({ ok: true, session: sessionToJSON(updatedSession), movement: { ...movement, amount: Number(movement.amount) } });
});

// ─── POST /cash/close/finalize ─────────────────────────────────────────
// New wizard-based close endpoint

cashRouter.post('/close/finalize', async (req, res) => {
  const { companyId } = req.user;
  if (!companyId) return res.status(400).json({ message: 'Usuário sem empresa' });

  const { declaredValues, closingNote, blindClose, lastMinuteMovements } = req.body || {};

  const session = await prisma.cashSession.findFirst({
    where: { companyId, status: 'OPEN' },
    include: { movements: true },
  });
  if (!session) return res.status(400).json({ message: 'Nenhuma sessão de caixa aberta' });

  // Only the owner can close the session
  if (session.ownerId !== req.user.id) {
    return res.status(403).json({ message: 'Apenas o responsável pelo caixa pode fechá-lo' });
  }

  // 1. Register last-minute movements (sangrias/reforços from step 3)
  if (Array.isArray(lastMinuteMovements) && lastMinuteMovements.length > 0) {
    for (const lm of lastMinuteMovements) {
      const t = String(lm.type || '').toLowerCase();
      const mvType = (t.includes('retir') || t.includes('withdraw'))
        ? 'WITHDRAWAL'
        : (t.includes('refor') || t.includes('reinfor') || t.includes('refo'))
          ? 'REINFORCEMENT'
          : 'ADJUSTMENT';
      const absAmt = Math.abs(Number(lm.amount || 0));
      const delta = mvType === 'WITHDRAWAL' ? -absAmt : absAmt;

      await prisma.$transaction([
        prisma.cashMovement.create({
          data: {
            sessionId: session.id,
            type: mvType,
            amount: absAmt,
            note: lm.note || null,
            createdBy: req.user.id,
          },
        }),
        prisma.cashSession.update({
          where: { id: session.id },
          data: { currentBalance: { increment: delta } },
        }),
      ]);
    }
  }

  // 2. Reload session with all movements
  const freshSession = await prisma.cashSession.findUnique({
    where: { id: session.id },
    include: { movements: true },
  });

  // 3. Calculate expected values
  const { expectedValues, paymentsByMethod, totalWithdrawals, totalReinforcements } =
    await calculateExpectedValues(freshSession);

  // 4. Calculate differences
  const differences = calculateDifferences(declaredValues || {}, expectedValues);

  const closedAt = new Date();

  // 5. Close session
  const closedSession = await prisma.cashSession.update({
    where: { id: session.id },
    data: {
      status: 'CLOSED',
      closedAt,
      closedBy: req.user.id,
      closingNote: closingNote || null,
      blindClose: blindClose || false,
      declaredValues: declaredValues || {},
      expectedValues,
      differences,
    },
    include: { movements: { orderBy: { createdAt: 'asc' } } },
  });

  // 6. Financial bridge (non-blocking)
  try {
    await createFinancialEntriesForCashSession({
      ...closedSession,
      differences,
      companyId,
    });
  } catch (e) {
    console.error('Cash close financial bridge error:', e?.message || e);
  }

  res.json({
    ok: true,
    session: sessionToJSON(closedSession),
    summary: {
      paymentsByMethod,
      expectedValues,
      declaredValues: declaredValues || {},
      differences,
      totalWithdrawals,
      totalReinforcements,
    },
  });
});

// ─── POST /cash/close (legacy - backwards compatible) ─────────────────

cashRouter.post('/close', async (req, res) => {
  const { companyId } = req.user;
  if (!companyId) return res.status(400).json({ message: 'Usuário sem empresa' });
  const { closingSummary } = req.body || {};

  const session = await prisma.cashSession.findFirst({
    where: { companyId, status: 'OPEN' },
    include: { movements: true },
  });
  if (!session) return res.status(400).json({ message: 'Nenhuma sessão de caixa aberta' });

  // Only the owner can close the session
  if (session.ownerId !== req.user.id) {
    return res.status(403).json({ message: 'Apenas o responsável pelo caixa pode fechá-lo' });
  }

  // Parse legacy closingSummary
  let parsed = closingSummary;
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed); } catch (e) { /* keep as-is */ }
  }

  const declaredValues = parsed?.counted || null;

  // Calculate expected + differences if we have declared values
  let expectedValues = null;
  let differences = null;
  if (declaredValues) {
    const result = await calculateExpectedValues(session);
    expectedValues = result.expectedValues;
    differences = calculateDifferences(declaredValues, expectedValues);
  }

  const closedSession = await prisma.cashSession.update({
    where: { id: session.id },
    data: {
      status: 'CLOSED',
      closedAt: new Date(),
      closedBy: req.user.id,
      closingNote: parsed?.note || null,
      declaredValues,
      expectedValues,
      differences,
    },
    include: { movements: { orderBy: { createdAt: 'asc' } } },
  });

  // Financial bridge (non-blocking)
  if (differences) {
    try {
      await createFinancialEntriesForCashSession({
        ...closedSession,
        differences,
        companyId,
      });
    } catch (e) {
      console.error('Cash close (legacy) financial bridge error:', e?.message || e);
    }
  }

  res.json({ ok: true, session: sessionToJSON(closedSession) });
});

// ─── GET /cash/sessions ────────────────────────────────────────────────

cashRouter.get('/sessions', async (req, res) => {
  const { companyId } = req.user;
  if (!companyId) return res.status(400).json({ message: 'Usuário sem empresa' });

  const sessions = await prisma.cashSession.findMany({
    where: { companyId },
    include: {
      movements: { orderBy: { createdAt: 'asc' } },
      owner: { select: { id: true, name: true } },
      stores: { include: { store: { select: { id: true, name: true } } } },
      operators: { include: { user: { select: { id: true, name: true } } } },
    },
    orderBy: { openedAt: 'desc' },
    take: 50,
  });

  // Enrich each session with payment summary
  const enriched = await Promise.all(sessions.map(async (s) => {
    const session = sessionToJSON(s);

    try {
      const { expectedValues, paymentsByMethod, totalWithdrawals, totalReinforcements } =
        await calculateExpectedValues(s);

      const opening = Number(s.openingAmount || 0);
      const cashPayments = Number(paymentsByMethod['Dinheiro'] || 0);
      const expectedBalance = opening + cashPayments + totalReinforcements - totalWithdrawals;

      session.summary = {
        paymentsByMethod,
        inRegisterByMethod: expectedValues,
        totalPayments: Object.values(paymentsByMethod).reduce((sum, v) => sum + Number(v || 0), 0),
        totalWithdrawals,
        totalReinforcements,
        expectedBalance,
      };
    } catch (e) {
      console.warn('Failed to compute summary for session', s.id, e?.message);
      session.summary = null;
    }

    return session;
  }));

  res.json(enriched);
});

// ─── GET /cash/summary/current ─────────────────────────────────────────

cashRouter.get('/summary/current', async (req, res) => {
  const { companyId, id: userId } = req.user;
  if (!companyId) return res.status(400).json({ message: 'Usuário sem empresa' });

  const session = await prisma.cashSession.findFirst({
    where: {
      companyId,
      status: 'OPEN',
      OR: [
        { ownerId: userId },
        { operators: { some: { userId } } },
      ],
    },
    include: { movements: true },
  });
  if (!session) return res.json(null);

  try {
    const { expectedValues, paymentsByMethod, totalWithdrawals, totalReinforcements } =
      await calculateExpectedValues(session);

    const opening = Number(session.openingAmount || 0);
    const cashPayments = Number(paymentsByMethod['Dinheiro'] || 0);
    const expectedBalance = opening + cashPayments + totalReinforcements - totalWithdrawals;

    res.json({
      paymentsByMethod,
      inRegisterByMethod: expectedValues,
      totalPayments: Object.values(paymentsByMethod).reduce((sum, v) => sum + Number(v || 0), 0),
      totalWithdrawals,
      totalReinforcements,
      expectedBalance,
    });
  } catch (e) {
    console.error('summary/current error:', e);
    res.status(500).json({ message: 'Erro ao calcular resumo' });
  }
});

// ─── GET /cash/settings ────────────────────────────────────────────────

cashRouter.get('/settings', async (req, res) => {
  const { companyId } = req.user;
  if (!companyId) return res.status(400).json({ message: 'Usuário sem empresa' });

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { cashBlindCloseDefault: true },
  });

  res.json({ blindCloseDefault: company?.cashBlindCloseDefault || false });
});

// ─── PUT /cash/settings ────────────────────────────────────────────────

cashRouter.put('/settings', async (req, res) => {
  const { companyId } = req.user;
  if (!companyId) return res.status(400).json({ message: 'Usuário sem empresa' });

  const { blindCloseDefault } = req.body || {};

  await prisma.company.update({
    where: { id: companyId },
    data: { cashBlindCloseDefault: blindCloseDefault === true },
  });

  res.json({ ok: true, blindCloseDefault: blindCloseDefault === true });
});

export default cashRouter;
