import express from 'express'
import { prisma } from '../prisma.js'
import { encryptText } from '../utils/secretStore.js'
import { authMiddleware, requireRole } from '../auth.js'

export const companiesRouter = express.Router()

companiesRouter.use(authMiddleware)

// GET /settings/company -> retorna dados da company do usuário
companiesRouter.get('/company', async (req, res) => {
  const companyId = req.user.companyId
  if (!companyId) return res.status(400).json({ message: 'Usuário sem empresa' })
  try {
    const c = await prisma.company.findUnique({ where: { id: companyId }, select: { id: true, name: true, alwaysOpen: true, timezone: true, weeklySchedule: true } })
    if (!c) return res.status(404).json({ message: 'Empresa não encontrada' })
    // If timezone not set, return default Brasilia timezone so UI shows the expected default
    if (!c.timezone) c.timezone = 'America/Sao_Paulo'

    // Try to load supplementary settings from filesystem (avoid DB migrations for new public metadata)
    try {
      const path = await import('path')
      const fs = await import('fs')
      const settingsPath = path.join(process.cwd(), 'public', 'uploads', 'company', companyId, 'settings.json')
      if (fs.existsSync(settingsPath)) {
        const raw = await fs.promises.readFile(settingsPath, 'utf8')
        try {
          const extra = JSON.parse(raw || '{}')
          Object.assign(c, extra)
          // do not expose encrypted password or absolute cert path to client
          if (c.certPasswordEnc) delete c.certPasswordEnc
          if (c.certPath) delete c.certPath
          // normalize certificate existence flag
          c.certExists = Boolean(extra.certFilename || extra.certExists)
        } catch (e) { /* ignore parse errors */ }
      }
    } catch (e) { console.warn('Failed to load company settings file', e) }

    res.json(c)
  } catch (e) {
    console.error('Error fetching company:', e)
    // in development include error details to help debugging
    const payload = { message: 'Erro ao buscar empresa' }
    if (process.env.NODE_ENV !== 'production') payload.error = String(e?.message || e)
    res.status(500).json(payload)
  }
})

