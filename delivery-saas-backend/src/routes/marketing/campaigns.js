import express from 'express'
import { prisma } from '../../prisma.js'
import { authMiddleware, requireRole } from '../../auth.js'
import { requireModuleStrict } from '../../modules.js'
import { evaluateSegment } from '../../services/marketing/segmentEvaluator.js'

const router = express.Router()
router.use(authMiddleware)
router.use(requireModuleStrict('MARKETING_CAMPAIGNS'))

const VALID_SCHEDULE_TYPES = new Set(['ONE_SHOT', 'RECURRING', 'TRIGGER'])
const VALID_CHANNELS = new Set(['META_WA', 'EVOLUTION_WA', 'AUTO'])
const VALID_TRIGGER_TYPES = new Set(['WINDOW_NO_ORDER', 'WINDOW_WITH_ORDER'])
const VALID_ATTRIBUTION_SCOPES = new Set(['menu', 'company'])

// Fields users can edit on a DRAFT/PAUSED/SCHEDULED campaign
const EDITABLE_FIELDS = [
  'name',
  'segmentId',
  'scheduleType',
  'scheduledFor',
  'cronExpression',
  'triggerType',
  'triggerParams',
  'channel',
  'metaWaAccountId',
  'evolutionInstanceName',
  'templateId',
  'freeText',
  'templateVariableMap',
  'mediaUrl',
  'conversionWindowHours',
  'attributionScope',
  'segmentMenuId',
  'couponId',
]

// Validates a channel pin: at most one of (metaWaAccountId, evolutionInstanceName)
// can be set, and the pinned channel must belong to the company. Mutates
// `data` with the channel + the corresponding ID; returns null on success
// or a string error to short-circuit.
async function validateChannelPin({ companyId, metaWaAccountId, evolutionInstanceName, data }) {
  if (metaWaAccountId && evolutionInstanceName) {
    return 'Escolha um único canal (Meta OU Evolution), não os dois'
  }
  if (metaWaAccountId) {
    const acc = await prisma.metaMessagingAccount.findFirst({
      where: { id: metaWaAccountId, companyId, provider: 'META_WA' },
    })
    if (!acc) return 'Conta WhatsApp Cloud inválida ou não pertence à empresa'
    data.metaWaAccountId = metaWaAccountId
    data.evolutionInstanceName = null
    data.channel = 'META_WA'
    return null
  }
  if (evolutionInstanceName) {
    const inst = await prisma.whatsAppInstance.findFirst({
      where: { instanceName: evolutionInstanceName, companyId },
    })
    if (!inst) return 'Instância Evolution inválida ou não pertence à empresa'
    data.metaWaAccountId = null
    data.evolutionInstanceName = evolutionInstanceName
    data.channel = 'EVOLUTION_WA'
    return null
  }
  // Neither set — clear both and leave channel as the caller-provided value
  // (typically AUTO).
  data.metaWaAccountId = null
  data.evolutionInstanceName = null
  return null
}

function parseDate(v) {
  if (v === null || v === undefined || v === '') return null
  const d = new Date(v)
  return Number.isFinite(d.getTime()) ? d : undefined // undefined means invalid
}

