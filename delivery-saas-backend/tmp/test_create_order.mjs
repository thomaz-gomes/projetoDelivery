import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function run(){
  try{
    // find or create a test company
    let company = await prisma.company.findFirst({ where: { name: 'TEST COMPANY FOR CUPON' } })
    if(!company){
      company = await prisma.company.create({ data: { name: 'TEST COMPANY FOR CUPON', alwaysOpen: true } })
      console.log('Created company', company.id)
    } else {
      console.log('Found company', company.id)
    }

    // create an order with coupon info
    const created = await prisma.order.create({
      data: {
        companyId: company.id,
        customerName: 'Teste Cliente',
        customerPhone: '+5511999999999',
        customerSource: 'PUBLIC',
        address: 'Rua Teste, 123',
        total: 90,
        deliveryFee: 10,
        couponCode: 'TEST10',
        couponDiscount: 10,
        payload: { publicOrder: true, rawPayload: { test: true } },
        items: { create: [{ name: 'Produto A', quantity: 1, price: 100 }] }
      },
      include: { items: true }
    })
    console.log('Created order id:', created.id)

    const fetched = await prisma.order.findUnique({ where: { id: created.id }, include: { items: true } })
    console.log('Fetched order:', JSON.stringify(fetched, null, 2))
  }catch(e){
    console.error('Test script error', e)
  } finally {
    await prisma.$disconnect()
  }
}

run()
