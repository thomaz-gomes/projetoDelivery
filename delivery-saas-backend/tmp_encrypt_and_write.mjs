import { encryptText } from './src/utils/secretStore.js'
import fs from 'fs'
import path from 'path'

(async ()=>{
  try {
    const companyId = 'bd6a5381-6b90-4cc9-bc8f-24890c491693'
    const pwd = 'minhaSenhaSecreta'
    const enc = encryptText(pwd)
    console.log('ENCRYPTED:', enc)
    const dir = path.join(process.cwd(),'public','uploads','company',companyId)
    await fs.promises.mkdir(dir, { recursive: true })
    const settingsPath = path.join(dir,'settings.json')
    let existing = {}
    try { if (fs.existsSync(settingsPath)) existing = JSON.parse(await fs.promises.readFile(settingsPath,'utf8')||'{}') } catch(e){ existing = {} }
    existing.certPasswordEnc = enc
    await fs.promises.writeFile(settingsPath, JSON.stringify(existing,null,2),'utf8')
    console.log('WROTE', settingsPath)
  } catch (e) { console.error('ERR',e) }
})()
