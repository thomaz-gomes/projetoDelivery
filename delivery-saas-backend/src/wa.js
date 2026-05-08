import axios from 'axios';

const baseURL = process.env.EVOLUTION_API_BASE_URL;
const apiKey  = process.env.EVOLUTION_API_API_KEY;

if (!baseURL) {
  console.warn('EVOLUTION_API_BASE_URL is not set. Evolution API calls will fail.');
}
if (!apiKey) {
  console.warn('EVOLUTION_API_API_KEY is not set. Evolution API calls may be unauthorized.');
}

const http = axios.create({
  baseURL: baseURL || undefined,
  timeout: 60000, // ⏱️ 60 segundos para conexões lentas
  headers: { apikey: apiKey || '', 'Content-Type': 'application/json' },
});

function normalizeStatus(input) {
  const v = String(input || 'UNKNOWN').toUpperCase();
  // mapeia estados comuns da Evolution
  if (['CONNECTING', 'PAIRING', 'QRCODE', 'QR', 'SCAN_QR', 'OPENING'].includes(v)) return 'QRCODE';
  if (['CONNECTED', 'OPEN'].includes(v)) return 'CONNECTED';
  if (['DISCONNECTED', 'CLOSED'].includes(v)) return 'DISCONNECTED';
  return v;
}

function onlyDigits(s) {
  return String(s || '').replace(/\D+/g, '');
}

function normalizePhone(n) {
  const d = onlyDigits(n);
  if (!d) return '';
  return d.startsWith('55') ? d : '55' + d;
}

// True for Brazilian non-WhatsApp numbers (toll-free, premium, donations, paid services).
// Expects the result of normalizePhone (i.e. starts with '55').
function isBrServiceNumber(phone) {
  return /^55(0800|0300|0500|0900|4003|4004|3003|3004)/.test(String(phone || ''));
}

// ─── Webhook Registration ────────────────────────────────────────────────────
// Build the webhook config object used both in instance creation and explicit set
export function buildWebhookConfig() {
  const backendUrl = process.env.BACKEND_URL || process.env.BASE_URL || '';
  if (!backendUrl) return null;
  return {
    enabled: true,
    url: `${backendUrl}/webhook/evolution`,
    webhook_by_events: true,
    events: ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'CONNECTION_UPDATE'],
  };
}

// Explicitly register/update webhook for an existing instance
// Evolution API v2: POST /webhook/set/{instance} with { webhook: { ... } }
export async function evoSetWebhook(instanceName) {
  const config = buildWebhookConfig();
  if (!config) {
    console.warn(`[evo] Cannot register webhook for ${instanceName}: BACKEND_URL not set`);
    return null;
  }
  try {
    const { data } = await http.post(`/webhook/set/${encodeURIComponent(instanceName)}`, { webhook: config });
    console.log(`[evo] ✅ Webhook registered for ${instanceName} → ${config.url}`);
    return data;
  } catch (e) {
    console.warn(`[evo] ❌ Failed to register webhook for ${instanceName}:`, e.response?.data || e.message);
    return null;
  }
}

// Delete instance from Evolution API
export async function evoDeleteInstance(instanceName) {
  try {
    const { data } = await http.delete(`/instance/delete/${encodeURIComponent(instanceName)}`);
    return { ok: true, data };
  } catch (e) {
    const err = { message: e.message, status: e.response?.status || null, body: e.response?.data || null };
    console.warn(`[evo] Delete failed for ${instanceName}:`, err);
    return { ok: false, error: err };
  }
}

/// cria instância (mantém)
export async function evoCreateInstance(payload) {
  // Inject webhook config into creation payload so it's set from the start
  const webhookConfig = buildWebhookConfig();
  const body = {
    qrcode: true,
    integration: 'WHATSAPP-BAILEYS',
    rejectCall: true,
    readMessages: true,
    readStatus: true,
    alwaysOnline: true,
    ...(webhookConfig ? { webhook: webhookConfig } : {}),
    ...payload,
  };
  try {
    const { data } = await http.post('/instance/create', body);
    return data;
  } catch (e) {
    // Normalize error to include useful message
    const err = new Error('Falha ao criar instância na Evolution API');
    err.cause = e;
    err.response = e.response?.data || e.response?.statusText || e.message;
    throw err;
  }
}

// ✅ usa /instance/connectionState/{instance} e lê instance.state
export async function evoGetStatus(instanceName) {
  const { data } = await http.get(`/instance/connectionState/${encodeURIComponent(instanceName)}`);
  const rawState =
    data?.status ??
    data?.state ??
    data?.connectionStatus ??
    data?.result ??
    data?.connection_state ??
    data?.instance?.state; // <<–– importante
  const status = normalizeStatus(rawState);
  return { status, raw: data };
}


