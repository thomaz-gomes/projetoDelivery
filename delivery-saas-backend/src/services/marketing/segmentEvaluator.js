import { prisma } from '../../prisma.js'
import { compileRule } from './segmentCompiler.js'

// Tightened menuId guard: only allow UUID-shaped strings.
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Returns the list of customerIds matching the segment for a given company.
 * Always filters by optInMarketing=true AND optOutMarketingAt IS NULL.
 * Optionally restricts to customers that have an order on a specific menuId.
 *
 * @param {object} params
 * @param {string} params.companyId
 * @param {{ rule: object, menuId?: string }} params.ruleJson
 * @returns {Promise<string[]>}
 */
export async function evaluateSegment({ companyId, ruleJson }) {
  if (!companyId || !ruleJson?.rule) {
    throw new Error('companyId and ruleJson.rule required')
  }

  const compiled = compileRule(ruleJson.rule)

  let menuFilter = ''
  if (ruleJson.menuId) {
    const mid = String(ruleJson.menuId)
    if (!UUID_REGEX.test(mid)) throw new Error(`invalid menuId: ${mid}`)
    menuFilter = `AND EXISTS (SELECT 1 FROM "Order" o WHERE o."customerId" = c.id AND o."menuId" = '${mid}')`
  }

  const sql = `
    SELECT c.id
    FROM "Customer" c
    WHERE c."companyId" = $1::text
      AND c."optInMarketing" = true
      AND c."optOutMarketingAt" IS NULL
      ${menuFilter}
      AND (${compiled})
  `

  const rows = await prisma.$queryRawUnsafe(sql, companyId)
  return rows.map((r) => r.id)
}

/**
 * Live preview for the segment builder: returns the total count and a small
 * sample of customers (default 10).
 *
 * @param {object} params
 * @param {string} params.companyId
 * @param {{ rule: object, menuId?: string }} params.ruleJson
 * @param {number} [params.sampleSize=10]
 * @returns {Promise<{ count: number, sample: Array<{id:string, fullName:string, whatsapp:string|null}> }>}
 */
export async function previewSegment({ companyId, ruleJson, sampleSize = 10 }) {
  const ids = await evaluateSegment({ companyId, ruleJson })
  const sample = ids.slice(0, sampleSize)
  let sampleCustomers = []
  if (sample.length) {
    sampleCustomers = await prisma.customer.findMany({
      where: { id: { in: sample } },
      select: { id: true, fullName: true, whatsapp: true },
    })
  }
  return { count: ids.length, sample: sampleCustomers }
}
