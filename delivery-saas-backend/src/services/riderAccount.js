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
  await addRiderTransaction({ companyId, riderId, orderId, amount: riderFee, type: 'DELIVERY_FEE', date: orderDate, note: `Delivery fee for neighborhood ${neigh?.name || 'unknown'}` });

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
    await addRiderTransaction({ companyId, riderId, orderId: null, amount: daily, type: 'DAILY_RATE', date: orderDate, note: 'Daily rate' });
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
