// src/integrations/ifood/index.js
import { ifoodGet, ifoodPost } from './client.js';
import { prisma } from '../../prisma.js';

/**
 * Faz polling dos eventos do iFood para a empresa
 * Cria/atualiza pedidos no banco
 */
export async function pollIFood(companyId) {
  console.log(`🔄 iFood Poll → Empresa ${companyId}`);

  const events = await ifoodGet(companyId, '/order/v1.0/events');
  if (!Array.isArray(events) || events.length === 0) {
    console.log('Nenhum evento novo');
    return [];
  }

  const ackList = [];

  for (const ev of events) {
    try {
      ackList.push({ id: ev.id });
      const { orderId, code } = ev;

      // 🔹 Eventos de criação de pedido
      if (code === 'PLACED') {
        const orderData = await ifoodGet(companyId, `/order/v1.0/orders/${orderId}`);
        await upsertIFoodOrder(companyId, orderData);
      }

      // 🔹 Atualiza status conforme eventos
      if (['CONFIRMED', 'DISPATCHED', 'DELIVERED', 'CANCELLED'].includes(code)) {
        const statusMap = {
          CONFIRMED: 'EM_PREPARO',
          DISPATCHED: 'SAIU_PARA_ENTREGA',
          DELIVERED: 'CONCLUIDO',
          CANCELLED: 'CANCELADO',
        };

        const order = await prisma.order.findUnique({ where: { externalId: orderId } });
        if (order) {
          await prisma.order.update({
            where: { id: order.id },
            data: { status: statusMap[code] || 'EM_PREPARO' },
          });
        }
      }
    } catch (e) {
      console.error('Erro ao processar evento iFood', e);
    }
  }

  // 🔹 Confirma processamento (ack)
  if (ackList.length > 0) {
    try {
      await ifoodPost(companyId, '/order/v1.0/events/acknowledgment', ackList);
      console.log(`✅ ${ackList.length} eventos confirmados`);
    } catch (ackErr) {
      console.error('Erro no ACK iFood:', ackErr);
    }
  }

  return events;
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

  const order = await prisma.order.upsert({
    where: { externalId },
    update: {
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