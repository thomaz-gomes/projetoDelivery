import { prisma } from '../src/prisma.js'

async function main(){
  const phoneArg = process.argv[2]
  if(!phoneArg){
    console.log('Usage: node debug_wallet_by_phone.mjs <digitsPhone> e.g. 73991429676')
    process.exit(1)
  }
  const phone = String(phoneArg).replace(/\D/g,'')
  console.log('Searching for customer with phone digits:', phone)

  const customer = await prisma.customer.findFirst({ where: { OR: [ { whatsapp: phone }, { phone: phone } ] } })
  if(!customer){
    console.log('No customer found for phone', phone)
    // also try to find any customer with phone substring
    const maybe = await prisma.customer.findMany({ where: { whatsapp: { contains: phone } }, take: 5 })
    console.log('Customers with whatsapp containing:', maybe.length)
    console.dir(maybe, { depth: 2 })
    process.exit(0)
  }
  console.log('Found customer:', { id: customer.id, name: customer.name, whatsapp: customer.whatsapp, email: customer.email })

  const wallets = await prisma.cashbackWallet.findMany({ where: { clientId: String(customer.id) } })
  console.log('Found wallets count:', wallets.length)
  for(const w of wallets){
    console.log('Wallet:', w)
    const txs = await prisma.cashbackTransaction.findMany({ where: { walletId: w.id }, orderBy: { createdAt: 'desc' } })
    console.log('Transactions:', txs.length)
    console.dir(txs, { depth: 2 })
  }

  // list recent orders for this customer
  const orders = await prisma.order.findMany({ where: { customerId: customer.id }, orderBy: { createdAt: 'desc' }, take: 10 })
  console.log('Recent orders for customer:', orders.length)
  for(const o of orders){
    console.log('Order:', { id: o.id, displayId: o.displayId, companyId: o.companyId, customerId: o.customerId, customerPhone: o.customerPhone, payload: o.payload ? (typeof o.payload === 'string' ? o.payload : '[object]') : null, status: o.status, total: String(o.total), createdAt: o.createdAt })
    const items = await prisma.orderItem.findMany({ where: { orderId: o.id } })
    console.log(' Items count:', items.length)
    if(items.length) console.dir(items.map(i=>({ name: i.name, quantity: i.quantity, price: String(i.price), productId: i.productId })), { depth: 2 })
    const cbTxs = await prisma.cashbackTransaction.findMany({ where: { orderId: o.id } })
    console.log(' Cashback transactions for order:', cbTxs.length)
    if(cbTxs.length) console.dir(cbTxs, { depth: 2 })
  }

  // check cashback settings for the company of the most recent order (if any)
  if(orders.length){
    const companyId = orders[0].companyId
    const settings = await prisma.cashbackSetting.findFirst({ where: { companyId } })
    console.log('Cashback settings for company', companyId, settings || 'none')
  }
}

main().catch(e=>{ console.error(e); process.exit(1) }).finally(()=>process.exit(0))