// PATCH /settings/company -> atualizar campos de horário e timezone
companiesRouter.patch('/company', requireRole('ADMIN'), async (req, res) => {
  const companyId = req.user.companyId
  if (!companyId) return res.status(400).json({ message: 'Usuário sem empresa' })
  const { alwaysOpen, timezone, weeklySchedule } = req.body || {}
  try {
    const existing = await prisma.company.findUnique({ where: { id: companyId } })
    if (!existing) return res.status(404).json({ message: 'Empresa não encontrada' })

    const data = {}
    if (alwaysOpen !== undefined) data.alwaysOpen = Boolean(alwaysOpen)
    // accept empty strings or null to unset
    if (timezone !== undefined) data.timezone = timezone === '' ? null : timezone
    if (weeklySchedule !== undefined) data.weeklySchedule = weeklySchedule === '' ? null : weeklySchedule

    // validate weeklySchedule shape if provided
    const validateWeekly = (ws) => {
      const errors = []
      if (ws === null) return errors
      if (!Array.isArray(ws)) {
        errors.push('weeklySchedule deve ser um array')
        return errors
      }
      if (ws.length !== 7) {
        // accept sparse arrays but prefer length 7
        // not strictly required, but warn if not length 7
        // we'll still validate entries present
      }
      const isValidTime = (s) => typeof s === 'string' && /^\d{2}:\d{2}$/.test(s) && (() => {
        const [hh, mm] = s.split(':').map(Number)
        return Number.isFinite(hh) && Number.isFinite(mm) && hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59
      })()

      for (const d of ws) {
        if (d == null) continue
        const day = Number(d.day)
        if (Number.isNaN(day) || day < 0 || day > 6) errors.push('day deve ser 0..6')
        if (typeof d.enabled !== 'boolean') errors.push(`day ${day}: enabled deve ser boolean`)
        if (d.enabled) {
          if (!d.from || !d.to) {
            errors.push(`day ${day}: quando habilitado, from e to são obrigatórios`)
            continue
          }
          if (!isValidTime(d.from) || !isValidTime(d.to)) {
            errors.push(`day ${day}: from/to em formato HH:MM`) 
            continue
          }
          if (d.from === d.to) {
            errors.push(`day ${day}: from não pode ser igual a to`)
          }
        }
      }
      return errors
    }

    if (weeklySchedule !== undefined && weeklySchedule !== null) {
      const errs = validateWeekly(weeklySchedule)
      if (errs.length) return res.status(400).json({ message: 'weeklySchedule inválido', errors: errs })
    }
    
    // update company name in DB if provided
    if (req.body.name !== undefined) {
      try { await prisma.company.update({ where: { id: companyId }, data: { name: String(req.body.name || '') } }) } catch (e) { console.warn('Failed to update company.name', e) }
    }

    // persist other public-facing settings to filesystem
    try {
      const path = await import('path')
      const fs = await import('fs')
      const dir = path.join(process.cwd(), 'public', 'uploads', 'company', companyId)
      await fs.promises.mkdir(dir, { recursive: true })
      const settingsPath = path.join(dir, 'settings.json')
      const allowed = ['address', 'phone', 'whatsapp', 'banner', 'logo']
      const toSave = {}
      for (const k of allowed) {
        if (req.body[k] !== undefined) toSave[k] = req.body[k]
      }
      // fiscal-related settings that we persist to the settings.json
      const fiscalKeys = ['cnpj', 'ie', 'nfeSerie', 'nfeEnvironment', 'csc', 'cscId']
      for (const k of fiscalKeys) {
        if (req.body[k] !== undefined) toSave[k] = req.body[k]
      }

      // certificate password - encrypt before saving
      // Accept explicit undefined (not provided) to mean "leave as-is".
      // If provided as empty string or null, clear the stored password.
      if (req.body.certPassword !== undefined) {
        try {
          if (req.body.certPassword === '' || req.body.certPassword === null) {
            toSave.certPasswordEnc = null
          } else {
            toSave.certPasswordEnc = encryptText(String(req.body.certPassword))
          }
        } catch (e) {
          console.error('Failed to encrypt certificate password:', e)
          return res.status(500).json({ message: 'Falha ao criptografar senha do certificado. Verifique se a variável de ambiente CERT_STORE_KEY está configurada no servidor.' })
        }
      }

      // handle certificate upload (base64) - save to secure/certs/<companyId>.pfx (outside public)
      if (req.body.certBase64) {
        try {
          const b64 = String(req.body.certBase64)
          // accept data URL or raw base64
          const m = b64.match(/^data:.*;base64,(.*)$/)
          const rawBase = m ? m[1] : b64
          const buf = Buffer.from(rawBase, 'base64')
          // secure directory outside public
          const certDir = path.join(process.cwd(), 'secure', 'certs')
          await fs.promises.mkdir(certDir, { recursive: true })
          const outPath = path.join(certDir, `${companyId}.pfx`)
          await fs.promises.writeFile(outPath, buf)
          // record a marker in settings so UI can show existence, but do not expose full path
          toSave.certFilename = `${companyId}.pfx`
          toSave.certExists = true
        } catch (e) {
          console.warn('Failed to save company certificate:', e)
        }
      }
      // handle base64 image fields (bannerBase64 / logoBase64) if present
      const saveBase64 = async (fieldBase64, outName) => {
        const b64 = req.body[fieldBase64]
        if (!b64) return null
        // data URI or raw base64
        const m = String(b64).match(/^data:(image\/(png|jpeg|jpg));base64,(.*)$/i)
        let ext = 'png'
        let rawBase = b64
        if (m) { ext = m[2] === 'jpeg' ? 'jpg' : m[2]; rawBase = m[3] }
        const buf = Buffer.from(rawBase, 'base64')
        const filename = `${outName}.${ext}`
        const outPath = path.join(dir, filename)
        await fs.promises.writeFile(outPath, buf)
        return `/public/uploads/company/${companyId}/${filename}`
      }
      if (req.body.bannerBase64) {
        const url = await saveBase64('bannerBase64', 'banner')
        if (url) toSave.banner = url
      }
      if (req.body.logoBase64) {
        const url = await saveBase64('logoBase64', 'logo')
        if (url) toSave.logo = url
      }

      // merge with existing settings file if present
      let existingSettings = {}
      try {
        if (fs.existsSync(settingsPath)) {
          existingSettings = JSON.parse(await fs.promises.readFile(settingsPath, 'utf8') || '{}')
        }
      } catch (e) { existingSettings = {} }
      const merged = { ...existingSettings, ...toSave }
      await fs.promises.writeFile(settingsPath, JSON.stringify(merged, null, 2), 'utf8')
    } catch (e) {
      console.warn('Failed to persist company settings file', e)
    }

    // return updated view (merge DB + settings file)
    try {
      const c2 = await prisma.company.findUnique({ where: { id: companyId }, select: { id: true, name: true, alwaysOpen: true, timezone: true, weeklySchedule: true } })
      // attach settings file
      try {
        const path = await import('path')
        const fs = await import('fs')
        const settingsPath = path.join(process.cwd(), 'public', 'uploads', 'company', companyId, 'settings.json')
        if (fs.existsSync(settingsPath)) {
          const raw = await fs.promises.readFile(settingsPath, 'utf8')
          const extra = JSON.parse(raw || '{}')
            Object.assign(c2, extra)
            if (c2.certPasswordEnc) delete c2.certPasswordEnc
            if (c2.certPath) delete c2.certPath
            c2.certExists = Boolean(extra.certFilename || extra.certExists)
        }
      } catch (e) { /* ignore */ }
      res.json(c2)
    } catch (e) {
      res.json({ message: 'Configurações atualizadas' })
    }
  } catch (e) {
    console.error('Error updating company:', e)
    res.status(500).json({ message: 'Erro ao atualizar empresa' })
  }
})

export default companiesRouter
