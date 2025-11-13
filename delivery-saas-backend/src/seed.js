// src/seed.js
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Iniciando seed...');

  // 1) Empresa
  const company = await prisma.company.upsert({
    where: { id: 'bd6a5381-6b90-4cc9-bc8f-24890c491693' },
    update: {},
    create: {
      id: 'bd6a5381-6b90-4cc9-bc8f-24890c491693',
      name: 'Minha Loja de Testes',
    },
  });

  // 2) Usuário ADMIN
  const adminEmail = 'admin@example.com';
  const adminPass = 'admin123';
  const adminHash = await bcrypt.hash(adminPass, 10);

  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      role: 'ADMIN',
      name: 'Administrador',
      email: adminEmail,
      password: adminHash,
      companyId: company.id,
    },
  });

  // 3) Rider (opcional)
  const rider = await prisma.rider.upsert({
    where: { id: 'rider-demo-1' },
    update: {},
    create: {
      id: 'rider-demo-1',
      companyId: company.id,
      name: 'Entregador Demo',
      whatsapp: '55999999999',
      dailyRate: '50.00',
      active: true,
    },
  });

  // 4) Configuração de Impressora (PrinterSetting)
  const printer = await prisma.printerSetting.upsert({
    where: { companyId: company.id },
    update: {
      interface: 'printer:EPSON',
      type: 'EPSON',
      width: 48,
      headerName: 'Minha Loja de Testes',
      headerCity: 'São Paulo',
    },
    create: {
      companyId: company.id,
      interface: 'printer:EPSON',
      type: 'EPSON',
      width: 48,
      headerName: 'Minha Loja de Testes',
      headerCity: 'São Paulo',
    },
  });

  // 5) Integração iFood (ApiIntegration)
  // clientId/clientSecret podem ser sobrescritos depois via /integrations/IFOOD
  const ifood = await prisma.apiIntegration.upsert({
    where: { companyId_provider: { companyId: company.id, provider: 'IFOOD' } },
    update: {},
    create: {
      companyId: company.id,
      provider: 'IFOOD',
      clientId: process.env.IFOOD_CLIENT_ID || 'sandbox_client_id',
      clientSecret: process.env.IFOOD_CLIENT_SECRET || 'sandbox_secret',
      merchantId: process.env.IFOOD_MERCHANT_ID || 'sandbox_merchant',
      enabled: true,
      authMode: 'AUTH_CODE',
      linkCode: null,
      codeVerifier: null,
      authCode: null,
      accessToken: null,
      refreshToken: null,
      tokenType: null,
      tokenExpiresAt: null,
    },
  });

  // 6) Customer + Address (para pedidos de exemplo)
  const customer = await prisma.customer.upsert({
    where: { id: 'cust-demo-1' },
    update: {},
    create: {
      id: 'cust-demo-1',
      companyId: company.id,
      fullName: 'João da Silva',
      cpf: null,
      whatsapp: '11987654321',
      phone: '11987654321',
      addresses: {
        create: [
          {
            label: 'Casa',
            street: 'Rua dos Testes',
            number: '123',
            neighborhood: 'Centro',
            city: 'São Paulo',
            state: 'SP',
            postalCode: '01000000',
            formatted: 'Rua dos Testes, 123 - Centro - São Paulo/SP',
            isDefault: true,
            latitude: -23.55052,
            longitude: -46.633308,
          },
        ],
      },
    },
  });

  // 7) Pedidos de exemplo
  // Observação: campos Decimal devem ser strings; Prisma converte corretamente para DECIMAL
  const order1 = await prisma.order.upsert({
    where: { externalId: 'ORD-TEST-123456' },
    update: {},
    create: {
      companyId: company.id,
      externalId: 'ORD-TEST-123456',
      displayId: 'XPTO-987',
      status: 'EM_PREPARO',
      customerName: customer.fullName,
      customerPhone: customer.whatsapp,
      customerId: customer.id,
      address: 'Rua dos Testes, 123 - Centro - São Paulo/SP',
      latitude: -23.55052,
      longitude: -46.633308,
      total: '34.90',
      deliveryFee: '5.99',
      payload: {
        source: 'SEED',
        type: 'SAMPLE',
      },
      items: {
        create: [
          { name: 'X-Salada', quantity: 1, price: '18.50' },
          { name: 'Batata Média', quantity: 1, price: '9.90' },
        ],
      },
      histories: {
        create: [{ from: null, to: 'EM_PREPARO', reason: 'Seed inicial' }],
      },
    },
  });

  const order2 = await prisma.order.upsert({
    where: { externalId: 'ORD-TEST-654321' },
    update: {},
    create: {
      companyId: company.id,
      externalId: 'ORD-TEST-654321',
      displayId: 'XPTO-123',
      status: 'SAIU_PARA_ENTREGA',
      customerName: customer.fullName,
      customerPhone: customer.whatsapp,
      customerId: customer.id,
      address: 'Rua dos Testes, 123 - Centro - São Paulo/SP',
      total: '59.00',
      deliveryFee: '0',
      payload: { source: 'SEED', type: 'SAMPLE' },
      riderId: rider.id,
      items: {
        create: [
          { name: 'Pizza Calabresa Média', quantity: 1, price: '42.00' },
          { name: 'Refrigerante Lata', quantity: 1, price: '7.00' },
          { name: 'Taxa de Serviço', quantity: 1, price: '10.00' },
        ],
      },
      histories: {
        create: [
          { from: null, to: 'EM_PREPARO', reason: 'Seed inicial' },
          { from: 'EM_PREPARO', to: 'SAIU_PARA_ENTREGA', reason: 'Seed inicial' },
        ],
      },
    },
  });

  console.log('✅ Seed concluído com sucesso!');
  console.log('🔑 Admin:', admin.email, '/', adminPass);
  console.log('🏢 Empresa:', company.name, company.id);
  console.log('🧾 Impressora:', printer.interface, '-', printer.type);
  console.log('🤝 iFood provider:', ifood.provider, 'enabled:', ifood.enabled);
  console.log('🧺 Pedidos criados:', order1.externalId, ',', order2.externalId);
}

main()
  .catch((e) => {
    console.error('❌ Erro no seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });