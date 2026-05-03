// src/routes/stores.js
import express from 'express'
import { prisma } from '../prisma.js'
import { normalizeSlug, isValidSlug, isReservedSlug } from '../utils/slug.js'
import { authMiddleware, requireRole } from '../auth.js'
import { runForceOpenCleanupOnce } from '../cleanupForceOpen.js'
import { encryptText } from '../utils/secretStore.js'
import { assertLimit } from '../utils/saas.js'

import { geocodeAddress } from '../utils/geocode.js'

// helper: geocode a store address using the shared geocoder with city+state context
async function geocodeStoreAddress(address, city, state) {
  if (!address && !city) return null
  const coords = await geocodeAddress(address, { city, state })
  if (coords) return { latitude: coords.lat, longitude: coords.lng }
  return null
}

// helper: persist store settings file under public/uploads/store/<storeId>/settings.json
async function persistStoreSettings(storeId, toSave) {
  try {
    const path = await import('path')
    const fs = await import('fs')
    // Persist settings in both new centralized path (settings/stores/<id>/settings.json)
    // and keep the old public/uploads path for backward compatibility.
    const dirNew = path.join(process.cwd(), 'settings', 'stores', storeId)
    await fs.promises.mkdir(dirNew, { recursive: true })
    const settingsPathNew = path.join(dirNew, 'settings.json')
    let existingNew = {}
    try { if (fs.existsSync(settingsPathNew)) existingNew = JSON.parse(await fs.promises.readFile(settingsPathNew, 'utf8') || '{}') } catch (e) { existingNew = {} }
    const mergedNew = { ...existingNew, ...toSave }
    await fs.promises.writeFile(settingsPathNew, JSON.stringify(mergedNew, null, 2), 'utf8')

    // also write to legacy public/uploads location for compatibility
    try {
      const dirLegacy = path.join(process.cwd(), 'public', 'uploads', 'store', storeId)
      await fs.promises.mkdir(dirLegacy, { recursive: true })
      const settingsPathLegacy = path.join(dirLegacy, 'settings.json')
      let existingLegacy = {}
      try { if (fs.existsSync(settingsPathLegacy)) existingLegacy = JSON.parse(await fs.promises.readFile(settingsPathLegacy, 'utf8') || '{}') } catch (e) { existingLegacy = {} }
      const mergedLegacy = { ...existingLegacy, ...toSave }
      await fs.promises.writeFile(settingsPathLegacy, JSON.stringify(mergedLegacy, null, 2), 'utf8')
    } catch (e) {
      // non-fatal
    }
  } catch (e) {
    console.warn('Failed to persist store settings file', e)
  }
}

async function syncStoreStatusToAiqfome(companyId, storeId, action) {
  try {
    const integ = await prisma.apiIntegration.findFirst({
      where: { companyId, provider: 'AIQFOME', storeId, enabled: true },
    });
    if (!integ || !integ.merchantId || !integ.accessToken) return;
    const { aiqfomePost, aiqfomePut } = await import('../integrations/aiqfome/client.js');
    const aiqStoreId = integ.merchantId;
    if (action === 'open') await aiqfomePost(integ.id, `/api/v2/store/${aiqStoreId}/open`);
    else if (action === 'close') await aiqfomePost(integ.id, `/api/v2/store/${aiqStoreId}/close`);
    else if (action === 'standby') await aiqfomePut(integ.id, `/api/v2/store/${aiqStoreId}/stand-by`);
    console.log(`[aiqfome] Store ${action} synced for store ${aiqStoreId}`);
  } catch (e) {
    console.warn(`[aiqfome] Store sync failed (${action}):`, e?.message);
  }
}

export const storesRouter = express.Router()
storesRouter.use(authMiddleware)

// List stores for the authenticated user's company
storesRouter.get('/', async (req, res) => {
  try {
    const companyId = req.user.companyId
    const rows = await prisma.store.findMany({ where: { companyId }, orderBy: { createdAt: 'asc' } })
    res.json(rows)
  } catch (e) {
    console.error('GET /stores failed', e)
    res.status(500).json({ message: 'Erro ao listar lojas', error: e?.message || String(e) })
  }
})

// POST /stores/geocode-all — batch geocode all stores missing coordinates
storesRouter.post('/geocode-all', requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  try {
    const companyId = req.user.companyId
    const stores = await prisma.store.findMany({
      where: { companyId, latitude: null, address: { not: null } },
      select: { id: true, name: true, address: true, city: true, state: true },
    })
    let updated = 0
    for (const s of stores) {
      const geo = await geocodeStoreAddress(s.address, s.city, s.state)
      if (geo) {
        await prisma.store.update({ where: { id: s.id }, data: { latitude: geo.latitude, longitude: geo.longitude } })
        updated++
      }
      // Nominatim rate limit: 1 req/sec
      if (stores.indexOf(s) < stores.length - 1) await new Promise(r => setTimeout(r, 1100))
    }
    res.json({ total: stores.length, updated })
  } catch (e) {
    console.error('POST /stores/geocode-all failed', e)
    res.status(500).json({ message: 'Erro ao geocodificar lojas' })
  }
})

