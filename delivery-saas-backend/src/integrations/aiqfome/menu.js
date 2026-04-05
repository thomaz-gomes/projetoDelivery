// src/integrations/aiqfome/menu.js
// Menu sync via aiqbridge (iFood catalog-compatible endpoints)
// Prices are NOT pushed — aiqfome manages its own pricing.

import { aiqfomePut, aiqfomePatch, aiqfomeGet, aiqfomeDelete } from './client.js';
import { prisma } from '../../prisma.js';

async function loadIntegration(integrationId) {
  const integration = await prisma.apiIntegration.findUnique({ where: { id: integrationId } });
  if (!integration) throw new Error(`ApiIntegration ${integrationId} not found`);
  if (!integration.enabled) throw new Error(`ApiIntegration ${integrationId} is disabled`);
  if (!integration.accessToken) throw new Error(`ApiIntegration ${integrationId} has no token`);
  return integration;
}

/**
 * Sync a full menu to aiqfome via aiqbridge catalog endpoints.
 * Uses iFood catalog format: PUT /items for create/update, PATCH /items/status for availability.
 */
export async function syncMenuToAiqfome(integrationId, menuId) {
  const integration = await loadIntegration(integrationId);

  const menu = await prisma.menu.findUnique({
    where: { id: menuId },
    include: {
      categories: {
        where: { isActive: true },
        orderBy: { position: 'asc' },
        include: {
          products: {
            where: { isActive: true },
            orderBy: { position: 'asc' },
          },
        },
      },
    },
  });

  if (!menu) throw new Error(`Menu ${menuId} not found`);

  const results = { items: 0, errors: [] };

  for (const category of menu.categories) {
    for (const product of category.products) {
      try {
        const itemPayload = {
          name: product.name,
          description: product.description || '',
          externalCode: product.integrationCode || product.id,
          categoryName: category.name,
        };

        await aiqfomePut(integrationId, '/items', itemPayload);
        results.items++;
      } catch (err) {
        results.errors.push(`Product "${product.name}": ${err?.response?.data?.detail || err.message}`);
      }
    }
  }

  return results;
}

/**
 * Toggle a single product's availability on aiqbridge.
 */
export async function syncItemAvailability(integrationId, productId, available) {
  await loadIntegration(integrationId);

  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) throw new Error(`Product ${productId} not found`);

  const externalCode = product.integrationCode || product.id;
  await aiqfomePatch(integrationId, '/items/status', {
    externalCode,
    available,
  });

  return { productId, externalCode, available };
}
