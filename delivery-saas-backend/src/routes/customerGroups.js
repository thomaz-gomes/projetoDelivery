import express from 'express';
import { prisma } from '../prisma.js';
import { authMiddleware, requireRole } from '../auth.js';

export const customerGroupsRouter = express.Router();
customerGroupsRouter.use(authMiddleware);

// List groups for company
customerGroupsRouter.get('/', async (req, res) => {
  const companyId = req.user.companyId;
  const rows = await prisma.customerGroup.findMany({
    where: { companyId },
    orderBy: { createdAt: 'desc' },
    include: { rules: true, members: { include: { customer: { select: { id: true, fullName: true, whatsapp: true } } } } },
  });
  res.json(rows);
});

// Get single group
customerGroupsRouter.get('/:id', async (req, res) => {
  const companyId = req.user.companyId;
  const { id } = req.params;
  const g = await prisma.customerGroup.findFirst({ where: { id, companyId }, include: { rules: true, members: { include: { customer: true } } } });
  if (!g) return res.status(404).json({ message: 'Group not found' });
  res.json(g);
});

// Create group
customerGroupsRouter.post('/', requireRole('ADMIN'), async (req, res) => {
  const companyId = req.user.companyId;
  const { name, description, active = true, rules = [] } = req.body || {};
  if (!name) return res.status(400).json({ message: 'Name is required' });
  try {
    const g = await prisma.customerGroup.create({
      data: {
        companyId,
        name,
        description: description || null,
        active: !!active,
        rules: { create: (rules || []).map(r => ({ type: r.type, target: r.target, targetRef: r.targetRef || null, value: r.value || 0, minSubtotal: r.minSubtotal || null, schedule: r.schedule || null, deliveryType: r.deliveryType || 'ANY', noCoupon: !!r.noCoupon, active: r.active !== false })) },
      },
      include: { rules: true, members: true },
    });
    return res.status(201).json(g);
  } catch (e) {
    console.error('Failed to create customer group:', e && e.message ? e.message : e);
    // Unique constraint (name per company) -> return 400 with helpful message
    if (e && e.code === 'P2002') {
      return res.status(400).json({ message: 'A group with this name already exists' });
    }
    return res.status(500).json({ message: 'Failed to create group', error: String(e && (e.message || e)) });
  }
});

// Update group
customerGroupsRouter.patch('/:id', requireRole('ADMIN'), async (req, res) => {
  const companyId = req.user.companyId;
  const { id } = req.params;
  const { name, description, active, rules } = req.body || {};
  const existing = await prisma.customerGroup.findFirst({ where: { id, companyId } });
  if (!existing) return res.status(404).json({ message: 'Group not found' });
  const data = {};
  if (name !== undefined) data.name = name;
  if (description !== undefined) data.description = description;
  if (active !== undefined) data.active = !!active;
  // update basic group data first
  const updated = await prisma.customerGroup.update({ where: { id }, data, include: { rules: true, members: true } });

  // if rules array provided, replace existing rules with the provided set
  if (Array.isArray(rules)) {
    // delete existing rules for this group
    await prisma.customerGroupRule.deleteMany({ where: { groupId: id } });
    // create new rules from payload
    const toCreate = (rules || []).map(r => ({
      groupId: id,
      type: r.type,
      target: r.target,
      targetRef: r.targetRef || null,
      value: r.value !== undefined ? (typeof r.value === 'string' ? Number(r.value) : r.value) : 0,
      minSubtotal: r.minSubtotal !== undefined && r.minSubtotal !== null ? Number(r.minSubtotal) : null,
      schedule: r.weeklySchedule || r.schedule || null,
      deliveryType: r.deliveryType || 'ANY',
      noCoupon: !!r.noCoupon,
      active: r.active !== false,
    }));
    // create sequentially to avoid overwhelming SQLite with parallel writes
    for (const rc of toCreate) {
      await prisma.customerGroupRule.create({ data: rc });
    }
  }

  const reloaded = await prisma.customerGroup.findFirst({ where: { id, companyId }, include: { rules: true, members: true } });
  res.json(reloaded);
});

// Delete group
customerGroupsRouter.delete('/:id', requireRole('ADMIN'), async (req, res) => {
  const companyId = req.user.companyId;
  const { id } = req.params;
  const existing = await prisma.customerGroup.findFirst({ where: { id, companyId } });
  if (!existing) return res.status(404).json({ message: 'Group not found' });
  // cascade delete rules and members
  await prisma.customerGroupRule.deleteMany({ where: { groupId: id } });
  await prisma.customerGroupMember.deleteMany({ where: { groupId: id } });
  await prisma.customerGroup.delete({ where: { id } });
  res.json({ ok: true });
});

