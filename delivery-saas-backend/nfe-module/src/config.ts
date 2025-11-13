import fs from 'fs'
import path from 'path'

export type NFeConfig = {
  certPath: string
  certPassword: string
  csc: string
  cscId: string
  environment: 'homologation' | 'production'
  xmlDirs: { emitidas: string; inutilizadas: string; eventos: string; retorno?: string }
  xsdsDir?: string
  sefaz: any
}

export function loadConfig(cfgPath?: string): NFeConfig {
  // Default to a config.json located inside the nfe-module folder next to this file.
  // This makes the module resolve its config regardless of process.cwd().
  const defaultPath = path.join(__dirname, '..', 'config.json')
  const p = cfgPath
    ? (path.isAbsolute(cfgPath) ? cfgPath : path.join(process.cwd(), cfgPath))
    : defaultPath

  if (!fs.existsSync(p)) throw new Error(`Config file not found: ${p}. Copy config.sample.json to config.json and edit.`)
  const raw = fs.readFileSync(p, 'utf8')
  return JSON.parse(raw) as NFeConfig
}
