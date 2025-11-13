// src/integrations/ifood/client.js
import axios from 'axios';
import { getIFoodAccessToken } from './oauth.js';
import { prisma } from '../../prisma.js';

/**
 * Cria instância HTTP base para a API do iFood
 */
function makeIFoodHttp() {
  const baseURL = process.env.IFOOD_BASE_URL || 'https://merchant-api.ifood.com.br';
  return axios.create({
    baseURL,
    timeout: 20000,
  });
}

/**
 * Polling oficial: busca eventos novos para um merchant
 * GET /order/v1.0/events:polling
 */
export async function ifoodPoll(companyId) {
  const token = await getIFoodAccessToken(companyId);
  const http = makeIFoodHttp();

  // 🔹 busca integração no banco para pegar o merchant UUID real
  const integration = await prisma.apiIntegration.findUnique({
    where: { companyId_provider: { companyId, provider: 'IFOOD' } },
  });

  if (!integration) throw new Error('Integração iFood não encontrada');
  if (!integration.accessToken) throw new Error('Sem token ativo para o iFood');

  // 🔹 usa merchantUuid (novo campo), ou o merchantId salvo
  const merchantHeader =
    integration.merchantUuid ||
    integration.merchantId ||
    process.env.IFOOD_MERCHANT_UUID ||
    '';

  // ❗ evita enviar header vazio
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };

  if (merchantHeader) {
    headers['x-polling-merchants'] = merchantHeader;
  }

  try {
    const { data, status } = await http.get('/order/v1.0/events:polling', {
      headers,
      params: {
        categories: 'ALL', // retorna todos os tipos de pedidos (FOOD, GROCERY, etc.)
      },
      validateStatus: () => true, // permite 204 (sem eventos)
    });

    if (status === 204) {
      console.log('[iFood Polling] Nenhum evento novo');
      return { ok: true, events: [] };
    }

    if (status >= 400) {
      console.error('[iFood Polling] Erro', status, data);
      throw new Error(JSON.stringify(data));
    }

    console.log('[iFood Polling] Eventos recebidos:', data?.length || 0);
    return { ok: true, events: data };
  } catch (e) {
    console.error('[iFood Polling] Falha:', e.response?.data || e.message);
    throw e;
  }
}

/**
 * Envia acknowledgment para os eventos já processados
 * POST /order/v1.0/events/acknowledgment
 */
export async function ifoodAck(companyId, events = []) {
  if (!Array.isArray(events) || events.length === 0) {
    return { ok: true, message: 'Nada para confirmar' };
  }

  const token = await getIFoodAccessToken(companyId);
  const http = makeIFoodHttp();

  try {
    const payload = events.map(ev => ({ id: ev.id }));

    const { status } = await http.post(
      '/order/v1.0/events/acknowledgment',
      payload,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (status >= 200 && status < 300) {
      console.log(`[iFood Ack] ${payload.length} eventos confirmados`);
      return { ok: true, count: payload.length };
    } else {
      throw new Error(`ACK retornou status ${status}`);
    }
  } catch (e) {
    console.error('[iFood Ack] Erro:', e.response?.data || e.message);
    throw e;
  }
}