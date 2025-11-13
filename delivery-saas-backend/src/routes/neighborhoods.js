import express from 'express';
import { prisma } from '../prisma.js';
import { authMiddleware, requireRole } from '../auth.js';

export const neighborhoodsRouter = express.Router();
neighborhoodsRouter.use(authMiddleware);

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
    const txt = String(text).toLowerCase();
    const neighs = await prisma.neighborhood.findMany({ where: { companyId } });
    const matched = neighs.find(n => {
      if (!n || !n.name) return false;
      const name = String(n.name).toLowerCase();
      if (txt.includes(name)) return true;
      if (n.aliases) {
        try {
          const arr = Array.isArray(n.aliases) ? n.aliases : JSON.parse(n.aliases);
          if (arr.some(a => txt.includes(String(a || '').toLowerCase()))) return true;
        } catch (e) {
          // ignore
        }
      }
      return false;
    });
    res.json({ match: matched ? matched.name : null });
  } catch (e) {
    console.error('POST /neighborhoods/match', e);
    res.status(500).json({ message: 'Erro ao procurar bairro' });
  }
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

export default neighborhoodsRouter;
