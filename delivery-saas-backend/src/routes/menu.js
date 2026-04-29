import express from 'express'
import { prisma } from '../prisma.js'
import { normalizeSlug, isValidSlug, isReservedSlug } from '../utils/slug.js'
import { authMiddleware, requireRole } from '../auth.js'
import fs from 'fs'
import path from 'path'
import { assertLimit } from '../utils/saas.js'
import { isCardapioSimplesOnly } from '../modules.js'
import { generateProductCode } from '../utils/integrationCode.js'
import { computePricingAnalysis } from '../services/pricingAnalysis.js'
import { getOrCreateDefaults } from './storePricingDefaults.js'
import { normalizeToIngredientUnit, areUnitsCompatible } from '../utils/unitConversion.js'
import { makeCopyName } from '../utils/copyName.js'
import { optimizeForWeb } from '../utils/imageOptimizer.js'

const router = express.Router()
router.use(authMiddleware)

// ------- Menus (multi-menu support) -------
// NOTE: This router is mounted under both `/menu` and `/settings` in
// clients. Keep route paths relative (no leading prefix) so they work
// correctly regardless of which mount point the app uses.
// GET /menu/menus
router.get('/menus', async (req, res) => {
  try {
    const companyId = req.user.companyId
    // SUPER_ADMIN has companyId = null; avoid passing null into a non-nullable where filter
    const where = companyId ? { store: { companyId } } : {}
    const rows = await prisma.menu.findMany({ where, orderBy: { position: 'asc' } })
    res.json(rows)
  } catch (e) {
    console.error('GET /menu/menus failed', e)
    res.status(500).json({ message: 'Erro ao listar cardápios', error: e?.message || String(e) })
  }
})

// POST /menu/menus - create a new menu (optionally link to a store)
router.post('/menus', requireRole('ADMIN'), async (req, res) => {
  const companyId = req.user.companyId
  const { name, description = null, storeId = null, logoUrl = null, position = 0, isActive = true, slug = null, address = null, phone = null, whatsapp = null, timezone = null, weeklySchedule = null, open24Hours = false, allowDelivery = true, allowPickup = true, catalogMode = false } = req.body || {}
  if (!name) return res.status(400).json({ message: 'Nome é obrigatório' })
  // if storeId is provided, ensure it belongs to the same company
  if (storeId) {
    const st = await prisma.store.findUnique({ where: { id: storeId } })
    if (!st || st.companyId !== companyId) return res.status(400).json({ message: 'Loja inválida' })
  }

  // validate slug when provided; auto-generate from name when omitted
  let normalized = null
  if (slug !== null && slug !== undefined && String(slug || '').trim() !== '') {
    normalized = normalizeSlug(slug)
    if (!isValidSlug(normalized) || isReservedSlug(normalized)) return res.status(400).json({ message: 'Slug inválido' })
    const exists = await prisma.menu.findFirst({ where: { slug: normalized } })
    if (exists) return res.status(400).json({ message: 'Slug já em uso' })
  } else {
    const base = normalizeSlug(name)
    if (isValidSlug(base) && !isReservedSlug(base)) {
      let candidate = base
      let attempt = 1
      while (attempt <= 20) {
        const exists = await prisma.menu.findFirst({ where: { slug: candidate } })
        if (!exists) { normalized = candidate; break }
        candidate = `${base}-${attempt + 1}`
        attempt++
      }
    }
  }

  // SaaS limit: ensure menu count does not exceed plan
  try { await assertLimit(companyId, 'menus') } catch (e) {
    const status = e && e.statusCode ? e.statusCode : 403
    return res.status(status).json({ message: e?.message || 'Limite de cardápios atingido para seu plano' })
  }

  // CARDAPIO_SIMPLES: forçar modo catálogo (sem entrega/retirada)
  const simplesOnly = await isCardapioSimplesOnly(companyId)
  const effectiveAllowDelivery = simplesOnly ? false : !!allowDelivery
  const effectiveAllowPickup   = simplesOnly ? false : !!allowPickup
  const effectiveCatalogMode   = simplesOnly ? true  : !!catalogMode

  const created = await prisma.menu.create({ data: { name, description, storeId, logoUrl, position: Number(position || 0), isActive: Boolean(isActive), slug: normalized, address: address || null, phone: phone || null, whatsapp: whatsapp || null, timezone: timezone || null, weeklySchedule: weeklySchedule || null, open24Hours: !!open24Hours, allowDelivery: effectiveAllowDelivery, allowPickup: effectiveAllowPickup, catalogMode: effectiveCatalogMode } })
  res.status(201).json(created)
})

// GET /menu/menus/check-slug?slug=xxx - check if a menu slug is available
router.get('/menus/check-slug', async (req, res) => {
  try {
    const raw = String(req.query.slug || '').trim()
    if (!raw) return res.json({ available: false, reason: 'empty' })
    const slug = normalizeSlug(raw)
    if (!isValidSlug(slug) || isReservedSlug(slug)) return res.json({ available: false, reason: 'invalid', slug })
    const exists = await prisma.menu.findFirst({ where: { slug }, select: { id: true } })
    res.json({ available: !exists, slug })
  } catch (e) {
    res.status(500).json({ available: false, reason: 'error' })
  }
})

// GET /menu/menus/:id
router.get('/menus/:id', async (req, res) => {
  const { id } = req.params
  const companyId = req.user.companyId
  const row = await prisma.menu.findFirst({ where: { id }, include: { store: true } })
  if (!row) return res.status(404).json({ message: 'Menu não encontrado' })
  // ensure company scoping: menu.store.companyId should match or categories/products belong to company
  // allow admins to fetch regardless, but be conservative and check store->companyId when store linked
  if (row.store && row.store.companyId !== companyId) return res.status(404).json({ message: 'Menu não encontrado' })
  res.json(row)
})

