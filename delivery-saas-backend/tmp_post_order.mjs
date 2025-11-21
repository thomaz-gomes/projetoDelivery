import axios from 'axios'
import https from 'https'

const COMPANY = 'bd6a5381-6b90-4cc9-bc8f-24890c491693'
const url = `https://localhost:3000/public/${COMPANY}/orders`
const payload = {
  customer: { name: 'Automated Node Tester', contact: '5511999999999' },
  items: [ { name: 'Node Test Item', price: 1, quantity: 1 } ],
  payment: { methodCode: 'CASH', amount: 1 },
  orderType: 'PICKUP'
}

;(async ()=>{
  try{
    const agent = new https.Agent({ rejectUnauthorized: false })
    const res = await axios.post(url, payload, { httpsAgent: agent })
    console.log('STATUS', res.status)
    console.log(JSON.stringify(res.data, null, 2))
  }catch(e){
    if(e.response){
      console.error('RESPONSE ERROR', e.response.status, e.response.data)
    } else {
      console.error('ERROR', e.message)
    }
    process.exit(2)
  }
})()