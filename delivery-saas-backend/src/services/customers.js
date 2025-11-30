// src/services/customer.js
import { prisma } from '../prisma.js';

// normaliza telefone → apenas dígitos + garante DDI 55 se parecer BR
export function normalizePhone(n) {
  const digits = String(n || '').replace(/\D+/g, '');
  if (!digits) return '';
  // se já tiver 55 e tiver tamanho plausível, mantém
  if (digits.startsWith('55')) return digits;
  // se tiver tamanho de celular BR (10~11) adiciona 55
  if (digits.length >= 10 && digits.length <= 11) return '55' + digits;
  return digits;
}

function mapAddressFromPayload(payload) {
  const a = payload?.delivery?.deliveryAddress || {};
  const c = a.coordinates || {};
  return {
    formatted: a.formattedAddress || null,
    street: a.streetName || null,
    number: a.streetNumber || null,
    complement: a.complement || null,
    neighborhood: a.neighborhood || null,
    city: a.city || null,
    state: a.state || null,
    postalCode: a.postalCode || null,
    country: a.country || 'BR',
    latitude: Number.isFinite(Number(c.latitude)) ? Number(c.latitude) : null,
    longitude: Number.isFinite(Number(c.longitude)) ? Number(c.longitude) : null,
    isDefault: true,
  };
}

/**
 * Encontra cliente por CPF, senão por WhatsApp. Se não existir, cria.
 * Sempre dentro da mesma empresa (companyId).
 */
export async function findOrCreateCustomer({ companyId, fullName, cpf, whatsapp, phone, addressPayload }) {
  const cpfClean = cpf ? String(cpf).replace(/\D+/g, '') : null;
  const whatsappClean = normalizePhone(whatsapp);
  const phoneClean = normalizePhone(phone);

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

  // 1) tenta CPF
  let customer = null;
  if (cpfClean) {
    customer = await prisma.customer.findFirst({ where: { companyId, cpf: cpfClean } });
  }
  // 2) tenta WhatsApp
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
          whatsapp: whatsappClean || null,
          phone: phoneClean || null,
        },
      });
    } catch (err) {
      // handle unique constraint races (Prisma P2002). If another transaction created the
      // same customer concurrently, try to find it and return that instead of failing.
      if (err?.code === 'P2002') {
        const existing = await prisma.customer.findFirst({ where: { companyId, OR: [ { whatsapp: whatsappClean }, { cpf: cpfClean } ] } });
        if (existing) customer = existing;
        else throw err;
      } else throw err;
    }
  } else {
    // atualiza dados básicos se vierem (sem sobrescrever agressivamente)
    const patch = {};
    if (fullName && !customer.fullName) patch.fullName = fullName;
    if (cpfClean && !customer.cpf) patch.cpf = cpfClean;
    if (whatsappClean && !customer.whatsapp) patch.whatsapp = whatsappClean;
    if (phoneClean && !customer.phone) patch.phone = phoneClean;
    if (Object.keys(patch).length) {
      customer = await prisma.customer.update({ where: { id: customer.id }, data: patch });
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
  const whatsapp = payload?.customer?.phone?.number || null;
  const addressPayload = payload; // inteiro (mapAddress usa delivery.deliveryAddress)

  const customer = await findOrCreateCustomer({
    companyId,
    fullName,
    cpf,
    whatsapp,
    phone: whatsapp,
    addressPayload,
  });

  if (!customer) return { customer: null, addressId: null };

  // retorna também o endereço default
  const defaultAddr = await prisma.customerAddress.findFirst({
    where: { customerId: customer.id, isDefault: true },
  });

  return { customer, addressId: defaultAddr?.id || null };
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