// PATCH /menu/menus/:id
router.patch('/menus/:id', requireRole('ADMIN', 'ATTENDANT'), async (req, res) => {
  const { id } = req.params
  const companyId = req.user.companyId
  const userRole = String(req.user.role || '').toUpperCase()
  const existing = await prisma.menu.findUnique({ where: { id }, include: { store: true } })
  if (!existing) return res.status(404).json({ message: 'Menu não encontrado' })
  if (existing.store && existing.store.companyId !== companyId) return res.status(404).json({ message: 'Menu não encontrado' })
  // ATTENDANT can only toggle isActive
  if (userRole === 'ATTENDANT') {
    if (req.body && Object.keys(req.body).some(k => k !== 'isActive')) {
      return res.status(403).json({ message: 'Atendentes só podem pausar/ativar itens' })
    }
  }
  const { name, description, storeId, logoUrl, bannerUrl, isActive, position, slug = undefined, address, phone, whatsapp, timezone, weeklySchedule, open24Hours, allowDelivery, allowPickup, catalogMode } = req.body || {}
  if (storeId) {
    const st = await prisma.store.findUnique({ where: { id: storeId } })
    if (!st || st.companyId !== companyId) return res.status(400).json({ message: 'Loja inválida' })
  }
  // handle slug updates (allow clearing when empty string provided)
  let slugValue = existing.slug || null
  if (slug !== undefined) {
    if (slug === null || String(slug || '').trim() === '') {
      slugValue = null
    } else {
      const normalized = normalizeSlug(slug)
      if (!isValidSlug(normalized) || isReservedSlug(normalized)) return res.status(400).json({ message: 'Slug inválido' })
      const conflict = await prisma.menu.findFirst({ where: { slug: normalized, NOT: { id } } })
      if (conflict) return res.status(400).json({ message: 'Slug já em uso' })
      slugValue = normalized
    }
  }

  // CARDAPIO_SIMPLES: forçar modo catálogo (sem entrega/retirada)
  const simplesOnly = await isCardapioSimplesOnly(companyId)
  const finalAllowDelivery = simplesOnly ? false : (allowDelivery !== undefined ? !!allowDelivery : existing.allowDelivery)
  const finalAllowPickup   = simplesOnly ? false : (allowPickup   !== undefined ? !!allowPickup   : existing.allowPickup)
  const finalCatalogMode   = simplesOnly ? true  : (catalogMode   !== undefined ? !!catalogMode   : existing.catalogMode)

  // When open24Hours is enabled, clear weeklySchedule to avoid conflicts
  const finalOpen24Hours = open24Hours !== undefined ? !!open24Hours : existing.open24Hours
  let finalWeeklySchedule = weeklySchedule !== undefined ? weeklySchedule : existing.weeklySchedule
  if (finalOpen24Hours) finalWeeklySchedule = null

  const updated = await prisma.menu.update({ where: { id }, data: { name: name ?? existing.name, description: description ?? existing.description, storeId: storeId !== undefined ? storeId : existing.storeId, logoUrl: logoUrl ?? existing.logoUrl, bannerUrl: bannerUrl ?? existing.bannerUrl, isActive: isActive !== undefined ? Boolean(isActive) : existing.isActive, position: position !== undefined ? Number(position) : existing.position, slug: slugValue, address: address !== undefined ? address : existing.address, phone: phone !== undefined ? phone : existing.phone, whatsapp: whatsapp !== undefined ? whatsapp : existing.whatsapp, timezone: timezone !== undefined ? timezone : existing.timezone, weeklySchedule: finalWeeklySchedule, open24Hours: finalOpen24Hours, allowDelivery: finalAllowDelivery, allowPickup: finalAllowPickup, catalogMode: finalCatalogMode } })

  // Emit real-time socket event so public menus react immediately when a menu is toggled
  try {
    const io = req && req.app && req.app.locals && req.app.locals.io ? req.app.locals.io : null
    if (io) {
      const resolvedStoreId = updated.storeId || existing.storeId
      const meta = { isActive: updated.isActive, menuId: updated.id }
      const payload = { storeId: resolvedStoreId, companyId: companyId, menuId: updated.id, changedKeys: Object.keys(req.body || {}), meta }
      io.to(`company_${companyId}`).emit('store-settings-updated', payload)
    }
  } catch (e) { /* non-fatal */ }

  res.json(updated)
})

// DELETE /menu/menus/:id
router.delete('/menus/:id', requireRole('ADMIN'), async (req, res) => {
  const { id } = req.params
  const companyId = req.user.companyId
  const existing = await prisma.menu.findUnique({ where: { id }, include: { store: true } })
  if (!existing) return res.status(404).json({ message: 'Menu não encontrado' })
  if (existing.store && existing.store.companyId !== companyId) return res.status(404).json({ message: 'Menu não encontrado' })
  await prisma.menu.delete({ where: { id } })
  res.json({ message: 'Removido' })
})

// ------- Categories -------
router.get('/categories', async (req, res) => {
  const companyId = req.user.companyId
  const { menuId } = req.query || {}
  const where = { companyId }
  if (menuId) where.menuLinks = { some: { menuId } }
  const rows = await prisma.menuCategory.findMany({
    where,
    orderBy: { position: 'asc' },
    include: { menuLinks: { include: { menu: { select: { id: true, name: true } } }, orderBy: { position: 'asc' } } }
  })
  res.json(rows)
})

// GET /menu/categories/:id -> get single category (company-scoped)
router.get('/categories/:id', async (req, res) => {
  const { id } = req.params
  const companyId = req.user.companyId
  try {
    const row = await prisma.menuCategory.findFirst({
      where: { id, companyId },
      include: { menuLinks: { include: { menu: { select: { id: true, name: true } } }, orderBy: { position: 'asc' } } }
    })
    if (!row) return res.status(404).json({ message: 'Categoria não encontrada' })
    return res.json(row)
  } catch (e) {
    console.error('GET /categories/:id error', e)
    return res.status(500).json({ message: 'Erro ao carregar categoria', error: String(e && e.message) })
  }
})

