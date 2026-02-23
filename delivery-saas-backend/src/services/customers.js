// src/services/customer.js
import { prisma } from '../prisma.js';

// normaliza telefone → apenas dígitos; NÃO armazena DDI '55'.
// The DDI (country code) should be considered only when sending messages.
export function normalizePhone(n) {
  const digits = String(n || '').replace(/\D+/g, '');
  if (!digits) return '';
  // If caller provided a number with leading '55', strip it for storage.
  if (digits.startsWith('55')) return digits.slice(2);
  // Otherwise return digits as-is (do not auto-prepend any DDI).
  return digits;
}

function mapAddressFromPayload(payload) {
  const a = payload?.delivery?.deliveryAddress || {};
  // support either { coordinates: { latitude, longitude } } or top-level latitude/longitude
  const c = a.coordinates || {};
  const latRawRaw = (c && (c.latitude !== undefined && c.latitude !== null)) ? c.latitude : (a.latitude ?? null);
  const lngRawRaw = (c && (c.longitude !== undefined && c.longitude !== null)) ? c.longitude : (a.longitude ?? null);
  const latRaw = (latRawRaw === '' || latRawRaw === undefined) ? null : latRawRaw;
  const lngRaw = (lngRawRaw === '' || lngRawRaw === undefined) ? null : lngRawRaw;
  return {
    formatted: a.formattedAddress || a.formatted || null,
    street: a.streetName || a.street || null,
    number: a.streetNumber || a.number || null,
    complement: a.complement || a.complemento || null,
    neighborhood: a.neighborhood || a.neigh || null,
    reference: a.reference || a.referencePoint || a.referencia || null,
    observation: a.note || a.notes || a.observation || a.observacao || null,
    city: a.city || null,
    state: a.state || null,
    postalCode: a.postalCode || a.zip || null,
    country: a.country || 'BR',
    latitude: (latRaw === null) ? null : (Number.isFinite(Number(latRaw)) ? Number(latRaw) : null),
    longitude: (lngRaw === null) ? null : (Number.isFinite(Number(lngRaw)) ? Number(lngRaw) : null),
    isDefault: true,
  };
}

/**
 * Encontra cliente por CPF, senão por WhatsApp. Se não existir, cria.
 * Sempre dentro da mesma empresa (companyId).
 */
