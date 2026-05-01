import express from 'express';
import { prisma } from '../prisma.js';
import { authMiddleware, requireRole, createUser } from '../auth.js';
import riderAccountService from '../services/riderAccount.js';
import { evoSendDocument, evoSendMediaUrl, evoSendText, normalizePhone } from '../wa.js';
import fs from 'fs';
import path from 'path';
import { assertModuleEnabled } from '../utils/saas.js';
import { createFinancialEntryForRider } from '../services/financial/orderFinancialBridge.js';
import { emitirPosicaoEntregador, emitirEntregadorOffline } from '../index.js';
import { getGoalsForRider } from '../services/riderGoals.js';
import goalsRouter from './goals.js';

export const ridersRouter = express.Router();
ridersRouter.use(authMiddleware);

// Enforce SaaS module availability: RIDERS must be enabled in the company's plan
ridersRouter.use(async (req, res, next) => {
  try {
    await assertModuleEnabled(req.user.companyId, 'RIDERS')
    return next()
  } catch (e) {
    const status = e && e.statusCode ? e.statusCode : 403
    return res.status(status).json({ message: 'Módulo de entregadores não está disponível no seu plano.' })
  }
});

// Haversine distance in meters
function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

ridersRouter.get('/', async (req, res) => {
  const companyId = req.user.companyId;
  const includeInactive = req.query.includeInactive === 'true';
  const where = includeInactive ? { companyId } : { companyId, active: true };
  const riders = await prisma.rider.findMany({
    where,
    select: { id: true, name: true, whatsapp: true, active: true }
  });
  res.json(riders);
});

// ---- Real-time Rider Tracking ----
// These must be defined BEFORE /:id to avoid being swallowed by the wildcard route.

// GET /riders/tracking-status — any authenticated user (rider or admin)
ridersRouter.get('/tracking-status', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const setting = await prisma.printerSetting.findUnique({ where: { companyId } });
    return res.json({ enabled: setting?.trackingEnabled ?? false });
  } catch (e) {
    console.error('tracking-status error:', e);
    return res.json({ enabled: false });
  }
});

// PUT /riders/tracking-toggle — ADMIN only
ridersRouter.put('/tracking-toggle', requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { enabled } = req.body;
    if (typeof enabled !== 'boolean') return res.status(400).json({ message: 'Campo enabled (boolean) obrigatório' });
    await prisma.printerSetting.upsert({
      where: { companyId },
      update: { trackingEnabled: enabled },
      create: { companyId, trackingEnabled: enabled },
    });
    return res.json({ ok: true, enabled });
  } catch (e) {
    console.error('tracking-toggle error:', e);
    return res.status(500).json({ message: 'Erro ao salvar configuração de rastreamento' });
  }
});

// POST /riders/me/position — RIDER only
ridersRouter.post('/me/position', requireRole('RIDER'), async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const riderId = req.user.riderId;
    if (!riderId) return res.status(400).json({ message: 'riderId não encontrado no token' });

    const { lat, lng, heading, orderId, accuracy } = req.body;
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      return res.status(400).json({ message: 'lat e lng (number) são obrigatórios' });
    }

    // Verify tracking is enabled for this company
    const setting = await prisma.printerSetting.findUnique({ where: { companyId } });
    if (!setting?.trackingEnabled) return res.json({ ok: false, reason: 'tracking_disabled' });

    // Upsert rider position
    const position = await prisma.riderPosition.upsert({
      where: { riderId },
      update: { lat, lng, heading: heading ?? null, orderId: orderId ?? null, accuracy: typeof accuracy === 'number' ? accuracy : null },
      create: { riderId, lat, lng, heading: heading ?? null, orderId: orderId ?? null, accuracy: typeof accuracy === 'number' ? accuracy : null },
    });

    // Get rider name for the socket payload
    const rider = await prisma.rider.findUnique({ where: { id: riderId }, select: { name: true } });

    // Emit to admin dashboard sockets of this company
    if (!position.hidden) {
      try {
        emitirPosicaoEntregador(companyId, {
          riderId,
          riderName: rider?.name || 'Entregador',
          lat,
          lng,
          heading: heading ?? null,
          orderId: orderId ?? null,
          accuracy: typeof accuracy === 'number' ? accuracy : null,
          updatedAt: position.updatedAt,
        });
      } catch (e) { /* non-blocking */ }
    }

    // Async cleanup: delete positions not updated in last 24h
    prisma.riderPosition.deleteMany({
      where: { updatedAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
    }).catch(() => {});

    return res.json({ ok: true });
  } catch (e) {
    console.error('me/position error:', e);
    return res.status(500).json({ message: 'Erro ao salvar posição' });
  }
});

// DELETE /riders/me/position — RIDER only (called on logout to clear position from map)
ridersRouter.delete('/me/position', requireRole('RIDER'), async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const riderId = req.user.riderId;
    if (!riderId) return res.status(400).json({ message: 'riderId não encontrado no token' });

    await prisma.riderPosition.deleteMany({ where: { riderId } });

    emitirEntregadorOffline(companyId, riderId);

    return res.json({ ok: true });
  } catch (e) {
    console.error('DELETE me/position error:', e);
    return res.status(500).json({ message: 'Erro ao remover posição' });
  }
});

// GET /riders/me/daily-stats — RIDER only
// Returns today/month earnings, delivery counts, check-in status and active order
ridersRouter.get('/me/daily-stats', requireRole('RIDER'), async (req, res) => {
  try {
    const riderId = req.user.riderId;
    if (!riderId) return res.status(400).json({ message: 'riderId não encontrado no token' });

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    // Today earnings (sum of riderTransaction amounts)
    const todayTxAgg = await prisma.riderTransaction.aggregate({
      _sum: { amount: true },
      where: { riderId, date: { gte: todayStart } }
    });
    const todayEarnings = todayTxAgg._sum.amount || 0;

    // Today deliveries (completed orders)
    const todayDeliveries = await prisma.order.count({
      where: { riderId, status: 'CONCLUIDO', updatedAt: { gte: todayStart } }
    });

    // Month earnings
    const monthTxAgg = await prisma.riderTransaction.aggregate({
      _sum: { amount: true },
      where: { riderId, date: { gte: monthStart } }
    });
    const monthEarnings = monthTxAgg._sum.amount || 0;

    // Month deliveries
    const monthDeliveries = await prisma.order.count({
      where: { riderId, status: 'CONCLUIDO', updatedAt: { gte: monthStart } }
    });

    // Check-in today
    const tomorrow = new Date(todayStart);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const checkinToday = await prisma.riderCheckin.findFirst({
      where: { riderId, checkinAt: { gte: todayStart, lt: tomorrow } }
    });
    const checkedIn = !!checkinToday;

    // Active shift (no checkoutAt)
    const activeCheckin = await prisma.riderCheckin.findFirst({
      where: { riderId, checkoutAt: null },
      orderBy: { checkinAt: 'desc' },
    });
    const hasActiveShift = !!activeCheckin;

    // Active order (not CONCLUIDO)
    const activeOrderRaw = await prisma.order.findFirst({
      where: { riderId, status: { not: 'CONCLUIDO' } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, displayId: true, displaySimple: true, status: true, customerName: true, address: true }
    });
    const activeOrder = activeOrderRaw
      ? {
          id: activeOrderRaw.id,
          displayId: activeOrderRaw.displayId,
          displaySimple: activeOrderRaw.displaySimple,
          status: activeOrderRaw.status,
          customerName: activeOrderRaw.customerName || null,
          address: activeOrderRaw.address || null,
        }
      : null;

    return res.json({ todayEarnings, todayDeliveries, monthEarnings, monthDeliveries, checkedIn, hasActiveShift, activeOrder });
  } catch (e) {
    console.error('me/daily-stats error:', e);
    return res.status(500).json({ message: 'Erro ao buscar estatísticas diárias' });
  }
});