// GET /marketing/campaigns/channels
// Combined list of WhatsApp channels available to the company for pinning
// to a campaign. Returns one item per Meta Cloud account + one per
// Evolution instance, normalized to a common shape so the campaign
// builder can render a single unified dropdown.
router.get('/channels', async (req, res) => {
  const { companyId } = req.user
  try {
    const [metaAccounts, evoInstances] = await Promise.all([
      prisma.metaMessagingAccount.findMany({
        where: { companyId, provider: 'META_WA' },
        select: { id: true, displayName: true, externalId: true, status: true },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.whatsAppInstance.findMany({
        where: { companyId },
        select: { instanceName: true, displayName: true, status: true },
        orderBy: { createdAt: 'asc' },
      }),
    ])

    const channels = [
      ...metaAccounts.map(a => ({
        key: `meta:${a.id}`,
        type: 'META_WA',
        metaWaAccountId: a.id,
        evolutionInstanceName: null,
        label: a.displayName || a.externalId,
        identifier: a.externalId,
        status: a.status,
        official: true,
      })),
      ...evoInstances.map(i => ({
        key: `evo:${i.instanceName}`,
        type: 'EVOLUTION_WA',
        metaWaAccountId: null,
        evolutionInstanceName: i.instanceName,
        label: i.displayName || i.instanceName,
        identifier: i.instanceName,
        status: i.status,
        official: false,
      })),
    ]
    return res.json(channels)
  } catch (e) {
    console.error('Failed to list campaign channels:', e?.message || e)
    return res.status(500).json({ message: 'Falha ao listar canais' })
  }
})

// List campaigns
router.get('/', async (req, res) => {
  const { companyId } = req.user
  try {
    const rows = await prisma.marketingCampaign.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
      include: {
        segment: { select: { id: true, name: true } },
        _count: { select: { messages: true } },
      },
    })
    return res.json(rows)
  } catch (e) {
    console.error('Failed to list campaigns:', e?.message || e)
    return res.status(500).json({ message: 'Falha ao listar campanhas' })
  }
})

// Get campaign detail
router.get('/:id', async (req, res) => {
  const { companyId } = req.user
  const { id } = req.params
  try {
    const c = await prisma.marketingCampaign.findFirst({
      where: { id, companyId },
      include: {
        segment: true,
        template: true,
        coupon: true,
        runs: {
          orderBy: { startedAt: 'desc' },
          take: 30,
        },
      },
    })
    if (!c) return res.status(404).json({ message: 'Campanha não encontrada' })
    return res.json(c)
  } catch (e) {
    console.error('Failed to fetch campaign:', e?.message || e)
    return res.status(500).json({ message: 'Falha ao buscar campanha' })
  }
})