export async function findOrCreateCustomer({ companyId, fullName, cpf, whatsapp, phone, addressPayload, persistPhone = true, ifoodCustomerId = null }) {
  const cpfClean = cpf ? String(cpf).replace(/\D+/g, '') : null;
  const whatsappClean = normalizePhone(whatsapp);
  const phoneClean = normalizePhone(phone);
  const ifoodId = ifoodCustomerId ? String(ifoodCustomerId).trim() : null;

  async function getOrCreateBalcao() {
    // Return or create a default 'Balcão' customer for this company.
    let bal = await prisma.customer.findFirst({ where: { companyId, OR: [ { fullName: 'Balcão' }, { fullName: 'Balcao' }, { fullName: 'balcão' }, { fullName: 'balcao' } ] } });
    if (bal) return bal;
    try {
      bal = await prisma.customer.create({ data: { companyId, fullName: 'Balcão', whatsapp: null, phone: null } });
      return bal;
    } catch (err) {
      if (err?.code === 'P2002') {
        const existing = await prisma.customer.findFirst({ where: { companyId, OR: [ { fullName: 'Balcão' }, { fullName: 'Balcao' }, { fullName: 'balcão' }, { fullName: 'balcao' } ] } });
        if (existing) return existing;
      }
      throw err;
    }
  }

  function isBalcaoName(n) {
    if (!n) return false;
    const s = String(n).trim().toLowerCase();
    return ['balcão', 'balcao', 'balcao', 'balcao'].includes(s) || s === 'balcao' || s === 'balcão';
  }

  // Matching priority: 1) CPF 2) iFood customer id 3) Name 4) WhatsApp/phone
  let customer = null;
  if (cpfClean) {
    customer = await prisma.customer.findFirst({ where: { companyId, cpf: cpfClean } });
  }
  // 2) ifoodCustomerId
  if (!customer && ifoodId) {
    customer = await prisma.customer.findFirst({ where: { companyId, ifoodCustomerId: ifoodId } });
  }
  // 3) name
  if (!customer && fullName) {
    const nameTrim = String(fullName).trim();
    customer = await prisma.customer.findFirst({ where: { companyId, fullName: nameTrim } });
  }
  // 4) whatsapp/phone
  if (!customer && whatsappClean) {
    customer = await prisma.customer.findFirst({ where: { companyId, whatsapp: whatsappClean } });
  }

  // 3) cria se não houver
  if (!customer) {
    // If we don't have any identifying data (cpf, whatsapp) and either
    // the fullName is missing or explicitly 'Balcão', assign to the
    // per-company default 'Balcão' customer instead of creating a new
    // generic customer per order.
    if ((!cpfClean && !whatsappClean && !fullName) || (isBalcaoName(fullName) && !whatsappClean && !phoneClean)) {
      return await getOrCreateBalcao();
    }
    try {
      customer = await prisma.customer.create({
        data: {
          companyId,
          fullName: fullName || 'Cliente',
          cpf: cpfClean || null,
          ifoodCustomerId: ifoodId || null,
          whatsapp: persistPhone ? (whatsappClean || null) : null,
          phone: persistPhone ? (phoneClean || null) : null,
        },
      });
    } catch (err) {
      // handle unique constraint races (Prisma P2002). If another transaction created the
      // same customer concurrently, try to find it and return that instead of failing.
      if (err?.code === 'P2002') {
        const existing = await prisma.customer.findFirst({ where: { companyId, OR: [ { whatsapp: whatsappClean }, { cpf: cpfClean }, { ifoodCustomerId: ifoodId } ] } });
        if (existing) customer = existing;
        else throw err;
      } else throw err;
    }
  } else {
    // atualiza dados básicos se vierem (sem sobrescrever agressivamente)
    const patch = {};
    // Merge incoming info: prefer non-empty incoming values and update when different
    if (fullName && String(fullName).trim() && String(fullName).trim() !== String(customer.fullName || '').trim()) patch.fullName = String(fullName).trim();
    if (cpfClean && cpfClean !== customer.cpf) patch.cpf = cpfClean;
    // do not overwrite whatsapp/phone when persistPhone=false (e.g., iFood temporary numbers)
    if (persistPhone && whatsappClean && whatsappClean !== customer.whatsapp) patch.whatsapp = whatsappClean;
    if (persistPhone && phoneClean && phoneClean !== customer.phone) patch.phone = phoneClean;
    // ensure ifoodCustomerId is stored when available
    if (ifoodId && (!customer.ifoodCustomerId || customer.ifoodCustomerId !== ifoodId)) patch.ifoodCustomerId = ifoodId;
    if (Object.keys(patch).length) {
      try {
        customer = await prisma.customer.update({ where: { id: customer.id }, data: patch });
      } catch (e) {
        console.warn('Failed to merge customer data:', e?.message || e);
      }
    }
  }

  // 4) endereços: se vier payload de endereço, garanta um default (não duplica por formatted + cep + número)
  if (addressPayload) {
    const addr = mapAddressFromPayload(addressPayload);
    const exists = await prisma.customerAddress.findFirst({
      where: {
        customerId: customer.id,
        formatted: addr.formatted,
        postalCode: addr.postalCode,
        number: addr.number,
      },
    });
    if (!exists) {
      // zera default anterior?
      await prisma.customerAddress.updateMany({
        where: { customerId: customer.id, isDefault: true },
        data: { isDefault: false },
      }).catch(() => {});
      await prisma.customerAddress.create({
        data: { customerId: customer.id, ...addr },
      });
    }
  }

  return customer;
}

/** Upsert a partir do payload do iFood e retorna { customer, addressId? } */
export async function upsertCustomerFromIfood({ companyId, payload }) {
  const fullName = payload?.customer?.name || null;
  const cpf = payload?.customer?.documentNumber || null;
  // iFood provides temporary phone numbers; use for matching but do NOT persist
  const whatsapp = payload?.customer?.phone?.number || null;
  const ifoodCustomerId = payload?.customer?.id || null;
  const addressPayload = payload; // inteiro (mapAddress usa delivery.deliveryAddress)

  const customer = await findOrCreateCustomer({
    companyId,
    fullName,
    cpf,
    whatsapp,
    phone: whatsapp,
    addressPayload,
    persistPhone: false, // do not persist iFood phone on customer record
    ifoodCustomerId: ifoodCustomerId,
  });

  if (!customer) return { customer: null, addressId: null };

  // retorna também o endereço default
  const defaultAddr = await prisma.customerAddress.findFirst({
    where: { customerId: customer.id, isDefault: true },
  });

  return { customer, addressId: defaultAddr?.id || null };
}