// GET /riders/map/positions — ADMIN/ATTENDANT
// Shows riders who checked in today. If ?shiftOnly=true, filters by currently active shift.
ridersRouter.get('/map/positions', requireRole('ADMIN', 'SUPER_ADMIN', 'ATTENDANT'), async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Find today's checkins
    const checkins = await prisma.riderCheckin.findMany({
      where: { companyId, checkinAt: { gte: today, lt: tomorrow } },
      include: { shift: true },
    });

    let activeRiderIds = checkins.map(c => c.riderId);

    // Optional: filter by active shift only
    if (req.query.shiftOnly === 'true') {
      const nowMinutes = now.getHours() * 60 + now.getMinutes();
      activeRiderIds = checkins
        .filter(c => {
          if (!c.shift) return true;
          const [sh, sm] = c.shift.startTime.split(':').map(Number);
          const [eh, em] = c.shift.endTime.split(':').map(Number);
          const startMin = sh * 60 + sm;
          const endMin = eh * 60 + em;
          if (endMin <= startMin) return nowMinutes >= startMin || nowMinutes < endMin;
          return nowMinutes >= startMin && nowMinutes < endMin;
        })
        .map(c => c.riderId);
    }

    // Deduplicate
    activeRiderIds = [...new Set(activeRiderIds)];

    if (activeRiderIds.length === 0) {
      // Fallback: show ALL positions updated in last 30 min (riders still sending GPS)
      const cutoff = new Date(Date.now() - 30 * 60 * 1000);
      const positions = await prisma.riderPosition.findMany({
        where: { rider: { companyId }, hidden: false, updatedAt: { gte: cutoff } },
        include: { rider: { select: { id: true, name: true } } },
        orderBy: { updatedAt: 'desc' },
      });
      return res.json(positions);
    }

    const positions = await prisma.riderPosition.findMany({
      where: { riderId: { in: activeRiderIds }, hidden: false },
      include: { rider: { select: { id: true, name: true } } },
      orderBy: { updatedAt: 'desc' },
    });
    return res.json(positions);
  } catch (e) {
    console.error('map/positions error:', e);
    return res.status(500).json({ message: 'Erro ao buscar posições' });
  }
});

// GET /riders/map/deliveries — active orders with coordinates for the map
ridersRouter.get('/map/deliveries', requireRole('ADMIN', 'SUPER_ADMIN', 'ATTENDANT'), async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const stores = await prisma.store.findMany({ where: { companyId }, select: { id: true, name: true, address: true } });
    const storeIds = stores.map(s => s.id);
    const orders = await prisma.order.findMany({
      where: {
        storeId: { in: storeIds },
        status: { in: ['EM_PREPARO', 'SAIU_PARA_ENTREGA'] },
        OR: [
          { orderType: null },
          { orderType: { notIn: ['RETIRADA', 'TAKEOUT', 'PICKUP', 'BALCAO', 'BALCÃO', 'INDOOR'] } },
        ],
        createdAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()) },
      },
      select: {
        id: true,
        displayId: true,
        displaySimple: true,
        status: true,
        address: true,
        latitude: true,
        longitude: true,
        payload: true,
        customerName: true,
        customerPhone: true,
        orderType: true,
        riderId: true,
        rider: { select: { id: true, name: true } },
        storeId: true,
        store: { select: { id: true, name: true, address: true, latitude: true, longitude: true } },
        deliveryNeighborhood: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    return res.json(orders);
  } catch (e) {
    console.error('map/deliveries error:', e);
    return res.status(500).json({ message: 'Erro ao buscar entregas' });
  }
});

// PUT /riders/:riderId/position/hide — ADMIN only (toggle hidden on map)
ridersRouter.put('/:riderId/position/hide', requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { riderId } = req.params;
    const { hidden } = req.body;

    const rider = await prisma.rider.findFirst({ where: { id: riderId, companyId } });
    if (!rider) return res.status(404).json({ message: 'Entregador não encontrado' });

    const position = await prisma.riderPosition.findUnique({ where: { riderId } });
    if (!position) return res.status(404).json({ message: 'Posição não encontrada' });

    await prisma.riderPosition.update({
      where: { riderId },
      data: { hidden: typeof hidden === 'boolean' ? hidden : true },
    });

    return res.json({ ok: true, hidden: typeof hidden === 'boolean' ? hidden : true });
  } catch (e) {
    console.error('PUT /:riderId/position/hide error:', e);
    return res.status(500).json({ message: 'Erro ao ocultar entregador' });
  }
});

// ==================== CHECKIN LOCATIONS ====================

// GET /riders/checkin-locations
ridersRouter.get('/checkin-locations', async (req, res) => {
  const companyId = req.user.companyId;
  const locations = await prisma.checkinLocation.findMany({
    where: { companyId },
    orderBy: { createdAt: 'desc' }
  });
  res.json(locations);
});

// POST /riders/checkin-locations
ridersRouter.post('/checkin-locations', async (req, res) => {
  const companyId = req.user.companyId;
  const { name, address, latitude, longitude, radius } = req.body;
  if (!name || latitude == null || longitude == null) {
    return res.status(400).json({ message: 'name, latitude e longitude são obrigatórios' });
  }
  const location = await prisma.checkinLocation.create({
    data: { companyId, name, address, latitude: Number(latitude), longitude: Number(longitude), radius: radius ? Number(radius) : 200 }
  });
  res.status(201).json(location);
});

// PATCH /riders/checkin-locations/:id
ridersRouter.patch('/checkin-locations/:id', async (req, res) => {
  const companyId = req.user.companyId;
  const loc = await prisma.checkinLocation.findFirst({ where: { id: req.params.id, companyId } });
  if (!loc) return res.status(404).json({ message: 'Local não encontrado' });
  const data = { ...req.body };
  if (data.latitude != null) data.latitude = Number(data.latitude);
  if (data.longitude != null) data.longitude = Number(data.longitude);
  if (data.radius != null) data.radius = Number(data.radius);
  const updated = await prisma.checkinLocation.update({ where: { id: req.params.id }, data });
  res.json(updated);
});

// DELETE /riders/checkin-locations/:id
ridersRouter.delete('/checkin-locations/:id', async (req, res) => {
  const companyId = req.user.companyId;
  const loc = await prisma.checkinLocation.findFirst({ where: { id: req.params.id, companyId } });
  if (!loc) return res.status(404).json({ message: 'Local não encontrado' });
  await prisma.checkinLocation.update({ where: { id: req.params.id }, data: { active: false } });
  res.json({ ok: true });
});

// ==================== SHIFTS ====================

// GET /riders/shifts — listar turnos da empresa
ridersRouter.get('/shifts', async (req, res) => {
  const companyId = req.user.companyId;
  const shifts = await prisma.riderShift.findMany({
    where: { companyId },
    orderBy: { startTime: 'asc' },
    include: { checkinLocation: { select: { id: true, name: true } } }
  });
  res.json(shifts);
});

// POST /riders/shifts — criar turno
ridersRouter.post('/shifts', async (req, res) => {
  const companyId = req.user.companyId;
  const { name, startTime, endTime, checkinLocationId } = req.body;
  if (!name || !startTime || !endTime) return res.status(400).json({ message: 'name, startTime e endTime são obrigatórios' });
  const shift = await prisma.riderShift.create({
    data: { companyId, name, startTime, endTime, checkinLocationId: checkinLocationId || null }
  });
  res.status(201).json(shift);
});

// PATCH /riders/shifts/:id — editar turno
ridersRouter.patch('/shifts/:id', async (req, res) => {
  const companyId = req.user.companyId;
  const shift = await prisma.riderShift.findFirst({ where: { id: req.params.id, companyId } });
  if (!shift) return res.status(404).json({ message: 'Turno não encontrado' });
  const updated = await prisma.riderShift.update({
    where: { id: req.params.id },
    data: req.body
  });
  res.json(updated);
});

// DELETE /riders/shifts/:id — desativar turno
ridersRouter.delete('/shifts/:id', async (req, res) => {
  const companyId = req.user.companyId;
  const shift = await prisma.riderShift.findFirst({ where: { id: req.params.id, companyId } });
  if (!shift) return res.status(404).json({ message: 'Turno não encontrado' });
  await prisma.riderShift.update({ where: { id: req.params.id }, data: { active: false } });
  res.json({ ok: true });
});

// ==================== CHECK-IN ====================

