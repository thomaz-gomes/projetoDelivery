# Rider Check-in, Bonus e Ranking — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implementar check-in com geolocalizacao para motoboys, regras de bonificacao configuraveis e ranking gamificado.

**Architecture:** Novos models Prisma (RiderShift, RiderCheckin, RiderBonusRule) + novo enum EARLY_CHECKIN_BONUS + campo closedByIfoodCode no Order. Rotas adicionadas ao riders.js existente. Frontend: 4 telas admin + 2 telas motoboy. Bonus calculado dentro do fluxo existente addDeliveryAndDailyIfNeeded.

**Tech Stack:** Prisma + PostgreSQL, Express.js, Vue 3 + Bootstrap 5, Haversine para distancia, Nominatim para reverse geocode.

---

## Task 1: Schema Prisma — Novos models e campos

**Files:**
- Modify: `delivery-saas-backend/prisma/schema.prisma`

**Step 1: Adicionar enum RiderBonusRuleType e novo valor ao RiderTransactionType**

No `schema.prisma`, apos o enum `RiderTransactionType`, adicionar:

```prisma
enum RiderTransactionType {
  DELIVERY_FEE
  DAILY_RATE
  MANUAL_ADJUSTMENT
  EARLY_CHECKIN_BONUS
}

enum RiderBonusRuleType {
  EARLY_CHECKIN
}
```

**Step 2: Adicionar model RiderShift**

Apos o model `RiderPosition`:

```prisma
model RiderShift {
  id        String   @id @default(uuid())
  companyId String
  company   Company  @relation(fields: [companyId], references: [id])
  name      String
  startTime String   // "HH:mm"
  endTime   String   // "HH:mm"
  active    Boolean  @default(true)
  createdAt DateTime @default(now())

  checkins   RiderCheckin[]
  bonusRules RiderBonusRule[]

  @@index([companyId])
}
```

**Step 3: Adicionar model RiderCheckin**

```prisma
model RiderCheckin {
  id             String     @id @default(uuid())
  riderId        String
  rider          Rider      @relation(fields: [riderId], references: [id])
  companyId      String
  company        Company    @relation(fields: [companyId], references: [id])
  shiftId        String
  shift          RiderShift @relation(fields: [shiftId], references: [id])
  lat            Float
  lng            Float
  address        String?
  checkinAt      DateTime
  distanceMeters Float
  createdAt      DateTime   @default(now())

  @@index([riderId, checkinAt])
  @@index([companyId, checkinAt])
}
```

**Step 4: Adicionar model RiderBonusRule**

```prisma
model RiderBonusRule {
  id           String              @id @default(uuid())
  companyId    String
  company      Company             @relation(fields: [companyId], references: [id])
  name         String
  type         RiderBonusRuleType
  deadlineTime String              // "HH:mm"
  bonusAmount  Decimal
  shiftId      String?
  shift        RiderShift?         @relation(fields: [shiftId], references: [id])
  active       Boolean             @default(true)
  createdAt    DateTime            @default(now())

  @@index([companyId, active])
}
```

**Step 5: Adicionar campo closedByIfoodCode no Order**

No model `Order`, adicionar:

```prisma
  closedByIfoodCode Boolean @default(false)
```

**Step 6: Adicionar relations no model Rider**

Acrescentar no model `Rider`:

```prisma
  checkins RiderCheckin[]
```

**Step 7: Adicionar relations no model Company**

Acrescentar no model `Company`:

```prisma
  riderShifts    RiderShift[]
  riderCheckins  RiderCheckin[]
  riderBonusRules RiderBonusRule[]
```

**Step 8: Rodar prisma db push**

```bash
cd delivery-saas-backend
npx prisma db push
npx prisma generate
```

Expected: schema atualizado sem erros.

**Step 9: Commit**

```bash
git add delivery-saas-backend/prisma/schema.prisma
git commit -m "feat(riders): add RiderShift, RiderCheckin, RiderBonusRule models + closedByIfoodCode"
```

---

## Task 2: Backend — Rotas de Turnos (CRUD)

**Files:**
- Modify: `delivery-saas-backend/src/routes/riders.js`

**Step 1: Adicionar CRUD de turnos**

Adicionar apos as rotas existentes de riders, antes do `export`:

```javascript
// ==================== SHIFTS ====================

// GET /riders/shifts — listar turnos da empresa
ridersRouter.get('/shifts', async (req, res) => {
  const companyId = req.user.companyId;
  const shifts = await prisma.riderShift.findMany({
    where: { companyId },
    orderBy: { startTime: 'asc' }
  });
  res.json(shifts);
});

// POST /riders/shifts — criar turno
ridersRouter.post('/shifts', async (req, res) => {
  const companyId = req.user.companyId;
  const { name, startTime, endTime } = req.body;
  if (!name || !startTime || !endTime) return res.status(400).json({ message: 'name, startTime e endTime sao obrigatorios' });
  const shift = await prisma.riderShift.create({
    data: { companyId, name, startTime, endTime }
  });
  res.status(201).json(shift);
});

// PATCH /riders/shifts/:id — editar turno
ridersRouter.patch('/shifts/:id', async (req, res) => {
  const companyId = req.user.companyId;
  const shift = await prisma.riderShift.findFirst({ where: { id: req.params.id, companyId } });
  if (!shift) return res.status(404).json({ message: 'Turno nao encontrado' });
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
  if (!shift) return res.status(404).json({ message: 'Turno nao encontrado' });
  await prisma.riderShift.update({ where: { id: req.params.id }, data: { active: false } });
  res.json({ ok: true });
});
```

**Step 2: Commit**

```bash
git add delivery-saas-backend/src/routes/riders.js
git commit -m "feat(riders): add shift CRUD routes"
```

---

## Task 3: Backend — Rota de Check-in

**Files:**
- Modify: `delivery-saas-backend/src/routes/riders.js`

**Step 1: Adicionar funcao Haversine e rota de check-in**

No topo do arquivo (apos imports):

```javascript
// Haversine distance in meters
function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
```

Apos as rotas de shifts:

```javascript
// ==================== CHECK-IN ====================

// POST /riders/me/checkin — motoboy faz check-in
ridersRouter.post('/me/checkin', async (req, res) => {
  const userId = req.user.id;
  const rider = await prisma.rider.findFirst({ where: { userId } });
  if (!rider) return res.status(403).json({ message: 'Voce nao e um entregador' });

  const { lat, lng, shiftId } = req.body;
  if (lat == null || lng == null || !shiftId) return res.status(400).json({ message: 'lat, lng e shiftId sao obrigatorios' });

  const companyId = rider.companyId;

  // Validar turno
  const shift = await prisma.riderShift.findFirst({ where: { id: shiftId, companyId, active: true } });
  if (!shift) return res.status(400).json({ message: 'Turno nao encontrado ou inativo' });

  // Evitar check-in duplicado no mesmo turno/dia
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const existing = await prisma.riderCheckin.findFirst({
    where: { riderId: rider.id, shiftId, checkinAt: { gte: today, lt: tomorrow } }
  });
  if (existing) return res.status(409).json({ message: 'Voce ja fez check-in neste turno hoje', checkin: existing });

  // Buscar localizacao da loja principal
  const store = await prisma.store.findFirst({ where: { companyId }, orderBy: { createdAt: 'asc' } });
  if (!store || store.latitude == null || store.longitude == null) {
    return res.status(400).json({ message: 'Loja nao possui coordenadas configuradas' });
  }

  // Calcular distancia
  const distanceMeters = haversineMeters(lat, lng, store.latitude, store.longitude);
  const maxRadius = 200; // metros
  if (distanceMeters > maxRadius) {
    return res.status(400).json({
      message: `Voce esta a ${Math.round(distanceMeters)}m da loja. Maximo permitido: ${maxRadius}m.`,
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

  res.status(201).json(checkin);
});

// GET /riders/me/checkins — historico de check-ins do motoboy
ridersRouter.get('/me/checkins', async (req, res) => {
  const userId = req.user.id;
  const rider = await prisma.rider.findFirst({ where: { userId } });
  if (!rider) return res.status(403).json({ message: 'Voce nao e um entregador' });

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

// GET /riders/checkins — relatorio admin de check-ins
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
```

**Step 2: Commit**

```bash
git add delivery-saas-backend/src/routes/riders.js
git commit -m "feat(riders): add checkin routes with geolocation validation"
```

---

## Task 4: Backend — Rotas de Regras de Bonus

