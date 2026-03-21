// src/integrations/aiqfome/menu.js
// Menu sync: pushes structure (names, descriptions, SKUs, availability) to aiqfome.
// Prices are NOT pushed — aiqfome manages its own pricing.

import { aiqfomePost, aiqfomePut } from './client.js';
import { prisma } from '../../prisma.js';

/**
 * Load the ApiIntegration record and return it.
 * Throws if not found or not enabled.
 */
async function loadIntegration(integrationId) {
  const integration = await prisma.apiIntegration.findUnique({
    where: { id: integrationId },
  });
  if (!integration) throw new Error(`ApiIntegration ${integrationId} not found`);
  if (!integration.enabled) throw new Error(`ApiIntegration ${integrationId} is disabled`);
  if (!integration.merchantId) throw new Error(`ApiIntegration ${integrationId} has no merchantId (aiqfome store_id)`);
  return integration;
}

/**
 * Sync a full menu (categories + products) to aiqfome.
 *
 * Note: MenuCategory does not have an `integrationCode` field in the schema,
 * so category remote IDs cannot be persisted across syncs. Each sync will
 * attempt to create categories fresh. If aiqfome deduplicates by name this
 * works fine; otherwise a future migration should add integrationCode to
 * MenuCategory.
 *
 * @param {string} integrationId - ApiIntegration UUID
 * @param {string} menuId - Menu UUID
 * @returns {{ categories: number, items: number, options: number, errors: string[] }}
 */
export async function syncMenuToAiqfome(integrationId, menuId) {
  const integration = await loadIntegration(integrationId);
  const storeId = integration.merchantId;

  // Load full menu tree
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
            include: {
              productOptionGroups: {
                include: {
                  group: {
                    include: {
                      options: {
                        where: { isAvailable: true },
                        orderBy: { position: 'asc' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  if (!menu) throw new Error(`Menu ${menuId} not found`);

  const results = { categories: 0, items: 0, options: 0, errors: [] };

  for (const category of menu.categories) {
    let remoteCatId;
    try {
      // MenuCategory has no integrationCode field, so always POST to create.
      // If aiqfome returns an existing category for duplicate names, that's fine.
      const catData = await aiqfomePost(integrationId, `/api/v2/store/${storeId}/menu/categories`, {
        name: category.name,
      });
      remoteCatId = catData.id || catData.categoryId || catData.data?.id;
      results.categories++;
    } catch (err) {
      results.errors.push(`Category "${category.name}": ${err.message}`);
      continue; // skip products under this category if category creation failed
    }

    if (!remoteCatId) {
      results.errors.push(`Category "${category.name}": no remote ID returned`);
      continue;
    }

    // Sync products within this category
    for (const product of category.products) {
      try {
        const itemPayload = {
          name: product.name,
          description: product.description || '',
          sku: product.integrationCode || undefined,
        };

        if (product.integrationCode) {
          // Product already has a remote code — update
          await aiqfomePut(
            integrationId,
            `/api/v2/store/${storeId}/menu/categories/${remoteCatId}/items/${product.integrationCode}`,
            itemPayload,
          );
          results.items++;
        } else {
          // Create new item on aiqfome
          const itemData = await aiqfomePost(
            integrationId,
            `/api/v2/store/${storeId}/menu/categories/${remoteCatId}/items`,
            itemPayload,
          );
          const remoteItemId = itemData.id || itemData.itemId || itemData.data?.id;

          if (remoteItemId) {
            // Persist remote ID back to our Product
            await prisma.product.update({
              where: { id: product.id },
              data: { integrationCode: String(remoteItemId) },
            });
          }
          results.items++;
        }
      } catch (err) {
        results.errors.push(`Product "${product.name}" (${product.id}): ${err.message}`);
      }

      // Best-effort option group / option sync
      // The exact aiqfome V2 endpoint for option groups is undocumented.
      // Stub: iterate groups and options, log counts, skip actual API calls.
      // TODO: implement once aiqfome publishes option-group endpoints, e.g.:
      //   POST /api/v2/store/{storeId}/menu/items/{itemId}/option-groups
      //   POST /api/v2/store/{storeId}/menu/option-groups/{groupId}/options
      for (const pog of product.productOptionGroups) {
        const group = pog.group;
        for (const option of group.options) {
          // Stub — count only
          results.options++;
          // When endpoints are known:
          // if (option.integrationCode) { PUT update } else { POST create, save integrationCode }
        }
      }
    }
  }

  return results;
}

/**
 * Toggle a single product's availability on aiqfome.
 *
 * @param {string} integrationId - ApiIntegration UUID
 * @param {string} productId - Product UUID
 * @param {boolean} available - true to activate, false to deactivate
 */
export async function syncItemAvailability(integrationId, productId, available) {
  const integration = await loadIntegration(integrationId);
  const storeId = integration.merchantId;

  const product = await prisma.product.findUnique({
    where: { id: productId },
  });

  if (!product) throw new Error(`Product ${productId} not found`);
  if (!product.integrationCode) {
    throw new Error(`Product ${productId} has no integrationCode — sync menu first`);
  }

  const action = available ? 'activate' : 'deactivate';
  await aiqfomePut(
    integrationId,
    `/api/v2/store/${storeId}/menu/items/${product.integrationCode}/${action}`,
    {},
  );

  return { productId, integrationCode: product.integrationCode, available };
}
