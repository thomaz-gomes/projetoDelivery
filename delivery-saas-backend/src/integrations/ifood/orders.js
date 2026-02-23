// src/integrations/ifood/orders.js
import axios from 'axios';
import crypto from 'crypto';
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

/**
 * Tenta notificar o iFood sobre mudança de status do pedido.
 * Faz múltiplas tentativas de formato porque a API do iFood varia por versão.
 */
export async function updateIFoodOrderStatus(companyId, orderId, statusCode, extra = {}) {
  if (!companyId || !orderId || !statusCode) throw new Error('Missing args');
  const token = await getIFoodAccessToken(companyId);
  const api = ifoodHttp(token);

  // Helper to mask sensitive headers when logging
  function maskHeaders(h) {
    try {
      if (!h) return h;
      const copy = Object.assign({}, h);
      if (copy.Authorization) {
        try {
          const s = String(copy.Authorization);
          // show only the prefix and trailing 4 chars
          if (s.length > 20) copy.Authorization = s.slice(0, 15) + '...' + s.slice(-6);
          else copy.Authorization = s.replace(/.(?=.{4})/g, '*');
        } catch (e) { copy.Authorization = '***'; }
      }
      if (copy['x-claims-aud']) copy['x-claims-aud'] = String(copy['x-claims-aud']).slice(0, 60);
      return copy;
    } catch (e) { return '<mask-error>'; }
  }

  // Build x-claims-aud candidates (try merchantId from extra, merchantUuid/merchantId from integration, then client_id)
  let audCandidates = [];
  try {
    if (extra && extra.merchantId) audCandidates.push(String(extra.merchantId));
    const integ = await prisma.apiIntegration.findFirst({ where: { companyId, provider: 'IFOOD' }, select: { merchantId: true, merchantUuid: true } });
    if (integ) {
      if (integ.merchantUuid) audCandidates.push(String(integ.merchantUuid));
      if (integ.merchantId) audCandidates.push(String(integ.merchantId));
    }
    if (process.env.IFOOD_CLIENT_ID) audCandidates.push(String(process.env.IFOOD_CLIENT_ID));
  } catch (e) {
    // ignore
  }
  audCandidates = Array.from(new Set(audCandidates.filter(Boolean)));

  // normalize statusCode to short code expected by iFood (PLC, DSP, CON, RTP, CAN)
  function canonicalToShort(code) {
    if (!code) return null;
    const c = String(code || '').toUpperCase();
    const map = {
      'PLACED': 'PLC',
      'PLC': 'PLC',
      'DISPATCHED': 'DSP',
      'DSP': 'DSP',
      'CONCLUDED': 'CON',
      'CON': 'CON',
      'READY_TO_PICKUP': 'RTP',
      'RTP': 'RTP',
      'CANCELLED': 'CAN',
      'CAN': 'CAN'
    };
    return map[c] || null;
  }

  const shortCode = canonicalToShort(statusCode) || canonicalToShort(String(extra.fullCode || '')) || String(statusCode).slice(0,3).toUpperCase();

  // Debug: log incoming request summary and aud candidates
  try {
    const extraSummary = { merchantId: extra?.merchantId || null, id: extra?.id || null };
    console.log('[iFood update] start', { companyId, orderId, statusCode, shortCode, extra: extraSummary });
    console.log('[iFood update] audCandidates', audCandidates);
  } catch (e) {
    // ignore logging errors
  }

  const attempts = [];
  const attemptMeta = [];
  // Prefer explicit action endpoints when possible (more likely to be authorized).
  // If an action endpoint exists for this shortCode, only try that one (it returns 202 in practice).
  // Otherwise fallback to a single POST /order/v1.0/orders/{orderId}/status attempt.
  const actionMap = {
    'PLC': '/order/v1.0/orders/{id}/startPreparation',
    'DSP': '/order/v1.0/orders/{id}/dispatch',
    'CON': '/order/v1.0/orders/{id}/confirm',
    'RTP': '/order/v1.0/orders/{id}/readyToPickup',
    'CAN': '/order/v1.0/orders/{id}/requestCancellation'
  };
  const actionEndpoint = actionMap[shortCode];
  if (actionEndpoint) {
    attempts.push(async () => {
      const url = actionEndpoint.replace('{id}', encodeURIComponent(orderId));
      const payload = { ...(extra.metadata || {}) };
      // For cancellation, include cancellationCode when provided (required by iFood API)
      if (shortCode === 'CAN' && extra.cancellationCode) {
        payload.cancellationCode = extra.cancellationCode;
      }
      try {
        const fullUrl = (api.defaults?.baseURL || process.env.IFOOD_MERCHANT_BASE || 'https://merchant-api.ifood.com.br').replace(/\/+$/, '') + url;
        console.log('[iFood update][verbose] ACTION POST', { url: fullUrl, headers: maskHeaders(api.defaults && api.defaults.headers), payload });
      } catch (e) { console.log('[iFood update][verbose] ACTION POST (failed to build verbose log)', e && e.message); }
      return api.post(url, payload);
    });
    attemptMeta.push({ method: 'POST', url: actionEndpoint.replace('{id}', encodeURIComponent(orderId)) });
  } else {
    // Fallback: only try status POST
    attempts.push(async () => {
      const path = `/order/v1.0/orders/${orderId}/status`;
      const payload = { code: shortCode, fullCode: statusCode, metadata: extra.metadata || {} };
      try {
        const base = api.defaults?.baseURL || process.env.IFOOD_MERCHANT_BASE || 'https://merchant-api.ifood.com.br';
        const fullUrl = base.replace(/\/+$/, '') + path;
        console.log('[iFood update][verbose] POST', { url: fullUrl, headers: maskHeaders(api.defaults && api.defaults.headers), payload });
      } catch (e) { console.log('[iFood update][verbose] POST (failed to build verbose log)', e && e.message); }
      return api.post(path, payload);
    });
    attemptMeta.push({ method: 'POST', url: `/order/v1.0/orders/${orderId}/status` });
  }

  let lastErr = null;
  // Try each aud candidate and for each try all attempts
  const candidates = audCandidates.length ? audCandidates : [null];
  for (const aud of candidates) {
    try {
      if (aud) {
        api.defaults.headers['x-claims-aud'] = aud;
        console.log('[iFood update] trying x-claims-aud', aud);
      } else {
        // ensure header is absent when aud is null
        if (api.defaults.headers['x-claims-aud']) delete api.defaults.headers['x-claims-aud'];
        console.log('[iFood update] trying without x-claims-aud');
      }
      // Log planned attempt order (method + url)
      try {
        const base = api.defaults?.baseURL || process.env.IFOOD_BASE_URL || process.env.IFOOD_MERCHANT_BASE || 'https://merchant-api.ifood.com.br';
        const baseClean = base.replace(/\/+$/, '');
        const planned = attemptMeta.map((m, idx) => ({ attempt: idx, method: m.method, url: m.url, fullUrl: (m.url && m.url.startsWith('http')) ? m.url : `${baseClean}${m.url.startsWith('/') ? '' : '/'}${m.url}` }));
        console.log('[iFood update] planned attempts', planned);
      } catch (e) {}

      for (let i = 0; i < attempts.length; i++) {
        const fn = attempts[i];
        try {
          const r = await fn();
          try {
            const base = api.defaults?.baseURL || process.env.IFOOD_BASE_URL || process.env.IFOOD_MERCHANT_BASE || 'https://merchant-api.ifood.com.br';
            const baseClean = base.replace(/\/+$/, '');
            const meta = attemptMeta[i] || null;
            const fullUrl = meta ? ((meta.url && meta.url.startsWith('http')) ? meta.url : `${baseClean}${meta.url.startsWith('/') ? '' : '/'}${meta.url}`) : null;
            console.log('[iFood update] attempt success', { audUsed: aud, attempt: i, status: r?.status, endpoint: meta || null, fullUrl });
          } catch (e) {}
          if (r && r.status >= 200 && r.status < 300) return { ok: true, data: r.data, audUsed: aud };
        } catch (e) {
          lastErr = e;
          try {
            const respStatus = e?.response?.status || null;
            const respData = e?.response?.data || null;
            const respHeaders = e?.response?.headers || null;
            const meta = attemptMeta[i] || null;
            const base = api.defaults?.baseURL || process.env.IFOOD_BASE_URL || process.env.IFOOD_MERCHANT_BASE || 'https://merchant-api.ifood.com.br';
            const baseClean = base.replace(/\/+$/, '');
            const fullUrl = meta ? ((meta.url && meta.url.startsWith('http')) ? meta.url : `${baseClean}${meta.url.startsWith('/') ? '' : '/'}${meta.url}`) : null;
            console.error('[iFood update] attempt error', { audTried: aud, attempt: i, endpoint: meta || null, fullUrl, message: e.message, responseStatus: respStatus, responseData: respData, responseHeaders: maskHeaders(respHeaders) });
          } catch (ee) {
            console.error('[iFood update] attempt error (no response info)', { audTried: aud, attempt: i, endpoint: attemptMeta[i] || null, message: e?.message });
          }
          // continue to next attempt
        }
      }
    } catch (e) {
      lastErr = e;
      console.error('[iFood update] outer error for aud', { aud, message: e?.message });
    }
  }
  console.error('[iFood update] all attempts failed', { orderId, companyId, lastErrorMessage: lastErr?.message });
  throw lastErr || new Error('Failed to update iFood order status');
}