router.post('/categories', requireRole('ADMIN'), async (req, res) => {
  const companyId = req.user.companyId
  const { name, position = 0, isActive = true, menuId = null, menuIds = null, dadosFiscaisId = null, description = null, alwaysAvailable = true, weeklySchedule = null } = req.body || {}
  if (!name) return res.status(400).json({ message: 'Nome é obrigatório' })

  // Build the list of menu IDs to link (accept menuIds array or single menuId for backward compat)
  const resolvedMenuIds = Array.isArray(menuIds) ? menuIds : (menuId ? [menuId] : [])

  // Validate all menu IDs belong to this company
  for (const mid of resolvedMenuIds) {
    const menu = await prisma.menu.findUnique({ where: { id: mid }, include: { store: true } })
    if (!menu) return res.status(400).json({ message: 'Menu inválido' })
    if (!menu.store || menu.store.companyId !== companyId) return res.status(400).json({ message: 'Menu inválido para esta empresa' })
  }

  // Backward compat: set legacy menuId to the first linked menu (or null)
  const legacyMenuId = resolvedMenuIds.length > 0 ? resolvedMenuIds[0] : null

  const created = await prisma.$transaction(async (tx) => {
    const cat = await tx.menuCategory.create({ data: { companyId, name, position: Number(position || 0), isActive: Boolean(isActive), menuId: legacyMenuId, dadosFiscaisId: dadosFiscaisId || null, alwaysAvailable: alwaysAvailable !== false, weeklySchedule: alwaysAvailable === false ? (weeklySchedule || null) : null } })

    // Create N:N join links
    if (resolvedMenuIds.length > 0) {
      await tx.menuCategoryMenu.createMany({
        data: resolvedMenuIds.map((mid, idx) => ({ menuCategoryId: cat.id, menuId: mid, position: idx }))
      })
    }

    return tx.menuCategory.findUnique({
      where: { id: cat.id },
      include: { menuLinks: { include: { menu: { select: { id: true, name: true } } }, orderBy: { position: 'asc' } } }
    })
  })

  res.status(201).json(created)
})

router.patch('/categories/:id', requireRole('ADMIN', 'ATTENDANT'), async (req, res) => {
  const { id } = req.params
  const companyId = req.user.companyId
  const userRole = String(req.user.role || '').toUpperCase()
  const existing = await prisma.menuCategory.findFirst({ where: { id, companyId } })
  if (!existing) return res.status(404).json({ message: 'Categoria não encontrada' })
  // ATTENDANT can only toggle isActive
  if (userRole === 'ATTENDANT') {
    if (req.body && Object.keys(req.body).some(k => k !== 'isActive')) {
      return res.status(403).json({ message: 'Atendentes só podem pausar/ativar itens' })
    }
  }
  const { name, position, isActive, dadosFiscaisId, alwaysAvailable, weeklySchedule } = req.body || {}
  const updated = await prisma.menuCategory.update({ where: { id }, data: {
    name: name ?? existing.name,
    position: position !== undefined ? Number(position) : existing.position,
    isActive: isActive !== undefined ? Boolean(isActive) : existing.isActive,
    dadosFiscaisId: dadosFiscaisId !== undefined ? (dadosFiscaisId || null) : existing.dadosFiscaisId,
    alwaysAvailable: alwaysAvailable !== undefined ? Boolean(alwaysAvailable) : existing.alwaysAvailable,
    weeklySchedule: alwaysAvailable !== undefined
      ? (alwaysAvailable === false ? (weeklySchedule || null) : null)
      : (weeklySchedule !== undefined ? weeklySchedule : existing.weeklySchedule),
  }, include: { menuLinks: { include: { menu: { select: { id: true, name: true } } }, orderBy: { position: 'asc' } } } })
  res.json(updated)
})

// POST /menu/categories/:id/menus — sync menu links for a category
router.post('/categories/:id/menus', requireRole('ADMIN'), async (req, res) => {
  const { id } = req.params
  const companyId = req.user.companyId
  const { menuIds = [] } = req.body || {}

  if (!Array.isArray(menuIds)) return res.status(400).json({ message: 'menuIds deve ser um array' })

  const existing = await prisma.menuCategory.findFirst({ where: { id, companyId } })
  if (!existing) return res.status(404).json({ message: 'Categoria não encontrada' })

  // Validate all menu IDs belong to this company
  for (const mid of menuIds) {
    const menu = await prisma.menu.findUnique({ where: { id: mid }, include: { store: true } })
    if (!menu) return res.status(400).json({ message: 'Menu inválido' })
    if (!menu.store || menu.store.companyId !== companyId) return res.status(400).json({ message: 'Menu inválido para esta empresa' })
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      // Delete all existing links for this category
      await tx.menuCategoryMenu.deleteMany({ where: { menuCategoryId: id } })

      // Create new links
      if (menuIds.length > 0) {
        await tx.menuCategoryMenu.createMany({
          data: menuIds.map((mid, idx) => ({ menuCategoryId: id, menuId: mid, position: idx }))
        })
      }

      // Backward compat: update legacy menuId to first linked menu or null
      const legacyMenuId = menuIds.length > 0 ? menuIds[0] : null
      await tx.menuCategory.update({ where: { id }, data: { menuId: legacyMenuId } })

      return tx.menuCategory.findUnique({
        where: { id },
        include: { menuLinks: { include: { menu: { select: { id: true, name: true } } }, orderBy: { position: 'asc' } } }
      })
    })

    res.json(updated)
  } catch (e) {
    console.error('POST /categories/:id/menus error', e)
    res.status(500).json({ message: 'Erro ao sincronizar menus', error: e?.message || String(e) })
  }
})

// POST /menu/reorder — atomic bulk reorder of categories and products
// Body: { categories?: [{id, position}], products?: [{id, position, categoryId?}] }
router.post('/reorder', requireRole('ADMIN'), async (req, res) => {
  const companyId = req.user.companyId
  const { categories = [], products = [], optionGroups = [], options = [] } = req.body || {}
  try {
    await prisma.$transaction(async (tx) => {
      for (const c of Array.isArray(categories) ? categories : []) {
        if (!c?.id) continue
        const existing = await tx.menuCategory.findFirst({ where: { id: c.id, companyId } })
        if (!existing) continue
        await tx.menuCategory.update({
          where: { id: c.id },
          data: { position: Number(c.position) || 0 },
        })
      }
      for (const p of Array.isArray(products) ? products : []) {
        if (!p?.id) continue
        const existing = await tx.product.findFirst({ where: { id: p.id, companyId } })
        if (!existing) continue
        const data = { position: Number(p.position) || 0 }
        if (p.categoryId !== undefined) {
          if (p.categoryId === null) {
            data.categoryId = null
          } else {
            const cat = await tx.menuCategory.findFirst({ where: { id: p.categoryId, companyId } })
            if (cat) data.categoryId = p.categoryId
          }
        }
        await tx.product.update({ where: { id: p.id }, data })
      }
      for (const g of Array.isArray(optionGroups) ? optionGroups : []) {
        if (!g?.id) continue
        const existing = await tx.optionGroup.findFirst({ where: { id: g.id, companyId } })
        if (!existing) continue
        await tx.optionGroup.update({ where: { id: g.id }, data: { position: Number(g.position) || 0 } })
      }
      for (const o of Array.isArray(options) ? options : []) {
        if (!o?.id) continue
        const existing = await tx.option.findFirst({ where: { id: o.id, group: { companyId } } })
        if (!existing) continue
        await tx.option.update({ where: { id: o.id }, data: { position: Number(o.position) || 0 } })
      }
    })
    return res.json({ ok: true })
  } catch (e) {
    console.error('POST /menu/reorder error', e)
    return res.status(500).json({ message: e?.message || 'Erro ao reordenar' })
  }
})

