import express from 'express';
import { prisma } from '../prisma.js';
import { authMiddleware, requireRole } from '../auth.js';
import { requireModuleStrict } from '../modules.js';
import { findNeighborhoodMatch } from '../utils/neighborhoodMatch.js';

// Helper exportado pra routes/orders.js e routes/publicMenu.js aplicarem a
// mesma regra de frete grátis. Menu sobrescreve a empresa quando seu campo
// freeDeliveryEnabled NÃO é null (true ou false). Quando o menu deixa null,
// herda da empresa.
export async function resolveFreeDelivery({ companyId, menuId }) {
  if (menuId && companyId) {
    // Filtra por companyId (via Menu.store.companyId) pra evitar override
    // cross-company quando um requestedMenuId malicioso é fornecido.
    const menu = await prisma.menu.findFirst({
      where: { id: menuId, store: { companyId } },
      select: { freeDeliveryEnabled: true, freeDeliveryMinOrder: true },
    });
    if (menu && menu.freeDeliveryEnabled !== null && menu.freeDeliveryEnabled !== undefined) {
      return {
        enabled: !!menu.freeDeliveryEnabled,
        minOrder: menu.freeDeliveryMinOrder != null ? Number(menu.freeDeliveryMinOrder) : null,
        source: 'menu',
      };
    }
  }
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { freeDeliveryEnabled: true, freeDeliveryMinOrder: true },
  });
  return {
    enabled: company?.freeDeliveryEnabled ?? false,
    minOrder: company?.freeDeliveryMinOrder != null ? Number(company.freeDeliveryMinOrder) : null,
    source: 'company',
  };
}

export const neighborhoodsRouter = express.Router();
neighborhoodsRouter.use(authMiddleware);
neighborhoodsRouter.use(requireModuleStrict('CARDAPIO_COMPLETO'));

// list neighborhoods for company
neighborhoodsRouter.get('/', async (req, res) => {
  const companyId = req.user.companyId;
  const rows = await prisma.neighborhood.findMany({ where: { companyId }, orderBy: { name: 'asc' } });
  res.json(rows);
});

// POST /neighborhoods/match
// Accepts { text } in body and returns the matched neighborhood (name) or null
neighborhoodsRouter.post('/match', async (req, res) => {
  const companyId = req.user.companyId;
  const { text } = req.body || {};
  if (!text) return res.status(400).json({ message: 'text é obrigatório' });

  try {
    const neighs = await prisma.neighborhood.findMany({ where: { companyId } });
    const matched = findNeighborhoodMatch(neighs, text);
    res.json({ match: matched ? matched.name : null });
  } catch (e) {
    console.error('POST /neighborhoods/match', e);
    res.status(500).json({ message: 'Erro ao procurar bairro' });
  }
});

// GET /neighborhoods/settings — free delivery configuration
neighborhoodsRouter.get('/settings', async (req, res) => {
  const companyId = req.user.companyId;
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { freeDeliveryEnabled: true, freeDeliveryMinOrder: true } });
  res.json({
    freeDeliveryEnabled: company?.freeDeliveryEnabled ?? false,
    freeDeliveryMinOrder: company?.freeDeliveryMinOrder != null ? Number(company.freeDeliveryMinOrder) : null,
  });
});

// PATCH /neighborhoods/settings — update free delivery configuration
neighborhoodsRouter.patch('/settings', requireRole('ADMIN'), async (req, res) => {
  const companyId = req.user.companyId;
  const { freeDeliveryEnabled, freeDeliveryMinOrder } = req.body || {};
  const updated = await prisma.company.update({
    where: { id: companyId },
    data: {
      freeDeliveryEnabled: Boolean(freeDeliveryEnabled),
      freeDeliveryMinOrder: freeDeliveryMinOrder != null ? Number(freeDeliveryMinOrder) : null,
    },
  });
  res.json({
    freeDeliveryEnabled: updated.freeDeliveryEnabled,
    freeDeliveryMinOrder: updated.freeDeliveryMinOrder != null ? Number(updated.freeDeliveryMinOrder) : null,
  });
});

