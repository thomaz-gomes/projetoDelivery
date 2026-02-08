/*
Multi-purpose test script for the Cashback module.

Usage examples:
  $env:API_URL='http://localhost:3000' node .\scripts\test_cashback.mjs set-settings <companyId> --enabled=1 --defaultPercent=5 --minRedeem=10 --adminToken=<ADMIN_TOKEN>
  $env:API_URL='http://localhost:3000' node .\scripts\test_cashback.mjs add-rule <companyId> --productId=<id> --percent=10 --adminToken=<ADMIN_TOKEN>
  $env:API_URL='http://localhost:3000' node .\scripts\test_cashback.mjs create-public-order <companyId> --phone=559900112233 --storeId=<storeId>
  $env:API_URL='http://localhost:3000' node .\scripts\test_cashback.mjs complete-order <orderId> --adminToken=<ADMIN_TOKEN>
  $env:API_URL='http://localhost:3000' node .\scripts\test_cashback.mjs get-wallet <companyId> --clientId=<customerId> --token=<TOKEN>
  $env:API_URL='http://localhost:3000' node .\scripts\test_cashback.mjs apply-cashback --clientId=<customerId> --amount=5 --orderId=<orderId> --token=<CLIENT_TOKEN>

Notes:
 - Provide `--adminToken` (or env ADMIN_TOKEN) for admin actions.
 - Provide `--token` or env CLIENT_TOKEN for customer-authenticated actions.
 - Requires Node 18+ (global fetch).
*/

import process from 'process'

const API_URL = (process.env.API_URL || 'http://localhost:3000').replace(/\/$/, '')
const argv = process.argv.slice(2)
if(!argv.length){
  console.error('Usage: node scripts/test_cashback.mjs <action> [args]')
  process.exit(1)
}

function parseOpts(arr){
  const out = {}
  for(const a of arr){
    if(!a) continue
    if(a.startsWith('--')){
      const [k,v] = a.slice(2).split('=')
      out[k] = v === undefined ? '1' : v
    }
  }
  return out
}

const action = argv[0]
const opts = parseOpts(argv.slice(1))

async function req(method, path, body, token){
  const headers = { 'Content-Type': 'application/json' }
  if(token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`${API_URL}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined })
  const text = await res.text()
  let json
  try{ json = JSON.parse(text) } catch(e){ json = { status: res.status, text } }
  return { status: res.status, data: json }
}

async function setSettings(companyId){
  const token = opts.adminToken || process.env.ADMIN_TOKEN
  if(!token) return console.error('adminToken required (env ADMIN_TOKEN or --adminToken)')
  const body = {}
  if('enabled' in opts) body.enabled = !!Number(opts.enabled)
  if('defaultPercent' in opts || 'defaultpercent' in opts) body.defaultPercent = Number(opts.defaultPercent || opts.defaultpercent || 0)
  if('minRedeem' in opts || 'minredeem' in opts) body.minRedeemValue = Number(opts.minRedeem || opts.minredeem || 0)
  const r = await req('PUT', '/cashback/settings', body, token)
  console.log('PUT /cashback/settings ->', r.status)
  console.log(JSON.stringify(r.data, null, 2))
}

async function addRule(companyId){
  const token = opts.adminToken || process.env.ADMIN_TOKEN
  if(!token) return console.error('adminToken required')
  const productId = opts.productId
  const percent = Number(opts.percent || 0)
  if(!productId) return console.error('--productId is required')
  const r = await req('POST', '/cashback/product-rules', { productId, cashbackPercent: percent }, token)
  console.log('POST /cashback/product-rules ->', r.status)
  console.log(JSON.stringify(r.data, null, 2))
}

async function createPublicOrder(companyId){
  const phone = opts.phone || '559900112233'
  const storeId = opts.storeId || null
  const payload = {
    customer: { name: 'Cliente Teste', contact: phone, address: { formattedAddress: 'Rua Teste, 1', neighborhood: 'Centro' } },
    items: [ { productId: opts.productId || 'sample-product', name: 'Produto Teste', price: Number(opts.price || 10), quantity: Number(opts.qty || 1) } ],
    payment: { methodCode: 'CASH', amount: Number(opts.price || 10) },
    orderType: 'DELIVERY'
  }
  if(storeId) payload.store = { id: storeId }
  const r = await req('POST', `/public/${encodeURIComponent(companyId)}/orders`, payload)
  console.log('POST /public/:companyId/orders ->', r.status)
  console.log(JSON.stringify(r.data, null, 2))
}

async function completeOrder(orderId){
  const token = opts.adminToken || process.env.ADMIN_TOKEN
  if(!token) return console.error('adminToken required')
  const r = await req('PATCH', `/orders/${encodeURIComponent(orderId)}/status`, { status: 'CONCLUIDO' }, token)
  console.log(`PATCH /orders/${orderId}/status ->`, r.status)
  console.log(JSON.stringify(r.data, null, 2))
}

async function getWallet(){
  const token = opts.token || process.env.CLIENT_TOKEN || opts.adminToken || process.env.ADMIN_TOKEN
  const clientId = opts.clientId
  if(!clientId) return console.error('--clientId required')
  const r = await req('GET', `/cashback/wallet?clientId=${encodeURIComponent(clientId)}`, null, token)
  console.log('GET /cashback/wallet ->', r.status)
  console.log(JSON.stringify(r.data, null, 2))
}

async function applyCashback(){
  const token = opts.token || process.env.CLIENT_TOKEN
  if(!token) return console.error('client token required via --token or env CLIENT_TOKEN')
  const clientId = opts.clientId
  const amount = Number(opts.amount || 0)
  const orderId = opts.orderId || null
  if(!clientId || !(amount > 0)) return console.error('--clientId and --amount are required')
  const r = await req('POST', '/checkout/apply-cashback', { clientId, amountRequested: amount, orderId }, token)
  console.log('POST /checkout/apply-cashback ->', r.status)
  console.log(JSON.stringify(r.data, null, 2))
}

async function main(){
  try{
    if(action === 'set-settings') return await setSettings(argv[1])
    if(action === 'add-rule') return await addRule(argv[1])
    if(action === 'create-public-order') return await createPublicOrder(argv[1])
    if(action === 'complete-order') return await completeOrder(argv[1])
    if(action === 'get-wallet') return await getWallet()
    if(action === 'apply-cashback') return await applyCashback()
    console.error('Unknown action:', action)
  }catch(e){ console.error('Error', e) }
}

main()
