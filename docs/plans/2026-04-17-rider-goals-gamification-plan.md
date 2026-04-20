# Rider Goals Gamification Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the rider ranking system with a gamified goals system featuring stars, progress bars, monetary/custom rewards, and admin management.

**Architecture:** Hybrid on-demand calculation — progress is computed from existing tables (Orders, RiderCheckin) when the rider views their goals. Achievement verification runs at event time (order completion, check-in, cancellation) to credit rewards immediately. New Prisma models: RiderGoal, RiderGoalAssignment, RiderGoalAchievement.

**Tech Stack:** Express.js + Prisma (PostgreSQL), Vue 3 + Bootstrap 5, Socket.IO for notifications

---

## Task 1: Prisma Schema — New Models and Enums

**Files:**
- Modify: `delivery-saas-backend/prisma/schema.prisma` (after line 819, before the Affiliate section at line 821)

**Step 1: Add new enums after `RiderBonusRuleType` (line 798)**

Add after line 798 (`}`):

```prisma
enum GoalRuleType {
  CANCELLATION_RATE
  CODE_COMPLETION_RATE
  CONSECUTIVE_CHECKINS
  AVG_DELIVERY_TIME
  DELIVERY_COUNT
}

enum GoalRuleOperator {
  LTE
  GTE
}

enum GoalScope {
  GLOBAL
  INDIVIDUAL
}

enum GoalPeriodType {
  FIXED
  WEEKLY
  MONTHLY
}

enum GoalRewardType {
  MONEY
  CUSTOM
  MONEY_AND_CUSTOM
}

enum GoalAchievementStatus {
  PENDING_APPROVAL
  APPROVED
  CREDITED
  REJECTED
}
```

**Step 2: Add GOAL_REWARD to RiderTransactionType (line 789)**

Change:
```prisma
enum RiderTransactionType {
  DELIVERY_FEE
  DAILY_RATE
  MANUAL_ADJUSTMENT
  EARLY_CHECKIN_BONUS
}
```
To:
```prisma
enum RiderTransactionType {
  DELIVERY_FEE
  DAILY_RATE
  MANUAL_ADJUSTMENT
  EARLY_CHECKIN_BONUS
  GOAL_REWARD
}
```

**Step 3: Add new models after RiderTransaction (after line 819)**

```prisma
// ---- Rider Goals (Gamification) ----
model RiderGoal {
  id                String              @id @default(uuid())
  companyId         String
  company           Company             @relation(fields: [companyId], references: [id])
  name              String
  description       String?
  ruleType          GoalRuleType
  ruleOperator      GoalRuleOperator
  ruleValue         Decimal
  scope             GoalScope
  periodType        GoalPeriodType
  startDate         DateTime
  endDate           DateTime?
  rewardType        GoalRewardType
  rewardAmount      Decimal?
  rewardDescription String?
  autoApprove       Boolean             @default(false)
  active            Boolean             @default(true)
  createdAt         DateTime            @default(now())
  assignments       RiderGoalAssignment[]
  achievements      RiderGoalAchievement[]

  @@index([companyId, active])
}

model RiderGoalAssignment {
  id       String    @id @default(uuid())
  goalId   String
  goal     RiderGoal @relation(fields: [goalId], references: [id], onDelete: Cascade)
  riderId  String
  rider    Rider     @relation(fields: [riderId], references: [id])

  @@unique([goalId, riderId])
}

model RiderGoalAchievement {
  id            String                @id @default(uuid())
  goalId        String
  goal          RiderGoal             @relation(fields: [goalId], references: [id], onDelete: Cascade)
  riderId       String
  rider         Rider                 @relation(fields: [riderId], references: [id])
  cycleStart    DateTime
  cycleEnd      DateTime
  achievedAt    DateTime              @default(now())
  status        GoalAchievementStatus @default(PENDING_APPROVAL)
  rewardAmount  Decimal?
  transactionId String?
  transaction   RiderTransaction?     @relation(fields: [transactionId], references: [id])

  @@unique([goalId, riderId, cycleStart])
  @@index([riderId, status])
}
```

**Step 4: Add relations to existing models**

In the `Rider` model (lines 169-185), add:
```prisma
  goalAssignments  RiderGoalAssignment[]
  goalAchievements RiderGoalAchievement[]
```

In the `Company` model, add:
```prisma
  riderGoals       RiderGoal[]
```

In the `RiderTransaction` model (lines 808-819), add:
```prisma
  goalAchievement  RiderGoalAchievement?
```

**Step 5: Run prisma db push**

Run: `docker compose exec backend npx prisma db push --skip-generate && docker compose exec backend npx prisma generate`

**Step 6: Commit**

```bash
git add delivery-saas-backend/prisma/schema.prisma
git commit -m "feat(goals): add RiderGoal, RiderGoalAssignment, RiderGoalAchievement models"
```

---

## Task 2: Backend Service — Goal Progress Calculator

**Files:**
- Create: `delivery-saas-backend/src/services/riderGoals.js`

**Step 1: Create the service file**

