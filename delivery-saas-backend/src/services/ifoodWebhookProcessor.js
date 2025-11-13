// src/services/ifoodWebhookProcessor.js
import { prisma } from '../prisma.js';

/**
 * Extrai companyId a partir do merchantId do payload
 * (assumindo que você salvou merchantId em ApiIntegration)
 */
async function resolveCompanyIdFromPayload(payload) {
  const merchantId =
    payload?.merchantId ||
    payload?.merchant?.id ||
    payload?.order?.merchant?.id ||
    payload?.storeId ||
    null;

  if (!merchantId) return null;

  const integ = await prisma.apiIntegration.findFirst({
    where: { provider: 'IFOOD', merchantId },
    select: { companyId: true },
  });
  return integ?.companyId ?? null;
}

/**
 * Mapeia payload do iFood → nosso Order/OrderItem
 * (ajuste conforme o formato real recebido do iFood)
 */
function mapIFoodOrder(payload) {
  const order = payload?.order || payload; // alguns provedores envelopam em "order"

  // Coordenadas (se vierem no payload)
  const coords = order?.delivery?.deliveryAddress?.coordinates || {};
  const latitude = Number(coords.latitude ?? order?.latitude ?? 0) || null;
  const longitude = Number(coords.longitude ?? order?.longitude ?? 0) || null;

  // Endereço formatado
  const addr = order?.delivery?.deliveryAddress || {};
  const formattedAddress =
    addr.formattedAddress ||
    [addr.streetName, addr.streetNumber, addr.neighborhood]
      .filter(Boolean)
      .join(', ') ||
    null;

  // Total
  const total =
    Number(order?.total?.orderAmount) ||
    Number(order?.total) ||
    0;

  // Itens
  const items = (order?.items || []).map((it) => ({
    name: it?.name || it?.description || 'Item',
    quantity: Number(it?.quantity || 1),
    price: Number(it?.price || it?.unitPrice || 0),
    notes: it?.observations || null,
  }));

  // Cliente
  const customer = order?.customer || {};
  const customerName =
    customer?.name ||
    [customer?.firstName, customer?.lastName].filter(Boolean).join(' ') ||
    null;
  const customerPhone = customer?.phone?.number || customer?.phone || null;

  return {
    externalId: order?.id || order?.referenceId || null,
    displayId: order?.displayId || order?.shortCode || null,
    status: 'EM_PREPARO', // default ao entrar; você pode mapear status do iFood
    customerName,
    customerPhone,
    address: formattedAddress,
    latitude,
    longitude,
    total,
    deliveryFee: Number(order?.total?.deliveryFee || 0) || null,
    items,
    raw: payload,
  };
}

/**
 * Upsert do pedido no nosso banco
 */
async function upsertOrder({ companyId, mapped }) {
  const exists = mapped.externalId
    ? await prisma.order.findUnique({ where: { externalId: mapped.externalId } })
    : null;

  const baseData = {
    companyId,
    externalId: mapped.externalId,
    displayId: mapped.displayId,
    status: mapped.status,
    customerName: mapped.customerName,
    customerPhone: mapped.customerPhone,
    address: mapped.address,
    latitude: mapped.latitude,
    longitude: mapped.longitude,
    total: mapped.total,
    deliveryFee: mapped.deliveryFee,
    payload: mapped.raw,
  };

  if (!exists) {
    // compute displaySimple for today's orders for this company
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const existingCount = await prisma.order.count({ where: { companyId, createdAt: { gte: startOfDay } } });
    const displaySimple = existingCount + 1;

    return prisma.order.create({
      data: {
        ...baseData,
        displaySimple,
        items: {
          create: mapped.items.map((i) => ({
            name: i.name,
            quantity: i.quantity,
            price: i.price,
            notes: i.notes || null,
          })),
        },
        histories: {
          create: [{ from: null, to: 'EM_PREPARO', reason: 'iFood webhook' }],
        },
      },
      include: { items: true },
    });
  }

  // se já existe, só atualizamos campos principais (não recriamos itens)
  return prisma.order.update({
    where: { id: exists.id },
    data: baseData,
    include: { items: true },
  });
}

/**
 * Processa o evento salvo em WebhookEvent
 */
export async function processIFoodWebhook(eventId) {
  const evt = await prisma.webhookEvent.findUnique({ where: { id: eventId } });
  if (!evt) return;

  try {
    const payload = evt.payload;

    // Descobre empresa
    const companyId = await resolveCompanyIdFromPayload(payload);
    if (!companyId) {
      throw new Error('Não foi possível determinar companyId a partir do payload (merchantId ausente).');
    }

    // Mapeia e upsert
    const mapped = mapIFoodOrder(payload);
    await upsertOrder({ companyId, mapped });

    // Marca como processado
    await prisma.webhookEvent.update({
      where: { id: evt.id },
      data: { status: 'PROCESSED', processedAt: new Date() },
    });
  } catch (err) {
    console.error('Erro ao processar evento iFood:', err);
    await prisma.webhookEvent.update({
      where: { id: evt.id },
      data: { status: 'ERROR', error: String(err) },
    });
  }
}