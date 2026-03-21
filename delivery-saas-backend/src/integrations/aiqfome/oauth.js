// src/integrations/aiqfome/oauth.js
import axios from 'axios';
import { prisma } from '../../prisma.js';

// =========================
// Configuracao base (via .env)
// =========================
const TOKEN_URL =
  process.env.AIQFOME_TOKEN_URL || 'https://id.magalu.com/oauth/token';

const AUTHORIZE_URL =
  process.env.AIQFOME_AUTHORIZE_URL || 'https://id.magalu.com/oauth/authorize';

const SCOPES = 'aqf:order:read aqf:order:create aqf:store:read aqf:store:create aqf:menu:read aqf:menu:create';

// =========================
// Helper para instanciar o axios
// =========================
function http() {
  return axios.create({
    timeout: 15000,
  });
}

// ================================================================
// 1. Iniciar fluxo OAuth2 authorization_code
// ================================================================
export async function startAiqfomeAuth({ companyId, storeId, clientId, clientSecret }) {
  // Find or create ApiIntegration for AIQFOME
  let integ = await prisma.apiIntegration.findFirst({
    where: { companyId, provider: 'AIQFOME' },
    orderBy: { updatedAt: 'desc' },
  });

  if (!integ) {
    integ = await prisma.apiIntegration.create({
      data: {
        companyId,
        storeId: storeId || null,
        provider: 'AIQFOME',
        clientId,
        clientSecret,
        enabled: true,
      },
    });
  } else {
    // Update credentials if provided
    integ = await prisma.apiIntegration.update({
      where: { id: integ.id },
      data: {
        clientId,
        clientSecret,
        storeId: storeId || integ.storeId,
      },
    });
  }

  const redirectUri = process.env.AIQFOME_REDIRECT_URI;
  if (!redirectUri) {
    throw new Error('Defina AIQFOME_REDIRECT_URI nas variaveis de ambiente');
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES,
    state: integ.id,
  });

  const authorizationUrl = `${AUTHORIZE_URL}?${params.toString()}`;

  return {
    authorizationUrl,
    integrationId: integ.id,
  };
}

// ================================================================
// 2. Trocar authorization code por tokens
// ================================================================
export async function exchangeAiqfomeCode({ integrationId, code }) {
  const integ = await prisma.apiIntegration.findUnique({
    where: { id: integrationId },
  });

  if (!integ) {
    throw new Error('Integracao AIQFOME nao encontrada');
  }

  const clientId = integ.clientId;
  const clientSecret = integ.clientSecret;
  if (!clientId || !clientSecret) {
    throw new Error('Faltam credenciais do cliente (clientId/clientSecret) na integracao');
  }

  const redirectUri = process.env.AIQFOME_REDIRECT_URI;
  if (!redirectUri) {
    throw new Error('Defina AIQFOME_REDIRECT_URI nas variaveis de ambiente');
  }

  const api = http();

  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    code,
  });

  const { data } = await api.post(TOKEN_URL, form.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  const accessToken = data?.access_token;
  const refreshToken = data?.refresh_token;
  const expiresIn = Number(data?.expires_in || 7200);
  const scope = data?.scope || SCOPES;

  if (!accessToken) {
    throw new Error(`Sem access_token no retorno: ${JSON.stringify(data)}`);
  }

  await prisma.apiIntegration.update({
    where: { id: integ.id },
    data: {
      authCode: code,
      accessToken,
      refreshToken,
      tokenType: data?.token_type || 'Bearer',
      tokenExpiresAt: new Date(Date.now() + expiresIn * 1000),
    },
  });

  return { integrationId: integ.id, scope };
}

// ================================================================
// 3. Atualizar access_token usando refresh_token
// ================================================================
export async function refreshAiqfomeToken(integrationId) {
  const integ = await prisma.apiIntegration.findUnique({
    where: { id: integrationId },
  });

  if (!integ) {
    throw new Error('Integracao AIQFOME nao encontrada');
  }

  const clientId = integ.clientId;
  const clientSecret = integ.clientSecret;
  const currentRefreshToken = integ.refreshToken;

  if (!clientId || !clientSecret || !currentRefreshToken) {
    throw new Error('Dados insuficientes para refresh: verifique clientId/clientSecret e refreshToken');
  }

  const api = http();

  const form = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: currentRefreshToken,
  });

  try {
    const { data } = await api.post(TOKEN_URL, form.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    console.log('[aiqfome Refresh] Resposta recebida');

    const accessToken = data?.access_token;
    const refreshToken = data?.refresh_token || currentRefreshToken;
    const expiresIn = Number(data?.expires_in || 7200);

    if (!accessToken) {
      throw new Error(`Sem access_token no retorno: ${JSON.stringify(data)}`);
    }

    await prisma.apiIntegration.update({
      where: { id: integ.id },
      data: {
        accessToken,
        refreshToken,
        tokenType: data?.token_type || 'Bearer',
        tokenExpiresAt: new Date(Date.now() + expiresIn * 1000),
      },
    });

    return accessToken;
  } catch (e) {
    console.error('[aiqfome Refresh] Falha:', e.response?.data || e.message);
    throw e;
  }
}

// ================================================================
// 4. Helper: garante access_token valido
// ================================================================
export async function getAiqfomeAccessToken(integrationId) {
  const integ = await prisma.apiIntegration.findUnique({
    where: { id: integrationId },
  });

  if (!integ?.accessToken) {
    throw new Error('Sem token. Finalize o vinculo com o aiqfome primeiro.');
  }

  const exp = integ.tokenExpiresAt ? new Date(integ.tokenExpiresAt).getTime() : 0;

  // Auto-refresh if token expires within 60 seconds
  if (Date.now() > exp - 60_000) {
    const newToken = await refreshAiqfomeToken(integrationId);
    return newToken;
  }

  return integ.accessToken;
}