// ✅ usa /instance/connect/{instance} para obter QR (base64/qrcode/…)
export async function evoGetQr(instanceName) {
  const resp = await http.get(`/instance/connect/${encodeURIComponent(instanceName)}`);
  const data = resp.data;

  // Se a Evolution ainda não gerou QR, retorna nulo
  if (!data || typeof data !== 'object') {
    return { message: 'Aguardando QR...' };
  }

  // converte para formato padrão
  if (data.qrcode) return { qrcode: data.qrcode };
  if (data.base64) return { qrcode: `data:image/png;base64,${data.base64}` };
  if (data.data && data.type?.includes('image'))
    return { qrcode: `data:${data.type};base64,${data.data}` };

  return data;
}

// enviar texto
export async function evoSendText({ instanceName, to, text, quoted }) {
  const number = normalizePhone(to);
  if (!number) throw new Error('Telefone inválido');

  const attempts = [
    { url: '/message/sendText', body: { instanceName, to: number, text, ...(quoted ? { quoted } : {}) } },
    { url: '/message/send',     body: { instanceName, number, message: text, ...(quoted ? { quoted } : {}) } },
    // alguns builds aceitam rota por path da instância:
    { url: `/message/sendText/${encodeURIComponent(instanceName)}`, body: { number, text, ...(quoted ? { quoted } : {}) } },
  ];

  let last;
  for (const a of attempts) {
    try {
      console.log(`evoSendText -> trying ${a.url} instance=${instanceName} to=${number} text=${String(text).slice(0,120)}`);
      const { data } = await http.post(a.url, a.body);
      console.log(`evoSendText -> success ${a.url} instance=${instanceName} to=${number}`);
      return data;
    } catch (e) {
      last = e;
      console.warn(`evoSendText -> attempt failed ${a.url} instance=${instanceName} to=${number} status=${e.response?.status || 'no-status'} error=${e.response?.data ? JSON.stringify(e.response.data).slice(0,500) : e.message}`);
      continue;
    }
  }
  throw last || new Error('Falha ao enviar mensagem (Evolution)');
}

export { normalizePhone, isBrServiceNumber };

/**
 * Envia localização (pin). Tenta endpoints conhecidos da Evolution.
 * Se a sua build não suportar, vamos cair no texto com link de mapas.
 */
export async function evoSendLocation({ instanceName, to, latitude, longitude, address }) {
  const number = normalizePhone(to);
  if (!number) throw new Error('Telefone inválido');

  const lat = Number(latitude);
  const lng = Number(longitude);

  const attempts = [
    { url: '/message/sendLocation', body: { instanceName, to: number, latitude: lat, longitude: lng, address } },
    { url: '/message/location',     body: { instanceName, number, latitude: lat, longitude: lng, address } },
    { url: `/message/sendLocation/${encodeURIComponent(instanceName)}`, body: { number, latitude: lat, longitude: lng, address } },
  ];

  let last;
  for (const a of attempts) {
    try {
      console.log(`evoSendLocation -> trying ${a.url} instance=${instanceName} to=${number} lat=${lat} lng=${lng}`);
      const { data } = await http.post(a.url, a.body);
      console.log(`evoSendLocation -> success ${a.url} instance=${instanceName} to=${number}`);
      return data;
    } catch (e) { last = e; console.warn(`evoSendLocation -> failed ${a.url} ${e.response?.status || e.message}`); }
  }
  throw last || new Error('Falha ao enviar localização (Evolution)');
}

// enviar arquivo/documento (base64) - tenta endpoints conhecidos
export async function evoSendDocument({ instanceName, to, base64, filename = 'file.pdf', mimeType = 'application/pdf', caption = '' }) {
  const number = normalizePhone(to);
  if (!number) throw new Error('Telefone inválido');

  const attempts = [
    { url: '/message/sendFile', body: { instanceName, to: number, fileBase64: base64, filename, mimeType, caption } },
    { url: '/message/sendDocument', body: { instanceName, to: number, base64, filename, mimeType, caption } },
    { url: '/message/sendMedia', body: { instanceName, to: number, base64, filename, mimeType, caption } },
    // some builds expect number key instead of to
    { url: `/message/sendFile/${encodeURIComponent(instanceName)}`, body: { number, fileBase64: base64, filename, mimeType, caption } },
  ];

  let last;
  for (const a of attempts) {
    try {
      // try endpoint
      console.log(`evoSendDocument -> trying ${a.url} instance=${instanceName} to=${number} filename=${filename}`);
      const { data } = await http.post(a.url, a.body);
      console.log(`evoSendDocument -> success ${a.url} instance=${instanceName} to=${number}`);
      return data;
    } catch (e) { last = e; console.warn(`evoSendDocument -> failed ${a.url} ${e.response?.status || e.message}`); }
  }
  throw last || new Error('Falha ao enviar documento (Evolution)');
}

