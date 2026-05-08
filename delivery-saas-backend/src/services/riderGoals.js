import { prisma } from '../prisma.js';
import {
  startOfDayInTz, dayKeyInTz, weekdayInTz, hourInTz, timeStrInTz,
} from '../utils/dateTz.js';

const DEFAULT_TZ = 'America/Sao_Paulo';
const DAY_MS = 24 * 60 * 60 * 1000;

async function getCompanyTimezone(companyId) {
  if (!companyId) return DEFAULT_TZ;
  try {
    const c = await prisma.company.findUnique({ where: { id: companyId }, select: { timezone: true } });
    return c?.timezone || DEFAULT_TZ;
  } catch (e) {
    return DEFAULT_TZ;
  }
}

// ---------------------------------------------------------------------------
// 1. getCurrentCycle(goal, referenceDate, tz)
// ---------------------------------------------------------------------------
// Returns the active goal cycle (start/end) in the company's timezone. Without
// the timezone the WEEKLY/MONTHLY cycles would snap to the container's UTC
// midnight — for a Brazilian merchant the cycle would shift 3h, with the last
// 3 hours of Sunday counting toward the next week's stats.
export function getCurrentCycle(goal, referenceDate = new Date(), tz = DEFAULT_TZ) {
  const ref = new Date(referenceDate);

  if (goal.periodType === 'FIXED') {
    return {
      start: new Date(goal.startDate),
      end: goal.endDate ? new Date(goal.endDate) : null,
    };
  }

  if (goal.periodType === 'WEEKLY') {
    // ISO week — Monday through Sunday — anchored on the company's timezone.
    const todayKey = dayKeyInTz(ref, tz);
    const dow = weekdayInTz(ref, tz); // 0=Sun … 6=Sat
    const diffToMonday = dow === 0 ? -6 : 1 - dow;
    const todayStart = startOfDayInTz(todayKey, tz);
    const start = new Date(todayStart.getTime() + diffToMonday * DAY_MS);
    const end = new Date(start.getTime() + 7 * DAY_MS - 1);
    return { start, end };
  }

  if (goal.periodType === 'MONTHLY') {
    const todayKey = dayKeyInTz(ref, tz);
    const yearMonth = todayKey.slice(0, 7); // "YYYY-MM"
    const [y, m] = yearMonth.split('-').map(Number);
    const start = startOfDayInTz(`${yearMonth}-01`, tz);
    const nextM = m === 12 ? 1 : m + 1;
    const nextY = m === 12 ? y + 1 : y;
    const nextFirst = `${String(nextY).padStart(4, '0')}-${String(nextM).padStart(2, '0')}-01`;
    const end = new Date(startOfDayInTz(nextFirst, tz).getTime() - 1);
    return { start, end };
  }

  // fallback
  return { start: new Date(goal.startDate), end: goal.endDate ? new Date(goal.endDate) : null };
}

