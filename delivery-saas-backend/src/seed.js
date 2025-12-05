import bcrypt from 'bcryptjs'
import ensureDatabaseUrl from './configureDatabaseEnv.js'
import { PrismaClient } from '@prisma/client'
import fs from 'fs'
import path from 'path'

ensureDatabaseUrl()
const prisma = new PrismaClient()

async function createDemoData() {
  console.log('🌱 Running comprehensive seed...')

  // Create or update demo company
  const companyId = 'bd6a5381-6b90-4cc9-bc8f-24890c491693'
  const company = await prisma.company.upsert({
    where: { id: companyId },
    update: { name: 'Minha Loja de Testes' },
    create: { id: companyId, name: 'Minha Loja de Testes', slug: 'minha-loja-de-testes' }
  })

  // Store
  const store = await prisma.store.upsert({
    where: { slug: 'minha-loja-de-testes-store' },
    update: { name: 'Minha Loja de Testes - Loja 1', companyId: company.id },
    create: { slug: 'minha-loja-de-testes-store', name: 'Minha Loja de Testes - Loja 1', companyId: company.id, address: 'Rua dos Testes, 123' }
  })

  // Ensure company's pickupInfo reflects the store address (avoid mocked pickup text)
  try{
    const storeAddress = store.address || '';
    if(storeAddress){
      await prisma.company.update({ where: { id: company.id }, data: { pickupInfo: storeAddress } }).catch(()=>{})
    }
  }catch(e){ /* ignore seed update errors */ }

  // Admin user (hashed)
  const adminEmail = 'admin@example.com'
  const adminPass = 'admin123'
  const adminHash = await bcrypt.hash(adminPass, 10)
  await prisma.user.upsert({ where: { email: adminEmail }, update: { name: 'Administrador', role: 'ADMIN', companyId: company.id, password: adminHash }, create: { email: adminEmail, name: 'Administrador', role: 'ADMIN', password: adminHash, companyId: company.id } })

  // Printer setting
  await prisma.printerSetting.upsert({ where: { companyId: company.id }, update: { interface: 'printer:EPSON', type: 'EPSON', width: 48, headerName: 'Minha Loja de Testes', headerCity: 'São Paulo' }, create: { companyId: company.id, interface: 'printer:EPSON', type: 'EPSON', width: 48, headerName: 'Minha Loja de Testes', headerCity: 'São Paulo' } })

  // Payment methods
  await prisma.paymentMethod.upsert({ where: { code: 'PIX' }, update: { name: 'PIX', isActive: true, companyId: company.id }, create: { companyId: company.id, name: 'PIX', code: 'PIX', isActive: true } }).catch(()=>{})
  await prisma.paymentMethod.upsert({ where: { code: 'CASH' }, update: { name: 'Dinheiro', isActive: true, companyId: company.id }, create: { companyId: company.id, name: 'Dinheiro', code: 'CASH', isActive: true } }).catch(()=>{})

  // Menu
  const menu = await prisma.menu.upsert({ where: { slug: 'main-menu' }, update: { name: 'Cardápio Principal', storeId: store.id }, create: { slug: 'main-menu', name: 'Cardápio Principal', storeId: store.id } })

  // Categories
  const categories = []
  for (let i = 1; i <= 5; i++) {
    const name = `Categoria ${i}`
    let cat = await prisma.menuCategory.findFirst({ where: { companyId: company.id, menuId: menu.id, name } })
    if (cat) {
      cat = await prisma.menuCategory.update({ where: { id: cat.id }, data: { position: i } })
    } else {
      cat = await prisma.menuCategory.create({ data: { companyId: company.id, menuId: menu.id, name, position: i } })
    }
    categories.push(cat)
  }

  // Products
  for (const cat of categories) {
    const prods = []
    for (let p = 1; p <= 6; p++) {
      prods.push({ companyId: company.id, menuId: menu.id, categoryId: cat.id, name: `${cat.name} Item ${p}`, price: String((Math.random() * 40 + 10).toFixed(2)), position: p })
    }
    await prisma.product.createMany({ data: prods, skipDuplicates: true }).catch(()=>{})
  }

  // Option groups and options
  let addons = await prisma.optionGroup.findFirst({ where: { companyId: company.id, name: 'Adicionais' } })
  if (!addons) addons = await prisma.optionGroup.create({ data: { companyId: company.id, name: 'Adicionais', min: 0, max: 5 } })
  await prisma.option.createMany({ data: [ { groupId: addons.id, name: 'Queijo extra', price: '3.50', position: 1 }, { groupId: addons.id, name: 'Bacon', price: '4.50', position: 2 } ] }).catch(()=>{})

  let sizes = await prisma.optionGroup.findFirst({ where: { companyId: company.id, name: 'Tamanhos' } })
  if (!sizes) sizes = await prisma.optionGroup.create({ data: { companyId: company.id, name: 'Tamanhos', min: 1, max: 1 } })
  await prisma.option.createMany({ data: [ { groupId: sizes.id, name: 'Pequeno', price: '0.00', position: 1 }, { groupId: sizes.id, name: 'Médio', price: '6.00', position: 2 }, { groupId: sizes.id, name: 'Grande', price: '10.00', position: 3 } ] }).catch(()=>{})

  // Customer
  const customer = await prisma.customer.upsert({ where: { id: 'cust-demo-1' }, update: { fullName: 'João da Silva' }, create: { id: 'cust-demo-1', companyId: company.id, fullName: 'João da Silva', whatsapp: '11987654321', phone: '11987654321' } }).catch(()=>null)
  try { if (customer) await prisma.address.create({ data: { companyId: company.id, customerId: customer.id, label: 'Casa', street: 'Rua dos Testes', number: '123', neighborhood: 'Centro', city: 'São Paulo', state: 'SP', postalCode: '01000000', formatted: 'Rua dos Testes, 123 - Centro - São Paulo/SP', isDefault: true, latitude: -23.55052, longitude: -46.633308 } }) } catch(e){}

  // Rider
  await prisma.rider.upsert({ where: { id: 'rider-demo-1' }, update: { name: 'Entregador Demo' }, create: { id: 'rider-demo-1', companyId: company.id, name: 'Entregador Demo', whatsapp: '55999999999', dailyRate: '50.00', active: true } }).catch(()=>{})

  // Sample orders (create with nested items)
  try {
    await prisma.order.create({ data: {
      companyId: company.id,
      externalId: 'ORD-TEST-123456',
      displayId: 'XPTO-987',
      status: 'EM_PREPARO',
      customerName: customer?.fullName || 'Cliente Demo',
      customerPhone: customer?.whatsapp || '11987654321',
      customerId: customer?.id || null,
      address: 'Rua dos Testes, 123 - Centro - São Paulo/SP',
      latitude: -23.55052,
      longitude: -46.633308,
      total: '34.90',
      deliveryFee: '5.99',
      payload: { source: 'SEED', type: 'SAMPLE' },
      items: { create: [ { name: 'X-Salada', quantity: 1, price: '18.50' }, { name: 'Batata Média', quantity: 1, price: '9.90' } ] },
      histories: { create: [ { from: null, to: 'EM_PREPARO', reason: 'Seed inicial' } ] }
    } }).catch(()=>{})
  } catch (e) { console.warn('order create failed', e && e.message) }

  console.log('✅ Seed completed: company, store, user, menu, categories, products, options, sample orders created')
}

createDemoData()
  .catch((e) => { console.error('Seed failed:', e); process.exit(1) })
  .finally(async () => { await prisma.$disconnect() })
