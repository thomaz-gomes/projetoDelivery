import { prisma } from '../src/prisma.js'
import * as cashbackSvc from '../src/services/cashback.js'

async function main(){
  const args = process.argv.slice(2)
  if(!args.length){
    console.log('Usage: node retro_credit_cashback.mjs <companyId> [limit]')
    process.exit(1)
  }
  const companyId = args[0]
  const limit = Number(args[1] || 100)
  console.log('Scanning company', companyId, 'for CONCLUIDO orders without cashback (limit', limit, ')')
  const orders = await prisma.order.findMany({ where: { companyId, status: 'CONCLUIDO' }, orderBy: { createdAt: 'asc' }, take: limit, include: { items: true } })
  console.log('Found orders:', orders.length)
  let creditCount = 0
  for(const o of orders){
    const existing = await prisma.cashbackTransaction.findFirst({ where: { orderId: o.id } })
    if(existing){
      console.log('[skip] order', o.id, 'already has cashback tx')
      continue
    }
    // Determine clientId
    let clientId = o.customerId || null
    if(!clientId){
      const phone = o.customerPhone || (o.payload && o.payload.customer && (o.payload.customer.contact || o.payload.customer.phone))
      if(phone){
        const cust = await prisma.customer.findFirst({ where: { companyId: o.companyId, OR: [{ whatsapp: phone }, { phone }] } })
        if(cust) clientId = cust.id
      }
    }
    if(!clientId){
      console.log('[skip] no clientId for order', o.id)
      continue
    }
    try{
      const res = await cashbackSvc.creditWalletForOrder(o.companyId, clientId, o, 'Retroactive credit for past CONCLUIDO orders')
      if(res){
        console.log('[credited]', o.id, 'amount', res.amount)
        creditCount++
      } else {
        console.log('[no-credit] settings disabled or zero amount for order', o.id)
      }
    }catch(e){
      console.error('[error] crediting order', o.id, e && e.message)
    }
  }
  console.log('Done. credited count:', creditCount)
}

main().catch(e=>{ console.error(e); process.exit(1) }).finally(()=>process.exit(0))
