/**
 * metaConfig.js — Centraliza leitura/escrita das credenciais do Meta App
 * armazenadas em SystemSetting (key/value).
 *
 * - APP_SECRET é criptografado em repouso via messaging/crypto.js
 * - Demais campos (APP_ID, GRAPH_VERSION, WEBHOOK_BASE_URL,
 *   WEBHOOK_VERIFY_TOKEN, APP_REVIEW_STATUS) ficam em texto puro
 * - getMetaConfig lança MetaNotConfiguredError quando APP_ID/APP_SECRET ausentes
 * - getMetaConfigMasked retorna null silenciosamente quando não configurado
 *
 * As checagens de papel (SUPER_ADMIN) vivem nas rotas que consomem este módulo.
 */

import crypto from 'node:crypto'
import { prisma } from '../prisma.js'
import { encrypt, decrypt } from '../messaging/crypto.js'
import { MetaNotConfiguredError } from '../messaging/adapters/base.adapter.js'

const KEYS = {
  APP_ID: 'META_APP_ID',
  APP_SECRET: 'META_APP_SECRET',
  GRAPH_VERSION: 'META_GRAPH_VERSION',
  WEBHOOK_BASE_URL: 'META_WEBHOOK_BASE_URL',
  WEBHOOK_VERIFY_TOKEN: 'META_WEBHOOK_VERIFY_TOKEN',
  APP_REVIEW_STATUS: 'META_APP_REVIEW_STATUS',
}

/**
 * Retorna uma view mascarada do segredo: '***' + 4 últimos chars.
 * Strings com 4 chars ou menos são exibidas inteiras após o '***'
 * (não há o que ocultar). null/undefined/'' viram ''.
 */
export function mascaraSecret(s) {
  if (!s) return ''
  if (s.length <= 4) return '***' + s
  return '***' + s.slice(-4)
}

async function readKeys(keys) {
  const rows = await prisma.systemSetting.findMany({
    where: { key: { in: keys } },
  })
  const map = {}
  for (const r of rows) map[r.key] = r.value
  return map
}

/**
 * Lê a config Meta do SystemSetting e devolve no shape consumido pelos adapters.
 * Lança MetaNotConfiguredError quando APP_ID ou APP_SECRET estão ausentes.
 */
export async function getMetaConfig() {
  const rows = await readKeys(Object.values(KEYS))
  const appId = rows[KEYS.APP_ID] || null
  const appSecretEnc = rows[KEYS.APP_SECRET] || null
  if (!appId || !appSecretEnc) {
    throw new MetaNotConfiguredError()
  }
  return {
    appId,
    appSecret: decrypt(appSecretEnc),
    graphVersion: rows[KEYS.GRAPH_VERSION] || 'v21.0',
    webhookBaseUrl: rows[KEYS.WEBHOOK_BASE_URL] || null,
    webhookVerifyToken: rows[KEYS.WEBHOOK_VERIFY_TOKEN] || null,
    appReviewStatus: rows[KEYS.APP_REVIEW_STATUS] || null,
  }
}

/**
 * Atualização esparsa: só grava as chaves presentes em `input`.
 * Campos aceitos (todos opcionais): appId, appSecret, graphVersion,
 * webhookBaseUrl, webhookVerifyToken, appReviewStatus, updatedBy.
 * appSecret é criptografado antes de persistir.
 */
export async function setMetaConfig(input = {}) {
  const updatedBy = input.updatedBy || null
  const writes = []

  function pushIfDefined(field, key, transform) {
    if (input[field] === undefined) return
    const raw = input[field]
    if (raw === null) return
    const value = transform ? transform(raw) : String(raw)
    writes.push({ key, value })
  }

  pushIfDefined('appId', KEYS.APP_ID)
  pushIfDefined('appSecret', KEYS.APP_SECRET, (v) => encrypt(String(v)))
  pushIfDefined('graphVersion', KEYS.GRAPH_VERSION)
  pushIfDefined('webhookBaseUrl', KEYS.WEBHOOK_BASE_URL)
  pushIfDefined('webhookVerifyToken', KEYS.WEBHOOK_VERIFY_TOKEN)
  pushIfDefined('appReviewStatus', KEYS.APP_REVIEW_STATUS)

  for (const { key, value } of writes) {
    await prisma.systemSetting.upsert({
      where: { key },
      update: { value, updatedBy },
      create: { key, value, updatedBy },
    })
  }

  return { written: writes.map((w) => w.key) }
}

/**
 * Gera um novo token hex de 64 chars (32 bytes), persiste em
 * SystemSetting[META_WEBHOOK_VERIFY_TOKEN] e devolve em texto puro
 * para o admin copiar no painel da Meta.
 */
export async function regenerateVerifyToken(updatedBy = null) {
  const token = crypto.randomBytes(32).toString('hex')
  await prisma.systemSetting.upsert({
    where: { key: KEYS.WEBHOOK_VERIFY_TOKEN },
    update: { value: token, updatedBy },
    create: { key: KEYS.WEBHOOK_VERIFY_TOKEN, value: token, updatedBy },
  })
  return token
}

/**
 * View segura para a UI admin: igual a getMetaConfig, mas com appSecret
 * substituído por mascaraSecret(...). Retorna null caso não esteja
 * configurado (captura MetaNotConfiguredError silenciosamente).
 */
export async function getMetaConfigMasked() {
  try {
    const cfg = await getMetaConfig()
    return {
      ...cfg,
      appSecret: mascaraSecret(cfg.appSecret),
    }
  } catch (err) {
    if (err instanceof MetaNotConfiguredError) return null
    throw err
  }
}

export default {
  mascaraSecret,
  getMetaConfig,
  setMetaConfig,
  regenerateVerifyToken,
  getMetaConfigMasked,
}
