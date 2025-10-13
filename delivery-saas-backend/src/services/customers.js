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
    customer = await prisma.customer.create({
      data: {
        companyId,
        fullName: fullName || 'Cliente',
        cpf: cpfClean || null,
        whatsapp: whatsappClean || null,
        phone: phoneClean || null,
      },
    });
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

  // retorna também o endereço default
  const defaultAddr = await prisma.customerAddress.findFirst({
    where: { customerId: customer.id, isDefault: true },
  });

  return { customer, addressId: defaultAddr?.id || null };
}