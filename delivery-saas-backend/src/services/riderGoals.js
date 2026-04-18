import { prisma } from '../prisma.js';

// ---------------------------------------------------------------------------
// 1. getCurrentCycle(goal, referenceDate)
// ---------------------------------------------------------------------------
export function getCurrentCycle(goal, referenceDate = new Date()) {
  const ref = new Date(referenceDate);

  if (goal.periodType === 'FIXED') {
    return {
      start: new Date(goal.startDate),
      end: goal.endDate ? new Date(goal.endDate) : null,
    };
  }

  if (goal.periodType === 'WEEKLY') {
    // Week starts on Monday (ISO)
    const day = ref.getDay(); // 0=Sun … 6=Sat
    const diffToMonday = day === 0 ? -6 : 1 - day;
    const start = new Date(ref);
    start.setDate(start.getDate() + diffToMonday);
    start.setHours(0, 0, 0, 0);

    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    end.setHours(23, 59, 59, 999);

    return { start, end };
  }

  if (goal.periodType === 'MONTHLY') {
    const start = new Date(ref.getFullYear(), ref.getMonth(), 1, 0, 0, 0, 0);
    const end = new Date(ref.getFullYear(), ref.getMonth() + 1, 0, 23, 59, 59, 999);
    return { start, end };
  }

  // fallback
  return { start: new Date(goal.startDate), end: goal.endDate ? new Date(goal.endDate) : null };
}

// ---------------------------------------------------------------------------
// 2. calculateProgress(goal, riderId, companyId)
// ---------------------------------------------------------------------------
export async function calculateProgress(goal, riderId, companyId) {
  const { start: cycleStart, end: cycleEnd } = getCurrentCycle(goal);

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

      // Group check-ins by date, only counting those before the deadline
      const checkinDays = new Set();
      for (const c of checkins) {
        const dt = new Date(c.checkinAt);
        const timeStr = `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;

        // Find matching bonus rule (by shiftId or any rule)
        const matchingRule = bonusRules.find(r => !r.shiftId || r.shiftId === c.shiftId)
          || bonusRules[0];

        if (!matchingRule || timeStr <= matchingRule.deadlineTime) {
          const dayKey = `${dt.getFullYear()}-${dt.getMonth()}-${dt.getDate()}`;
          checkinDays.add(dayKey);
        }
      }

      // Calculate max consecutive days
      const sortedDays = [...checkinDays].map(k => {
        const [y, m, d] = k.split('-').map(Number);
        return new Date(y, m, d);
      }).sort((a, b) => a - b);

      let maxConsecutive = 0;
      let consecutive = 0;
      for (let i = 0; i < sortedDays.length; i++) {
        if (i === 0) {
          consecutive = 1;
        } else {
          const diff = (sortedDays[i] - sortedDays[i - 1]) / (1000 * 60 * 60 * 24);
          consecutive = diff === 1 ? consecutive + 1 : 1;
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
// 3. calculateDifficulty(goal, companyId)
// ---------------------------------------------------------------------------
export async function calculateDifficulty(goal, companyId) {
  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
  threeMonthsAgo.setHours(0, 0, 0, 0);

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
        calculateProgress(goal, riderId, companyId),
        calculateDifficulty(goal, companyId),
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
    const progress = await calculateProgress(goal, riderId, companyId);
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
