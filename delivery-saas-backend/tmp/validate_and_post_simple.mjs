import axios from 'axios'
import https from 'https'

async function run(){
  try{
    const companyId = 'bd6a5381-6b90-4cc9-bc8f-24890c491693'
    const base = 'https://localhost:3000'
    const subtotal = 22.9
    const val = await axios.post(`${base}/public/${companyId}/coupons/validate`, { code: 'CUPOM11', subtotal }, { httpsAgent: new https.Agent({ rejectUnauthorized: false }) })
    console.log('validate resp:', JSON.stringify(val.data, null, 2))
    const nb = await axios.get(`${base}/public/${companyId}/neighborhoods`, { httpsAgent: new https.Agent({ rejectUnauthorized: false }) })
    console.log('neighborhoods:', nb.data)
    const payload = {
      customer: { name: 'E2E Simple', contact: '739999999999', address: { formattedAddress: 'Rua Dev 1', neighborhood: '123' } },
      items: [{ productId: null, name: 'Tropeiro com frango', quantity: 1, price: 22.9, options: [] }],
      payment: { methodCode: 'CASH', amount: Math.max(0, subtotal - Number(val.data.discountAmount || 0)) + 5 },
      neighborhood: '123',
      orderType: 'DELIVERY',
      coupon: { code: 'CUPOM11', discountAmount: Number(val.data.discountAmount || 0) }
    }
    console.log('posting order payload', payload)
    const res = await axios.post(`${base}/public/${companyId}/orders`, payload, { httpsAgent: new https.Agent({ rejectUnauthorized: false }), timeout: 10000 })
    console.log('order create response', res.status, res.data)
  }catch(e){
    console.error('err full', e)
    if(e.response) console.error('resp data', e.response.data, 'status', e.response.status)
    else console.error('message', e.message)
  }
}
run()
