import axios from 'axios'
import https from 'https'
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function run(){
  try{
    // find a real company that has the CUPOM11 coupon (use company from coupon query earlier)
    const rows = await prisma.$queryRawUnsafe(`SELECT * FROM "Coupon" WHERE lower("code") = lower($1) LIMIT 1`, 'CUPOM11')
    if(!rows || !rows[0]) return console.error('CUPOM11 coupon not found in DB')
    const companyId = rows[0].companyId
    const base = 'https://localhost:3000'
    // wait for menu
    await new Promise(r => setTimeout(r, 500))

    // Build payload matching the failing case (one item of price 22.9)
    const payload = {
      customer: { name: 'E2E Test', contact: '739999999999', address: { formattedAddress: 'Rua Dev 1', neighborhood: '123' } },
      items: [{ productId: null, name: 'Tropeiro com frango', quantity: 1, price: 22.9, options: [] }],
      payment: { methodCode: 'CASH', amount: 0 },
      neighborhood: '123',
      orderType: 'DELIVERY',
      coupon: { code: 'CUPOM11', discountAmount: 0 }
    }
    // compute payment amount client-side like frontend does (subtotal - coupon + delivery)
    const subtotal = payload.items.reduce((s,i)=> s + (i.price * i.quantity), 0)
    // find neighborhood fee
    const nb = await axios.get(`${base}/public/${companyId}/neighborhoods`, { httpsAgent: new https.Agent({ rejectUnauthorized: false }) })
    const match = (nb.data || []).find(n=> String((n.name||'').toLowerCase()) === '123')
    const delivery = match ? Number(match.deliveryFee || 0) : 0
    // call coupon validate to obtain discountAmount (frontend flow)
    const val = await axios.post(`${base}/public/${companyId}/coupons/validate`, { code: 'CUPOM11', subtotal }, { httpsAgent: new https.Agent({ rejectUnauthorized: false }) })
    console.log('Validation result', val.data)
    payload.coupon.discountAmount = Number(val.data.discountAmount || 0)
    payload.payment.amount = Math.max(0, subtotal - payload.coupon.discountAmount) + delivery
    console.log('Posting payload', payload)
    const res = await axios.post(`${base}/public/${companyId}/orders`, payload, { httpsAgent: new https.Agent({ rejectUnauthorized: false }), timeout: 10000 })
    console.log('Order create response', res.status, res.data)
    const orderId = res.data && res.data.id
    if(orderId){
      const stored = await prisma.order.findUnique({ where: { id: orderId } })
      console.log('Stored order:', stored)
    }
  }catch(e){
    console.error('E2E test failed', e?.response?.data || e.message || e)
  } finally { await prisma.$disconnect() }
}

run()
