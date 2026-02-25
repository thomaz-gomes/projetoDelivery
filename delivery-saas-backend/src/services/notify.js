import { prisma } from '../prisma.js';
import { evoSendText, evoSendLocation, normalizePhone } from '../wa.js';
import { evoGetStatus } from '../wa.js';

// Previously we gated customer notifications behind ENABLE_IFOOD_WHATSAPP_NOTIFICATIONS.
// To ensure customers reliably receive messages for created/updated orders,
// notifications will attempt delivery when a connected WhatsApp instance exists
// and a valid customer phone is present. Toggle can still be controlled by
// disabling Evolution integration entirely (`EVOLUTION_ENABLED=false`).

function fmtCurrency(v) {
  return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// extrai coordenadas do payload do iFood (ou do model) e valida
function extractCoords(order) {
  const p = order?.payload?.delivery?.deliveryAddress?.coordinates || {};
  const latP = Number(p.latitude);
  const lngP = Number(p.longitude);
  if (Number.isFinite(latP) && Number.isFinite(lngP)) {
    // treat 0,0 as missing coordinates (some providers use 0,0 as placeholder)
    if (latP === 0 && lngP === 0) return { lat: null, lng: null };
    return { lat: latP, lng: lngP };
  }
  // fallback: campos do model (preenchidos pelo webhook)
  const lat = Number(order.latitude);
  const lng = Number(order.longitude);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    if (lat === 0 && lng === 0) return { lat: null, lng: null };
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

async function formatDisplayNumber(order) {
  // Prefer persisted or computed `displaySimple` (numeric short visual id),
  // format as #09 when available. If missing, compute a stable short number
  // by counting orders created up to this one on the same day.
  try {
    if (!order) return '';
    if (order.displaySimple != null && order.displaySimple !== '') {
      const s = String(order.displaySimple).padStart(2, '0');
      return `#${s}`;
    }
    if (order.displayId != null && order.displayId !== '') {
      return `#${String(order.displayId)}`;
    }

    // Try to compute displaySimple from DB when we have companyId and createdAt
    if (order.companyId && order.createdAt) {
      try {
        const d = new Date(order.createdAt);
        const startOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
        const count = await prisma.order.count({ where: { companyId: order.companyId, createdAt: { gte: startOfDay, lte: d } } });
        const s = String(count).padStart(2, '0');
        return `#${s}`;
      } catch (e) {
        // ignore and fallback
      }
    }

    if (order.id) return `#${String(order.id).slice(0,6)}`;
    return '';
  } catch (e) { return String(order.id || '').slice(0,6); }
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
      include: { rider: true, company: true, customer: true },
    });
    if (!order) return;

    // Respect company-level evolution toggle: if disabled, do not send notifications
    if (!order.company || !order.company.evolutionEnabled) {
      console.log('[notifyRiderAssigned] Evolution notifications disabled for company', order.companyId);
      return;
    }

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
    const locator = order?.payload?.delivery?.deliveryAddress?.reference || '';

    // Mensagem de texto com link para Google Maps (coords primeiro, fallback endereço)
    const mapsLink = (Number.isFinite(lat) && Number.isFinite(lng))
      ? buildMapsLinkFromCoords(lat, lng)
      : (addressText && addressText !== '-' ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addressText)}` : '-');

    // Forma de pagamento (vários campos possíveis conforme payload/db)
    const paymentMethod = order?.payment?.method || order?.payment?.methodCode || order?.payload?.payment?.method || order?.payload?.payment?.methodCode || '';

    // Telefone a ser mostrado ao motoboy; se pedido vier do iFood, mostrar 0800
    const maybeSource = String(order.source || order.integration || order?.payload?.source || '').toLowerCase();
    const isIfood = maybeSource.includes('ifood') || Boolean(order?.payload?.ifood);
    // Build contact string for rider: always show 0800 for iFood orders,
    // but also include the customer's WhatsApp when available so the
    // rider can contact the customer directly if needed.
    const custWhatsapp = (order.customer && order.customer.whatsapp) || order.customerPhone || order?.payload?.customer?.phone?.number || '';
    const parts = [];
    if (isIfood) parts.push('0800');
    if (custWhatsapp) parts.push(custWhatsapp);
    const contactToShow = parts.length ? parts.join(' - ') : '-';

      const orderLabel = (await formatDisplayNumber(order)) || (order.displayId || order.id.slice(0,6));
      const text =
  `*🚨 Nova entrega atribuída* 🚀

  *Pedido:* ${orderLabel}
  *Cliente:* ${order.customerName || order.customerFullName || '-'}
  *Endereço:* ${addressText}
  *Mapa:* ${mapsLink}
  *Localizador:* ${locator || '-'}
  *Pagamento:* ${paymentMethod || '-'}
  *Contato:* ${contactToShow}`;

    console.log('[notifyRiderAssigned] calling evoSendText', { instance: inst.instanceName, to: phone, snippet: String(text).slice(0,120) });
    await evoSendText({ instanceName: inst.instanceName, to: phone, text }).then(r => {
      console.log('[notifyRiderAssigned] evoSendText result', { instance: inst.instanceName, to: phone, result: (r && typeof r === 'object') ? JSON.stringify(r).slice(0,500) : String(r) });
    }).catch(e => {
      console.error('[notifyRiderAssigned] sendText erro:', e.response?.data || e.message || String(e));
    });

    // Tenta enviar um PIN de localização (se coords válidas)
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      console.log('[notifyRiderAssigned] calling evoSendLocation', { instance: inst.instanceName, to: phone, lat, lng });
      await evoSendLocation({
        instanceName: inst.instanceName,
        to: phone,
        latitude: lat,
        longitude: lng,
        address: addressText,
      }).then(r => {
        console.log('[notifyRiderAssigned] evoSendLocation result', { instance: inst.instanceName, to: phone, result: (r && typeof r === 'object') ? JSON.stringify(r).slice(0,500) : String(r) });
      }).catch(e => {
        // nem toda build suporta; log e segue
        console.warn('[notifyRiderAssigned] sendLocation falhou (ok se não suportar):', e.response?.data || e.message || String(e));
      });
    }
  } catch (e) {
    console.error('[notifyRiderAssigned] erro:', e.response?.data || e.message || e);
  }
}

export async function notifyCustomerStatus(orderId, newStatus) {
  try {
    const order = await prisma.order.findUnique({ where: { id: orderId }, include: { company: true, store: true } });
    if (!order) return;

    // Respect company-level evolution toggle: if disabled, do not send notifications
    if (!order.company || !order.company.evolutionEnabled) {
      console.log('[notifyCustomerStatus] Evolution notifications disabled for company', order.companyId);
      return;
    }

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
      CONFIRMACAO_PAGAMENTO: 'em confirmação de pagamento',
      CONCLUIDO: 'concluído',
      CANCELADO: 'cancelado',
    }[newStatus] || newStatus;

    const customerName = order.customerName || order.customerFullName || '';
    const shopName = (order.company && order.company.name) || (order.store && order.store.name) || 'sua loja';
      const shortId = (await formatDisplayNumber(order)) || order.displayId || String(order.id).slice(0,8);

    const { lat, lng } = extractCoords(order);

    const text =
  `Olá ${customerName || ''}, aqui é o atendente virtual do *${shopName}* 👋

  *Seu pedido foi atualizado:* *${statusPt}* 🎯

  Fique tranquilo(a) que vou enviar as atualizações do status do seu pedido por aqui. 😄

  *️⃣ Nº do pedido:* ${shortId}`;

    console.log('[notifyCustomerStatus] calling evoSendText', { instance: inst.instanceName, to: phone, snippet: String(text).slice(0,120) });
    await evoSendText({ instanceName: inst.instanceName, to: phone, text }).then(r => {
      console.log('[notifyCustomerStatus] evoSendText result', { instance: inst.instanceName, to: phone, result: (r && typeof r === 'object') ? JSON.stringify(r).slice(0,500) : String(r) });
    }).catch(e => {
      console.error('[notifyCustomerStatus] sendText erro:', e.response?.data || e.message || String(e));
    });

    // Not sending location PIN to customers by design — only riders receive PINs.
  } catch (e) {
    console.error('[notifyCustomerStatus] erro:', e.response?.data || e.message || e);
  }
}

export async function notifyCustomerOrderSummary(orderId) {
  // previously gated by ENABLE_IFOOD_WHATSAPP_NOTIFICATIONS; allow attempts
  // to send order summaries when a WhatsApp instance is available and the
  // order includes a customer phone number.
  try {
    const order = await prisma.order.findUnique({ where: { id: orderId }, include: { items: true, company: true, store: true } });
    if (!order) return;

    // Respect company-level evolution toggle: if disabled, do not send notifications
    if (!order.company || !order.company.evolutionEnabled) {
      console.log('[notifyCustomerOrderSummary] Evolution notifications disabled for company', order.companyId);
      return;
    }

    const phone = normalizePhone(
      order.customerPhone ||
      order?.payload?.customer?.phone?.number || ''
    );
    if (!phone) return;

    const inst = await pickConnectedInstance(order.companyId);
    if (!inst) {
      console.warn('[notifyCustomerOrderSummary] Sem instância CONNECTED para company', order.companyId);
      return;
    }

    const customerName = order.customerName || order.customerFullName || '';
    const shopName = (order.company && order.company.name) || (order.store && order.store.name) || 'sua loja';
      const shortId = (await formatDisplayNumber(order)) || order.displayId || String(order.id).slice(0,8);

    const lines = [];
    lines.push(`Olá ${customerName || ''}, aqui é o atendente virtual do *${shopName}* 👋`);
    lines.push('');
    lines.push('*✅ Pedido recebido e em preparo*');
    lines.push('Vim te avisar que seu pedido foi realizado com sucesso e já está em preparo.');
    lines.push('');
    lines.push('Fique tranquilo(a) que vou enviar as atualizações do status do seu pedido por aqui. 😄');
    lines.push('');
      lines.push(`*️⃣ Nº do pedido:* ${shortId}`);
    lines.push('');
    lines.push('*Itens:*');
    for (const it of order.items || []) {
      lines.push(`➡ *${it.quantity}x ${it.name}*`);
      if (it.notes) {
        const notes = String(it.notes).split('\n').map(s => s.trim()).filter(Boolean);
        for (const n of notes) lines.push(`-${n}`);
      }
      if (it.options && Array.isArray(it.options)) {
        for (const opt of it.options) {
          const on = opt.name || (opt.optionName) || null;
          if (on) lines.push(`- ${on}`);
        }
      }
    }

    // Order-level notes / obs
    const obs = order.notes || order.payload?.notes || order.payload?.rawPayload?.notes || null;
    if (obs) {
      lines.push('\n*OBS:* ' + String(obs));
    }

    // Payment method
    const paymentMethod = order?.payment?.method || order?.payment?.methodCode || order?.payload?.payment?.method || order?.payload?.payment?.methodCode || '';
    if (paymentMethod) lines.push('\n💸 *' + paymentMethod + '*');

    // ETA (best-effort)
    const eta = order.payload?.eta || order.payload?.estimatedDelivery || order.payload?.delivery?.estimatedTime || order.payload?.delivery?.timeWindow || null;
    if (eta) lines.push('\n🕢 *Tempo de entrega:* ' + String(eta));

    const addr = buildAddress(order) || order.address || '';
    if (addr) lines.push('\n🛵 *Local de entrega:* ' + addr);

    lines.push('\n*Total do pedido:* ' + fmtCurrency(order.total || 0));

    const text = lines.join('\n');

    console.log('[notifyCustomerOrderSummary] calling evoSendText', { instance: inst.instanceName, to: phone, snippet: String(text).slice(0,140) });
    await evoSendText({ instanceName: inst.instanceName, to: phone, text }).then(r => {
      console.log('[notifyCustomerOrderSummary] evoSendText result', { instance: inst.instanceName, to: phone, result: (r && typeof r === 'object') ? JSON.stringify(r).slice(0,500) : String(r) });
    }).catch(e => {
      console.error('[notifyCustomerOrderSummary] sendText erro:', e.response?.data || e.message || String(e));
    });
  } catch (e) {
    console.error('[notifyCustomerOrderSummary] erro:', e.response?.data || e.message || e);
  }
}