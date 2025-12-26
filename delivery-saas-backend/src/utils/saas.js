import { prisma } from '../prisma.js'

export async function getSubscription(companyId) {
  if (!companyId) return null
  return prisma.saasSubscription.findUnique({
    where: { companyId },
    include: { plan: { include: { modules: { include: { module: true } } } } }
  })
}

export async function isModuleEnabled(companyId, key) {
  const sub = await getSubscription(companyId)
  if (!sub || !sub.plan || !sub.plan.modules) return false
  const k = String(key).toUpperCase()
  return sub.plan.modules.some(pm => pm.module && String(pm.module.key).toUpperCase() === k)
}

export async function assertModuleEnabled(companyId, key) {
  const ok = await isModuleEnabled(companyId, key)
  if (!ok) {
    const err = new Error('Module not enabled: ' + key)
    err.statusCode = 403
    throw err
  }
}

export async function assertLimit(companyId, type) {
  // type: 'stores' | 'menus'
  const sub = await getSubscription(companyId)
  if (!sub || !sub.plan) return // no plan => no limits
  const p = sub.plan
  if (type === 'stores') {
    if (p.unlimitedStores || p.storeLimit == null) return
    const count = await prisma.store.count({ where: { companyId } })
    if (count >= p.storeLimit) {
      const err = new Error('Limite de lojas atingido para seu plano')
      err.statusCode = 403
      throw err
    }
  } else if (type === 'menus') {
    if (p.unlimitedMenus || p.menuLimit == null) return
    // Menus are by store; count all menus under company (use relation filter `is`)
    const count = await prisma.menu.count({ where: { store: { is: { companyId } } } })
    if (count >= p.menuLimit) {
      const err = new Error('Limite de cardápios atingido para seu plano')
      err.statusCode = 403
      throw err
    }
  }
}

export default { getSubscription, isModuleEnabled, assertModuleEnabled, assertLimit }