// Create campaign as DRAFT
router.post('/', requireRole('ADMIN'), async (req, res) => {
  const { companyId } = req.user
  const {
    name,
    segmentId,
    scheduleType,
    scheduledFor,
    cronExpression,
    triggerType,
    triggerParams,
    channel,
    metaWaAccountId,
    evolutionInstanceName,
    templateId,
    freeText,
    templateVariableMap,
    mediaUrl,
    conversionWindowHours,
    attributionScope,
    segmentMenuId,
    couponId,
  } = req.body || {}

  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ message: 'Nome é obrigatório' })
  }
  if (!scheduleType || !VALID_SCHEDULE_TYPES.has(scheduleType)) {
    return res.status(400).json({ message: 'scheduleType inválido' })
  }
  // segmentId obrigatório para ONE_SHOT/RECURRING; opcional para TRIGGER
  // (público é construído dinamicamente pelo evaluator do trigger).
  if (scheduleType !== 'TRIGGER' && !segmentId) {
    return res.status(400).json({ message: 'segmentId é obrigatório para campanhas não-TRIGGER' })
  }
  if (scheduleType === 'TRIGGER') {
    if (!triggerType || !VALID_TRIGGER_TYPES.has(triggerType)) {
      return res.status(400).json({
        message: `Para scheduleType=TRIGGER, triggerType é obrigatório (um de: ${[...VALID_TRIGGER_TYPES].join(', ')}).`,
      })
    }
  }

  const ch = channel || 'AUTO'
  if (!VALID_CHANNELS.has(ch)) {
    return res.status(400).json({ message: 'channel inválido' })
  }
  const scope = attributionScope || 'menu'
  if (!VALID_ATTRIBUTION_SCOPES.has(scope)) {
    return res.status(400).json({ message: 'attributionScope inválido' })
  }

  // segmentId must belong to this company (only when provided — TRIGGER may skip)
  if (segmentId) {
    const segment = await prisma.marketingSegment.findFirst({ where: { id: segmentId, companyId } })
    if (!segment) {
      return res.status(400).json({ message: 'Segmento inválido ou não pertence à empresa' })
    }
  }

  // Optional cross-company guard checks
  if (templateId) {
    const tpl = await prisma.metaTemplate.findFirst({ where: { id: templateId, companyId } })
    if (!tpl) return res.status(400).json({ message: 'Template inválido ou não pertence à empresa' })
  }
  if (couponId) {
    const coupon = await prisma.coupon.findFirst({ where: { id: couponId, companyId } })
    if (!coupon) return res.status(400).json({ message: 'Cupom inválido ou não pertence à empresa' })
  }
  if (segmentMenuId) {
    const menu = await prisma.menu.findFirst({ where: { id: segmentMenuId, companyId } })
    if (!menu) return res.status(400).json({ message: 'Menu inválido ou não pertence à empresa' })
  }

  const parsedScheduledFor = parseDate(scheduledFor)
  if (parsedScheduledFor === undefined) {
    return res.status(400).json({ message: 'scheduledFor inválido' })
  }

  const cwh = conversionWindowHours !== undefined ? Number(conversionWindowHours) : 48
  if (!Number.isFinite(cwh) || cwh < 0) {
    return res.status(400).json({ message: 'conversionWindowHours inválido' })
  }

  // Channel pin validation — when set, overrides `ch` to META_WA / EVOLUTION_WA
  const channelData = { channel: ch }
  const chanErr = await validateChannelPin({
    companyId, metaWaAccountId, evolutionInstanceName, data: channelData,
  })
  if (chanErr) return res.status(400).json({ message: chanErr })

  try {
    const created = await prisma.marketingCampaign.create({
      data: {
        companyId,
        segmentId: segmentId || null,
        name: name.trim(),
        scheduleType,
        scheduledFor: parsedScheduledFor,
        cronExpression: cronExpression || null,
        triggerType: triggerType || null,
        triggerParams: triggerParams ?? null,
        channel: channelData.channel,
        metaWaAccountId: channelData.metaWaAccountId,
        evolutionInstanceName: channelData.evolutionInstanceName,
        templateId: templateId || null,
        freeText: freeText || null,
        templateVariableMap: templateVariableMap ?? null,
        mediaUrl: mediaUrl || null,
        conversionWindowHours: cwh,
        attributionScope: scope,
        segmentMenuId: segmentMenuId || null,
        couponId: couponId || null,
        status: 'DRAFT',
        createdByUserId: req.user.id || null,
      },
    })
    return res.status(201).json(created)
  } catch (e) {
    console.error('Failed to create campaign:', e?.message || e)
    return res.status(500).json({ message: 'Falha ao criar campanha', error: String(e?.message || e) })
  }
})

