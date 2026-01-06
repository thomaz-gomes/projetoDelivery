import { prisma } from '../prisma.js'

/**
 * Evaluate applicable discounts for a cart given companyId and customerId (optional).
 * Cart format: { items: [{ productId, categoryId, price, quantity }], subtotal }
 * Returns { discounts: [{ ruleId, description, amount }], totalDiscount }
 */
/**
 * options: { orderType: 'DELIVERY'|'PICKUP'|undefined, couponApplied: boolean }
 */
export async function evaluateCartDiscounts(companyId, cart, customerId = null, options = {}) {
  // load active groups for this company that the customer belongs to (if customerId provided)
  let groups = []
  if (customerId) {
    groups = await prisma.customerGroup.findMany({
      where: { companyId, active: true, members: { some: { customerId } } },
      include: { rules: { where: { active: true } } },
    })
  } else {
    // no customer -> consider no group-specific discounts
    groups = []
  }

  const discounts = []
  let totalDiscount = 0

  const items = Array.isArray(cart.items) ? cart.items : []
  const subtotal = Number(cart.subtotal || items.reduce((s,it)=>s + (Number(it.price||0) * Number(it.quantity||1)),0))

  const orderType = options.orderType || (cart && cart.orderType) || null
  const couponApplied = !!(options.couponApplied || (cart && (cart.couponApplied || cart.coupon || cart.couponCode)))

  for (const g of groups) {
    for (const r of (g.rules || [])) {
      try {
        let amount = 0
        // skip if minSubtotal not met
        if (r.minSubtotal && Number(r.minSubtotal) > subtotal) continue

        // delivery type check: r.deliveryType can be 'ANY', 'DELIVERY', 'PICKUP' or undefined
        const dType = r.deliveryType || 'ANY'
        if (dType === 'DELIVERY' && orderType && String(orderType).toUpperCase() !== 'DELIVERY') continue
        if (dType === 'PICKUP' && orderType && String(orderType).toUpperCase() !== 'PICKUP') continue

        // coupon precedence: if rule marked noCoupon and coupon is applied, skip this rule
        if (couponApplied && r.noCoupon) continue

        if (r.target === 'ORDER') {
          if (r.type === 'PERCENT') {
            amount = subtotal * (Number(r.value || 0) / 100)
          } else {
            amount = Number(r.value || 0)
          }
        } else if (r.target === 'PRODUCT') {
          // targetRef is productId
          const pid = r.targetRef
          const matching = items.filter(i => String(i.productId) === String(pid))
          const sum = matching.reduce((s,it)=>s + Number(it.price||0) * Number(it.quantity||1),0)
          if (matching.length && sum > 0) {
            if (r.type === 'PERCENT') {
              // create per-item discounts so frontend can display per-line
              for (const it of matching) {
                const itemSum = Number(it.price||0) * Number(it.quantity||1)
                const itemAmt = itemSum * (Number(r.value||0)/100)
                const amt = Math.max(0, Number(itemAmt || 0))
                if (amt > 0) {
                  discounts.push({ ruleId: r.id, groupId: g.id, productId: it.productId, description: `${g.name} - ${r.type} ${r.target}`, amount: amt })
                  totalDiscount += amt
                }
              }
              // skip the default push below for this rule
              continue
            } else {
              // fixed value: cap to sum and distribute proportionally across matching items
              let remaining = Math.min(sum, Number(r.value||0))
              for (const it of matching) {
                const itemSum = Number(it.price||0) * Number(it.quantity||1)
                const share = itemSum / sum
                const itemAmt = Math.round((remaining * share) * 100) / 100
                if (itemAmt > 0) {
                  discounts.push({ ruleId: r.id, groupId: g.id, productId: it.productId, description: `${g.name} - ${r.type} ${r.target}`, amount: itemAmt })
                  totalDiscount += itemAmt
                }
              }
              continue
            }
          }
        } else if (r.target === 'CATEGORY') {
          const cid = r.targetRef
          const matching = items.filter(i => String(i.categoryId) === String(cid))
          const sum = matching.reduce((s,it)=>s + Number(it.price||0) * Number(it.quantity||1),0)
          if (matching.length && sum > 0) {
            if (r.type === 'PERCENT') {
              for (const it of matching) {
                const itemSum = Number(it.price||0) * Number(it.quantity||1)
                const itemAmt = itemSum * (Number(r.value||0)/100)
                const amt = Math.max(0, Number(itemAmt || 0))
                if (amt > 0) {
                  discounts.push({ ruleId: r.id, groupId: g.id, productId: it.productId, description: `${g.name} - ${r.type} ${r.target}`, amount: amt })
                  totalDiscount += amt
                }
              }
              continue
            } else {
              let remaining = Math.min(sum, Number(r.value||0))
              for (const it of matching) {
                const itemSum = Number(it.price||0) * Number(it.quantity||1)
                const share = itemSum / sum
                const itemAmt = Math.round((remaining * share) * 100) / 100
                if (itemAmt > 0) {
                  discounts.push({ ruleId: r.id, groupId: g.id, productId: it.productId, description: `${g.name} - ${r.type} ${r.target}`, amount: itemAmt })
                  totalDiscount += itemAmt
                }
              }
              continue
            }
          }
        }

        amount = Math.max(0, Number(amount || 0))
        if (amount > 0) {
          discounts.push({ ruleId: r.id, groupId: g.id, description: `${g.name} - ${r.type} ${r.target}`, amount })
          totalDiscount += amount
        }
      } catch (e) {
        // ignore rule errors and continue
        console.error('Error evaluating rule', r && r.id, e)
      }
    }
  }

  return { discounts, totalDiscount }
}

export default { evaluateCartDiscounts }