// GET /neighborhoods/settings/menus — lista o frete grátis por cardápio
// Retorna 1 linha por cardápio da empresa com freeDeliveryEnabled = true |
// false | null (null = herda da empresa).
neighborhoodsRouter.get('/settings/menus', async (req, res) => {
  const companyId = req.user.companyId;
  const menus = await prisma.menu.findMany({
    where: { store: { companyId } },
    select: {
      id: true,
      name: true,
      freeDeliveryEnabled: true,
      freeDeliveryMinOrder: true,
      store: { select: { id: true, name: true } },
    },
    orderBy: [{ store: { name: 'asc' } }, { position: 'asc' }, { name: 'asc' }],
  });
  res.json(
    menus.map((m) => ({
      menuId: m.id,
      menuName: m.name,
      storeName: m.store?.name || null,
      freeDeliveryEnabled: m.freeDeliveryEnabled, // pode ser true/false/null (null = herda)
      freeDeliveryMinOrder: m.freeDeliveryMinOrder != null ? Number(m.freeDeliveryMinOrder) : null,
    })),
  );
});

// PATCH /neighborhoods/settings/menus/:menuId — sobrescreve a regra de
// frete grátis pra UM cardápio. Body aceita:
//   { freeDeliveryEnabled: true | false | null, freeDeliveryMinOrder: number | null }
// null em enabled significa "voltar a herdar da empresa".
neighborhoodsRouter.patch('/settings/menus/:menuId', requireRole('ADMIN'), async (req, res) => {
  const companyId = req.user.companyId;
  const { menuId } = req.params;
  const menu = await prisma.menu.findFirst({
    where: { id: menuId, store: { companyId } },
    select: { id: true },
  });
  if (!menu) return res.status(404).json({ message: 'Cardápio não encontrado' });

  const { freeDeliveryEnabled, freeDeliveryMinOrder } = req.body || {};
  // Aceita explicitamente true, false ou null. Outros valores rejeitados.
  const enabledValue =
    freeDeliveryEnabled === true ? true :
    freeDeliveryEnabled === false ? false :
    freeDeliveryEnabled === null ? null : undefined;
  if (enabledValue === undefined) {
    return res.status(400).json({ message: 'freeDeliveryEnabled deve ser true, false ou null' });
  }
  const minOrderValue =
    enabledValue === true && freeDeliveryMinOrder != null
      ? Number(freeDeliveryMinOrder)
      : null;
  if (minOrderValue != null && (isNaN(minOrderValue) || minOrderValue < 0)) {
    return res.status(400).json({ message: 'freeDeliveryMinOrder inválido' });
  }

  const updated = await prisma.menu.update({
    where: { id: menuId },
    data: {
      freeDeliveryEnabled: enabledValue,
      freeDeliveryMinOrder: minOrderValue,
    },
    select: { id: true, freeDeliveryEnabled: true, freeDeliveryMinOrder: true },
  });
  res.json({
    menuId: updated.id,
    freeDeliveryEnabled: updated.freeDeliveryEnabled,
    freeDeliveryMinOrder: updated.freeDeliveryMinOrder != null ? Number(updated.freeDeliveryMinOrder) : null,
  });
});

// create (ADMIN)
neighborhoodsRouter.post('/', requireRole('ADMIN'), async (req, res) => {
  const companyId = req.user.companyId;
  const { name, aliases = [], deliveryFee = 0, riderFee = 0 } = req.body || {};
  if (!name) return res.status(400).json({ message: 'Nome é obrigatório' });

  const created = await prisma.neighborhood.create({ data: { companyId, name, aliases, deliveryFee: Number(deliveryFee || 0), riderFee: Number(riderFee || 0) } });
  res.status(201).json(created);
});

// patch
neighborhoodsRouter.patch('/:id', requireRole('ADMIN'), async (req, res) => {
  const { id } = req.params;
  const companyId = req.user.companyId;
  const existing = await prisma.neighborhood.findFirst({ where: { id, companyId } });
  if (!existing) return res.status(404).json({ message: 'Bairro não encontrado' });

  const { name, aliases, deliveryFee, riderFee } = req.body || {};
  const updated = await prisma.neighborhood.update({ where: { id }, data: { name: name ?? existing.name, aliases: aliases ?? existing.aliases, deliveryFee: deliveryFee !== undefined ? Number(deliveryFee) : existing.deliveryFee, riderFee: riderFee !== undefined ? Number(riderFee) : existing.riderFee } });
  res.json(updated);
});

// delete
neighborhoodsRouter.delete('/:id', requireRole('ADMIN'), async (req, res) => {
  const { id } = req.params;
  const companyId = req.user.companyId;
  const existing = await prisma.neighborhood.findFirst({ where: { id, companyId } });
  if (!existing) return res.status(404).json({ message: 'Bairro não encontrado' });

  await prisma.neighborhood.delete({ where: { id } });
  res.json({ success: true });
});