/**
 * Dev helper: call a specific iFood action endpoint directly (POST)
 * actionName: e.g. 'DISPATCH', 'CONFIRM', 'START_PREPARATION', or a full path like '/orders/{id}/dispatch'
 */
export async function callIFoodAction(companyId, orderId, actionName, extra = {}) {
  if (!companyId || !orderId || !actionName) throw new Error('Missing args');
  const token = await getIFoodAccessToken(companyId);
  const api = ifoodHttp(token);

  const canonical = String(actionName || '').toUpperCase();
  // If caller passed our internal order id, resolve to the external ifood order id when possible
  let remoteOrderId = orderId;
  try {
    const possible = await prisma.order.findUnique({ where: { id: orderId }, select: { externalId: true, payload: true, companyId: true } });
    if (possible) {
      // ensure the order belongs to the same company (defense)
      if (possible.companyId && String(possible.companyId) !== String(companyId)) {
        // not the same company: do not substitute
      } else {
        if (possible.externalId) {
          remoteOrderId = possible.externalId;
        } else if (possible.payload && (possible.payload.orderId || (possible.payload.order && possible.payload.order.id))) {
          remoteOrderId = possible.payload.orderId || (possible.payload.order && possible.payload.order.id);
        }
      }
    }
  } catch (e) {
    // ignore DB lookup errors and proceed using provided orderId
  }
  const actionMap = {
    'DISPATCH': '/orders/{id}/dispatch',
    'CONFIRM': '/orders/{id}/confirm',
    'START_PREPARATION': '/orders/{id}/startPreparation',
    'READY_TO_PICKUP': '/orders/{id}/readyToPickup',
    'REQUEST_CANCELLATION': '/orders/{id}/requestCancellation'
  };

  const endpointTemplate = actionMap[canonical] || actionName;
  const url = endpointTemplate.replace('{id}', encodeURIComponent(remoteOrderId));

  try {
    console.log('[iFood action] POST', url, 'companyId', companyId, 'orderId', orderId, 'remoteOrderId', remoteOrderId, 'action', actionName);
    const payload = extra.metadata || {};
    const r = await api.post(url, payload);
    console.log('[iFood action] success', { status: r?.status, audUsed: api.defaults.headers['x-claims-aud'] || null });
    return { ok: true, status: r.status, data: r.data };
  } catch (e) {
    try {
      console.error('[iFood action] error', { message: e.message, responseStatus: e?.response?.status || null, responseData: e?.response?.data || null });
    } catch (ee) {
      console.error('[iFood action] error (no response info)', e?.message || String(e));
    }
    throw e;
  }
}