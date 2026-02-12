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
  if(!settings || !settings.enabled) {
    try{ console.debug('[cashback] skipping credit: cashback disabled for company', companyId) }catch(e){}
    return null
  }
  // If an order object includes a status, only credit when the order is CONCLUIDO
  if(order && order.status !== undefined && String(order.status || '').toUpperCase() !== 'CONCLUIDO'){
    try{ console.debug('[cashback] skipping credit: order not CONCLUIDO', order && order.id) }catch(e){}
    return null
  }
  // ensure plan allows module when enforcement is enabled
  if (ENFORCE_MODULES) {
    const modules = await getEnabledModules(companyId)
    if(!Array.isArray(modules) || !modules.map(m=>String(m).toLowerCase()).includes('cashback')){
      try{ console.debug('[cashback] skipping credit: module not enabled in plan for company', companyId) }catch(e){}
      return null
    }
  }

  // fetch rules for products in order
  const productIds = (order.items || []).map(i => i.productId || null).filter(Boolean)
  // fetch product-level cashbackPercent when present
  const products = productIds.length ? await prisma.product.findMany({ where: { id: { in: productIds }, companyId }, select: { id: true, cashbackPercent: true } }) : []
  const productPercentMap = new Map((products || []).map(p => [p.id, p.cashbackPercent !== null && typeof p.cashbackPercent !== 'undefined' ? Number(p.cashbackPercent) : null]))
  // still load legacy rules to preserve existing data until migration completes
  const rules = await prisma.cashbackProductRule.findMany({ where: { companyId, productId: { in: productIds } } })
  const ruleMap = new Map(rules.map(r => [r.productId, Number(r.cashbackPercent)]))

  // compute per item: if rule exists use it, else defaultPercent
  let totalCashback = 0

  // Compute item subtotals (ignore delivery fee) and detect order-level discount.
  // Build a fallback productId map from payload.rawPayload.items (for orders where OrderItem lacks productId)
  let payloadItemsMap = null
  try {
    const pItems = order.payload && order.payload.rawPayload && Array.isArray(order.payload.rawPayload.items) ? order.payload.rawPayload.items : []
    if (pItems.length) {
      payloadItemsMap = new Map()
      for (const pi of pItems) {
        if (pi.productId) {
          const key = `${String(pi.name || '').toLowerCase()}|${Number(pi.price || 0)}`
          payloadItemsMap.set(key, pi.productId)
        }
      }
    }
  } catch (e) { /* ignore */ }

  const items = Array.isArray(order.items) ? order.items.map(it => {
    let pid = it.productId || null
    // fallback: try to match by name+price from payload items
    if (!pid && payloadItemsMap) {
      try {
        const key = `${String(it.name || '').toLowerCase()}|${Number(it.price || 0)}`
        pid = payloadItemsMap.get(key) || null
      } catch (e) { /* ignore */ }
    }
    return { price: Number(it.price || 0), qty: Number(it.quantity || 1), productId: pid }
  }) : []
  const itemsTotal = items.reduce((s,it) => s + (it.price * it.qty), 0)

  // Determine total discount applicable to items.
  let totalDiscount = 0
  try{
    // 1) explicit coupon payload (preferred)
    if(order && order.payload && order.payload.coupon && Number(order.payload.coupon.discountAmount)){
      totalDiscount = Number(order.payload.coupon.discountAmount || 0)
    }
    // 2) legacy payload fields
    else if(order && order.payload && Number(order.payload.discountAmount || order.payload.couponDiscount || 0)){
      totalDiscount = Number(order.payload.discountAmount || order.payload.couponDiscount || 0)
    }
    // 3) infer from totals: itemsTotal - (order.total - deliveryFee)
    else if(typeof order.total !== 'undefined'){
      const deliveryFee = Number(order.deliveryFee || (order.payload && order.payload.deliveryFee) || 0)
      const discountedItemsTotal = Number(order.total || 0) - deliveryFee
      const diff = Number(itemsTotal) - Number(discountedItemsTotal || 0)
      if(diff > 0) totalDiscount = diff
    }
  }catch(e){ totalDiscount = 0 }

  // Clamp discount to itemsTotal
  if(totalDiscount < 0) totalDiscount = 0
  if(totalDiscount > itemsTotal) totalDiscount = itemsTotal

  // Allocate discount proportionally to each item and compute cashback on discounted item value
  if(itemsTotal <= 0){
    totalCashback = 0
  } else {
    for(const it of items){
      const itemSubtotal = it.price * it.qty
      const share = itemSubtotal / itemsTotal
      const itemDiscount = Math.round((totalDiscount * share) * 100) / 100
      const itemNet = Math.max(0, itemSubtotal - itemDiscount)
      // Priority: product.cashbackPercent (if set) -> cashbackProductRule -> settings.defaultPercent
      let pct = Number(settings.defaultPercent || 0)
      try{
        if(it.productId && productPercentMap.has(it.productId) && productPercentMap.get(it.productId) !== null){ pct = Number(productPercentMap.get(it.productId)) }
        else if(it.productId && ruleMap.has(it.productId)){ pct = Number(ruleMap.get(it.productId)) }
      }catch(e){}
      const itemCash = itemNet * (pct / 100)
      totalCashback += itemCash
    }
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

export async function creditWalletManual(companyId, clientId, amount, description){
  if(Number(amount) <= 0) throw new Error('amount must be > 0')
  return prisma.$transaction(async (tx) => {
    let wallet = await tx.cashbackWallet.findFirst({ where: { companyId, clientId } })
    if(!wallet) wallet = await tx.cashbackWallet.create({ data: { companyId, clientId, balance: 0 } })
    const newBalance = Number(wallet.balance) + Number(amount)
    await tx.cashbackWallet.update({ where: { id: wallet.id }, data: { balance: String(newBalance) } })
    const txr = await tx.cashbackTransaction.create({ data: { walletId: wallet.id, type: 'CREDIT', amount: String(amount), description: description || 'Crédito manual' } })
    return { walletId: wallet.id, amount: Number(amount), tx: txr }
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