// POST /riders/me/checkin — motoboy faz check-in
ridersRouter.post('/me/checkin', async (req, res) => {
  const userId = req.user.id;
  const rider = await prisma.rider.findFirst({ where: { userId, active: true } });
  if (!rider) return res.status(403).json({ message: 'Você não é um entregador' });

  const { lat, lng, shiftId } = req.body;
  if (lat == null || lng == null || !shiftId) return res.status(400).json({ message: 'lat, lng e shiftId são obrigatórios' });

  const companyId = rider.companyId;

  // Validar turno
  const shift = await prisma.riderShift.findFirst({ where: { id: shiftId, companyId, active: true } });
  if (!shift) return res.status(400).json({ message: 'Turno não encontrado ou inativo' });

  // Validar que motoboy está atribuído a este turno
  const assignment = await prisma.riderShiftAssignment.findUnique({
    where: { riderId_shiftId: { riderId: rider.id, shiftId } }
  });
  if (!assignment) return res.status(403).json({ message: 'Você não está atribuído a este turno' });

  // Evitar check-in duplicado no mesmo turno/dia
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const existing = await prisma.riderCheckin.findFirst({
    where: { riderId: rider.id, shiftId, checkinAt: { gte: today, lt: tomorrow } }
  });
  if (existing) return res.status(409).json({ message: 'Você já fez check-in neste turno hoje', checkin: existing });

  // Bloquear check-in se há um turno em andamento (outro turno cujo endTime ainda não passou)
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const todayCheckins = await prisma.riderCheckin.findMany({
    where: { riderId: rider.id, checkinAt: { gte: today, lt: tomorrow } },
    include: { shift: true }
  });
  for (const c of todayCheckins) {
    if (!c.shift || c.shift.id === shiftId) continue;
    const [endH, endM] = c.shift.endTime.split(':').map(Number);
    const endMinutes = endH * 60 + endM;
    if (nowMinutes < endMinutes) {
      return res.status(409).json({
        message: `Você ainda está no turno "${c.shift.name}" (até ${c.shift.endTime}). Aguarde o término para fazer check-in em outro turno.`
      });
    }
  }

  // Buscar local de check-in do turno
  if (!shift.checkinLocationId) {
    return res.status(400).json({ message: 'Turno não possui local de check-in configurado' });
  }
  const location = await prisma.checkinLocation.findUnique({ where: { id: shift.checkinLocationId } });
  if (!location) {
    return res.status(400).json({ message: 'Local de check-in não encontrado' });
  }

  // Calcular distância
  const distanceMeters = haversineMeters(lat, lng, location.latitude, location.longitude);
  const maxRadius = location.radius || 200; // metros
  if (distanceMeters > maxRadius) {
    return res.status(400).json({
      message: `Você está a ${Math.round(distanceMeters)}m do local de check-in. Máximo permitido: ${maxRadius}m.`,
      distanceMeters: Math.round(distanceMeters)
    });
  }

  // Reverse geocode via Nominatim
  let address = null;
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`;
    const resp = await fetch(url, { headers: { 'User-Agent': 'DeliveryWL/1.0' }, signal: AbortSignal.timeout(5000) });
    const data = await resp.json();
    address = data.display_name || null;
  } catch (e) {
    console.warn('[checkin] reverse geocode failed:', e?.message);
  }

  const checkin = await prisma.riderCheckin.create({
    data: {
      riderId: rider.id,
      companyId,
      shiftId,
      lat,
      lng,
      address,
      checkinAt: new Date(),
      distanceMeters: Math.round(distanceMeters)
    }
  });

  // Check rider goals on check-in
  try {
    const { checkGoalsOnEvent } = await import('../services/riderGoals.js');
    await checkGoalsOnEvent('CHECKIN', rider.id, companyId);
  } catch (e) { console.warn('[goals] check on checkin failed:', e?.message || e); }

  res.status(201).json(checkin);
});

// POST /riders/me/checkout — motoboy encerra turno ativo manualmente
ridersRouter.post('/me/checkout', async (req, res) => {
  const userId = req.user.id;
  const rider = await prisma.rider.findFirst({ where: { userId, active: true } });
  if (!rider) return res.status(403).json({ message: 'Você não é um entregador' });

  const active = await prisma.riderCheckin.findFirst({
    where: { riderId: rider.id, checkoutAt: null },
    orderBy: { checkinAt: 'desc' },
  });

  if (!active) return res.status(404).json({ message: 'Nenhum turno ativo encontrado' });

  const updated = await prisma.riderCheckin.update({
    where: { id: active.id },
    data: { checkoutAt: new Date() },
  });

  res.json(updated);
});

// GET /riders/me/shifts — resumo de turnos para o entregador
ridersRouter.get('/me/shifts', requireRole('RIDER'), async (req, res) => {
  try {
    const userId = req.user.id;
    const rider = await prisma.rider.findFirst({ where: { userId, active: true } });
    if (!rider) return res.status(403).json({ message: 'Você não é um entregador' });

    const checkins = await prisma.riderCheckin.findMany({
      where: { riderId: rider.id },
      include: { shift: { select: { name: true, startTime: true, endTime: true } } },
      orderBy: { checkinAt: 'desc' },
      take: 30,
    });

    const result = await Promise.all(checkins.map(async (c) => {
      const windowEnd = c.checkoutAt || new Date();

      // Orders concluídos neste turno
      const orders = await prisma.order.findMany({
        where: {
          riderId: rider.id,
          status: 'CONCLUIDO',
          updatedAt: { gte: c.checkinAt, lte: windowEnd },
        },
        select: { id: true, deliveryNeighborhood: true },
      });

      // Bairro mais entregue
      const neighCount = {};
      for (const o of orders) {
        const n = o.deliveryNeighborhood;
        if (n) neighCount[n] = (neighCount[n] || 0) + 1;
      }
      const topNeighborhood = Object.entries(neighCount).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

      // Ganhos no turno
      const txs = await prisma.riderTransaction.findMany({
        where: { riderId: rider.id, date: { gte: c.checkinAt, lte: windowEnd } },
        select: { amount: true, type: true },
      });
      const totalEarned = txs.reduce((s, t) => s + Number(t.amount || 0), 0);

      // Metas atingidas no dia do turno
      let goalsHit = 0, goalsTotal = 0;
      try {
        const dayStart = new Date(c.checkinAt);
        dayStart.setUTCHours(0, 0, 0, 0);
        const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
        const goals = await prisma.riderGoal.findMany({
          where: { companyId: rider.companyId, active: true },
        });
        goalsTotal = goals.length;
        for (const g of goals) {
          const progress = await prisma.riderGoalProgress.findFirst({
            where: { riderId: rider.id, goalId: g.id, date: { gte: dayStart, lt: dayEnd } },
          });
          if (progress && progress.achieved) goalsHit++;
        }
      } catch (_) { /* metas opcionais */ }

      return {
        id: c.id,
        checkinAt: c.checkinAt,
        checkoutAt: c.checkoutAt,
        shift: c.shift,
        deliveries: orders.length,
        topNeighborhood,
        totalEarned,
        goalsHit,
        goalsTotal,
        isActive: !c.checkoutAt,
      };
    }));

    res.json(result);
  } catch (e) {
    console.error('GET /riders/me/shifts error:', e);
    res.status(500).json({ message: 'Erro ao carregar histórico de turnos' });
  }
});

// GET /riders/me/checkins — histórico de check-ins do motoboy
ridersRouter.get('/me/checkins', async (req, res) => {
  const userId = req.user.id;
  const rider = await prisma.rider.findFirst({ where: { userId, active: true } });
  if (!rider) return res.status(403).json({ message: 'Você não é um entregador' });

  const { from, to } = req.query;
  const where = { riderId: rider.id };
  if (from || to) {
    where.checkinAt = {};
    if (from) where.checkinAt.gte = new Date(from);
    if (to) where.checkinAt.lte = new Date(to);
  }

  const checkins = await prisma.riderCheckin.findMany({
    where,
    include: { shift: { select: { name: true, startTime: true, endTime: true } } },
    orderBy: { checkinAt: 'desc' },
    take: 100
  });
  res.json(checkins);
});

// GET /riders/checkins — relatório admin de check-ins
ridersRouter.get('/checkins', async (req, res) => {
  const companyId = req.user.companyId;
  const { from, to, riderId } = req.query;

  const where = { companyId };
  if (riderId) where.riderId = riderId;
  if (from || to) {
    where.checkinAt = {};
    if (from) where.checkinAt.gte = new Date(from);
    if (to) where.checkinAt.lte = new Date(to);
  }

  const checkins = await prisma.riderCheckin.findMany({
    where,
    include: {
      rider: { select: { id: true, name: true } },
      shift: { select: { name: true, startTime: true, endTime: true } }
    },
    orderBy: { checkinAt: 'desc' },
    take: 500
  });
  res.json(checkins);
});

// ==================== BONUS RULES ====================

// GET /riders/bonus-rules
ridersRouter.get('/bonus-rules', async (req, res) => {
  const companyId = req.user.companyId;
  const rules = await prisma.riderBonusRule.findMany({
    where: { companyId },
    include: { shift: { select: { name: true } } },
    orderBy: { createdAt: 'desc' }
  });
  res.json(rules);
});

// POST /riders/bonus-rules
ridersRouter.post('/bonus-rules', async (req, res) => {
  const companyId = req.user.companyId;
  const { name, type, deadlineTime, bonusAmount, shiftId } = req.body;
  if (!name || !type || !deadlineTime || bonusAmount == null) {
    return res.status(400).json({ message: 'name, type, deadlineTime e bonusAmount são obrigatórios' });
  }
  const rule = await prisma.riderBonusRule.create({
    data: { companyId, name, type, deadlineTime, bonusAmount, shiftId: shiftId || null }
  });
  res.status(201).json(rule);
});

// PATCH /riders/bonus-rules/:id
ridersRouter.patch('/bonus-rules/:id', async (req, res) => {
  const companyId = req.user.companyId;
  const rule = await prisma.riderBonusRule.findFirst({ where: { id: req.params.id, companyId } });
  if (!rule) return res.status(404).json({ message: 'Regra não encontrada' });
  const updated = await prisma.riderBonusRule.update({
    where: { id: req.params.id },
    data: req.body
  });
  res.json(updated);
});

// DELETE /riders/bonus-rules/:id
ridersRouter.delete('/bonus-rules/:id', async (req, res) => {
  const companyId = req.user.companyId;
  const rule = await prisma.riderBonusRule.findFirst({ where: { id: req.params.id, companyId } });
  if (!rule) return res.status(404).json({ message: 'Regra não encontrada' });
  await prisma.riderBonusRule.update({ where: { id: req.params.id }, data: { active: false } });
  res.json({ ok: true });
});

// ==================== RANKING ====================

// GET /riders/ranking
ridersRouter.get('/ranking', async (req, res) => {
  const companyId = req.user.companyId;
  const userId = req.user.id;
  const isRider = req.user.role === 'RIDER';

  const { from, to } = req.query;
  const dateFrom = from ? new Date(from) : (() => { const d = new Date(); d.setDate(1); d.setHours(0,0,0,0); return d; })();
  const dateTo = to ? new Date(to) : new Date();

  // All active riders
  const riders = await prisma.rider.findMany({
    where: { companyId, active: true },
    select: { id: true, name: true, userId: true }
  });

  // Completed orders in period
  const orders = await prisma.order.findMany({
    where: {
      companyId,
      riderId: { not: null },
      status: 'CONCLUIDO',
      updatedAt: { gte: dateFrom, lte: dateTo }
    },
    select: {
      id: true, riderId: true, closedByIfoodCode: true, updatedAt: true,
      histories: {
        where: { to: { in: ['SAIU_PARA_ENTREGA', 'CONCLUIDO', 'RIDER_DELIVERED'] } },
        select: { to: true, changedAt: true },
        orderBy: { changedAt: 'asc' }
      }
    }
  });

  // Canceled orders count by rider
  const canceledCount = await prisma.order.groupBy({
    by: ['riderId'],
    where: {
      companyId,
      riderId: { not: null },
      status: 'CANCELADO',
      updatedAt: { gte: dateFrom, lte: dateTo }
    },
    _count: { id: true }
  });
  const canceledMap = Object.fromEntries(canceledCount.map(c => [c.riderId, c._count.id]));

  // Check-ins in period
  const checkins = await prisma.riderCheckin.findMany({
    where: { companyId, checkinAt: { gte: dateFrom, lte: dateTo } },
    select: { riderId: true, shiftId: true, checkinAt: true }
  });

  // Active bonus rules (for punctuality calc)
  const bonusRules = await prisma.riderBonusRule.findMany({
    where: { companyId, type: 'EARLY_CHECKIN', active: true }
  });

  // Calculate metrics per rider
  const ranking = riders.map(rider => {
    const riderOrders = orders.filter(o => o.riderId === rider.id);
    const totalDeliveries = riderOrders.length;
    const canceled = canceledMap[rider.id] || 0;
    const completionRate = totalDeliveries + canceled > 0 ? totalDeliveries / (totalDeliveries + canceled) : 0;

    // Average delivery time (minutes)
    // Prefer RIDER_DELIVERED timestamp (actual rider arrival) over CONCLUIDO
    // (which for iFood prepaid orders may come later via webhook)
    let totalTime = 0, timeCount = 0;
    for (const o of riderOrders) {
      const saiu = o.histories.find(h => h.to === 'SAIU_PARA_ENTREGA');
      const riderDelivered = o.histories.find(h => h.to === 'RIDER_DELIVERED');
      const concluido = o.histories.find(h => h.to === 'CONCLUIDO');
      const endEvent = riderDelivered || concluido;
      if (saiu && endEvent) {
        const mins = (new Date(endEvent.changedAt) - new Date(saiu.changedAt)) / 60000;
        if (mins > 0 && mins < 300) { totalTime += mins; timeCount++; }
      }
    }
    const avgDeliveryTime = timeCount > 0 ? Math.round((totalTime / timeCount) * 10) / 10 : null;

    // iFood code rate
    const withCode = riderOrders.filter(o => o.closedByIfoodCode).length;
    const ifoodCodeRate = totalDeliveries > 0 ? withCode / totalDeliveries : 0;

    // Punctuality (% check-ins before deadline)
    const riderCheckins = checkins.filter(c => c.riderId === rider.id);
    const BRT_OFFSET_MS = 3 * 60 * 60 * 1000;
    let onTimeCount = 0;
    for (const c of riderCheckins) {
      // deadlineTime is in BRT; checkinAt is UTC — convert to BRT before comparing
      const brtDate = new Date(new Date(c.checkinAt).getTime() - BRT_OFFSET_MS);
      const checkinMinutes = brtDate.getUTCHours() * 60 + brtDate.getUTCMinutes();
      const isOnTime = bonusRules.some(rule => {
        if (rule.shiftId && c.shiftId !== rule.shiftId) return false;
        const [h, m] = rule.deadlineTime.split(':').map(Number);
        return checkinMinutes <= h * 60 + m;
      });
      if (isOnTime) onTimeCount++;
    }
    const punctualityRate = riderCheckins.length > 0 ? onTimeCount / riderCheckins.length : 0;

    return {
      riderId: rider.id,
      riderName: rider.name,
      totalDeliveries,
      avgDeliveryTime,
      completionRate: Math.round(completionRate * 100),
      ifoodCodeRate: Math.round(ifoodCodeRate * 100),
      punctualityRate: Math.round(punctualityRate * 100),
      totalCheckins: riderCheckins.length,
      _rawDeliveries: totalDeliveries,
      _rawAvgTime: avgDeliveryTime
    };
  });

  // Normalize and calculate weighted score
  const maxDeliveries = Math.max(...ranking.map(r => r._rawDeliveries), 1);
  const times = ranking.filter(r => r._rawAvgTime != null).map(r => r._rawAvgTime);
  const minTime = times.length > 0 ? Math.min(...times) : 1;
  const maxTime = times.length > 0 ? Math.max(...times) : 1;

  for (const r of ranking) {
    const deliveryScore = (r._rawDeliveries / maxDeliveries) * 40;
    const timeScore = r._rawAvgTime != null && maxTime > minTime
      ? ((maxTime - r._rawAvgTime) / (maxTime - minTime)) * 20
      : 0;
    const punctualityScore = r.punctualityRate * 0.15;
    const ifoodScore = r.ifoodCodeRate * 0.15;
    const completionScore = r.completionRate * 0.10;
    r.score = Math.round(deliveryScore + timeScore + punctualityScore + ifoodScore + completionScore);
    delete r._rawDeliveries;
    delete r._rawAvgTime;
  }

  // Sort by score descending
  ranking.sort((a, b) => b.score - a.score);

  // Add position
  ranking.forEach((r, i) => { r.position = i + 1; });

  // If rider, include own rider id for highlighting
  if (isRider) {
    const rider = await prisma.rider.findFirst({ where: { userId } });
    res.json({ ranking, myRiderId: rider?.id || null });
  } else {
    res.json({ ranking });
  }
});

// GET /riders/me/assigned-shifts — turnos atribuídos ao motoboy logado (para dropdown de checkin)
ridersRouter.get('/me/assigned-shifts', async (req, res) => {
  const userId = req.user.id;
  const rider = await prisma.rider.findFirst({ where: { userId } });
  if (!rider) return res.status(403).json({ message: 'Você não é um entregador' });
  const assignments = await prisma.riderShiftAssignment.findMany({
    where: { riderId: rider.id },
    include: { shift: true }
  });
  res.json(assignments.map(a => a.shift).filter(s => s.active));
});

// Mount admin goals CRUD router (must be BEFORE /:id routes to avoid capture)
ridersRouter.use('/goals', requireRole('ADMIN', 'SUPER_ADMIN'), goalsRouter);

// GET /riders/:id/shifts — listar turnos atribuídos ao motoboy
ridersRouter.get('/:id/shifts', async (req, res) => {
  const companyId = req.user.companyId;
  const rider = await prisma.rider.findFirst({ where: { id: req.params.id, companyId } });
  if (!rider) return res.status(404).json({ message: 'Entregador não encontrado' });
  const assignments = await prisma.riderShiftAssignment.findMany({
    where: { riderId: rider.id },
    include: { shift: true }
  });
  res.json(assignments.map(a => a.shift));
});

// PUT /riders/:id/shifts — definir turnos do motoboy (replace all)
ridersRouter.put('/:id/shifts', async (req, res) => {
  const companyId = req.user.companyId;
  const rider = await prisma.rider.findFirst({ where: { id: req.params.id, companyId } });
  if (!rider) return res.status(404).json({ message: 'Entregador não encontrado' });
  const { shiftIds } = req.body; // array of shift IDs
  if (!Array.isArray(shiftIds)) return res.status(400).json({ message: 'shiftIds deve ser um array' });

  // Delete existing and create new
  await prisma.riderShiftAssignment.deleteMany({ where: { riderId: rider.id } });
  if (shiftIds.length > 0) {
    await prisma.riderShiftAssignment.createMany({
      data: shiftIds.map(shiftId => ({ riderId: rider.id, shiftId }))
    });
  }

  const assignments = await prisma.riderShiftAssignment.findMany({
    where: { riderId: rider.id },
    include: { shift: true }
  });
  res.json(assignments.map(a => a.shift));
});

ridersRouter.delete('/:id', requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const companyId = req.user.companyId;
  const rider = await prisma.rider.findFirst({ where: { id: req.params.id, companyId } });
  if (!rider) return res.status(404).json({ message: 'Entregador não encontrado' });
  await prisma.rider.update({ where: { id: rider.id }, data: { active: false } });
  return res.json({ ok: true });
});

ridersRouter.get('/:id', async (req, res) => {
  const { id } = req.params;
  const companyId = req.user.companyId;
  const rider = await prisma.rider.findFirst({ where: { id, companyId } });
  if (!rider) return res.status(404).json({ message: 'Entregador não encontrado' });
  res.json(rider);
});

// GET account balance
ridersRouter.get('/:id/account', async (req, res) => {
  const { id } = req.params;
  const companyId = req.user.companyId;
  const rider = await prisma.rider.findFirst({ where: { id, companyId } });
  if (!rider) return res.status(404).json({ message: 'Entregador não encontrado' });
  const balance = await riderAccountService.getRiderBalance(id);
  res.json({ riderId: id, balance });
});

// GET transactions
ridersRouter.get('/:id/transactions', async (req, res) => {
  const { id } = req.params;
  const companyId = req.user.companyId;
  const rider = await prisma.rider.findFirst({ where: { id, companyId } });
  if (!rider) return res.status(404).json({ message: 'Entregador não encontrado' });

  // query params: page, pageSize, from, to, type, sort, format
  const page = Math.max(1, Number(req.query.page || 1));
  const pageSize = Math.max(1, Math.min(200, Number(req.query.pageSize || 25)));

  // Parse YYYY-MM-DD as BRT (UTC-3) midnight so that filters like "29/04"
  // correctly include transactions up to 02:59 UTC on 30/04 (= 23:59 BRT on 29/04).
  const BRT_OFFSET_MS = 3 * 60 * 60 * 1000;
  function parseDateBRT(s) {
    if (!s) return null;
    const str = String(s).trim();
    const m = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) {
      // midnight BRT = 03:00 UTC
      return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) + BRT_OFFSET_MS);
    }
    const dt = new Date(str);
    return isNaN(dt) ? null : dt;
  }

  const from = req.query.from ? parseDateBRT(req.query.from) : null;
  let to = req.query.to ? parseDateBRT(req.query.to) : null;
  // make 'to' inclusive: end of BRT day = start of BRT day + 24h - 1ms
  if (to && !isNaN(to)) {
    to = new Date(to.getTime() + 24 * 60 * 60 * 1000 - 1);
  }
  const type = req.query.type ? String(req.query.type) : null; // single type or comma-separated
  const sort = String(req.query.sort || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';

  const where = { riderId: id };
  if (from || to) {
    where.date = {};
    if (from && !isNaN(from)) where.date.gte = from;
    if (to && !isNaN(to)) where.date.lte = to;
  }
  if (type) {
    const types = type.split(',').map(t => t.trim()).filter(Boolean);
    if (types.length === 1) where.type = types[0];
    else where.type = { in: types };
  }

  const format = String(req.query.format || '').toLowerCase();

  // If client requests full JSON set (not CSV) use ?full=true to return all matching rows
  if (String(req.query.full || '').toLowerCase() === 'true') {
    const all = await prisma.riderTransaction.findMany({ where, orderBy: { date: sort }, include: { order: { select: { id: true, displaySimple: true, displayId: true } } } });
    const totalAll = all.length;
    return res.json({ items: all, total: totalAll, page: 1, pageSize: totalAll, totalPages: 1 });
  }

  // Debug logging: show incoming query params and the final Prisma `where` used for the DB query
  try {
    console.log('GET /riders/:id/transactions req.query:', req.query);
    console.log('GET /riders/:id/transactions prisma where:', JSON.stringify(where, null, 2));
  } catch (logErr) {
    // ignore logging errors
    console.error('Failed to log transactions debug info', logErr);
  }

  // if CSV requested, export the full filtered set (ignoring paging)
  if (format === 'csv') {
    // include related order (displaySimple/displayId) so frontend can show comanda
    const all = await prisma.riderTransaction.findMany({ where, orderBy: { date: sort }, include: { order: { select: { id: true, displaySimple: true, displayId: true } } } });
    function mapTypeLabel(type) {
      if (!type) return '';
      switch (type) {
        case 'DELIVERY_FEE': return 'Taxa de entrega';
        case 'DAILY_RATE': return 'Diária';
        case 'MANUAL_ADJUSTMENT': return 'Ajuste manual';
        default: return String(type);
      }
    }
    const rows = all.map(t => ({
      id: t.id,
      date: t.date,
      type: mapTypeLabel(t.type),
      amount: t.amount,
      orderId: t.orderId || '',
      orderDisplaySimple: t.order?.displaySimple ?? '',
      orderDisplayId: t.order?.displayId ?? '',
      note: t.note || '',
    }));
    const header = ['id', 'date', 'type', 'amount', 'orderId', 'note'];
    const csv = [header.join(',')].concat(rows.map(r => header.map(h => {
      const v = r[h] === null || r[h] === undefined ? '' : String(r[h]);
      if (v.includes(',') || v.includes('\n') || v.includes('"')) {
        return '"' + v.replace(/"/g, '""') + '"';
      }
      return v;
    }).join(','))).join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="rider-${id}-transactions.csv"`);
    return res.send(csv);
  }

  // count total
  const total = await prisma.riderTransaction.count({ where });
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const skip = (page - 1) * pageSize;

  // include order relation so frontend can display order's visual id in transactions
  const items = await prisma.riderTransaction.findMany({ where, orderBy: { date: sort }, skip, take: pageSize, include: { order: { select: { id: true, displaySimple: true, displayId: true } } } });

  res.json({ items, total, page, pageSize, totalPages });
});

