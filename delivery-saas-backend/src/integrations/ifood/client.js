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
  const integration = await prisma.apiIntegration.findFirst({ where: { companyId, provider: 'IFOOD' }, orderBy: { updatedAt: 'desc' } });

  if (!integration) throw new Error('Integração iFood não encontrada');
  if (!integration.accessToken) throw new Error('Sem token ativo para o iFood');

  // Prefer numeric merchantId from DB (used by polling), otherwise merchantUuid, then env
  // Some iFood endpoints expect numeric IDs; prefer the DB numeric field when present.
  const merchantHeader = integration.merchantId || integration.merchantUuid || process.env.IFOOD_MERCHANT_ID || '';

  // ❗ evita enviar header vazio
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };

  if (merchantHeader) {
    // iFood expects the header as a JSON array string of merchant identifiers.
    // If identifiers are numeric, send them as numbers (ex: [3366226]) to match provider expectations.
    const arr = Array.isArray(merchantHeader) ? merchantHeader : String(merchantHeader).split(',').map(s => s.trim()).filter(Boolean);
    const allDigits = arr.length > 0 && arr.every(a => /^\d+$/.test(String(a)));
    const allUuid = arr.length > 0 && arr.every(a => /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(String(a)));
    if (allDigits) {
      // numeric array without quotes (ex: [3366226]) — provider may expect numbers
      headers['x-polling-merchants'] = JSON.stringify(arr.map(n => Number(n)));
    } else if (allUuid) {
      // iFood example shows comma-separated UUIDs (no JSON array), send as plain CSV
      headers['x-polling-merchants'] = arr.join(',');
    } else {
      // fallback: JSON array of strings
      headers['x-polling-merchants'] = JSON.stringify(arr);
    }
    console.log('[iFood Polling] using merchant header from DB, field used:', integration.merchantId ? 'merchantId' : (integration.merchantUuid ? 'merchantUuid' : 'env'), 'header:', headers['x-polling-merchants']);
  }

  try {
    // DEBUG: log exact header value to diagnose 400 Invalid value for header
    if (headers['x-polling-merchants']) {
      console.log('[iFood Polling] x-polling-merchants header value:', headers['x-polling-merchants']);
    } else {
      console.log('[iFood Polling] no x-polling-merchants header set');
    }

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
    const errData = e.response?.data || e.message;
    console.error('[iFood Polling] Falha:', errData);

    // If iFood complains about the header format, try a few fallbacks automatically
    const message = JSON.stringify(errData || '');
    if (message.includes('x-polling-merchants') || message.toLowerCase().includes('invalid value for header')) {
      console.log('[iFood Polling] Tentando fallback de formato do header x-polling-merchants');

      // attempt 1: send raw merchantHeader (no JSON array)
      try {
        const headersRaw = { ...headers };
        headersRaw['x-polling-merchants'] = String(merchantHeader);
        console.log('[iFood Polling] tentando header raw:', headersRaw['x-polling-merchants']);
        const r1 = await http.get('/order/v1.0/events:polling', { headers: headersRaw, params: { categories: 'ALL' }, validateStatus: () => true });
        if (r1.status >= 200 && r1.status < 300) return { ok: true, events: r1.data };
        console.warn('[iFood Polling] fallback raw retornou status', r1.status, r1.data);
      } catch (e2) {
        console.warn('[iFood Polling] fallback raw falhou:', e2.response?.data || e2.message);
      }

      // attempt 2: numeric array without quotes (ex: [3366226]) — some iFood endpoints expect numbers unquoted
      try {
        const headersNumArray = { ...headers };
        const arrNum = Array.isArray(merchantHeader) ? merchantHeader : String(merchantHeader).split(',').map(s => s.trim()).filter(Boolean);
        const allDigits = arrNum.every(a => /^\d+$/.test(String(a)));
        if (allDigits) {
          headersNumArray['x-polling-merchants'] = '[' + arrNum.join(',') + ']';
          console.log('[iFood Polling] tentando header numeric-array (no quotes):', headersNumArray['x-polling-merchants']);
          const rNum = await http.get('/order/v1.0/events:polling', { headers: headersNumArray, params: { categories: 'ALL' }, validateStatus: () => true });
          if (rNum.status >= 200 && rNum.status < 300) return { ok: true, events: rNum.data };
          console.warn('[iFood Polling] fallback numeric-array retornou status', rNum.status, rNum.data);
        }
      } catch (eNum) {
        console.warn('[iFood Polling] fallback numeric-array falhou:', eNum.response?.data || eNum.message);
      }

      // attempt 3: comma-separated list (no JSON)
      try {
        const headersComma = { ...headers };
        const arr = Array.isArray(merchantHeader) ? merchantHeader : String(merchantHeader).split(',').map(s => s.trim()).filter(Boolean);
        headersComma['x-polling-merchants'] = arr.join(',');
        console.log('[iFood Polling] tentando header comma-separated:', headersComma['x-polling-merchants']);
        const r2 = await http.get('/order/v1.0/events:polling', { headers: headersComma, params: { categories: 'ALL' }, validateStatus: () => true });
        if (r2.status >= 200 && r2.status < 300) return { ok: true, events: r2.data };
        console.warn('[iFood Polling] fallback comma retornou status', r2.status, r2.data);
      } catch (e3) {
        console.warn('[iFood Polling] fallback comma falhou:', e3.response?.data || e3.message);
      }

      // attempt 3: try without the header at all
      try {
        const headersNo = { ...headers };
        delete headersNo['x-polling-merchants'];
        console.log('[iFood Polling] tentando sem header x-polling-merchants');
        const r3 = await http.get('/order/v1.0/events:polling', { headers: headersNo, params: { categories: 'ALL' }, validateStatus: () => true });
        if (r3.status >= 200 && r3.status < 300) return { ok: true, events: r3.data };
        console.warn('[iFood Polling] fallback sem header retornou status', r3.status, r3.data);
      } catch (e4) {
        console.warn('[iFood Polling] fallback sem header falhou:', e4.response?.data || e4.message);
      }
    }

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