// Members management
customerGroupsRouter.post('/:id/members', requireRole('ADMIN'), async (req, res) => {
  const companyId = req.user.companyId;
  const { id } = req.params;
  const { customerId } = req.body || {};
  if (!customerId) return res.status(400).json({ message: 'customerId is required' });
  const group = await prisma.customerGroup.findFirst({ where: { id, companyId } });
  if (!group) return res.status(404).json({ message: 'Group not found' });
  const customer = await prisma.customer.findFirst({ where: { id: customerId, companyId } });
  if (!customer) return res.status(404).json({ message: 'Customer not found' });
  // avoid duplicates
  const exists = await prisma.customerGroupMember.findFirst({ where: { groupId: id, customerId } });
  if (exists) return res.status(200).json(exists);
  const m = await prisma.customerGroupMember.create({ data: { groupId: id, customerId }, include: { customer: true } });
  res.status(201).json(m);
});

customerGroupsRouter.delete('/:id/members/:memberId', requireRole('ADMIN'), async (req, res) => {
  const companyId = req.user.companyId;
  const { id, memberId } = req.params;
  const group = await prisma.customerGroup.findFirst({ where: { id, companyId } });
  if (!group) return res.status(404).json({ message: 'Group not found' });
  const member = await prisma.customerGroupMember.findFirst({ where: { id: memberId, groupId: id } });
  if (!member) return res.status(404).json({ message: 'Member not found' });
  await prisma.customerGroupMember.delete({ where: { id: memberId } });
  res.json({ ok: true });
});

// Rules management
customerGroupsRouter.post('/:id/rules', requireRole('ADMIN'), async (req, res) => {
  const companyId = req.user.companyId;
  const { id } = req.params;
  const { type, target, targetRef, value = 0, minSubtotal = null, schedule = null, deliveryType = 'ANY', noCoupon = false, active = true } = req.body || {};
  if (!type || !target) return res.status(400).json({ message: 'type and target are required' });
  const group = await prisma.customerGroup.findFirst({ where: { id, companyId } });
  if (!group) return res.status(404).json({ message: 'Group not found' });
  const r = await prisma.customerGroupRule.create({ data: { groupId: id, type, target, targetRef: targetRef || null, value: value.toString ? value : Number(value), minSubtotal: minSubtotal ? Number(minSubtotal) : null, schedule: schedule || null, deliveryType, noCoupon: !!noCoupon, active: !!active } });
  res.status(201).json(r);
});

customerGroupsRouter.patch('/:id/rules/:ruleId', requireRole('ADMIN'), async (req, res) => {
  const companyId = req.user.companyId;
  const { id, ruleId } = req.params;
  const group = await prisma.customerGroup.findFirst({ where: { id, companyId } });
  if (!group) return res.status(404).json({ message: 'Group not found' });
  const rule = await prisma.customerGroupRule.findFirst({ where: { id: ruleId, groupId: id } });
  if (!rule) return res.status(404).json({ message: 'Rule not found' });
  const patch = {};
  const { type, target, targetRef, value, minSubtotal, schedule, deliveryType, noCoupon, active } = req.body || {};
  if (type !== undefined) patch.type = type;
  if (target !== undefined) patch.target = target;
  if (targetRef !== undefined) patch.targetRef = targetRef;
  if (value !== undefined) patch.value = value;
  if (minSubtotal !== undefined) patch.minSubtotal = minSubtotal !== null ? Number(minSubtotal) : null;
  if (schedule !== undefined) patch.schedule = schedule;
  if (deliveryType !== undefined) patch.deliveryType = deliveryType;
  if (noCoupon !== undefined) patch.noCoupon = !!noCoupon;
  if (active !== undefined) patch.active = !!active;
  const updated = await prisma.customerGroupRule.update({ where: { id: ruleId }, data: patch });
  res.json(updated);
});

customerGroupsRouter.delete('/:id/rules/:ruleId', requireRole('ADMIN'), async (req, res) => {
  const companyId = req.user.companyId;
  const { id, ruleId } = req.params;
  const group = await prisma.customerGroup.findFirst({ where: { id, companyId } });
  if (!group) return res.status(404).json({ message: 'Group not found' });
  const rule = await prisma.customerGroupRule.findFirst({ where: { id: ruleId, groupId: id } });
  if (!rule) return res.status(404).json({ message: 'Rule not found' });
  await prisma.customerGroupRule.delete({ where: { id: ruleId } });
  res.json({ ok: true });
});

export default customerGroupsRouter;
