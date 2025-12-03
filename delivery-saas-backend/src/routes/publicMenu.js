import express from 'express'
import { prisma } from '../prisma.js'
import { findOrCreateCustomer } from '../services/customers.js'

export const publicMenuRouter = express.Router()

// Resolve friendly slugs like /public/nomedaloja -> redirect to the existing company/store menu route
publicMenuRouter.get('/:storeSlug', async (req, res, next) => {
  const { storeSlug } = req.params
  if (!storeSlug) return next()
  try {
    const slug = String(storeSlug || '').toLowerCase()
    const wantsJson = (req.get('X-Requested-With') === 'XMLHttpRequest') || (req.headers.accept && String(req.headers.accept).includes('application/json'))
    // try direct slug match first (supports menu, store and company slugs)
    try{
      // menu slug -> redirect to menu-scoped public URL
      const menu = await prisma.menu.findFirst({ where: { slug }, include: { store: { select: { companyId: true, id: true } } } })
      if (menu && menu.store) {
        if (wantsJson) return res.json({ companyId: menu.store.companyId, menuId: menu.id, storeId: menu.store.id })
        return res.redirect(302, `/public/${menu.store.companyId}/menu?menuId=${menu.id}`)
      }
    }catch(e){ /* ignore */ }

    try{
      const store = await prisma.store.findFirst({ where: { slug } , select: { id: true, companyId: true } })
      if (store) {
        if (wantsJson) return res.json({ companyId: store.companyId, storeId: store.id })
        return res.redirect(302, `/public/${store.companyId}/menu?storeId=${store.id}`)
      }
    }catch(e){ /* ignore */ }

    try{
      const company = await prisma.company.findFirst({ where: { slug } , select: { id: true } })
      if (company) {
        if (wantsJson) return res.json({ companyId: company.id })
        return res.redirect(302, `/public/${company.id}/menu`)
      }
    }catch(e){ /* ignore */ }

    // fallback: best-effort normalize compare against names when slug column is not present/populated
    const normalize = (v) => String(v || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    const stores = await prisma.store.findMany({ select: { id: true, companyId: true, name: true } })
    const matchedStore = (stores || []).find(s => normalize(s.name) === slug)
    if (matchedStore) return res.redirect(302, `/public/${matchedStore.companyId}/menu?storeId=${matchedStore.id}`)

    const companies = await prisma.company.findMany({ select: { id: true, name: true } })
    const matchedCompany = (companies || []).find(c => normalize(c.name) === slug)
    if (matchedCompany) return res.redirect(302, `/public/${matchedCompany.id}/menu`)

    return res.status(404).json({ message: 'Página pública não encontrada' })
  } catch (e) {
    console.error('Failed to resolve public slug', e)
    return res.status(500).json({ message: 'Erro interno ao resolver slug público' })
  }
})
 
// GET /public/:companyId/menu
publicMenuRouter.get('/:companyId/menu', async (req, res) => {
  const { companyId } = req.params
  const { storeId, menuId } = req.query || {}
  try {
    let categories
    if (menuId) {
      // load categories/products scoped only to the specific menu.
      // Previously company-wide categories (menuId == null) were included
      // which caused the same categories to appear across multiple menus.
      // For independent menus, fetch only categories assigned to this menu.
      categories = await prisma.menuCategory.findMany({
        where: { companyId, isActive: true, menuId },
        orderBy: { position: 'asc' },
        include: {
          products: {
            where: { isActive: true, menuId },
            orderBy: { position: 'asc' },
            include: {
              productOptionGroups: {
                include: {
                  group: {
                    include: {
                      options: {
                        include: {
                          linkedProduct: { select: { id: true, isActive: true } }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      })
    } else {
      // company-wide menu
      categories = await prisma.menuCategory.findMany({
        // only expose active categories on the public menu
        where: { companyId, isActive: true },
        orderBy: { position: 'asc' },
        include: {
          products: {
            where: { isActive: true },
            orderBy: { position: 'asc' },
            include: {
              productOptionGroups: {
                include: {
                  group: {
                    include: {
                      options: {
                        include: {
                          linkedProduct: { select: { id: true, isActive: true } }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      })
    }
    // uncategorized products will not be exposed via the public menu for privacy/consistency

  // include company basic info (hours)
  let company = await prisma.company.findUnique({ where: { id: companyId }, select: { id: true, name: true, alwaysOpen: true, timezone: true, weeklySchedule: true } })
  // container for an optional menu-scoped object to expose menu-level images/settings
  let menuObj = null
    // attach public-facing settings file (banner/logo/address/phone) when present
    try {
      const path = await import('path')
      const fs = await import('fs')
      const settingsPath = path.join(process.cwd(), 'public', 'uploads', 'company', companyId, 'settings.json')
      if (fs.existsSync(settingsPath)) {
        const raw = await fs.promises.readFile(settingsPath, 'utf8')
        try {
          const extra = JSON.parse(raw || '{}')
          Object.assign(company, extra)
        } catch (e) { /* ignore parse errors */ }
      }
    } catch (e) { /* ignore */ }
    // if a storeId is provided and valid, prefer store-level settings (logo/timezone/schedule/open24Hours)
    if (storeId) {
      try {
        const store = await prisma.store.findUnique({ where: { id: storeId } })
        if (store && store.companyId === companyId) {
          // prefer store timezone/schedule when present
          company = company || { id: companyId }
          if (store.timezone) company.timezone = store.timezone
          if (store.weeklySchedule) company.weeklySchedule = store.weeklySchedule
          // map open24Hours -> alwaysOpen for public consumption
          company.alwaysOpen = !!store.open24Hours
          // include store metadata so frontend can show store logo/pickup info
          company.store = { id: store.id, name: store.name, logoUrl: store.logoUrl || null }
          // attach store public settings (banner/logo) when present
          try {
            const path = await import('path')
            const fs = await import('fs')
            // prefer centralized settings path: settings/stores/<storeId>/settings.json
            const candidates = [
              path.join(process.cwd(), 'settings', 'stores', String(store.id), 'settings.json'),
              path.join(process.cwd(), 'public', 'uploads', 'store', String(store.id), 'settings.json')
            ]
            for (const settingsPath of candidates) {
              if (fs.existsSync(settingsPath)) {
                const raw = await fs.promises.readFile(settingsPath, 'utf8')
                try {
                  const extra = JSON.parse(raw || '{}')
                  Object.assign(company.store, extra)
                } catch (e) { /* ignore parse errors */ }
                break
              }
            }
          } catch (e) { /* ignore */ }
          // if a menu is linked to store and no explicit menuId provided, try to resolve a default menu for the store
          if (!menuId) {
            const menuForStore = await prisma.menu.findFirst({ where: { storeId: store.id, isActive: true }, orderBy: { position: 'asc' } })
              if (menuForStore) {
                // load categories scoped only to that specific store menu
                // do not include company-shared categories (menuId == null) to avoid
                // repeating the same categories across different menus.
                categories = await prisma.menuCategory.findMany({
                  where: { companyId, isActive: true, menuId: menuForStore.id },
                  orderBy: { position: 'asc' },
                  include: {
                    products: {
                      where: { isActive: true, menuId: menuForStore.id },
                      orderBy: { position: 'asc' },
                      include: {
                        productOptionGroups: {
                          include: {
                            group: {
                              include: {
                                options: {
                                  include: {
                                    linkedProduct: { select: { id: true, isActive: true } }
                                  }
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                })
                // expose the chosen menu so the frontend can show menu-specific images
                menuObj = { id: menuForStore.id, name: menuForStore.name, description: menuForStore.description, logo: menuForStore.logoUrl || null }
              }
          }
        }
      } catch (err) {
        console.warn('Failed to load store for public menu override', err?.message || err)
      }
    }
    // include publicly-visible payment methods (active) and pickup info (from printer settings as a lightweight store address)
    const paymentMethods = await prisma.paymentMethod.findMany({ where: { companyId, isActive: true }, orderBy: { createdAt: 'asc' } })
    const printer = await prisma.printerSetting.findFirst({ where: { companyId } })
    if (company) company.paymentMethods = paymentMethods || []
    if (company) company.pickupInfo = printer ? `${printer.headerName || ''}${printer.headerCity ? ' - ' + printer.headerCity : ''}`.trim() : null

    // normalize products to expose optionGroups directly
    for(const cat of categories){
      cat.products = (cat.products || []).map(p => ({
        ...p,
        optionGroups: (p.productOptionGroups || []).map(pg => {
          const group = { ...pg.group }
          // if options link to products, reflect linked availability
          if (group.options && Array.isArray(group.options)) {
            // remove options that link to inactive products entirely (don't expose inactive items)
            group.options = group.options
              .filter(o => !(o.linkedProduct && o.linkedProduct.isActive === false))
              .map(o => {
                const opt = { ...o }
                if (opt.linkedProduct) {
                  // availability follows linked product (should be true here)
                  opt.isAvailable = Boolean(opt.linkedProduct.isActive)
                  // remove availability-specific scheduling from the public payload
                  delete opt.availableDays
                  delete opt.availableFrom
                  delete opt.availableTo
                }
                if (opt.linkedProduct) delete opt.linkedProduct
                return opt
              })
          }
          return group
        })
      }))
    }
    // remove categories that became empty after filtering out inactive products/options
    const filteredCategories = categories.filter(c => Array.isArray(c.products) && c.products.length > 0)
    // replace categories variable with filtered list to return
  const categoriesToReturn = filteredCategories
    // include uncategorized products (products without category) — expose only active ones and normalize optionGroups
    let uncategorizedRows = []
    try {
      if (menuId) {
        uncategorizedRows = await prisma.product.findMany({
          where: { companyId, categoryId: null, isActive: true, menuId },
          orderBy: { position: 'asc' },
          include: {
            productOptionGroups: {
              include: {
                group: {
                  include: {
                    options: {
                      include: {
                        linkedProduct: { select: { id: true, isActive: true } }
                      }
                    }
                  }
                }
              }
            }
          }
        })
      } else {
        uncategorizedRows = await prisma.product.findMany({
          where: { companyId, categoryId: null, isActive: true },
          orderBy: { position: 'asc' },
          include: {
            productOptionGroups: {
              include: {
                group: {
                  include: {
                    options: {
                      include: {
                        linkedProduct: { select: { id: true, isActive: true } }
                      }
                    }
                  }
                }
              }
            }
          }
        })
      }
    } catch (e) {
      console.warn('Failed to load uncategorized products for public menu', e)
      uncategorizedRows = []
    }
    const uncategorizedToReturn = (uncategorizedRows || []).map(p => ({
      ...p,
      optionGroups: (p.productOptionGroups || []).map(pg => {
        const group = { ...pg.group }
        if (group.options && Array.isArray(group.options)) {
          group.options = group.options
            .filter(o => !(o.linkedProduct && o.linkedProduct.isActive === false))
            .map(o => {
              const opt = { ...o }
              if (opt.linkedProduct) {
                opt.isAvailable = Boolean(opt.linkedProduct.isActive)
                delete opt.availableDays
                delete opt.availableFrom
                delete opt.availableTo
              }
              if (opt.linkedProduct) delete opt.linkedProduct
              return opt
            })
        }
        return group
      })
    }))
    // If a specific menuId was requested, try to load menu metadata (logo/banner) from DB and optional settings file
    try {
      if (menuId) {
        const m = await prisma.menu.findUnique({ where: { id: menuId }, select: { id: true, name: true, description: true, logoUrl: true } })
        if (m) menuObj = { id: m.id, name: m.name, description: m.description, logo: m.logoUrl || null }
      }
      // load menu-level settings from the store's settings file (settings/stores/<storeId>/settings.json)
      if (menuObj && menuObj.id) {
        try {
          const path = await import('path')
          const fs = await import('fs')
          // determine storeId: prefer company.store.id if present, otherwise try to load menu to get storeId
          let targetStoreId = null
          try {
            if (company && company.store && company.store.id) targetStoreId = company.store.id
            else {
              const mdb = await prisma.menu.findUnique({ where: { id: menuObj.id }, select: { storeId: true } })
              if (mdb && mdb.storeId) targetStoreId = mdb.storeId
            }
          } catch (e) { /* ignore */ }

          const candidates = []
          if (targetStoreId) candidates.push(path.join(process.cwd(), 'settings', 'stores', String(targetStoreId), 'settings.json'))
          // fallback: legacy menu-level file
          candidates.push(path.join(process.cwd(), 'public', 'uploads', 'menu', String(menuObj.id), 'settings.json'))

          for (const settingsPath of candidates) {
            if (fs.existsSync(settingsPath)) {
              const raw = await fs.promises.readFile(settingsPath, 'utf8')
              try {
                const extra = JSON.parse(raw || '{}')
                // if settings file is the store settings and contains a `menus` map, prefer menus[menuId]
                if (settingsPath.includes(path.join('settings', 'stores')) && extra && extra.menus && extra.menus[menuObj.id]) {
                  Object.assign(menuObj, extra.menus[menuObj.id])
                } else {
                  Object.assign(menuObj, extra)
                }
              } catch (e) { /* ignore parse errors */ }
              break
            }
          }
        } catch (e) { /* ignore */ }
      }
    } catch (e) {
      console.warn('Failed to load menu metadata', e?.message || e)
    }

    res.json({ categories: categoriesToReturn, uncategorized: uncategorizedToReturn || [], company: company || null, menu: menuObj || null })
  } catch (e) {
    console.error('Error loading public menu', e)
    res.status(500).json({ message: 'Erro ao carregar cardápio' })
  }
})

// GET /public/:companyId/neighborhoods
// Public endpoint to list neighborhoods and delivery fees for a company (used by the public checkout)
publicMenuRouter.get('/:companyId/neighborhoods', async (req, res) => {
  const { companyId } = req.params
  try {
    const rows = await prisma.neighborhood.findMany({ where: { companyId }, orderBy: { name: 'asc' } })
    // return minimal payload to avoid leaking admin fields
    const out = (rows || []).map(r => ({ id: r.id, name: r.name, deliveryFee: Number(r.deliveryFee || 0), aliases: Array.isArray(r.aliases) ? r.aliases : [] }))
    return res.json(out)
  } catch (e) {
    console.error('Error loading public neighborhoods', e)
    return res.status(500).json({ message: 'Erro ao carregar bairros' })
  }
})

// POST /public/:companyId/neighborhoods/match
// Accepts { text } and returns { match: neighborhoodName|null, deliveryFee?: number }
publicMenuRouter.post('/:companyId/neighborhoods/match', async (req, res) => {
  const { companyId } = req.params
  const { text } = req.body || {}
  if (!text) return res.status(400).json({ message: 'text é obrigatório' })
  try {
    const txt = String(text).toLowerCase()
    const neighborhoods = await prisma.neighborhood.findMany({ where: { companyId } })
    const matched = neighborhoods.find(n => {
      if (!n || !n.name) return false
      const name = String(n.name).toLowerCase()
      if (txt.includes(name)) return true
      if (n.aliases) {
        try{
          const arr = Array.isArray(n.aliases) ? n.aliases : JSON.parse(n.aliases)
          if (arr.some(a => txt.includes(String(a || '').toLowerCase()))) return true
        }catch(e){}
      }
      return false
    })
    if (matched) return res.json({ match: matched.name, deliveryFee: Number(matched.deliveryFee || 0) })
    return res.json({ match: null })
  } catch (e) {
    console.error('POST /public/:companyId/neighborhoods/match', e)
    return res.status(500).json({ message: 'Erro ao procurar bairro' })
  }
})

// POST /public/:companyId/coupons/validate
// body: { code: string, subtotal: number }
publicMenuRouter.post('/:companyId/coupons/validate', async (req, res) => {
  const { companyId } = req.params
  const { code, subtotal, customerPhone } = req.body || {}
  if (!code) return res.status(400).json({ message: 'code é obrigatório' })
  try {
    // Prisma v6 removed the `mode: 'insensitive'` string filter option in many drivers.
    // Do a normal findFirst first (fast exact match). If not found, fall back to a
    // case-insensitive lookup using a raw SQL query (works for SQLite/Postgres with lower()).
    let c = await prisma.coupon.findFirst({ where: { companyId, code: String(code).trim(), isActive: true }, include: { affiliate: true } })
    if (!c) {
      try {
        const rows = await prisma.$queryRawUnsafe(
          `SELECT c.*, a."isActive" as "affiliate_isActive", a.id as "affiliate_id" FROM "Coupon" c LEFT JOIN "Affiliate" a ON a.id = c."affiliateId" WHERE c."companyId" = $1 AND lower(c."code") = lower($2) AND c."isActive" = 1 LIMIT 1`,
          companyId,
          String(code).trim()
        )
        if (rows && rows[0]) {
          const r = rows[0]
          c = {
            id: r.id,
            companyId: r.companyId,
            code: r.code,
            isActive: Boolean(r.isActive),
            isPercentage: Boolean(r.isPercentage),
            value: r.value,
            description: r.description || null,
            expiresAt: r.expiresAt ? new Date(r.expiresAt) : null,
            minSubtotal: r.minSubtotal,
            maxUses: r.maxUses,
            maxUsesPerCustomer: r.maxUsesPerCustomer,
            affiliateId: r.affiliateId || null,
            affiliate: r.affiliate_id ? { id: r.affiliate_id, isActive: Boolean(r.affiliate_isActive) } : null
          }
        }
      } catch (rawErr) {
        console.warn('Fallback raw coupon lookup failed:', rawErr?.message || rawErr)
      }
    }
    if (!c) return res.status(404).json({ message: 'Cupom não encontrado ou inativo' })

    const sub = Number(subtotal || 0)
    let discountAmount = 0
    const now = new Date()

    // expiration
    if (c.expiresAt && now > c.expiresAt) return res.status(400).json({ message: 'Cupom expirado' })

    // minimum subtotal
    if (c.minSubtotal !== null && c.minSubtotal !== undefined) {
      const min = Number(c.minSubtotal || 0)
      if (sub < min) return res.status(400).json({ message: `Requer subtotal mínimo de ${min}` })
    }

    // affiliate must be active when associated
    if (c.affiliateId) {
      if (!c.affiliate || c.affiliate.isActive === false) return res.status(400).json({ message: 'Cupom vinculado a afiliado inválido' })
    }
    if (c.isPercentage) {
      // Support two common storage conventions for percentage values:
      // - stored as '5' meaning 5% (legacy)
      // - stored as '0.05' meaning 5% (fractional)
      const rawVal = Number(c.value || 0)
      if (rawVal > 0 && rawVal <= 1) {
        // fractional (e.g. 0.05 -> 5%)
        discountAmount = Math.max(0, sub * rawVal)
      } else {
        // percent integer (e.g. 5 -> 5%)
        discountAmount = Math.max(0, (sub * rawVal) / 100)
      }
    } else {
      discountAmount = Math.max(0, Number(c.value || 0))
    }
    // round to cents to avoid floating point precision issues
    discountAmount = Math.round((discountAmount || 0) * 100) / 100
    // never discount more than subtotal
    if (discountAmount > sub) discountAmount = sub
    // Usage limits: prefer counting persisted orders that have couponCode set (new orders)
    // Fallback: count occurrences in payload for older orders that didn't persist couponCode
    if (c.maxUses || c.maxUsesPerCustomer) {
      const codeEsc = String(c.code).replace(/"/g, '"')
      // Count direct persisted uses (orders that already have couponCode column set)
      let totalDirect = 0
      try { totalDirect = await prisma.order.count({ where: { companyId, couponCode: c.code } }) } catch (err) { totalDirect = 0 }

      // Count older uses where couponCode was not saved (payload contains coupon)
      const like1 = `%\"couponCode\":\"${codeEsc}\"%`
      const like2 = `%\"discount\":%\"couponCode\":\"${codeEsc}\"%`
      const like3 = `%\"coupon\":%\"code\":\"${codeEsc}\"%`
      const totalCountQuery = `SELECT COUNT(1) as cnt FROM \"Order\" WHERE \"companyId\" = $1 AND (payload LIKE $2 OR payload LIKE $3 OR payload LIKE $4) AND (\"couponCode\" IS NULL OR \"couponCode\" = '')`
      let totalRaw = 0
      try {
        const totalRes = await prisma.$queryRawUnsafe(totalCountQuery, companyId, like1, like2, like3)
        totalRaw = (totalRes && totalRes[0] && Number(totalRes[0].cnt || 0)) || 0
      } catch (rawErr) { totalRaw = 0 }
      const totalUses = (Number(totalDirect || 0) + Number(totalRaw || 0))
      if (c.maxUses && Number(c.maxUses) > 0 && totalUses >= Number(c.maxUses)) return res.status(400).json({ message: 'Limite de uso do cupom atingido' })

      // per-customer uses (if customerPhone provided)
      if (c.maxUsesPerCustomer && customerPhone && String(customerPhone).trim()) {
        // normalize phone by removing all non-digit characters so comparisons are canonical
        const phone = String(customerPhone).replace(/\D/g, '')
        let perDirect = 0
        try {
          // Use raw query to compare a normalized customerPhone in DB (remove common formatting chars)
          const perDirectRes = await prisma.$queryRawUnsafe(
            `SELECT COUNT(1) as cnt FROM "Order" WHERE "companyId" = $1 AND "couponCode" = $2 AND replace(replace(replace(replace(replace(COALESCE("customerPhone", ''), '+', ''), ' ', ''), '(', ''), ')', ''), '-', '') = $3`,
            companyId,
            c.code,
            phone
          )
          perDirect = (perDirectRes && perDirectRes[0] && Number(perDirectRes[0].cnt || 0)) || 0
        } catch (err) { perDirect = 0 }

        // Fallback: count in payload for older orders where couponCode not present and payload mentions the coupon
        const perRawQuery = `SELECT COUNT(1) as cnt FROM "Order" WHERE "companyId" = $1 AND (payload LIKE $2 OR payload LIKE $3 OR payload LIKE $4) AND ("couponCode" IS NULL OR "couponCode" = '') AND payload LIKE $5`
        const likePhone = `%${phone}%`
        let perRaw = 0
        try {
          const perRes = await prisma.$queryRawUnsafe(perRawQuery, companyId, like1, like2, like3, likePhone)
          perRaw = (perRes && perRes[0] && Number(perRes[0].cnt || 0)) || 0
        } catch (rawErr2) { perRaw = 0 }
        const perCount = Number(perDirect || 0) + Number(perRaw || 0)
        if (perCount >= Number(c.maxUsesPerCustomer)) return res.status(400).json({ message: 'Limite de uso por cliente atingido' })
      }
    }

    return res.json({ valid: true, discountAmount: Number(discountAmount || 0), coupon: { id: c.id, code: c.code, isPercentage: c.isPercentage, value: Number(c.value || 0), description: c.description || null } })
  } catch (e) {
    console.error('POST /public/:companyId/coupons/validate', e)
    return res.status(500).json({ message: 'Erro ao validar cupom' })
  }
})

// POST /public/:companyId/orders
// body: { customerName, customerPhone, address: { street, number, neighborhood, city, formatted }, items: [{ productId?, name, quantity, price, notes }], payment: { methodCode, raw } }
publicMenuRouter.post('/:companyId/orders', async (req, res) => {
  const { companyId } = req.params
  const payload = req.body || {}
  try {
    // load company to check operating hours
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { id: true, alwaysOpen: true, timezone: true, weeklySchedule: true } })
    if (!company) return res.status(404).json({ message: 'Empresa não encontrada' })

    // if the store is not always open, validate current time against openFrom/openTo using the store timezone if provided
    if (!company.alwaysOpen) {
      const parseHM = (s) => {
        if (!s) return null
        const [hh, mm] = String(s).split(':').map(x=>Number(x))
        if (Number.isNaN(hh) || Number.isNaN(mm)) return null
        return { hh, mm }
      }
      // Prefer weeklySchedule if present
      const cmpMins = (hh, mm) => (hh * 60) + mm

      const checkInterval = (nowParts, from, to) => {
        const nowMinutes = cmpMins(nowParts.hh, nowParts.mm)
        const fromMinutes = cmpMins(from.hh, from.mm)
        const toMinutes = cmpMins(to.hh, to.mm)
        if (fromMinutes <= toMinutes) {
          return nowMinutes >= fromMinutes && nowMinutes <= toMinutes
        } else {
          // crosses midnight
          return (nowMinutes >= fromMinutes) || (nowMinutes <= toMinutes)
        }
      }

      // get current time in store timezone (or server timezone if not provided)
      let nowParts
      try {
        const tz = company.timezone || 'America/Sao_Paulo'
        const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour12: false, hour: '2-digit', minute: '2-digit' }).formatToParts(new Date())
        nowParts = { hh: Number(parts.find(p => p.type === 'hour')?.value), mm: Number(parts.find(p => p.type === 'minute')?.value) }
      } catch (tzErr) {
        console.warn('Timezone parse failed, falling back to server time:', tzErr?.message || tzErr)
        const d = new Date()
        nowParts = { hh: d.getHours(), mm: d.getMinutes() }
      }

      if (company.weeklySchedule && Array.isArray(company.weeklySchedule)) {
        try {
          const schedule = company.weeklySchedule
          // determine weekday in store timezone
          const tz = company.timezone || 'America/Sao_Paulo'
          const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short' }).formatToParts(new Date())
          // get weekday index 0=Sun..6=Sat by creating a Date in tz and using .getUTCDay fallback
          // simpler: compute day via Date in tz by formatting full date and building Date
          const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
          // fmt is like 'dd/mm/yyyy'
          const [dayStr, monthStr, yearStr] = fmt.split('/')
          // create Date from yyyy-mm-dd in tz by constructing UTC date
          const tzDate = new Date(`${yearStr}-${monthStr}-${dayStr}T00:00:00Z`)
          const weekDay = tzDate.getUTCDay()

          const today = schedule.find(d => Number(d?.day) === Number(weekDay))
          if (!today || !today.enabled) {
            return res.status(400).json({ message: 'Fora do horário de funcionamento; não é possível criar pedidos neste momento' })
          }
          if (!today.from || !today.to) return res.status(400).json({ message: 'Horário de funcionamento da loja inválido' })
          const fromH = Number(String(today.from).split(':')[0])
          const fromM = Number(String(today.from).split(':')[1])
          const toH = Number(String(today.to).split(':')[0])
          const toM = Number(String(today.to).split(':')[1])
          const from = { hh: fromH, mm: fromM }
          const to = { hh: toH, mm: toM }
          const open = checkInterval(nowParts, from, to)
          if (!open) return res.status(400).json({ message: 'Fora do horário de funcionamento; não é possível criar pedidos neste momento' })
        } catch (err) {
          console.warn('Failed to parse weeklySchedule, falling back to single interval:', err?.message || err)
          // fallthrough to single-interval handling below
        }
      }

      // fallback: if weeklySchedule is not present, reject because there is no configured schedule
      return res.status(400).json({ message: 'Horário de funcionamento não configurado; configure o horário semanal ou marque como "Sempre disponível".' })
    }

  // support both old shape (customerName/customerPhone) and new shape (customer: { name, contact, address })
  const raw = payload || {}
  const customer = (raw.customer && { name: String(raw.customer.name || ''), contact: String(raw.customer.contact || '') }) || { name: String(raw.customerName || ''), contact: String(raw.customerPhone || '') }
  const address = (raw.customer && raw.customer.address) || raw.address || {}
  const items = Array.isArray(raw.items) ? raw.items.map(it => ({ productId: it.productId || null, name: String(it.name || it.productName || 'Item'), quantity: Number(it.quantity || 1), price: Number(it.price || 0), notes: it.notes || null, options: Array.isArray(it.options) ? it.options.map(o => ({ id: o.id, name: o.name, price: Number(o.price || 0) })) : null })) : []
  // normalize payment object: include changeFor (troco) and support both code/name incoming values
  const payment = raw.payment ? {
    methodCode: String(raw.payment.methodCode || raw.payment.method || ''),
    method: raw.payment.method ? String(raw.payment.method) : null,
    amount: Number(raw.payment.amount || 0),
    // changeFor is the 'troco' amount the customer will pay with (optional)
    changeFor: (raw.payment && (raw.payment.changeFor !== undefined && raw.payment.changeFor !== null)) ? Number(raw.payment.changeFor) : null,
    raw: raw.payment.raw || null
  } : null
  const neighborhoodFromPayload = String(raw.neighborhood || (address && (address.neighborhood || address.neigh)) || '')

  if (!items || !Array.isArray(items) || items.length === 0) return res.status(400).json({ message: 'Itens são obrigatórios' })

    // enforce delivery address when orderType explicitly requests DELIVERY
    const orderType = String((raw.orderType || 'DELIVERY')).toUpperCase()
    if (orderType === 'DELIVERY') {
      const formatted = String((address && (address.formatted || address.formattedAddress)) || '')
      const neigh = String(neighborhoodFromPayload || '')
      if (!formatted || !neigh) return res.status(400).json({ message: 'Endereço completo e bairro são obrigatórios para entrega' })
    }

  // subtotal (use sanitized items)
  const subtotal = items.reduce((s, it) => s + (Number(it.price || 0) * Number(it.quantity || 1)), 0)

    // find neighborhood delivery fee (case-insensitive match against name or aliases)
    const neighborhoods = await prisma.neighborhood.findMany({ where: { companyId } })
    const neighborhoodName = (address.neighborhood || '').trim().toLowerCase()
    let deliveryFee = 0
    if (neighborhoodName) {
      const match = neighborhoods.find(n => {
        if (!n) return false
        if ((n.name || '').toLowerCase() === neighborhoodName) return true
        if (n.aliases && Array.isArray(n.aliases)) {
          return n.aliases.map(a => String(a).toLowerCase()).includes(neighborhoodName)
        }
        return false
      })
      if (match) deliveryFee = Number(match.deliveryFee || 0)
    }

  // If the client included a coupon in the payload, apply its discount amount (coupon.discountAmount)
  let couponDiscount = 0
  try {
    // Prefer server-side computation when a coupon code is present so the
    // final stored `total` is computed from an authoritative source (avoids
    // discrepancies when frontend and server differ on rounding or percent
    // representation). Fall back to provided discountAmount when coupon row
    // cannot be found.
    if (raw && raw.coupon && raw.coupon.code) {
      try {
        // find coupon (case-sensitive first, fallback to case-insensitive raw query)
        let svc = await prisma.coupon.findFirst({ where: { companyId, code: String(raw.coupon.code).trim(), isActive: true }, include: { affiliate: true } })
        if (!svc) {
          try {
            const rows = await prisma.$queryRawUnsafe(
              `SELECT c.*, a."isActive" as "affiliate_isActive", a.id as "affiliate_id" FROM "Coupon" c LEFT JOIN "Affiliate" a ON a.id = c."affiliateId" WHERE c."companyId" = $1 AND lower(c."code") = lower($2) AND c."isActive" = 1 LIMIT 1`,
              companyId,
              String(raw.coupon.code).trim()
            )
            if (rows && rows[0]) {
              const r = rows[0]
              svc = {
                id: r.id,
                companyId: r.companyId,
                code: r.code,
                isActive: Boolean(r.isActive),
                isPercentage: Boolean(r.isPercentage),
                value: r.value,
                description: r.description || null,
                expiresAt: r.expiresAt ? new Date(r.expiresAt) : null,
                minSubtotal: r.minSubtotal,
                maxUses: r.maxUses,
                maxUsesPerCustomer: r.maxUsesPerCustomer,
                affiliateId: r.affiliateId || null,
                affiliate: r.affiliate_id ? { id: r.affiliate_id, isActive: Boolean(r.affiliate_isActive) } : null
              }
            }
          } catch (rawErr) { svc = null }
        }

        if (svc) {
          // Compute discount using same rules as validation endpoint
          try {
            let computed = 0
            const rawVal = Number(svc.value || 0)
            if (svc.isPercentage) {
              if (rawVal > 0 && rawVal <= 1) {
                computed = Math.max(0, subtotal * rawVal)
              } else {
                computed = Math.max(0, (subtotal * rawVal) / 100)
              }
            } else {
              computed = Math.max(0, Number(svc.value || 0))
            }
            if (!Number.isFinite(computed) || Number.isNaN(computed)) {
              console.warn('Computed coupon discount is NaN or not finite, resetting to 0', { couponCode: svc.code, svcValue: svc.value, subtotal })
              computed = 0
            }
            if (computed > subtotal) computed = subtotal
            // round to cents
            couponDiscount = Math.round((computed || 0) * 100) / 100
            // debug trace for investigation
            console.log('Applying coupon on create order', { couponCode: svc.code, svcValue: svc.value, subtotal, computed, couponDiscount })
          } catch (compErr) {
            console.warn('Failed to compute coupon discount on server; ignoring client-provided amount and using 0', compErr?.message || compErr)
            couponDiscount = 0
          }
        } else {
          // If coupon row cannot be found, we intentionally DO NOT trust client-provided discountAmount
          // to avoid malicious or malformed values. Keep couponDiscount as 0 in that case.
          couponDiscount = 0
        }
      } catch (innerErr) {
        // on any error, fallback to provided discount if present
        if (raw.coupon && (raw.coupon.discountAmount || raw.coupon.discountAmount === 0)) {
          couponDiscount = Number(raw.coupon.discountAmount || 0)
        }
      }
    } else if (raw && raw.coupon && (raw.coupon.discountAmount || raw.coupon.discountAmount === 0)) {
      couponDiscount = Number(raw.coupon.discountAmount || 0)
    }
  } catch (e) {
    couponDiscount = 0
  }

  const total = Math.max(0, subtotal - Number(couponDiscount || 0)) + Number(deliveryFee || 0)

    // optional: validate payment method. Accept either code or name from incoming payload,
    // but store the canonical payment method NAME in the persisted payload (user requested)
    if (payment && payment.methodCode) {
      const pm = await prisma.paymentMethod.findFirst({ where: { companyId, isActive: true, OR: [{ code: payment.methodCode }, { name: payment.methodCode }] } })
      if (!pm) return res.status(400).json({ message: 'Método de pagamento inválido' })
      // prefer storing the user-friendly name in the payload (keeps display consistent)
      payment.method = pm.name
      payment.methodCode = pm.name
    }

    // Try to create/find a Customer when contact (whatsapp/phone) or name is provided from public menu.
    // This is best-effort: if customer creation fails we still allow the order to be created but log the issue.
    let persistedCustomer = null
    try {
      const maybeContact = String(customer.contact || '').trim()
      const maybeName = String(customer.name || '').trim()
      console.log('Public order customer attempt:', { maybeName, maybeContact })
      if (maybeContact || maybeName) {
        // build a small address payload so the customer service can persist an address if available
        const getFormatted = (a) => {
          if (!a) return null
          if (typeof a === 'string') return a
          if (a.formatted) return a.formatted
          if (a.formattedAddress) return a.formattedAddress
          if (a.street || a.number) return [a.street, a.number].filter(Boolean).join(', ')
          return null
        }
        const addressPayload = {
          delivery: {
            deliveryAddress: {
              formattedAddress: getFormatted(address),
              streetName: address?.street || address?.streetName || null,
              streetNumber: address?.number || address?.streetNumber || null,
              neighborhood: address?.neighborhood || address?.neigh || null,
              postalCode: address?.postalCode || address?.zip || null
            }
          }
        }
        console.log('Public order addressPayload:', addressPayload)
        persistedCustomer = await findOrCreateCustomer({ companyId, fullName: maybeName || null, cpf: null, whatsapp: maybeContact || null, phone: maybeContact || null, addressPayload })
        console.log('findOrCreateCustomer result:', persistedCustomer ? { id: persistedCustomer.id, whatsapp: persistedCustomer.whatsapp, fullName: persistedCustomer.fullName } : null)
      }
    } catch (custErr) {
      console.warn('Failed to persist public customer:', custErr?.message || custErr)
    }

      // create order with nested items
      // build a sanitized payload to store in DB (avoid keeping the entire raw input with unknown fields)
      const safePayload = { customer, payment, orderType, neighborhood: neighborhoodFromPayload, items }

      // Attempt to resolve a store for public orders when provided via query/payload/menuId
      // so we can persist storeId on the order and include canonical store data in the payload.
      let resolvedStore = null
      try {
        const storeIdCandidate = (req.query && req.query.storeId) || raw.storeId || null
        const menuIdCandidate = raw.menuId || req.query.menuId || null
        // debug: log incoming hints to help diagnose missing storeId
        console.log('POST /public/:companyId/orders - store/menu hints:', { companyId, storeIdCandidate, menuIdCandidate })

        // If client included a nested store object with id, prefer resolving that first
        const payloadStoreId = (raw && raw.store && (raw.store.id || raw.storeId)) || null
        if (payloadStoreId && !resolvedStore) {
          try {
            const s = await prisma.store.findUnique({ where: { id: payloadStoreId } })
            if (s && String(s.companyId) === String(companyId)) {
              resolvedStore = s
              console.log('Resolved store from payload.store.id:', { id: s.id, name: s.name })
            } else {
              console.log('Payload store.id present but did not match a store for company', { payloadStoreId, found: !!s, storeCompanyId: s?.companyId })
            }
          } catch (e) { console.warn('Error fetching store by payload.store.id:', e?.message || e) }
        }

        if (storeIdCandidate && !resolvedStore) {
          try {
            const s = await prisma.store.findUnique({ where: { id: storeIdCandidate } })
            if (s && String(s.companyId) === String(companyId)) resolvedStore = s
            else console.log('Store candidate found but companyId mismatch or not found', { storeIdCandidate, found: !!s, storeCompanyId: s?.companyId })
          } catch (e) { console.warn('Error fetching store by id candidate:', e?.message || e) }
        }
        // if still not resolved, try to infer from provided menuId in payload
        if (!resolvedStore && menuIdCandidate) {
          const mid = menuIdCandidate
          try {
            const menuRow = await prisma.menu.findUnique({ where: { id: mid }, select: { storeId: true } })
            if (menuRow && menuRow.storeId) {
              const s2 = await prisma.store.findUnique({ where: { id: menuRow.storeId } })
              if (s2 && String(s2.companyId) === String(companyId)) resolvedStore = s2
              else console.log('Menu resolved to store but company mismatch or store not found', { menuId: mid, menuStoreId: menuRow.storeId, found: !!s2, storeCompanyId: s2?.companyId })
            } else {
              console.log('Menu did not resolve to a store', { menuId: mid, menuRow })
            }
          } catch (e) { console.warn('Error fetching menu by id candidate:', e?.message || e) }
        }
        console.log('Resolved store for public order:', resolvedStore ? { id: resolvedStore.id, name: resolvedStore.name } : null)
      } catch (e) {
        console.warn('Failed to auto-resolve store for public order:', e?.message || e)
      }

      // Additional heuristics: try to match store from payload fields when hints above failed
      if (!resolvedStore) {
        try {
          const storePayload = raw.store || {};
          const candidates = {
            id: storePayload.id || raw.storeId || null,
            slug: storePayload.slug || raw.storeSlug || null,
            externalId: storePayload.externalId || raw.storeExternalId || raw.store_external_id || null,
            name: storePayload.name || raw.storeName || raw.store_name || null,
            cnpj: storePayload.cnpj || raw.storeCnpj || raw.store_cnpj || null
          }
          console.log('Attempting payload-based store heuristics', { candidates })

          // Try id first (already attempted above but re-check safely)
          if (candidates.id && !resolvedStore) {
            try {
              const s = await prisma.store.findUnique({ where: { id: candidates.id } })
              if (s && String(s.companyId) === String(companyId)) resolvedStore = s
              else console.log('Payload id candidate failed', { candidate: candidates.id, found: !!s, storeCompanyId: s?.companyId })
            } catch (e) { console.warn('Error fetching store by payload id:', e?.message || e) }
          }

          // Try slug
          if (!resolvedStore && candidates.slug) {
            try {
              const s = await prisma.store.findFirst({ where: { slug: String(candidates.slug) , companyId } })
              if (s) resolvedStore = s
              else console.log('Payload slug candidate did not match any store', { slug: candidates.slug })
            } catch (e) { console.warn('Error fetching store by slug candidate:', e?.message || e) }
          }

          // Try externalId
          if (!resolvedStore && candidates.externalId) {
            try {
              const s = await prisma.store.findFirst({ where: { externalId: String(candidates.externalId) , companyId } })
              if (s) resolvedStore = s
              else console.log('Payload externalId candidate did not match any store', { externalId: candidates.externalId })
            } catch (e) { console.warn('Error fetching store by externalId candidate:', e?.message || e) }
          }

          // Try CNPJ exact match
          if (!resolvedStore && candidates.cnpj) {
            try {
              const s = await prisma.store.findFirst({ where: { cnpj: String(candidates.cnpj) , companyId } })
              if (s) resolvedStore = s
              else console.log('Payload cnpj candidate did not match any store', { cnpj: candidates.cnpj })
            } catch (e) { console.warn('Error fetching store by cnpj candidate:', e?.message || e) }
          }

          // Try name-based normalized match as last resort
          if (!resolvedStore && candidates.name) {
            try {
              const normalize = (v) => String(v || '').toLowerCase().normalize('NFD').replace(/[ -\u036f]/g, '').replace(/[^a-z0-9]+/g, '-')
              const nameNorm = normalize(candidates.name)
              const stores = await prisma.store.findMany({ where: { companyId }, select: { id: true, name: true } })
              const matched = (stores || []).find(s => normalize(s.name) === nameNorm)
              if (matched) {
                const s = await prisma.store.findUnique({ where: { id: matched.id } })
                if (s) resolvedStore = s
              } else console.log('Payload name candidate did not match any store by normalized name', { name: candidates.name })
            } catch (e) { console.warn('Error matching store by name candidate:', e?.message || e) }
          }

          console.log('Resolved store after payload heuristics:', resolvedStore ? { id: resolvedStore.id, name: resolvedStore.name } : null)
        } catch (e) {
          console.warn('Payload-based store heuristics failed:', e?.message || e)
        }
      }

          // Fallback: if still not resolved, and company has exactly one store, auto-assign it
          if (!resolvedStore) {
            try {
              const count = await prisma.store.count({ where: { companyId } })
              if (count === 1) {
                const only = await prisma.store.findFirst({ where: { companyId } })
                if (only) {
                  resolvedStore = only
                  console.log('Auto-resolved store because company has a single store:', { id: only.id, name: only.name })
                }
              } else {
                console.log('Single-store fallback not applied; company has', count, 'stores')
              }
            } catch (e) {
              console.warn('Single-store fallback failed:', e?.message || e)
            }
          }

      // If we have resolved store, include a store hint in the safe payload and persist storeId on order
      if (resolvedStore) {
        safePayload.store = { id: resolvedStore.id, name: resolvedStore.name || null, slug: resolvedStore.slug || null }
      }

      const payloadToPersist = {
        publicOrder: true,
        payment: payment || null,
        orderType: orderType,
        rawPayload: safePayload
      }

      const created = await prisma.order.create({
        data: {
          companyId,
          customerId: persistedCustomer ? persistedCustomer.id : undefined,
          customerSource: 'PUBLIC',
          customerName: customer.name || null,
          customerPhone: customer.contact || null,
          address: ((address && (address.formatted || address.formattedAddress)) || [address.street, address.number].filter(Boolean).join(', ')) || null,
          // Persist the final total (after coupon discount + delivery fee)
          total: total,
          // persist coupon info if provided in payload (new columns)
          couponCode: (raw && raw.coupon && raw.coupon.code) ? String(raw.coupon.code) : null,
          couponDiscount: Number(couponDiscount || 0),
          orderType: String(orderType || ''),
          deliveryFee: deliveryFee,
          // attach resolved storeId when available so downstream consumers can rely on relation
          ...(resolvedStore ? { storeId: resolvedStore.id } : {}),
          payload: payloadToPersist,
          items: {
            // persist provided options (if any) into the OrderItem.options JSON column
            create: items.map(it => ({
              name: it.name || it.productName || 'Item',
              quantity: Number(it.quantity || 1),
              price: Number(it.price || 0),
              notes: it.notes || null,
              options: it.options || null
            }))
          }
        },
        include: { items: true }
      })

    // emit socket to panel if available (dynamic import to avoid circular dependency)
    try {
      const idx = await import('../index.js')
      if (idx && typeof idx.emitirNovoPedido === 'function') {
        try { idx.emitirNovoPedido(created) } catch (e) { console.warn('Emit novo pedido falhou:', e.message || e) }
      }
    } catch (e) {
      console.warn('Emit novo pedido dynamic import failed:', e?.message || e)
    }

    // Return the stored total (already includes deliveryFee) and deliveryFee separately
    res.status(201).json({ id: created.id, displayId: created.displayId, total: Number(created.total), deliveryFee: Number(created.deliveryFee || 0) })
  } catch (e) {
    console.error('Error creating public order', e)
    res.status(500).json({ message: 'Erro ao criar pedido' })
  }
})

// Public: GET single order (by id) with phone verification
publicMenuRouter.get('/:companyId/orders/:orderId', async (req, res) => {
  const { companyId, orderId } = req.params
  // allow phone via query or existing session cookie (public_phone)
  let phone = String(req.query.phone || '').trim()
  if (!phone) {
    try {
      const rawCookie = req.headers.cookie || ''
      const parts = rawCookie.split(/;\s*/)
      for (const p of parts) {
        const [k,v] = p.split('=')
        if (k === 'public_phone') { phone = decodeURIComponent(v || '').trim(); break }
      }
    } catch (e) { /* ignore */ }
  }
  if (!phone) return res.status(400).json({ message: 'Informe o número de WhatsApp (phone) para acessar o pedido' })
  try {
    const order = await prisma.order.findFirst({ where: { id: orderId, companyId }, include: { items: true, histories: true } })
    if (!order) return res.status(404).json({ message: 'Pedido não encontrado' })
    const orderPhone = String(order.customerPhone || '')
    // also check payload rawPayload customer contact
    let payloadPhone = ''
    try { payloadPhone = String((order.payload && order.payload.rawPayload && order.payload.rawPayload.customer && order.payload.rawPayload.customer.contact) || '') } catch (e) { payloadPhone = '' }
    const digitsReq = phone.replace(/\D/g,'')
    const matchOrderPhone = orderPhone && orderPhone.replace(/\D/g,'') === digitsReq
    const matchPayloadPhone = payloadPhone && payloadPhone.replace(/\D/g,'') === digitsReq
    if (matchOrderPhone || matchPayloadPhone) {
      // persist session cookie (30d) if absent or different value
      const cookieStr = String(req.headers.cookie || '')
      const alreadySet = cookieStr.includes('public_phone=') && cookieStr.includes(digitsReq)
      if (!alreadySet) {
        if (res.cookie) {
          res.cookie('public_phone', digitsReq, { httpOnly: true, sameSite: 'lax', maxAge: 30*24*60*60*1000, path: '/' })
        } else {
          res.setHeader('Set-Cookie', `public_phone=${encodeURIComponent(digitsReq)}; Path=/; Max-Age=${30*24*60*60}; SameSite=Lax; HttpOnly`)
        }
      }
      return res.json(order)
    }
    return res.status(403).json({ message: 'Número não autorizado para visualizar este pedido' })
  } catch (e) {
    console.error('Error fetching public order', e)
    return res.status(500).json({ message: 'Erro ao buscar pedido' })
  }
})

// Public: GET order history for a phone number
publicMenuRouter.get('/:companyId/orders', async (req, res) => {
  const { companyId } = req.params
  let phone = String(req.query.phone || '').trim()
  if (!phone) {
    try {
      const rawCookie = req.headers.cookie || ''
      const parts = rawCookie.split(/;\s*/)
      for (const p of parts) {
        const [k,v] = p.split('=')
        if (k === 'public_phone') { phone = decodeURIComponent(v || '').trim(); break }
      }
    } catch (e) { /* ignore */ }
  }
  if (!phone) return res.status(400).json({ message: 'Informe o número de WhatsApp (phone) para consultar histórico' })
  try {
    const orders = await prisma.order.findMany({ where: { companyId, customerPhone: phone }, orderBy: { createdAt: 'desc' }, include: { items: true } })
    // also try matching by payload rawPayload customer contact
    const also = await prisma.order.findMany({ where: { companyId, NOT: { customerPhone: phone } }, orderBy: { createdAt: 'desc' }, include: { items: true } })
    const matched = []
    for (const o of also) {
      try {
        const p = o.payload && o.payload.rawPayload && o.payload.rawPayload.customer && o.payload.rawPayload.customer.contact
        if (p && String(p).replace(/\D/g,'') === phone.replace(/\D/g,'')) matched.push(o)
      } catch (e) { }
    }
    const combined = [...orders, ...matched]
    // dedupe by id
    const map = new Map()
    for (const o of combined) map.set(o.id, o)
    // set session cookie if query param provided and valid
    const digitsReq = phone.replace(/\D/g,'')
    if (digitsReq.length >= 10) {
      res.cookie ? res.cookie('public_phone', digitsReq, { httpOnly: true, sameSite: 'lax', maxAge: 30*24*60*60*1000, path: '/' })
      : res.setHeader('Set-Cookie', `public_phone=${encodeURIComponent(digitsReq)}; Path=/; Max-Age=${30*24*60*60}; SameSite=Lax; HttpOnly`)
    }
    return res.json(Array.from(map.values()))
  } catch (e) {
    console.error('Error fetching public order history', e)
    return res.status(500).json({ message: 'Erro ao buscar histórico' })
  }
})

// Public: POST logout (limpa cookie public_phone)
publicMenuRouter.post('/:companyId/logout', async (req, res) => {
  try {
    const clearOpts = { httpOnly: true, sameSite: 'lax', maxAge: 0, path: '/' }
    if (res.cookie) res.cookie('public_phone', '', clearOpts)
    else res.setHeader('Set-Cookie', 'public_phone=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly')
  } catch (e) { /* ignore */ }
  return res.json({ ok: true })
})

export default publicMenuRouter
// (mantido export default acima; colocar novas rotas antes dele)
