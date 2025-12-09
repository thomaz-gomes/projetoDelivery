import fs from 'fs'
import path from 'path'

const DEFAULT_INTERVAL_MIN = 15

function _isExpired(ts) {
  if (!ts) return false
  const t = Date.parse(String(ts))
  if (isNaN(t)) return false
  return t < Date.now()
}

function _cleanupObject(obj) {
  if (!obj || typeof obj !== 'object') return false
  let mutated = false
  if (obj.forceOpenExpiresAt && _isExpired(obj.forceOpenExpiresAt)) {
    delete obj.forceOpen
    delete obj.forceOpenExpiresAt
    mutated = true
  }
  if (obj.menus && typeof obj.menus === 'object') {
    for (const k of Object.keys(obj.menus)) {
      const m = obj.menus[k]
      if (m && m.forceOpenExpiresAt && _isExpired(m.forceOpenExpiresAt)) {
        delete m.forceOpen
        delete m.forceOpenExpiresAt
        mutated = true
      }
    }
  }
  return mutated
}

async function _tryReadJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null
    const raw = await fs.promises.readFile(filePath, 'utf8')
    return JSON.parse(raw || '{}')
  } catch (e) {
    return null
  }
}

async function runOnce() {
    try {
      const settingsBase = path.join(process.cwd(), 'settings', 'stores')
      const legacyBase = path.join(process.cwd(), 'public', 'uploads', 'store')
      const ids = new Set()

      try {
        const list = await fs.promises.readdir(settingsBase, { withFileTypes: true })
        for (const d of list) if (d && d.isDirectory()) ids.add(d.name)
      } catch (e) { /* ignore if folder missing */ }

      try {
        const list = await fs.promises.readdir(legacyBase, { withFileTypes: true })
        for (const d of list) if (d && d.isDirectory()) ids.add(d.name)
      } catch (e) { /* ignore if folder missing */ }

      for (const id of ids) {
        const candidates = [
          path.join(settingsBase, id, 'settings.json'),
          path.join(legacyBase, id, 'settings.json')
        ]
        for (const p of candidates) {
          try {
            const s = await _tryReadJson(p)
            if (!s) continue
            const mutated = _cleanupObject(s)
            if (mutated) {
              try {
                await fs.promises.mkdir(path.dirname(p), { recursive: true })
                await fs.promises.writeFile(p, JSON.stringify(s, null, 2), 'utf8')
                console.log('[cleanupForceOpen] cleaned expired flags in', p)
              } catch (e) {
                console.warn('[cleanupForceOpen] failed to write cleaned file', p, e && e.message)
              }
            }
          } catch (e) {
            console.warn('[cleanupForceOpen] failed to process', p, e && e.message)
          }
        }
      }
    } catch (e) {
      console.error('[cleanupForceOpen] sweep failed', e && e.message)
    }
}

export async function runForceOpenCleanupOnce() {
  return runOnce()
}

export default function startForceOpenCleanup({ intervalMinutes } = {}) {
  const interval = (Number(intervalMinutes) || DEFAULT_INTERVAL_MIN) * 60 * 1000
  let handle = null

  // run immediately and schedule
  runOnce().catch(e => console.error('[cleanupForceOpen] initial run failed', e && e.message))
  handle = setInterval(() => runOnce().catch(e => console.error('[cleanupForceOpen] scheduled run failed', e && e.message)), interval)

  return {
    stop: () => { if (handle) clearInterval(handle) }
  }
}
