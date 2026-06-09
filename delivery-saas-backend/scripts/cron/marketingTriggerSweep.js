// scripts/cron/marketingTriggerSweep.js
//
// Roda a cada 1 min via cron. Para cada MarketingCampaign com
// scheduleType=TRIGGER e status=RUNNING:
//   1. Chama o evaluator do triggerType
//   2. Para cada candidato:
//      a. Calcula sendAt respeitando quietHours
//      b. Se a janela 24h da Meta expira antes do sendAt → SUPPRESSED
//      c. Senão, cria MarketingMessage com status SCHEDULED ou QUEUED
//   3. Cria 1 MarketingCampaignRun por sweep que produziu pelo menos 1 msg
//
// Execução manual: `node scripts/cron/marketingTriggerSweep.js`
// Pode aceitar `--dry-run` no futuro.

import { prisma } from '../../src/prisma.js'
import { getEvaluator } from '../../src/services/marketing/triggerEvaluators/index.js'
import { nextAllowedTime, QUIET_HOURS_DEFAULTS } from '../../src/services/marketing/quietHours.js'

const META_24H_MS = 24 * 60 * 60 * 1000

async function resolveTimezone(campaign) {
  // Prioridade: triggerParams.timezone > Menu.timezone > Company.timezone > default
  const fromParams = campaign.triggerParams?.timezone
  if (fromParams) return fromParams
  // Buscar via segmentMenuId pra não pegar todos os menus
  if (campaign.segmentMenuId) {
    const menu = await prisma.menu.findUnique({
      where: { id: campaign.segmentMenuId },
      select: { timezone: true },
    })
    if (menu?.timezone) return menu.timezone
  }
  const company = await prisma.company.findUnique({
    where: { id: campaign.companyId },
    select: { timezone: true },
  })
  if (company?.timezone) return company.timezone
  return QUIET_HOURS_DEFAULTS.timezone
}

async function sweepCampaign(campaign, now) {
  const evaluator = getEvaluator(campaign.triggerType)
  if (!evaluator) {
    console.warn('[trigger-sweep] no evaluator for', campaign.triggerType)
    return { campaignId: campaign.id, qualified: 0, queued: 0, scheduled: 0, suppressed: 0 }
  }

  const candidates = await evaluator({ campaign, now })
  if (candidates.length === 0) {
    return { campaignId: campaign.id, qualified: 0, queued: 0, scheduled: 0, suppressed: 0 }
  }

  const timezone = await resolveTimezone(campaign)
  const params = {
    timezone,
    quietHoursStart: campaign.triggerParams?.quietHoursStart || QUIET_HOURS_DEFAULTS.quietHoursStart,
    quietHoursEnd: campaign.triggerParams?.quietHoursEnd || QUIET_HOURS_DEFAULTS.quietHoursEnd,
  }
  const respectQuietHours = campaign.triggerParams?.respectQuietHours !== false // default true

  // Cria um run pra esse sweep
  const run = await prisma.marketingCampaignRun.create({
    data: {
      companyId: campaign.companyId,
      campaignId: campaign.id,
      startedAt: now,
    },
  })

  let queued = 0, scheduled = 0, suppressed = 0
  for (const cand of candidates) {
    const windowExpiresAt = new Date(cand.lastInboundAt.getTime() + META_24H_MS)
    let sendAt = now
    if (respectQuietHours) sendAt = nextAllowedTime(now, params)

    // Se o horário válido para enviar já passou da janela 24h da Meta,
    // suprime (mensagem livre não passaria mais — só template).
    if (sendAt >= windowExpiresAt) {
      try {
        await prisma.marketingMessage.create({
          data: {
            companyId: campaign.companyId,
            campaignId: campaign.id,
            campaignRunId: run.id,
            customerId: cand.customerId,
            providerUsed: campaign.channel === 'EVOLUTION_WA' ? 'EVOLUTION_WA' : 'META_WA',
            providerAccountId: cand.providerAccountId,
            status: 'SUPPRESSED_QUIET_HOURS',
            errorMessage: `sendAt=${sendAt.toISOString()} >= windowExpiresAt=${windowExpiresAt.toISOString()}`,
          },
        })
        suppressed++
      } catch (e) {
        if (e?.code !== 'P2002') {
          console.warn('[trigger-sweep] suppress create failed', e?.message)
        }
      }
      continue
    }

    const isScheduledFuture = sendAt.getTime() > now.getTime() + 30 * 1000 // > 30s no futuro
    try {
      await prisma.marketingMessage.create({
        data: {
          companyId: campaign.companyId,
          campaignId: campaign.id,
          campaignRunId: run.id,
          customerId: cand.customerId,
          providerUsed: campaign.channel === 'EVOLUTION_WA' ? 'EVOLUTION_WA' : 'META_WA',
          providerAccountId: cand.providerAccountId,
          status: isScheduledFuture ? 'SCHEDULED' : 'QUEUED',
          scheduledFor: isScheduledFuture ? sendAt : null,
        },
      })
      if (isScheduledFuture) scheduled++
      else queued++
    } catch (e) {
      if (e?.code !== 'P2002') {
        console.warn('[trigger-sweep] message create failed', e?.message)
      }
    }
  }

  await prisma.marketingCampaignRun.update({
    where: { id: run.id },
    data: { totalQueued: queued + scheduled, finishedAt: new Date() },
  })

  return { campaignId: campaign.id, qualified: candidates.length, queued, scheduled, suppressed }
}

// Promove mensagens SCHEDULED cujo scheduledFor já passou para QUEUED,
// pra que o sender existente as pegue na próxima iteração.
async function promoteScheduledMessages(now) {
  const result = await prisma.marketingMessage.updateMany({
    where: {
      status: 'SCHEDULED',
      scheduledFor: { lte: now },
    },
    data: { status: 'QUEUED', scheduledFor: null },
  })
  return result.count
}

export async function runMarketingTriggerSweep({ now = new Date() } = {}) {
  // 1. Promove SCHEDULED → QUEUED se chegou o horário
  let promoted = 0
  try {
    promoted = await promoteScheduledMessages(now)
    if (promoted > 0) console.log('[trigger-sweep] promoted', promoted, 'SCHEDULED→QUEUED')
  } catch (e) {
    console.error('[trigger-sweep] promote failed', e?.message)
  }

  // 2. Avalia triggers
  const campaigns = await prisma.marketingCampaign.findMany({
    where: { scheduleType: 'TRIGGER', status: 'RUNNING' },
  })
  if (campaigns.length === 0) return { campaigns: 0, totals: { promoted } }

  const results = []
  for (const c of campaigns) {
    try {
      results.push(await sweepCampaign(c, now))
    } catch (e) {
      console.error('[trigger-sweep] campaign failed', c.id, e?.message)
    }
  }
  const totals = results.reduce((acc, r) => ({
    qualified: acc.qualified + r.qualified,
    queued: acc.queued + r.queued,
    scheduled: acc.scheduled + r.scheduled,
    suppressed: acc.suppressed + r.suppressed,
  }), { qualified: 0, queued: 0, scheduled: 0, suppressed: 0 })
  totals.promoted = promoted

  return { campaigns: campaigns.length, totals, results }
}

// CLI entry
if (import.meta.url === `file://${process.argv[1]}`) {
  runMarketingTriggerSweep()
    .then(result => {
      console.log(JSON.stringify(result, null, 2))
      return prisma.$disconnect()
    })
    .then(() => process.exit(0))
    .catch(e => { console.error(e); process.exit(1) })
}