/**
 * Sends an interactive WhatsApp message with reply buttons.
 * `buttons` is an array of `{ id, displayText }` (max 3 reply buttons per
 * WhatsApp spec). When the customer taps one, the webhook receives a
 * `buttonsResponseMessage` (or equivalent) with that button id back.
 *
 * Evolution API ships several payload shapes across versions; we try the
 * common ones until one returns 2xx, mirroring evoSendText's retry pattern.
 */
export async function evoSendButtons({ instanceName, to, title = '', description, footer = '', buttons }) {
  const number = normalizePhone(to);
  if (!number) throw new Error('Telefone inválido');
  if (!Array.isArray(buttons) || buttons.length === 0) throw new Error('buttons obrigatório');

  // Two payload shapes seen in the wild:
  //   v1.x:   { buttonsMessage: { title, description, footer, buttons: [{ buttonId, buttonText: { displayText }, type: 1 }] } }
  //   recent: { title, description, footer, buttons: [{ buttonId, buttonText: { displayText }, type: 1 }] }
  const buttonsPayload = buttons.map((b) => ({
    buttonId: String(b.id || b.buttonId || ''),
    buttonText: { displayText: String(b.displayText || b.text || '') },
    type: 1,
  }));

  const attempts = [
    {
      url: `/message/sendButtons/${encodeURIComponent(instanceName)}`,
      body: { number, title, description, footer, buttons: buttonsPayload },
    },
    {
      url: `/message/sendButtons`,
      body: { instanceName, to: number, title, description, footer, buttons: buttonsPayload },
    },
    {
      url: `/message/sendButtons/${encodeURIComponent(instanceName)}`,
      body: { number, buttonsMessage: { title, description, footer, buttons: buttonsPayload } },
    },
  ];

  let last;
  for (const a of attempts) {
    try {
      console.log(`evoSendButtons -> trying ${a.url} instance=${instanceName} to=${number} buttons=${buttonsPayload.length}`);
      const { data } = await http.post(a.url, a.body);
      console.log(`evoSendButtons -> success ${a.url} instance=${instanceName} to=${number}`);
      return data;
    } catch (e) {
      last = e;
      console.warn(`evoSendButtons -> attempt failed ${a.url} status=${e.response?.status || 'no-status'} error=${e.response?.data ? JSON.stringify(e.response.data).slice(0, 500) : e.message}`);
    }
  }
  throw last || new Error('Falha ao enviar botões (Evolution)');
}

// send media by public URL (preferred for larger files). Tries known endpoints.
export async function evoSendMediaUrl({ instanceName, to, mediaUrl, filename = 'file.pdf', mimeType = 'application/pdf', caption = '' }) {
  const number = normalizePhone(to);
  if (!number) throw new Error('Telefone inválido');

  // Derive Evolution API mediatype from mime so images render as images, not documents
  const mediatype = mimeType.startsWith('image/') ? 'image'
    : mimeType.startsWith('video/') ? 'video'
    : mimeType.startsWith('audio/') ? 'audio'
    : 'document';

  const attempts = [
    // instance in path, media property is public url
    { url: `/message/sendMedia/${encodeURIComponent(instanceName)}`, body: { number, mediatype, mimetype: mimeType, caption, media: mediaUrl, fileName: filename } },
    { url: `/message/sendMedia`, body: { instanceName, to: number, mediatype, mimetype: mimeType, caption, media: mediaUrl, fileName: filename } },
    // alternative keys/names
    { url: `/message/sendMedia/${encodeURIComponent(instanceName)}`, body: { number, mediatype: 'document', mimetype: mimeType, caption, media: mediaUrl, fileName: filename } },
  ];

  let last;
  for (const a of attempts) {
    try {
      console.log(`evoSendMediaUrl -> trying ${a.url} instance=${instanceName} to=${number} media=${String(mediaUrl).slice(0,120)}`);
      const { data } = await http.post(a.url, a.body);
      console.log(`evoSendMediaUrl -> success ${a.url} instance=${instanceName} to=${number}`);
      return data;
    } catch (e) { last = e; console.warn(`evoSendMediaUrl -> failed ${a.url} ${e.response?.status || e.message}`); }
  }
  throw last || new Error('Falha ao enviar mídia por URL (Evolution)');
}