import { prisma } from '../prisma.js'

/**
 * Evaluate applicable discounts for a cart given companyId and customerId (optional).
 * Cart format: { items: [{ productId, categoryId, price, quantity }], subtotal }
 * Returns { discounts: [{ ruleId, description, amount }], totalDiscount }
 */
export async function evaluateCartDiscounts(companyId, cart, customerId = null) {
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

  for (const g of groups) {
    for (const r of (g.rules || [])) {
      try {
        let amount = 0
        // skip if minSubtotal not met
        if (r.minSubtotal && Number(r.minSubtotal) > subtotal) continue

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
          if (r.type === 'PERCENT') amount = sum * (Number(r.value||0)/100)
          else amount = Math.min(sum, Number(r.value||0))
        } else if (r.target === 'CATEGORY') {
          const cid = r.targetRef
          const matching = items.filter(i => String(i.categoryId) === String(cid))
          const sum = matching.reduce((s,it)=>s + Number(it.price||0) * Number(it.quantity||1),0)
          if (r.type === 'PERCENT') amount = sum * (Number(r.value||0)/100)
          else amount = Math.min(sum, Number(r.value||0))
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
