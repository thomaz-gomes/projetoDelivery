import { rateioCombo } from '../utils/comboRateio.js'

/**
 * Mescla campo-a-campo: product-level prevalece quando preenchido, mas cai
 * no category-level para cada campo individualmente. Antes o código pegava
 * o objeto inteiro do produto e descartava silenciosamente o NCM da
 * categoria quando o produto tinha um DadosFiscais "esqueleto" (sem NCM).
 */
function mergeFiscal(prodFiscal, catFiscal) {
  if (!prodFiscal && !catFiscal) return null
  const p = prodFiscal || {}
  const c = catFiscal || {}
  const pick = (k) =>
    p[k] !== null && p[k] !== undefined && p[k] !== '' ? p[k] : c[k] ?? null
  return {
    ncm: pick('ncm'),
    orig: pick('orig'),
    ean: pick('ean'),
    cfops: pick('cfops'),
    cest: pick('cest'),
    icmsAliq: pick('icmsAliq'),
    icmsModBC: pick('icmsModBC'),
    icmsPercBase: pick('icmsPercBase'),
    icmsFCP: pick('icmsFCP'),
    icmsEfetAliq: pick('icmsEfetAliq'),
    icmsEfetPercBase: pick('icmsEfetPercBase'),
    pPIS: pick('pPIS'),
    pCOFINS: pick('pCOFINS'),
    pIPI: pick('pIPI'),
    codBeneficio: pick('codBeneficio'),
  }
}

/**
 * Constrói uma linha (det) NFC-e sem nItem (será reatribuído depois).
 */
function buildLine({ name, qty, unitPrice, prod, fiscal, idxFallback }) {
  const ncm = fiscal?.ncm
    ? String(fiscal.ncm).replace(/\D/g, '').padStart(8, '0').slice(0, 8)
    : '00000000'
  let cfop = '5102'
  let csosn = null
  let cstPis = null
  let cstCofins = null
  if (fiscal?.cfops) {
    try {
      const cfopArr = typeof fiscal.cfops === 'string' ? JSON.parse(fiscal.cfops) : fiscal.cfops
      if (Array.isArray(cfopArr) && cfopArr.length > 0) {
        const first = cfopArr[0]
        if (first && typeof first === 'object') {
          cfop = String(first.code || first.cfop || '5102').replace('.', '')
          csosn = first.csosn || null
          cstPis = first.cstPis || null
          cstCofins = first.cstCofins || null
        } else {
          cfop = String(first).replace('.', '')
        }
      }
    } catch {
      /* keep default */
    }
  }
  const ean = fiscal?.ean ? String(fiscal.ean).replace(/\D/g, '') : null
  const cEAN = ean && ean.length >= 8 ? ean : 'SEM GTIN'
  // Product.sku NÃO existe no schema atual — usa idxFallback diretamente.
  const cProd = String(idxFallback)
  const safeQty = Number(qty) || 0
  const safeUnit = Number(unitPrice) || 0
  return {
    prod: {
      xProd: String(name || 'Item').slice(0, 120),
      cProd,
      NCM: ncm,
      CFOP: cfop,
      uCom: 'UN',
      qCom: safeQty.toFixed(4),
      vUnCom: safeUnit.toFixed(4),
      vProd: (safeUnit * safeQty).toFixed(2),
      _ean: cEAN,
    },
    imposto: {
      pICMS: Number(fiscal?.icmsAliq || 0),
      _orig: String(fiscal?.orig ?? '0'),
      _modBC: fiscal?.icmsModBC != null ? String(fiscal.icmsModBC) : null,
      _pPIS: Number(fiscal?.pPIS || 0),
      _pCOFINS: Number(fiscal?.pCOFINS || 0),
      _pIPI: Number(fiscal?.pIPI || 0),
      _csosn: csosn,
      _cstPis: cstPis,
      _cstCofins: cstCofins,
    },
  }
}

/**
 * Expande os OrderItems em linhas <det> da NFC-e, tratando 3 cenários:
 *
 * 1) Combo (productMap.get(item.productId)?.isCombo === true) com slots:
 *    - Os slots viram <det> com rateio fiscal proporcional a vUnComReferencia.
 *    - O NCM de cada slot vem do linkedProduct (option.productId) — não do combo.
 *    - O "guarda-chuva" do combo (produto-pai) é SEMPRE suprimido,
 *      independente do preço — o valor total já é representado pelos slots.
 *    - Addons (kind='addon' ou sem kind) viram <det> próprios com seu preço.
 *
 * 2) Produto com options legados (não-combo) e basePrice <= 0,10 com options:
 *    - "Guarda-chuva" tipo "Refrigerantes R$ 0,01" é suprimido.
 *    - Cada option vira <det> com seu preço real.
 *
 * 3) Produto comum (sem options ou com basePrice > 0,10):
 *    - 1 <det> por item + 1 <det> por opcional pago.
 *    - Opcionais gratuitos (price <= 0) são descartados (SEFAZ rejeita vUnCom=0).
 *
 * @param {Array} orderItems  Lista de OrderItem (com .options).
 * @param {Map<string, object>} productMap  Map id -> Product (com dadosFiscais, category, isCombo).
 * @param {object} [opts]  Reservado para uso futuro (ex.: tpAmb).
 * @returns {Array<{nItem:number, prod:object, imposto:object}>}
 */
