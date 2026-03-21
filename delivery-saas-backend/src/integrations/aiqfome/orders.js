// src/integrations/aiqfome/orders.js
import { aiqfomePost, aiqfomePut } from './client.js';
import { prisma } from '../../prisma.js';

/**
 * Maps local order status to the corresponding aiqfome API call.
 * Returns null silently when there is no integration or no mapping for the status.
 * Never throws — logs warnings on failure.
 */
export async function updateAiqfomeOrderStatus(companyId, externalId, localStatus) {
  try {
    // 1. Find enabled AIQFOME integration for this company
    const integration = await prisma.apiIntegration.findFirst({
      where: { companyId, provider: 'AIQFOME', enabled: true },
      select: { id: true },
    });

    if (!integration) return null;

    // 2. Map local status to aiqfome action
    const orderId = externalId;
    const status = String(localStatus).toUpperCase();

    switch (status) {
      case 'EM_PREPARO': {
        const result = await aiqfomePost(integration.id, '/api/v2/orders/mark-as-read', {
          orders: [orderId],
        });
        console.log(`[aiqfome] mark-as-read success for order ${orderId}`);
        return result;
      }

      case 'PRONTO': {
        const result = await aiqfomePut(integration.id, `/api/v2/orders/${orderId}/ready`);
        console.log(`[aiqfome] ready success for order ${orderId}`);
        return result;
      }

      case 'CONCLUIDO':
      case 'CONFIRMACAO_PAGAMENTO': {
        const result = await aiqfomePut(integration.id, `/api/v2/orders/${orderId}/delivered`);
        console.log(`[aiqfome] delivered success for order ${orderId}`);
        return result;
      }

      case 'CANCELADO': {
        const result = await aiqfomePut(integration.id, `/api/v2/orders/${orderId}/cancel`);
        console.log(`[aiqfome] cancel success for order ${orderId}`);
        return result;
      }

      default:
        // No direct aiqfome equivalent (e.g. SAIU_PARA_ENTREGA)
        return null;
    }
  } catch (err) {
    console.warn(`[aiqfome] failed to update order status (${localStatus}) for order ${externalId}:`, err?.message || err);
    return null;
  }
}

/**
 * Sends logistics tracking updates to aiqfome (aiqentrega).
 * Valid actions: 'pickup-ongoing', 'arrived-at-merchant', 'delivery-ongoing',
 *               'arrived-at-customer', 'order-delivered'
 * Never throws — logs warnings on failure.
 */
const VALID_LOGISTIC_ACTIONS = new Set([
  'pickup-ongoing',
  'arrived-at-merchant',
  'delivery-ongoing',
  'arrived-at-customer',
  'order-delivered',
]);

export async function updateAiqfomeLogistics(companyId, externalId, logisticAction) {
  try {
    if (!VALID_LOGISTIC_ACTIONS.has(logisticAction)) {
      console.warn(`[aiqfome] invalid logistic action: ${logisticAction}`);
      return null;
    }

    // Find enabled AIQFOME integration for this company
    const integration = await prisma.apiIntegration.findFirst({
      where: { companyId, provider: 'AIQFOME', enabled: true },
      select: { id: true },
    });

    if (!integration) return null;

    const result = await aiqfomePost(
      integration.id,
      `/api/v2/logistic/${externalId}/${logisticAction}`,
    );
    console.log(`[aiqfome] logistics ${logisticAction} success for order ${externalId}`);
    return result;
  } catch (err) {
    console.warn(`[aiqfome] failed logistics update (${logisticAction}) for order ${externalId}:`, err?.message || err);
    return null;
  }
}