```javascript
import { prisma } from '../prisma.js';

// ---- Cycle helpers ----

export function getCurrentCycle(goal, referenceDate = new Date()) {
  const ref = new Date(referenceDate);

  if (goal.periodType === 'FIXED') {
    return { start: new Date(goal.startDate), end: new Date(goal.endDate) };
  }

  if (goal.periodType === 'MONTHLY') {
    const start = new Date(ref.getFullYear(), ref.getMonth(), 1);
    const end = new Date(ref.getFullYear(), ref.getMonth() + 1, 0, 23, 59, 59, 999);
    return { start, end };
  }

  if (goal.periodType === 'WEEKLY') {
    const day = ref.getDay(); // 0=Sun
    const diff = day === 0 ? 6 : day - 1; // Mon=0
    const start = new Date(ref);
    start.setDate(ref.getDate() - diff);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }

  return { start: new Date(goal.startDate), end: goal.endDate ? new Date(goal.endDate) : new Date() };
}

function isGoalActiveInCycle(goal, cycle) {
  const goalStart = new Date(goal.startDate);
  const goalEnd = goal.endDate ? new Date(goal.endDate) : null;
  if (goalStart > cycle.end) return false;
  if (goalEnd && goalEnd < cycle.start) return false;
  return true;
}

// ---- Progress calculators per ruleType ----

async function calcDeliveryCount(riderId, cycleStart, cycleEnd) {
  const count = await prisma.order.count({
    where: {
      riderId,
      status: 'CONCLUIDO',
      updatedAt: { gte: cycleStart, lte: cycleEnd },
    },
  });
  return { current: count, unit: 'entregas' };
}

async function calcAvgDeliveryTime(riderId, cycleStart, cycleEnd) {
  const orders = await prisma.order.findMany({
    where: {
      riderId,
      status: 'CONCLUIDO',
      departedAt: { not: null },
      completedAt: { not: null },
      updatedAt: { gte: cycleStart, lte: cycleEnd },
    },
    select: { departedAt: true, completedAt: true },
  });

  if (orders.length === 0) return { current: null, unit: 'min' };

  const totalMin = orders.reduce((sum, o) => {
    const diff = (new Date(o.completedAt) - new Date(o.departedAt)) / 60000;
    return sum + diff;
  }, 0);

  return { current: Math.round((totalMin / orders.length) * 10) / 10, unit: 'min' };
}

async function calcCancellationRate(riderId, cycleStart, cycleEnd) {
  const total = await prisma.order.count({
    where: {
      riderId,
      updatedAt: { gte: cycleStart, lte: cycleEnd },
      status: { in: ['CONCLUIDO', 'CANCELADO'] },
    },
  });

  if (total === 0) return { current: null, unit: '%' };

  const cancelled = await prisma.order.count({
    where: {
      riderId,
      status: 'CANCELADO',
      updatedAt: { gte: cycleStart, lte: cycleEnd },
    },
  });

  return { current: Math.round((cancelled / total) * 1000) / 10, unit: '%' };
}

async function calcCodeCompletionRate(riderId, cycleStart, cycleEnd) {
  const completed = await prisma.order.count({
    where: {
      riderId,
      status: 'CONCLUIDO',
      updatedAt: { gte: cycleStart, lte: cycleEnd },
    },
  });

  if (completed === 0) return { current: null, unit: '%' };

  const withCode = await prisma.order.count({
    where: {
      riderId,
      status: 'CONCLUIDO',
      closedByIfoodCode: true,
      updatedAt: { gte: cycleStart, lte: cycleEnd },
    },
  });

  return { current: Math.round((withCode / completed) * 1000) / 10, unit: '%' };
}

async function calcConsecutiveCheckins(riderId, companyId, cycleStart, cycleEnd) {
  // Get all bonus rules for company to know the deadline times
  const bonusRules = await prisma.riderBonusRule.findMany({
    where: { companyId, type: 'EARLY_CHECKIN', active: true },
  });

  if (bonusRules.length === 0) return { current: 0, unit: 'dias' };

  const checkins = await prisma.riderCheckin.findMany({
    where: { riderId, checkinAt: { gte: cycleStart, lte: cycleEnd } },
    orderBy: { checkinAt: 'asc' },
  });

  // Group by date
  const byDate = {};
  for (const c of checkins) {
    const dateKey = new Date(c.checkinAt).toISOString().slice(0, 10);
    if (!byDate[dateKey]) byDate[dateKey] = [];
    byDate[dateKey].push(c);
  }

  // Count consecutive days with on-time check-in
  const sortedDates = Object.keys(byDate).sort();
  let maxConsecutive = 0;
  let current = 0;

  for (let i = 0; i < sortedDates.length; i++) {
    const dayCheckins = byDate[sortedDates[i]];
    const isOnTime = dayCheckins.some(c => {
      return bonusRules.some(rule => {
        if (rule.shiftId && c.shiftId !== rule.shiftId) return false;
        const [dH, dM] = rule.deadlineTime.split(':').map(Number);
        const cDate = new Date(c.checkinAt);
        return (cDate.getHours() * 60 + cDate.getMinutes()) <= (dH * 60 + dM);
      });
    });

    if (isOnTime) {
      if (i === 0 || isConsecutiveDay(sortedDates[i - 1], sortedDates[i])) {
        current++;
      } else {
        current = 1;
      }
      maxConsecutive = Math.max(maxConsecutive, current);
    } else {
      current = 0;
    }
  }

  return { current: maxConsecutive, unit: 'dias' };
}

function isConsecutiveDay(dateStrA, dateStrB) {
  const a = new Date(dateStrA);
  const b = new Date(dateStrB);
  const diff = (b - a) / 86400000;
  return diff === 1;
}

// ---- Main progress calculator ----

const calculators = {
  DELIVERY_COUNT: (riderId, s, e) => calcDeliveryCount(riderId, s, e),
  AVG_DELIVERY_TIME: (riderId, s, e) => calcAvgDeliveryTime(riderId, s, e),
  CANCELLATION_RATE: (riderId, s, e) => calcCancellationRate(riderId, s, e),
  CODE_COMPLETION_RATE: (riderId, s, e) => calcCodeCompletionRate(riderId, s, e),
  CONSECUTIVE_CHECKINS: (riderId, s, e, companyId) => calcConsecutiveCheckins(riderId, companyId, s, e),
};

export async function calculateProgress(goal, riderId, companyId) {
  const cycle = getCurrentCycle(goal);
  if (!isGoalActiveInCycle(goal, cycle)) return null;

  const calc = calculators[goal.ruleType];
  if (!calc) return null;

  const { current, unit } = await calc(riderId, cycle.start, cycle.end, companyId);

  const target = Number(goal.ruleValue);
  let percentage = 0;

  if (current != null) {
    if (goal.ruleOperator === 'GTE') {
      percentage = Math.min(100, Math.round((current / target) * 100));
    } else {
      // LTE — lower is better (e.g., cancellation rate <= 5%)
      if (current <= target) {
        percentage = 100;
      } else {
        // Show how far from target (e.g., current=10, target=5 → 50%)
        percentage = Math.max(0, Math.round((target / current) * 100));
      }
    }
  }

  const achieved = goal.ruleOperator === 'GTE' ? current >= target : current <= target;

  return {
    current,
    target,
    percentage,
    achieved: current != null && achieved,
    unit,
    cycleStart: cycle.start,
    cycleEnd: cycle.end,
  };
}

// ---- Difficulty stars ----

export async function calculateDifficulty(goal, companyId) {
  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

  const riders = await prisma.rider.findMany({
    where: { companyId, active: true },
    select: { id: true },
  });

  if (riders.length === 0) return 2; // default medium

  const target = Number(goal.ruleValue);

  switch (goal.ruleType) {
    case 'DELIVERY_COUNT': {
      const totalOrders = await prisma.order.count({
        where: {
          companyId,
          status: 'CONCLUIDO',
          riderId: { not: null },
          updatedAt: { gte: threeMonthsAgo },
        },
      });
      const avg = totalOrders / riders.length / 3; // monthly avg per rider
      if (avg === 0) return 2;
      const ratio = target / avg;
      if (ratio <= 0.8) return 1;
      if (ratio <= 1.2) return 2;
      return 3;
    }
    case 'AVG_DELIVERY_TIME': {
      const orders = await prisma.order.findMany({
        where: {
          companyId,
          status: 'CONCLUIDO',
          riderId: { not: null },
          departedAt: { not: null },
          completedAt: { not: null },
          updatedAt: { gte: threeMonthsAgo },
        },
        select: { departedAt: true, completedAt: true },
      });
      if (orders.length === 0) return 2;
      const avgMin = orders.reduce((s, o) => s + (new Date(o.completedAt) - new Date(o.departedAt)) / 60000, 0) / orders.length;
      const ratio = target / avgMin;
      if (ratio >= 1.2) return 1;
      if (ratio >= 0.8) return 2;
      return 3;
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

// ---- Get active goals for a rider ----

export async function getGoalsForRider(riderId, companyId) {
  // Global goals + individual goals assigned to this rider
  const goals = await prisma.riderGoal.findMany({
    where: {
      companyId,
      active: true,
      OR: [
        { scope: 'GLOBAL' },
        { scope: 'INDIVIDUAL', assignments: { some: { riderId } } },
      ],
    },
  });

  const results = [];
  for (const goal of goals) {
    const progress = await calculateProgress(goal, riderId, companyId);
    if (!progress) continue; // goal not active in current cycle

    const difficulty = await calculateDifficulty(goal, companyId);

    // Check if already achieved this cycle
    const existingAchievement = await prisma.riderGoalAchievement.findFirst({
      where: { goalId: goal.id, riderId, cycleStart: progress.cycleStart },
    });

    results.push({
      id: goal.id,
      name: goal.name,
      description: goal.description,
      ruleType: goal.ruleType,
      ruleOperator: goal.ruleOperator,
      ruleValue: Number(goal.ruleValue),
      rewardType: goal.rewardType,
      rewardAmount: goal.rewardAmount ? Number(goal.rewardAmount) : null,
      rewardDescription: goal.rewardDescription,
      periodType: goal.periodType,
      cycleStart: progress.cycleStart,
      cycleEnd: progress.cycleEnd,
      difficulty,
      progress: {
        current: progress.current,
        target: progress.target,
        percentage: progress.percentage,
        achieved: progress.achieved,
        unit: progress.unit,
      },
      achievementStatus: existingAchievement?.status || null,
    });
  }

  return results;
}

// ---- Check and credit achievements on events ----

const EVENT_RULE_MAP = {
  ORDER_COMPLETED: ['DELIVERY_COUNT', 'AVG_DELIVERY_TIME', 'CODE_COMPLETION_RATE'],
  ORDER_CANCELLED: ['CANCELLATION_RATE'],
  CHECKIN: ['CONSECUTIVE_CHECKINS'],
};

export async function checkGoalsOnEvent(eventType, riderId, companyId) {
  const relevantRuleTypes = EVENT_RULE_MAP[eventType];
  if (!relevantRuleTypes) return;

  const goals = await prisma.riderGoal.findMany({
    where: {
      companyId,
      active: true,
      ruleType: { in: relevantRuleTypes },
      OR: [
        { scope: 'GLOBAL' },
        { scope: 'INDIVIDUAL', assignments: { some: { riderId } } },
      ],
    },
  });

  for (const goal of goals) {
    try {
      const progress = await calculateProgress(goal, riderId, companyId);
      if (!progress || !progress.achieved) continue;

      // Check if already achieved in this cycle
      const existing = await prisma.riderGoalAchievement.findFirst({
        where: { goalId: goal.id, riderId, cycleStart: progress.cycleStart },
      });
      if (existing) continue;

      if (goal.autoApprove && (goal.rewardType === 'MONEY' || goal.rewardType === 'MONEY_AND_CUSTOM')) {
        // Auto-credit money reward
        const { addRiderTransaction } = await import('./riderAccount.js');
        const tx = await addRiderTransaction({
          companyId,
          riderId,
          amount: Number(goal.rewardAmount || 0),
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
            rewardAmount: goal.rewardAmount,
            transactionId: tx?.id || null,
          },
        });
      } else if (goal.autoApprove && goal.rewardType === 'CUSTOM') {
        // Auto-approve custom reward (no money)
        await prisma.riderGoalAchievement.create({
          data: {
            goalId: goal.id,
            riderId,
            cycleStart: progress.cycleStart,
            cycleEnd: progress.cycleEnd,
            status: 'APPROVED',
            rewardAmount: null,
          },
        });
      } else {
        // Needs admin approval
        await prisma.riderGoalAchievement.create({
          data: {
            goalId: goal.id,
            riderId,
            cycleStart: progress.cycleStart,
            cycleEnd: progress.cycleEnd,
            status: 'PENDING_APPROVAL',
            rewardAmount: goal.rewardAmount,
          },
        });
      }
    } catch (e) {
      console.warn(`[riderGoals] checkGoalsOnEvent failed for goal ${goal.id}:`, e?.message || e);
    }
  }
}
```

