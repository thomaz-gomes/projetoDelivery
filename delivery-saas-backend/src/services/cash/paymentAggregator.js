import { prisma } from '../../prisma.js';

/**
 * Normaliza nome de forma de pagamento para exibição consistente.
 */
export function normalizeMethod(name) {
  if (!name) return 'Outros';
  const s = String(name).toLowerCase();
  if (s.includes('din') || s.includes('cash') || s.includes('money') || s.includes('dinheiro')) return 'Dinheiro';
  if (s.includes('pix')) return 'PIX';
  if (s.includes('card') || s.includes('cartao') || s.includes('credito') || s.includes('cred')) return 'Cartão';
  return String(name).trim();
}

/**
 * Agrega pagamentos por forma de pagamento a partir de pedidos concluídos em um período.
 * @returns {{ [method: string]: number }} Ex: { "Dinheiro": 150.50, "PIX": 200.00 }
 */
export async function aggregatePaymentsByMethod(companyId, startDate, endDate) {
  const where = { companyId, status: 'CONCLUIDO' };
  if (startDate || endDate) {
    where.updatedAt = {};
    if (startDate) where.updatedAt.gte = new Date(startDate);
    if (endDate) where.updatedAt.lte = new Date(endDate);
  }

  const orders = await prisma.order.findMany({
    where,
    select: { id: true, payload: true, total: true },
  });

  const byMethodCents = {};
  for (const o of orders) {
    try {
      const payload = o.payload || {};
      let confirmed = null;
      if (Array.isArray(payload.paymentConfirmed)) confirmed = payload.paymentConfirmed;
      else if (payload.payment) confirmed = [payload.payment];
      else if (typeof payload.paymentConfirmed === 'string') {
        try { confirmed = JSON.parse(payload.paymentConfirmed); } catch (e) { confirmed = null; }
      }
      if (Array.isArray(confirmed)) {
        for (const p of confirmed) {
          const raw = (p && (p.method || p.methodCode || p.name)) ? (p.method || p.methodCode || p.name) : 'Outros';
          const method = normalizeMethod(raw);
          const amt = (p && p.amount != null) ? Number(p.amount) : (o.total != null ? Number(o.total) : 0);
          byMethodCents[method] = (byMethodCents[method] || 0) + Math.round((Number(amt) || 0) * 100);
        }
      }
    } catch (e) { /* per-order parse error, skip */ }
  }

  const result = {};
  for (const [m, cents] of Object.entries(byMethodCents)) result[m] = cents / 100;
  return result;
}

/**
 * Calcula os valores esperados em caixa por forma de pagamento para uma sessão.
 * Dinheiro: abertura + recebimentos dinheiro + reforços - sangrias
 * Outros: total de pagamentos no período
 */
export async function calculateExpectedValues(session) {
  const paymentsByMethod = await aggregatePaymentsByMethod(
    session.companyId,
    session.openedAt,
    session.closedAt || new Date()
  );

  // Agregar movimentos da sessão
  const movements = await prisma.cashMovement.findMany({ where: { sessionId: session.id } });
  let totalWithdrawals = 0;
  let totalReinforcements = 0;
  for (const mv of movements) {
    if (mv.type === 'WITHDRAWAL') totalWithdrawals += Number(mv.amount || 0);
    else if (mv.type === 'REINFORCEMENT') totalReinforcements += Number(mv.amount || 0);
  }

  const opening = Number(session.openingAmount || 0);
  const expected = {};

  for (const [m, v] of Object.entries(paymentsByMethod)) {
    const isCash = m === 'Dinheiro';
    if (isCash) {
      expected[m] = opening + Number(v || 0) + totalReinforcements - totalWithdrawals;
    } else {
      expected[m] = Number(v || 0);
    }
  }

  // Garantir que Dinheiro existe mesmo sem pagamentos
  if (!expected['Dinheiro']) {
    expected['Dinheiro'] = opening + totalReinforcements - totalWithdrawals;
  }

  return {
    expectedValues: expected,
    paymentsByMethod,
    totalWithdrawals,
    totalReinforcements,
  };
}

/**
 * Calcula diferenças entre valores declarados e esperados.
 * Positivo = sobra, Negativo = quebra
 */
export function calculateDifferences(declaredValues, expectedValues) {
  const allMethods = new Set([
    ...Object.keys(declaredValues || {}),
    ...Object.keys(expectedValues || {}),
  ]);
  const differences = {};
  for (const method of allMethods) {
    const declared = Number(declaredValues?.[method] || 0);
    const expected = Number(expectedValues?.[method] || 0);
    differences[method] = Number((declared - expected).toFixed(2));
  }
  return differences;
}
