import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function run(){
  try{
    const orders = await prisma.order.findMany({ orderBy: { createdAt: 'desc' }, take: 10 })
    for(const o of orders){
      console.log('---')
      console.log('id:', o.id)
      console.log('displayId:', o.displayId)
      console.log('createdAt:', o.createdAt)
      console.log('customerName:', o.customerName)
      console.log('customerPhone:', o.customerPhone)
      console.log('address:', o.address)
      console.log('subtotal (computed from items):')
      const items = await prisma.orderItem.findMany({ where: { orderId: o.id } })
      let subtotal = 0
      for(const it of items){ subtotal += Number(it.price || 0) * Number(it.quantity || 1) }
      console.log('  itemsCount:', items.length, 'subtotal:', subtotal)
      console.log('couponCode:', o.couponCode, 'couponDiscount:', String(o.couponDiscount))
      console.log('payload.payment:', o.payload && o.payload.rawPayload && o.payload.rawPayload.payment)
      console.log('deliveryFee:', String(o.deliveryFee))
      console.log('total:', String(o.total))
    }
  }catch(e){
    console.error('ERR', e)
  } finally { await prisma.$disconnect() }
}
run()
