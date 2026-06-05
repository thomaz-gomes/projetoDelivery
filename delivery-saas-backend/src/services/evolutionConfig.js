// evolutionConfig.js — Centraliza leitura/escrita das credenciais da Evolution API
// armazenadas em SystemSetting (key/value).
//
// - EVOLUTION_API_KEY é criptografada em repouso via messaging/crypto.js
// - EVOLUTION_API_BASE_URL e WEBHOOK_URL ficam em texto puro
// - Há fallback para process.env (EVOLUTION_API_BASE_URL / EVOLUTION_API_API_KEY)
//   enquanto a migração para o banco não é finalizada em todos os ambientes.
//   Quando o admin salvar via UI, o valor do banco passa a ter prioridade.
//
// As checagens de papel (SUPER_ADMIN) vivem nas rotas que consomem este módulo.

import { prisma } from '../prisma.js'
import { encrypt, decrypt } from '../messaging/crypto.js'

const KEYS = {
  BASE_URL: 'EVOLUTION_API_BASE_URL',
  API_KEY: 'EVOLUTION_API_KEY',
  WEBHOOK_URL: 'EVOLUTION_WEBHOOK_URL',
  WEBHOOK_TOKEN: 'EVOLUTION_WEBHOOK_TOKEN',
}

let cache = null
let cacheAt = 0
const CACHE_TTL_MS = 30_000

export function mascaraSecret(s) {
  if (!s) return ''
  if (s.length <= 4) return '***' + s
  return '***' + s.slice(-4)
}

async function readKeys(keys) {
  const rows = await prisma.systemSetting.findMany({ where: { key: { in: keys } } })
  const map = {}
  for (const r of rows) map[r.key] = r.value
  return map
}

// Retorna a config efetiva (banco com fallback para process.env).
// `apiKey` aqui já vem decriptado. Quando nenhuma fonte tem valor, retorna null
// nos campos respectivos — chamadores decidem se isso é erro fatal.
export async function getEvolutionConfig({ useCache = true } = {}) {
  if (useCache && cache && Date.now() - cacheAt < CACHE_TTL_MS) return cache
  const rows = await readKeys(Object.values(KEYS))
  const baseUrlDb = rows[KEYS.BASE_URL] || null
  const apiKeyEnc = rows[KEYS.API_KEY] || null
  const webhookUrlDb = rows[KEYS.WEBHOOK_URL] || null
  const webhookTokenDb = rows[KEYS.WEBHOOK_TOKEN] || null

  const cfg = {
    baseUrl: baseUrlDb || process.env.EVOLUTION_API_BASE_URL || null,
    apiKey: apiKeyEnc ? decrypt(apiKeyEnc) : (process.env.EVOLUTION_API_API_KEY || null),
    webhookUrl: webhookUrlDb || null,
    webhookToken: webhookTokenDb || null,
    source: {
      baseUrl: baseUrlDb ? 'db' : (process.env.EVOLUTION_API_BASE_URL ? 'env' : null),
      apiKey: apiKeyEnc ? 'db' : (process.env.EVOLUTION_API_API_KEY ? 'env' : null),
    },
  }
  cache = cfg
  cacheAt = Date.now()
  return cfg
}

export function invalidateEvolutionConfigCache() {
  cache = null
  cacheAt = 0
}

// Atualização esparsa: só grava as chaves presentes em `input`.
// Campos aceitos (todos opcionais): baseUrl, apiKey, webhookUrl, webhookToken, updatedBy.
export async function setEvolutionConfig(input = {}) {
  const updatedBy = input.updatedBy || null
  const writes = []

  function push(field, key, transform) {
    if (input[field] === undefined) return
    const raw = input[field]
    if (raw === null) return
    const value = transform ? transform(raw) : String(raw)
    writes.push({ key, value })
  }

  push('baseUrl', KEYS.BASE_URL)
  push('apiKey', KEYS.API_KEY, (v) => encrypt(String(v)))
  push('webhookUrl', KEYS.WEBHOOK_URL)
  push('webhookToken', KEYS.WEBHOOK_TOKEN)

  for (const { key, value } of writes) {
    await prisma.systemSetting.upsert({
      where: { key },
      update: { value, updatedBy },
      create: { key, value, updatedBy },
    })
  }

  invalidateEvolutionConfigCache()
  return { written: writes.map((w) => w.key) }
}

// View segura para a UI admin: apiKey mascarada, indica origem (db|env) de cada
// campo para que o painel deixe explícito o que ainda vem do .env.
export async function getEvolutionConfigMasked() {
  const cfg = await getEvolutionConfig({ useCache: false })
  return {
    configured: !!(cfg.baseUrl && cfg.apiKey),
    baseUrl: cfg.baseUrl || '',
    apiKey: cfg.apiKey ? mascaraSecret(cfg.apiKey) : '',
    webhookUrl: cfg.webhookUrl || '',
    webhookToken: cfg.webhookToken ? mascaraSecret(cfg.webhookToken) : '',
    source: cfg.source,
  }
}

// Sonda a Evolution chamando GET /. Não usa axios global para evitar dependência
// circular com src/wa.js. Retorna { ok, status, version, error }.
export async function testEvolutionConnection() {
  const cfg = await getEvolutionConfig({ useCache: false })
  if (!cfg.baseUrl) return { ok: false, error: 'baseUrl não configurada' }
  if (!cfg.apiKey) return { ok: false, error: 'apiKey não configurada' }
  try {
    const { default: axios } = await import('axios')
    const r = await axios.get(cfg.baseUrl, {
      headers: { apikey: cfg.apiKey },
      timeout: 10_000,
    })
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      version: r.data?.version || null,
      message: r.data?.message || null,
    }
  } catch (e) {
    return {
      ok: false,
      status: e?.response?.status || null,
      error: e?.response?.data?.message || e?.message || String(e),
    }
  }
}

export default {
  mascaraSecret,
  getEvolutionConfig,
  invalidateEvolutionConfigCache,
  setEvolutionConfig,
  getEvolutionConfigMasked,
  testEvolutionConnection,
}
