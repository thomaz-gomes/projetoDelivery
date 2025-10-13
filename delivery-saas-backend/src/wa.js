import axios from 'axios';

const baseURL = process.env.EVOLUTION_API_BASE_URL;
const apiKey  = process.env.EVOLUTION_API_API_KEY;

const http = axios.create({
  baseURL,
  timeout: 60000, // ⏱️ 60 segundos para conexões lentas
  headers: { apikey: apiKey, 'Content-Type': 'application/json' },
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

/// cria instância (mantém)
export async function evoCreateInstance(payload) {
  const body = {
    qrcode: true,
    integration: 'WHATSAPP-BAILEYS',
    rejectCall: true,
    readMessages: true,
    readStatus: true,
    alwaysOnline: true,
    ...payload,
  };
  const { data } = await http.post('/instance/create', body);
  return data;
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
export async function evoSendText({ instanceName, to, text }) {
  const number = normalizePhone(to);
  if (!number) throw new Error('Telefone inválido');

  const attempts = [
    { url: '/message/sendText', body: { instanceName, to: number, text } },
    { url: '/message/send',     body: { instanceName, number, message: text } },
    // alguns builds aceitam rota por path da instância:
    { url: `/message/sendText/${encodeURIComponent(instanceName)}`, body: { number, text } },
  ];

  let last;
  for (const a of attempts) {
    try {
      const { data } = await http.post(a.url, a.body);
      return data;
    } catch (e) {
      last = e;
      // habilite logs se precisar:
      // console.error('evoSendText fail @', a.url, e.response?.status, e.response?.data || e.message);
      continue;
    }
  }
  throw last || new Error('Falha ao enviar mensagem (Evolution)');
}

export { normalizePhone };

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
      const { data } = await http.post(a.url, a.body);
      return data;
    } catch (e) { last = e; }
  }
  throw last || new Error('Falha ao enviar localização (Evolution)');
}