// ── Pending neighborhood aliases (queue alimentada por resolveNeighborhood) ──

// GET /neighborhoods/aliases?status=PENDING|CLASSIFIED|IGNORED|ALL
//   Lista as entradas, default = PENDING. Ordena por occurrences desc — o que
//   mais aparece sobe pro topo da fila. Inclui o canonical neighborhood quando
//   estiver classified, e a contagem de orders ainda com a forma raw cadastrada
//   pra dar contexto ("isso aqui pega N pedidos retroativos").
neighborhoodsRouter.get('/aliases', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const status = String(req.query.status || 'PENDING').toUpperCase();
    const where = { companyId };
    if (status !== 'ALL') where.status = status;
    const rows = await prisma.neighborhoodAlias.findMany({
      where,
      orderBy: [{ occurrences: 'desc' }, { lastSeenAt: 'desc' }],
      include: { neighborhood: { select: { id: true, name: true } } },
    });
    return res.json({ rows });
  } catch (e) {
    console.error('GET /neighborhoods/aliases error', e);
    res.status(500).json({ message: 'Erro ao listar bairros pendentes', error: e?.message });
  }
});

// POST /neighborhoods/aliases/:id/classify  { neighborhoodId }
//   Marca um alias como classificado e o aponta pro Neighborhood escolhido.
//   A próxima vez que o mesmo texto chegar via resolveNeighborhood, o match
//   resolve em O(1) pela primeira camada do resolver.
neighborhoodsRouter.post('/aliases/:id/classify', requireRole('ADMIN'), async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.user.companyId;
    const { neighborhoodId } = req.body || {};
    if (!neighborhoodId) return res.status(400).json({ message: 'neighborhoodId é obrigatório' });
    const alias = await prisma.neighborhoodAlias.findFirst({ where: { id, companyId } });
    if (!alias) return res.status(404).json({ message: 'Alias não encontrado' });
    const target = await prisma.neighborhood.findFirst({ where: { id: neighborhoodId, companyId } });
    if (!target) return res.status(400).json({ message: 'Bairro alvo inválido' });

    const updated = await prisma.neighborhoodAlias.update({
      where: { id },
      data: {
        neighborhoodId,
        status: 'CLASSIFIED',
        resolvedAt: new Date(),
        resolvedBy: req.user?.id || null,
      },
      include: { neighborhood: { select: { id: true, name: true } } },
    });
    res.json(updated);
  } catch (e) {
    console.error('POST /aliases/:id/classify error', e);
    res.status(500).json({ message: 'Erro ao classificar alias', error: e?.message });
  }
});

// POST /neighborhoods/aliases/:id/ignore
//   Marca como IGNORED — typo / garbage que o operador decidiu não mapear.
//   Resolver retorna null silenciosamente em ocorrências futuras (sem bumpar
//   o queue de novo).
neighborhoodsRouter.post('/aliases/:id/ignore', requireRole('ADMIN'), async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.user.companyId;
    const alias = await prisma.neighborhoodAlias.findFirst({ where: { id, companyId } });
    if (!alias) return res.status(404).json({ message: 'Alias não encontrado' });
    const updated = await prisma.neighborhoodAlias.update({
      where: { id },
      data: { status: 'IGNORED', resolvedAt: new Date(), resolvedBy: req.user?.id || null, neighborhoodId: null },
    });
    res.json(updated);
  } catch (e) {
    console.error('POST /aliases/:id/ignore error', e);
    res.status(500).json({ message: 'Erro ao ignorar alias', error: e?.message });
  }
});

// DELETE /neighborhoods/aliases/:id  — remove definitivamente
//   Útil quando o operador classificou errado e quer reabrir como PENDING.
neighborhoodsRouter.delete('/aliases/:id', requireRole('ADMIN'), async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.user.companyId;
    const alias = await prisma.neighborhoodAlias.findFirst({ where: { id, companyId } });
    if (!alias) return res.status(404).json({ message: 'Alias não encontrado' });
    await prisma.neighborhoodAlias.delete({ where: { id } });
    res.json({ success: true });
  } catch (e) {
    console.error('DELETE /aliases/:id error', e);
    res.status(500).json({ message: 'Erro ao remover alias', error: e?.message });
  }
});

export default neighborhoodsRouter;