**Step 2: Commit**

```bash
git add delivery-saas-backend/src/services/riderGoals.js
git commit -m "feat(goals): add goal progress calculator and achievement checker service"
```

---

## Task 3: Backend Routes — Admin Goals CRUD

**Files:**
- Create: `delivery-saas-backend/src/routes/goals.js`
- Modify: `delivery-saas-backend/src/routes/riders.js` (to mount goals router)

**Step 1: Create goals.js router**

```javascript
import express from 'express';
import { prisma } from '../prisma.js';
import { addRiderTransaction } from '../services/riderAccount.js';

const router = express.Router();

// GET /goals — list goals for company
router.get('/', async (req, res) => {
  const companyId = req.user.companyId;
  const { active, scope, ruleType } = req.query;

  const where = { companyId };
  if (active !== undefined) where.active = active === 'true';
  if (scope) where.scope = scope;
  if (ruleType) where.ruleType = ruleType;

  const goals = await prisma.riderGoal.findMany({
    where,
    include: {
      assignments: { include: { rider: { select: { id: true, name: true } } } },
      _count: { select: { achievements: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  res.json(goals);
});

// POST /goals — create goal
router.post('/', async (req, res) => {
  const companyId = req.user.companyId;
  const { name, description, ruleType, ruleOperator, ruleValue, scope, periodType, startDate, endDate, rewardType, rewardAmount, rewardDescription, autoApprove, riderIds } = req.body;

  if (!name || !ruleType || !ruleOperator || ruleValue == null || !scope || !periodType || !startDate) {
    return res.status(400).json({ message: 'Campos obrigatórios: name, ruleType, ruleOperator, ruleValue, scope, periodType, startDate' });
  }

  const goal = await prisma.riderGoal.create({
    data: {
      companyId,
      name,
      description: description || null,
      ruleType,
      ruleOperator,
      ruleValue: parseFloat(ruleValue),
      scope,
      periodType,
      startDate: new Date(startDate),
      endDate: endDate ? new Date(endDate) : null,
      rewardType: rewardType || 'CUSTOM',
      rewardAmount: rewardAmount ? parseFloat(rewardAmount) : null,
      rewardDescription: rewardDescription || null,
      autoApprove: autoApprove || false,
    },
  });

  // If INDIVIDUAL, assign riders
  if (scope === 'INDIVIDUAL' && Array.isArray(riderIds) && riderIds.length > 0) {
    await prisma.riderGoalAssignment.createMany({
      data: riderIds.map(riderId => ({ goalId: goal.id, riderId })),
      skipDuplicates: true,
    });
  }

  const created = await prisma.riderGoal.findUnique({
    where: { id: goal.id },
    include: { assignments: { include: { rider: { select: { id: true, name: true } } } } },
  });

  res.status(201).json(created);
});

// PUT /goals/:id — update goal
router.put('/:id', async (req, res) => {
  const companyId = req.user.companyId;
  const { id } = req.params;
  const { name, description, ruleType, ruleOperator, ruleValue, scope, periodType, startDate, endDate, rewardType, rewardAmount, rewardDescription, autoApprove } = req.body;

  const existing = await prisma.riderGoal.findFirst({ where: { id, companyId } });
  if (!existing) return res.status(404).json({ message: 'Meta não encontrada' });

  const updated = await prisma.riderGoal.update({
    where: { id },
    data: {
      name: name ?? existing.name,
      description: description !== undefined ? description : existing.description,
      ruleType: ruleType ?? existing.ruleType,
      ruleOperator: ruleOperator ?? existing.ruleOperator,
      ruleValue: ruleValue != null ? parseFloat(ruleValue) : existing.ruleValue,
      scope: scope ?? existing.scope,
      periodType: periodType ?? existing.periodType,
      startDate: startDate ? new Date(startDate) : existing.startDate,
      endDate: endDate !== undefined ? (endDate ? new Date(endDate) : null) : existing.endDate,
      rewardType: rewardType ?? existing.rewardType,
      rewardAmount: rewardAmount !== undefined ? (rewardAmount ? parseFloat(rewardAmount) : null) : existing.rewardAmount,
      rewardDescription: rewardDescription !== undefined ? rewardDescription : existing.rewardDescription,
      autoApprove: autoApprove !== undefined ? autoApprove : existing.autoApprove,
    },
    include: { assignments: { include: { rider: { select: { id: true, name: true } } } } },
  });

  res.json(updated);
});

// DELETE /goals/:id — soft delete (deactivate)
router.delete('/:id', async (req, res) => {
  const companyId = req.user.companyId;
  const { id } = req.params;

  const existing = await prisma.riderGoal.findFirst({ where: { id, companyId } });
  if (!existing) return res.status(404).json({ message: 'Meta não encontrada' });

  await prisma.riderGoal.update({ where: { id }, data: { active: false } });
  res.json({ message: 'Meta desativada' });
});

// POST /goals/:id/assign — assign riders to individual goal
router.post('/:id/assign', async (req, res) => {
  const companyId = req.user.companyId;
  const { id } = req.params;
  const { riderIds } = req.body;

  const goal = await prisma.riderGoal.findFirst({ where: { id, companyId, scope: 'INDIVIDUAL' } });
  if (!goal) return res.status(404).json({ message: 'Meta individual não encontrada' });

  if (!Array.isArray(riderIds) || riderIds.length === 0) {
    return res.status(400).json({ message: 'riderIds é obrigatório' });
  }

  await prisma.riderGoalAssignment.createMany({
    data: riderIds.map(riderId => ({ goalId: id, riderId })),
    skipDuplicates: true,
  });

  const updated = await prisma.riderGoal.findUnique({
    where: { id },
    include: { assignments: { include: { rider: { select: { id: true, name: true } } } } },
  });

  res.json(updated);
});

// DELETE /goals/:id/assign/:riderId — remove rider from goal
router.delete('/:id/assign/:riderId', async (req, res) => {
  const companyId = req.user.companyId;
  const { id, riderId } = req.params;

  const goal = await prisma.riderGoal.findFirst({ where: { id, companyId } });
  if (!goal) return res.status(404).json({ message: 'Meta não encontrada' });

  await prisma.riderGoalAssignment.deleteMany({ where: { goalId: id, riderId } });
  res.json({ message: 'Entregador removido da meta' });
});

// GET /goals/achievements — list achievements
router.get('/achievements', async (req, res) => {
  const companyId = req.user.companyId;
  const { status, riderId, goalId } = req.query;

  const where = { goal: { companyId } };
  if (status) where.status = status;
  if (riderId) where.riderId = riderId;
  if (goalId) where.goalId = goalId;

  const achievements = await prisma.riderGoalAchievement.findMany({
    where,
    include: {
      goal: { select: { name: true, ruleType: true, rewardType: true, rewardAmount: true, rewardDescription: true } },
      rider: { select: { id: true, name: true } },
    },
    orderBy: { achievedAt: 'desc' },
  });

  res.json(achievements);
});

// PUT /goals/achievements/:id/approve — approve achievement
router.put('/achievements/:id/approve', async (req, res) => {
  const companyId = req.user.companyId;
  const { id } = req.params;

  const achievement = await prisma.riderGoalAchievement.findFirst({
    where: { id, goal: { companyId }, status: 'PENDING_APPROVAL' },
    include: { goal: true },
  });

  if (!achievement) return res.status(404).json({ message: 'Conquista pendente não encontrada' });

  let transactionId = null;
  const hasMoneyReward = achievement.goal.rewardType === 'MONEY' || achievement.goal.rewardType === 'MONEY_AND_CUSTOM';

  if (hasMoneyReward && achievement.rewardAmount) {
    const tx = await addRiderTransaction({
      companyId,
      riderId: achievement.riderId,
      amount: Number(achievement.rewardAmount),
      type: 'GOAL_REWARD',
      date: new Date(),
      note: `Meta atingida: ${achievement.goal.name}`,
    });
    transactionId = tx?.id || null;
  }

  const updated = await prisma.riderGoalAchievement.update({
    where: { id },
    data: {
      status: hasMoneyReward ? 'CREDITED' : 'APPROVED',
      transactionId,
    },
    include: {
      goal: { select: { name: true, ruleType: true } },
      rider: { select: { id: true, name: true } },
    },
  });

  res.json(updated);
});

// PUT /goals/achievements/:id/reject — reject achievement
router.put('/achievements/:id/reject', async (req, res) => {
  const companyId = req.user.companyId;
  const { id } = req.params;

  const achievement = await prisma.riderGoalAchievement.findFirst({
    where: { id, goal: { companyId }, status: 'PENDING_APPROVAL' },
  });

  if (!achievement) return res.status(404).json({ message: 'Conquista pendente não encontrada' });

  const updated = await prisma.riderGoalAchievement.update({
    where: { id },
    data: { status: 'REJECTED' },
    include: {
      goal: { select: { name: true, ruleType: true } },
      rider: { select: { id: true, name: true } },
    },
  });

  res.json(updated);
});

export default router;
```

