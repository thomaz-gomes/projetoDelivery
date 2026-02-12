import fs from 'fs'
import fsp from 'fs/promises'
import path from 'path'

const FILE = path.join(process.cwd(), 'settings', 'rolePermissions.json')

// in-memory mapping role -> [perms]
let mapping = {}
let lastLoadedAt = 0

const DEFAULT = {
  SUPER_ADMIN: ['*'],
  ADMIN: ['users:read','users:create','users:update','users:delete','orders:view','menu:edit','settings:update'],
  ATTENDANT: ['orders:view','orders:update','customers:view'],
  RIDER: ['orders:view','orders:update']
}

async function loadMapping(){
  try{
    const raw = await fsp.readFile(FILE, 'utf8')
    const parsed = JSON.parse(raw || '{}')
    if(!parsed || Object.keys(parsed).length === 0){
      mapping = DEFAULT
      return
    }
    mapping = parsed
    lastLoadedAt = Date.now()
    // normalize to arrays
    for(const k of Object.keys(mapping)){
      if(!Array.isArray(mapping[k])) mapping[k] = []
    }
  }catch(e){
    // fallback to default mapping
    mapping = DEFAULT
  }
}

// initial load
loadMapping().catch(()=>{ mapping = DEFAULT })

// watch file and reload on change (debounced)
let reloadTimer = null
try{
  fs.watch(FILE, (eventType) => {
    if (reloadTimer) clearTimeout(reloadTimer)
    reloadTimer = setTimeout(() => {
      loadMapping().catch((e)=>{ console.warn('Failed to reload rolePermissions.json', e?.message || e) })
    }, 200)
  })
}catch(e){
  // ignore watch errors (file may not exist yet)
}

export function getMapping(){
  return mapping
}

export function hasPermission(role, permissionKey){
  if(!role) return false
  const perms = mapping[role] || []
  for(const p of perms){
    if(p === '*') return true
    if(p === permissionKey) return true
    if(p.endsWith('*')){
      const prefix = p.slice(0, -1)
      if(permissionKey.startsWith(prefix)) return true
    }
  }
  return false
}

export function requirePermission(permissionKey){
  return (req, res, next) => {
    try{
      const user = req.user
      if(!user) return res.status(401).json({ message: 'Unauthorized' })
      const role = user.role
      if(hasPermission(role, permissionKey)) return next()
      return res.status(403).json({ message: 'Forbidden' })
    }catch(e){
      console.error('requirePermission error', e)
      return res.status(500).json({ message: 'Server error' })
    }
  }
}

// allow manual reload for tests/administration
export async function reloadPermissions(){
  await loadMapping()
  return mapping
}