router.delete('/categories/:id', requireRole('ADMIN'), async (req, res) => {
  const { id } = req.params
  const companyId = req.user.companyId
  const existing = await prisma.menuCategory.findFirst({ where: { id, companyId } })
  if (!existing) return res.status(404).json({ message: 'Categoria não encontrada' })

  // set products' categoryId to null instead of deleting products
  await prisma.product.updateMany({ where: { categoryId: id }, data: { categoryId: null } })
  await prisma.menuCategory.delete({ where: { id } })
  res.json({ message: 'Removida' })
})

// Duplicate category and its products (atomic server-side)
router.post('/categories/:id/duplicate', requireRole('ADMIN'), async (req, res) => {
  const { id } = req.params
  const companyId = req.user.companyId

  // load category, its products, and menu links
  const existing = await prisma.menuCategory.findFirst({ where: { id, companyId }, include: { products: true, menuLinks: true } })
  if (!existing) return res.status(404).json({ message: 'Categoria não encontrada' })

  const copiedFiles = []
  try {
    await prisma.$transaction(async (tx) => {
      const newCat = await tx.menuCategory.create({ data: {
        companyId,
        name: `${existing.name} (copy)`,
        position: (existing.position ?? 0) + 1,
        isActive: existing.isActive ?? true,
        menuId: existing.menuId || null
      } })

      // duplicate menu links (N:N)
      if (existing.menuLinks && existing.menuLinks.length > 0) {
        await tx.menuCategoryMenu.createMany({
          data: existing.menuLinks.map(link => ({ menuCategoryId: newCat.id, menuId: link.menuId, position: link.position }))
        })
      }

      // duplicate each product
      for (const p of (existing.products || [])) {
        const prod = await tx.product.create({ data: {
          companyId,
          name: `${p.name} (copy)`,
          description: p.description ?? null,
          price: p.price ?? 0,
          position: (p.position ?? 0) + 1,
          isActive: p.isActive ?? true,
          categoryId: newCat.id,
          image: null
        } })

        // copy option-group relations
        const attached = await tx.productOptionGroup.findMany({ where: { productId: p.id } })
        if (attached && attached.length) {
          const data = attached.map(a => ({ productId: prod.id, groupId: a.groupId }))
          await tx.productOptionGroup.createMany({ data })
        }

        // copy and optimize image file if it resides under our uploads folder
        try {
          if (p.image && typeof p.image === 'string' && p.image.includes('/public/uploads/products/')) {
            const filename = path.basename(p.image)
            const srcPath = path.join(process.cwd(), 'public', 'uploads', 'products', filename)
            if (fs.existsSync(srcPath)) {
              const srcBuffer = fs.readFileSync(srcPath)
              const { optimized, thumbnail } = await optimizeForWeb(srcBuffer)
              const destName = `${prod.id}.webp`
              const thumbName = `${prod.id}_thumb.webp`
              const uploadsDir = path.join(process.cwd(), 'public', 'uploads', 'products')
              fs.writeFileSync(path.join(uploadsDir, destName), optimized)
              fs.writeFileSync(path.join(uploadsDir, thumbName), thumbnail)
              copiedFiles.push(path.join(uploadsDir, destName), path.join(uploadsDir, thumbName))
              const publicUrl = `/public/uploads/products/${destName}`
              await tx.product.update({ where: { id: prod.id }, data: { image: publicUrl } })
            }
          }
        } catch (e) {
          // if image copy fails for a product, throw to trigger transaction rollback and cleanup
          console.error('Failed to copy image for product during duplication', p.id, e)
          throw e
        }
      }
    })

    res.status(201).json({ message: 'Categoria e produtos duplicados' })
  } catch (e) {
    // cleanup any files that were copied before the error
    for (const f of copiedFiles) {
      try { fs.unlinkSync(f) } catch (err) { /* ignore */ }
    }
    console.error('Error duplicating category:', e)
    res.status(500).json({ message: 'Falha ao duplicar categoria', error: e?.message || String(e) })
  }
})

// ------- Products -------
router.get('/products', async (req, res) => {
  const companyId = req.user.companyId
  const { categoryId } = req.query
  const where = { companyId }
  if (categoryId) where.categoryId = categoryId
  // support filtering by menuId — include products with direct menuId OR in categories linked via join table
  const { menuId } = req.query
  if (menuId) {
    where.OR = [
      { menuId },
      { category: { menuLinks: { some: { menuId } } } }
    ]
  }
  const rows = await prisma.product.findMany({ where, orderBy: { position: 'asc' }, include: { menu: { select: { name: true } }, category: { select: { name: true } }, technicalSheet: { select: { id: true, name: true } }, stockIngredient: { select: { id: true, description: true } } } })

  // Enrich products with aiEnhanced flag from Media table
  const imageUrls = rows.filter(r => r.image).map(r => r.image)
  let aiEnhancedMap = {}
  if (imageUrls.length) {
    const mediaRows = await prisma.media.findMany({ where: { companyId, url: { in: imageUrls }, aiEnhanced: true }, select: { url: true } })
    for (const m of mediaRows) aiEnhancedMap[m.url] = true
  }
  const enriched = rows.map(r => ({ ...r, imageAiEnhanced: r.image ? (aiEnhancedMap[r.image] || false) : false }))

  res.json(enriched)
})

