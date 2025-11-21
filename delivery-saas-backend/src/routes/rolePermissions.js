import express from 'express'
import fs from 'fs/promises'
import path from 'path'
import { authMiddleware, requireRole } from '../auth.js'

const router = express.Router()

// file will live under settings/ so it's easy to inspect and is served by express static
const FILE = path.join(process.cwd(), 'settings', 'rolePermissions.json')

// sensible default mapping of permissions per role (frontend can extend)
const DEFAULT = {
  SUPER_ADMIN: ["*"],
  ADMIN: [
    'users:read', 'users:create', 'users:update', 'users:delete',
    'orders:view', 'menu:edit', 'settings:update'
  ],
  ATTENDANT: ['orders:view', 'orders:update', 'customers:view'],
  RIDER: ['orders:view', 'orders:update']
}

async function readMapping(){
  try{
    const raw = await fs.readFile(FILE, 'utf8')
    return JSON.parse(raw)
  }catch(e){
    // if file missing or invalid, return DEFAULT
    return DEFAULT
  }
}

async function writeMapping(obj){
  await fs.mkdir(path.dirname(FILE), { recursive: true })
  await fs.writeFile(FILE, JSON.stringify(obj, null, 2), 'utf8')
}

// return mapping (only ADMIN / SUPER_ADMIN allowed)
router.get('/permissions', authMiddleware, requireRole('SUPER_ADMIN','ADMIN'), async (req, res) => {
  try{
    const mapping = await readMapping()
    return res.json(mapping)
  }catch(e){
    console.error('GET /roles/permissions error', e)
    return res.status(500).json({ message: 'Erro ao ler permissões' })
  }
})

// Returns canonical available roles and permission keys so frontend can render editors
// Accessible to any authenticated user (UI may need it)
router.get('/available', authMiddleware, requireRole('SUPER_ADMIN','ADMIN'), async (req, res) => {
  try{
    const mapping = await readMapping()
    const roles = Object.keys(mapping)
    const permSet = new Set()
    for(const arr of Object.values(mapping || {})){
      if(Array.isArray(arr)) arr.forEach(p => permSet.add(p))
    }
    const permissions = Array.from(permSet).sort()
    return res.json({ roles, permissions })
  }catch(e){
    console.error('GET /roles/available error', e)
    return res.status(500).json({ message: 'Erro ao listar roles/perms' })
  }
})

// Return permission metadata (labels/descriptions) for the UI. Admin-only.
router.get('/permissions/meta', authMiddleware, requireRole('SUPER_ADMIN','ADMIN'), async (req, res) => {
  try{
    const file = path.join(process.cwd(), 'settings', 'permissionMetadata.json')
    try{
      const raw = await fs.readFile(file, 'utf8')
      const json = JSON.parse(raw || '{}')
      return res.json(json)
    }catch(e){
      // fallback: derive from mapping keys
      const mapping = await readMapping()
      const permSet = new Set()
      for(const arr of Object.values(mapping || {})) if(Array.isArray(arr)) arr.forEach(p => permSet.add(p))
      const out = {}
      Array.from(permSet).forEach(k => { out[k] = { label: k, description: '' } })
      return res.json(out)
    }
  }catch(e){
    console.error('GET /roles/permissions/meta error', e)
    return res.status(500).json({ message: 'Erro ao ler metadata de permissões' })
  }
})

// overwrite mapping (only SUPER_ADMIN allowed)
router.put('/permissions', authMiddleware, requireRole('SUPER_ADMIN'), async (req, res) => {
  try{
    const body = req.body || {}
    // basic validation: body should be an object mapping role->array
    if (typeof body !== 'object' || Array.isArray(body)) return res.status(400).json({ message: 'Payload inválido' })
    await writeMapping(body)
    return res.json(body)
  }catch(e){
    console.error('PUT /roles/permissions error', e)
    return res.status(500).json({ message: 'Erro ao salvar permissões' })
  }
})

export default router
