import { Router } from 'express';
import { prisma } from '../prisma.js';
import { getActiveGateway } from '../services/paymentGateway/index.js';

const router = Router();

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

router.post('/leads', async (req, res) => {
  try {
    const { name, phone } = req.body;
    if (!name || !phone) {
      return res.status(400).json({ error: 'name and phone are required' });
    }
    const cleanPhone = String(phone).replace(/\D/g, '');
    if (cleanPhone.length < 10 || cleanPhone.length > 13) {
      return res.status(400).json({ error: 'Invalid phone number' });
    }

    // Find the default paid plan (Cardápio Simples with ANNUAL price, or first active non-free plan)
    const plans = await prisma.saasPlan.findMany({
      where: { isActive: true, isTrial: false },
      include: { prices: true },
      orderBy: { price: 'asc' }
    });

    // Try to find a plan with an ANNUAL price configured
    let targetPlan = null;
    let targetPrice = null;
    let targetPeriod = 'ANNUAL';

    for (const p of plans) {
      const annualPrice = p.prices.find(pr => pr.period === 'ANNUAL');
      if (annualPrice && Number(annualPrice.price) > 0) {
        targetPlan = p;
        targetPrice = Number(annualPrice.price);
        break;
      }
    }

    // Fallback: first plan with price > 0 (use plan.price as monthly)
    if (!targetPlan) {
      for (const p of plans) {
        if (Number(p.price) > 0) {
          targetPlan = p;
          targetPrice = Number(p.price);
          targetPeriod = 'MONTHLY';
          break;
        }
      }
    }

    const lead = await prisma.lead.create({
      data: {
        name: String(name).trim(),
        phone: cleanPhone,
        source: 'landing',
        planId: targetPlan?.id || null,
        period: targetPlan ? targetPeriod : null,
        amount: targetPrice || null,
        paymentStatus: targetPlan ? 'PENDING' : 'NONE',
      }
    });

    // Try to create gateway checkout
    if (targetPlan && targetPrice > 0) {
      try {
        const { adapter, config } = await getActiveGateway();

        const result = await adapter.createCheckout({
          amount: targetPrice,
          description: `Plano ${targetPlan.name} (${targetPeriod})`,
          externalRef: `lead_${lead.id}`,
          backUrls: {
            success: `${FRONTEND_URL}/payment/result?status=success&lead_id=${lead.id}`,
            failure: `${FRONTEND_URL}/payment/result?status=failure&lead_id=${lead.id}`,
            pending: `${FRONTEND_URL}/payment/result?status=pending&lead_id=${lead.id}`,
          },
          notificationUrl: `${BACKEND_URL}/payment/webhook/${config.provider.toLowerCase()}`,
          payer: { firstName: String(name).trim(), phone: cleanPhone },
          items: [{
            id: targetPlan.id,
            title: targetPlan.name,
            description: `Assinatura Plano ${targetPlan.name} (${targetPeriod})`,
            quantity: 1,
            unit_price: targetPrice,
            category_id: 'services',
          }],
        });

        await prisma.lead.update({
          where: { id: lead.id },
          data: {
            preferenceId: result.preferenceId,
            gatewayProvider: config.provider.toLowerCase(),
          }
        });

        return res.json({ ok: true, id: lead.id, checkoutUrl: result.checkoutUrl });
      } catch (gwErr) {
        console.warn('[leads] Gateway checkout failed:', gwErr?.message);
        // Fallback: return lead without checkout (manual flow)
        return res.json({ ok: true, id: lead.id, manual: true });
      }
    }

    return res.json({ ok: true, id: lead.id, manual: true });
  } catch (err) {
    console.error('POST /public/leads error:', err);
    return res.status(500).json({ error: 'Failed to save lead' });
  }
});

// GET /public/leads/:id/status — check lead payment status (public, no auth)
router.get('/leads/:id/status', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid lead ID' });

    const lead = await prisma.lead.findUnique({ where: { id }, select: { paymentStatus: true } });
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    return res.json({ status: lead.paymentStatus });
  } catch (err) {
    console.error('GET /public/leads/:id/status error:', err);
    return res.status(500).json({ error: 'Failed to check status' });
  }
});

export default router;