router.post('/products', requireRole('ADMIN'), async (req, res) => {
  // Add defensive logging to help debug silent failures when creating products
  const companyId = req.user?.companyId
  const body = req.body || {}
  console.log('POST /menu/products called', { body, user: req.user ? { id: req.user.id, companyId: req.user.companyId, role: req.user.role } : null })

  try {
  const { name, description, price = 0, categoryId = null, position = 0, isActive = true, image, menuId = null, technicalSheetId = null, stockIngredientId = null, cashbackPercent = undefined, dadosFiscaisId = null, highlightOnSlip = false, featured = false, alwaysAvailable = true, weeklySchedule = null } = body
    if (!name) return res.status(400).json({ message: 'Nome é obrigatório' })

    if (!companyId) {
      console.warn('POST /menu/products: request missing companyId on token payload', { user: req.user })
      return res.status(400).json({ message: 'Empresa (companyId) ausente no token' })
    }

    // validate menuId if provided
    if (menuId) {
      const menu = await prisma.menu.findUnique({ where: { id: menuId }, include: { store: true } })
      if (!menu) return res.status(400).json({ message: 'Menu inválido' })
      if (!menu.store || menu.store.companyId !== companyId) return res.status(400).json({ message: 'Menu inválido para esta empresa' })
    }
    // validate technicalSheetId if provided
    if (technicalSheetId) {
      const sheet = await prisma.technicalSheet.findUnique({ where: { id: technicalSheetId } })
      if (!sheet || sheet.companyId !== companyId) return res.status(400).json({ message: 'Ficha técnica inválida' })
    }
    // validate stockIngredientId (direct stock link for resale products)
    if (stockIngredientId && technicalSheetId) {
      return res.status(400).json({ message: 'Produto não pode ter ficha técnica e ingrediente de estoque ao mesmo tempo' })
    }
    if (stockIngredientId) {
      const ing = await prisma.ingredient.findFirst({ where: { id: stockIngredientId, companyId, controlsStock: true } })
      if (!ing) return res.status(400).json({ message: 'Ingrediente de estoque inválido' })
    }
    const integrationCode = await generateProductCode(companyId)
    const created = await prisma.product.create({ data: { companyId, name, description, price: Number(price), categoryId, position: Number(position), isActive: Boolean(isActive), image: null, menuId, technicalSheetId, stockIngredientId, cashbackPercent: cashbackPercent !== undefined ? Number(cashbackPercent) : null, dadosFiscaisId: dadosFiscaisId || null, highlightOnSlip: Boolean(highlightOnSlip), featured: Boolean(featured), integrationCode, alwaysAvailable: alwaysAvailable !== false, weeklySchedule: alwaysAvailable === false ? (weeklySchedule || null) : null } })
    console.log('Product created successfully', { id: created.id, companyId: created.companyId })

    // If client included image as base64 in the payload, decode and persist as file, then update product.image to public URL
    if (image && typeof image === 'string' && image.startsWith('data:')) {
      try {
        const matches = image.match(/^data:(image\/[^;]+);base64,(.+)$/)
        let ext = 'jpg'
        let data = image
        if (matches) {
          const mime = matches[1]
          data = matches[2]
          ext = (mime.split('/')[1] || 'jpg').toLowerCase()
          if (ext === 'jpeg') ext = 'jpg'
          if (ext.includes('+')) ext = ext.split('+')[0]
        }
        const buffer = Buffer.from(data, 'base64')
        const uploadsDir = path.join(process.cwd(), 'public', 'uploads', 'products')
        await fs.promises.mkdir(uploadsDir, { recursive: true })
        // remove any previous files for this product id
        try {
          const files = await fs.promises.readdir(uploadsDir)
          for (const f of files) {
            if (f.startsWith(`${created.id}.`) || f.startsWith(`${created.id}_thumb.`)) {
              try { await fs.promises.unlink(path.join(uploadsDir, f)) } catch (er) { /* ignore unlink errors */ }
            }
          }
        } catch (e) {
          // ignore readdir errors, continue to write
        }
        const { optimized, thumbnail } = await optimizeForWeb(buffer)
        const outName = `${created.id}.webp`
        const thumbName = `${created.id}_thumb.webp`
        await Promise.all([
          fs.promises.writeFile(path.join(uploadsDir, outName), optimized),
          fs.promises.writeFile(path.join(uploadsDir, thumbName), thumbnail),
        ])
  const publicUrl = `/public/uploads/products/${outName}`
  await prisma.product.update({ where: { id: created.id }, data: { image: publicUrl } })
  created.image = publicUrl
        console.log('Saved initial image for product', created.id, publicUrl)
      } catch (e) {
        console.error('Failed to save initial base64 image for product', created.id, e)
        // continue and return created product without image field set
      }
    }

    return res.status(201).json(created)
  } catch (e) {
    console.error('Error creating product:', e?.message || e)
    return res.status(500).json({ message: 'Falha ao criar produto', error: e?.message || String(e) })
  }
})

