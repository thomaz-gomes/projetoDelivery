// src/integrations/ifood/client.js
import axios from 'axios';
import { getIFoodAccessToken } from './oauth.js';

/**
 * Cria instância do axios com base na URL configurada (sandbox ou prod)
 */
function makeIFoodHttp() {
  const baseURL = process.env.IFOOD_BASE_URL || 'https://merchant-api.ifood.com.br';
  return axios.create({
    baseURL,
    timeout: 15000,
  });
}

/**
 * Faz requisição GET autenticada no iFood para uma empresa específica
 */
export async function ifoodGet(companyId, path, params = {}) {
  const token = await getIFoodAccessToken(companyId);
  const http = makeIFoodHttp();

  try {
    const { data } = await http.get(path, {
      headers: { Authorization: `Bearer ${token}` },
      params,
    });
    return data;
  } catch (e) {
    console.error(`[iFood GET] Erro ${path}`, e.response?.data || e.message);
    throw e;
  }
}

/**
 * Faz requisição POST autenticada no iFood para uma empresa específica
 */
export async function ifoodPost(companyId, path, body = {}) {
  const token = await getIFoodAccessToken(companyId);
  const http = makeIFoodHttp();

  try {
    const { data } = await http.post(path, body, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });
    return data;
  } catch (e) {
    console.error(`[iFood POST] Erro ${path}`, e.response?.data || e.message);
    throw e;
  }
}