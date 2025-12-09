// src/routes/stores.js
import express from 'express'
import { prisma } from '../prisma.js'
import { normalizeSlug, isValidSlug, isReservedSlug } from '../utils/slug.js'
import { authMiddleware, requireRole } from '../auth.js'
import { runForceOpenCleanupOnce } from '../cleanupForceOpen.js'
import { encryptText } from '../utils/secretStore.js'

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

// Get single store
storesRouter.get('/:id', async (req, res) => {
  try {
    const { id } = req.params
    const companyId = req.user.companyId
    const s = await prisma.store.findFirst({ where: { id, companyId } })
    if (!s) return res.status(404).json({ message: 'Loja não encontrada' })
    // Attempt to read merged settings from public/uploads/store/<id>/settings.json
    try {
      const path = await import('path')
      const fs = await import('fs')
      // prefer centralized settings path
      const candidates = [
        path.join(process.cwd(), 'settings', 'stores', id, 'settings.json'),
        path.join(process.cwd(), 'public', 'uploads', 'store', id, 'settings.json')
      ]
      for (const settingsPath of candidates) {
        if (fs.existsSync(settingsPath)) {
          try {
            const raw = await fs.promises.readFile(settingsPath, 'utf8')
            const settings = JSON.parse(raw || '{}')

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
                // write back cleaned settings to both centralized and legacy paths (best-effort)
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
          } catch (e) {
            console.warn('Failed to read store settings file', e)
            // fallthrough to next candidate or returning the store DB object
          }
        }
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
      const { name, cnpj, logoUrl, bannerUrl, timezone, address, isActive, certBase64, certPassword, open24Hours, weeklySchedule, slug } = req.body || {}

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

  const s = await prisma.store.create({ data: { companyId, name, cnpj: cnpj || null, logoUrl: logoUrl || null, bannerUrl: bannerUrl || null, timezone: timezone || null, address: address || null, isActive: isActive ?? true, open24Hours: open24Hours ?? false, weeklySchedule: open24Hours ? null : (weeklySchedule ?? null), slug: normalizedSlug || null } })

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
          try { toSave.certPasswordEnc = certPassword === '' || certPassword === null ? null : encryptText(String(certPassword)) } catch (e) { /* ignore */ }
        }
        await persistStoreSettings(s.id, toSave)
      } catch (e) {
        console.warn('Failed to save store certificate', e)
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

  const updated = await prisma.store.update({ where: { id }, data: { name: body.name ?? existing.name, cnpj: body.cnpj ?? existing.cnpj, logoUrl: body.logoUrl ?? existing.logoUrl, bannerUrl: body.bannerUrl ?? existing.bannerUrl, timezone: body.timezone ?? existing.timezone, address: body.address ?? existing.address, isActive: body.isActive ?? existing.isActive, open24Hours: body.open24Hours ?? existing.open24Hours, weeklySchedule: (body.open24Hours ? null : (body.weeklySchedule !== undefined ? body.weeklySchedule : existing.weeklySchedule)), slug: slugToSet !== undefined ? slugToSet : existing.slug } })

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
          try { toSave.certPasswordEnc = body.certPassword === '' || body.certPassword === null ? null : encryptText(String(body.certPassword)) } catch (e) { /* ignore */ }
        }
        if (Object.keys(toSave).length) await persistStoreSettings(id, toSave)
      } catch (e) {
        console.warn('Failed to update store certificate', e)
      }
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

// Delete store (ADMIN)
storesRouter.delete('/:id', requireRole('ADMIN'), async (req, res) => {
  try {
    const { id } = req.params
    const companyId = req.user.companyId
    const existing = await prisma.store.findFirst({ where: { id, companyId } })
    if (!existing) return res.status(404).json({ message: 'Loja não encontrada' })
    await prisma.store.delete({ where: { id } })
    res.json({ ok: true })
  } catch (e) {
    console.error('DELETE /stores/:id failed', e)
    res.status(500).json({ message: 'Erro ao remover loja', error: e?.message || String(e) })
  }
})

export default storesRouter
