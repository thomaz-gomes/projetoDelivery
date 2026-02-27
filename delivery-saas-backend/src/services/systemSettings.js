/**
 * systemSettings.js — Acesso às configurações globais do sistema.
 *
 * Prioridade: banco de dados (SystemSetting) → variável de ambiente.
 * Cache em memória com TTL de 60 segundos para evitar consultas excessivas.
 */

import { prisma } from '../prisma.js'

const cache = new Map() // key → { value, expiresAt }
const CACHE_TTL_MS = 60_000

/**
 * Retorna o valor de uma configuração global.
 * @param {string} key - ex: 'openai_api_key', 'openai_model'
 * @param {string} [envFallback] - variável de ambiente usada como fallback
 * @returns {Promise<string|null>}
 */
export async function getSetting(key, envFallback) {
  const now = Date.now()
  const cached = cache.get(key)
  if (cached && cached.expiresAt > now) return cached.value

  try {
    const row = await prisma.systemSetting.findUnique({ where: { key } })
    const value = row?.value || (envFallback ? (process.env[envFallback] ?? null) : null)
    cache.set(key, { value, expiresAt: now + CACHE_TTL_MS })
    return value
  } catch {
    // Se o banco falhar (ex: tabela não existe ainda), cair no env
    const value = envFallback ? (process.env[envFallback] ?? null) : null
    return value
  }
}

/** Invalida o cache de uma chave (útil após salvar via PUT /saas/settings) */
export function invalidateSetting(key) {
  cache.delete(key)
}