// ---------------------------------------------------------------------------
// 2. calculateProgress(goal, riderId, companyId, tz)
// ---------------------------------------------------------------------------
export async function calculateProgress(goal, riderId, companyId, tz) {
  const effectiveTz = tz || await getCompanyTimezone(companyId);
  const { start: cycleStart, end: cycleEnd } = getCurrentCycle(goal, new Date(), effectiveTz);

  const dateFilter = {};
  if (cycleStart) dateFilter.gte = cycleStart;
  if (cycleEnd) dateFilter.lte = cycleEnd;

  const target = Number(goal.ruleValue);
  let current = 0;
  let unit = '';

  switch (goal.ruleType) {
    case 'DELIVERY_COUNT': {
      unit = 'entregas';
      current = await prisma.order.count({
        where: {
          riderId,
          companyId,
          status: 'CONCLUIDO',
          updatedAt: dateFilter,
        },
      });
      break;
    }

    case 'AVG_DELIVERY_TIME': {
      unit = 'min';
      const orders = await prisma.order.findMany({
        where: {
          riderId,
          companyId,
          status: 'CONCLUIDO',
          departedAt: { not: null },
          completedAt: { not: null },
          updatedAt: dateFilter,
        },
        select: { departedAt: true, completedAt: true },
      });

      if (orders.length > 0) {
        const totalMinutes = orders.reduce((sum, o) => {
          const diff = (new Date(o.completedAt) - new Date(o.departedAt)) / 60000;
          return sum + diff;
        }, 0);
        current = Math.round((totalMinutes / orders.length) * 100) / 100;
      }
      break;
    }

    case 'CANCELLATION_RATE': {
      unit = '%';
      const [concluido, cancelado] = await Promise.all([
        prisma.order.count({
          where: { riderId, companyId, status: 'CONCLUIDO', updatedAt: dateFilter },
        }),
        prisma.order.count({
          where: { riderId, companyId, status: 'CANCELADO', updatedAt: dateFilter },
        }),
      ]);
      const total = concluido + cancelado;
      current = total > 0 ? Math.round((cancelado / total) * 10000) / 100 : 0;
      break;
    }

    case 'CODE_COMPLETION_RATE': {
      unit = '%';
      const completedOrders = await prisma.order.findMany({
        where: {
          riderId,
          companyId,
          status: 'CONCLUIDO',
          updatedAt: dateFilter,
        },
        select: { closedByIfoodCode: true },
      });
      const totalCompleted = completedOrders.length;
      if (totalCompleted > 0) {
        const withCode = completedOrders.filter(o => o.closedByIfoodCode).length;
        current = Math.round((withCode / totalCompleted) * 10000) / 100;
      }
      break;
    }

    case 'CONSECUTIVE_CHECKINS': {
      unit = 'dias';
      // Find active bonus rules for this company to get deadlineTime
      const bonusRules = await prisma.riderBonusRule.findMany({
        where: { companyId, type: 'EARLY_CHECKIN', active: true },
      });

      const checkins = await prisma.riderCheckin.findMany({
        where: {
          riderId,
          companyId,
          checkinAt: dateFilter,
        },
        orderBy: { checkinAt: 'asc' },
      });

      if (checkins.length === 0) break;

      // Group check-ins by date (in the company's tz), only counting those
      // before the deadline. Without tz-aware time/day computation, a 22h-BRT
      // check-in would be classified as 01h next-day-UTC and miss the deadline
      // window or land in the wrong calendar day.
      const checkinDays = new Set();
      for (const c of checkins) {
        const dt = new Date(c.checkinAt);
        const timeStr = timeStrInTz(dt, effectiveTz);

        // Find matching bonus rule (by shiftId or any rule)
        const matchingRule = bonusRules.find(r => !r.shiftId || r.shiftId === c.shiftId)
          || bonusRules[0];

        if (!matchingRule || timeStr <= matchingRule.deadlineTime) {
          checkinDays.add(dayKeyInTz(dt, effectiveTz));
        }
      }

      // Calculate max consecutive days using the tz day boundaries.
      const sortedDays = [...checkinDays].sort().map(k => startOfDayInTz(k, effectiveTz));

      let maxConsecutive = 0;
      let consecutive = 0;
      for (let i = 0; i < sortedDays.length; i++) {
        if (i === 0) {
          consecutive = 1;
        } else {
          const diff = (sortedDays[i] - sortedDays[i - 1]) / DAY_MS;
          // Tolerate DST transitions (~23h or ~25h) when the host tz observes DST.
          consecutive = (diff >= 0.9 && diff <= 1.1) ? consecutive + 1 : 1;
        }
        maxConsecutive = Math.max(maxConsecutive, consecutive);
      }
      current = maxConsecutive;
      break;
    }
  }

  // Percentage calculation based on ruleOperator
  let percentage = 0;
  let achieved = false;

  if (goal.ruleOperator === 'GTE') {
    percentage = target > 0 ? Math.min(100, Math.round((current / target) * 10000) / 100) : 100;
    achieved = current >= target;
  } else if (goal.ruleOperator === 'LTE') {
    if (current <= target) {
      percentage = 100;
      achieved = true;
    } else {
      percentage = target > 0
        ? Math.max(0, Math.round((target / current) * 10000) / 100)
        : 0;
    }
  }

  return {
    current,
    target,
    percentage,
    achieved,
    unit,
    cycleStart,
    cycleEnd,
  };
}

