import { prisma } from '../../prisma.js';

/**
 * Normaliza nome de forma de pagamento para exibição consistente.
 * Usa correspondências exatas/prefixadas para evitar falsos positivos
 * (ex: "cashback" não deve virar "Dinheiro", "credito" não deve virar "Cartão" antes de "Débito").
 */
export function normalizeMethod(name) {
  if (!name) return 'Outros';
  const s = String(name).toLowerCase().trim();

  // Cash — correspondências explícitas, não substring genérica (evita "cashback")
  if (s === 'dinheiro' || s === 'cash' || s === 'money' || s === 'din'
    || s.startsWith('dinheiro') || s === 'fisico' || s === 'físico') return 'Dinheiro';

  // PIX
  if (s === 'pix' || s.startsWith('pix')) return 'PIX';

  // Débito — antes de "Cartão" pois "débito" contém "cred" às vezes em variações
  if (s === 'debit' || s === 'debito' || s === 'débito'
    || s.startsWith('debit') || s.includes('débito') || s.includes('debito')) return 'Débito';

  // Cartão de crédito
  if (s === 'credit' || s === 'credito' || s === 'crédito' || s === 'credit_card'
    || s.includes('crédito') || s.includes('credito') || s.includes('cred')
    || s === 'card' || s.includes('cartao') || s.includes('cartão')) return 'Cartão';

  // Pagamento digital / carteira
  if (s.includes('digital') || s.includes('wallet') || s.includes('carteira')) return 'Pagamento Digital';

  // Voucher / Vale
  if (s.includes('voucher') || s.includes('vale') || s.includes('meal') || s.includes('food_voucher')) return 'Voucher';

  // Online / prepago
  if (s === 'online' || s.includes('online') || s === 'prepaid' || s === 'prepago') return 'Pagamento Online';

  // Outros explícitos
  if (s === 'other' || s === 'others' || s === 'outros' || s === 'outro') return 'Outros';

  return String(name).trim();
}

/**
 * Extrai a lista de pagamentos de um order payload independente da origem
 * @public — também usada pelo endpoint orders-by-method
 * (paymentConfirmed manual, payload.payment legacy, ou estrutura iFood).
 */
export function extractPayments(payload, orderTotal) {
  // 1. paymentConfirmed definido explicitamente pelo operador (prioridade máxima)
  if (Array.isArray(payload.paymentConfirmed) && payload.paymentConfirmed.length > 0) {
    return payload.paymentConfirmed;
  }
  if (typeof payload.paymentConfirmed === 'string') {
    try {
      const parsed = JSON.parse(payload.paymentConfirmed);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch { /* ignore */ }
  }

  // 2. Estrutura iFood: payload.order.payments.methods
  const ifoodMethods = payload.order?.payments?.methods;
  if (Array.isArray(ifoodMethods) && ifoodMethods.length > 0) {
    return ifoodMethods.map(m => ({
      method: m.method || m.type || 'Outros',
      amount: Number(m.value ?? m.amount ?? 0),
    }));
  }

  // 3. payload.payments.methods (outras plataformas)
  const altMethods = payload.payments?.methods;
  if (Array.isArray(altMethods) && altMethods.length > 0) {
    return altMethods.map(m => ({
      method: m.method || m.type || 'Outros',
      amount: Number(m.value ?? m.amount ?? 0),
    }));
  }

  // 4. Pagamento único legado: payload.payment
  if (payload.payment && typeof payload.payment === 'object') {
    return [payload.payment];
  }

  // 5. Sem informação de pagamento — retorna null para pular o pedido
  return null;
}

/**
 * Agrega pagamentos por forma de pagamento a partir de pedidos concluídos vinculados a uma sessão de caixa.
 * @returns {{ [method: string]: number }} Ex: { "Dinheiro": 150.50, "PIX": 200.00 }
 */
export async function aggregatePaymentsByMethod(sessionId, companyId) {
  const orders = await prisma.order.findMany({
    where: {
      companyId,
      cashSessionId: sessionId,
      status: 'CONCLUIDO',
    },
    select: { payload: true, total: true },
  });

  const byMethodCents = {};
  for (const o of orders) {
    try {
      const payload = o.payload || {};
      const payments = extractPayments(payload, o.total);
      if (!Array.isArray(payments)) continue;

      for (const p of payments) {
        const raw = (p && (p.method || p.methodCode || p.name)) || 'Outros';
        const method = normalizeMethod(raw);
        const amt = (p && p.amount != null) ? Number(p.amount) : (o.total != null ? Number(o.total) : 0);
        byMethodCents[method] = (byMethodCents[method] || 0) + Math.round((Number(amt) || 0) * 100);
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
  const paymentsByMethod = await aggregatePaymentsByMethod(session.id, session.companyId);

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