**Files:**
- Modify: `delivery-saas-backend/src/routes/riders.js`

**Step 1: Adicionar CRUD de regras de bonus**

```javascript
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
    return res.status(400).json({ message: 'name, type, deadlineTime e bonusAmount sao obrigatorios' });
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
  if (!rule) return res.status(404).json({ message: 'Regra nao encontrada' });
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
  if (!rule) return res.status(404).json({ message: 'Regra nao encontrada' });
  await prisma.riderBonusRule.update({ where: { id: req.params.id }, data: { active: false } });
  res.json({ ok: true });
});
```

**Step 2: Commit**

```bash
git add delivery-saas-backend/src/routes/riders.js
git commit -m "feat(riders): add bonus rules CRUD routes"
```

---

## Task 5: Backend — Logica de bonus no addDeliveryAndDailyIfNeeded

**Files:**
- Modify: `delivery-saas-backend/src/services/riderAccount.js`

**Step 1: Adicionar logica de bonus apos daily rate**

No final da funcao `addDeliveryAndDailyIfNeeded`, antes do fechamento `}`, adicionar:

```javascript
  // Check early check-in bonus rules
  try {
    const dayStart = toDateOnly(orderDate);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    // Find today's check-ins for this rider
    const todayCheckins = await prisma.riderCheckin.findMany({
      where: { riderId, checkinAt: { gte: dayStart, lt: dayEnd } }
    });
    if (todayCheckins.length === 0) return;

    // Find active EARLY_CHECKIN bonus rules for this company
    const bonusRules = await prisma.riderBonusRule.findMany({
      where: { companyId, type: 'EARLY_CHECKIN', active: true }
    });

    for (const rule of bonusRules) {
      // Check if any checkin satisfies this rule (before deadline, matching shift if specified)
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
          note: `Bonus: ${rule.name}`
        });
      }
    }
  } catch (e) {
    console.warn('[riderAccount] bonus check failed:', e?.message || e);
  }
```

**Step 2: Commit**

```bash
git add delivery-saas-backend/src/services/riderAccount.js
git commit -m "feat(riders): add early checkin bonus logic to delivery flow"
```

---

## Task 6: Backend — Campo closedByIfoodCode e evento iFood

**Files:**
- Modify: `delivery-saas-backend/src/services/ifoodWebhookProcessor.js`
- Modify: `delivery-saas-backend/src/routes/orders.js`

**Step 1: Marcar closedByIfoodCode no webhook processor**

No `ifoodWebhookProcessor.js`, dentro da funcao `upsertOrder`, quando o status mapeado for CONCLUIDO ou CONFIRMACAO_PAGAMENTO (vindo de CONCLUDED do iFood), verificar se o payload contem `deliveryCode` ou campo equivalente. Se o pedido for concluido pelo codigo, marcar `closedByIfoodCode: true`.

Localizar onde o order e atualizado/criado com status CONCLUIDO e adicionar:

```javascript
// Dentro do update do order, quando status vem de CONCLUDED do iFood:
// Detectar se conclusao foi com codigo
const eventCode = (payload?.fullCode || payload?.code || '').toUpperCase();
const hasDeliveryCode = !!(payload?.deliveryCode || payload?.order?.deliveryCode || payload?.metadata?.deliveryCode);
if (eventCode === 'CONCLUDED' || eventCode === 'CON') {
  updateData.closedByIfoodCode = hasDeliveryCode;
}
```

**Nota:** O payload exato do iFood para conclusao com/sem codigo precisa ser verificado nos logs. O campo pode ser `deliveryCode`, `confirmationCode` ou similar. Verificar logs do webhook para confirmar a estrutura. Se nao houver campo especifico, a alternativa e: quando o motoboy clica "Entregue" no app (rota `/riders/me/orders/:id/complete`), marca como `closedByIfoodCode = false`. Quando o iFood conclui via evento CONCLUDED, marca `closedByIfoodCode = true`.

**Abordagem alternativa (mais confiavel):** Diferenciar pela ORIGEM da conclusao:
- Concluido pelo motoboy (rota `/riders/me/orders/:id/complete`) = sem codigo = `closedByIfoodCode = false`
- Concluido pelo evento iFood CONCLUDED = com codigo = `closedByIfoodCode = true`