// Get single store
storesRouter.get('/:id', async (req, res) => {
  try {
    const { id } = req.params
    const companyId = req.user.companyId
    if (!companyId) return res.status(400).json({ message: 'Usuário sem empresa associada' })
    const s = await prisma.store.findFirst({ where: { id, companyId } })
    if (!s) return res.status(404).json({ message: 'Loja não encontrada' })
    // Read and merge both settings files so keys missing from the centralized file
    // (e.g. cnpj written before it existed) are filled from the legacy file.
    // Centralized takes priority on conflicts.
    try {
      const path = await import('path')
      const fs = await import('fs')
      const loadJson = (p) => { try { if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8') || '{}') } catch { } return null }
      const legacySettings = loadJson(path.join(process.cwd(), 'public', 'uploads', 'store', id, 'settings.json'))
      const centralizedSettings = loadJson(path.join(process.cwd(), 'settings', 'stores', id, 'settings.json'))
      const settings = (legacySettings || centralizedSettings)
        ? { ...(legacySettings || {}), ...(centralizedSettings || {}) }
        : null
      if (settings) {
        // Cleanup expired forceOpen flags on read so stale overrides don't persist
        try {
          const cleanupExpiredForceFlags = (obj) => {
            if (!obj || typeof obj !== 'object') return false
            let mutated = false
            const now = Date.now()
            if (obj.forceOpenExpiresAt) {
              const t = Date.parse(String(obj.forceOpenExpiresAt))
              if (!isNaN(t) && t < now) {
                delete obj.forceOpen
                delete obj.forceOpenExpiresAt
                mutated = true
              }
            }
            if (obj.menus && typeof obj.menus === 'object') {
              for (const k of Object.keys(obj.menus)) {
                const m = obj.menus[k]
                if (m && m.forceOpenExpiresAt) {
                  const tt = Date.parse(String(m.forceOpenExpiresAt))
                  if (!isNaN(tt) && tt < now) {
                    delete m.forceOpen
                    delete m.forceOpenExpiresAt
                    mutated = true
                  }
                }
              }
            }
            return mutated
          }

          const mutated = cleanupExpiredForceFlags(settings)
          if (mutated) {
            // write back cleaned settings to both paths (best-effort)
            try {
              const settingsPathNew = path.join(process.cwd(), 'settings', 'stores', id, 'settings.json')
              await fs.promises.mkdir(path.dirname(settingsPathNew), { recursive: true })
              await fs.promises.writeFile(settingsPathNew, JSON.stringify(settings, null, 2), 'utf8')
            } catch (e) { /* non-fatal */ }
            try {
              const settingsPathLegacy = path.join(process.cwd(), 'public', 'uploads', 'store', id, 'settings.json')
              await fs.promises.mkdir(path.dirname(settingsPathLegacy), { recursive: true })
              await fs.promises.writeFile(settingsPathLegacy, JSON.stringify(settings, null, 2), 'utf8')
            } catch (e) { /* non-fatal */ }
          }
        } catch (e) { /* non-fatal cleanup error */ }

        // sanitize: never expose encrypted password blob
        const safe = { ...settings }
        if (safe.certPasswordEnc !== undefined) delete safe.certPasswordEnc
        // attach helpful flags to response so UI can show certificate state
        const certExists = Boolean(settings.certExists)
        const certFilename = settings.certFilename || null
        const certPasswordStored = settings.certPasswordEnc ? true : false
        const merged = { ...s, ...safe, certExists, certFilename, certPasswordStored }
        return res.json(merged)
      }
    } catch (e) {
      console.warn('Failed to load store settings path', e)
    }
    res.json(s)
  } catch (e) {
    console.error('GET /stores/:id failed', e)
    res.status(500).json({ message: 'Erro ao buscar loja', error: e?.message || String(e) })
  }
})

// Admin endpoint: trigger manual cleanup of expired forceOpen flags
storesRouter.post('/admin/cleanup-forceopen', requireRole('ADMIN'), async (req, res) => {
  try {
    await runForceOpenCleanupOnce()
    return res.json({ ok: true, message: 'ForceOpen cleanup triggered' })
  } catch (e) {
    console.error('POST /stores/admin/cleanup-forceopen failed', e)
    return res.status(500).json({ ok: false, error: e?.message || String(e) })
  }
})

// Create store (ADMIN)
storesRouter.post('/', requireRole('ADMIN'), async (req, res) => {
  try {
    const companyId = req.user.companyId
      const { name, cnpj, logoUrl, bannerUrl, timezone, address, isActive, certBase64, certPassword, open24Hours, weeklySchedule, slug, ie, razaoSocial, nfeSerie, nfeEnvironment, csc, cscId, enderEmit } = req.body || {}

      // slug handling: if provided, normalize and validate
      let normalizedSlug = null
      if (slug !== undefined && slug !== null && String(slug).trim() !== ''){
        normalizedSlug = normalizeSlug(slug)
        if (!isValidSlug(normalizedSlug)) return res.status(400).json({ message: 'Slug inválido: use apenas letras minúsculas, números e traços (ex: nomedaloja)' })
        if (isReservedSlug(normalizedSlug)) return res.status(400).json({ message: 'Slug reservado, escolha outro' })
        // ensure uniqueness across stores
        const existing = await prisma.store.findFirst({ where: { slug: normalizedSlug }, select: { id: true } })
        if (existing) return res.status(400).json({ message: 'Slug já em uso por outra loja' })
      }

      // validate weeklySchedule shape when provided (should be array of 7 items)
      if (weeklySchedule !== undefined && weeklySchedule !== null) {
        if (!Array.isArray(weeklySchedule) || weeklySchedule.length !== 7) {
          return res.status(400).json({ message: 'weeklySchedule inválido: deve ser um array com 7 elementos' })
        }
      }

      // SaaS limit: ensure store count does not exceed plan
      try { await assertLimit(companyId, 'stores') } catch (e) {
        const status = e && e.statusCode ? e.statusCode : 403
        return res.status(status).json({ message: e?.message || 'Limite de lojas atingido para seu plano' })
      }

      const { city, state, ibgeCode } = req.body || {}
      // Geocode address with city+state context
      const geo = await geocodeStoreAddress(address, city, state)
      const s = await prisma.store.create({ data: { companyId, name, cnpj: cnpj || null, logoUrl: logoUrl || null, bannerUrl: bannerUrl || null, timezone: timezone || null, address: address || null, city: city || null, state: state || null, ibgeCode: ibgeCode || null, latitude: geo?.latitude || null, longitude: geo?.longitude || null, isActive: isActive ?? true, open24Hours: open24Hours ?? false, weeklySchedule: open24Hours ? null : (weeklySchedule ?? null), slug: normalizedSlug || null } })

    // handle certificate upload: certBase64 (data URL or raw base64) -> secure/certs/<storeId>.pfx
    if (certBase64) {
      try {
        const path = await import('path')
        const fs = await import('fs')
        const raw = String(certBase64)
        const m = raw.match(/^data:.*;base64,(.*)$/)
        const rawBase = m ? m[1] : raw
        const buf = Buffer.from(rawBase, 'base64')
        const certDir = path.join(process.cwd(), 'secure', 'certs')
        await fs.promises.mkdir(certDir, { recursive: true })
        const filename = `${s.id}.pfx`
        const outPath = path.join(certDir, filename)
        await fs.promises.writeFile(outPath, buf)
        // persist marker into public settings so resolver can find it
        const toSave = { certFilename: filename, certExists: true }
        if (certPassword !== undefined) {
          if (certPassword === '' || certPassword === null) {
            toSave.certPasswordEnc = null
          } else {
            toSave.certPasswordEnc = encryptText(String(certPassword))
          }
        }
        await persistStoreSettings(s.id, toSave)
      } catch (e) {
        console.warn('Failed to save store certificate', e)
      }
    }

    // Persist fiscal fields to settings.json
    {
      const fiscalFields = {}
      if (ie) fiscalFields.ie = ie
      if (razaoSocial) fiscalFields.razaoSocial = razaoSocial
      if (nfeSerie) fiscalFields.nfeSerie = nfeSerie
      if (nfeEnvironment) fiscalFields.nfeEnvironment = nfeEnvironment
      if (csc) fiscalFields.csc = csc
      if (cscId) fiscalFields.cscId = cscId
      if (enderEmit) fiscalFields.enderEmit = enderEmit
      if (cnpj) fiscalFields.cnpj = cnpj
      if (Object.keys(fiscalFields).length) {
        try { await persistStoreSettings(s.id, fiscalFields) } catch (e) { console.warn('Failed to persist fiscal settings on create', e) }
      }
    }

    res.status(201).json(s)
  } catch (e) {
    console.error('POST /stores failed', e)
    res.status(500).json({ message: 'Erro ao criar loja', error: e?.message || String(e) })
  }
})

// Update store (ADMIN)
storesRouter.put('/:id', requireRole('ADMIN'), async (req, res) => {
  try {
    const { id } = req.params
    const companyId = req.user.companyId
    const body = req.body || {}
    // If slug present on update, validate/normalize and ensure uniqueness
    let slugToSet
    if (body.hasOwnProperty('slug')){
      if (body.slug === null || String(body.slug || '').trim() === '') {
        slugToSet = null
      } else {
        const candidate = normalizeSlug(body.slug)
        if (!isValidSlug(candidate)) return res.status(400).json({ message: 'Slug inválido: use apenas letras minúsculas, números e traços (ex: nomedaloja)' })
        if (isReservedSlug(candidate)) return res.status(400).json({ message: 'Slug reservado, escolha outro' })
        const exists = await prisma.store.findFirst({ where: { slug: candidate }, select: { id: true } })
        if (exists && exists.id !== id) return res.status(400).json({ message: 'Slug já em uso por outra loja' })
        slugToSet = candidate
      }
    }
    // ensure store belongs to company
    const existing = await prisma.store.findFirst({ where: { id, companyId } })
    if (!existing) return res.status(404).json({ message: 'Loja não encontrada' })
    // validate weeklySchedule when provided
    if (body.weeklySchedule !== undefined && body.weeklySchedule !== null) {
      if (!Array.isArray(body.weeklySchedule) || body.weeklySchedule.length !== 7) {
        return res.status(400).json({ message: 'weeklySchedule inválido: deve ser um array com 7 elementos' })
      }
    }

  // Re-geocode if address, city or state changed
  const addrChanged = (body.address !== undefined && body.address !== existing.address) ||
    (body.city !== undefined && body.city !== existing.city) ||
    (body.state !== undefined && body.state !== existing.state)
  let geoData = {}
  if (addrChanged) {
    const geo = await geocodeStoreAddress(body.address ?? existing.address, body.city ?? existing.city, body.state ?? existing.state)
    geoData = { latitude: geo?.latitude || null, longitude: geo?.longitude || null }
  }
  const updated = await prisma.store.update({ where: { id }, data: { name: body.name ?? existing.name, cnpj: body.cnpj ?? existing.cnpj, phone: body.phone !== undefined ? (body.phone || null) : existing.phone, whatsapp: body.whatsapp !== undefined ? (body.whatsapp || null) : existing.whatsapp, logoUrl: body.logoUrl ?? existing.logoUrl, bannerUrl: body.bannerUrl ?? existing.bannerUrl, timezone: body.timezone ?? existing.timezone, address: body.address ?? existing.address, city: body.city ?? existing.city, state: body.state ?? existing.state, ibgeCode: body.ibgeCode ?? existing.ibgeCode, ...geoData, isActive: body.isActive ?? existing.isActive, open24Hours: body.open24Hours ?? existing.open24Hours, weeklySchedule: (body.open24Hours ? null : (body.weeklySchedule !== undefined ? body.weeklySchedule : existing.weeklySchedule)), slug: slugToSet !== undefined ? slugToSet : existing.slug } })

    // Emit a company-scoped update so public clients refresh when top-level store fields change
    try {
      const io = req && req.app && req.app.locals && req.app.locals.io ? req.app.locals.io : null
      if (io) {
        const meta = { isActive: updated.isActive ?? null, open24Hours: updated.open24Hours ?? null, timezone: updated.timezone || null, weeklySchedule: updated.weeklySchedule || null }
        const payload = { storeId: id, companyId: companyId, changedKeys: Object.keys(body || {}), meta }
        try { console.log('[stores] emitting store-settings-updated to', `company_${companyId}`, 'payload keys:', Object.keys(payload || {})); io.to(`company_${companyId}`).emit('store-settings-updated', payload) } catch (e) { /* ignore */ }
      }
    } catch (e) { /* non-fatal */ }

    // Persist fiscal fields to settings.json so NF-e service can read them
    {
      const fiscalFields = {}
      if (body.ie !== undefined) fiscalFields.ie = body.ie || null
      if (body.razaoSocial !== undefined) fiscalFields.razaoSocial = body.razaoSocial || null
      if (body.nfeSerie !== undefined) fiscalFields.nfeSerie = body.nfeSerie || null
      if (body.nfeEnvironment !== undefined) fiscalFields.nfeEnvironment = body.nfeEnvironment || null
      if (body.csc !== undefined) fiscalFields.csc = body.csc || null
      if (body.cscId !== undefined) fiscalFields.cscId = body.cscId || null
      if (body.enderEmit !== undefined) fiscalFields.enderEmit = body.enderEmit || null
      if (body.cnpj !== undefined) fiscalFields.cnpj = body.cnpj || null
      if (body.infRespTec !== undefined) fiscalFields.infRespTec = body.infRespTec || null
      if (body.nfeDebugMode !== undefined) fiscalFields.nfeDebugMode = Boolean(body.nfeDebugMode)
      if (Object.keys(fiscalFields).length) {
        try { await persistStoreSettings(id, fiscalFields) } catch (e) { console.warn('Failed to persist fiscal settings', e) }
      }
    }

    // handle certificate upload/update for store
    if (body.certBase64 || body.certPassword !== undefined) {
      try {
        const fs = await import('fs')
        const path = await import('path')
        const toSave = {}
        if (body.certBase64) {
          const raw = String(body.certBase64)
          const m = raw.match(/^data:.*;base64,(.*)$/)
          const rawBase = m ? m[1] : raw
          const buf = Buffer.from(rawBase, 'base64')
          const certDir = path.join(process.cwd(), 'secure', 'certs')
          await fs.promises.mkdir(certDir, { recursive: true })
          const filename = `${id}.pfx`
          const outPath = path.join(certDir, filename)
          await fs.promises.writeFile(outPath, buf)
          toSave.certFilename = filename
          toSave.certExists = true
        }
        if (body.certPassword !== undefined) {
          if (body.certPassword === '' || body.certPassword === null) {
            toSave.certPasswordEnc = null
          } else {
            toSave.certPasswordEnc = encryptText(String(body.certPassword))
          }
        }
        if (Object.keys(toSave).length) await persistStoreSettings(id, toSave)
      } catch (e) {
        console.warn('Failed to update store certificate', e)
      }
    }

    // Sync store open/close status to aiqfome when isActive changes
    if (body.isActive !== undefined && body.isActive !== existing.isActive) {
      syncStoreStatusToAiqfome(companyId, id, body.isActive ? 'open' : 'close').catch(() => {});
    }

    res.json(updated)
  } catch (e) {
    console.error('PUT /stores/:id failed', e)
    res.status(500).json({ message: 'Erro ao atualizar loja', error: e?.message || String(e) })
  }
})

// POST /stores/:id/settings/upload
// body: { logoBase64?: string, bannerBase64?: string, logoFilename?: string, bannerFilename?: string }
storesRouter.post('/:id/settings/upload', requireRole('ADMIN'), async (req, res) => {
  try {
    const { id } = req.params
    const companyId = req.user.companyId
    const existing = await prisma.store.findFirst({ where: { id, companyId } })
    if (!existing) return res.status(404).json({ message: 'Loja não encontrada' })

    const body = req.body || {}
  const { logoBase64, bannerBase64, logoFilename, bannerFilename, menuId, menuMeta, forceOpen } = body
    try{ console.log('[stores] settings/upload incoming for store', id, 'keys:', Object.keys(body || {})) }catch(e){}
    try{ if (req.rawBody) console.log('[stores] rawBody snippet:', String(req.rawBody).slice(0,200)) }catch(e){}
    const path = await import('path')
    const fs = await import('fs')
  const settingsDir = path.join(process.cwd(), 'settings', 'stores', id)
  await fs.promises.mkdir(settingsDir, { recursive: true })

  const saved = {}
    if (logoBase64) {
      const raw = String(logoBase64 || '')
      const m = raw.match(/^data:.*;base64,(.*)$/)
      const rawBase = m ? m[1] : raw
      const buf = Buffer.from(rawBase, 'base64')
      const ext = (logoFilename && String(logoFilename).includes('.')) ? '.' + String(logoFilename).split('.').pop() : '.png'
      const outName = `logo${ext}`
      const outPath = path.join(settingsDir, outName)
      await fs.promises.writeFile(outPath, buf)
      // public path
      // also write a public copy under public/uploads/store/<id>/...
      try {
        const dirLegacyImgBase = path.join(process.cwd(), 'public', 'uploads', 'store', id)
        if (menuId) {
          const menuDir = path.join(settingsDir, 'menus', String(menuId))
          await fs.promises.mkdir(menuDir, { recursive: true })
          const menuOutPath = path.join(menuDir, outName)
          await fs.promises.writeFile(menuOutPath, buf)

          const legacyMenuDir = path.join(dirLegacyImgBase, 'menus', String(menuId))
          await fs.promises.mkdir(legacyMenuDir, { recursive: true })
          const legacyMenuOut = path.join(legacyMenuDir, outName)
          await fs.promises.writeFile(legacyMenuOut, buf)
          // public URL served at /public
          saved.logo = `/public/uploads/store/${id}/menus/${menuId}/${outName}`
        } else {
          const outPath = path.join(settingsDir, outName)
          await fs.promises.writeFile(outPath, buf)
          const legacyDir = dirLegacyImgBase
          await fs.promises.mkdir(legacyDir, { recursive: true })
          const legacyOut = path.join(legacyDir, outName)
          await fs.promises.writeFile(legacyOut, buf)
          saved.logo = `/public/uploads/store/${id}/${outName}`
        }
      } catch (e) {
        // fallback to settings path if public write fails
        try {
          if (menuId) {
            const menuDir = path.join(settingsDir, 'menus', String(menuId))
            await fs.promises.mkdir(menuDir, { recursive: true })
            const menuOutPath = path.join(menuDir, outName)
            await fs.promises.writeFile(menuOutPath, buf)
            saved.logo = `/settings/stores/${id}/menus/${menuId}/${outName}`
          } else {
            const outPath = path.join(settingsDir, outName)
            await fs.promises.writeFile(outPath, buf)
            saved.logo = `/settings/stores/${id}/${outName}`
          }
        } catch (ee) {
          console.warn('Failed to write logo to both settings and public paths', ee)
        }
      }
    }
    if (bannerBase64) {
      const raw = String(bannerBase64 || '')
      const m = raw.match(/^data:.*;base64,(.*)$/)
      const rawBase = m ? m[1] : raw
      const buf = Buffer.from(rawBase, 'base64')
      const ext = (bannerFilename && String(bannerFilename).includes('.')) ? '.' + String(bannerFilename).split('.').pop() : '.jpg'
      const outName = `banner${ext}`
      const outPath = path.join(settingsDir, outName)
      await fs.promises.writeFile(outPath, buf)
      // also write a public copy under public/uploads/store/<id>/...
      try {
        const dirLegacyImgBase = path.join(process.cwd(), 'public', 'uploads', 'store', id)
        if (menuId) {
          const menuDir = path.join(settingsDir, 'menus', String(menuId))
          await fs.promises.mkdir(menuDir, { recursive: true })
          const menuOutPath = path.join(menuDir, outName)
          await fs.promises.writeFile(menuOutPath, buf)

          const legacyMenuDir = path.join(dirLegacyImgBase, 'menus', String(menuId))
          await fs.promises.mkdir(legacyMenuDir, { recursive: true })
          const legacyMenuOut = path.join(legacyMenuDir, outName)
          await fs.promises.writeFile(legacyMenuOut, buf)
          saved.banner = `/public/uploads/store/${id}/menus/${menuId}/${outName}`
        } else {
          const outPath = path.join(settingsDir, outName)
          await fs.promises.writeFile(outPath, buf)
          const legacyDir = dirLegacyImgBase
          await fs.promises.mkdir(legacyDir, { recursive: true })
          const legacyOut = path.join(legacyDir, outName)
          await fs.promises.writeFile(legacyOut, buf)
          saved.banner = `/public/uploads/store/${id}/${outName}`
        }
      } catch (e) {
        // fallback to settings path if public write fails
        try {
          if (menuId) {
            const menuDir = path.join(settingsDir, 'menus', String(menuId))
            await fs.promises.mkdir(menuDir, { recursive: true })
            const menuOutPath = path.join(menuDir, outName)
            await fs.promises.writeFile(menuOutPath, buf)
            saved.banner = `/settings/stores/${id}/menus/${menuId}/${outName}`
          } else {
            const outPath = path.join(settingsDir, outName)
            await fs.promises.writeFile(outPath, buf)
            saved.banner = `/settings/stores/${id}/${outName}`
          }
        } catch (ee) {
          console.warn('Failed to write banner to both settings and public paths', ee)
        }
      }
    }

    // If menuMeta provided, merge it into saved so metadata fields are persisted
    if (menuMeta && menuId) {
      try {
        if (typeof menuMeta === 'object') {
          Object.assign(saved, menuMeta)
        }
      } catch (e) { /* ignore */ }
    }

    // support top-level forceOpen flag to manually override open/closed state for the store
    if (typeof forceOpen !== 'undefined') {
      try { saved.forceOpen = forceOpen } catch (e) { /* ignore */ }
      // Sync forceOpen state to aiqfome
      syncStoreStatusToAiqfome(companyId, id, forceOpen ? 'open' : 'close').catch(() => {});
    }

    // Persist settings: merge into existing settings so menus mapping is preserved
    if (Object.keys(saved).length) {
      try {
        try{ console.log('[stores] saving settings.json, saved keys:', Object.keys(saved)) }catch(e){}
        const settingsPathNew = path.join(process.cwd(), 'settings', 'stores', id, 'settings.json')
        let existingNew = {}
        try { if (fs.existsSync(settingsPathNew)) existingNew = JSON.parse(await fs.promises.readFile(settingsPathNew, 'utf8') || '{}') } catch (e) { existingNew = {} }
        if (menuId) {
          existingNew.menus = existingNew.menus || {}
          existingNew.menus[String(menuId)] = { ...(existingNew.menus[String(menuId)] || {}), ...(saved || {}) }
        } else {
          Object.assign(existingNew, saved)
        }

        // Cleanup expired forceOpen flags before persisting
        try {
          const cleanupExpiredForceFlags = (obj) => {
            if (!obj || typeof obj !== 'object') return
            const now = Date.now()
            if (obj.forceOpenExpiresAt) {
              const t = Date.parse(String(obj.forceOpenExpiresAt))
              if (!isNaN(t) && t < now) {
                delete obj.forceOpen
                delete obj.forceOpenExpiresAt
              }
            }
            if (obj.menus && typeof obj.menus === 'object') {
              for (const k of Object.keys(obj.menus)) {
                const m = obj.menus[k]
                if (m && m.forceOpenExpiresAt) {
                  const tt = Date.parse(String(m.forceOpenExpiresAt))
                  if (!isNaN(tt) && tt < now) {
                    delete m.forceOpen
                    delete m.forceOpenExpiresAt
                  }
                }
              }
            }
          }
          cleanupExpiredForceFlags(existingNew)
        } catch (e) { /* non-fatal */ }

        // write primary settings file
        await fs.promises.writeFile(settingsPathNew, JSON.stringify(existingNew, null, 2), 'utf8')
        try{ console.log('[stores] wrote settings.json at', settingsPathNew) }catch(e){}
        // also write legacy public/uploads copy
        try {
          const dirLegacy = path.join(process.cwd(), 'public', 'uploads', 'store', id)
          await fs.promises.mkdir(dirLegacy, { recursive: true })
          const settingsPathLegacy = path.join(dirLegacy, 'settings.json')
          let existingLegacy = {}
          try { if (fs.existsSync(settingsPathLegacy)) existingLegacy = JSON.parse(await fs.promises.readFile(settingsPathLegacy, 'utf8') || '{}') } catch (e) { existingLegacy = {} }
          if (menuId) {
            existingLegacy.menus = existingLegacy.menus || {}
            existingLegacy.menus[String(menuId)] = { ...(existingLegacy.menus[String(menuId)] || {}), ...(saved || {}) }
          } else {
            Object.assign(existingLegacy, saved)
          }

          // cleanup expired flags on legacy copy as well
          try {
            const now = Date.now()
            if (existingLegacy.forceOpenExpiresAt) {
              const t = Date.parse(String(existingLegacy.forceOpenExpiresAt))
              if (!isNaN(t) && t < now) {
                delete existingLegacy.forceOpen
                delete existingLegacy.forceOpenExpiresAt
              }
            }
            if (existingLegacy.menus && typeof existingLegacy.menus === 'object') {
              for (const k of Object.keys(existingLegacy.menus)) {
                const m = existingLegacy.menus[k]
                if (m && m.forceOpenExpiresAt) {
                  const tt = Date.parse(String(m.forceOpenExpiresAt))
                  if (!isNaN(tt) && tt < now) {
                    delete m.forceOpen
                    delete m.forceOpenExpiresAt
                  }
                }
              }
            }
          } catch (e) { /* non-fatal */ }

          await fs.promises.writeFile(settingsPathLegacy, JSON.stringify(existingLegacy, null, 2), 'utf8')
          try{ console.log('[stores] wrote legacy settings.json at', settingsPathLegacy) }catch(e){}
        } catch (e) { /* non-fatal */ }
      } catch (e) {
        console.warn('Failed to merge/write settings after upload', e)
      }
    }

    try{ console.log('[stores] upload finished, saved:', saved) }catch(e){}
    // persist returned paths into Store DB columns so admin UI can read them from the store record
    try {
      const toUpdate = {}
      if (saved.logo) toUpdate.logoUrl = saved.logo
      if (saved.banner) toUpdate.bannerUrl = saved.banner
      if (Object.keys(toUpdate).length) {
        try{ console.log('[stores] updating store record with image urls', toUpdate) }catch(e){}
        await prisma.store.update({ where: { id }, data: toUpdate })
      }
    } catch (e) {
      console.warn('Failed to persist uploaded image URLs to store record', e)
    }

    // Emit socket event so connected clients (public menus, dashboards) can
    // refresh when store settings change. Use app.locals.io if Socket.IO is
    // attached (server.js sets app.locals.io when attaching the socket).
    try {
      const io = req && req.app && req.app.locals && req.app.locals.io ? req.app.locals.io : null
      if (io) {
        try {
          // build meta info from merged settings so public clients can react to pause/force flags
          const meta = {
            forceOpen: existingNew.forceOpen || null,
            forceOpenExpiresAt: existingNew.forceOpenExpiresAt || null,
            pauseUntil: existingNew.pauseUntil || existingNew.pausedUntil || existingNew.pause_until || null,
            closedUntilNextShift: existingNew.closedUntilNextShift || existingNew.closed_until_next_shift || null,
            menus: existingNew.menus || null
          }
          // include current DB isActive flag
          let isActiveFlag = null
          try {
            const srec = await prisma.store.findUnique({ where: { id }, select: { isActive: true } })
            if (srec) isActiveFlag = srec.isActive
          } catch (e) { /* ignore */ }

          const payload = { storeId: id, companyId: companyId, menuId: menuId || null, changedKeys: Object.keys(saved || {}), meta: { ...meta, isActive: isActiveFlag } }
          // Emit only to the company room to reduce cross-company noise
          try { console.log('[stores] emitting store-settings-updated to', `company_${companyId}`, 'payload keys:', Object.keys(payload || {})); io.to(`company_${companyId}`).emit('store-settings-updated', payload) } catch (e) { /* ignore */ }
        } catch (e) { /* ignore */ }
      }
    } catch (e) { /* non-fatal */ }

    return res.json({ ok: true, saved })
  } catch (e) {
    console.error('POST /stores/:id/settings/upload failed', e)
    try{ console.error('Request rawBody snippet (server):', req.rawBody ? String(req.rawBody).slice(0,500) : '<no raw body>') }catch(_){}
    return res.status(500).json({ message: 'Falha ao salvar imagens', error: e?.message || String(e) })
  }
})

// Delete store certificate (ADMIN)
storesRouter.delete('/:id/cert', requireRole('ADMIN'), async (req, res) => {
  try {
    const { id } = req.params
    const companyId = req.user.companyId
    const existing = await prisma.store.findFirst({ where: { id, companyId } })
    if (!existing) return res.status(404).json({ message: 'Loja não encontrada' })

    try {
      const fs = await import('fs')
      const path = await import('path')
      const outPath = path.join(process.cwd(), 'secure', 'certs', `${id}.pfx`)
      if (fs.existsSync(outPath)) {
        try { await fs.promises.unlink(outPath) } catch (e) { console.warn('Failed to unlink store cert', e) }
      }
    } catch (e) {
      console.warn('Failed to remove cert file for store', id, e)
    }

    // clear settings flags
    try {
      await persistStoreSettings(id, { certFilename: null, certExists: false, certPasswordEnc: null })
    } catch (e) {
      console.warn('Failed to persist settings after cert delete', e)
    }

    res.json({ ok: true })
  } catch (e) {
    console.error('DELETE /stores/:id/cert failed', e)
    res.status(500).json({ message: 'Erro ao remover certificado', error: e?.message || String(e) })
  }
})

// Delete store (ADMIN) — primary (first-created) store cannot be deleted
storesRouter.delete('/:id', requireRole('ADMIN'), async (req, res) => {
  try {
    const { id } = req.params
    const companyId = req.user.companyId
    const existing = await prisma.store.findFirst({ where: { id, companyId } })
    if (!existing) return res.status(404).json({ message: 'Loja não encontrada' })
    // Check if this is the primary (oldest) store for the company
    const primaryStore = await prisma.store.findFirst({ where: { companyId }, orderBy: { createdAt: 'asc' } })
    if (primaryStore && primaryStore.id === id) {
      return res.status(403).json({ message: 'A loja principal não pode ser removida.' })
    }
    await prisma.store.delete({ where: { id } })
    res.json({ ok: true })
  } catch (e) {
    console.error('DELETE /stores/:id failed', e)
    res.status(500).json({ message: 'Erro ao remover loja', error: e?.message || String(e) })
  }
})

storesRouter.patch('/:id/inbox-automation', requireRole('ADMIN'), async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { id } = req.params;
    const store = await prisma.store.findFirst({
      where: { id, companyId },
      select: { id: true },
    });
    if (!store) return res.status(404).json({ message: 'Loja não encontrada' });

    const { outOfHoursReplyId, greetingReplyId } = req.body || {};
    const data = {};
    if (outOfHoursReplyId !== undefined) {
      if (outOfHoursReplyId) {
        const exists = await prisma.quickReply.findFirst({
          where: { id: outOfHoursReplyId, companyId },
          select: { id: true },
        });
        if (!exists) return res.status(400).json({ message: 'outOfHoursReplyId inválido' });
      }
      data.outOfHoursReplyId = outOfHoursReplyId || null;
    }
    if (greetingReplyId !== undefined) {
      if (greetingReplyId) {
        const exists = await prisma.quickReply.findFirst({
          where: { id: greetingReplyId, companyId },
          select: { id: true },
        });
        if (!exists) return res.status(400).json({ message: 'greetingReplyId inválido' });
      }
      data.greetingReplyId = greetingReplyId || null;
    }

    const updated = await prisma.store.update({
      where: { id: store.id },
      data,
      select: {
        id: true,
        outOfHoursReplyId: true,
        greetingReplyId: true,
      },
    });
    res.json(updated);
  } catch (e) {
    console.error('[stores] inbox-automation error:', e);
    res.status(500).json({ message: 'Erro ao salvar automação', error: e.message });
  }
});

export default storesRouter
