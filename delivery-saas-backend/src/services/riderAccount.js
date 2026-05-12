import { prisma } from '../prisma.js';
import { findNeighborhoodMatch } from '../utils/neighborhoodMatch.js';

const BRT_OFFSET_MS = 3 * 60 * 60 * 1000; // UTC-3

// Returns the start of the BRT (UTC-3) calendar day as a UTC Date.
// e.g. 22:04 BRT = 01:04 UTC next day → same BRT day as 20:27 BRT = 23:27 UTC.
function toDateOnlyBRT(d) {
  const brtMs = new Date(d).getTime() - BRT_OFFSET_MS;
  const brtMidnight = new Date(brtMs);
  brtMidnight.setUTCHours(0, 0, 0, 0);
  return new Date(brtMidnight.getTime() + BRT_OFFSET_MS); // back to UTC boundary
}

export async function findNeighborhoodForName(companyId, candidateName) {
  if (!candidateName) return null;
  const neighborhoods = await prisma.neighborhood.findMany({ where: { companyId } });
  return findNeighborhoodMatch(neighborhoods, candidateName);
}

export async function addRiderTransaction({ companyId, riderId, orderId = null, amount = 0, type = 'DELIVERY_FEE', date = new Date(), note = null, status = null }) {
  if (!riderId) return null;

  // Status default: payment offsets (negative MANUAL_ADJUSTMENT created by
  // /account/pay) land already PAID — they are themselves the "paid" record.
  // Everything else (delivery fees, daily rates, bonuses, manual credits)
  // starts PENDING. Callers can override explicitly when needed.
  let resolvedStatus = status;
  if (!resolvedStatus) {
    resolvedStatus = (type === 'MANUAL_ADJUSTMENT' && Number(amount) < 0) ? 'PAID' : 'PENDING';
  }

  const t = await prisma.riderTransaction.create({
    data: {
      riderId,
      orderId,
      type,
      amount,
      date,
      note,
      status: resolvedStatus,
      paidAt: resolvedStatus === 'PAID' ? new Date() : null,
    },
  });

  // update or create RiderAccount
  const existing = await prisma.riderAccount.findUnique({ where: { riderId } });
  if (existing) {
    await prisma.riderAccount.update({ where: { riderId }, data: { balance: { increment: amount } } });
  } else {
    await prisma.riderAccount.create({ data: { riderId, balance: amount } });
  }

  return t;
}

export async function addDeliveryAndDailyIfNeeded({ companyId, riderId, orderId, neighborhoodName, orderDate }) {
  // Skip if delivery fee already credited for this order (prevents double-credit from complete + CONCLUIDO)
  if (orderId) {
    const existing = await prisma.riderTransaction.findFirst({
      where: { riderId, orderId, type: 'DELIVERY_FEE' }
    });
    if (existing) return;
  }

  // find neighborhood and amount
  let riderFee = 0;
  const neigh = await findNeighborhoodForName(companyId, neighborhoodName);
  if (neigh) {
    riderFee = Number(neigh.riderFee || 0);
  }

  // add delivery fee transaction (even if zero, recording helps)
  await addRiderTransaction({ companyId, riderId, orderId, amount: riderFee, type: 'DELIVERY_FEE', date: orderDate, note: `Taxa de entrega para bairro ${neigh?.name || 'desconhecido'}` });

  // check daily rate for rider
  const rider = await prisma.rider.findUnique({ where: { id: riderId } });
  if (!rider) return;

  const daily = Number(rider.dailyRate || 0);
  if (daily <= 0) return;

  // check if there is any DAILY_RATE transaction for this rider on the date
  const dayStart = toDateOnlyBRT(orderDate);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  const existingDaily = await prisma.riderTransaction.findFirst({
    where: {
      riderId,
      type: 'DAILY_RATE',
      date: { gte: dayStart, lt: dayEnd },
    },
  });

  if (!existingDaily) {
    await addRiderTransaction({ companyId, riderId, orderId: null, amount: daily, type: 'DAILY_RATE', date: orderDate, note: 'Diária' });
  }

  // Check early check-in bonus rules (per delivery, never on daily rate alone)
  if (riderFee <= 0) return; // no delivery fee = no bonus
  try {
    await generateMissingCheckinBonusesForDay({ companyId, riderId, date: orderDate });
  } catch (e) {
    console.warn('[riderAccount] bonus check failed:', e?.message || e);
  }
}