// Adjust rider account (credit/debit) - ADMIN only
ridersRouter.post('/:id/account/adjust', requireRole('ADMIN'), async (req, res) => {
  const { id } = req.params;
  const companyId = req.user.companyId;
  const rider = await prisma.rider.findFirst({ where: { id, companyId } });
  if (!rider) return res.status(404).json({ message: 'Entregador não encontrado' });

  const { amount, type = 'CREDIT', note } = req.body || {};
  const val = Number(amount || 0);
  if (!isFinite(val) || val === 0) return res.status(400).json({ message: 'Amount inválido' });

  const adjAmount = type === 'DEBIT' ? -Math.abs(val) : Math.abs(val);

  const tx = await riderAccountService.addRiderTransaction({ companyId, riderId: id, amount: adjAmount, type: 'MANUAL_ADJUSTMENT', note: note || (type === 'DEBIT' ? 'Débito manual' : 'Crédito manual'), date: new Date() });

  // Bridge: registrar no módulo financeiro
  try { await createFinancialEntryForRider(tx, companyId); } catch (e) { console.warn('Financial bridge rider error:', e?.message); }

  res.json({ ok: true, tx });
});

ridersRouter.post('/', async (req, res) => {
  const companyId = req.user.companyId;
  const { name, whatsapp: rawWhatsapp, dailyRate, active, password } = req.body || {};
  const whatsapp = rawWhatsapp ? String(rawWhatsapp).replace(/\D/g, '') : rawWhatsapp;
  const created = await prisma.rider.create({ data: { companyId, name, whatsapp, dailyRate: dailyRate ? Number(dailyRate) : undefined, active: active !== false } });

  // If a password was provided, create a linked User record with role RIDER
  if (password) {
    try {
      // generate a deterministic unique email for the rider user (not used for contact)
      const fakeEmail = `rider+${created.id}@${companyId}.local`;
      const user = await createUser({ name: String(name || ''), email: fakeEmail, password: String(password), role: 'RIDER', companyId });
      // link rider -> user
      await prisma.rider.update({ where: { id: created.id }, data: { userId: user.id } });
      // include userId in returned payload
      created.userId = user.id;
    } catch (e) {
      console.error('Failed to create linked rider user', e);
      // don't fail the whole request; return rider created but inform about user creation failure
      return res.status(201).json({ rider: created, warning: 'Rider criado, porém falha ao criar usuário vinculado' });
    }
  }

  res.json(created);
});

