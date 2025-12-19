// src/integrations/ifood/index.js
import { ifoodGet, ifoodPost } from './client.js';
import { prisma } from '../../prisma.js';

/**
 * Faz polling dos eventos do iFood para a empresa
 * Cria/atualiza pedidos no banco
 */
export async function pollIFood(companyId) {
  const integration = await prisma.apiIntegration.findUnique({
    where: { companyId_provider: { companyId, provider: 'IFOOD' } },
  });

  if (!integration?.accessToken) {
    throw new Error('Sem token. Finalize a vinculação com o iFood primeiro.');
  }

  // prefer merchantUuid when available, otherwise fallback to merchantId
  const merchantHeader = integration.merchantUuid || integration.merchantId;

  try {
    // ensure header is a JSON array string as required by iFood
    const merchantHeaderValue = merchantHeader
      ? JSON.stringify(Array.isArray(merchantHeader) ? merchantHeader : String(merchantHeader).split(',').map(s => s.trim()).filter(Boolean))
      : undefined;

    const headers = {};
    if (merchantHeaderValue) headers['x-polling-merchants'] = merchantHeaderValue;

    const data = await ifoodGet(companyId, '/order/v1.0/events:polling', {}, headers);
    console.log('[iFood Polling] OK:', data);
    return data;
  } catch (e) {
    console.error('[iFood Polling] Falha:', e.response?.data || e.message);
    throw e;
  }
}

/**
 * Cria ou atualiza o pedido localmente
 */
async function upsertIFoodOrder(companyId, orderData) {
  const { id: externalId, customer, delivery, total, items } = orderData;

  const displayId = orderData.displayId || externalId.slice(0, 6);

  // Localização
  const location = delivery?.deliveryAddress?.coordinates || {};
  const lat = parseFloat(location.latitude || 0);
  const lng = parseFloat(location.longitude || 0);

  // try to detect a store bound to this company's IFOOD integration
  const integration = await prisma.apiIntegration.findFirst({ where: { companyId, provider: 'IFOOD' }, select: { storeId: true }, orderBy: { updatedAt: 'desc' } });
  const storeId = integration?.storeId || null;

  const order = await prisma.order.upsert({
    where: { externalId },
    update: {
      storeId: storeId || undefined,
      status: 'EM_PREPARO',
      customerName: customer?.name,
      customerPhone: customer?.phones?.[0]?.number,
      address: delivery?.deliveryAddress?.formattedAddress,
      latitude: lat || null,
      longitude: lng || null,
      payload: orderData,
      total: Number(total?.orderAmount || 0),
    },
    create: {
      storeId: storeId || null,
      companyId,
      externalId,
      displayId,
      status: 'EM_PREPARO',
      customerName: customer?.name,
      customerPhone: customer?.phones?.[0]?.number,
      address: delivery?.deliveryAddress?.formattedAddress,
      latitude: lat || null,
      longitude: lng || null,
      payload: orderData,
      total: Number(total?.orderAmount || 0),
    },
  });

  // Itens do pedido
  if (items && items.length > 0) {
    for (const item of items) {
      await prisma.orderItem.upsert({
        where: { id: `${externalId}_${item.id}` },
        update: {
          name: item.name,
          quantity: item.quantity,
          price: Number(item.totalPrice || item.unitPrice || 0),
        },
        create: {
          id: `${externalId}_${item.id}`,
          orderId: order.id,
          name: item.name,
          quantity: item.quantity,
          price: Number(item.totalPrice || item.unitPrice || 0),
        },
      });
    }
  }

  console.log(`🆕 Pedido ${displayId} (${externalId}) sincronizado`);
  return order;
}