// Update campaign (only when DRAFT/PAUSED/SCHEDULED)
router.patch('/:id', requireRole('ADMIN'), async (req, res) => {
  const { companyId } = req.user
  const { id } = req.params
  const existing = await prisma.marketingCampaign.findFirst({ where: { id, companyId } })
  if (!existing) return res.status(404).json({ message: 'Campanha não encontrada' })
  if (!['DRAFT', 'PAUSED', 'SCHEDULED'].includes(existing.status)) {
    return res.status(409).json({ message: `Campanha em status ${existing.status} não pode ser editada` })
  }

  const body = req.body || {}
  const data = {}

  for (const k of EDITABLE_FIELDS) {
    if (!(k in body)) continue
    const val = body[k]
    switch (k) {
      case 'name': {
        if (typeof val !== 'string' || !val.trim()) {
          return res.status(400).json({ message: 'Nome inválido' })
        }
        data.name = val.trim()
        break
      }
      case 'segmentId': {
        if (!val) return res.status(400).json({ message: 'segmentId inválido' })
        const seg = await prisma.marketingSegment.findFirst({ where: { id: val, companyId } })
        if (!seg) return res.status(400).json({ message: 'Segmento inválido ou não pertence à empresa' })
        data.segmentId = val
        break
      }
      case 'scheduleType': {
        if (!VALID_SCHEDULE_TYPES.has(val)) {
          return res.status(400).json({ message: 'scheduleType inválido' })
        }
        data.scheduleType = val
        break
      }
      case 'scheduledFor': {
        const parsed = parseDate(val)
        if (parsed === undefined) return res.status(400).json({ message: 'scheduledFor inválido' })
        data.scheduledFor = parsed
        break
      }
      case 'cronExpression': {
        data.cronExpression = val || null
        break
      }
      case 'triggerType': {
        data.triggerType = val || null
        break
      }
      case 'triggerParams': {
        data.triggerParams = val ?? null
        break
      }
      case 'channel': {
        if (!VALID_CHANNELS.has(val)) return res.status(400).json({ message: 'channel inválido' })
        data.channel = val
        break
      }
      case 'metaWaAccountId': {
        if (val) {
          const acc = await prisma.metaMessagingAccount.findFirst({
            where: { id: val, companyId, provider: 'META_WA' },
          })
          if (!acc) return res.status(400).json({ message: 'Conta WhatsApp Cloud inválida ou não pertence à empresa' })
          data.metaWaAccountId = val
          data.evolutionInstanceName = null
          data.channel = 'META_WA'
        } else {
          data.metaWaAccountId = null
        }
        break
      }
      case 'evolutionInstanceName': {
        if (val) {
          const inst = await prisma.whatsAppInstance.findFirst({
            where: { instanceName: val, companyId },
          })
          if (!inst) return res.status(400).json({ message: 'Instância Evolution inválida ou não pertence à empresa' })
          data.evolutionInstanceName = val
          data.metaWaAccountId = null
          data.channel = 'EVOLUTION_WA'
        } else {
          data.evolutionInstanceName = null
        }
        break
      }
      case 'templateId': {
        if (val) {
          const tpl = await prisma.metaTemplate.findFirst({ where: { id: val, companyId } })
          if (!tpl) return res.status(400).json({ message: 'Template inválido ou não pertence à empresa' })
        }
        data.templateId = val || null
        break
      }
      case 'freeText': {
        data.freeText = val || null
        break
      }
      case 'templateVariableMap': {
        data.templateVariableMap = val ?? null
        break
      }
      case 'mediaUrl': {
        data.mediaUrl = val || null
        break
      }
      case 'conversionWindowHours': {
        const cwh = Number(val)
        if (!Number.isFinite(cwh) || cwh < 0) {
          return res.status(400).json({ message: 'conversionWindowHours inválido' })
        }
        data.conversionWindowHours = cwh
        break
      }
      case 'attributionScope': {
        if (!VALID_ATTRIBUTION_SCOPES.has(val)) {
          return res.status(400).json({ message: 'attributionScope inválido' })
        }
        data.attributionScope = val
        break
      }
      case 'segmentMenuId': {
        if (val) {
          const menu = await prisma.menu.findFirst({ where: { id: val, companyId } })
          if (!menu) return res.status(400).json({ message: 'Menu inválido ou não pertence à empresa' })
        }
        data.segmentMenuId = val || null
        break
      }
      case 'couponId': {
        if (val) {
          const coupon = await prisma.coupon.findFirst({ where: { id: val, companyId } })
          if (!coupon) return res.status(400).json({ message: 'Cupom inválido ou não pertence à empresa' })
        }
        data.couponId = val || null
        break
      }
    }
  }

  try {
    const updated = await prisma.marketingCampaign.update({ where: { id }, data })
    return res.json(updated)
  } catch (e) {
    console.error('Failed to update campaign:', e?.message || e)
    return res.status(500).json({ message: 'Falha ao atualizar campanha' })
  }
})