// ---------------------------------------------------------------------------
// 3. calculateDifficulty(goal, companyId, tz)
// ---------------------------------------------------------------------------
export async function calculateDifficulty(goal, companyId, tz) {
  const effectiveTz = tz || await getCompanyTimezone(companyId);
  const todayKey = dayKeyInTz(new Date(), effectiveTz);
  // 90 days back, anchored on the company's tz midnight (close enough to "3 months").
  const threeMonthsAgo = new Date(startOfDayInTz(todayKey, effectiveTz).getTime() - 90 * DAY_MS);

  const target = Number(goal.ruleValue);

  switch (goal.ruleType) {
    case 'DELIVERY_COUNT': {
      // avg deliveries per rider per month
      const riders = await prisma.rider.findMany({
        where: { companyId },
        select: { id: true },
      });
      if (riders.length === 0) return 2;

      const totalDeliveries = await prisma.order.count({
        where: {
          companyId,
          status: 'CONCLUIDO',
          updatedAt: { gte: threeMonthsAgo },
          riderId: { not: null },
        },
      });

      const avgPerRiderPerMonth = totalDeliveries / riders.length / 3;
      if (avgPerRiderPerMonth === 0) return 2;

      const ratio = target / avgPerRiderPerMonth;
      if (ratio <= 0.8) return 1;
      if (ratio <= 1.2) return 2;
      return 3;
    }

    case 'AVG_DELIVERY_TIME': {
      const orders = await prisma.order.findMany({
        where: {
          companyId,
          status: 'CONCLUIDO',
          departedAt: { not: null },
          completedAt: { not: null },
          updatedAt: { gte: threeMonthsAgo },
        },
        select: { departedAt: true, completedAt: true },
      });

      if (orders.length === 0) return 2;

      const totalMinutes = orders.reduce((sum, o) => {
        return sum + (new Date(o.completedAt) - new Date(o.departedAt)) / 60000;
      }, 0);
      const avgTime = totalMinutes / orders.length;
      if (avgTime === 0) return 2;

      const ratio = target / avgTime;
      // Lower target = harder (must deliver faster)
      if (ratio >= 1.2) return 1; // easy — generous time
      if (ratio >= 0.8) return 2; // medium
      return 3; // hard — must be faster than average
    }

    case 'CODE_COMPLETION_RATE': {
      if (target <= 70) return 1;
      if (target <= 90) return 2;
      return 3;
    }

    case 'CANCELLATION_RATE': {
      if (target >= 10) return 1;
      if (target >= 5) return 2;
      return 3;
    }

    case 'CONSECUTIVE_CHECKINS': {
      if (target <= 5) return 1;
      if (target <= 15) return 2;
      return 3;
    }

    default:
      return 2;
  }
}

// ---------------------------------------------------------------------------
// 4. getGoalsForRider(riderId, companyId)
// ---------------------------------------------------------------------------
export async function getGoalsForRider(riderId, companyId) {
  const tz = await getCompanyTimezone(companyId);
  const goals = await prisma.riderGoal.findMany({
    where: {
      companyId,
      active: true,
      OR: [
        { scope: 'GLOBAL' },
        {
          scope: 'INDIVIDUAL',
          assignments: { some: { riderId } },
        },
      ],
    },
    include: {
      assignments: { where: { riderId }, select: { id: true } },
    },
  });

  const results = await Promise.all(
    goals.map(async (goal) => {
      const [progress, difficulty] = await Promise.all([
        calculateProgress(goal, riderId, companyId, tz),
        calculateDifficulty(goal, companyId, tz),
      ]);

      return {
        id: goal.id,
        name: goal.name,
        description: goal.description,
        ruleType: goal.ruleType,
        ruleOperator: goal.ruleOperator,
        ruleValue: Number(goal.ruleValue),
        scope: goal.scope,
        periodType: goal.periodType,
        rewardType: goal.rewardType,
        rewardAmount: goal.rewardAmount ? Number(goal.rewardAmount) : null,
        rewardDescription: goal.rewardDescription,
        autoApprove: goal.autoApprove,
        progress,
        difficulty,
      };
    }),
  );

  return results;
}