**Step 2: Mount goals router in riders.js**

In `delivery-saas-backend/src/routes/riders.js`, add the import and mount at the top with other imports:

```javascript
import goalsRouter from './goals.js';
```

After the module enforcement middleware (around line 24), add:

```javascript
ridersRouter.use('/goals', requireRole('ADMIN'), goalsRouter);
```

**Step 3: Commit**

```bash
git add delivery-saas-backend/src/routes/goals.js delivery-saas-backend/src/routes/riders.js
git commit -m "feat(goals): add admin CRUD routes for goals and achievements"
```

---

## Task 4: Backend Routes — Rider Goals Endpoints

**Files:**
- Modify: `delivery-saas-backend/src/routes/riders.js`

**Step 1: Add rider-facing endpoints**

Add these routes in `riders.js` (after the existing `/me/` routes, around line 440):

```javascript
import { getGoalsForRider } from '../services/riderGoals.js';

// GET /riders/me/goals — rider's active goals with progress
ridersRouter.get('/me/goals', async (req, res) => {
  const userId = req.user.id;
  const rider = await prisma.rider.findFirst({ where: { userId } });
  if (!rider) return res.status(403).json({ message: 'Você não é um entregador' });

  try {
    const goals = await getGoalsForRider(rider.id, rider.companyId);
    res.json(goals);
  } catch (e) {
    console.error('[goals] Error loading rider goals:', e);
    res.status(500).json({ message: 'Erro ao carregar metas' });
  }
});

// GET /riders/me/achievements — rider's achievement history
ridersRouter.get('/me/achievements', async (req, res) => {
  const userId = req.user.id;
  const rider = await prisma.rider.findFirst({ where: { userId } });
  if (!rider) return res.status(403).json({ message: 'Você não é um entregador' });

  const achievements = await prisma.riderGoalAchievement.findMany({
    where: { riderId: rider.id },
    include: {
      goal: { select: { name: true, ruleType: true, rewardType: true, rewardDescription: true } },
    },
    orderBy: { achievedAt: 'desc' },
    take: 50,
  });

  res.json(achievements);
});
```

