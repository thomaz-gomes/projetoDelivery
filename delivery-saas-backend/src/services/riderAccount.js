import { prisma } from '../prisma.js';

function toDateOnly(d) {
  const dt = new Date(d);
  dt.setHours(0, 0, 0, 0);
  return dt;
}

export async function findNeighborhoodForName(companyId, candidateName) {
  if (!candidateName) return null;
  const needle = String(candidateName).trim().toLowerCase();

  // fetch all neighborhoods for company and do matching in JS (aliases are JSON)
  const neighborhoods = await prisma.neighborhood.findMany({ where: { companyId } });

  // exact name match (case-insensitive)
  let found = neighborhoods.find(n => String(n.name || '').trim().toLowerCase() === needle);
  if (found) return found;

  // search aliases (aliases stored as JSON array)
  for (const n of neighborhoods) {
    if (!n.aliases) continue;
    try {
      const arr = Array.isArray(n.aliases) ? n.aliases : JSON.parse(n.aliases);
      if (arr.some(a => String(a || '').trim().toLowerCase() === needle)) return n;
    } catch (e) {
      // ignore parse errors
    }
  }

  return null;
}

export async function addRiderTransaction({ companyId, riderId, orderId = null, amount = 0, type = 'DELIVERY_FEE', date = new Date(), note = null }) {
  if (!riderId) return null;

  const t = await prisma.riderTransaction.create({
    data: {
      riderId,
      orderId,
      type,
      amount,
      date,
      note,
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
  const dayStart = toDateOnly(orderDate);
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
    const bonusDayStart = toDateOnly(orderDate);
    const bonusDayEnd = new Date(bonusDayStart);
    bonusDayEnd.setDate(bonusDayEnd.getDate() + 1);

    // Find today's check-ins for this rider
    const todayCheckins = await prisma.riderCheckin.findMany({
      where: { riderId, checkinAt: { gte: bonusDayStart, lt: bonusDayEnd } }
    });
    if (todayCheckins.length === 0) return;

    // Find active EARLY_CHECKIN bonus rules for this company
    const bonusRules = await prisma.riderBonusRule.findMany({
      where: { companyId, type: 'EARLY_CHECKIN', active: true }
    });

    for (const rule of bonusRules) {
      const [deadlineH, deadlineM] = rule.deadlineTime.split(':').map(Number);
      const qualifies = todayCheckins.some(c => {
        if (rule.shiftId && c.shiftId !== rule.shiftId) return false;
        const checkinDate = new Date(c.checkinAt);
        const checkinMinutes = checkinDate.getHours() * 60 + checkinDate.getMinutes();
        const deadlineMinutes = deadlineH * 60 + deadlineM;
        return checkinMinutes <= deadlineMinutes;
      });

      if (qualifies) {
        await addRiderTransaction({
          companyId,
          riderId,
          orderId,
          amount: Number(rule.bonusAmount),
          type: 'EARLY_CHECKIN_BONUS',
          date: orderDate,
          note: `Bônus: ${rule.name}`
        });
      }
    }
  } catch (e) {
    console.warn('[riderAccount] bonus check failed:', e?.message || e);
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
  getRiderBalance,
};