No `orders.js`, na rota PATCH `/:id/status` onde status -> CONCLUIDO, se a origem for iFood webhook, setar `closedByIfoodCode = true`.

**Step 2: Commit**

```bash
git add delivery-saas-backend/src/services/ifoodWebhookProcessor.js delivery-saas-backend/src/routes/orders.js
git commit -m "feat(orders): track closedByIfoodCode on order completion"
```

---

## Task 7: Backend — Rota de Ranking

**Files:**
- Modify: `delivery-saas-backend/src/routes/riders.js`

**Step 1: Adicionar rota de ranking**

```javascript
// ==================== RANKING ====================

// GET /riders/ranking
ridersRouter.get('/ranking', async (req, res) => {
  const companyId = req.user.companyId;
  const userId = req.user.id;
  const isRider = req.user.role === 'RIDER';

  const { from, to } = req.query;
  const dateFrom = from ? new Date(from) : (() => { const d = new Date(); d.setDate(1); d.setHours(0,0,0,0); return d; })();
  const dateTo = to ? new Date(to) : new Date();

  // Todos os riders ativos da empresa
  const riders = await prisma.rider.findMany({
    where: { companyId, active: true },
    select: { id: true, name: true, userId: true }
  });

  // Pedidos concluidos no periodo
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
        where: { to: { in: ['SAIU_PARA_ENTREGA', 'CONCLUIDO'] } },
        select: { to: true, changedAt: true },
        orderBy: { changedAt: 'asc' }
      }
    }
  });

  // Pedidos cancelados no periodo (para taxa conclusao)
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

  // Check-ins no periodo
  const checkins = await prisma.riderCheckin.findMany({
    where: { companyId, checkinAt: { gte: dateFrom, lte: dateTo } },
    select: { riderId: true, shiftId: true, checkinAt: true }
  });

  // Regras de bonus ativas (para calcular pontualidade)
  const bonusRules = await prisma.riderBonusRule.findMany({
    where: { companyId, type: 'EARLY_CHECKIN', active: true }
  });

  // Calcular metricas por rider
  const ranking = riders.map(rider => {
    const riderOrders = orders.filter(o => o.riderId === rider.id);
    const totalDeliveries = riderOrders.length;
    const canceled = canceledMap[rider.id] || 0;
    const completionRate = totalDeliveries + canceled > 0 ? totalDeliveries / (totalDeliveries + canceled) : 0;

    // Tempo medio de entrega (minutos)
    let totalTime = 0, timeCount = 0;
    for (const o of riderOrders) {
      const saiu = o.histories.find(h => h.to === 'SAIU_PARA_ENTREGA');
      const concluido = o.histories.find(h => h.to === 'CONCLUIDO');
      if (saiu && concluido) {
        const mins = (new Date(concluido.changedAt) - new Date(saiu.changedAt)) / 60000;
        if (mins > 0 && mins < 300) { totalTime += mins; timeCount++; }
      }
    }
    const avgDeliveryTime = timeCount > 0 ? Math.round((totalTime / timeCount) * 10) / 10 : null;

    // Taxa de codigo iFood
    const withCode = riderOrders.filter(o => o.closedByIfoodCode).length;
    const ifoodCodeRate = totalDeliveries > 0 ? withCode / totalDeliveries : 0;

    // Pontualidade (% check-ins antes do deadline de alguma regra)
    const riderCheckins = checkins.filter(c => c.riderId === rider.id);
    let onTimeCount = 0;
    for (const c of riderCheckins) {
      const checkinDate = new Date(c.checkinAt);
      const checkinMinutes = checkinDate.getHours() * 60 + checkinDate.getMinutes();
      const isOnTime = bonusRules.some(rule => {
        if (rule.shiftId && c.shiftId !== rule.shiftId) return false;
        const [h, m] = rule.deadlineTime.split(':').map(Number);
        return checkinMinutes <= h * 60 + m;
      });
      if (isOnTime) onTimeCount++;
    }
    const punctualityRate = riderCheckins.length > 0 ? onTimeCount / riderCheckins.length : 0;

    // Score ponderado (0-100)
    // Normalizar entregas: max do periodo
    return {
      riderId: rider.id,
      riderName: rider.name,
      totalDeliveries,
      avgDeliveryTime,
      completionRate: Math.round(completionRate * 100),
      ifoodCodeRate: Math.round(ifoodCodeRate * 100),
      punctualityRate: Math.round(punctualityRate * 100),
      totalCheckins: riderCheckins.length,
      _rawDeliveries: totalDeliveries, // para normalizar score
      _rawAvgTime: avgDeliveryTime
    };
  });

  // Normalizar e calcular score
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

  // Ordenar por score desc
  ranking.sort((a, b) => b.score - a.score);

  // Adicionar posicao
  ranking.forEach((r, i) => { r.position = i + 1; });

  // Se motoboy, retornar todos mas destacar o proprio
  if (isRider) {
    const rider = await prisma.rider.findFirst({ where: { userId } });
    const myRiderId = rider?.id;
    res.json({ ranking, myRiderId });
  } else {
    res.json({ ranking });
  }
});
```