**Step 2: Commit**

```bash
git add delivery-saas-backend/src/routes/riders.js
git commit -m "feat(goals): add rider-facing goals and achievements endpoints"
```

---

## Task 5: Backend — Hook Event Triggers

**Files:**
- Modify: `delivery-saas-backend/src/routes/orders.js` (order completion + cancellation)
- Modify: `delivery-saas-backend/src/routes/riders.js` (check-in)
- Modify: `delivery-saas-backend/src/socketEmitters.js` (add goal achievement emitter)

**Step 1: Add socket emitter for goal achievements**

In `delivery-saas-backend/src/socketEmitters.js`, add a new emitter function:

```javascript
// ---- emit: goal-achieved ----
export function emitirMetaAtingida(companyId, payload) {
  if (!io) return;
  if (!companyId) return;
  try {
    io.to(companyRoom(companyId)).emit('goal-achieved', payload);
  } catch (e) {
    console.warn('Falha ao emitir meta atingida:', e?.message || e);
  }
}
```

**Step 2: Hook into order completion in orders.js**

In `delivery-saas-backend/src/routes/orders.js`, after the `addDeliveryAndDailyIfNeeded` call at line 854, add:

```javascript
// Check rider goals on order completion
try {
  const { checkGoalsOnEvent } = await import('../services/riderGoals.js');
  await checkGoalsOnEvent('ORDER_COMPLETED', updated.riderId, updated.companyId);
} catch (e) { console.warn('Goal check on order completion failed:', e?.message || e); }
```

