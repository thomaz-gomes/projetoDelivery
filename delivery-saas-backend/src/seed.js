// src/seed.js
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

/** Helpers base */
async function ensureCompanyByName(name) {
  const found = await prisma.company.findFirst({ where: { name } });
  if (found) return found;
  return prisma.company.create({ data: { name } });
}

async function ensureAdmin({ companyId, email, password, name = 'Administrador' }) {
  const existing = await prisma.user.findUnique({ where: { email } }).catch(() => null);
  if (existing) return existing;
  const hash = await bcrypt.hash(password, 10);
  return prisma.user.create({
    data: { email, password: hash, name, role: 'ADMIN', companyId },
  });
}

async function ensureRiders(companyId) {
  const ridersData = [
    { name: 'João Entregador', whatsapp: '5599999999999', companyId, active: true },
    { name: 'Maria Motogirl',  whatsapp: '5598888888888', companyId, active: true },
  ];

  for (const r of ridersData) {
    const existing = await prisma.rider.findFirst({
      where: { companyId, name: r.name },
    });
    if (!existing) await prisma.rider.create({ data: r });
  }
  return prisma.rider.findMany({ where: { companyId } });
}

async function ensureCustomers(companyId) {
  // Clientes exemplo com endereço (Customer + CustomerAddress[])
  const list = [
    {
      fullName: 'Cliente Exemplo',
      cpf: '12345678901',
      whatsapp: '5597777777777',
      phone: '5597777777777',
      addresses: [
        {
          label: 'Casa',
          street: 'Rua Alfa',
          number: '100',
          neighborhood: 'Centro',
          city: 'Santa Maria',
          state: 'RS',
          postalCode: '97000-000',
          formatted: 'Rua Alfa, 100 - Centro, Santa Maria/RS',
          latitude: -29.686,
          longitude: -53.806,
          isDefault: true,
        },
      ],
    },
    {
      fullName: 'José da Silva',
      cpf: '98765432100',
      whatsapp: '5597666666666',
      phone: '5597666666666',
      addresses: [
        {
          label: 'Trabalho',
          street: 'Av. Beta',
          number: '200',
          neighborhood: 'Comercial',
          city: 'Santa Maria',
          state: 'RS',
          postalCode: '97010-000',
          formatted: 'Av. Beta, 200 - Comercial, Santa Maria/RS',
          latitude: -29.69,
          longitude: -53.80,
          isDefault: true,
        },
      ],
    },
  ];

  const created = {};
  for (const c of list) {
    let found = null;

    // tente chave única por CPF; se não houver unique no schema, usamos findFirst
    if (c.cpf) {
      found = await prisma.customer.findUnique({ where: { cpf: c.cpf } }).catch(() => null);
      if (!found) {
        found = await prisma.customer.findFirst({ where: { companyId, cpf: c.cpf } });
      }
    }
    if (!found && c.whatsapp) {
      found = await prisma.customer.findFirst({ where: { companyId, whatsapp: c.whatsapp } });
    }
    if (!found && c.phone) {
      found = await prisma.customer.findFirst({ where: { companyId, phone: c.phone } });
    }

    if (!found) {
      found = await prisma.customer.create({
        data: {
          companyId,
          fullName: c.fullName,
          cpf: c.cpf ?? null,
          whatsapp: c.whatsapp ?? null,
          phone: c.phone ?? null,
          addresses: {
            create: (c.addresses || []).map(a => ({
              label: a.label ?? null,
              street: a.street ?? null,
              number: a.number ?? null,
              neighborhood: a.neighborhood ?? null,
              city: a.city ?? null,
              state: a.state ?? null,
              postalCode: a.postalCode ?? null,
              formatted: a.formatted ?? null,
              latitude: a.latitude ?? null,
              longitude: a.longitude ?? null,
              isDefault: !!a.isDefault,
            })),
          },
        },
        include: { addresses: true },
      });
    }

    if (c.cpf === '12345678901') created.c1 = found;
    if (c.cpf === '98765432100') created.c2 = found;
  }

  return created;
}

