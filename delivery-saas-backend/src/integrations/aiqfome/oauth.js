// src/integrations/aiqfome/oauth.js
// Simplified auth for aiqbridge: static JWT token per store (no OAuth flow needed)
import { prisma } from '../../prisma.js';

/**
 * Save aiqbridge token for a store.
 * Token is generated in the aiqbridge dashboard (https://www.aiqbridge.com.br/web/)
 */
export async function saveAiqbridgeToken({ companyId, storeId, token, merchantId }) {
  let integ = await prisma.apiIntegration.findFirst({
    where: { companyId, provider: 'AIQFOME', storeId: storeId || undefined },
    orderBy: { updatedAt: 'desc' },
  });

  if (!integ) {
    integ = await prisma.apiIntegration.create({
      data: {
        companyId,
        storeId: storeId || null,
        provider: 'AIQFOME',
        accessToken: token,
        merchantId: merchantId || null,
        enabled: true,
      },
    });
  } else {
    integ = await prisma.apiIntegration.update({
      where: { id: integ.id },
      data: {
        accessToken: token,
        merchantId: merchantId || integ.merchantId,
        storeId: storeId || integ.storeId,
      },
    });
  }

  return integ;
}

/**
 * Remove token (disconnect)
 */
export async function clearAiqbridgeToken(integrationId) {
  await prisma.apiIntegration.update({
    where: { id: integrationId },
    data: { accessToken: null, merchantId: null },
  });
}

// Keep these exports for backward compatibility (used by client.js indirectly)
export async function getAiqfomeAccessToken(integrationId) {
  const integ = await prisma.apiIntegration.findUnique({
    where: { id: integrationId },
    select: { accessToken: true },
  });
  if (!integ?.accessToken) throw new Error('Token aiqbridge não configurado');
  return integ.accessToken;
}

// Stubs for old OAuth functions (no longer needed with aiqbridge)
export async function startAiqfomeAuth() { throw new Error('Use saveAiqbridgeToken instead') }
export async function exchangeAiqfomeCode() { throw new Error('Use saveAiqbridgeToken instead') }
export async function refreshAiqfomeToken() { /* no-op: aiqbridge tokens don't expire */ }