Also, find the cancellation handler in orders.js (where status becomes 'CANCELADO') and add:

```javascript
// Check rider goals on cancellation
if (updated.riderId) {
  try {
    const { checkGoalsOnEvent } = await import('../services/riderGoals.js');
    await checkGoalsOnEvent('ORDER_CANCELLED', updated.riderId, updated.companyId);
  } catch (e) { console.warn('Goal check on cancellation failed:', e?.message || e); }
}
```

**Step 3: Hook into check-in in riders.js**

In `delivery-saas-backend/src/routes/riders.js`, at the end of the `POST /me/checkin` handler (after the check-in is created, around line 530), add:

```javascript
// Check rider goals on check-in
try {
  const { checkGoalsOnEvent } = await import('../services/riderGoals.js');
  await checkGoalsOnEvent('CHECKIN', rider.id, companyId);
} catch (e) { console.warn('Goal check on checkin failed:', e?.message || e); }
```

**Step 4: Commit**

```bash
git add delivery-saas-backend/src/routes/orders.js delivery-saas-backend/src/routes/riders.js delivery-saas-backend/src/socketEmitters.js
git commit -m "feat(goals): hook goal achievement checks into order and checkin events"
```

---

## Task 6: Frontend — Rider Goals View (Replaces Ranking)

**Files:**
- Rewrite: `delivery-saas-frontend/src/views/rider/Ranking.vue` (complete rewrite to goals view)

**Step 1: Rewrite Ranking.vue as Goals view**

Use `@frontend-deliverywl` skill for styling consistency. Rewrite the entire file:

