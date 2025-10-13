// src/routes/webhooks.js
import express from 'express';
import crypto from 'crypto';
import { prisma } from '../prisma.js';

export const webhooksRouter = express.Router();

function verifySignature(req, secret) {
  try {
    const sig = req.headers['x-ifood-signature'] || '';
    if (!sig || !secret) return true;
    const raw = JSON.stringify(req.body);
    const h = crypto.createHmac('sha256', secret).update(raw).digest('hex');
    return h === sig;
  } catch {
    return false;
  }
}

function pick(obj, keys) {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

function generateExternalId(fallbackSeed) {
  const seed = fallbackSeed || String(Date.now());
  return 'IFD-' + crypto.createHash('md5').update(seed).digest('hex').slice(0, 10);
}

/**
 * Resolve companyId:
 * - tenta merchantId em header / body / order (várias chaves)
 * - se não encontrar, e existir apenas UMA integração IFOOD habilitada, usa essa
 */
async function resolveCompanyByMerchant(req, order) {
  const hdrMerchant = req.headers['x-merchant-id'] || req.headers['x-ifood-merchant-id'];

  const body = req.body || {};
  const merchantId =
    hdrMerchant ||
    body.merchantId ||
    order?.merchantId ||
    order?.merchant?.id ||
    body.resource?.merchantId ||
    body.seller?.id ||
    null;

  if (merchantId) {
    const integ = await prisma.apiIntegration.findFirst({
      where: { provider: 'IFOOD', merchantId: String(merchantId), enabled: true },
      select: { companyId: true },
    });
    if (!integ?.companyId) {
      throw new Error(`Merchant ${merchantId} não está vinculado (ApiIntegration) ou está desabilitado.`);
    }
    return { companyId: integ.companyId, merchantId: String(merchantId) };
  }

  // fallback: exatamente 1 integração iFood habilitada -> usar
  const onlyOne = await prisma.apiIntegration.findMany({
    where: { provider: 'IFOOD', enabled: true },
    select: { companyId: true, merchantId: true },
  });

  if (onlyOne.length === 1) {
    return { companyId: onlyOne[0].companyId, merchantId: onlyOne[0].merchantId || null };
  }

  // sem merchantId e sem fallback seguro
  throw new Error('merchantId ausente no webhook e não há fallback único para decidir a empresa');
}

webhooksRouter.post('/ifood', async (req, res) => {
  try {
    const okSig = verifySignature(req, process.env.IFOOD_WEBHOOK_SECRET);
    if (!okSig) return res.status(401).json({ ok: false, message: 'Assinatura inválida' });

    const body = req.body || {};
    const order =
      body.order ??
      body.data?.order ??
      body.payload?.order ??
      body;

    // >>> NOVO: resolve company/merchant robusto
    const { companyId, merchantId } = await resolveCompanyByMerchant(req, order);

    const externalIdRaw =
      pick(order, ['id', 'orderId', 'code', 'orderCode', 'reference', 'displayId', 'externalId']) ||
      pick(body, ['id', 'eventId']) ||
      null;

    const externalId = externalIdRaw || generateExternalId(body.eventId || body.id);
    const displayId =
      order?.displayId ||
      order?.shortId ||
      order?.number ||
      (externalIdRaw && `#${String(externalIdRaw).slice(-6)}`) ||
      null;

    const customerName =
      order?.customer?.name ||
      order?.consumer?.name ||
      body?.customer?.name ||
      'Cliente';

    const customerPhone =
      order?.customer?.phone ||
      order?.consumer?.phone ||
      body?.customer?.phone ||
      null;

    const addr =
      order?.delivery?.deliveryAddress ||
      order?.deliveryAddress ||
      body?.delivery?.deliveryAddress ||
      {};

    const address =
      addr.formatted ||
      [addr.streetName || addr.street, addr.streetNumber || addr.number, addr.neighborhood]
        .filter(Boolean)
        .join(', ') || null;

    const latitude = addr.coordinates?.latitude ?? null;
    const longitude = addr.coordinates?.longitude ?? null;

    const total = Number(order?.total?.orderAmount ?? order?.totalAmount ?? order?.amount ?? 0);
    const deliveryFee = Number(order?.total?.deliveryFee ?? order?.deliveryFee ?? 0);

    const eventId = body.eventId || body.id || crypto.randomBytes(8).toString('hex');

    const ev = await prisma.webhookEvent.upsert({
      where: { eventId },
      update: { payload: body, status: 'RECEIVED' },
      create: { provider: 'IFOOD', eventId, payload: body, status: 'RECEIVED' },
    });

    const saved = await prisma.order.upsert({
      where: { externalId },
      update: {
        companyId,
        displayId,
        customerName,
        customerPhone,
        address,
        latitude,
        longitude,
        total,
        deliveryFee,
        payload: order,
      },
      create: {
        companyId,
        externalId,
        displayId,
        status: 'EM_PREPARO',
        customerName,
        customerPhone,
        address,
        latitude,
        longitude,
        total,
        deliveryFee,
        payload: order,
        histories: {
          create: [{ from: null, to: 'EM_PREPARO', reason: 'Webhook iFood' }],
        },
        items: {
          create:
            (order?.items || []).map((it) => ({
              name: it.name || it.description || 'Item',
              quantity: Number(it.quantity || 1),
              price: Number(it.price || it.totalPrice || 0),
            })) || [],
        },
      },
      include: { items: true },
    });

    await prisma.webhookEvent.update({
      where: { id: ev.id },
      data: { status: 'PROCESSED', processedAt: new Date() },
    });

    res.json({
      ok: true,
      message: 'Pedido processado',
      orderId: saved.id,
      externalId: saved.externalId,
      displayId: saved.displayId,
      merchantId, // útil para log
    });
  } catch (e) {
    console.error('Erro ao processar webhook IFOOD:', e);
    res.status(400).json({ ok: false, message: 'Falha ao processar pedido', error: String(e.message || e) });
  }
});