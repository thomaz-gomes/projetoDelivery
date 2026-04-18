import express from 'express';
import { prisma } from '../prisma.js';
import { addRiderTransaction } from '../services/riderAccount.js';

const goalsRouter = express.Router();

// ==================== GOALS CRUD ====================

// GET / — List goals for company with optional filters
goalsRouter.get('/', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const where = { companyId };

    if (req.query.active !== undefined) {
      where.active = req.query.active === 'true';
    }
    if (req.query.scope) {
      where.scope = req.query.scope;
    }
    if (req.query.ruleType) {
      where.ruleType = req.query.ruleType;
    }

    const goals = await prisma.riderGoal.findMany({
      where,
      include: {
        assignments: {
          include: { rider: { select: { id: true, name: true } } },
        },
        _count: { select: { achievements: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json(goals);
  } catch (e) {
    console.error('GET /goals error:', e);
    res.status(500).json({ message: 'Erro ao listar metas' });
  }
});

// POST / — Create goal
goalsRouter.post('/', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const {
      name, description, ruleType, ruleOperator, ruleValue,
      scope, periodType, startDate, endDate,
      rewardType, rewardAmount, rewardDescription,
      autoApprove, riderIds,
    } = req.body;

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
        ruleValue,
        scope,
        periodType,
        startDate: new Date(startDate),
        endDate: endDate ? new Date(endDate) : null,
        rewardType: rewardType || 'CUSTOM',
        rewardAmount: rewardAmount != null ? rewardAmount : null,
        rewardDescription: rewardDescription || null,
        autoApprove: autoApprove === true,
      },
    });

    // If INDIVIDUAL scope and riderIds provided, create assignments
    if (scope === 'INDIVIDUAL' && Array.isArray(riderIds) && riderIds.length > 0) {
      await prisma.riderGoalAssignment.createMany({
        data: riderIds.map(riderId => ({ goalId: goal.id, riderId })),
        skipDuplicates: true,
      });
    }

    const created = await prisma.riderGoal.findUnique({
      where: { id: goal.id },
      include: {
        assignments: { include: { rider: { select: { id: true, name: true } } } },
      },
    });

    res.status(201).json(created);
  } catch (e) {
    console.error('POST /goals error:', e);
    res.status(500).json({ message: 'Erro ao criar meta' });
  }
});

// PUT /:id — Update goal
goalsRouter.put('/:id', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const goal = await prisma.riderGoal.findFirst({ where: { id: req.params.id, companyId } });
    if (!goal) return res.status(404).json({ message: 'Meta não encontrada' });

    const {
      name, description, ruleType, ruleOperator, ruleValue,
      scope, periodType, startDate, endDate,
      rewardType, rewardAmount, rewardDescription,
      autoApprove, active,
    } = req.body;

    const data = {};
    if (name !== undefined) data.name = name;
    if (description !== undefined) data.description = description;
    if (ruleType !== undefined) data.ruleType = ruleType;
    if (ruleOperator !== undefined) data.ruleOperator = ruleOperator;
    if (ruleValue !== undefined) data.ruleValue = ruleValue;
    if (scope !== undefined) data.scope = scope;
    if (periodType !== undefined) data.periodType = periodType;
    if (startDate !== undefined) data.startDate = new Date(startDate);
    if (endDate !== undefined) data.endDate = endDate ? new Date(endDate) : null;
    if (rewardType !== undefined) data.rewardType = rewardType;
    if (rewardAmount !== undefined) data.rewardAmount = rewardAmount;
    if (rewardDescription !== undefined) data.rewardDescription = rewardDescription;
    if (autoApprove !== undefined) data.autoApprove = autoApprove;
    if (active !== undefined) data.active = active;

    const updated = await prisma.riderGoal.update({
      where: { id: req.params.id },
      data,
      include: {
        assignments: { include: { rider: { select: { id: true, name: true } } } },
      },
    });

    res.json(updated);
  } catch (e) {
    console.error('PUT /goals/:id error:', e);
    res.status(500).json({ message: 'Erro ao atualizar meta' });
  }
});

// DELETE /:id — Soft delete (set active=false)
goalsRouter.delete('/:id', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const goal = await prisma.riderGoal.findFirst({ where: { id: req.params.id, companyId } });
    if (!goal) return res.status(404).json({ message: 'Meta não encontrada' });

    await prisma.riderGoal.update({ where: { id: req.params.id }, data: { active: false } });
    res.json({ ok: true });
  } catch (e) {
    console.error('DELETE /goals/:id error:', e);
    res.status(500).json({ message: 'Erro ao desativar meta' });
  }
});

// ==================== ASSIGNMENTS ====================