export function expandOrderItemsToDet(orderItems, productMap, _opts = {}) {
  const det = []

  for (const item of orderItems) {
    const prod = productMap.get(item.productId)
    const isCombo = prod?.isCombo === true
    const qty = Number(item.quantity) || 0
    const basePrice = Number(item.price) || 0
    const options = Array.isArray(item.options) ? item.options : []

    if (isCombo) {
      const slots = options.filter((o) => o.kind === 'combo_slot')
      const addons = options.filter((o) => o.kind === 'addon' || !o.kind)

      if (slots.length > 0) {
        // Rateio fiscal: distribui o preço do combo proporcionalmente
        // ao vUnComReferencia de cada slot.
        const slotsForRateio = slots.map((s) => ({
          id: s.optionId || s.productId,
          vUnComReferencia: Number(s.vUnComReferencia) || 0,
        }))

        let rateios = []
        try {
          rateios = rateioCombo({
            precoCombo: basePrice,
            slots: slotsForRateio,
            quantity: qty || 1,
          })
        } catch (err) {
          // Fallback defensivo: se rateio falhar (somaRef=0, etc.),
          // distribui igualmente. Em prod não deve cair aqui.
          const fallbackQty = qty || 1
          const totalTarget = Math.round(basePrice * fallbackQty * 100) / 100
          const equal = Math.round((totalTarget / slots.length) * 100) / 100
          rateios = slots.map((s, i) => ({
            id: s.optionId || s.productId,
            vUnCom: Math.round((equal / fallbackQty) * 10000) / 10000,
            qCom: fallbackQty,
            vProd:
              i === slots.length - 1
                ? Math.round((totalTarget - equal * (slots.length - 1)) * 100) / 100
                : equal,
          }))
        }

        slots.forEach((slot, idx) => {
          const rateio = rateios[idx]
          const linkedProd = slot.productId ? productMap.get(slot.productId) : null
          const linkedFiscal = mergeFiscal(
            linkedProd?.dadosFiscais,
            linkedProd?.category?.dadosFiscais
          )
          const line = buildLine({
            name: slot.name || linkedProd?.name || 'Item do combo',
            qty: rateio.qCom,
            unitPrice: rateio.vUnCom,
            prod: linkedProd,
            fiscal: linkedFiscal,
            idxFallback: det.length + 1,
          })
          // Sobrescreve vProd com o valor exato do rateio (evita drift
          // causado pelo recalculo unitPrice * qty com 4 casas).
          line.prod.vProd = Number(rateio.vProd).toFixed(2)
          det.push(line)
        })

        // Addons do combo viram <det> próprios (mesma regra dos options legados).
        for (const opt of addons) {
          const optQtyPerParent = Number(opt.quantity ?? opt.qty ?? 1) || 1
          const optTotalQty = optQtyPerParent * (qty || 1)
          const optPrice = Number(opt.price) || 0
          if (optTotalQty <= 0 || optPrice <= 0) continue
          const linkedProd = opt.productId ? productMap.get(opt.productId) : prod
          const linkedFiscal = mergeFiscal(
            linkedProd?.dadosFiscais,
            linkedProd?.category?.dadosFiscais
          )
          det.push(
            buildLine({
              name: opt.name || 'Adicional',
              qty: optTotalQty,
              unitPrice: optPrice,
              prod: linkedProd,
              fiscal: linkedFiscal,
              idxFallback: det.length + 1,
            })
          )
        }

        // Guarda-chuva do combo: SEMPRE suprimido.
        continue
      }

      // Combo sem slots: cai no fluxo legado (defensivo, não deveria acontecer).
    }

    // Fluxo legado (não-combo OU combo sem slots): expansão de options.
    const hasOptions = options.length > 0
    // "Guarda-chuva" R$ 0,01 com options: suprimir o item-pai para não
    // duplicar o valor (o cliente paga pelos options, não pelo placeholder).
    const isPlaceholder = hasOptions && basePrice > 0 && basePrice <= 0.10

    const fiscal = mergeFiscal(prod?.dadosFiscais, prod?.category?.dadosFiscais)

    if (basePrice > 0 && qty > 0 && !isPlaceholder) {
      det.push(
        buildLine({
          name: item.name,
          qty,
          unitPrice: basePrice,
          prod,
          fiscal,
          idxFallback: det.length + 1,
        })
      )
    }

    for (const opt of options) {
      const optQtyPerParent = Number(opt.quantity ?? opt.qty ?? 1) || 1
      const optTotalQty = optQtyPerParent * (qty || 1)
      const optPrice = Number(opt.price) || 0
      // Modificadores gratuitos ("sem cebola", "ponto da carne") não viram <det>:
      // SEFAZ rejeita vUnCom = 0.
      if (optTotalQty <= 0 || optPrice <= 0) continue
      const linkedProd = opt.productId ? productMap.get(opt.productId) : prod
      const linkedFiscal = mergeFiscal(
        linkedProd?.dadosFiscais,
        linkedProd?.category?.dadosFiscais
      )
      det.push(
        buildLine({
          name: opt.name || 'Opcional',
          qty: optTotalQty,
          unitPrice: optPrice,
          prod: linkedProd,
          fiscal: linkedFiscal,
          idxFallback: det.length + 1,
        })
      )
    }

    // Fallback: item sem basePrice e sem options válidos — preserva uma
    // linha (mesmo zerada) para histórico.
    if (basePrice <= 0 && !hasOptions) {
      det.push(
        buildLine({
          name: item.name,
          qty: qty || 1,
          unitPrice: basePrice,
          prod,
          fiscal,
          idxFallback: det.length + 1,
        })
      )
    }
  }

  // Reatribui nItem sequencial após a expansão.
  det.forEach((d, i) => {
    d.nItem = i + 1
  })

  return det
}