**Step 2: Commit**

```bash
git add delivery-saas-backend/src/routes/riders.js
git commit -m "feat(riders): add ranking route with weighted score"
```

---

## Task 8: Frontend — Tela de Turnos (Admin)

**Files:**
- Create: `delivery-saas-frontend/src/views/RiderShifts.vue`
- Modify: `delivery-saas-frontend/src/router.js`

**Step 1: Criar componente RiderShifts.vue**

Tela admin com tabela de turnos + modal criar/editar. Seguir padrao Bootstrap 5 do projeto (card, table, modal). Campos: name, startTime (input type="time"), endTime (input type="time"). Toggle ativar/desativar. Usar `api` de `src/api.js` para chamadas.

**Step 2: Adicionar rota no router.js**

No bloco de rotas admin de riders (apos rider-adjustments):

```javascript
,{ path: '/settings/rider-shifts', component: () => import('./views/RiderShifts.vue'), meta: { requiresAuth: true, requiresModule: 'RIDERS' } }
```

**Step 3: Commit**

```bash
git add delivery-saas-frontend/src/views/RiderShifts.vue delivery-saas-frontend/src/router.js
git commit -m "feat(frontend): add rider shifts admin page"
```

---

## Task 9: Frontend — Tela de Regras de Bonus (Admin)

**Files:**
- Create: `delivery-saas-frontend/src/views/RiderBonusRules.vue`
- Modify: `delivery-saas-frontend/src/router.js`

**Step 1: Criar componente RiderBonusRules.vue**

Tela admin com tabela de regras + modal criar/editar. Campos: name, type (select, por enquanto so EARLY_CHECKIN), deadlineTime (input type="time"), bonusAmount (input number com R$), shiftId (select dos turnos ou "Qualquer turno"). Toggle ativar/desativar.

**Step 2: Adicionar rota no router.js**

```javascript
,{ path: '/settings/rider-bonus-rules', component: () => import('./views/RiderBonusRules.vue'), meta: { requiresAuth: true, requiresModule: 'RIDERS' } }
```

**Step 3: Commit**

```bash
git add delivery-saas-frontend/src/views/RiderBonusRules.vue delivery-saas-frontend/src/router.js
git commit -m "feat(frontend): add rider bonus rules admin page"
```

---

## Task 10: Frontend — Relatorio de Check-ins (Admin)

**Files:**
- Create: `delivery-saas-frontend/src/views/RiderCheckins.vue`
- Modify: `delivery-saas-frontend/src/router.js`

**Step 1: Criar componente RiderCheckins.vue**

Tela admin com filtros (date range, select rider) e tabela: motoboy, turno, horario check-in, endereco, distancia. Indicador visual: badge verde "No horario" se antes do deadline de alguma regra ativa, badge vermelho "Atrasado" se depois.

**Step 2: Adicionar rota no router.js**

```javascript
,{ path: '/reports/rider-checkins', component: () => import('./views/RiderCheckins.vue'), meta: { requiresAuth: true, requiresModule: 'RIDERS' } }
```

**Step 3: Commit**

```bash
git add delivery-saas-frontend/src/views/RiderCheckins.vue delivery-saas-frontend/src/router.js
git commit -m "feat(frontend): add rider checkins report page"
```

---

## Task 11: Frontend — Tela de Check-in (Motoboy)

**Files:**
- Create: `delivery-saas-frontend/src/views/rider/Checkin.vue`
- Modify: `delivery-saas-frontend/src/router.js`

