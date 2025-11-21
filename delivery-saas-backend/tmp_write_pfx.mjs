import fs from 'fs'
import path from 'path'
(async ()=>{
  try {
    const companyId = 'bd6a5381-6b90-4cc9-bc8f-24890c491693'
    const certDir = path.join(process.cwd(),'secure','certs')
    await fs.promises.mkdir(certDir, { recursive: true })
    const outPath = path.join(certDir, `${companyId}.pfx`)
    // create dummy binary content (not a real PFX, but enough for server to store/read)
    const buf = Buffer.from('DUMMY-PFX-CONTENT-' + Date.now())
    await fs.promises.writeFile(outPath, buf)
    console.log('WROTE PFX', outPath)

    const settingsPath = path.join(process.cwd(),'public','uploads','company',companyId,'settings.json')
    let existing = {}
    try { if (fs.existsSync(settingsPath)) existing = JSON.parse(await fs.promises.readFile(settingsPath,'utf8')||'{}') } catch(e){ existing = {} }
    existing.certFilename = `${companyId}.pfx`
    existing.certExists = true
    await fs.promises.writeFile(settingsPath, JSON.stringify(existing,null,2),'utf8')
    console.log('UPDATED SETTINGS', settingsPath)
  } catch (e) { console.error('ERR',e) }
})()
