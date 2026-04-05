// src/integrations/aiqfome/client.js
// HTTP client for aiqbridge API (iFood-compatible format)
import axios from 'axios';
import { prisma } from '../../prisma.js';

const MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 2000;
const AIQBRIDGE_BASE_URL = process.env.AIQBRIDGE_BASE_URL || 'https://api.aiqbridge.com.br';

function attachRateLimitInterceptor(instance) {
  instance.interceptors.response.use(
    (response) => response,
    async (error) => {
      const config = error.config;
      if (!config) return Promise.reject(error);
      config._retryCount = config._retryCount || 0;
      if (error.response && error.response.status === 429 && config._retryCount < MAX_RETRIES) {
        config._retryCount += 1;
        const delayMs = DEFAULT_RETRY_DELAY_MS * Math.pow(2, config._retryCount - 1);
        console.warn(`[aiqbridge] 429, retry ${config._retryCount}/${MAX_RETRIES} in ${delayMs}ms`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
        return instance(config);
      }
      return Promise.reject(error);
    }
  );
  return instance;
}

/**
 * Get the aiqbridge token from the ApiIntegration record.
 * Token is static (generated in aiqbridge dashboard), no refresh needed.
 */
async function getToken(integrationId) {
  const integ = await prisma.apiIntegration.findUnique({
    where: { id: integrationId },
    select: { accessToken: true },
  });
  if (!integ?.accessToken) throw new Error('Token aiqbridge não configurado. Cole o token do dashboard aiqbridge.');
  return integ.accessToken;
}

function makeHttp() {
  const instance = axios.create({ baseURL: AIQBRIDGE_BASE_URL, timeout: 20000 });
  return attachRateLimitInterceptor(instance);
}

export async function aiqfomeGet(integrationId, path) {
  const token = await getToken(integrationId);
  const { data } = await makeHttp().get(path, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  return data;
}

export async function aiqfomePost(integrationId, path, body) {
  const token = await getToken(integrationId);
  const { data } = await makeHttp().post(path, body, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
  });
  return data;
}

export async function aiqfomePut(integrationId, path, body) {
  const token = await getToken(integrationId);
  const { data } = await makeHttp().put(path, body, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
  });
  return data;
}

export async function aiqfomePatch(integrationId, path, body) {
  const token = await getToken(integrationId);
  const { data } = await makeHttp().patch(path, body, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
  });
  return data;
}

export async function aiqfomeDelete(integrationId, path) {
  const token = await getToken(integrationId);
  const { data } = await makeHttp().delete(path, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  return data;
}
