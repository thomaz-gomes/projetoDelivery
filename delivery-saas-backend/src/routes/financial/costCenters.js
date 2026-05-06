import express from 'express';
import { prisma } from '../../prisma.js';

const router = express.Router();

// GET /financial/cost-centers - listar centros de custo (árvore)
router.get('/', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { flat } = req.query;

    const centers = await prisma.costCenter.findMany({
      where: { companyId },
      orderBy: { code: 'asc' },
      include: { children: flat !== 'true' },
    });

    // Se flat=true, retorna lista plana; senão, retorna apenas raízes com children
    if (flat === 'true') return res.json(centers);

    const roots = centers.filter(c => !c.parentId);
    res.json(roots);
  } catch (e) {
    console.error('GET /financial/cost-centers error:', e);
    res.status(500).json({ message: 'Erro ao listar centros de custo', error: e?.message });
  }
});

// Auto-generates the next sibling code under a parent by reading existing
// children. For parent code "2.01" with children "2.01.1" and "2.01.2",
// returns "2.01.3". Returns null when there are no children yet
// (caller falls back to "<parentCode>.1").
async function nextChildCode(companyId, parentCode) {
  if (!parentCode) return null;
  const children = await prisma.costCenter.findMany({
    where: { companyId, code: { startsWith: `${parentCode}.` } },
    select: { code: true },
  });
  // Only direct children: code must equal parentCode + ".N" (no further dots)
  const directChildren = children.filter((c) => {
    const tail = c.code.slice(parentCode.length + 1);
    return tail.length > 0 && !tail.includes('.');
  });
  if (directChildren.length === 0) return `${parentCode}.1`;
  let max = 0;
  for (const c of directChildren) {
    const n = parseInt(c.code.slice(parentCode.length + 1), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${parentCode}.${max + 1}`;
}

// POST /financial/cost-centers
// `code` may be omitted when `parentId` is provided — backend computes the
// next available child code (e.g. parent "2.01" with children .1 and .2
// → suggested code "2.01.3"). The dreGroup also inherits from the parent
// when not supplied.
router.post('/', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    let { code, name, parentId, dreGroup, natureza } = req.body;
    if (!name) return res.status(400).json({ message: 'name é obrigatório' });

    let parent = null;
    if (parentId) {
      parent = await prisma.costCenter.findFirst({
        where: { id: parentId, companyId },
        select: { id: true, code: true, dreGroup: true, natureza: true },
      });
      if (!parent) return res.status(400).json({ message: 'Centro de custo pai não encontrado' });
    }

    if (!code) {
      if (!parent) return res.status(400).json({ message: 'code é obrigatório quando não há centro pai' });
      code = await nextChildCode(companyId, parent.code);
    }

    const center = await prisma.costCenter.create({
      data: {
        companyId,
        code,
        name,
        parentId: parentId || null,
        dreGroup: dreGroup || parent?.dreGroup || null,
        natureza: natureza || parent?.natureza || null,
      },
    });
    res.status(201).json(center);
  } catch (e) {
    if (e?.code === 'P2002') return res.status(409).json({ message: 'Código já existe para esta empresa' });
    console.error('POST /financial/cost-centers error:', e);
    res.status(500).json({ message: 'Erro ao criar centro de custo', error: e?.message });
  }
});

// GET /financial/cost-centers/next-code?parentId=xxx
// Returns { code: "2.01.3" } — the next child code under the given parent.
router.get('/next-code', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { parentId } = req.query;
    if (!parentId) return res.status(400).json({ message: 'parentId é obrigatório' });
    const parent = await prisma.costCenter.findFirst({
      where: { id: String(parentId), companyId },
      select: { code: true },
    });
    if (!parent) return res.status(404).json({ message: 'Centro pai não encontrado' });
    const code = await nextChildCode(companyId, parent.code);
    res.json({ code });
  } catch (e) {
    res.status(500).json({ message: 'Erro ao calcular próximo código', error: e?.message });
  }
});

// PUT /financial/cost-centers/:id
router.put('/:id', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const existing = await prisma.costCenter.findFirst({
      where: { id: req.params.id, companyId },
    });
    if (!existing) return res.status(404).json({ message: 'Centro de custo não encontrado' });

    const { code, name, parentId, dreGroup, isActive, natureza } = req.body;
    const updated = await prisma.costCenter.update({
      where: { id: req.params.id },
      data: {
        ...(code !== undefined && { code }),
        ...(name !== undefined && { name }),
        ...(parentId !== undefined && { parentId }),
        ...(dreGroup !== undefined && { dreGroup }),
        ...(isActive !== undefined && { isActive }),
        ...(natureza !== undefined && { natureza: natureza || null }),
      },
    });
    res.json(updated);
  } catch (e) {
    console.error('PUT /financial/cost-centers/:id error:', e);
    res.status(500).json({ message: 'Erro ao atualizar centro de custo', error: e?.message });
  }
});

// DELETE /financial/cost-centers/:id
router.delete('/:id', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const existing = await prisma.costCenter.findFirst({
      where: { id: req.params.id, companyId },
    });
    if (!existing) return res.status(404).json({ message: 'Centro de custo não encontrado' });

    await prisma.costCenter.update({
      where: { id: req.params.id },
      data: { isActive: false },
    });
    res.json({ ok: true });
  } catch (e) {
    console.error('DELETE /financial/cost-centers/:id error:', e);
    res.status(500).json({ message: 'Erro ao remover centro de custo', error: e?.message });
  }
});

// POST /financial/cost-centers/seed-default - seed com estrutura DRE padrão
router.post('/seed-default', async (req, res) => {
  try {
    const companyId = req.user.companyId;

    // Verificar se já existem centros de custo
    const count = await prisma.costCenter.count({ where: { companyId } });
    if (count > 0) return res.status(400).json({ message: 'Já existem centros de custo cadastrados' });

    const defaults = [
      { code: '1',    name: 'Receitas',                        dreGroup: 'REVENUE',     natureza: null },
      { code: '1.01', name: 'Receita de Vendas (Balcão)',       dreGroup: 'REVENUE',     natureza: null, parent: '1' },
      { code: '1.02', name: 'Receita de Vendas (Delivery)',     dreGroup: 'REVENUE',     natureza: null, parent: '1' },
      { code: '1.03', name: 'Receita de Vendas (Marketplace)',  dreGroup: 'REVENUE',     natureza: null, parent: '1' },
      { code: '2',    name: 'Deduções de Receita',              dreGroup: 'DEDUCTIONS',  natureza: 'VARIAVEL' },
      { code: '2.01', name: 'Taxas Marketplace',                dreGroup: 'DEDUCTIONS',  natureza: 'VARIAVEL', parent: '2' },
      { code: '2.01.1', name: 'Comissão Marketplace',           dreGroup: 'DEDUCTIONS',  natureza: 'VARIAVEL', parent: '2.01' },
      { code: '2.01.2', name: 'Taxa de Antecipação',            dreGroup: 'DEDUCTIONS',  natureza: 'VARIAVEL', parent: '2.01' },
      { code: '2.02', name: 'Taxas Adquirentes',                dreGroup: 'DEDUCTIONS',  natureza: 'VARIAVEL', parent: '2' },
      { code: '2.03', name: 'Descontos e Cupons',               dreGroup: 'DEDUCTIONS',  natureza: 'VARIAVEL', parent: '2' },
      { code: '2.04', name: 'Impostos sobre Vendas',            dreGroup: 'DEDUCTIONS',  natureza: 'VARIAVEL', parent: '2' },
      { code: '2.05', name: 'Cancelamentos e Estornos',         dreGroup: 'DEDUCTIONS',  natureza: 'VARIAVEL', parent: '2' },
      { code: '3',    name: 'CMV - Custo das Mercadorias',      dreGroup: 'COGS',        natureza: 'VARIAVEL' },
      { code: '3.01', name: 'Insumos e Matéria-Prima',          dreGroup: 'COGS',        natureza: 'VARIAVEL', parent: '3' },
      { code: '3.02', name: 'Embalagens',                       dreGroup: 'COGS',        natureza: 'VARIAVEL', parent: '3' },
      { code: '4',    name: 'Despesas Operacionais',            dreGroup: 'OPEX',        natureza: null },
      { code: '4.01', name: 'Folha de Pagamento',               dreGroup: 'OPEX',        natureza: 'FIXA',     parent: '4' },
      { code: '4.02', name: 'Aluguel',                          dreGroup: 'OPEX',        natureza: 'FIXA',     parent: '4' },
      { code: '4.03', name: 'Energia, Água e Gás',              dreGroup: 'OPEX',        natureza: 'FIXA',     parent: '4' },
      { code: '4.04', name: 'Marketing e Publicidade',          dreGroup: 'OPEX',        natureza: 'FIXA',     parent: '4' },
      { code: '4.05', name: 'Motoboys e Entregadores',          dreGroup: 'OPEX',        natureza: 'VARIAVEL', parent: '4' },
      { code: '4.06', name: 'Comissões de Afiliados',           dreGroup: 'OPEX',        natureza: 'VARIAVEL', parent: '4' },
      { code: '4.07', name: 'Manutenção e Reparos',             dreGroup: 'OPEX',        natureza: 'FIXA',     parent: '4' },
      { code: '4.08', name: 'Software e Licenças',              dreGroup: 'OPEX',        natureza: 'FIXA',     parent: '4' },
      { code: '4.09', name: 'Outras Despesas Operacionais',     dreGroup: 'OPEX',        natureza: null,       parent: '4' },
      { code: '5',    name: 'Resultado Financeiro',             dreGroup: 'FINANCIAL',   natureza: null },
      { code: '5.01', name: 'Receitas Financeiras',             dreGroup: 'FINANCIAL',   natureza: null, parent: '5' },
      { code: '5.02', name: 'Despesas Financeiras',             dreGroup: 'FINANCIAL',   natureza: null, parent: '5' },
    ];

    // Single pass: array is sorted so parents always come before their children.
    // Supports arbitrary depth (e.g. 2 → 2.01 → 2.01.1).
    const idMap = {};
    for (const item of defaults) {
      const parentId = item.parent ? (idMap[item.parent] || null) : null;
      const created = await prisma.costCenter.create({
        data: { companyId, code: item.code, name: item.name, dreGroup: item.dreGroup, natureza: item.natureza || null, parentId },
      });
      idMap[item.code] = created.id;
    }

    const all = await prisma.costCenter.findMany({ where: { companyId }, orderBy: { code: 'asc' } });
    res.status(201).json(all);
  } catch (e) {
    console.error('POST /financial/cost-centers/seed-default error:', e);
    res.status(500).json({ message: 'Erro ao criar estrutura padrão', error: e?.message });
  }
});

export default router;