// ---------------------------------------------------------------------------
// 5. checkGoalsOnEvent(eventType, riderId, companyId)
// ---------------------------------------------------------------------------
const EVENT_TO_RULE_TYPES = {
  ORDER_COMPLETED: ['DELIVERY_COUNT', 'AVG_DELIVERY_TIME', 'CODE_COMPLETION_RATE'],
  ORDER_CANCELLED: ['CANCELLATION_RATE'],
  CHECKIN: ['CONSECUTIVE_CHECKINS'],
};

export async function checkGoalsOnEvent(eventType, riderId, companyId) {
  const relevantRuleTypes = EVENT_TO_RULE_TYPES[eventType];
  if (!relevantRuleTypes || relevantRuleTypes.length === 0) return;

  const tz = await getCompanyTimezone(companyId);

  const goals = await prisma.riderGoal.findMany({
    where: {
      companyId,
      active: true,
      ruleType: { in: relevantRuleTypes },
      OR: [
        { scope: 'GLOBAL' },
        {
          scope: 'INDIVIDUAL',
          assignments: { some: { riderId } },
        },
      ],
    },
  });

  for (const goal of goals) {
    const progress = await calculateProgress(goal, riderId, companyId, tz);
    if (!progress.achieved) continue;

    // Check if achievement already exists for this cycle
    const existing = await prisma.riderGoalAchievement.findUnique({
      where: {
        goalId_riderId_cycleStart: {
          goalId: goal.id,
          riderId,
          cycleStart: progress.cycleStart,
        },
      },
    });
    if (existing) continue;

    const hasMoneyReward = goal.rewardType === 'MONEY' || goal.rewardType === 'MONEY_AND_CUSTOM';
    const rewardAmount = goal.rewardAmount ? Number(goal.rewardAmount) : 0;

    if (goal.autoApprove && hasMoneyReward && rewardAmount > 0) {
      // Auto-approve with money: create transaction + achievement as CREDITED
      const { addRiderTransaction } = await import('./riderAccount.js');

      const transaction = await addRiderTransaction({
        companyId,
        riderId,
        amount: rewardAmount,
        type: 'GOAL_REWARD',
        date: new Date(),
        note: `Meta atingida: ${goal.name}`,
      });

      await prisma.riderGoalAchievement.create({
        data: {
          goalId: goal.id,
          riderId,
          cycleStart: progress.cycleStart,
          cycleEnd: progress.cycleEnd,
          status: 'CREDITED',
          rewardAmount,
          transactionId: transaction?.id || null,
        },
      });
    } else if (goal.autoApprove) {
      // Auto-approve custom-only reward
      await prisma.riderGoalAchievement.create({
        data: {
          goalId: goal.id,
          riderId,
          cycleStart: progress.cycleStart,
          cycleEnd: progress.cycleEnd,
          status: 'APPROVED',
          rewardAmount: rewardAmount || null,
        },
      });
    } else {
      // Needs manual approval
      await prisma.riderGoalAchievement.create({
        data: {
          goalId: goal.id,
          riderId,
          cycleStart: progress.cycleStart,
          cycleEnd: progress.cycleEnd,
          status: 'PENDING_APPROVAL',
          rewardAmount: rewardAmount || null,
        },
      });
    }
  }
}
