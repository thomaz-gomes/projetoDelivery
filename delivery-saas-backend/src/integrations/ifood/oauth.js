import axios from 'axios';
import { prisma } from '../../prisma.js';

// =========================
// Configuração base (via .env)
// =========================
const AUTH_BASE =
  process.env.IFOOD_AUTH_BASE ||
  'https://merchant-api.ifood.com.br/authentication/v1.0';

const USER_CODE_PATH = process.env.IFOOD_USER_CODE_PATH || '/oauth/userCode';
const TOKEN_PATH = process.env.IFOOD_TOKEN_PATH || '/oauth/token';

// =========================
// Helper para instanciar o axios
// =========================
function http() {
  return axios.create({
    baseURL: AUTH_BASE,
    timeout: 15000,
  });
}

// ================================================================
// 1️⃣ Iniciar fluxo distribuído (gera userCode + verifier)
// ================================================================
export async function startDistributedAuth({ companyId }) {
  // pick the most recently updated iFood integration for the company (if multiple exist)
  const integ = await prisma.apiIntegration.findFirst({ where: { companyId, provider: 'IFOOD' }, orderBy: { updatedAt: 'desc' } });
  // Prefer clientId stored in DB, fallback to environment variable if available
  const clientIdFromDb = integ?.clientId;
  const clientId = clientIdFromDb || process.env.IFOOD_CLIENT_ID || null;
  if (!clientId) {
    throw new Error('Defina clientId na integração ou via variável de ambiente IFOOD_CLIENT_ID antes de iniciar o vínculo');
  }

  // If no integration record exists, create a lightweight one using environment credentials
  let integrationRecord = integ;
  if (!integrationRecord) {
    const created = await prisma.apiIntegration.create({ data: {
      companyId,
      provider: 'IFOOD',
      clientId: process.env.IFOOD_CLIENT_ID || null,
      clientSecret: process.env.IFOOD_CLIENT_SECRET || null,
      merchantId: process.env.IFOOD_MERCHANT_ID || null,
      enabled: true,
    } });
    integrationRecord = created;
  }

  const api = http();

  try {
    const form = new URLSearchParams({ clientId });
    const { data } = await api.post(USER_CODE_PATH, form.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    const userCode = data?.userCode;
    const verifier = data?.authorizationCodeVerifier || data?.verifier;
    const verificationUrl =
      data?.verificationUrlComplete ||
      data?.verificationUrl ||
      'https://portal.ifood.com.br/apps/code';

    if (!userCode || !verifier)
      throw new Error(
        `Resposta inesperada do /userCode: ${JSON.stringify(data)}`
      );

    const saved = await prisma.apiIntegration.update({
      where: { id: integrationRecord.id },
      data: {
        authMode: 'AUTH_CODE',
        linkCode: userCode,
        codeVerifier: verifier,
        accessToken: null,
        refreshToken: null,
        tokenExpiresAt: null,
      },
    });

    return {
      userCode,
      codeVerifier: verifier,
      verificationUrlComplete: verificationUrl,
      integration: saved,
    };
  } catch (e) {
    const status = e.response?.status;
    const data = e.response?.data;
    throw new Error(
      `Falha ao iniciar vínculo (user-code): HTTP ${status ?? 'ERR'} ${JSON.stringify(
        data ?? e.message
      )}`
    );
  }
}

// ================================================================
// 2️⃣ Trocar authorizationCode + verifier por tokens
// ================================================================
export async function exchangeAuthorizationCode({ companyId, authorizationCode }) {
  const integ = await prisma.apiIntegration.findFirst({ where: { companyId, provider: 'IFOOD' }, orderBy: { updatedAt: 'desc' } });
  // clientId/clientSecret are system-level credentials and may be kept in ENV.
  // Prefer per-integration creds if present, otherwise fallback to ENV.
  const clientId = integ?.clientId || process.env.IFOOD_CLIENT_ID || null;
  const clientSecret = integ?.clientSecret || process.env.IFOOD_CLIENT_SECRET || null;
  const codeVerifier = integ?.codeVerifier || null;
  if (!clientId || !clientSecret) {
    throw new Error('Faltam credenciais do cliente (clientId/clientSecret). Configure via variáveis de ambiente ou registre credenciais na integração.');
  }
  if (!codeVerifier) {
    throw new Error('Faltando codeVerifier. Gere o código de vínculo (userCode) antes de confirmar.');
  }

  const api = http();

  const form = new URLSearchParams({
    grantType: 'authorization_code',
    clientId,
    clientSecret,
    authorizationCode,
    authorizationCodeVerifier: codeVerifier,
  });

  const { data } = await api.post(TOKEN_PATH, form.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  const accessToken = data?.accessToken;
  const refreshToken = data?.refreshToken;
  const tokenType = data?.tokenType || 'Bearer';
  const expiresIn = Number(data?.expiresIn || 10800);
  // save both merchantId (numeric id) and merchantUuid (UUID) when available
  // Preserve existing values if provider response doesn't include them (avoid clearing DB fields)
  const merchantUuid = (typeof data?.merchantUuid !== 'undefined' && data?.merchantUuid !== null) ? data.merchantUuid : integ.merchantUuid || null;
  const merchantId = (typeof data?.merchantId !== 'undefined' && data?.merchantId !== null) ? data.merchantId : integ.merchantId || null;

  if (!accessToken) {
    throw new Error(`Sem access_token no retorno: ${JSON.stringify(data)}`);
  }

  const updated = await prisma.apiIntegration.update({
    where: { id: integ.id },
    data: {
      authCode: authorizationCode,
      accessToken,
      refreshToken,
      tokenType,
      merchantId,
      merchantUuid,
      tokenExpiresAt: new Date(Date.now() + expiresIn * 1000),
    },
  });

  return { ok: true, integration: updated };
}

// ================================================================
// 3️⃣ Atualizar access_token usando refresh_token
// ================================================================
export async function refreshAccessToken({ companyId }) {
  const integ = await prisma.apiIntegration.findFirst({ where: { companyId, provider: 'IFOOD' }, orderBy: { updatedAt: 'desc' } });
  // Allow client credentials to come from environment when per-integration values are not present.
  const clientId = integ?.clientId || process.env.IFOOD_CLIENT_ID || null;
  const clientSecret = integ?.clientSecret || process.env.IFOOD_CLIENT_SECRET || null;
  const refreshToken = integ?.refreshToken || null;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Dados insuficientes para refresh: verifique clientId/clientSecret e refreshToken');
  }

  const api = http();

  const form = new URLSearchParams({
    grantType: 'refresh_token',
    clientId,
    clientSecret,
    refreshToken,
  });

  try {
    const { data } = await api.post(TOKEN_PATH, form.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    console.log('[iFood Refresh] Resposta:', data);

    const accessToken = data?.accessToken;
    const refreshToken = data?.refreshToken || integ.refreshToken;
    const tokenType = data?.tokenType || 'Bearer';
    const expiresIn = Number(data?.expiresIn || 10800);

    if (!accessToken) {
      throw new Error(`Sem access_token no retorno: ${JSON.stringify(data)}`);
    }

    const updated = await prisma.apiIntegration.update({
      where: { id: integ.id },
      data: {
        accessToken,
        refreshToken,
        tokenType,
        tokenExpiresAt: new Date(Date.now() + expiresIn * 1000),
      },
    });

    return { ok: true, integration: updated };
  } catch (e) {
    console.error('[iFood Refresh] Falha:', e.response?.data || e.message);
    throw e;
  }
}

// ================================================================
// 4️⃣ Helper: garante access_token válido
// ================================================================
export async function getIFoodAccessToken(companyId) {
  const integ = await prisma.apiIntegration.findFirst({ where: { companyId, provider: 'IFOOD', enabled: true }, orderBy: { tokenExpiresAt: 'desc' } });

  if (!integ?.accessToken) {
    throw new Error('Sem token. Finalize o vínculo com o iFood primeiro.');
  }

  const exp = integ.tokenExpiresAt ? new Date(integ.tokenExpiresAt).getTime() : 0;
  if (Date.now() > exp - 10_000) {
    const r = await refreshAccessToken({ companyId });
    return r.integration.accessToken;
  }

  return integ.accessToken;
}