import express from 'express';
import crypto from 'crypto';
import { authMiddleware, requireRole } from '../auth.js';
import { requireModuleStrict } from '../modules.js';
import { ifoodPoll } from '../integrations/ifood/client.js';
import { prisma } from '../prisma.js';
import { processIFoodWebhook } from '../services/ifoodWebhookProcessor.js';

export const ifoodRouter = express.Router();

// 🔒 Todas as rotas protegidas
ifoodRouter.use(authMiddleware);
ifoodRouter.use(requireModuleStrict('CARDAPIO_COMPLETO'));

/**
 * POST /ifood/poll
 * Executa o polling do iFood (GET /order/v1.0/events:polling)
 * - Retorna eventos e envia acknowledgment automaticamente.
 */
ifoodRouter.post('/poll', requireRole('ADMIN'), async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const result = await ifoodPoll(companyId);

    res.json({
      ok: true,
      count: result?.events?.length || 0,
      events: result?.events || [],
    });
  } catch (e) {
    console.error('Erro no polling iFood:', e.response?.data || e.message);
    res.status(500).json({
      message: 'Falha ao buscar eventos',
      error: e.response?.data || e.message,
    });
  }
});

/**
 * POST /ifood/debug/simulate-placed
 * Simula um evento PLACED do iFood para testar o fluxo de auto-accept.
 * Cria um WebhookEvent fake e processa pelo mesmo pipeline do polling.
 * DEV ONLY — remover em produção.
 */
ifoodRouter.post('/debug/simulate-placed', requireRole('ADMIN'), async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const integ = await prisma.apiIntegration.findFirst({
      where: { companyId, provider: 'IFOOD', enabled: true },
    });
    if (!integ) return res.status(400).json({ message: 'Nenhuma integração iFood ativa' });

    const fakeOrderId = `TEST-${crypto.randomUUID()}`;
    const fakePayload = {
      id: crypto.randomUUID(),
      code: 'PLACED',
      fullCode: 'PLACED',
      orderId: fakeOrderId,
      merchantId: integ.merchantId || integ.merchantUuid || 'test-merchant',
      createdAt: new Date().toISOString(),
      order: {
        id: fakeOrderId,
        displayId: 'TST-' + Math.floor(Math.random() * 9000 + 1000),
        orderType: 'DELIVERY',
        merchant: { id: integ.merchantId || integ.merchantUuid || 'test-merchant' },
        customer: {
          name: 'Cliente Teste Auto-Accept',
          phone: { number: '71999999999' },
        },
        items: [
          {
            name: 'Item Teste',
            quantity: 1,
            unitPrice: 25.90,
            totalPrice: 25.90,
            externalCode: 'TEST001',
          },
        ],
        total: { orderAmount: 25.90, deliveryFee: 5.00 },
        delivery: {
          deliveryAddress: {
            formattedAddress: 'Rua Teste, 123 - Centro',
            streetName: 'Rua Teste',
            streetNumber: '123',
            neighborhood: 'Centro',
            coordinates: { latitude: -12.97, longitude: -38.51 },
          },
        },
        payments: {
          methods: [{ method: 'PIX', value: 30.90 }],
        },
      },
    };

    console.log('[iFood DEBUG] Simulating PLACED event, fakeOrderId:', fakeOrderId);

    // Persist as WebhookEvent (same as polling worker)
    const evt = await prisma.webhookEvent.create({
      data: {
        provider: 'IFOOD',
        eventId: `debug-${fakePayload.id}`,
        payload: fakePayload,
        status: 'RECEIVED',
        receivedAt: new Date(),
      },
    });

    // Process through the standard pipeline
    await processIFoodWebhook(evt.id);

    const processed = await prisma.webhookEvent.findUnique({ where: { id: evt.id } });

    res.json({
      ok: true,
      message: 'Evento PLACED simulado e processado',
      fakeOrderId,
      webhookEventId: evt.id,
      webhookStatus: processed?.status,
      webhookError: processed?.error || null,
    });
  } catch (e) {
    console.error('[iFood DEBUG] simulate-placed failed:', e);
    res.status(500).json({ message: 'Erro na simulação', error: e.message });
  }
});