```vue
<script setup>
import { ref, onMounted, computed } from 'vue';
import api from '../../api';
import RiderHeader from '../../components/rider/RiderHeader.vue';
import MobileBottomNav from '../../components/MobileBottomNav.vue';
import SwipeableViews from '../../components/rider/SwipeableViews.vue';

const goals = ref([]);
const achievements = ref([]);
const loading = ref(false);
const tab = ref('goals'); // 'goals' | 'history'

const ruleTypeIcons = {
  DELIVERY_COUNT: 'bi-box-seam',
  AVG_DELIVERY_TIME: 'bi-speedometer2',
  CANCELLATION_RATE: 'bi-x-circle',
  CODE_COMPLETION_RATE: 'bi-check2-circle',
  CONSECUTIVE_CHECKINS: 'bi-calendar-check',
};

const ruleTypeLabels = {
  DELIVERY_COUNT: 'Entregas',
  AVG_DELIVERY_TIME: 'Tempo Médio',
  CANCELLATION_RATE: 'Cancelamento',
  CODE_COMPLETION_RATE: 'Taxa de Código',
  CONSECUTIVE_CHECKINS: 'Check-ins Consecutivos',
};

function progressColor(pct) {
  if (pct >= 80) return 'bg-success';
  if (pct >= 50) return 'bg-warning';
  return 'bg-danger';
}

function formatReward(goal) {
  const parts = [];
  if ((goal.rewardType === 'MONEY' || goal.rewardType === 'MONEY_AND_CUSTOM') && goal.rewardAmount) {
    parts.push(`R$ ${Number(goal.rewardAmount).toFixed(2)}`);
  }
  if ((goal.rewardType === 'CUSTOM' || goal.rewardType === 'MONEY_AND_CUSTOM') && goal.rewardDescription) {
    parts.push(goal.rewardDescription);
  }
  return parts.join(' + ') || 'Sem prêmio';
}

function formatCurrent(goal) {
  if (goal.progress.current == null) return '-';
  if (goal.progress.unit === '%') return `${goal.progress.current}%`;
  return `${goal.progress.current}`;
}

function formatTarget(goal) {
  const op = goal.ruleOperator === 'LTE' ? '≤' : '≥';
  if (goal.progress.unit === '%') return `${op} ${goal.progress.target}%`;
  if (goal.progress.unit === 'min') return `${op} ${goal.progress.target} min`;
  return `${op} ${goal.progress.target}`;
}

function formatRemaining(goal) {
  if (goal.progress.achieved) return null;
  if (goal.progress.current == null) return null;
  if (goal.ruleOperator === 'GTE') {
    const diff = goal.progress.target - goal.progress.current;
    if (diff <= 0) return null;
    return `Faltam ${diff} ${goal.progress.unit}`;
  } else {
    // LTE - need to reduce
    const diff = goal.progress.current - goal.progress.target;
    if (diff <= 0) return null;
    return `Reduzir ${diff}${goal.progress.unit === '%' ? '%' : ' ' + goal.progress.unit}`;
  }
}

function achievementStatusLabel(status) {
  const map = { PENDING_APPROVAL: 'Aguardando', APPROVED: 'Aprovado', CREDITED: 'Creditado', REJECTED: 'Rejeitado' };
  return map[status] || status;
}

function achievementStatusClass(status) {
  const map = { PENDING_APPROVAL: 'bg-warning text-dark', APPROVED: 'bg-info', CREDITED: 'bg-success', REJECTED: 'bg-danger' };
  return map[status] || 'bg-secondary';
}

async function load() {
  loading.value = true;
  try {
    const [goalsRes, achRes] = await Promise.all([
      api.get('/riders/me/goals'),
      api.get('/riders/me/achievements'),
    ]);
    goals.value = goalsRes.data || [];
    achievements.value = achRes.data || [];
  } catch (e) { console.error(e); }
  finally { loading.value = false; }
}

onMounted(load);
</script>

<template>
  <RiderHeader />
  <SwipeableViews>
  <div class="rider-goals" style="padding: calc(var(--rider-header-height, 56px) + 12px) 12px 12px">

    <!-- Tabs -->
    <ul class="nav nav-pills nav-fill mb-3">
      <li class="nav-item">
        <button class="nav-link" :class="{ active: tab === 'goals' }" @click="tab = 'goals'">
          <i class="bi-bullseye me-1"></i>Metas
        </button>
      </li>
      <li class="nav-item">
        <button class="nav-link" :class="{ active: tab === 'history' }" @click="tab = 'history'">
          <i class="bi-trophy me-1"></i>Conquistas
        </button>
      </li>
    </ul>

    <div v-if="loading" class="text-center py-4">
      <div class="spinner-border spinner-border-sm text-primary"></div>
      <span class="ms-2 text-muted">Carregando...</span>
    </div>

    <!-- Goals tab -->
    <template v-else-if="tab === 'goals'">
      <div v-if="!goals.length" class="text-center text-muted py-4">
        <i class="bi-bullseye" style="font-size: 2rem"></i>
        <p class="mt-2">Nenhuma meta ativa no momento.</p>
      </div>

      <div v-else class="d-grid gap-3">
        <div v-for="goal in goals" :key="goal.id" class="card" :class="goal.progress.achieved ? 'border-success' : ''">
          <div class="card-body">
            <!-- Header: icon + name + stars -->
            <div class="d-flex align-items-start justify-content-between mb-2">
              <div class="d-flex align-items-center gap-2">
                <i :class="ruleTypeIcons[goal.ruleType] || 'bi-flag'" class="text-primary" style="font-size: 1.3rem"></i>
                <div>
                  <div class="fw-semibold">{{ goal.name }}</div>
                  <div v-if="goal.description" class="text-muted small">{{ goal.description }}</div>
                </div>
              </div>
              <div class="text-warning text-nowrap">
                <i v-for="s in goal.difficulty" :key="s" class="bi-star-fill"></i>
                <i v-for="s in (3 - goal.difficulty)" :key="'e' + s" class="bi-star text-muted"></i>
              </div>
            </div>

            <!-- Progress bar -->
            <div class="mb-2">
              <div class="d-flex justify-content-between small mb-1">
                <span>{{ formatCurrent(goal) }} / {{ formatTarget(goal) }}</span>
                <span v-if="goal.progress.achieved" class="badge bg-success"><i class="bi-check-lg me-1"></i>Meta!</span>
                <span v-else class="text-muted">{{ goal.progress.percentage }}%</span>
              </div>
              <div class="progress" style="height: 10px; border-radius: 5px;">
                <div
                  class="progress-bar"
                  :class="goal.progress.achieved ? 'bg-success' : progressColor(goal.progress.percentage)"
                  :style="{ width: Math.min(100, goal.progress.percentage) + '%' }"
                  style="border-radius: 5px; transition: width 0.5s ease;"
                ></div>
              </div>
            </div>

            <!-- Reward + remaining -->
            <div class="d-flex justify-content-between align-items-center small">
              <span class="text-muted"><i class="bi-gift me-1"></i>{{ formatReward(goal) }}</span>
              <span v-if="formatRemaining(goal)" class="text-danger fw-medium">{{ formatRemaining(goal) }}</span>
            </div>

            <!-- Period -->
            <div class="text-muted mt-1" style="font-size: 0.75rem">
              <i class="bi-calendar3 me-1"></i>
              {{ new Date(goal.cycleStart).toLocaleDateString('pt-BR') }} - {{ new Date(goal.cycleEnd).toLocaleDateString('pt-BR') }}
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- Achievements tab -->
    <template v-else-if="tab === 'history'">
      <div v-if="!achievements.length" class="text-center text-muted py-4">
        <i class="bi-trophy" style="font-size: 2rem"></i>
        <p class="mt-2">Nenhuma conquista ainda.</p>
      </div>

      <div v-else class="d-grid gap-2">
        <div v-for="a in achievements" :key="a.id" class="card">
          <div class="card-body p-3 d-flex align-items-center gap-3">
            <i :class="ruleTypeIcons[a.goal?.ruleType] || 'bi-trophy'" class="text-warning" style="font-size: 1.5rem"></i>
            <div class="flex-grow-1">
              <div class="fw-semibold small">{{ a.goal?.name || 'Meta' }}</div>
              <div class="text-muted" style="font-size: 0.75rem">
                {{ new Date(a.cycleStart).toLocaleDateString('pt-BR') }} - {{ new Date(a.cycleEnd).toLocaleDateString('pt-BR') }}
              </div>
            </div>
            <div class="text-end">
              <span class="badge" :class="achievementStatusClass(a.status)">{{ achievementStatusLabel(a.status) }}</span>
              <div v-if="a.rewardAmount" class="fw-bold text-success small mt-1">R$ {{ Number(a.rewardAmount).toFixed(2) }}</div>
            </div>
          </div>
        </div>
      </div>
    </template>

    <div class="mobile-nav-spacer d-lg-none"></div>
  </div>
  </SwipeableViews>
  <MobileBottomNav />
</template>

<style scoped>
.rider-goals { max-width: 600px; margin: 0 auto; }
</style>
```

**Step 2: Commit**

```bash
git add delivery-saas-frontend/src/views/rider/Ranking.vue
git commit -m "feat(goals): replace rider ranking with gamified goals view"
```

---

## Task 7: Frontend — Admin Goals Management View

