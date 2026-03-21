// src/integrations/aiqfome/client.js
import axios from 'axios';
import { getAiqfomeAccessToken } from './oauth.js';

const MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 2000;

/**
 * Interceptor de resposta que trata HTTP 429 (rate limit) com retry automatico.
 * Respeita o header Retry-After quando presente.
 */
function attachRateLimitInterceptor(instance) {
  instance.interceptors.response.use(
    (response) => response,
    async (error) => {
      const config = error.config;
      if (!config) return Promise.reject(error);
      config._retryCount = config._retryCount || 0;

      if (error.response && error.response.status === 429 && config._retryCount < MAX_RETRIES) {
        config._retryCount += 1;
        const retryAfter = error.response.headers['retry-after'];
        const delayMs = retryAfter ? Number(retryAfter) * 1000 : DEFAULT_RETRY_DELAY_MS * Math.pow(2, config._retryCount - 1);
        console.warn(`[aiqfome RateLimit] 429 received, retry ${config._retryCount}/${MAX_RETRIES} in ${delayMs}ms`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
        return instance(config);
      }
      return Promise.reject(error);
    }
  );
  return instance;
}

/**
 * Cria instancia HTTP base para a API do aiqfome
 */
function makeAiqfomeHttp() {
  const baseURL = process.env.AIQFOME_BASE_URL || 'https://plataforma.aiqfome.com';
  const instance = axios.create({
    baseURL,
    timeout: 20000,
  });
  return attachRateLimitInterceptor(instance);
}

/**
 * GET generico autenticado
 */
export async function aiqfomeGet(integrationId, path) {
  const token = await getAiqfomeAccessToken(integrationId);
  const http = makeAiqfomeHttp();

  const { data } = await http.get(path, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });

  return data;
}

/**
 * POST generico autenticado
 */
export async function aiqfomePost(integrationId, path, body) {
  const token = await getAiqfomeAccessToken(integrationId);
  const http = makeAiqfomeHttp();

  const { data } = await http.post(path, body, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
  });

  return data;
}

/**
 * PUT generico autenticado
 */
export async function aiqfomePut(integrationId, path, body) {
  const token = await getAiqfomeAccessToken(integrationId);
  const http = makeAiqfomeHttp();

  const { data } = await http.put(path, body, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
  });

  return data;
}

/**
 * DELETE generico autenticado
 */
export async function aiqfomeDelete(integrationId, path) {
  const token = await getAiqfomeAccessToken(integrationId);
  const http = makeAiqfomeHttp();

  const { data } = await http.delete(path, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });

  return data;
}
