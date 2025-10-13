// src/integrations/ifood/oauth.js
import axios from 'axios';
import { prisma } from '../../prisma.js';

// ---------- Helpers para ler listas do .env ----------
function listFromEnv(name, fallbackCsv) {
  const raw = process.env[name]?.trim();
  const csv = raw && raw.length ? raw : fallbackCsv;
  return csv
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

// Bases e paths possíveis (você pode sobrescrever no .env)
const AUTH_BASES = listFromEnv(
  'IFOOD_AUTH_BASES',
  // tente mais de um host/domínio
  'https://merchant-api.ifood.com.br/authentication,https://merchant-auth.ifood.com.br'
);

// `user-code` nos tenants pode variar
const USER_CODE_PATHS = listFromEnv(
  'IFOOD_USER_CODE_PATHS',
  '/v1.0/oauth/user-code,/oauth/user-code,/oauth/userCode,/authentication/v1.0/oauth/user-code'
);

// `link-code` legado
const LINK_CODE_PATHS = listFromEnv(
  'IFOOD_LINK_CODE_PATHS',
  '/v1.0/oauth/link-code,/oauth/link-code,/oauth/linkCode,/authentication/v1.0/oauth/link-code'
);

// token/refresh
const TOKEN_PATHS = listFromEnv(
  'IFOOD_TOKEN_PATHS',
  '/v1.0/oauth/token,/oauth/token,/authentication/v1.0/oauth/token'
);

// Fallback para a URL onde o lojista digita o código
const FALLBACK_VERIFICATION_URL =
  process.env.IFOOD_VERIFICATION_URL_DEFAULT ||
  'https://portal.ifood.com.br/oauth/authorization';

// Faz um POST tentando várias URLs (base + path)
async function postTryAll(bases, paths, body, headers) {
  const tried = [];
  let lastError;

  for (const base of bases) {
    for (const path of paths) {
      const url = base.endsWith('/') || path.startsWith('/')
        ? `${base.replace(/\/+$/, '')}${path.startsWith('/') ? '' : '/'}${path}`
        : `${base}/${path}`;
      tried.push(url);
      try {
        const { data, status } = await axios.post(url, body, { headers, timeout: 15000 });
        if (status >= 200 && status < 300) {
          return { data, urlTried: url, tried };
        }
      } catch (e) {
        // guarda último erro para diagnóstico
        lastError = e;
        // segue tentando as demais combinações
      }
    }
  }

  const detail = lastError?.response?.data || lastError?.message || 'Unknown';
  const msg = `HTTP 404/ERR nas combinações. Tentativas: ${tried.join(' | ')}. Detalhe: ${JSON.stringify(detail)}`;
  const err = new Error(msg);
  err.tried = tried;
  err.last = detail;
  throw err;
}

// Normaliza resposta do user-code/link-code e salva no banco
async function persistStart(companyId, raw, label) {
  const userCode = raw?.userCode || raw?.code || raw?.linkCode;
  const verifier = raw?.verifier || raw?.codeVerifier || raw?.verifierCode;
  const verificationUrlComplete =
    raw?.verificationUrlComplete || raw?.partnerUrl || FALLBACK_VERIFICATION_URL;

  if (!userCode || !verifier) {
    throw new Error(`Resposta inesperada de ${label}: ${JSON.stringify(raw)}`);
  }

  const integration = await prisma.apiIntegration.update({
    where: { companyId_provider: { companyId, provider: 'IFOOD' } },
    data: {
      authMode: 'AUTH_CODE',
      linkCode: userCode,
      codeVerifier: verifier,
      accessToken: null,
      refreshToken: null,
      tokenType: null,
      tokenExpiresAt: null,
    },
  });

  return { userCode, codeVerifier: verifier, verificationUrlComplete, integration };
}

// -------------------------------------------------------------
// 1) Iniciar vínculo (user-code preferencial; fallback link-code)
// -------------------------------------------------------------
export async function startDistributedAuth({ companyId }) {
  const integ = await prisma.apiIntegration.findUnique({
    where: { companyId_provider: { companyId, provider: 'IFOOD' } },
  });
  if (!integ || !integ.clientId) {
    throw new Error('Defina clientId (e opcional clientSecret) antes de iniciar o vínculo');
  }

  // 1) USER-CODE
  try {
    const { data, urlTried } = await postTryAll(
      AUTH_BASES,
      USER_CODE_PATHS,
      { clientId: integ.clientId },
      { 'Content-Type': 'application/json' }
    );
    console.log('[iFood] user-code OK em:', urlTried);
    return await persistStart(companyId, data, 'user-code');
  } catch (e) {
    console.warn('[iFood] user-code indisponível:', e.message);
  }

  // 2) LINK-CODE (legado)
  try {
    const { data, urlTried } = await postTryAll(
      AUTH_BASES,
      LINK_CODE_PATHS,
      { clientId: integ.clientId },
      { 'Content-Type': 'application/json' }
    );
    console.log('[iFood] link-code OK em:', urlTried);
    return await persistStart(companyId, data, 'link-code');
  } catch (e) {
    throw new Error(
      `Falha ao iniciar vínculo (user-code e link-code indisponíveis): ${e.message}. ` +
      `Verifique IFOOD_AUTH_BASES/USER_CODE_PATHS/LINK_CODE_PATHS no .env.`
    );
  }
}

// -------------------------------------------------------------
// 2) Confirmar vínculo: authorizationCode + codeVerifier => tokens
// -------------------------------------------------------------
export async function exchangeAuthorizationCode({ companyId, authorizationCode }) {
  const integ = await prisma.apiIntegration.findUnique({
    where: { companyId_provider: { companyId, provider: 'IFOOD' } },
  });
  if (!integ?.clientId || !integ?.clientSecret || !integ?.codeVerifier) {
    throw new Error('Integração incompleta. Inicie o vínculo primeiro.');
  }

  const form = new URLSearchParams({
    grantType: 'authorization_code',
    grant_type: 'authorization_code',
    clientId: integ.clientId,
    client_id: integ.clientId,
    clientSecret: integ.clientSecret,
    client_secret: integ.clientSecret,
    authorizationCode,
    code: authorizationCode,
    authorizationCodeVerifier: integ.codeVerifier,
    code_verifier: integ.codeVerifier,
  });

  const { data, urlTried } = await postTryAll(
    AUTH_BASES,
    TOKEN_PATHS,
    form.toString(),
    { 'Content-Type': 'application/x-www-form-urlencoded' }
  );
  console.log('[iFood] token (authorization_code) OK em:', urlTried);

  const accessToken  = data?.access_token || data?.accessToken;
  const refreshToken = data?.refresh_token || data?.refreshToken;
  const tokenType    = data?.token_type    || data?.tokenType || 'Bearer';
  const expiresIn    = Number(data?.expires_in || data?.expiresIn || 300);
  const merchantId   = data?.merchantId || integ.merchantId || null;

  if (!accessToken) {
    throw new Error(`Sem access_token no retorno: ${JSON.stringify(data)}`);
  }

  const updated = await prisma.apiIntegration.update({
    where: { companyId_provider: { companyId, provider: 'IFOOD' } },
    data: {
      authMode: 'AUTH_CODE',
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

// -------------------------------------------------------------
// 3) Refresh do token
// -------------------------------------------------------------
export async function refreshAccessToken({ companyId }) {
  const integ = await prisma.apiIntegration.findUnique({
    where: { companyId_provider: { companyId, provider: 'IFOOD' } },
  });
  if (!integ?.clientId || !integ?.clientSecret || !integ?.refreshToken) {
    throw new Error('Dados insuficientes para refresh (clientId/secret/refreshToken)');
  }

  const form = new URLSearchParams({
    grantType: 'refresh_token',
    grant_type: 'refresh_token',
    clientId: integ.clientId,
    client_id: integ.clientId,
    clientSecret: integ.clientSecret,
    client_secret: integ.clientSecret,
    refresh_token: integ.refreshToken,
  });

  const { data, urlTried } = await postTryAll(
    AUTH_BASES,
    TOKEN_PATHS,
    form.toString(),
    { 'Content-Type': 'application/x-www-form-urlencoded' }
  );
  console.log('[iFood] token (refresh_token) OK em:', urlTried);

  const accessToken  = data?.access_token || data?.accessToken;
  const refreshToken = data?.refresh_token || data?.refreshToken || integ.refreshToken;
  const tokenType    = data?.token_type    || data?.tokenType || 'Bearer';
  const expiresIn    = Number(data?.expires_in || data?.expiresIn || 300);

  if (!accessToken) {
    throw new Error(`Sem access_token no refresh: ${JSON.stringify(data)}`);
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
}

// -------------------------------------------------------------
// 4) Helper: devolve accessToken válido (faz refresh se perto de expirar)
// -------------------------------------------------------------
export async function getIFoodAccessToken(companyId) {
  const integ = await prisma.apiIntegration.findUnique({
    where: { companyId_provider: { companyId, provider: 'IFOOD' } },
  });
  if (!integ?.accessToken) {
    throw new Error('Sem token. Finalize a vinculação do iFood primeiro.');
  }

  const exp = integ.tokenExpiresAt ? new Date(integ.tokenExpiresAt).getTime() : 0;
  if (Date.now() > exp - 10_000) {
    const r = await refreshAccessToken({ companyId });
    return r.integration.accessToken;
  }
  return integ.accessToken;
}
