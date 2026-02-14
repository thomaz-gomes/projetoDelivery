// src/routes/metaPixel.js
import express from 'express';
import { prisma } from '../prisma.js';
import { authMiddleware, requireRole } from '../auth.js';

const metaPixelRouter = express.Router();
metaPixelRouter.use(authMiddleware);

// List all Meta Pixels for the company
metaPixelRouter.get('/', requireRole('ADMIN'), async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const pixels = await prisma.metaPixel.findMany({
      where: { companyId },
      orderBy: { createdAt: 'asc' },
    });
    res.json(pixels);
  } catch (e) {
    console.error('GET /meta-pixel failed', e);
    res.status(500).json({ message: 'Erro ao listar pixels', error: e.message });
  }
});

// Get a single Meta Pixel by id
metaPixelRouter.get('/:id', requireRole('ADMIN'), async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.user.companyId;
    const pixel = await prisma.metaPixel.findFirst({ where: { id, companyId } });
    if (!pixel) return res.status(404).json({ message: 'Pixel não encontrado' });
    res.json(pixel);
  } catch (e) {
    console.error('GET /meta-pixel/:id failed', e);
    res.status(500).json({ message: 'Erro ao buscar pixel', error: e.message });
  }
});

// Create a new Meta Pixel
metaPixelRouter.post('/', requireRole('ADMIN'), async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { menuId, pixelId, enabled,
      trackPageView, trackViewContent, trackAddToCart,
      trackInitiateCheckout, trackAddPaymentInfo, trackPurchase,
      trackSearch, trackLead, trackContact
    } = req.body || {};

    if (!menuId) return res.status(400).json({ message: 'menuId é obrigatório' });
    if (!pixelId) return res.status(400).json({ message: 'pixelId é obrigatório' });

    // Validate pixelId format (numeric string, 15-16 digits)
    const cleanPixelId = String(pixelId).trim();
    if (!/^\d{10,20}$/.test(cleanPixelId)) {
      return res.status(400).json({ message: 'pixelId inválido. Deve conter apenas números (10-20 dígitos).' });
    }

    // Verify menu belongs to a store owned by the company
    const menu = await prisma.menu.findFirst({
      where: { id: menuId },
      include: { store: { select: { companyId: true } } }
    });
    if (!menu || menu.store.companyId !== companyId) {
      return res.status(400).json({ message: 'menuId inválido ou não pertence à empresa' });
    }

    // Check if pixel already exists for this company+menu
    const existing = await prisma.metaPixel.findFirst({ where: { companyId, menuId } });
    if (existing) {
      return res.status(409).json({ message: 'Já existe um Pixel configurado para este cardápio. Use PUT para atualizar.' });
    }

    const created = await prisma.metaPixel.create({
      data: {
        companyId,
        menuId,
        pixelId: cleanPixelId,
        enabled: enabled ?? true,
        trackPageView: trackPageView ?? true,
        trackViewContent: trackViewContent ?? true,
        trackAddToCart: trackAddToCart ?? true,
        trackInitiateCheckout: trackInitiateCheckout ?? true,
        trackAddPaymentInfo: trackAddPaymentInfo ?? true,
        trackPurchase: trackPurchase ?? true,
        trackSearch: trackSearch ?? true,
        trackLead: trackLead ?? true,
        trackContact: trackContact ?? true,
      }
    });
    res.status(201).json(created);
  } catch (e) {
    console.error('POST /meta-pixel failed', e);
    res.status(500).json({ message: 'Erro ao criar pixel', error: e.message });
  }
});

// Update a Meta Pixel
metaPixelRouter.put('/:id', requireRole('ADMIN'), async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.user.companyId;
    const existing = await prisma.metaPixel.findFirst({ where: { id, companyId } });
    if (!existing) return res.status(404).json({ message: 'Pixel não encontrado' });

    const body = req.body || {};

    // If pixelId is being updated, validate format
    if (body.pixelId !== undefined) {
      const cleanPixelId = String(body.pixelId).trim();
      if (!/^\d{10,20}$/.test(cleanPixelId)) {
        return res.status(400).json({ message: 'pixelId inválido. Deve conter apenas números (10-20 dígitos).' });
      }
      body.pixelId = cleanPixelId;
    }

    const updated = await prisma.metaPixel.update({
      where: { id },
      data: {
        pixelId: body.pixelId ?? existing.pixelId,
        enabled: body.enabled ?? existing.enabled,
        trackPageView: body.trackPageView ?? existing.trackPageView,
        trackViewContent: body.trackViewContent ?? existing.trackViewContent,
        trackAddToCart: body.trackAddToCart ?? existing.trackAddToCart,
        trackInitiateCheckout: body.trackInitiateCheckout ?? existing.trackInitiateCheckout,
        trackAddPaymentInfo: body.trackAddPaymentInfo ?? existing.trackAddPaymentInfo,
        trackPurchase: body.trackPurchase ?? existing.trackPurchase,
        trackSearch: body.trackSearch ?? existing.trackSearch,
        trackLead: body.trackLead ?? existing.trackLead,
        trackContact: body.trackContact ?? existing.trackContact,
      }
    });
    res.json(updated);
  } catch (e) {
    console.error('PUT /meta-pixel/:id failed', e);
    res.status(500).json({ message: 'Erro ao atualizar pixel', error: e.message });
  }
});

// Delete a Meta Pixel
metaPixelRouter.delete('/:id', requireRole('ADMIN'), async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.user.companyId;
    const existing = await prisma.metaPixel.findFirst({ where: { id, companyId } });
    if (!existing) return res.status(404).json({ message: 'Pixel não encontrado' });
    await prisma.metaPixel.delete({ where: { id } });
    res.json({ ok: true });
  } catch (e) {
    console.error('DELETE /meta-pixel/:id failed', e);
    res.status(500).json({ message: 'Erro ao remover pixel', error: e.message });
  }
});

export default metaPixelRouter;
