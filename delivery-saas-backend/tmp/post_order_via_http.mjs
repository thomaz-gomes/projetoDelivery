import axios from 'axios'
import https from 'https'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function ensureCompany(){
  let c = await prisma.company.findFirst({ where: { name: 'HTTP POST TEST COMPANY' } })
  if(!c){
    c = await prisma.company.create({ data: { name: 'HTTP POST TEST COMPANY', alwaysOpen: true } })
    console.log('Created test company', c.id)
  } else console.log('Found test company', c.id)
  return c
}

async function waitForServer(url, attempts = 8, delay = 1000){
  for(let i=0;i<attempts;i++){
    try{
      await axios.get(url, { httpsAgent: new https.Agent({ rejectUnauthorized: false }), timeout: 2000 })
      return true
    }catch(e){
      await new Promise(r => setTimeout(r, delay))
    }
  }
  return false
}

async function run(){
  try{
    const company = await ensureCompany()
    // try a set of candidate base URLs (localhost, 127.0.0.1 and local network IP)
    const candidates = [
      `https://localhost:3000`,
      `https://127.0.0.1:3000`,
      `https://192.168.1.102:3000`
    ]
    let base = null
    for(const cand of candidates){
      const health = `${cand}/public/${company.id}/menu`
      console.log('Probing', health)
      const ok = await waitForServer(health, 2, 800)
      if(ok){ base = cand; break }
    }
    if(!base) throw new Error('Server not responding at any candidate host')

    const payload = {
      customer: { name: 'Cliente HTTP Teste', contact: '+55 (11) 91234-0000', address: { formattedAddress: 'Rua Falsa 123', neighborhood: '' } },
      items: [{ productId: null, name: 'Produto HTTP', quantity: 1, price: 50 }],
      payment: { methodCode: 'CASH', amount: 0 },
      neighborhood: '',
      orderType: 'DELIVERY',
      coupon: { code: 'HTTP5', discountAmount: 5 }
    }

    // compute subtotal/delivery - use neighborhoods list to get a valid neighborhood or leave 0 delivery
    // set payment.amount to computed total
    const subtotal = payload.items.reduce((s,i)=> s + (i.price * i.quantity), 0)
    const deliveryFee = 0
    payload.payment.amount = Math.max(0, subtotal - payload.coupon.discountAmount) + deliveryFee

  console.log('Posting order payload to', base)
  const res = await axios.post(`${base}/public/${company.id}/orders`, payload, { httpsAgent: new https.Agent({ rejectUnauthorized: false }), timeout: 10000 })
    console.log('POST response status', res.status, res.data)
    const orderId = res.data && res.data.id
    if(orderId){
      const fetched = await prisma.order.findUnique({ where: { id: orderId } })
      console.log('Order in DB:', JSON.stringify(fetched, null, 2))
    }
  }catch(e){
    console.error('Error in POST test:', e?.response?.data || e.message || e)
  } finally {
    await prisma.$disconnect()
  }
}

run()
