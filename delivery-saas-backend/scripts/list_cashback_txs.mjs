import { prisma } from '../src/prisma.js'
const args = process.argv.slice(2)
if(!args[0]){ console.error('Usage: node scripts/list_cashback_txs.mjs <companyId> [limit]'); process.exit(1) }
const companyId = args[0]
const limit = Number(args[1] || 20)
async function run(){
  const wallets = await prisma.cashbackWallet.findMany({ where: { companyId }, select: { id: true, clientId: true } })
  const walletIds = wallets.map(w=>w.id)
  const txs = await prisma.cashbackTransaction.findMany({ where: { walletId: { in: walletIds } }, orderBy: { createdAt: 'desc' }, take: limit })
  console.log('wallets found:', wallets.length)
  console.log(txs.map(t=>({ id: t.id, walletId: t.walletId, orderId: t.orderId, type: t.type, amount: String(t.amount), description: t.description, createdAt: t.createdAt })))
}
run().catch(e=>{ console.error(e); process.exit(2) })
