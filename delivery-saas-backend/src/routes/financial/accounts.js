import express from 'express';
import { prisma } from '../../prisma.js';

const router = express.Router();

// GET /financial/accounts - listar contas financeiras da empresa
router.get('/', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { type, isActive } = req.query;
    const where = { companyId };
    if (type) where.type = type;
    if (isActive !== undefined) where.isActive = isActive === 'true';

    const accounts = await prisma.financialAccount.findMany({
      where,
      orderBy: { name: 'asc' },
    });
    res.json(accounts);
  } catch (e) {
    console.error('GET /financial/accounts error:', e);
    res.status(500).json({ message: 'Erro ao listar contas', error: e?.message });
  }
});

// GET /financial/accounts/:id
router.get('/:id', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const account = await prisma.financialAccount.findFirst({
      where: { id: req.params.id, companyId },
    });
    if (!account) return res.status(404).json({ message: 'Conta não encontrada' });
    res.json(account);
  } catch (e) {
    console.error('GET /financial/accounts/:id error:', e);
    res.status(500).json({ message: 'Erro ao buscar conta', error: e?.message });
  }
});

// POST /financial/accounts
router.post('/', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { name, type, bankCode, agency, accountNumber, isDefault } = req.body;
    if (!name) return res.status(400).json({ message: 'Nome é obrigatório' });

    // Se marcou como padrão, desmarcar as outras
    if (isDefault) {
      await prisma.financialAccount.updateMany({
        where: { companyId, isDefault: true },
        data: { isDefault: false },
      });
    }

    const account = await prisma.financialAccount.create({
      data: {
        companyId,
        name,
        type: type || 'CHECKING',
        bankCode: bankCode || null,
        agency: agency || null,
        accountNumber: accountNumber || null,
        isDefault: isDefault || false,
      },
    });
    res.status(201).json(account);
  } catch (e) {
    if (e?.code === 'P2002') return res.status(409).json({ message: 'Já existe uma conta com este nome' });
    console.error('POST /financial/accounts error:', e);
    res.status(500).json({ message: 'Erro ao criar conta', error: e?.message });
  }
});

// PUT /financial/accounts/:id
router.put('/:id', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const existing = await prisma.financialAccount.findFirst({
      where: { id: req.params.id, companyId },
    });
    if (!existing) return res.status(404).json({ message: 'Conta não encontrada' });

    const { name, type, bankCode, agency, accountNumber, isActive, isDefault } = req.body;

    if (isDefault) {
      await prisma.financialAccount.updateMany({
        where: { companyId, isDefault: true, id: { not: req.params.id } },
        data: { isDefault: false },
      });
    }

    const updated = await prisma.financialAccount.update({
      where: { id: req.params.id },
      data: {
        ...(name !== undefined && { name }),
        ...(type !== undefined && { type }),
        ...(bankCode !== undefined && { bankCode }),
        ...(agency !== undefined && { agency }),
        ...(accountNumber !== undefined && { accountNumber }),
        ...(isActive !== undefined && { isActive }),
        ...(isDefault !== undefined && { isDefault }),
      },
    });
    res.json(updated);
  } catch (e) {
    console.error('PUT /financial/accounts/:id error:', e);
    res.status(500).json({ message: 'Erro ao atualizar conta', error: e?.message });
  }
});

// DELETE /financial/accounts/:id
router.delete('/:id', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const existing = await prisma.financialAccount.findFirst({
      where: { id: req.params.id, companyId },
    });
    if (!existing) return res.status(404).json({ message: 'Conta não encontrada' });

    // Soft delete: desativar em vez de deletar para preservar histórico
    await prisma.financialAccount.update({
      where: { id: req.params.id },
      data: { isActive: false },
    });
    res.json({ ok: true });
  } catch (e) {
    console.error('DELETE /financial/accounts/:id error:', e);
    res.status(500).json({ message: 'Erro ao remover conta', error: e?.message });
  }
});

export default router;