async function ensureWaInstance(companyId) {
  // instanceName único
  return prisma.whatsAppInstance.upsert({
    where: { instanceName: 'loja01' },
    update: { },
    create: {
      companyId,
      instanceName: 'loja01',
      displayName: 'Loja 01',
      status: 'DISCONNECTED',
    },
  });
}

/**
 * Integração iFood (OAuth/PKCE) – upsert básico
 * Campos de fluxo OAuth (linkingCode, verifierCode, authCode, accessToken, refreshToken, tokenExpiresAt)
 * ficam nulos até o processo de vinculação ocorrer no frontend.
 */
async function ensureIFoodIntegration(companyId) {
  return prisma.apiIntegration.upsert({
    where: { companyId_provider: { companyId, provider: 'IFOOD' } },
    update: {
      clientId: process.env.IFOOD_CLIENT_ID || 'sandbox_client_id',
      clientSecret: process.env.IFOOD_CLIENT_SECRET || 'sandbox_secret',
      merchantId: process.env.IFOOD_MERCHANT_ID || 'sandbox_merchant',
      enabled: true,
      // deixe tokens/PKCE nulos aqui; serão preenchidos pelo fluxo de OAuth
      accessToken: null,
      refreshToken: null,
      tokenExpiresAt: null,
      linkCode: null,      // <- nome correto no schema
      codeVerifier: null,  // <- nome correto no schema
      tokenType: null,
    },
    create: {
      companyId,
      provider: 'IFOOD',
      clientId: process.env.IFOOD_CLIENT_ID || 'sandbox_client_id',
      clientSecret: process.env.IFOOD_CLIENT_SECRET || 'sandbox_secret',
      merchantId: process.env.IFOOD_MERCHANT_ID || 'sandbox_merchant',
      enabled: true,
      accessToken: null,
      refreshToken: null,
      tokenExpiresAt: null,
      linkCode: null,      // <- nome correto no schema
      codeVerifier: null,  // <- nome correto no schema
      tokenType: null,
    },
  });
}


async function createSampleOrder({ companyId, adminUserId, customer }) {
  // Usa os dados do cliente para precificar e definir localização
  const addr = customer?.addresses?.[0];

  return prisma.order.create({
    data: {
      companyId,
      displayId: 'XPTO-0001',
      status: 'EM_PREPARO',
      customerId: customer?.id ?? null,
      customerName: customer?.fullName ?? 'Cliente Walk-in',
      customerPhone: customer?.phone ?? customer?.whatsapp ?? null,
      address: addr?.formatted ?? 'Rua das Flores, 123 - Centro',
      latitude: addr?.latitude ?? -29.686,
      longitude: addr?.longitude ?? -53.806,
      total: 85.5,
      deliveryFee: 10,
      items: {
        create: [
          { name: 'Pizza Calabresa', quantity: 1, price: 45.5 },
          { name: 'Refrigerante 2L', quantity: 1, price: 8.0 },
        ],
      },
      histories: {
        create: [
          { from: null, to: 'EM_PREPARO', byUserId: adminUserId, reason: 'Seed inicial' },
        ],
      },
    },
    include: { items: true },
  });
}

async function main() {
  console.log('🌱 Iniciando seed...');

  // 1) Empresa
  const company = await ensureCompanyByName('Delivery XPTO');

  // 2) Admin
  const admin = await ensureAdmin({
    companyId: company.id,
    email: 'admin@example.com',
    password: 'admin123',
    name: 'Administrador',
  });

  // 3) Entregadores
  await ensureRiders(company.id);

  // 4) Clientes CRM
  const { c1 /*, c2*/ } = await ensureCustomers(company.id);

  // 5) Instância WhatsApp
  await ensureWaInstance(company.id);

  // 6) Integração iFood (somente credenciais base)
  await ensureIFoodIntegration(company.id);

  // 7) Pedido de exemplo
  const order = await createSampleOrder({
    companyId: company.id,
    adminUserId: admin.id,
    customer: c1,
  });

  console.log('✅ Seed concluído com sucesso!');
  console.log('   Empresa:', company.name);
  console.log('   Admin:  admin@example.com  / senha: admin123');
  console.log('   Pedido de exemplo:', order.displayId);
}

main()
  .catch((e) => {
    console.error('❌ Erro no seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });