import ensureDatabaseUrl from './configureDatabaseEnv.js'
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

ensureDatabaseUrl()
const prisma = new PrismaClient()

async function main(){
  console.log('🌱 Running custom seed: demo menus, stores, products, customers')

  // company
  const company = await prisma.company.upsert({
    where: { slug: 'seed-demo-company' },
    update: { name: 'Seed Demo Company' },
    create: { slug: 'seed-demo-company', name: 'Seed Demo Company' }
  })

  // store
  const store = await prisma.store.upsert({
    where: { slug: 'seed-demo-store' },
    update: { name: 'Seed Demo Store', companyId: company.id },
    create: { slug: 'seed-demo-store', name: 'Seed Demo Store', companyId: company.id, address: 'Av. Seed, 100' }
  })

  // admin user for easy login
  const adminEmail = 'seed-admin@example.com'
  const adminPass = 'seed1234'
  const hash = await bcrypt.hash(adminPass, 10)
  await prisma.user.upsert({ where: { email: adminEmail }, update: { name: 'Seed Admin', role: 'ADMIN', companyId: company.id, password: hash }, create: { email: adminEmail, name: 'Seed Admin', role: 'ADMIN', password: hash, companyId: company.id } })

  // menu
  const menu = await prisma.menu.upsert({ where: { slug: 'seed-main-menu' }, update: { name: 'Cardápio Seed', storeId: store.id }, create: { slug: 'seed-main-menu', name: 'Cardápio Seed', storeId: store.id } })

  // categories
  const catNames = ['Pizzas', 'Lanches', 'Bebidas']
  const categories = []
  for (let i=0;i<catNames.length;i++){
    const c = await prisma.menuCategory.upsert({ where: { id: `${company.id}-${i}-seed` }, update: { name: catNames[i], position: i+1 }, create: { companyId: company.id, menuId: menu.id, name: catNames[i], position: i+1 } }).catch(async ()=>{
      // fallback when custom id not allowed: find or create by name
      let f = await prisma.menuCategory.findFirst({ where: { companyId: company.id, menuId: menu.id, name: catNames[i] } })
      if(!f) f = await prisma.menuCategory.create({ data: { companyId: company.id, menuId: menu.id, name: catNames[i], position: i+1 } })
      return f
    })
    categories.push(c)
  }

  // products
  const sampleProducts = [
    { category: 'Pizzas', name: 'Margherita', price: '34.50' },
    { category: 'Pizzas', name: 'Pepperoni', price: '38.00' },
    { category: 'Lanches', name: 'X-Burger', price: '22.00' },
    { category: 'Lanches', name: 'Hot Dog', price: '14.50' },
    { category: 'Bebidas', name: 'Refrigerante 350ml', price: '6.50' },
    { category: 'Bebidas', name: 'Água Mineral 500ml', price: '4.00' }
  ]

  for (const sp of sampleProducts){
    const cat = categories.find(c=>c.name===sp.category)
    if(!cat) continue
    await prisma.product.upsert({
      where: { name: `${company.id}-${sp.name}` },
      update: { price: sp.price, isActive: true, categoryId: cat.id, menuId: menu.id, companyId: company.id },
      create: { companyId: company.id, menuId: menu.id, categoryId: cat.id, name: sp.name, price: sp.price, isActive: true }
    }).catch(()=>{})
  }

  // customers
  const customers = [
    { id: 'seed-cust-1', fullName: 'Carlos Pereira', whatsapp: '5511999001001', phone: '11999001001' },
    { id: 'seed-cust-2', fullName: 'Mariana Souza', whatsapp: '5511999002002', phone: '11999002002' }
  ]
  for (const c of customers){
    await prisma.customer.upsert({ where: { id: c.id }, update: { fullName: c.fullName, whatsapp: c.whatsapp, phone: c.phone, companyId: company.id }, create: { id: c.id, companyId: company.id, fullName: c.fullName, whatsapp: c.whatsapp, phone: c.phone } }).catch(()=>{})
    try{
      await prisma.address.upsert({ where: { id: `${c.id}-addr-1` }, update: { customerId: c.id, companyId: company.id, label: 'Casa', street: 'Rua Seed', number: '10', neighborhood: 'Centro', city: 'Cidade', state: 'SP', postalCode: '00000000', formatted: 'Rua Seed, 10 - Centro', isDefault: true }, create: { id: `${c.id}-addr-1`, customerId: c.id, companyId: company.id, label: 'Casa', street: 'Rua Seed', number: '10', neighborhood: 'Centro', city: 'Cidade', state: 'SP', postalCode: '00000000', formatted: 'Rua Seed, 10 - Centro', isDefault: true } })
    }catch(e){}
  }

  console.log('✅ Custom seed finished: company, store, menu, categories, products, customers created')
}

main().catch((e)=>{ console.error('Seed failed', e); process.exit(1) }).finally(async ()=>{ await prisma.$disconnect() })