// Pre-flight checks: runs all gates before activation
async function computePreflight(campaign, companyId) {
  const issues = []

  // 1. Cloud template check
  const cloudish = campaign.channel === 'META_WA' || (campaign.channel === 'AUTO' && campaign.templateId)
  if (cloudish) {
    if (!campaign.templateId) {
      issues.push({ severity: 'error', code: 'no_template', msg: 'Template não selecionado' })
    } else if (campaign.template?.status !== 'APPROVED') {
      issues.push({
        severity: 'error',
        code: 'template_not_approved',
        msg: `Template está ${campaign.template?.status || 'desconhecido'}, precisa ser APPROVED`,
      })
    }
  }

  // 2. Evaluate audience — TRIGGER campaigns build the audience dynamically
  // from incoming inbound messages (no pre-defined segment), so the segment
  // gate is skipped entirely.
  let eligible = 0
  if (campaign.scheduleType === 'TRIGGER') {
    // Validate trigger-specific config exists (triggerType already validated
    // on create, but the campaign may have been edited).
    if (!campaign.triggerType) {
      issues.push({ severity: 'error', code: 'no_trigger_type', msg: 'Tipo de gatilho não definido' })
    }
    // No empty-audience gate — trigger sweep decides at runtime.
    return { eligible, issues }
  }

  try {
    const customerIds = await evaluateSegment({ companyId, ruleJson: campaign.segment.ruleJson })
    eligible = customerIds.length
  } catch (e) {
    issues.push({ severity: 'error', code: 'segment_invalid', msg: `Segmento inválido: ${e.message}` })
  }
  if (eligible === 0) {
    issues.push({ severity: 'error', code: 'empty_audience', msg: 'Nenhum cliente elegível na audiência' })
  }

  // 3. Evolution + large audience warning
  if (campaign.channel === 'EVOLUTION_WA' && eligible > 50) {
    issues.push({
      severity: 'warning',
      code: 'evo_mass_send',
      msg: `${eligible} envios via Evolution: risco real de ban. Considere Cloud API.`,
    })
  }

  // 4. > 500 confirmation
  if (eligible > 500) {
    issues.push({
      severity: 'confirm',
      code: 'large_audience',
      msg: `Audiência grande: ${eligible}. Confirme digitando o número.`,
    })
  }

  return { eligible, issues }
}

// GET /marketing/campaigns/:id/preflight
router.get('/:id/preflight', async (req, res) => {
  const companyId = req.user.companyId
  const { id } = req.params
  const c = await prisma.marketingCampaign.findFirst({
    where: { id, companyId },
    include: { segment: true, template: true },
  })
  if (!c) return res.status(404).json({ message: 'Campaign not found' })
  const result = await computePreflight(c, companyId)
  res.json(result)
})

// Activate: DRAFT -> SCHEDULED (tightened with pre-flight checks)
router.post('/:id/activate', requireRole('ADMIN'), async (req, res) => {
  const companyId = req.user.companyId
  const { id } = req.params
  const { confirmedCount } = req.body || {}
  const c = await prisma.marketingCampaign.findFirst({
    where: { id, companyId },
    include: { segment: true, template: true },
  })
  if (!c) return res.status(404).json({ message: 'Campaign not found' })
  if (c.status !== 'DRAFT') return res.status(400).json({ message: `Cannot activate from status ${c.status}` })

  const preflight = await computePreflight(c, companyId)
  const errors = preflight.issues.filter(i => i.severity === 'error')
  if (errors.length) {
    return res.status(400).json({ message: 'Pre-flight failed', issues: errors, eligible: preflight.eligible })
  }
  const confirmNeeded = preflight.issues.find(i => i.code === 'large_audience')
  if (confirmNeeded && Number(confirmedCount) !== preflight.eligible) {
    return res.status(400).json({
      message: 'Audience confirmation required',
      issues: preflight.issues,
      eligible: preflight.eligible,
    })
  }

  // TRIGGER goes straight to RUNNING — there's no scheduled-for moment to
  // wait for; the cron sweep starts evaluating immediately.
  const targetStatus = c.scheduleType === 'TRIGGER' ? 'RUNNING' : 'SCHEDULED'
  const updated = await prisma.marketingCampaign.update({
    where: { id },
    data: { status: targetStatus },
  })
  res.json(updated)
})

// Pause: SCHEDULED/RUNNING -> PAUSED
router.post('/:id/pause', requireRole('ADMIN'), async (req, res) => {
  const { companyId } = req.user
  const { id } = req.params
  const c = await prisma.marketingCampaign.findFirst({ where: { id, companyId } })
  if (!c) return res.status(404).json({ message: 'Campanha não encontrada' })
  if (!['SCHEDULED', 'RUNNING'].includes(c.status)) {
    return res.status(409).json({ message: `Campanha em status ${c.status} não pode ser pausada` })
  }
  try {
    const updated = await prisma.marketingCampaign.update({
      where: { id },
      data: { status: 'PAUSED' },
    })
    return res.json(updated)
  } catch (e) {
    console.error('Failed to pause campaign:', e?.message || e)
    return res.status(500).json({ message: 'Falha ao pausar campanha' })
  }
})

