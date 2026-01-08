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
    create: { slug: 'minha-loja-de-testes-store', name: 'Minha Loja de Testes - Loja 1', companyId: company.id, address: 'Rua dos Testes, 123', open24Hours: true }
  })

  // Create two more stores (open 24h) so we have 3 stores total for this company
  const store2 = await prisma.store.upsert({
    where: { slug: 'minha-loja-de-testes-store-2' },
    update: { name: 'Minha Loja de Testes - Loja 2', companyId: company.id },
    create: { slug: 'minha-loja-de-testes-store-2', name: 'Minha Loja de Testes - Loja 2', companyId: company.id, address: 'Av. Secundária, 45', open24Hours: true }
  })

  const store3 = await prisma.store.upsert({
    where: { slug: 'minha-loja-de-testes-store-3' },
    update: { name: 'Minha Loja de Testes - Loja 3', companyId: company.id },
    create: { slug: 'minha-loja-de-testes-store-3', name: 'Minha Loja de Testes - Loja 3', companyId: company.id, address: 'Praça Central, 9', open24Hours: true }
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
  await prisma.paymentMethod.upsert({ where: { code: 'CARD' }, update: { name: 'Cartão (crédito)', isActive: true, companyId: company.id }, create: { companyId: company.id, name: 'Cartão (crédito)', code: 'CARD', isActive: true } }).catch(()=>{})
  await prisma.paymentMethod.upsert({ where: { code: 'DEBIT' }, update: { name: 'Cartão (débito)', isActive: true, companyId: company.id }, create: { companyId: company.id, name: 'Cartão (débito)', code: 'DEBIT', isActive: true } }).catch(()=>{})

  // Cashback setting (enable cashback for the company)
  try{
    await prisma.cashbackSetting.upsert({ where: { companyId: company.id }, update: { enabled: true, defaultPercent: '5' }, create: { companyId: company.id, enabled: true, defaultPercent: '5' } })
  }catch(e){ /* ignore cashback seed errors */ }

  // Menu
  const menu = await prisma.menu.upsert({ where: { slug: 'main-menu' }, update: { name: 'Cardápio Principal', storeId: store.id }, create: { slug: 'main-menu', name: 'Cardápio Principal', storeId: store.id } })

  // Secondary menu for the same company (menu #2) attached to store2 (or fallback to store)
  const menu2 = await prisma.menu.upsert({ where: { slug: 'secondary-menu' }, update: { name: 'Cardápio Secundário', storeId: store2.id || store.id }, create: { slug: 'secondary-menu', name: 'Cardápio Secundário', storeId: store2.id || store.id } })

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

  // Create some categories for the secondary menu
  const categoriesMenu2 = [];
  const secCatNames = ['Lanches', 'Bebidas', 'Sobremesas'];
  for (let i = 0; i < secCatNames.length; i++) {
    const name = secCatNames[i]
    let cat = await prisma.menuCategory.findFirst({ where: { companyId: company.id, menuId: menu2.id, name } })
    if (cat) {
      cat = await prisma.menuCategory.update({ where: { id: cat.id }, data: { position: i + 1 } })
    } else {
      cat = await prisma.menuCategory.create({ data: { companyId: company.id, menuId: menu2.id, name, position: i + 1 } })
    }
    categoriesMenu2.push(cat)
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

  // Attach option groups to products to simulate a real menu (Tamanhos + Adicionais)
  try {
    const sampleProds = await prisma.product.findMany({ where: { companyId: company.id }, take: 40, orderBy: { createdAt: 'asc' } })
    for (const p of sampleProds) {
      // attach sizes to items that look like main dishes (heuristic: price > 10)
      if (p.price != null && Number(p.price) > 10) {
        const exists = await prisma.productOptionGroup.findFirst({ where: { productId: p.id, groupId: sizes.id } })
        if (!exists) await prisma.productOptionGroup.create({ data: { productId: p.id, groupId: sizes.id } }).catch(()=>{})
      }

      // attach addons to most products
      const existsAdd = await prisma.productOptionGroup.findFirst({ where: { productId: p.id, groupId: addons.id } })
      if (!existsAdd) await prisma.productOptionGroup.create({ data: { productId: p.id, groupId: addons.id } }).catch(()=>{})
    }
  } catch (e) { console.warn('attach option groups failed', e && e.message) }

  // Customers (create 5 sample customers)
  const sampleCustomers = [
    { id: 'cust-demo-1', fullName: 'João da Silva', whatsapp: '11987654321', phone: '11987654321', addr: { label: 'Casa', street: 'Rua dos Testes', number: '123', neighborhood: 'Centro', city: 'São Paulo', state: 'SP', postalCode: '01000000', formatted: 'Rua dos Testes, 123 - Centro - São Paulo/SP', latitude: -23.55052, longitude: -46.633308 } },
    { id: 'cust-demo-2', fullName: 'Maria Oliveira', whatsapp: '11981234567', phone: '11981234567', addr: { label: 'Casa', street: 'Rua das Flores', number: '45', neighborhood: 'Jardim Teste', city: 'São Paulo', state: 'SP', postalCode: '02000000', formatted: 'Rua das Flores, 45 - Jardim Teste - São Paulo/SP', latitude: -23.56052, longitude: -46.643308 } },
    { id: 'cust-demo-3', fullName: 'Carlos Pereira', whatsapp: '11980123456', phone: '11980123456', addr: { label: 'Trabalho', street: 'Av. Central', number: '200', neighborhood: 'Bairro Demo', city: 'São Paulo', state: 'SP', postalCode: '03000000', formatted: 'Av. Central, 200 - Bairro Demo - São Paulo/SP', latitude: -23.57052, longitude: -46.653308 } },
    { id: 'cust-demo-4', fullName: 'Ana Souza', whatsapp: '11982345678', phone: '11982345678', addr: { label: 'Casa', street: 'Praça Alegre', number: '10', neighborhood: 'Centro', city: 'São Paulo', state: 'SP', postalCode: '04000000', formatted: 'Praça Alegre, 10 - Centro - São Paulo/SP', latitude: -23.58052, longitude: -46.663308 } },
    { id: 'cust-demo-5', fullName: 'Pedro Gomes', whatsapp: '11983456789', phone: '11983456789', addr: { label: 'Casa', street: 'Rua Nova', number: '77', neighborhood: 'Jardim Teste', city: 'São Paulo', state: 'SP', postalCode: '05000000', formatted: 'Rua Nova, 77 - Jardim Teste - São Paulo/SP', latitude: -23.59052, longitude: -46.673308 } }
  ]

  let customer = null
  for (const sc of sampleCustomers) {
    try{
      const c = await prisma.customer.upsert({ where: { id: sc.id }, update: { fullName: sc.fullName, whatsapp: sc.whatsapp, phone: sc.phone, companyId: company.id }, create: { id: sc.id, companyId: company.id, fullName: sc.fullName, whatsapp: sc.whatsapp, phone: sc.phone } })
      // create address if missing
      try{
        const existingAddr = await prisma.address.findFirst({ where: { customerId: c.id } })
        if (!existingAddr) {
          await prisma.address.create({ data: { companyId: company.id, customerId: c.id, label: sc.addr.label, street: sc.addr.street, number: sc.addr.number, neighborhood: sc.addr.neighborhood, city: sc.addr.city, state: sc.addr.state, postalCode: sc.addr.postalCode, formatted: sc.addr.formatted, isDefault: true, latitude: sc.addr.latitude, longitude: sc.addr.longitude } }).catch(()=>{})
        }
      }catch(e){}
      if (!customer) customer = c
    }catch(e){ console.warn('customer upsert failed', e && e.message) }
  }

  // Riders (create 2 riders)
  await prisma.rider.upsert({ where: { id: 'rider-demo-1' }, update: { name: 'Entregador Demo 1' }, create: { id: 'rider-demo-1', companyId: company.id, name: 'Entregador Demo 1', whatsapp: '55999999999', dailyRate: '50.00', active: true } }).catch(()=>{})
  await prisma.rider.upsert({ where: { id: 'rider-demo-2' }, update: { name: 'Entregador Demo 2' }, create: { id: 'rider-demo-2', companyId: company.id, name: 'Entregador Demo 2', whatsapp: '55998888888', dailyRate: '45.00', active: true } }).catch(()=>{})

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

  // ----- Ingredients seed (groups + ingredients) -----
  try {
    const groups = {};
    const groupNames = ['Bebidas', 'Embalagens', 'Proteínas'];
    for (const name of groupNames) {
      let g = await prisma.ingredientGroup.findFirst({ where: { companyId: company.id, name } });
      if (!g) g = await prisma.ingredientGroup.create({ data: { companyId: company.id, name } });
      groups[name] = g;
    }

    // sample ingredients
    await prisma.ingredient.createMany({ data: [
      { companyId: company.id, description: 'Água Mineral 500ml', unit: 'ML', groupId: groups['Bebidas'].id, controlsStock: true, composesCmv: true, minStock: '10', currentStock: '50', avgCost: '1.20' },
      { companyId: company.id, description: 'Copo Descartável', unit: 'UN', groupId: groups['Embalagens'].id, controlsStock: true, composesCmv: false, minStock: '20', currentStock: '200', avgCost: '0.10' },
      { companyId: company.id, description: 'Peito de Frango (kg)', unit: 'KG', groupId: groups['Proteínas'].id, controlsStock: true, composesCmv: true, minStock: '5', currentStock: '12', avgCost: '15.50' }
    ], skipDuplicates: true }).catch(()=>{})
  } catch (e) { console.warn('ingredient seed failed', e && e.message) }

  // ----- Technical sheets (fichas técnicas) -----
  try {
    // find ingredients to reference in technical sheet items
    const agua = await prisma.ingredient.findFirst({ where: { companyId: company.id, description: 'Água Mineral 500ml' } })
    const copo = await prisma.ingredient.findFirst({ where: { companyId: company.id, description: 'Copo Descartável' } })
    const frango = await prisma.ingredient.findFirst({ where: { companyId: company.id, description: 'Peito de Frango (kg)' } })

    // sample technical sheet for a grilled chicken combo
    let sheet = await prisma.technicalSheet.findFirst({ where: { companyId: company.id, name: 'Combo Frango Grelhado' } })
    if (!sheet) {
      sheet = await prisma.technicalSheet.create({ data: { companyId: company.id, name: 'Combo Frango Grelhado', notes: 'Peito de frango grelhado com acompanhamento e bebida' } })
    }

    // create items (quantities expressed in ingredient unit: kg, ml, un)
    const items = []
    if (frango) items.push({ technicalSheetId: sheet.id, ingredientId: frango.id, quantity: '0.25' }) // 250g
    if (agua) items.push({ technicalSheetId: sheet.id, ingredientId: agua.id, quantity: '500' }) // 500ml
    if (copo) items.push({ technicalSheetId: sheet.id, ingredientId: copo.id, quantity: '1' })

    if (items.length) {
      for (const it of items) {
        const exists = await prisma.technicalSheetItem.findFirst({ where: { technicalSheetId: it.technicalSheetId, ingredientId: it.ingredientId } })
        if (!exists) {
          await prisma.technicalSheetItem.create({ data: it }).catch(()=>{})
        }
      }
    }
  } catch (e) { console.warn('technical sheet seed failed', e && e.message) }

  // ----- Neighborhoods (bairros) -----
  try {
    const bairros = [
      { name: 'Centro', deliveryFee: '5.00', riderFee: '2.50' },
      { name: 'Jardim Teste', deliveryFee: '7.00', riderFee: '3.00' },
      { name: 'Bairro Demo', deliveryFee: '6.50', riderFee: '2.75' }
    ]

    for (const b of bairros) {
      const found = await prisma.neighborhood.findFirst({ where: { companyId: company.id, name: b.name } })
      if (!found) {
        await prisma.neighborhood.create({ data: { companyId: company.id, name: b.name, deliveryFee: b.deliveryFee, riderFee: b.riderFee } }).catch(()=>{})
      }
    }
  } catch (e) { console.warn('neighborhood seed failed', e && e.message) }

  // ----- Additional demo company for broader tests -----
  try {
    const otherCompanyId = '11111111-1111-1111-1111-111111111111'
    const otherCompany = await prisma.company.upsert({ where: { id: otherCompanyId }, update: { name: 'Loja Demo 2' }, create: { id: otherCompanyId, name: 'Loja Demo 2', slug: 'loja-demo-2' } })

    const otherStore = await prisma.store.upsert({ where: { slug: 'loja-demo-2-store' }, update: { name: 'Loja Demo 2 - Matriz', companyId: otherCompany.id }, create: { slug: 'loja-demo-2-store', name: 'Loja Demo 2 - Matriz', companyId: otherCompany.id, address: 'Av. Demo 45' } })

    // payment methods for the second company
    await prisma.paymentMethod.upsert({ where: { code: 'PIX', companyId: otherCompany.id }, update: { name: 'PIX', isActive: true, companyId: otherCompany.id }, create: { companyId: otherCompany.id, name: 'PIX', code: 'PIX', isActive: true } }).catch(()=>{})
    await prisma.paymentMethod.upsert({ where: { code: 'CARD', companyId: otherCompany.id }, update: { name: 'Cartão (crédito)', isActive: true, companyId: otherCompany.id }, create: { companyId: otherCompany.id, name: 'Cartão (crédito)', code: 'CARD', isActive: true } }).catch(()=>{})

    // menu + categories + products for second company
    const menu2 = await prisma.menu.upsert({ where: { slug: 'main-menu-2' }, update: { name: 'Cardápio Demo 2', storeId: otherStore.id }, create: { slug: 'main-menu-2', name: 'Cardápio Demo 2', storeId: otherStore.id } })
    let catA = await prisma.menuCategory.findFirst({ where: { companyId: otherCompany.id, menuId: menu2.id, name: 'Lanches' } })
    if (!catA) catA = await prisma.menuCategory.create({ data: { companyId: otherCompany.id, menuId: menu2.id, name: 'Lanches', position: 1 } })
    let catB = await prisma.menuCategory.findFirst({ where: { companyId: otherCompany.id, menuId: menu2.id, name: 'Sobremesas' } })
    if (!catB) catB = await prisma.menuCategory.create({ data: { companyId: otherCompany.id, menuId: menu2.id, name: 'Sobremesas', position: 2 } })

    await prisma.product.createMany({ data: [
      { companyId: otherCompany.id, menuId: menu2.id, categoryId: catA.id, name: 'Hambúrguer Demo', price: '22.00', position: 1 },
      { companyId: otherCompany.id, menuId: menu2.id, categoryId: catA.id, name: 'X-Burguer Demo', price: '26.00', position: 2 },
      { companyId: otherCompany.id, menuId: menu2.id, categoryId: catB.id, name: 'Brownie Demo', price: '8.50', position: 1 }
    ], skipDuplicates: true }).catch(()=>{})

    // option group and options
    let og = await prisma.optionGroup.findFirst({ where: { companyId: otherCompany.id, name: 'Extras Demo' } })
    if (!og) og = await prisma.optionGroup.create({ data: { companyId: otherCompany.id, name: 'Extras Demo', min: 0, max: 3 } })
    await prisma.option.createMany({ data: [ { groupId: og.id, name: 'Ovo', price: '2.50', position: 1 }, { groupId: og.id, name: 'Cebola Caramelizada', price: '3.00', position: 2 } ] }).catch(()=>{})

    // ingredients + technical sheet for a product
    let ing1 = await prisma.ingredient.findFirst({ where: { companyId: otherCompany.id, description: 'Pão de Hambúrguer' } })
    if (!ing1) ing1 = await prisma.ingredient.create({ data: { companyId: otherCompany.id, description: 'Pão de Hambúrguer', unit: 'UN', controlsStock: true, composesCmv: true, minStock: '10', currentStock: '100', avgCost: '0.80' } }).catch(()=>null)
    else ing1 = await prisma.ingredient.update({ where: { id: ing1.id }, data: { currentStock: '100' } }).catch(()=>ing1)

    let ing2 = await prisma.ingredient.findFirst({ where: { companyId: otherCompany.id, description: 'Hambúrguer 150g' } })
    if (!ing2) ing2 = await prisma.ingredient.create({ data: { companyId: otherCompany.id, description: 'Hambúrguer 150g', unit: 'UN', controlsStock: true, composesCmv: true, minStock: '5', currentStock: '50', avgCost: '6.50' } }).catch(()=>null)
    else ing2 = await prisma.ingredient.update({ where: { id: ing2.id }, data: { currentStock: '50' } }).catch(()=>ing2)

    let sheet2 = await prisma.technicalSheet.findFirst({ where: { companyId: otherCompany.id, name: 'Hambúrguer Simples' } })
    if (!sheet2 && ing1 && ing2) {
      sheet2 = await prisma.technicalSheet.create({ data: { companyId: otherCompany.id, name: 'Hambúrguer Simples', notes: 'Pão + hambúrguer' } })
      await prisma.technicalSheetItem.createMany({ data: [ { technicalSheetId: sheet2.id, ingredientId: ing1.id, quantity: '1' }, { technicalSheetId: sheet2.id, ingredientId: ing2.id, quantity: '1' } ] }).catch(()=>{})
    }
  } catch (e) { console.warn('additional company seed failed', e && e.message) }

  // ----- Enhance main company products with images, technical sheet links, and custom option sets -----
  try {
    // sample image URLs (local public uploads path will be used)
    const sampleImages = [
      '/public/uploads/products/sample-burger.jpg',
      '/public/uploads/products/sample-pizza.jpg',
      '/public/uploads/products/sample-salad.jpg',
      '/public/uploads/products/sample-drink.jpg'
    ];

    // ensure files exist (touch empty files if missing) so frontend can load URLs during testing
    for (const img of sampleImages) {
      try {
        const p = path.join(process.cwd(), img.replace('/public/', 'public/'))
        if (!fs.existsSync(p)) {
          await fs.promises.mkdir(path.dirname(p), { recursive: true })
          await fs.promises.writeFile(p, '')
        }
      } catch (e) { /* ignore touch errors */ }
    }

    // create a couple of richer products with image and link to technical sheet
    const richProducts = [
      { name: 'X-Burger Especial', price: '28.00', image: sampleImages[0], attrs: { featured: true } },
      { name: 'Pizza Margherita', price: '34.50', image: sampleImages[1], attrs: { featured: false } },
      { name: 'Salada Caesar', price: '22.00', image: sampleImages[2], attrs: { vegetarian: true } },
      { name: 'Suco Natural 500ml', price: '7.50', image: sampleImages[3], attrs: { drink: true } }
    ]

    for (const rp of richProducts) {
      // create product if missing in main company/menu
      let prod = await prisma.product.findFirst({ where: { companyId: company.id, name: rp.name } })
      if (!prod) {
        prod = await prisma.product.create({ data: { companyId: company.id, menuId: menu.id, categoryId: categories[0].id, name: rp.name, price: rp.price, position: 999, isActive: true, image: rp.image } })
      } else {
        prod = await prisma.product.update({ where: { id: prod.id }, data: { image: rp.image, price: rp.price } })
      }

      // attach a technical sheet for products that are composed
      if (rp.name.includes('Burger') || rp.name.includes('Pizza') || rp.name.includes('Salada')) {
        let sheet = await prisma.technicalSheet.findFirst({ where: { companyId: company.id, name: `${rp.name} Sheet` } })
        if (!sheet) {
          sheet = await prisma.technicalSheet.create({ data: { companyId: company.id, name: `${rp.name} Sheet`, notes: `Ficha técnica para ${rp.name}` } })
          // add dummy items referencing existing ingredients where possible
          const ingSample = await prisma.ingredient.findFirst({ where: { companyId: company.id } })
          if (ingSample) {
            await prisma.technicalSheetItem.create({ data: { technicalSheetId: sheet.id, ingredientId: ingSample.id, quantity: '1' } }).catch(()=>{})
          }
        }

        // store the sheet id into product metadata via product.description append (non-invasive)
        try {
          await prisma.product.update({ where: { id: prod.id }, data: { description: `technicalSheetId:${sheet.id}` } })
        } catch (e) { /* ignore */ }
      }

      // attach options groups (sizes + addons) to rich products
      try {
        const existsSz = await prisma.productOptionGroup.findFirst({ where: { productId: prod.id, groupId: sizes.id } })
        if (!existsSz) await prisma.productOptionGroup.create({ data: { productId: prod.id, groupId: sizes.id } }).catch(()=>{})
        const existsAd = await prisma.productOptionGroup.findFirst({ where: { productId: prod.id, groupId: addons.id } })
        if (!existsAd) await prisma.productOptionGroup.create({ data: { productId: prod.id, groupId: addons.id } }).catch(()=>{})
      } catch (e) { /* ignore */ }
    }
  } catch (e) { console.warn('enhance products seed failed', e && e.message) }

  console.log('✅ Seed completed: company, store, user, menu, categories, products, options, sample orders created')
}

createDemoData()
  .catch((e) => { console.error('Seed failed:', e); process.exit(1) })
  .finally(async () => { await prisma.$disconnect() })
