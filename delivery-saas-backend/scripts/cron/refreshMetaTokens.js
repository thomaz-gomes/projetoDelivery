#!/usr/bin/env node
// Daily cron: refresh Meta long-lived tokens that are within 7 days of expiry.
//
// For each MetaMessagingAccount where status='ACTIVE' and tokenExpiresAt is
// approaching, call Meta's fb_exchange_token endpoint to renew the token.
// On success, update accessToken (encrypted) + tokenExpiresAt and clear
// lastError. On failure, mark status='DISCONNECTED' and record lastError so
// the admin UI can surface the issue.
//
// Idempotent: only processes accounts whose tokens are within the 7-day
// window; rerunning when no tokens are aging is a no-op.
//
// If the Meta App is not configured (no APP_ID/APP_SECRET in SystemSetting),
// the script logs and exits 0 — nothing to do.
//
// Usage:
//   node scripts/cron/refreshMetaTokens.js [--dry-run]
//
// Suggested host crontab (run daily at 03:15):
//   15 3 * * * cd /opt/delivery/delivery-saas-backend && node scripts/cron/refreshMetaTokens.js >> /var/log/delivery/refresh-meta-tokens.log 2>&1

import axios from 'axios'
import { prisma } from '../../src/prisma.js'
import { getMetaConfig } from '../../src/services/metaConfig.js'
import { encrypt, decrypt } from '../../src/messaging/crypto.js'
import { MetaNotConfiguredError } from '../../src/messaging/adapters/base.adapter.js'

const DRY_RUN = process.argv.includes('--dry-run')
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

async function main() {
  if (DRY_RUN) console.log('[dry-run] No writes will be performed.')

  let cfg
  try {
    cfg = await getMetaConfig()
  } catch (err) {
    if (err instanceof MetaNotConfiguredError) {
      console.log('Meta App not configured — nothing to refresh. Exiting.')
      await prisma.$disconnect()
      return
    }
    throw err
  }

  const { appId, appSecret, graphVersion } = cfg
  const cutoff = new Date(Date.now() + SEVEN_DAYS_MS)

  const accounts = await prisma.metaMessagingAccount.findMany({
    where: {
      status: 'ACTIVE',
      tokenExpiresAt: { lt: cutoff },
    },
  })

  console.log(`Found ${accounts.length} account(s) with token expiring before ${cutoff.toISOString()}`)

  if (DRY_RUN) {
    for (const acc of accounts) {
      console.log(
        `[dry-run] would refresh acc=${acc.id} provider=${acc.provider} externalId=${acc.externalId} expiresAt=${acc.tokenExpiresAt?.toISOString() || 'null'}`,
      )
    }
    console.log('')
    console.log(`Refreshed 0, Disconnected 0, Total processed ${accounts.length}`)
    console.log('[dry-run] No rows were updated. Re-run without --dry-run to apply.')
    await prisma.$disconnect()
    return
  }

  let refreshed = 0
  let disconnected = 0

  for (const acc of accounts) {
    try {
      const r = await axios.get(
        `https://graph.facebook.com/${graphVersion}/oauth/access_token`,
        {
          params: {
            grant_type: 'fb_exchange_token',
            client_id: appId,
            client_secret: appSecret,
            fb_exchange_token: decrypt(acc.accessToken),
          },
        },
      )
      const newToken = r.data.access_token
      const expiresIn = Number(r.data.expires_in) || 0
      await prisma.metaMessagingAccount.update({
        where: { id: acc.id },
        data: {
          accessToken: encrypt(newToken),
          tokenExpiresAt: expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000) : null,
          lastError: null,
        },
      })
      refreshed++
      console.log(`OK ${acc.id} (provider=${acc.provider})`)
    } catch (e) {
      const message = e.response?.data?.error?.message || e.message
      await prisma.metaMessagingAccount.update({
        where: { id: acc.id },
        data: {
          status: 'DISCONNECTED',
          lastError: message,
        },
      })
      disconnected++
      console.error(`FAIL ${acc.id} (provider=${acc.provider}): ${message}`)
    }
  }

  console.log('')
  console.log(`Refreshed ${refreshed}, Disconnected ${disconnected}, Total processed ${accounts.length}`)

  await prisma.$disconnect()
}

main().catch(async (err) => {
  console.error(err)
  try {
    await prisma.$disconnect()
  } catch {}
  process.exit(1)
})