// Resume: PAUSED -> SCHEDULED
router.post('/:id/resume', requireRole('ADMIN'), async (req, res) => {
  const { companyId } = req.user
  const { id } = req.params
  const c = await prisma.marketingCampaign.findFirst({ where: { id, companyId } })
  if (!c) return res.status(404).json({ message: 'Campanha não encontrada' })
  if (c.status !== 'PAUSED') {
    return res.status(409).json({ message: `Campanha em status ${c.status} não pode ser retomada` })
  }
  try {
    const updated = await prisma.marketingCampaign.update({
      where: { id },
      data: { status: 'SCHEDULED' },
    })
    return res.json(updated)
  } catch (e) {
    console.error('Failed to resume campaign:', e?.message || e)
    return res.status(500).json({ message: 'Falha ao retomar campanha' })
  }
})

// Cancel: irreversible. Blocks if COMPLETED/CANCELLED already.
router.post('/:id/cancel', requireRole('ADMIN'), async (req, res) => {
  const { companyId } = req.user
  const { id } = req.params
  const c = await prisma.marketingCampaign.findFirst({ where: { id, companyId } })
  if (!c) return res.status(404).json({ message: 'Campanha não encontrada' })
  if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(c.status)) {
    return res.status(409).json({ message: `Campanha em status ${c.status} não pode ser cancelada` })
  }
  try {
    const updated = await prisma.marketingCampaign.update({
      where: { id },
      data: { status: 'CANCELLED' },
    })
    return res.json(updated)
  } catch (e) {
    console.error('Failed to cancel campaign:', e?.message || e)
    return res.status(500).json({ message: 'Falha ao cancelar campanha' })
  }
})

router.get('/:id/stats', async (req, res) => {
  const companyId = req.user.companyId
  const { id } = req.params
  const c = await prisma.marketingCampaign.findFirst({ where: { id, companyId } })
  if (!c) return res.status(404).json({ message: 'Not found' })

  const breakdown = await prisma.marketingMessage.groupBy({
    by: ['status'],
    where: { campaignId: id },
    _count: { id: true },
  })
  const get = (status) => breakdown.find(b => b.status === status)?._count.id || 0

  const sent      = get('SENT') + get('DELIVERED') + get('READ')
  const delivered = get('DELIVERED') + get('READ')
  const read      = get('READ')

  const converted = await prisma.marketingMessage.count({
    where: { campaignId: id, convertedOrderId: { not: null } },
  })
  const strong = await prisma.marketingMessage.count({
    where: { campaignId: id, attributionSignal: 'STRONG' },
  })
  const sum = await prisma.marketingMessage.aggregate({
    where: { campaignId: id, convertedOrderId: { not: null } },
    _sum: { convertedValue: true },
  })

  res.json({
    sent, delivered, read,
    failed: get('FAILED'),
    optedOut: get('OPTED_OUT'),
    scheduled: get('SCHEDULED'),
    suppressedQuietHours: get('SUPPRESSED_QUIET_HOURS'),
    converted,
    convertedStrong: strong,
    revenue: sum._sum.convertedValue || 0,
  })
})

router.get('/:id/messages', async (req, res) => {
  const companyId = req.user.companyId
  const { id } = req.params
  const c = await prisma.marketingCampaign.findFirst({ where: { id, companyId } })
  if (!c) return res.status(404).json({ message: 'Not found' })
  const limit = Math.min(Number(req.query.limit || 50), 200)
  const messages = await prisma.marketingMessage.findMany({
    where: { campaignId: id },
    take: limit,
    orderBy: { createdAt: 'desc' },
    include: { customer: { select: { id: true, fullName: true, whatsapp: true } } },
  })
  res.json(messages)
})

export default router