router.patch('/products/:id', requireRole('ADMIN', 'ATTENDANT'), async (req, res) => {
  const { id } = req.params
  const companyId = req.user.companyId
  const userRole = String(req.user.role || '').toUpperCase()
  const existing = await prisma.product.findFirst({ where: { id, companyId } })
  if (!existing) return res.status(404).json({ message: 'Produto não encontrado' })
  // ATTENDANT can only toggle isActive
  if (userRole === 'ATTENDANT') {
    if (req.body && Object.keys(req.body).some(k => k !== 'isActive')) {
      return res.status(403).json({ message: 'Atendentes só podem pausar/ativar itens' })
    }
  }
  const { name, description, price, categoryId, position, isActive, image, menuId, technicalSheetId, stockIngredientId, cashbackPercent, dadosFiscaisId, highlightOnSlip, featured, alwaysAvailable, weeklySchedule } = req.body || {}

  // If the incoming image is a base64 data URL, persist it to disk and replace with public URL
  let imageValue = existing.image
  if (image !== undefined) {
    if (typeof image === 'string' && image.startsWith('data:')) {
      try {
        const matches = image.match(/^data:(image\/[^;]+);base64,(.+)$/)
        let ext = 'jpg'
        let data = image
        if (matches) {
          const mime = matches[1]
          data = matches[2]
          ext = (mime.split('/')[1] || 'jpg').toLowerCase()
          if (ext === 'jpeg') ext = 'jpg'
          if (ext.includes('+')) ext = ext.split('+')[0]
        }
        const buffer = Buffer.from(data, 'base64')
        const uploadsDir = path.join(process.cwd(), 'public', 'uploads', 'products')
        await fs.promises.mkdir(uploadsDir, { recursive: true })
        // remove any previous files for this product id
        try {
          const files = await fs.promises.readdir(uploadsDir)
          for (const f of files) {
            if (f.startsWith(`${id}.`) || f.startsWith(`${id}_thumb.`)) {
              try { await fs.promises.unlink(path.join(uploadsDir, f)) } catch (er) { /* ignore unlink errors */ }
            }
          }
        } catch (e) {
          // ignore readdir errors
        }
        const { optimized, thumbnail } = await optimizeForWeb(buffer)
        const outName = `${id}.webp`
        const thumbName = `${id}_thumb.webp`
        await Promise.all([
          fs.promises.writeFile(path.join(uploadsDir, outName), optimized),
          fs.promises.writeFile(path.join(uploadsDir, thumbName), thumbnail),
        ])
  const publicUrl = `/public/uploads/products/${outName}`
  imageValue = publicUrl
      } catch (e) {
        console.error('Failed to persist base64 image on product update for', id, e)
        // keep imageValue as existing.image (no change)
      }
    } else {
      imageValue = image
    }
  }

  // validate menuId if provided
  if (menuId) {
    const menu = await prisma.menu.findUnique({ where: { id: menuId }, include: { store: true } })
    if (!menu) return res.status(400).json({ message: 'Menu inválido' })
    if (!menu.store || menu.store.companyId !== companyId) return res.status(400).json({ message: 'Menu inválido para esta empresa' })
  }

  // validate technicalSheetId if provided
  if (technicalSheetId) {
    const sheet = await prisma.technicalSheet.findUnique({ where: { id: technicalSheetId } })
    if (!sheet || sheet.companyId !== companyId) return res.status(400).json({ message: 'Ficha técnica inválida' })
  }
  // validate stockIngredientId (direct stock link for resale products)
  if (stockIngredientId) {
    const ing = await prisma.ingredient.findFirst({ where: { id: stockIngredientId, companyId, controlsStock: true } })
    if (!ing) return res.status(400).json({ message: 'Ingrediente de estoque inválido' })
  }
  const finalTechSheet = technicalSheetId !== undefined ? technicalSheetId : existing.technicalSheetId
  const finalStockIng = stockIngredientId !== undefined ? stockIngredientId : existing.stockIngredientId
  if (finalTechSheet && finalStockIng) {
    return res.status(400).json({ message: 'Produto não pode ter ficha técnica e ingrediente de estoque ao mesmo tempo' })
  }

  const updated = await prisma.product.update({ where: { id }, data: {
    name: name ?? existing.name,
    description: description ?? existing.description,
    price: price !== undefined ? Number(price) : existing.price,
    categoryId: categoryId !== undefined ? categoryId : existing.categoryId,
    position: position !== undefined ? Number(position) : existing.position,
    isActive: isActive !== undefined ? Boolean(isActive) : existing.isActive,
    image: imageValue,
    menuId: menuId !== undefined ? menuId : existing.menuId,
    technicalSheetId: technicalSheetId !== undefined ? technicalSheetId : existing.technicalSheetId,
    stockIngredientId: stockIngredientId !== undefined ? stockIngredientId : existing.stockIngredientId
  ,
    // set cashbackPercent if provided (allow null to clear)
    cashbackPercent: cashbackPercent !== undefined ? (cashbackPercent === null ? null : Number(cashbackPercent)) : existing.cashbackPercent,
    dadosFiscaisId: dadosFiscaisId !== undefined ? (dadosFiscaisId || null) : existing.dadosFiscaisId,
    highlightOnSlip: highlightOnSlip !== undefined ? Boolean(highlightOnSlip) : existing.highlightOnSlip,
    featured: featured !== undefined ? Boolean(featured) : existing.featured,
    alwaysAvailable: alwaysAvailable !== undefined ? Boolean(alwaysAvailable) : existing.alwaysAvailable,
    weeklySchedule: alwaysAvailable !== undefined
      ? (alwaysAvailable === false ? (weeklySchedule || null) : null)
      : (weeklySchedule !== undefined ? weeklySchedule : existing.weeklySchedule)
  } })
  res.json(updated)
})

// Upload product image via base64 payload
router.post('/products/:id/image', requireRole('ADMIN'), async (req, res) => {
  const { id } = req.params
  const companyId = req.user.companyId
  const { imageBase64, filename } = req.body || {}
  if (!imageBase64) return res.status(400).json({ message: 'imageBase64 is required' })
  const existing = await prisma.product.findFirst({ where: { id, companyId } })
  if (!existing) return res.status(404).json({ message: 'Produto não encontrado' })

  // decode base64 and write to public/uploads/products/<id>.<ext>
  try {
    const matches = imageBase64.match(/^data:(image\/[^;]+);base64,(.+)$/)
    let ext = 'jpg'
    let data = imageBase64
    if (matches) {
      const mime = matches[1]
      data = matches[2]
      ext = (mime.split('/')[1] || 'jpg').toLowerCase()
      // normalize common variants
      if (ext === 'jpeg') ext = 'jpg'
      if (ext.includes('+')) ext = ext.split('+')[0]
    }
  const buffer = Buffer.from(data, 'base64')
    const uploadsDir = path.join(process.cwd(), 'public', 'uploads', 'products')
    try {
      await fs.promises.mkdir(uploadsDir, { recursive: true })
    } catch (e) {
      console.error('Failed to create uploads directory:', uploadsDir, e)
      return res.status(500).json({ message: 'Falha ao criar pasta de uploads', error: e?.message || String(e) })
    }

    const { optimized, thumbnail } = await optimizeForWeb(buffer)
    const outName = `${id}.webp`
    const thumbName = `${id}_thumb.webp`
    try {
      await Promise.all([
        fs.promises.writeFile(path.join(uploadsDir, outName), optimized),
        fs.promises.writeFile(path.join(uploadsDir, thumbName), thumbnail),
      ])
    } catch (e) {
      console.error('Failed to write product image file:', e)
      return res.status(500).json({ message: 'Falha ao salvar arquivo de imagem', error: e?.message || String(e) })
    }

    const publicUrl = `/public/uploads/products/${outName}`
    try {
      const updated = await prisma.product.update({ where: { id }, data: { image: publicUrl } })
      console.log('Product image field updated to:', publicUrl)
      return res.json(updated)
    } catch (e) {
      console.error('Failed to update product image field in DB for id', id, e)
      // attempt to remove the file we just wrote to avoid orphaned files
      try { await fs.promises.unlink(outPath) } catch (err) { /* ignore */ }
      return res.status(500).json({ message: 'Falha ao atualizar produto com imagem', error: e?.message || String(e) })
    }
  } catch (e) {
    console.error(e)
    res.status(500).json({ message: 'Falha ao salvar imagem', error: e.message })
  }
})

