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
  const integ = await prisma.apiIntegration.findUnique({
    where: { companyId_provider: { companyId, provider: 'IFOOD' } },
  });
  if (!integ?.clientId) {
    throw new Error('Defina clientId antes de iniciar o vínculo');
  }

  const api = http();

  try {
    const form = new URLSearchParams({ clientId: integ.clientId });
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
      where: { companyId_provider: { companyId, provider: 'IFOOD' } },
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
  const integ = await prisma.apiIntegration.findUnique({
    where: { companyId_provider: { companyId, provider: 'IFOOD' } },
  });
  if (!integ?.clientId || !integ?.clientSecret || !integ?.codeVerifier) {
    throw new Error('Integração incompleta. Gere o código de vínculo primeiro.');
  }

  const api = http();

  const form = new URLSearchParams({
    grantType: 'authorization_code',
    clientId: integ.clientId,
    clientSecret: integ.clientSecret,
    authorizationCode,
    authorizationCodeVerifier: integ.codeVerifier,
  });

  const { data } = await api.post(TOKEN_PATH, form.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  const accessToken = data?.accessToken;
  const refreshToken = data?.refreshToken;
  const tokenType = data?.tokenType || 'Bearer';
  const expiresIn = Number(data?.expiresIn || 10800);
  const merchantId = data?.merchantId || integ.merchantId || null;

  if (!accessToken) {
    throw new Error(`Sem access_token no retorno: ${JSON.stringify(data)}`);
  }

  const updated = await prisma.apiIntegration.update({
    where: { companyId_provider: { companyId, provider: 'IFOOD' } },
    data: {
      authCode: authorizationCode,
      accessToken,
      refreshToken,
      tokenType,
      merchantId,
      tokenExpiresAt: new Date(Date.now() + expiresIn * 1000),
    },
  });

  return { ok: true, integration: updated };
}

// ================================================================
// 3️⃣ Atualizar access_token usando refresh_token
// ================================================================
export async function refreshAccessToken({ companyId }) {
  const integ = await prisma.apiIntegration.findUnique({
    where: { companyId_provider: { companyId, provider: 'IFOOD' } },
  });

  if (!integ?.clientId || !integ?.clientSecret || !integ?.refreshToken) {
    throw new Error('Dados insuficientes para refresh');
  }

  const api = http();

  const form = new URLSearchParams({
    grantType: 'refresh_token',
    clientId: integ.clientId,
    clientSecret: integ.clientSecret,
    refreshToken: integ.refreshToken,
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
      where: { companyId_provider: { companyId, provider: 'IFOOD' } },
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
  const integ = await prisma.apiIntegration.findUnique({
    where: { companyId_provider: { companyId, provider: 'IFOOD' } },
  });

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