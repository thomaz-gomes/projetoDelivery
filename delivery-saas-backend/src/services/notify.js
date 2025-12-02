import { prisma } from '../prisma.js';
import { evoSendText, evoSendLocation, normalizePhone } from '../wa.js';
import { evoGetStatus } from '../wa.js';

function fmtCurrency(v) {
  return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// extrai coordenadas do payload do iFood (ou do model) e valida
function extractCoords(order) {
  const p = order?.payload?.delivery?.deliveryAddress?.coordinates || {};
  const latP = Number(p.latitude);
  const lngP = Number(p.longitude);
  if (Number.isFinite(latP) && Number.isFinite(lngP)) {
    return { lat: latP, lng: lngP };
  }
  // fallback: campos do model (preenchidos pelo webhook)
  const lat = Number(order.latitude);
  const lng = Number(order.longitude);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    return { lat, lng };
  }
  return { lat: null, lng: null };
}

function buildAddress(order) {
  const addr = order?.payload?.delivery?.deliveryAddress || {};
  const parts = [
    addr.formattedAddress,
    [addr.streetName, addr.streetNumber].filter(Boolean).join(', '),
    addr.complement,
    addr.neighborhood,
    addr.city,
    addr.state,
    addr.postalCode,
  ].filter(Boolean);
  const seen = new Set();
  return parts.filter(p => {
    const k = String(p).trim().toLowerCase();
    if (seen.has(k)) return false; seen.add(k); return true;
  }).join(' - ');
}

function buildMapsLinkFromCoords(lat, lng) {
  return `https://www.google.com/maps?q=${encodeURIComponent(`${lat},${lng}`)}`;
}

function buildMapsLinkFallback(order) {
  const addr = buildAddress(order) || order.address || '';
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}`;
}

async function pickConnectedInstance(companyId) {
  let inst = await prisma.whatsAppInstance.findFirst({
    where: { companyId, status: 'CONNECTED' },
    orderBy: { createdAt: 'desc' },
  });
  if (inst) return inst;

  const all = await prisma.whatsAppInstance.findMany({ where: { companyId } });
  for (const i of all) {
    try {
      const st = await evoGetStatus(i.instanceName);
      if (st?.status) {
        await prisma.whatsAppInstance.update({
          where: { instanceName: i.instanceName },
          data: { status: st.status },
        });
        if (st.status === 'CONNECTED') inst = i;
      }
    } catch { /* ignore */ }
  }
  if (inst?.status !== 'CONNECTED') {
    inst = await prisma.whatsAppInstance.findFirst({
      where: { companyId, status: 'CONNECTED' },
      orderBy: { createdAt: 'desc' },
    });
  }
  return inst;
}

export async function notifyRiderAssigned(orderId, { overridePhone } = {}) {
  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { rider: true, company: true },
    });
    if (!order) return;

    const inst = await pickConnectedInstance(order.companyId);
    if (!inst) {
      console.warn('[notifyRiderAssigned] Sem instância CONNECTED para company', order.companyId);
      return;
    }

    const phone = normalizePhone(overridePhone || order.rider?.whatsapp);
    if (!phone) {
      console.warn('[notifyRiderAssigned] Sem telefone do entregador para order', order.id);
      return;
    }

    const { lat, lng } = extractCoords(order);
    const addressText = buildAddress(order) || order.address || '-';

    // Mensagem de texto com links
    const mapsLink = (Number.isFinite(lat) && Number.isFinite(lng))
      ? buildMapsLinkFromCoords(lat, lng)
      : buildMapsLinkFallback(order);

    const text =
`*Nova entrega atribuída* 🚀
Pedido: ${order.displayId || order.id.slice(0,6)}
Cliente: ${order.customerName || '-'}
Endereço: ${addressText}
Mapa: ${mapsLink}
Total: ${fmtCurrency(order.total?.orderAmount || order.total || 0)}`;

    await evoSendText({ instanceName: inst.instanceName, to: phone, text }).catch(e => {
      console.error('[notifyRiderAssigned] sendText erro:', e.response?.data || e.message);
    });

    // Tenta enviar um PIN de localização (se coords válidas)
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      await evoSendLocation({
        instanceName: inst.instanceName,
        to: phone,
        latitude: lat,
        longitude: lng,
        address: addressText,
      }).catch(e => {
        // nem toda build suporta; log e segue
        console.warn('[notifyRiderAssigned] sendLocation falhou (ok se não suportar):', e.response?.data || e.message);
      });
    }
  } catch (e) {
    console.error('[notifyRiderAssigned] erro:', e.response?.data || e.message || e);
  }
}

export async function notifyCustomerStatus(orderId, newStatus) {
  try {
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) return;

    const phone = normalizePhone(
      order.customerPhone ||
      order?.payload?.customer?.phone?.number || ''
    );
    if (!phone) return;

    const inst = await pickConnectedInstance(order.companyId);
    if (!inst) {
      console.warn('[notifyCustomerStatus] Sem instância CONNECTED para company', order.companyId);
      return;
    }

    const statusPt = {
      EM_PREPARO: 'em preparo',
      SAIU_PARA_ENTREGA: 'saiu para entrega',
      CONFIRMACAO_PAGAMENTO: 'confirmação de pagamento',
      CONCLUIDO: 'concluído',
      CANCELADO: 'cancelado',
    }[newStatus] || newStatus;

    const { lat, lng } = extractCoords(order);
    const mapsLink = (Number.isFinite(lat) && Number.isFinite(lng))
      ? buildMapsLinkFromCoords(lat, lng)
      : buildMapsLinkFallback(order);

    const text =
`Olá! Seu pedido ${order.displayId || order.id.slice(0,6)} está *${statusPt}*.
Acompanhe no mapa: ${mapsLink}`;

    await evoSendText({ instanceName: inst.instanceName, to: phone, text }).catch(e => {
      console.error('[notifyCustomerStatus] sendText erro:', e.response?.data || e.message);
    });

    // não enviamos location ao cliente por enquanto — mas dá pra habilitar de forma similar ao rider
  } catch (e) {
    console.error('[notifyCustomerStatus] erro:', e.response?.data || e.message || e);
  }
}