router.delete('/products/:id', requireRole('ADMIN'), async (req, res) => {
  const { id } = req.params
  const companyId = req.user.companyId
  try {
    const existing = await prisma.product.findFirst({ where: { id, companyId } })
    if (!existing) return res.status(404).json({ message: 'Produto não encontrado' })
    await prisma.$transaction(async (tx) => {
      // Remove option group links
      await tx.productOptionGroup.deleteMany({ where: { productId: id } })
      // Unlink options that reference this product
      await tx.option.updateMany({ where: { linkedProductId: id }, data: { linkedProductId: null } })
      // Delete the product
      await tx.product.delete({ where: { id } })
    })
    res.json({ message: 'Removido' })
  } catch (e) {
    console.error('DELETE /products/:id error', e)
    res.status(500).json({ message: e?.message || 'Erro ao remover produto' })
  }
})

// Duplicate a product (and its attached OptionGroup links) atomically.
// Shared FKs (categoryId, menuId, technicalSheetId, dadosFiscaisId, groupId) are preserved.
// The new product starts active (isActive: true) and keeps the same image URL.
router.post('/products/:id/duplicate', requireRole('ADMIN'), async (req, res) => {
  try {
    const companyId = req.user.companyId
    const source = await prisma.product.findFirst({
      where: { id: req.params.id, companyId },
      include: { productOptionGroups: true },
    })
    if (!source) return res.status(404).json({ message: 'Produto não encontrado' })

    const existing = await prisma.product.findMany({
      where: { companyId },
      select: { name: true },
    })
    const newName = makeCopyName(source.name, existing.map(r => r.name))

    // Generate a fresh integrationCode so the copy doesn't collide with the original.
    let integrationCode = null
    try { integrationCode = await generateProductCode(companyId) } catch (e) { integrationCode = null }

    const created = await prisma.$transaction(async (tx) => {
      const prod = await tx.product.create({
        data: {
          companyId,
          name: newName,
          description: source.description,
          price: source.price,
          cashbackPercent: source.cashbackPercent,
          categoryId: source.categoryId,
          menuId: source.menuId,
          technicalSheetId: source.technicalSheetId,
          dadosFiscaisId: source.dadosFiscaisId,
          packagingCost: source.packagingCost,
          targetMarginPercent: source.targetMarginPercent,
          position: source.position,
          image: source.image,
          isActive: true,
          highlightOnSlip: source.highlightOnSlip,
          integrationCode,
          alwaysAvailable: source.alwaysAvailable,
          weeklySchedule: source.weeklySchedule,
        },
      })

      if (source.productOptionGroups && source.productOptionGroups.length) {
        await tx.productOptionGroup.createMany({
          data: source.productOptionGroups.map(pog => ({
            productId: prod.id,
            groupId: pog.groupId,
          })),
        })
      }

      return tx.product.findUnique({
        where: { id: prod.id },
        include: { menu: { select: { name: true } }, category: { select: { name: true } } },
      })
    })

    res.status(201).json(created)
  } catch (e) {
    console.error('POST /menu/products/:id/duplicate error:', e)
    res.status(500).json({ message: e?.message || 'Erro ao duplicar produto' })
  }
})

// ------- Product <-> OptionGroup associations -------
// GET /products/:id/option-groups -> lists all groups for company and returns attached group ids
router.get('/products/:id/option-groups', async (req, res) => {
  const { id } = req.params
  const companyId = req.user.companyId
  try{
    const groups = await prisma.optionGroup.findMany({ where: { companyId }, orderBy: { position: 'asc' } })
    const attached = await prisma.productOptionGroup.findMany({ where: { productId: id } })
    const attachedIds = attached.map(a=>a.groupId)
    res.json({ groups, attachedIds })
  }catch(e){ console.error('Error loading product option groups', e); res.status(500).json({ message: 'Erro' }) }
})

// POST /products/:id/option-groups -> set product groups (body: { groupIds: [] })
router.post('/products/:id/option-groups', requireRole('ADMIN'), async (req, res) => {
  const { id } = req.params
  const companyId = req.user.companyId
  const { groupIds = [] } = req.body || {}
  try{
    // validate product
    const product = await prisma.product.findFirst({ where: { id, companyId } })
    if(!product) return res.status(404).json({ message: 'Produto não encontrado' })

    // ensure groups belong to company
    if(!Array.isArray(groupIds)) return res.status(400).json({ message: 'groupIds must be an array' })
    const validGroups = await prisma.optionGroup.findMany({ where: { companyId, id: { in: groupIds } } })
    const validIds = validGroups.map(g=>g.id)

    // if some requested groupIds are not valid for this company, reject with details
    const invalidIds = (groupIds || []).filter(gid => !validIds.includes(gid))
    if(invalidIds.length){
      return res.status(400).json({ message: 'Alguns grupos são inválidos ou pertencem a outra empresa', invalidIds })
    }

    // delete existing relations for product
    await prisma.productOptionGroup.deleteMany({ where: { productId: id } })

    // create relations
    if(validIds.length){
      const data = validIds.map(gid => ({ productId: id, groupId: gid }))
      await prisma.productOptionGroup.createMany({ data })
    }

    res.json({ message: 'Associations updated' })
  }catch(e){ console.error('Error updating product option groups', e); res.status(500).json({ message: 'Erro ao atualizar associações' }) }
})

