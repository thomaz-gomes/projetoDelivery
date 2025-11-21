/*
Simple smoke-test script to POST a sample public order to the backend.
Usage (PowerShell):
  $env:API_URL = 'http://localhost:3000'; node .\scripts\smoke_post_public_order.mjs <companyId> [--storeId=<storeId>] [--menuId=<menuId>] [--phone=<phone>]
Example:
  $env:API_URL = 'http://localhost:3000'; node .\scripts\smoke_post_public_order.mjs bd6a5381-6b90-4cc9-bc8f-24890c491693 --storeId=5f9c477a-... --menuId=abcd1234 --phone=559999999999

Notes:
- Requires Node 18+ (global fetch). If your Node doesn't have fetch, run this script with an environment that provides fetch or adapt to use axios.
- This script only issues a POST and prints the response JSON.
*/

import process from 'process'

const API_URL = process.env.API_URL || 'http://localhost:3000'
const argv = process.argv.slice(2)
if(!argv.length){
  console.error('Usage: node scripts/smoke_post_public_order.mjs <companyId> [--storeId=<id>] [--menuId=<id>] [--phone=<phone>]')
  process.exit(1)
}

const companyId = argv[0]
const opts = {}
for(const a of argv.slice(1)){
  if(a.startsWith('--')){
    const [k,v] = a.slice(2).split('=')
    opts[k] = v
  }
}

const storeId = opts.storeId || process.env.STORE_ID || null
const menuId = opts.menuId || process.env.MENU_ID || null
const phone = opts.phone || process.env.PHONE || '559900112233'

const payload = {
  customer: { name: 'Teste Público', contact: phone, address: { formattedAddress: 'Rua de Teste, 123', neighborhood: 'Centro', reference: '' } },
  items: [ { productId: 'sample-product-1', name: 'Producto de Teste', price: 10.0, quantity: 1, options: [] } ],
  payment: { methodCode: 'CASH', amount: 10.0 },
  neighborhood: 'Centro',
  orderType: 'DELIVERY'
}
if(storeId) payload.store = { id: String(storeId) }, payload.storeId = String(storeId)
if(menuId) payload.menuId = String(menuId)

async function run(){
  try{
    const url = `${API_URL.replace(/\/$/, '')}/public/${encodeURIComponent(companyId)}/orders`
    console.log('POST', url)
    console.log('payload:', JSON.stringify(payload, null, 2))
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    const text = await res.text()
    let json
    try{ json = JSON.parse(text) }catch(e){ json = { status: res.status, text } }
    console.log('Response status:', res.status)
    console.log(JSON.stringify(json, null, 2))
  }catch(err){
    console.error('Request failed', err)
    process.exit(2)
  }
}

run()