**Files:**
- Create: `delivery-saas-frontend/src/views/RiderGoals.vue`

**Step 1: Create admin goals management view**

Use `@frontend-deliverywl` skill for component patterns. Create a full admin view with:
- Table listing all goals with filters (active, scope, ruleType)
- Modal for creating/editing goals with dynamic form fields based on ruleType
- Rider assignment multi-select for INDIVIDUAL scope
- Achievement management tab with pending approvals + approve/reject actions

The view should use `SelectInput`, `TextInput` components from the project, `api` from `../../api`, and follow the same CRUD pattern as `RiderBonusRules.vue`.

Key API calls:
```javascript
// Goals CRUD
api.get('/riders/goals')
api.post('/riders/goals', payload)
api.put(`/riders/goals/${id}`, payload)
api.delete(`/riders/goals/${id}`)
api.post(`/riders/goals/${id}/assign`, { riderIds })
api.delete(`/riders/goals/${id}/assign/${riderId}`)

// Achievements
api.get('/riders/goals/achievements', { params: { status } })
api.put(`/riders/goals/achievements/${id}/approve`)
api.put(`/riders/goals/achievements/${id}/reject`)

// Riders list (for assignment select)
api.get('/riders')
```

This is a large component (~400 lines). The implementer should reference `RiderBonusRules.vue` for the CRUD modal pattern and follow the same Bootstrap 5 card/table layout used throughout the admin views.

**Step 2: Commit**

```bash
git add delivery-saas-frontend/src/views/RiderGoals.vue
git commit -m "feat(goals): add admin goals management view"
```

---

## Task 8: Frontend — Admin Ranking View Replacement

**Files:**
- Rewrite: `delivery-saas-frontend/src/views/RiderRanking.vue` (redirect or replace with goals overview)

**Step 1: Rewrite RiderRanking.vue**

Replace the admin RiderRanking.vue with a goals overview that shows:
- Summary cards: total active goals, pending approvals count, achievements this month
- Per-rider progress overview (each rider's progress on each active goal)

This provides the admin a bird's-eye view of how all riders are performing against goals.

API calls:
```javascript
api.get('/riders/goals', { params: { active: true } })
api.get('/riders/goals/achievements', { params: { status: 'PENDING_APPROVAL' } })
api.get('/riders')
```

**Step 2: Commit**

```bash
git add delivery-saas-frontend/src/views/RiderRanking.vue
git commit -m "feat(goals): replace admin ranking with goals overview"
```

---

## Task 9: Frontend — Navigation and Routing

**Files:**
- Modify: `delivery-saas-frontend/src/router.js`
- Modify: `delivery-saas-frontend/src/config/nav.js`

**Step 1: Add goals route to router.js**

After line 252 (rider-bonus-rules route), add:

```javascript
,{ path: '/settings/rider-goals', component: () => import('./views/RiderGoals.vue'), meta: { requiresAuth: true, role: 'ADMIN', requiresModule: 'RIDERS' } }
```

**Step 2: Update nav.js — replace Ranking with Metas**

In `delivery-saas-frontend/src/config/nav.js`, in the Entregadores children (line 16-26):

Change line 20:
```javascript
    { name: 'Ranking', to: '/reports/rider-ranking', icon: 'bi bi-trophy' },
```
To:
```javascript
    { name: 'Ranking / Metas', to: '/reports/rider-ranking', icon: 'bi bi-trophy' },
    { name: 'Gestão de Metas', to: '/settings/rider-goals', icon: 'bi bi-bullseye' },
```

**Step 3: Commit**

```bash
git add delivery-saas-frontend/src/router.js delivery-saas-frontend/src/config/nav.js
git commit -m "feat(goals): add goals routes and navigation items"
```

---

## Task 10: Integration Testing

**Step 1: Test the full flow manually**

1. Start Docker environment: `docker compose up -d`
2. Open admin panel, navigate to Entregadores > Gestão de Metas
3. Create a GLOBAL goal: "100 Entregas no Mês", DELIVERY_COUNT, GTE, 100, MONTHLY, reward R$50, autoApprove=true
4. Create an INDIVIDUAL goal for a specific rider: "Tempo Médio ≤30min", AVG_DELIVERY_TIME, LTE, 30, MONTHLY, reward "Almoço grátis", autoApprove=false
5. Log in as a rider and navigate to /rider/ranking — verify goals display with progress bars, stars, and rewards
6. Complete an order for the rider — verify goal progress updates
7. If rider achieves a goal with autoApprove, verify RiderTransaction GOAL_REWARD is created
8. If rider achieves a manual-approval goal, verify achievement appears as PENDING_APPROVAL in admin panel
9. Approve the pending achievement from admin — verify status changes and money is credited

**Step 2: Edge cases to verify**

- Goal with no riders assigned (INDIVIDUAL scope, empty) — should not break
- Rider with no goals — should show "Nenhuma meta ativa"
- Recurrent MONTHLY goal crossing month boundary — cycle should recalculate
- Double-achievement prevention — same rider/goal/cycle should not create duplicate

**Step 3: Commit any fixes**

```bash
git add -A
git commit -m "fix(goals): address integration testing issues"
```

---

## Summary

| Task | Component | Files |
|------|-----------|-------|
| 1 | Prisma Schema | `schema.prisma` |
| 2 | Goal Service | `services/riderGoals.js` (new) |
| 3 | Admin Routes | `routes/goals.js` (new), `routes/riders.js` |
| 4 | Rider Routes | `routes/riders.js` |
| 5 | Event Hooks | `routes/orders.js`, `routes/riders.js`, `socketEmitters.js` |
| 6 | Rider Goals UI | `views/rider/Ranking.vue` (rewrite) |
| 7 | Admin Goals UI | `views/RiderGoals.vue` (new) |
| 8 | Admin Ranking UI | `views/RiderRanking.vue` (rewrite) |
| 9 | Nav + Routing | `router.js`, `config/nav.js` |
| 10 | Integration Test | Manual testing |
