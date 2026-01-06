import { prisma } from '../prisma.js'
import { getEnabledModules, ENFORCE_MODULES } from '../modules.js'

export async function getSettings(companyId){
  let s = await prisma.cashbackSetting.findFirst({ where: { companyId } })
  if(!s){
    s = await prisma.cashbackSetting.create({ data: { companyId } })
  }
  return s
}

export async function upsertSettings(companyId, data){
  const existing = await prisma.cashbackSetting.findFirst({ where: { companyId } })
  if(existing){
    return prisma.cashbackSetting.update({ where: { id: existing.id }, data })
  }
  return prisma.cashbackSetting.create({ data: Object.assign({}, data, { companyId }) })
}

export async function listProductRules(companyId){
  return prisma.cashbackProductRule.findMany({ where: { companyId }, orderBy: { createdAt: 'desc' } })
}

export async function addOrUpdateProductRule(companyId, productId, cashbackPercent){
  // validate product belongs to company
  const p = await prisma.product.findFirst({ where: { id: productId, companyId } })
  if(!p) throw new Error('Produto não encontrado para esta empresa')
  if(Number(cashbackPercent) < 0) throw new Error('cashbackPercent deve ser >= 0')
  const existing = await prisma.cashbackProductRule.findFirst({ where: { companyId, productId } })
  if(existing){
    return prisma.cashbackProductRule.update({ where: { id: existing.id }, data: { cashbackPercent: String(cashbackPercent) } })
  }
  return prisma.cashbackProductRule.create({ data: { companyId, productId, cashbackPercent: String(cashbackPercent) } })
}

export async function removeProductRule(companyId, id){
  const existing = await prisma.cashbackProductRule.findFirst({ where: { id, companyId } })
  if(!existing) throw new Error('Regra não encontrada')
  return prisma.cashbackProductRule.delete({ where: { id } })
}

export async function getOrCreateWallet(companyId, clientId){
  let w = await prisma.cashbackWallet.findFirst({ where: { companyId, clientId } })
  if(!w){
    w = await prisma.cashbackWallet.create({ data: { companyId, clientId, balance: 0 } })
  }
  return w
}

export async function creditWalletForOrder(companyId, clientId, order, description){
  // compute cashback based on items and per-product rules
  const settings = await getSettings(companyId)
  if(!settings || !settings.enabled) return null
  // If an order object includes a status, only credit when the order is CONCLUIDO
  if(order && order.status !== undefined && String(order.status || '').toUpperCase() !== 'CONCLUIDO') return null
  // ensure plan allows module when enforcement is enabled
  if (ENFORCE_MODULES) {
    const modules = await getEnabledModules(companyId)
    if(!Array.isArray(modules) || !modules.map(m=>String(m).toLowerCase()).includes('cashback')) return null
  }

  // fetch rules for products in order
  const productIds = (order.items || []).map(i => i.productId || null).filter(Boolean)
  const rules = await prisma.cashbackProductRule.findMany({ where: { companyId, productId: { in: productIds } } })
  const ruleMap = new Map(rules.map(r => [r.productId, Number(r.cashbackPercent)]))

  // compute per item: if rule exists use it, else defaultPercent
  let totalCashback = 0
  for(const it of (order.items || [])){
    const price = Number(it.price || 0)
    const qty = Number(it.quantity || 1)
    const productId = it.productId || null
    const pct = productId && ruleMap.has(productId) ? Number(ruleMap.get(productId)) : Number(settings.defaultPercent || 0)
    const itemSubtotal = price * qty
    const itemCash = itemSubtotal * (pct / 100)
    totalCashback += itemCash
  }

  totalCashback = Number(totalCashback.toFixed(2))
  if(!(totalCashback > 0)) return null

  // persist wallet tx and update balance in transaction
  return prisma.$transaction(async (tx) => {
    let wallet = await tx.cashbackWallet.findFirst({ where: { companyId, clientId } })
    if(!wallet) wallet = await tx.cashbackWallet.create({ data: { companyId, clientId, balance: 0 } })
    const newBalance = Number(wallet.balance) + totalCashback
    await tx.cashbackWallet.update({ where: { id: wallet.id }, data: { balance: String(newBalance) } })
    const txr = await tx.cashbackTransaction.create({ data: { walletId: wallet.id, orderId: order.id, type: 'CREDIT', amount: String(totalCashback), description: description || 'Cashback de compra' } })
    return { walletId: wallet.id, amount: totalCashback, tx: txr }
  })
}

export async function debitWallet(companyId, clientId, amount, orderId, description){
  if(Number(amount) <= 0) throw new Error('amount must be > 0')
  return prisma.$transaction(async (tx) => {
    const wallet = await tx.cashbackWallet.findFirst({ where: { companyId, clientId } })
    if(!wallet) throw new Error('Wallet not found')
    const bal = Number(wallet.balance || 0)
    if(Number(amount) > bal) throw new Error('Insufficient cashback balance')
    const newBal = Number((bal - Number(amount)).toFixed(2))
    await tx.cashbackWallet.update({ where: { id: wallet.id }, data: { balance: String(newBal) } })
    const txr = await tx.cashbackTransaction.create({ data: { walletId: wallet.id, orderId: orderId || null, type: 'DEBIT', amount: String(amount), description: description || 'Uso de cashback' } })
    return { walletId: wallet.id, amount: Number(amount), tx: txr }
  })
}

export async function getWalletWithTransactions(companyId, clientId){
  const wallet = await prisma.cashbackWallet.findFirst({ where: { companyId, clientId } })
  if(!wallet) return { balance: 0, transactions: [] }
  const txs = await prisma.cashbackTransaction.findMany({ where: { walletId: wallet.id }, orderBy: { createdAt: 'desc' } })
  return { balance: Number(wallet.balance || 0), transactions: txs }
}
