#!/usr/bin/env node
import { prisma } from '../src/prisma.js'
import * as cashbackSvc from '../src/services/cashback.js'

async function main(){
  const args = process.argv.slice(2)
  if(!args.length){
    console.error('Usage: node scripts/credit_order.mjs <orderId>')
    process.exit(1)
  }
  const orderId = args[0]
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { items: true } })
  if(!order){ console.error('Order not found'); process.exit(2) }
  console.log('Order status (before):', order.status)
  console.log('Order items:', order.items)
  const companyId = order.companyId
  const settings = await prisma.cashbackSetting.findFirst({ where: { companyId } })
  console.log('Cashback settings:', settings)
  // ensure order has status CONCLUIDO so automatic credit path runs
  if(String(order.status || '').toUpperCase() !== 'CONCLUIDO'){
    try{ await prisma.order.update({ where: { id: orderId }, data: { status: 'CONCLUIDO' } }); order.status = 'CONCLUIDO' }catch(e){ console.warn('Failed to set order status to CONCLUIDO', e && e.message) }
  }
  let clientId = order.customerId || null
  if(!clientId){
    // try to find by phone
    const phone = order.customerPhone || (order.payload && order.payload.customer && (order.payload.customer.contact || order.payload.customer.phone))
    if(phone){
      const cust = await prisma.customer.findFirst({ where: { companyId, whatsapp: phone } })
      if(cust) clientId = cust.id
    }
  }
  if(!clientId){ console.error('No clientId available on order; cannot credit'); process.exit(3) }
  const res = await cashbackSvc.creditWalletForOrder(companyId, clientId, order, 'Credito manual via script')
  console.log('credit result:', res)
  process.exit(0)
}

main().catch(e=>{ console.error('Error', e); process.exit(10) })
