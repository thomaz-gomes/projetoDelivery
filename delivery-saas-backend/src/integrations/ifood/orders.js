// src/integrations/ifood/orders.js
import axios from 'axios';
import { prisma } from '../../prisma.js';
import { getIFoodAccessToken } from './oauth.js';

/**
 * Cria cliente HTTP autenticado para a Merchant API
 */
function ifoodHttp(accessToken) {
  return axios.create({
    baseURL: process.env.IFOOD_MERCHANT_BASE || 'https://merchant-api.ifood.com.br',
    timeout: 15000,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    }
  });
}

/**
 * Busca lista de eventos (novos pedidos, status, etc.)
 */
export async function pollIFoodEvents(companyId) {
  const token = await getIFoodAccessToken(companyId);
  const api = ifoodHttp(token);

  const { data } = await api.get('/order/v1.0/events');
  return data || [];
}

/**
 * Confirma o recebimento (ack) dos eventos já processados
 */
export async function acknowledgeIFoodEvents(companyId, events) {
  if (!events?.length) return { ok: true, message: 'sem eventos' };
  const token = await getIFoodAccessToken(companyId);
  const api = ifoodHttp(token);

  const { data } = await api.post('/order/v1.0/events/acknowledgment', { events });
  return data || { ok: true };
}

/**
 * Busca detalhes completos de um pedido específico
 */
export async function getIFoodOrderDetails(companyId, orderId) {
  const token = await getIFoodAccessToken(companyId);
  const api = ifoodHttp(token);

  const { data } = await api.get(`/order/v1.0/orders/${orderId}`);
  return data;
}