ridersRouter.patch('/:id', async (req, res) => {
  const { id } = req.params;
  const companyId = req.user.companyId;
  const { name, whatsapp: rawWhatsapp, dailyRate, active } = req.body || {};
  const whatsapp = rawWhatsapp ? String(rawWhatsapp).replace(/\D/g, '') : rawWhatsapp;
  const existing = await prisma.rider.findFirst({ where: { id, companyId } });
  if (!existing) return res.status(404).json({ message: 'Entregador não encontrado' });
  const updated = await prisma.rider.update({ where: { id }, data: { name, whatsapp, dailyRate: dailyRate ? Number(dailyRate) : existing.dailyRate, active: typeof active === 'boolean' ? active : existing.active } });
  // if password present in update body, attempt to update linked user's password (if exists)
  const { password } = req.body || {};
  if (password) {
    try {
      if (existing.userId) {
        const hash = await (await import('bcryptjs')).hash(String(password), 10);
        await prisma.user.update({ where: { id: existing.userId }, data: { password: hash } });
      } else {
        // create a new linked user if none exists
        const fakeEmail = `rider+${existing.id}@${companyId}.local`;
        const user = await createUser({ name: String(updated.name || ''), email: fakeEmail, password: String(password), role: 'RIDER', companyId });
        await prisma.rider.update({ where: { id: existing.id }, data: { userId: user.id } });
      }
    } catch (e) {
      console.error('Failed to set/update rider password', e);
    }
  }

  res.json(updated);
});

