import express from 'express';
import { prisma } from '../../prisma.js';
import { authMiddleware, requireRole } from '../../auth.js';
import { getAffiliateIfOwned } from './helpers.js';
import { assertModuleEnabled } from '../../utils/saas.js';
import { createFinancialEntryForAffiliate } from '../../services/financial/orderFinancialBridge.js';

export const affiliatesRouter = express.Router();

affiliatesRouter.use(authMiddleware);

// Enforce SaaS module availability: AFFILIATES must be enabled for this company
affiliatesRouter.use(async (req, res, next) => {
  try {
    await assertModuleEnabled(req.user.companyId, 'AFFILIATES')
    return next()
  } catch (e) {
    const status = e && e.statusCode ? e.statusCode : 403
    return res.status(status).json({ message: 'Módulo de afiliados não está disponível no seu plano.' })
  }
});

// GET /affiliates - Lista todos os afiliados da empresa
affiliatesRouter.get('/', async (req, res) => {
  const companyId = req.user.companyId;
  if (!companyId) return res.status(400).json({ message: 'Usuário sem empresa' });

  try {
    const affiliates = await prisma.affiliate.findMany({
      where: { companyId },
      include: {
        _count: {
          select: {
            sales: true,
            payments: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json(affiliates);
  } catch (e) {
    console.error('Error fetching affiliates:', e);
    res.status(500).json({ message: 'Erro ao buscar afiliados' });
  }
});

// GET /affiliates/:id - Obter afiliado por id
affiliatesRouter.get('/:id', async (req, res) => {
  const { id } = req.params
  const companyId = req.user.companyId

  try {
    const aff = await prisma.affiliate.findFirst({ where: { id, companyId } })
    if (!aff) return res.status(404).json({ message: 'Afiliado não encontrado' })
    res.json(aff)
  } catch (e) {
    console.error('Error fetching affiliate:', e)
    res.status(500).json({ message: 'Erro ao buscar afiliado' })
  }
})

// Note: sales/payments/statement routes are defined below with the proper models.

// POST /affiliates - Criar novo afiliado
affiliatesRouter.post('/', requireRole('ADMIN'), async (req, res) => {
  const companyId = req.user.companyId;
  const { name, email, whatsapp, commissionRate, couponCode, password } = req.body;

  if (!name) {
    return res.status(400).json({ message: 'Nome é obrigatório' });
  }

  if (commissionRate && (commissionRate < 0 || commissionRate > 1)) {
    return res.status(400).json({ message: 'Taxa de comissão deve estar entre 0 e 1' });
  }

  try {
    // Create affiliate and its default coupon in a single transaction to ensure consistency.
    const result = await prisma.$transaction(async (tx) => {
      // hash password if provided
      let passHash = null;
      if (password) {
        const bcrypt = await import('bcryptjs');
        passHash = await bcrypt.hash(String(password), 10);
      }

      // ensure affiliate always has a couponCode in DB (schema requires it)
      const makeCode = () => `AF${Date.now().toString(36)}${Math.random().toString(36).slice(2,6)}`
      const finalCouponCode = couponCode || makeCode()

      const affiliateData = {
        companyId,
        name,
        email: email || null,
        password: passHash,
        whatsapp: whatsapp || null,
        commissionRate: commissionRate || 0,
        couponCode: finalCouponCode,
        currentBalance: 0,
        isActive: true
      };

      const affiliate = await tx.affiliate.create({ data: affiliateData });

      // Create the default coupon associated with this affiliate.
      await tx.coupon.create({
        data: {
          companyId,
          code: finalCouponCode,
          description: `Cupom do afiliado ${name}`,
          isPercentage: true,
          value: commissionRate || 0,
          isActive: true,
          affiliateId: affiliate.id
        }
      });

      return affiliate;
    });

    res.status(201).json(result);
  } catch (e) {
    console.error('Error creating affiliate:', e);
    // Unique constraint on Coupon.code or Affiliate.couponCode
    if (e.code === 'P2002') {
      return res.status(400).json({ message: 'Código do cupom já existe' });
    }
    res.status(500).json({ message: 'Erro ao criar afiliado' });
  }
});

// PUT /affiliates/:id - Atualizar afiliado
affiliatesRouter.put('/:id', requireRole('ADMIN'), async (req, res) => {
  const { id } = req.params;
  const companyId = req.user.companyId;
  const { name, email, whatsapp, commissionRate, couponCode, isActive, password } = req.body;

  if (commissionRate && (commissionRate < 0 || commissionRate > 1)) {
    return res.status(400).json({ message: 'Taxa de comissão deve estar entre 0 e 1' });
  }

  try {
    const exists = await getAffiliateIfOwned(prisma, id, companyId);
    if (!exists) return res.status(404).json({ message: 'Afiliado não encontrado' });

    const affiliate = await prisma.affiliate.update({
      where: { id },
      data: {
        name: name || undefined,
        email: email === '' ? null : email,
        whatsapp: whatsapp === '' ? null : whatsapp,
        commissionRate: commissionRate !== undefined ? commissionRate : undefined,
        couponCode: couponCode || undefined,
        isActive: isActive !== undefined ? isActive : undefined
      }
    });

    // update password separately (hashed)
    if (password) {
      try {
        const bcrypt = await import('bcryptjs');
        const passHash = await bcrypt.hash(String(password), 10);
        await prisma.affiliate.update({ where: { id }, data: { password: passHash } });
      } catch (e) { console.warn('Failed to update affiliate password', e); }
    }

    res.json(affiliate);
  } catch (e) {
    console.error('Error updating affiliate:', e);
    if (e.code === 'P2002') {
      return res.status(400).json({ message: 'Código do cupom já existe' });
    }
    res.status(500).json({ message: 'Erro ao atualizar afiliado' });
  }
});

// POST /affiliates/:id/sales - Registrar venda manual para afiliado
affiliatesRouter.post('/:id/sales', requireRole('ADMIN'), async (req, res) => {
  const { id } = req.params;
  const companyId = req.user.companyId;
  const { saleAmount, note } = req.body;

  if (!saleAmount || saleAmount <= 0) {
    return res.status(400).json({ message: 'Valor da venda deve ser maior que zero' });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Buscar o afiliado
      const affiliate = await tx.affiliate.findFirst({
        where: { id, companyId, isActive: true }
      });

      if (!affiliate) {
        throw new Error('Afiliado não encontrado ou inativo');
      }

      // Calcular comissão
      const commissionAmount = Number(saleAmount) * Number(affiliate.commissionRate);

      // Criar registro de venda
      const sale = await tx.affiliateSale.create({
        data: {
          affiliateId: id,
          saleAmount: Number(saleAmount),
          commissionRate: affiliate.commissionRate,
          commissionAmount,
          couponCode: affiliate.couponCode,
          note: note || 'Venda manual registrada pelo operador',
          createdBy: req.user.id,
          createdByName: req.user.name || req.user.email || null
        }
      });

      // Atualizar saldo do afiliado
      const updatedAffiliate = await tx.affiliate.update({
        where: { id },
        data: {
          currentBalance: {
            increment: commissionAmount
          }
        }
      });

      return { sale, affiliate: updatedAffiliate };
    });

    res.status(201).json(result);
  } catch (e) {
    console.error('Error creating affiliate sale:', e);
    res.status(500).json({ message: e.message || 'Erro ao registrar venda' });
  }
});

// POST /affiliates/:id/payments - Registrar pagamento para afiliado
affiliatesRouter.post('/:id/payments', requireRole('ADMIN'), async (req, res) => {
  const { id } = req.params;
  const companyId = req.user.companyId;
  const { amount, method, note, accountId } = req.body;

  if (!amount || amount <= 0) {
    return res.status(400).json({ message: 'Valor do pagamento deve ser maior que zero' });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Buscar o afiliado
      const affiliate = await tx.affiliate.findFirst({
        where: { id, companyId }
      });

      if (!affiliate) {
        throw new Error('Afiliado não encontrado');
      }

      if (Number(affiliate.currentBalance) < Number(amount)) {
        throw new Error('Valor do pagamento superior ao saldo disponível');
      }

      // Criar registro de pagamento
      const payment = await tx.affiliatePayment.create({
        data: {
          affiliateId: id,
          amount: Number(amount),
          method: method || null,
          note: note || null,
          paidBy: req.user.id,
          paidByName: req.user.name || req.user.email || null
        }
      });

      // Atualizar saldo do afiliado
      const updatedAffiliate = await tx.affiliate.update({
        where: { id },
        data: {
          currentBalance: {
            decrement: Number(amount)
          }
        }
      });

      return { payment, affiliate: updatedAffiliate };
    });

    // Bridge: registrar no módulo financeiro
    try { await createFinancialEntryForAffiliate(result.payment, companyId, accountId || null); } catch (e) { console.warn('Financial bridge affiliate error:', e?.message); }

    res.status(201).json(result);
  } catch (e) {
    console.error('Error creating affiliate payment:', e);
    res.status(500).json({ message: e.message || 'Erro ao registrar pagamento' });
  }
});

// GET /affiliates/:id/sales - Listar vendas do afiliado
affiliatesRouter.get('/:id/sales', async (req, res) => {
  const { id } = req.params;
  const companyId = req.user.companyId;

  try {
    const aff = await getAffiliateIfOwned(prisma, id, companyId);
    if (!aff) return res.status(404).json({ message: 'Afiliado não encontrado' });

    const sales = await prisma.affiliateSale.findMany({ where: { affiliateId: id }, include: { order: true }, orderBy: { createdAt: 'desc' } });
    res.json(sales);
  } catch (e) {
    console.error('Error fetching affiliate sales:', e);
    res.status(500).json({ message: 'Erro ao buscar vendas' });
  }
});

// GET /affiliates/:id/payments - Listar pagamentos do afiliado
affiliatesRouter.get('/:id/payments', async (req, res) => {
  const { id } = req.params;
  const companyId = req.user.companyId;

  try {
    const aff = await getAffiliateIfOwned(prisma, id, companyId);
    if (!aff) return res.status(404).json({ message: 'Afiliado não encontrado' });

    const payments = await prisma.affiliatePayment.findMany({ where: { affiliateId: id }, orderBy: { createdAt: 'desc' } });
    res.json(payments);
  } catch (e) {
    console.error('Error fetching affiliate payments:', e);
    res.status(500).json({ message: 'Erro ao buscar pagamentos' });
  }
});

// GET /affiliates/:id/statement - Extrato combinado (vendas + pagamentos) ordenado por data
affiliatesRouter.get('/:id/statement', async (req, res) => {
  const { id } = req.params;
  const companyId = req.user.companyId;

  try {
    // verify affiliate belongs to company
    const aff = await prisma.affiliate.findFirst({ where: { id, companyId } });
    if (!aff) return res.status(404).json({ message: 'Afiliado não encontrado' });

    const [sales, payments] = await Promise.all([
      prisma.affiliateSale.findMany({
        where: { affiliateId: id },
        include: { order: true }
      }),
      prisma.affiliatePayment.findMany({
        where: { affiliateId: id }
      })
    ]);

    // Normalize into a single timeline array
    const mappedSales = sales.map(s => ({
      type: 'sale',
      id: s.id,
      date: s.createdAt,
      amount: Number(s.saleAmount),
      commission: Number(s.commissionAmount),
      note: s.note,
      orderId: s.orderId || null,
      actorId: s.createdBy || null,
      actorName: s.createdByName || null
    }));

    const mappedPayments = payments.map(p => ({
      type: 'payment',
      id: p.id,
      date: p.createdAt,
      amount: Number(p.amount),
      method: p.method || null,
      note: p.note || null,
      actorId: p.paidBy || null,
      actorName: p.paidByName || null
    }));

    const timeline = mappedSales.concat(mappedPayments).sort((a, b) => new Date(b.date) - new Date(a.date));

    res.json({ affiliate: { id: aff.id, name: aff.name, couponCode: aff.couponCode }, timeline });
  } catch (e) {
    console.error('Error fetching affiliate statement:', e);
    res.status(500).json({ message: 'Erro ao buscar extrato' });
  }
});

// DELETE /affiliates/:id - Remover afiliado e seu cupom padrão
affiliatesRouter.delete('/:id', requireRole('ADMIN'), async (req, res) => {
  const { id } = req.params
  const companyId = req.user.companyId
  try {
    const result = await prisma.$transaction(async (tx) => {
      // ensure affiliate belongs to company
      const aff = await tx.affiliate.findFirst({ where: { id, companyId } })
      if (!aff) throw new Error('Afiliado não encontrado')

      // delete coupons associated to this affiliate
      await tx.coupon.deleteMany({ where: { affiliateId: id } })

      // delete affiliate
      await tx.affiliate.delete({ where: { id } })

      return true
    })

    res.json({ success: true })
  } catch (e) {
    console.error('Error deleting affiliate:', e)
    return res.status(500).json({ message: e.message || 'Erro ao remover afiliado' })
  }
})