// POST /:id/assign — Assign riders to INDIVIDUAL goal
goalsRouter.post('/:id/assign', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const goal = await prisma.riderGoal.findFirst({ where: { id: req.params.id, companyId } });
    if (!goal) return res.status(404).json({ message: 'Meta não encontrada' });
    if (goal.scope !== 'INDIVIDUAL') return res.status(400).json({ message: 'Atribuição de entregadores só é permitida para metas com escopo INDIVIDUAL' });

    const { riderIds } = req.body;
    if (!Array.isArray(riderIds) || riderIds.length === 0) {
      return res.status(400).json({ message: 'riderIds deve ser um array não vazio' });
    }

    await prisma.riderGoalAssignment.createMany({
      data: riderIds.map(riderId => ({ goalId: goal.id, riderId })),
      skipDuplicates: true,
    });

    const assignments = await prisma.riderGoalAssignment.findMany({
      where: { goalId: goal.id },
      include: { rider: { select: { id: true, name: true } } },
    });

    res.json(assignments);
  } catch (e) {
    console.error('POST /goals/:id/assign error:', e);
    res.status(500).json({ message: 'Erro ao atribuir entregadores à meta' });
  }
});

// DELETE /:id/assign/:riderId — Remove rider from goal
goalsRouter.delete('/:id/assign/:riderId', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const goal = await prisma.riderGoal.findFirst({ where: { id: req.params.id, companyId } });
    if (!goal) return res.status(404).json({ message: 'Meta não encontrada' });

    await prisma.riderGoalAssignment.deleteMany({
      where: { goalId: goal.id, riderId: req.params.riderId },
    });

    res.json({ ok: true });
  } catch (e) {
    console.error('DELETE /goals/:id/assign/:riderId error:', e);
    res.status(500).json({ message: 'Erro ao remover entregador da meta' });
  }
});

// ==================== ACHIEVEMENTS ====================

// GET /achievements — List achievements with filters
goalsRouter.get('/achievements', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const where = { goal: { companyId } };

    if (req.query.status) where.status = req.query.status;
    if (req.query.riderId) where.riderId = req.query.riderId;
    if (req.query.goalId) where.goalId = req.query.goalId;

    const achievements = await prisma.riderGoalAchievement.findMany({
      where,
      include: {
        goal: { select: { id: true, name: true, ruleType: true, rewardType: true, rewardDescription: true } },
        rider: { select: { id: true, name: true } },
      },
      orderBy: { achievedAt: 'desc' },
      take: 200,
    });

    res.json(achievements);
  } catch (e) {
    console.error('GET /goals/achievements error:', e);
    res.status(500).json({ message: 'Erro ao listar conquistas' });
  }
});

// PUT /achievements/:id/approve — Approve pending achievement
goalsRouter.put('/achievements/:id/approve', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const achievement = await prisma.riderGoalAchievement.findFirst({
      where: { id: req.params.id, goal: { companyId } },
      include: { goal: true },
    });
    if (!achievement) return res.status(404).json({ message: 'Conquista não encontrada' });
    if (achievement.status !== 'PENDING_APPROVAL') {
      return res.status(400).json({ message: 'Apenas conquistas pendentes podem ser aprovadas' });
    }

    const hasMoneyReward = achievement.goal.rewardType === 'MONEY' || achievement.goal.rewardType === 'MONEY_AND_CUSTOM';
    const rewardAmount = achievement.rewardAmount ? Number(achievement.rewardAmount) : 0;

    if (hasMoneyReward && rewardAmount > 0) {
      // Create rider transaction for the reward
      const transaction = await addRiderTransaction({
        companyId,
        riderId: achievement.riderId,
        amount: rewardAmount,
        type: 'GOAL_REWARD',
        date: new Date(),
        note: `Meta atingida: ${achievement.goal.name}`,
      });

      await prisma.riderGoalAchievement.update({
        where: { id: req.params.id },
        data: {
          status: 'CREDITED',
          transactionId: transaction?.id || null,
        },
      });

      return res.json({ ok: true, status: 'CREDITED', transactionId: transaction?.id });
    }

    // Custom-only reward
    await prisma.riderGoalAchievement.update({
      where: { id: req.params.id },
      data: { status: 'APPROVED' },
    });

    res.json({ ok: true, status: 'APPROVED' });
  } catch (e) {
    console.error('PUT /goals/achievements/:id/approve error:', e);
    res.status(500).json({ message: 'Erro ao aprovar conquista' });
  }
});

// PUT /achievements/:id/reject — Reject pending achievement
goalsRouter.put('/achievements/:id/reject', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const achievement = await prisma.riderGoalAchievement.findFirst({
      where: { id: req.params.id, goal: { companyId } },
    });
    if (!achievement) return res.status(404).json({ message: 'Conquista não encontrada' });
    if (achievement.status !== 'PENDING_APPROVAL') {
      return res.status(400).json({ message: 'Apenas conquistas pendentes podem ser rejeitadas' });
    }

    await prisma.riderGoalAchievement.update({
      where: { id: req.params.id },
      data: { status: 'REJECTED' },
    });

    res.json({ ok: true, status: 'REJECTED' });
  } catch (e) {
    console.error('PUT /goals/achievements/:id/reject error:', e);
    res.status(500).json({ message: 'Erro ao rejeitar conquista' });
  }
});

export default goalsRouter;