// For a given rider+day, ensures each qualifying DELIVERY_FEE transaction has
// the corresponding EARLY_CHECKIN_BONUS rows for every active rule whose
// deadline is met by at least one check-in that day. Idempotent — existing
// bonuses (same orderId + rule note) are skipped.
//
// Called from:
//   - addDeliveryAndDailyIfNeeded (after a new delivery fee is created)
//   - riders.js check-in creation (so deliveries already booked earlier in
//     the day retroactively receive the bonus once the rider checks in)
export async function generateMissingCheckinBonusesForDay({ companyId, riderId, date }) {
  if (!companyId || !riderId || !date) return;

  const dayStart = toDateOnlyBRT(date);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  const todayCheckins = await prisma.riderCheckin.findMany({
    where: { riderId, checkinAt: { gte: dayStart, lt: dayEnd } },
  });
  if (todayCheckins.length === 0) return;

  const bonusRules = await prisma.riderBonusRule.findMany({
    where: { companyId, type: 'EARLY_CHECKIN', active: true },
  });
  if (bonusRules.length === 0) return;

  // All delivery fees this rider booked today that we may need to bonus.
  const deliveryTxs = await prisma.riderTransaction.findMany({
    where: {
      riderId,
      type: 'DELIVERY_FEE',
      date: { gte: dayStart, lt: dayEnd },
      amount: { gt: 0 },
      status: { not: 'CANCELLED' },
    },
  });
  if (deliveryTxs.length === 0) return;

  // Pre-load existing bonuses for this day to ensure idempotency.
  // We INCLUDE CANCELLED rows here on purpose: if an admin previously
  // cancelled a bonus for a given delivery+rule, we must not silently
  // recreate it during a backfill — that would undo their decision.
  const existingBonuses = await prisma.riderTransaction.findMany({
    where: {
      riderId,
      type: 'EARLY_CHECKIN_BONUS',
      date: { gte: dayStart, lt: dayEnd },
    },
    select: { orderId: true, note: true, status: true },
  });
  const existingKey = new Set(existingBonuses.map((b) => `${b.orderId || ''}::${b.note || ''}`));

  for (const rule of bonusRules) {
    const [deadlineH, deadlineM] = String(rule.deadlineTime || '').split(':').map(Number);
    if (!Number.isFinite(deadlineH) || !Number.isFinite(deadlineM)) continue;
    const deadlineMinutes = deadlineH * 60 + deadlineM;

    const qualifies = todayCheckins.some((c) => {
      if (rule.shiftId && c.shiftId !== rule.shiftId) return false;
      const brtDate = new Date(new Date(c.checkinAt).getTime() - BRT_OFFSET_MS);
      const checkinMinutes = brtDate.getUTCHours() * 60 + brtDate.getUTCMinutes();
      return checkinMinutes <= deadlineMinutes;
    });
    if (!qualifies) continue;

    const note = `Bônus: ${rule.name}`;
    for (const dlv of deliveryTxs) {
      if (!dlv.orderId) continue;
      const key = `${dlv.orderId}::${note}`;
      if (existingKey.has(key)) continue;
      await addRiderTransaction({
        companyId,
        riderId,
        orderId: dlv.orderId,
        amount: Number(rule.bonusAmount),
        type: 'EARLY_CHECKIN_BONUS',
        date: dlv.date,
        note,
      });
      existingKey.add(key);
    }
  }
}

export async function getRiderBalance(riderId) {
  const acct = await prisma.riderAccount.findUnique({ where: { riderId } });
  return acct?.balance || 0;
}

export default {
  findNeighborhoodForName,
  addRiderTransaction,
  addDeliveryAndDailyIfNeeded,
  generateMissingCheckinBonusesForDay,
  getRiderBalance,
};
