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

// POST /financial/cost-centers
router.post('/', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { code, name, parentId, dreGroup } = req.body;
    if (!code || !name) return res.status(400).json({ message: 'code e name são obrigatórios' });

    const center = await prisma.costCenter.create({
      data: {
        companyId,
        code,
        name,
        parentId: parentId || null,
        dreGroup: dreGroup || null,
      },
    });
    res.status(201).json(center);
  } catch (e) {
    if (e?.code === 'P2002') return res.status(409).json({ message: 'Código já existe para esta empresa' });
    console.error('POST /financial/cost-centers error:', e);
    res.status(500).json({ message: 'Erro ao criar centro de custo', error: e?.message });
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

    const { code, name, parentId, dreGroup, isActive } = req.body;
    const updated = await prisma.costCenter.update({
      where: { id: req.params.id },
      data: {
        ...(code !== undefined && { code }),
        ...(name !== undefined && { name }),
        ...(parentId !== undefined && { parentId }),
        ...(dreGroup !== undefined && { dreGroup }),
        ...(isActive !== undefined && { isActive }),
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
      { code: '1', name: 'Receitas', dreGroup: 'REVENUE' },
      { code: '1.01', name: 'Receita de Vendas (Balcão)', dreGroup: 'REVENUE', parent: '1' },
      { code: '1.02', name: 'Receita de Vendas (Delivery)', dreGroup: 'REVENUE', parent: '1' },
      { code: '1.03', name: 'Receita de Vendas (Marketplace)', dreGroup: 'REVENUE', parent: '1' },
      { code: '2', name: 'Deduções de Receita', dreGroup: 'DEDUCTIONS' },
      { code: '2.01', name: 'Taxas de Marketplace', dreGroup: 'DEDUCTIONS', parent: '2' },
      { code: '2.02', name: 'Taxas de Adquirentes', dreGroup: 'DEDUCTIONS', parent: '2' },
      { code: '2.03', name: 'Descontos e Cupons', dreGroup: 'DEDUCTIONS', parent: '2' },
      { code: '2.04', name: 'Impostos sobre Vendas', dreGroup: 'DEDUCTIONS', parent: '2' },
      { code: '3', name: 'CMV (Custo de Mercadoria Vendida)', dreGroup: 'COGS' },
      { code: '3.01', name: 'Insumos e Matéria-Prima', dreGroup: 'COGS', parent: '3' },
      { code: '3.02', name: 'Embalagens', dreGroup: 'COGS', parent: '3' },
      { code: '4', name: 'Despesas Operacionais', dreGroup: 'OPEX' },
      { code: '4.01', name: 'Folha de Pagamento', dreGroup: 'OPEX', parent: '4' },
      { code: '4.02', name: 'Aluguel', dreGroup: 'OPEX', parent: '4' },
      { code: '4.03', name: 'Utilities (Água, Luz, Gás)', dreGroup: 'OPEX', parent: '4' },
      { code: '4.04', name: 'Marketing e Publicidade', dreGroup: 'OPEX', parent: '4' },
      { code: '4.05', name: 'Motoboys / Entregadores', dreGroup: 'OPEX', parent: '4' },
      { code: '4.06', name: 'Comissões de Afiliados', dreGroup: 'OPEX', parent: '4' },
      { code: '4.07', name: 'Manutenção e Reparos', dreGroup: 'OPEX', parent: '4' },
      { code: '4.08', name: 'Software e Tecnologia', dreGroup: 'OPEX', parent: '4' },
      { code: '4.09', name: 'Outras Despesas Operacionais', dreGroup: 'OPEX', parent: '4' },
      { code: '5', name: 'Resultado Financeiro', dreGroup: 'FINANCIAL' },
      { code: '5.01', name: 'Receitas Financeiras (Juros, Rendimentos)', dreGroup: 'FINANCIAL', parent: '5' },
      { code: '5.02', name: 'Despesas Financeiras (Juros, Tarifas)', dreGroup: 'FINANCIAL', parent: '5' },
    ];

    // Criar raízes primeiro, depois filhos
    const idMap = {};
    for (const item of defaults) {
      if (!item.parent) {
        const created = await prisma.costCenter.create({
          data: { companyId, code: item.code, name: item.name, dreGroup: item.dreGroup },
        });
        idMap[item.code] = created.id;
      }
    }
    for (const item of defaults) {
      if (item.parent) {
        const parentId = idMap[item.parent];
        const created = await prisma.costCenter.create({
          data: { companyId, code: item.code, name: item.name, dreGroup: item.dreGroup, parentId },
        });
        idMap[item.code] = created.id;
      }
    }

    const all = await prisma.costCenter.findMany({ where: { companyId }, orderBy: { code: 'asc' } });
    res.status(201).json(all);
  } catch (e) {
    console.error('POST /financial/cost-centers/seed-default error:', e);
    res.status(500).json({ message: 'Erro ao criar estrutura padrão', error: e?.message });
  }
});

export default router;
