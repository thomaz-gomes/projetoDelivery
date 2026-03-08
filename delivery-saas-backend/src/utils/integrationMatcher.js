import { prisma } from '../prisma.js'

/**
 * Matches integration order items to local products/options by integrationCode.
 * - Uses the item's externalCode (iFood) or id/sku to find a matching local Product
 * - When matched: replaces the item name with the local product name, keeps integration price
 * - Also matches subitems/options by their integration codes (checks both Option and Product tables)
 *
 * @param {Array} items - raw items from integration payload
 * @param {string} companyId - the company to match against
 * @returns {Array} items with local names resolved where matches found
 */
export async function matchItemsToLocalProducts(items, companyId) {
  console.log('[IntegrationMatcher] called with', items?.length, 'items, companyId:', companyId)
  if (!items || !items.length || !companyId) return items

  // Collect all possible external codes from items and subitems
  const itemCodes = []
  const subCodes = []

  for (const it of items) {
    const code = it.externalCode || it.externalId || it.sku || it.productId || null
    if (code) itemCodes.push(String(code))

    const subs = it.subItems || it.subitems || it.garnishItems || it.options || []
    for (const sub of subs) {
      const subCode = sub.externalCode || sub.externalId || sub.sku || null
      if (subCode) subCodes.push(String(subCode))
    }
  }

  const allCodes = [...new Set([...itemCodes, ...subCodes])]
  console.log('[IntegrationMatcher] itemCodes:', itemCodes, 'subCodes:', subCodes)

  // Batch fetch ALL matching products (for both items and subitems)
  const productMap = {}
  if (allCodes.length > 0) {
    const products = await prisma.product.findMany({
      where: { companyId, integrationCode: { in: allCodes } },
      select: { id: true, name: true, integrationCode: true }
    })
    console.log('[IntegrationMatcher] found', products.length, 'matching products:', products.map(p => `${p.integrationCode}=${p.name}`))
    for (const p of products) {
      productMap[p.integrationCode] = p
    }
  }

  // Batch fetch matching options (for subitems)
  const optionMap = {}
  if (subCodes.length > 0) {
    const uniqueSubCodes = [...new Set(subCodes)]
    const options = await prisma.option.findMany({
      where: { integrationCode: { in: uniqueSubCodes }, group: { companyId } },
      select: { id: true, name: true, integrationCode: true }
    })
    for (const o of options) {
      optionMap[o.integrationCode] = o
    }

    // Also try matching specific codes (P-XXXX-O-YYYY) by extracting the O-YYYY part
    for (const code of uniqueSubCodes) {
      if (!optionMap[code] && code.includes('-O-')) {
        const optPart = 'O-' + code.split('-O-').pop()
        const match = options.find(o => o.integrationCode === optPart)
        if (match) optionMap[code] = match
      }
    }
  }

  // Apply matches
  return items.map(it => {
    const code = it.externalCode || it.externalId || it.sku || it.productId || null
    const matched = code ? productMap[String(code)] : null

    const result = { ...it }
    console.log('[IntegrationMatcher] item:', it.name, 'code:', code, 'matched:', matched ? matched.name : 'NO MATCH')
    if (matched) {
      result.name = matched.name
      result._matchedProductId = matched.id
    }

    // Match subitems/options — check Option table first, then Product table
    const subs = it.subItems || it.subitems || it.garnishItems || it.options || []
    if (subs.length > 0) {
      const subKey = it.subItems ? 'subItems' : it.subitems ? 'subitems' : it.garnishItems ? 'garnishItems' : 'options'
      result[subKey] = subs.map(sub => {
        const subCode = sub.externalCode || sub.externalId || sub.sku || null
        const matchedOpt = subCode ? optionMap[String(subCode)] : null
        const matchedProd = subCode ? productMap[String(subCode)] : null
        const match = matchedOpt || matchedProd

        console.log('[IntegrationMatcher] sub:', sub.name, 'code:', subCode, 'matched:', match ? match.name : 'NO MATCH', matchedOpt ? '(option)' : matchedProd ? '(product)' : '')

        if (match) {
          return { ...sub, name: match.name, _matchedProductId: match.id }
        }
        return sub
      })
    }

    return result
  })
}