**Step 1: Criar componente rider/Checkin.vue**

Tela do motoboy com:
- **Relogio em tempo real** grande (atualiza a cada segundo com `setInterval`, formato HH:mm:ss, destaque visual)
- Select de turno (GET `/riders/shifts` filtrando ativos)
- Botao "Fazer Check-in"
- Ao clicar: solicita `navigator.geolocation.getCurrentPosition()`, envia POST `/riders/me/checkin`
- Feedback: sucesso mostra endereco capturado, erro mostra distancia e limite
- Historico de check-ins do dia embaixo

**Step 2: Adicionar rota no router.js**

```javascript
,{ path: '/rider/checkin', component: () => import('./views/rider/Checkin.vue'), meta: { requiresAuth: true, role: 'RIDER', noSidebar: true } }
```

**Step 3: Commit**

```bash
git add delivery-saas-frontend/src/views/rider/Checkin.vue delivery-saas-frontend/src/router.js
git commit -m "feat(frontend): add rider checkin page with real-time clock"
```

---

## Task 12: Frontend — Tela de Ranking (Admin + Motoboy)

**Files:**
- Create: `delivery-saas-frontend/src/views/RiderRanking.vue`
- Create: `delivery-saas-frontend/src/views/rider/Ranking.vue`
- Modify: `delivery-saas-frontend/src/router.js`

**Step 1: Criar componente RiderRanking.vue (admin)**

Tela admin com: periodo selecionavel, tabela com posicao (medalhas ouro/prata/bronze para top 3), nome, total entregas, tempo medio, % pontualidade, % codigo iFood, % conclusao, score.

**Step 2: Criar componente rider/Ranking.vue (motoboy)**

Mesma estrutura visual mas com destaque na posicao do motoboy logado (`myRiderId`). Visual de gamificacao: medalhas, posicao em destaque com cor diferente, barras de progresso para cada metrica.

**Step 3: Adicionar rotas no router.js**

```javascript
,{ path: '/reports/rider-ranking', component: () => import('./views/RiderRanking.vue'), meta: { requiresAuth: true, requiresModule: 'RIDERS' } }
,{ path: '/rider/ranking', component: () => import('./views/rider/Ranking.vue'), meta: { requiresAuth: true, role: 'RIDER', noSidebar: true } }
```

**Step 4: Commit**

```bash
git add delivery-saas-frontend/src/views/RiderRanking.vue delivery-saas-frontend/src/views/rider/Ranking.vue delivery-saas-frontend/src/router.js
git commit -m "feat(frontend): add rider ranking pages (admin + rider gamification)"
```

---

## Task 13: Frontend — Navegacao (sidebar e rider nav)

**Files:**
- Modify: sidebar/menu component do admin (adicionar links para Turnos, Regras de Bonus, Check-ins, Ranking)
- Modify: rider navigation (adicionar links para Check-in e Ranking)

**Step 1: Identificar e atualizar componente de sidebar**

Adicionar no grupo de Entregadores:
- Turnos (`/settings/rider-shifts`)
- Regras de Bonus (`/settings/rider-bonus-rules`)
- Check-ins (`/reports/rider-checkins`)
- Ranking (`/reports/rider-ranking`)

**Step 2: Atualizar navegacao do motoboy**

No componente de nav do rider (Dashboard ou layout), adicionar:
- Check-in (`/rider/checkin`)
- Ranking (`/rider/ranking`)

**Step 3: Commit**

```bash
git add -A
git commit -m "feat(frontend): add navigation links for checkin, bonus, ranking"
```

---

## Task 14: Teste end-to-end manual

**Step 1: Subir ambiente dev**

```bash
docker compose up -d
```

**Step 2: Testar fluxo completo**

1. Admin: criar turno "Almoco" 11:00-14:00
2. Admin: criar regra bonus "Pontualidade Almoco", deadline 11:00, R$2.00
3. Motoboy: fazer login, ir em Check-in, verificar relogio tempo real
4. Motoboy: fazer check-in (deve validar localizacao)
5. Admin: verificar relatorio de check-ins
6. Concluir um pedido com rider atribuido -> verificar se bonus foi creditado
7. Verificar ranking com metricas

**Step 3: Commit final**

```bash
git commit -m "feat(riders): complete checkin, bonus and ranking feature"
```
