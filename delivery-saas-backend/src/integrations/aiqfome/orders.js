// src/integrations/aiqfome/orders.js
// Order status updates via aiqbridge (iFood-compatible endpoints)
import { aiqfomePost } from './client.js';
import { prisma } from '../../prisma.js';

/**
 * Notify aiqbridge of order status change.
 * Uses iFood-compatible endpoints: confirm, startPreparation, readyToPickup, dispatch, delivered, cancel
 */
export async function updateAiqfomeOrderStatus(companyId, externalId, localStatus) {
  try {
    const integration = await prisma.apiIntegration.findFirst({
      where: { companyId, provider: 'AIQFOME', enabled: true },
      select: { id: true, accessToken: true },
    });
    if (!integration?.accessToken) return null;

    const status = String(localStatus).toUpperCase();
    const actionMap = {
      'EM_PREPARO': 'confirm',
      'PRONTO': 'readyToPickup',
      'SAIU_PARA_ENTREGA': 'dispatch',
      'CONCLUIDO': 'delivered',
      'CONFIRMACAO_PAGAMENTO': 'delivered',
      'CANCELADO': 'cancel',
    };

    const action = actionMap[status];
    if (!action) return null;

    const body = action === 'cancel' ? { reason: 'Cancelado pelo estabelecimento' } : {};
    const result = await aiqfomePost(integration.id, `/orders/${externalId}/${action}`, body);
    console.log(`[aiqbridge] Order ${externalId} -> ${action}`);
    return result;
  } catch (err) {
    console.warn(`[aiqbridge] Failed status update (${localStatus}) for order ${externalId}:`, err?.response?.data || err?.message);
    return null;
  }
}