// ------- Payment Methods -------
router.get('/payment-methods', async (req, res) => {
  const companyId = req.user.companyId
  const rows = await prisma.paymentMethod.findMany({ where: { companyId }, orderBy: { createdAt: 'asc' } })
  res.json(rows)
})

router.get('/payment-methods/:id', async (req, res) => {
  const companyId = req.user.companyId
  const row = await prisma.paymentMethod.findFirst({ where: { id: req.params.id, companyId } })
  if (!row) return res.status(404).json({ message: 'Método não encontrado' })
  res.json(row)
})

const PM_EXTRA_FIELDS = ['description','isOnline','noChange','paymentType','cardBrand','taxRate','fixedFee','transferFormat','daysToReceive','accountId','intermediaryName','intermediaryCnpj','platformUserCode']

router.post('/payment-methods', requireRole('ADMIN'), async (req, res) => {
  const companyId = req.user.companyId
  const { name, code, config = {}, isActive = true } = req.body || {}
  if (!name || !code) return res.status(400).json({ message: 'name e code são obrigatórios' })
  const extra = {}
  for (const f of PM_EXTRA_FIELDS) { if (req.body[f] !== undefined) extra[f] = req.body[f] }
  const created = await prisma.paymentMethod.create({ data: { companyId, name, code, config, isActive: Boolean(isActive), ...extra } })
  res.status(201).json(created)
})

router.patch('/payment-methods/:id', requireRole('ADMIN'), async (req, res) => {
  const { id } = req.params
  const companyId = req.user.companyId
  const existing = await prisma.paymentMethod.findFirst({ where: { id, companyId } })
  if (!existing) return res.status(404).json({ message: 'Método não encontrado' })
  const { name, code, config, isActive } = req.body || {}
  const extra = {}
  for (const f of PM_EXTRA_FIELDS) { if (req.body[f] !== undefined) extra[f] = req.body[f] }
  const updated = await prisma.paymentMethod.update({ where: { id }, data: { name: name ?? existing.name, code: code ?? existing.code, config: config ?? existing.config, isActive: isActive !== undefined ? Boolean(isActive) : existing.isActive, ...extra } })
  res.json(updated)
})

router.delete('/payment-methods/:id', requireRole('ADMIN'), async (req, res) => {
  const { id } = req.params
  const companyId = req.user.companyId
  const existing = await prisma.paymentMethod.findFirst({ where: { id, companyId } })
  if (!existing) return res.status(404).json({ message: 'Método não encontrado' })
  // Prevent hard-deletion of the default CASH payment method. Prefer deactivation.
  try{
    if(String((existing.code || '')).toUpperCase() === 'CASH'){
      return res.status(400).json({ message: "A forma 'Dinheiro' (CASH) não pode ser removida. Desative-a em vez disso." })
    }
  }catch(e){ /* ignore and continue */ }

  await prisma.paymentMethod.delete({ where: { id } })
  res.json({ message: 'Removido' })
})

// GET /products/:id/pricing-analysis
router.get('/products/:id/pricing-analysis', async (req, res) => {
  try {
    const product = await prisma.product.findFirst({
      where: { id: req.params.id, companyId: req.user.companyId },
      include: { menu: { include: { store: true } } },
    });
    if (!product) return res.status(404).json({ message: 'Produto não encontrado' });

    let sheetCost = 0;
    if (product.technicalSheetId) {
      const sheet = await prisma.technicalSheet.findUnique({
        where: { id: product.technicalSheetId },
        include: { items: { include: { ingredient: true } } },
      });
      for (const si of sheet?.items || []) {
        if (!si.ingredient) continue;
        const itemUnit = si.unit || si.ingredient.unit;
        if (!areUnitsCompatible(itemUnit, si.ingredient.unit)) continue; // skip legacy bad rows silently
        const qty = normalizeToIngredientUnit(Number(si.quantity || 0), itemUnit, si.ingredient.unit);
        sheetCost += qty * Number(si.ingredient.avgCost || 0);
      }
    }

    const storeId = product.menu?.store?.id || (await prisma.store.findFirst({ where: { companyId: req.user.companyId } }))?.id;
    if (!storeId) return res.status(400).json({ message: 'Nenhuma loja encontrada' });
    const storeDefaults = await getOrCreateDefaults(prisma, storeId);

    const analysis = computePricingAnalysis({
      currentPrice: product.price,
      sheetCost,
      productPackagingCost: product.packagingCost,
      productTargetMargin: product.targetMarginPercent,
      storeDefaults,
    });
    res.json(analysis);
  } catch (e) {
    console.error('GET pricing-analysis error:', e);
    res.status(500).json({ message: e.message });
  }
});

// ---- Inbox automation (outOfHours / greeting) per menu ----
router.patch('/menus/:id/inbox-automation', requireRole('ADMIN'), async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { id } = req.params;
    const menu = await prisma.menu.findFirst({
      where: { id, store: { companyId } },
      select: { id: true },
    });
    if (!menu) return res.status(404).json({ message: 'Cardápio não encontrado' });

    const { outOfHoursReplyId, greetingReplyId } = req.body || {};
    const data = {};
    if (outOfHoursReplyId !== undefined) {
      if (outOfHoursReplyId) {
        const exists = await prisma.quickReply.findFirst({ where: { id: outOfHoursReplyId, companyId }, select: { id: true } });
        if (!exists) return res.status(400).json({ message: 'outOfHoursReplyId inválido' });
      }
      data.outOfHoursReplyId = outOfHoursReplyId || null;
    }
    if (greetingReplyId !== undefined) {
      if (greetingReplyId) {
        const exists = await prisma.quickReply.findFirst({ where: { id: greetingReplyId, companyId }, select: { id: true } });
        if (!exists) return res.status(400).json({ message: 'greetingReplyId inválido' });
      }
      data.greetingReplyId = greetingReplyId || null;
    }

    const updated = await prisma.menu.update({
      where: { id: menu.id },
      data,
      select: { id: true, outOfHoursReplyId: true, greetingReplyId: true },
    });
    res.json(updated);
  } catch (e) {
    console.error('[menu] inbox-automation error:', e);
    res.status(500).json({ message: 'Erro ao salvar automação', error: e.message });
  }
});

export default router