// Send PDF report via WhatsApp (admin) - uses first connected instance if not provided
ridersRouter.post('/:id/account/send-report', requireRole('ADMIN'), async (req, res) => {
  const { id } = req.params;
  const companyId = req.user.companyId;
  const rider = await prisma.rider.findFirst({ where: { id, companyId } });
  if (!rider) return res.status(404).json({ message: 'Entregador não encontrado' });

  const body = req.body || {};
  const toPhone = body.phone;
  const providedInstance = body.instanceName;
  const dateFrom = body.from;
  const dateTo = body.to;
  const type = body.type;
  if (!toPhone) return res.status(400).json({ message: 'to (telefone destino) é obrigatório' });

  // Debug: log incoming request for send-report
  try {
    console.log('POST /riders/:id/account/send-report request body:', JSON.stringify(body));
  } catch (__e) {}

  // build where filter
  const where = { riderId: id };
  if (dateFrom || dateTo) {
    // parseDateLocal: interpret YYYY-MM-DD as local date (midnight local)
    function parseDateLocal(s) {
      if (!s) return null;
      const str = String(s).trim();
      const m = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (m) {
        const y = Number(m[1]);
        const mo = Number(m[2]);
        const d = Number(m[3]);
        return new Date(y, mo - 1, d);
      }
      const dt = new Date(str);
      return isNaN(dt) ? null : dt;
    }

    where.date = {};
    const fromDate = dateFrom ? parseDateLocal(dateFrom) : null;
    let toDate = dateTo ? parseDateLocal(dateTo) : null;
    if (toDate && !isNaN(toDate)) toDate.setHours(23, 59, 59, 999);
    if (fromDate && !isNaN(fromDate)) where.date.gte = fromDate;
    if (toDate && !isNaN(toDate)) where.date.lte = toDate;
  }

  // debug computed where
  try {
    console.log('send-report prisma where:', JSON.stringify(where, null, 2));
  } catch (__e) {}
  if (type) {
    const types = String(type).split(',').map(t => t.trim()).filter(Boolean);
    where.type = types.length === 1 ? types[0] : { in: types };
  }

  // fetch transactions (full set for report)
  // include order relation for report generation, so we can print the displaySimple/displayId
  const txs = await prisma.riderTransaction.findMany({ where, orderBy: { date: 'asc' }, include: { order: { select: { id: true, displaySimple: true, displayId: true } } } });

  // Debug: how many transactions matched
  try {
    console.log(`send-report: found ${txs.length} transactions for rider ${id}`);
    if (txs.length > 0) console.log('send-report sample txs:', txs.slice(0, 3));
  } catch (__e) {}

    // create PDF
  try {
    const PDFDocument = (await import('pdfkit')).default;
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    const finishPromise = new Promise((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    // Prepare table layout that fits A4 and supports pagination
  const pageWidth = doc.page.width;
  const pageHeight = doc.page.height;
  const margins = doc.page.margins || { top: 40, bottom: 40, left: 40, right: 40 };
    const leftX = margins.left;
    const rightX = pageWidth - margins.right;
    const usableWidth = rightX - leftX;
    const topY = margins.top;
    const bottomY = pageHeight - margins.bottom;

    const colDateW = 120;
    const colOrderW = 100;
    const colValueW = 80;
    // note column gets the remaining width
    const colNoteW = Math.max(60, usableWidth - (colDateW + colOrderW + colValueW));

    const rowHeight = 18; // approximate row height
    const headerHeight = 20;

    // formatting helpers
    const moneyFmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

    let cursorY = doc.y;
    let pageIndex = 1;

    function renderHeader() {
      doc.fontSize(16).font('Helvetica-Bold').text(`Relatório de transações - entregador: ${rider.name}`, leftX, topY);
      doc.fontSize(10).font('Helvetica').text(`Período: ${dateFrom || '-'} até ${dateTo || '-'}`, leftX, topY + 22);
      doc.fontSize(10).text(`Gerado em: ${new Date().toLocaleString('pt-BR')}`, leftX + usableWidth - 200, topY + 22, { width: 200, align: 'right' });

      // table header
      cursorY = topY + 50;
      doc.moveTo(leftX, cursorY).lineTo(rightX, cursorY).stroke();
      doc.fontSize(11).font('Helvetica-Bold');
  doc.text('Data / Hora', leftX + 4, cursorY + 4, { width: colDateW - 8 });
  doc.text('Pedido', leftX + colDateW + 4, cursorY + 4, { width: colOrderW - 8 });
  doc.text('Observação', leftX + colDateW + colOrderW + 4, cursorY + 4, { width: colNoteW - 8 });
  doc.text('Valor', leftX + colDateW + colOrderW + colNoteW + 4, cursorY + 4, { width: colValueW - 8, align: 'right' });
  cursorY += headerHeight;
      doc.moveTo(leftX, cursorY).lineTo(rightX, cursorY).stroke();
      // vertical separators
  let sepX = leftX + colDateW;
  doc.moveTo(sepX, topY + 50).lineTo(sepX, bottomY).stroke();
  sepX += colOrderW;
  doc.moveTo(sepX, topY + 50).lineTo(sepX, bottomY).stroke();
  sepX += colNoteW;
  doc.moveTo(sepX, topY + 50).lineTo(sepX, bottomY).stroke();

      doc.font('Helvetica');
      // set the document y to our cursor so subsequent text() without y will continue correctly
      doc.y = cursorY;
    }

    function renderFooter() {
      const footerY = pageHeight - margins.bottom + 10;
      doc.fontSize(9).fillColor('gray').text(`Página ${pageIndex}`, leftX, footerY, { align: 'center', width: usableWidth });
      doc.fillColor('black');
    }

    function newPage() {
      // use `margins` option (plural) when adding a page
      doc.addPage({ size: 'A4', margins });
      pageIndex += 1;
      renderHeader();
    }

    // initial header
    renderHeader();

    // draw rows with pagination
    let totalAmount = 0;
    doc.lineWidth(0.5).strokeColor('#444');
    for (const t of txs) {
      const dt = new Date(t.date);
      const dateStr = dt.toLocaleDateString('pt-BR');
      const timeStr = dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      const dateTime = `${dateStr} ${timeStr}`;
  const valueStr = moneyFmt.format(Number(t.amount || 0));
  // use orders.displaySimple (número do pedido) preferentially for the report's "Pedido" column
  const orderStr = (t.order && t.order.displaySimple != null)
    ? String(t.order.displaySimple).padStart(2, '0')
    : (t.order?.displayId ?? t.orderId ?? '-');
  const noteStr = String(t.note || '-');

      // check space
      if (cursorY + rowHeight > bottomY - 30) {
        renderFooter();
        newPage();
        cursorY = doc.y; // reset after header
      }

      // draw horizontal line for row top
      doc.moveTo(leftX, cursorY).lineTo(rightX, cursorY).stroke();

  // write cells in order: Date, Order, Note, Value
  doc.fontSize(10).text(dateTime, leftX + 4, cursorY + 4, { width: colDateW - 8 });
  doc.text(orderStr, leftX + colDateW + 4, cursorY + 4, { width: colOrderW - 8 });
  doc.text(noteStr, leftX + colDateW + colOrderW + 4, cursorY + 4, { width: colNoteW - 8 });
  // color negative amounts in red
  const amtNum = Number(t.amount || 0);
  if (amtNum < 0) doc.fillColor('red');
  else doc.fillColor('black');
  doc.text(valueStr, leftX + colDateW + colOrderW + colNoteW + 4, cursorY + 4, { width: colValueW - 8, align: 'right' });
  // restore color
  doc.fillColor('black');

      cursorY += rowHeight;

      totalAmount += Number(t.amount || 0);
    }

    // total row
    if (cursorY + rowHeight > bottomY - 30) {
      renderFooter();
      newPage();
      cursorY = doc.y;
    }
    doc.moveTo(leftX, cursorY).lineTo(rightX, cursorY).stroke();
  doc.font('Helvetica-Bold').fontSize(11).text('Total', leftX + 4, cursorY + 6, { width: colDateW + colOrderW + colNoteW - 8 });
  doc.text(moneyFmt.format(totalAmount), leftX + colDateW + colOrderW + colNoteW + 4, cursorY + 6, { width: colValueW - 8, align: 'right' });
    cursorY += rowHeight;

    // final footer
    renderFooter();

    doc.end();
    const pdfBuffer = await finishPromise;

    // Debug: size of generated PDF
    try {
      console.log(`send-report: generated PDF size=${pdfBuffer.length} bytes for rider ${id}`);
    } catch (__e) {}

    // choose instance
    let instanceName = providedInstance;
    if (!instanceName) {
      const inst = await prisma.whatsAppInstance.findFirst({ where: { companyId, status: 'CONNECTED' } });
      if (inst) instanceName = inst.instanceName;
    }
    if (!instanceName) return res.status(400).json({ message: 'Nenhuma instância WhatsApp conectada encontrada. Forneça instanceName.' });

    const filename = `rider-${id}-transactions-${Date.now()}.pdf`;
    const caption = `Relatório de transações do entregador ${rider.name}`;

    // ensure public/reports exists and write file so Evolution can fetch it by URL
    try {
      const reportsDir = path.join(process.cwd(), 'public', 'reports');
      await fs.promises.mkdir(reportsDir, { recursive: true });
      const outPath = path.join(reportsDir, filename);
      await fs.promises.writeFile(outPath, pdfBuffer);

      // build public URL based on request host
      const host = req.get('host');
      const proto = req.protocol || 'https';
      const publicUrl = `${proto}://${host}/public/reports/${encodeURIComponent(filename)}`;

      console.log('send-report: publicUrl for pdf=', publicUrl);

      // If caller only wants the generated URL (test mode), return it and skip sending
      if (body.returnUrlOnly) {
        return res.json({ ok: true, url: publicUrl });
      }

      // Allow overriding the public media URL for testing (mocked public URL)
      // e.g., caller can pass { mockMediaUrl: 'http://example.com/test.pdf' }
      const mediaUrlToSend = body.mockMediaUrl ? String(body.mockMediaUrl) : publicUrl;
      if (body.mockMediaUrl) console.log('send-report: using mocked media URL for send:', mediaUrlToSend);

      // send by URL using evoSendMediaUrl (uses mocked URL if provided)
      const sent = await evoSendMediaUrl({ instanceName, to: toPhone, mediaUrl: mediaUrlToSend, filename, mimeType: 'application/pdf', caption });

      // Optionally remove the file after sending (keep for debugging)
      // await fs.promises.unlink(outPath);

      res.json({ ok: true, result: sent, url: publicUrl });
    } catch (fileErr) {
      console.error('send-report file/save/send error', fileErr);
      return res.status(500).json({ ok: false, message: 'Falha ao salvar/enviar relatório', error: String(fileErr) });
    }
  } catch (e) {
    // Log complete error with stack and response body (if any)
    try {
      console.error('send-report error full:', e);
      if (e?.response?.data) console.error('send-report evo response data:', e.response.data);
      if (e?.stack) console.error('send-report stack:', e.stack);
    } catch (__logErr) {}
    res.status(500).json({ ok: false, message: 'Falha ao gerar/enviar relatório', error: e.response?.data || e.message || String(e) });
  }
});

// PATCH transaction (edit amount/note) - ADMIN only
ridersRouter.patch('/:id/transactions/:txId', requireRole('ADMIN'), async (req, res) => {
  const { id, txId } = req.params;
  const companyId = req.user.companyId;
  const rider = await prisma.rider.findFirst({ where: { id, companyId } });
  if (!rider) return res.status(404).json({ message: 'Entregador não encontrado' });

  const existing = await prisma.riderTransaction.findFirst({ where: { id: txId, riderId: id } });
  if (!existing) return res.status(404).json({ message: 'Transação não encontrada' });

  const { amount, note } = req.body || {};
  const newAmount = typeof amount !== 'undefined' ? Number(amount) : undefined;

  // update tx
  const updated = await prisma.riderTransaction.update({ where: { id: txId }, data: { note: typeof note === 'string' ? note : existing.note, amount: typeof newAmount === 'number' && !isNaN(newAmount) ? newAmount : existing.amount } });

  // adjust account balance by delta
  if (typeof newAmount === 'number' && !isNaN(newAmount)) {
    const delta = Number(newAmount) - Number(existing.amount || 0);
    if (delta !== 0) {
      const acct = await prisma.riderAccount.findUnique({ where: { riderId: id } });
      if (acct) {
        await prisma.riderAccount.update({ where: { riderId: id }, data: { balance: { increment: delta } } });
      } else {
        await prisma.riderAccount.create({ data: { riderId: id, balance: delta } });
      }
    }
  }

  res.json({ ok: true, tx: updated });
});

// Get orders assigned to the authenticated rider (convenience endpoint)
ridersRouter.get('/me/orders', async (req, res) => {
  try {
    const userId = req.user && req.user.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const user = await prisma.user.findUnique({ where: { id: userId }, include: { rider: true } });
    if (!user || !user.rider) return res.status(404).json({ message: 'Rider profile not found for this user' });
    const riderId = user.rider.id;
    const orders = await prisma.order.findMany({ where: { riderId, companyId: req.user.companyId }, orderBy: { createdAt: 'desc' }, take: 200 });
    return res.json({ items: orders });
  } catch (e) {
    console.error('GET /riders/me/orders error', e);
    return res.status(500).json({ message: 'Erro ao buscar pedidos do entregador' });
  }
});

// ==================== RIDER GOALS ====================

// GET /riders/me/goals — rider's active goals with progress
ridersRouter.get('/me/goals', requireRole('RIDER'), async (req, res) => {
  try {
    const userId = req.user.id;
    const rider = await prisma.rider.findFirst({ where: { userId } });
    if (!rider) return res.status(403).json({ message: 'Você não é um entregador' });

    const goals = await getGoalsForRider(rider.id, rider.companyId);
    res.json(goals);
  } catch (e) {
    console.error('GET /riders/me/goals error:', e);
    res.status(500).json({ message: 'Erro ao buscar metas' });
  }
});

// GET /riders/me/achievements — rider's achievement history
ridersRouter.get('/me/achievements', requireRole('RIDER'), async (req, res) => {
  try {
    const userId = req.user.id;
    const rider = await prisma.rider.findFirst({ where: { userId } });
    if (!rider) return res.status(403).json({ message: 'Você não é um entregador' });

    const achievements = await prisma.riderGoalAchievement.findMany({
      where: { riderId: rider.id },
      include: {
        goal: {
          select: { id: true, name: true, ruleType: true, rewardType: true, rewardDescription: true },
        },
      },
      orderBy: { achievedAt: 'desc' },
      take: 50,
    });

    res.json(achievements);
  } catch (e) {
    console.error('GET /riders/me/achievements error:', e);
    res.status(500).json({ message: 'Erro ao buscar conquistas' });
  }
});


// Admin: reset or set rider password (creates linked user if missing)
ridersRouter.post('/:id/reset-password', requireRole('ADMIN'), async (req, res) => {
  const { id } = req.params;
  const companyId = req.user.companyId;
  const rider = await prisma.rider.findFirst({ where: { id, companyId } });
  if (!rider) return res.status(404).json({ message: 'Entregador não encontrado' });

  let { password } = req.body || {};

  // generate a random password if none provided
  if (!password) {
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    let pw = '';
    for (let i = 0; i < 10; i++) pw += chars.charAt(Math.floor(Math.random() * chars.length));
    password = pw;
  }

  try {
    if (rider.userId) {
      const bcrypt = await import('bcryptjs');
      const hash = await bcrypt.hash(String(password), 10);
      await prisma.user.update({ where: { id: rider.userId }, data: { password: hash } });
    } else {
      // create linked user
      const fakeEmail = `rider+${rider.id}@${companyId}.local`;
      const user = await createUser({ name: String(rider.name || ''), email: fakeEmail, password: String(password), role: 'RIDER', companyId });
      await prisma.rider.update({ where: { id: rider.id }, data: { userId: user.id } });
    }
    // attempt sending password by WhatsApp if rider has a phone and there is a connected instance
    let waSendResult = null;
    try {
      // destination phone: prefer rider.whatsapp, fall back to explicit phone in body
      const toPhone = (rider.whatsapp && String(rider.whatsapp).trim()) || (req.body && req.body.phone);
      // allow caller to override instanceName
      let instanceName = req.body && req.body.instanceName;
      if (!instanceName) {
        const inst = await prisma.whatsAppInstance.findFirst({ where: { companyId, status: 'CONNECTED' } });
        if (inst) instanceName = inst.instanceName;
      }

      if (toPhone && instanceName) {
        const text = `Olá ${rider.name || ''}, sua nova senha de acesso ao painel é: ${password}\nRecomendamos alterar a senha no primeiro login.`;
        // evoSendText will normalize the phone, but we still validate here
        const normalized = normalizePhone(toPhone);
        if (normalized) {
          waSendResult = await evoSendText({ instanceName, to: toPhone, text }).catch(e => ({ error: String(e) }));
        } else {
          waSendResult = { error: 'Telefone inválido para envio via WhatsApp' };
        }
      }
    } catch (e) {
      console.error('Failed to send reset password via WhatsApp', e);
      waSendResult = { error: String(e) };
    }

  // For security, do NOT return the plaintext password in the API response.
  // The password is sent to the rider's WhatsApp when possible. Return only the
  // WhatsApp send result to avoid leaking credentials to callers.
  res.json({ ok: true, wa: waSendResult });
  } catch (e) {
    console.error('Failed to reset rider password', e);
    res.status(500).json({ ok: false, message: 'Falha ao resetar senha' });
  }
});

// Pay period (create a payment transaction that deducts the period total) - ADMIN only
ridersRouter.post('/:id/account/pay', requireRole('ADMIN'), async (req, res) => {
  const { id } = req.params;
  const companyId = req.user.companyId;
  const rider = await prisma.rider.findFirst({ where: { id, companyId } });
  if (!rider) return res.status(404).json({ message: 'Entregador não encontrado' });

  const { from, to, accountId } = req.body || {};

  // parse YYYY-MM-DD as BRT (UTC-3) so payment period covers full local day
  const BRT_OFF = 3 * 60 * 60 * 1000;
  function parseDateBRT(s) {
    if (!s) return null;
    const str = String(s).trim();
    const m = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) + BRT_OFF);
    const dt = new Date(str);
    return isNaN(dt) ? null : dt;
  }

  const where = { riderId: id };
  const fromDate = parseDateBRT(from);
  let toDate = parseDateBRT(to);
  if (fromDate || toDate) {
    where.date = {};
    if (fromDate && !isNaN(fromDate)) where.date.gte = fromDate;
    if (toDate && !isNaN(toDate)) where.date.lte = new Date(toDate.getTime() + 24 * 60 * 60 * 1000 - 1);
  }

  // fetch matching transactions and sum amounts
  const items = await prisma.riderTransaction.findMany({ where });
  const sum = items.reduce((acc, t) => acc + Number(t.amount || 0), 0);

  if (!sum || Number(sum) === 0) return res.json({ ok: true, message: 'Nenhuma transação para pagar neste período', total: 0 });

  // Create a payment transaction with negative amount to deduct balance
  const note = `Pagamento do período ${from || '-'} → ${to || '-'}`;
  const paymentTx = await riderAccountService.addRiderTransaction({ companyId, riderId: id, amount: -Math.abs(sum), type: 'MANUAL_ADJUSTMENT', date: new Date(), note });

  // Bridge: registrar no módulo financeiro
  try { await createFinancialEntryForRider(paymentTx, companyId, accountId || null); } catch (e) { console.warn('Financial bridge rider payment error:', e?.message); }

  return res.json({ ok: true, message: 'Pagamento registrado', total: sum, tx: paymentTx });
});