// Normalize a variety of incoming payload shapes into a single deliveryAddress shape
export function normalizeDeliveryAddressFromPayload(payload) {
  try {
    try { console.log('normalizeDeliveryAddressFromPayload called - payload keys:', Object.keys(payload || {}).join(',')) } catch(e){}
    const a = mapAddressFromPayload(payload || {});
    return {
      formattedAddress: a.formatted || null,
      streetName: a.street || null,
      streetNumber: a.number || null,
      complement: a.complement || null,
      neighborhood: a.neighborhood || null,
      reference: a.reference || null,
      observation: a.observation || null,
      city: a.city || null,
      state: a.state || null,
      postalCode: a.postalCode || null,
      country: a.country || null,
      latitude: a.latitude ?? null,
      longitude: a.longitude ?? null,
    };
  } catch (e) {
    console.warn('normalizeDeliveryAddressFromPayload failed:', e?.message || e)
    return null;
  }
}
/**
 * Transactional variant: given an active Prisma transaction (tx), try to find or create
 * a Customer and CustomerAddress from a normalized payload. Returns { customerId, customer }
 * or null when no suitable data is present to create a customer.
 * This mirrors the matching priority used elsewhere: PHONE -> ADDRESS -> NAME -> CREATE
 */
export async function upsertCustomerFromPayloadTx(tx, { companyId, payload }) {
  const name = payload?.customer?.name ? String(payload.customer.name).trim() : null;
  const formatted = payload?.delivery?.deliveryAddress?.formattedAddress ? String(payload.delivery.deliveryAddress.formattedAddress).trim() : null;
  const lat = payload?.delivery?.deliveryAddress?.coordinates?.latitude ?? null;
  const lng = payload?.delivery?.deliveryAddress?.coordinates?.longitude ?? null;
  const phoneRaw = payload?.customer?.phones?.[0]?.number || payload?.customer?.phone || null;
  const phone = phoneRaw ? normalizePhone(phoneRaw) : null;

  function isBalcaoNameLocal(n) {
    if (!n) return false;
    const s = String(n).trim().toLowerCase();
    return s === 'balcão' || s === 'balcao';
  }

  // If this payload explicitly marks the order as pickup/balcao and there is
  // no name/phone, assign to the per-company default 'Balcão' using the
  // provided transaction so we don't create per-order generic customers.
  const resolvedOrderType = String(payload?.orderType || payload?.order_type || '').toUpperCase();
  // Also, if the name itself is 'Balcão' (or variants) and phone is missing,
  // treat it as an unidentified pickup and assign to the default Balcão customer.
  if (isBalcaoNameLocal(name) && !phone) {
    let bal = await tx.customer.findFirst({ where: { companyId, OR: [ { fullName: 'Balcão' }, { fullName: 'Balcao' }, { fullName: 'balcão' }, { fullName: 'balcao' } ] } });
    if (!bal) {
      try {
        bal = await tx.customer.create({ data: { companyId, fullName: 'Balcão', whatsapp: null, phone: null } });
      } catch (err) {
        if (err?.code === 'P2002') {
          bal = await tx.customer.findFirst({ where: { companyId, OR: [ { fullName: 'Balcão' }, { fullName: 'Balcao' }, { fullName: 'balcão' }, { fullName: 'balcao' } ] } });
        } else throw err;
      }
    }
    return { customerId: bal.id, customer: bal };
  }

  if (['PICKUP', 'PICK-UP', 'BALCAO', 'BALCÃO', 'RETIRADA'].includes(resolvedOrderType)) {
    if (!name && !phone) {
      // transactional get-or-create for 'Balcão'
      let bal = await tx.customer.findFirst({ where: { companyId, OR: [ { fullName: 'Balcão' }, { fullName: 'Balcao' }, { fullName: 'balcão' }, { fullName: 'balcao' } ] } });
      if (!bal) {
        try {
          bal = await tx.customer.create({ data: { companyId, fullName: 'Balcão', whatsapp: null, phone: null } });
        } catch (err) {
          if (err?.code === 'P2002') {
            bal = await tx.customer.findFirst({ where: { companyId, OR: [ { fullName: 'Balcão' }, { fullName: 'Balcao' }, { fullName: 'balcão' }, { fullName: 'balcao' } ] } });
          } else throw err;
        }
      }
      return { customerId: bal.id, customer: bal };
    }
  }

  // 1) match by phone (whatsapp or phone)
  if (phone) {
    const foundByPhone = await tx.customer.findFirst({ where: { companyId, OR: [{ whatsapp: phone }, { phone: phone }] } });
    if (foundByPhone) {
      // ensure address exists
      if (formatted) {
        const existsAddr = await tx.customerAddress.findFirst({ where: { formatted, customerId: foundByPhone.id } });
        if (!existsAddr) {
          await tx.customerAddress.create({ data: { customerId: foundByPhone.id, formatted, latitude: lat ?? null, longitude: lng ?? null } }).catch(() => {});
        }
      }
      return { customerId: foundByPhone.id, customer: foundByPhone };
    }
  }

  // 2) match by formatted address
  if (formatted) {
    const existingAddr = await tx.customerAddress.findFirst({ where: { formatted }, include: { customer: true } });
    if (existingAddr) {
      // if customer lacks phone, try to set it
      if (phone && (!existingAddr.customer.whatsapp && !existingAddr.customer.phone)) {
        await tx.customer.update({ where: { id: existingAddr.customerId }, data: { whatsapp: phone } }).catch(() => {});
      }
      return { customerId: existingAddr.customerId, customer: existingAddr.customer };
    }
  }

  // 3) match by name (case-insensitive)
  if (name) {
    const found = await tx.customer.findFirst({ where: { companyId, fullName: name } });
    if (found) {
      if (formatted) {
        const existsAddr = await tx.customerAddress.findFirst({ where: { formatted, customerId: found.id } });
        if (!existsAddr) {
          await tx.customerAddress.create({ data: { customerId: found.id, formatted, latitude: lat ?? null, longitude: lng ?? null } }).catch(() => {});
        }
      }
      if (phone && (!found.whatsapp && !found.phone)) {
        await tx.customer.update({ where: { id: found.id }, data: { whatsapp: phone } }).catch(() => {});
      }
      return { customerId: found.id, customer: found };
    }
  }

  // 4) create when we have at least a name or phone
  if (name || phone) {
    let created;
    try {
      created = await tx.customer.create({ data: { companyId, fullName: name || 'Importado', whatsapp: phone ?? null, phone: phone ?? null } });
    } catch (err) {
      // inside transaction: handle unique constraint (another tx may have created concurrently)
      if (err?.code === 'P2002') {
        const found = await tx.customer.findFirst({ where: { companyId, OR: [ { whatsapp: phone }, { cpf: null } ] } });
        if (found) {
          // ensure address
          if (formatted) {
            try { await tx.customerAddress.create({ data: { customerId: found.id, formatted, latitude: lat ?? null, longitude: lng ?? null } }); } catch(_){}
          }
          return { customerId: found.id, customer: found };
        }
        throw err;
      } else throw err;
    }
    if (formatted) {
      try { await tx.customerAddress.create({ data: { customerId: created.id, formatted, latitude: lat ?? null, longitude: lng ?? null } }); } catch(_){}
    }
    return { customerId: created.id, customer: created };
  }

  return null;
}

// Build a compact, human-friendly concatenated address string for storing in
// the `order.address` field. Uses the normalized delivery address when
// available and falls back to formattedAddress when possible.
export function buildConcatenatedAddress(payload) {
  try {
    const n = normalizeDeliveryAddressFromPayload(payload) || {};
    const parts = [];
    if (n.formattedAddress) parts.push(n.formattedAddress);
    else if (n.streetName || n.streetNumber) parts.push([n.streetName || '', n.streetNumber || ''].filter(Boolean).join(' ').trim());
    if (n.complement) parts.push(n.complement);
    if (n.neighborhood) parts.push(n.neighborhood);
    if (n.reference) parts.push(`ref: ${n.reference}`);
    if (n.observation) parts.push(`obs: ${n.observation}`);
    // append city/state/postalCode for additional context
    const cityParts = [n.city, n.state, n.postalCode].filter(Boolean).join(' ');
    if (cityParts) parts.push(cityParts);
    const joined = parts.filter(Boolean).join(', ').trim();
    return joined || null;
  } catch (e) {
    return null;
  }
}