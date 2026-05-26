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
  'templateId',
  'freeText',
  'templateVariableMap',
  'conversionWindowHours',
  'attributionScope',
  'segmentMenuId',
  'couponId',
]

function parseDate(v) {
  if (v === null || v === undefined || v === '') return null
  const d = new Date(v)
  return Number.isFinite(d.getTime()) ? d : undefined // undefined means invalid
}

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
    templateId,
    freeText,
    templateVariableMap,
    conversionWindowHours,
    attributionScope,
    segmentMenuId,
    couponId,
  } = req.body || {}

  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ message: 'Nome é obrigatório' })
  }
  if (!segmentId) {
    return res.status(400).json({ message: 'segmentId é obrigatório' })
  }
  if (!scheduleType || !VALID_SCHEDULE_TYPES.has(scheduleType)) {
    return res.status(400).json({ message: 'scheduleType inválido' })
  }

  const ch = channel || 'AUTO'
  if (!VALID_CHANNELS.has(ch)) {
    return res.status(400).json({ message: 'channel inválido' })
  }
  const scope = attributionScope || 'menu'
  if (!VALID_ATTRIBUTION_SCOPES.has(scope)) {
    return res.status(400).json({ message: 'attributionScope inválido' })
  }

  // segmentId must belong to this company
  const segment = await prisma.marketingSegment.findFirst({ where: { id: segmentId, companyId } })
  if (!segment) {
    return res.status(400).json({ message: 'Segmento inválido ou não pertence à empresa' })
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

  try {
    const created = await prisma.marketingCampaign.create({
      data: {
        companyId,
        segmentId,
        name: name.trim(),
        scheduleType,
        scheduledFor: parsedScheduledFor,
        cronExpression: cronExpression || null,
        triggerType: triggerType || null,
        triggerParams: triggerParams ?? null,
        channel: ch,
        templateId: templateId || null,
        freeText: freeText || null,
        templateVariableMap: templateVariableMap ?? null,
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

  // 2. Evaluate audience
  let eligible = 0
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

  const updated = await prisma.marketingCampaign.update({
    where: { id },
    data: { status: 'SCHEDULED' },
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
  if (['COMPLETED', 'CANCELLED'].includes(c.status)) {
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