// POST /riders/:id/dedup-daily-rates
// Removes duplicate DAILY_RATE transactions for the same BRT calendar day,
// keeping the earliest one per day and deleting extras. Adjusts rider balance.
ridersRouter.post('/:id/dedup-daily-rates', requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const { id } = req.params;
  const companyId = req.user.companyId;
  const { dryRun = false, startDate, endDate } = req.body || {};

  const rider = await prisma.rider.findFirst({ where: { id, companyId } });
  if (!rider) return res.status(404).json({ message: 'Entregador não encontrado' });

  const BRT_OFFSET_MS = 3 * 60 * 60 * 1000;

  const where = { riderId: id, type: 'DAILY_RATE' };
  if (startDate || endDate) {
    where.date = {};
    if (startDate) where.date.gte = new Date(startDate);
    if (endDate) { const e = new Date(endDate); e.setDate(e.getDate() + 1); where.date.lte = e; }
  }

  const all = await prisma.riderTransaction.findMany({ where, orderBy: { date: 'asc' } });

  // Group by BRT calendar day key (YYYY-MM-DD in BRT)
  const byDay = new Map();
  for (const t of all) {
    const brtDate = new Date(new Date(t.date).getTime() - BRT_OFFSET_MS);
    const key = brtDate.toISOString().slice(0, 10);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(t);
  }

  const duplicates = [];
  for (const [day, txs] of byDay) {
    if (txs.length > 1) {
      // keep earliest, flag the rest
      const extras = txs.slice(1);
      for (const t of extras) duplicates.push({ day, id: t.id, amount: Number(t.amount) });
    }
  }

  if (!dryRun && duplicates.length > 0) {
    for (const dup of duplicates) {
      await prisma.$transaction([
        prisma.riderTransaction.delete({ where: { id: dup.id } }),
        prisma.riderAccount.upsert({
          where: { riderId: id },
          update: { balance: { decrement: dup.amount } },
          create: { riderId: id, balance: -dup.amount },
        }),
      ]);
    }
  }

  return res.json({ dryRun: !!dryRun, duplicatesFound: duplicates.length, removed: dryRun ? 0 : duplicates.length, duplicates });
});

