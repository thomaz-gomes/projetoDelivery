/**
 * Prisma include shape for Product → Combo → Slots → Options → linkedProduct.
 * Used in GET/POST/PATCH /menu/products responses and (later) in NFe expansion.
 */
export const COMBO_INCLUDE = {
  combo: {
    include: {
      slots: {
        include: {
          options: {
            include: {
              linkedProduct: {
                select: { id: true, name: true, price: true, integrationCode: true },
              },
            },
            orderBy: { position: 'asc' },
          },
        },
        orderBy: { position: 'asc' },
      },
    },
  },
}

/**
 * Validate the variable-combo invariant: exactly one slot must be flagged as
 * the price anchor. Throws a descriptive Error on failure (which Prisma will
 * surface back as a 400 in the route layer).
 */
function validateVariableComboAnchor(slotsInput) {
  const anchors = slotsInput.filter(s => !!s.isPriceAnchor)
  if (anchors.length === 0) {
    throw new Error('Combo variável precisa de exatamente um slot marcado como âncora (preço fixo).')
  }
  if (anchors.length > 1) {
    throw new Error('Combo variável só pode ter UM slot âncora. Marque apenas um.')
  }
  if (slotsInput.length < 2) {
    throw new Error('Combo variável precisa de pelo menos 2 slots (1 âncora + 1 ou mais variáveis).')
  }
  const anchor = anchors[0]
  const v = Number(anchor.vUnComDeclarado)
  if (!Number.isFinite(v) || v <= 0) {
    throw new Error('Combo variável: o slot âncora precisa de um valor fixo (vUnComDeclarado) maior que zero.')
  }
}

/**
 * Cria Combo + ComboSlot[] + ComboSlotOption[] para um produto dentro de uma transação Prisma.
 *
 * Modo FIXED  (default): vUnComDeclarado é por SLOT, aplicado a qualquer opção
 *   escolhida; soma <= precoCombo (NFC-e não pode declarar mais do que o cliente
 *   pagou) — esta é a semântica histórica.
 * Modo VARIABLE: o preço pago pelo cliente vem da soma das escolhas. Exatamente
 *   um slot precisa ter isPriceAnchor=true; seu vUnComDeclarado é o valor fixo
 *   contribuído pelo slot (vira o vUnCom do anchor na NF-e). Os slots não-âncora
 *   têm seus vUnComs calculados proporcionalmente no momento da emissão fiscal.
 *
 * @param {number} [precoCombo] Preço de referência do produto. Em FIXED é o preço
 *   pago; em VARIABLE é só a partir-de exibida no menu.
 */
export async function createComboGraph(tx, productId, companyId, comboInput, precoCombo) {
  const slotsInput = comboInput.slots || []
  const pricingMode = comboInput.pricingMode === 'VARIABLE' ? 'VARIABLE' : 'FIXED'

  if (pricingMode === 'VARIABLE') {
    validateVariableComboAnchor(slotsInput)
  } else if (typeof precoCombo === 'number' && Number.isFinite(precoCombo) && precoCombo > 0) {
    // FIXED: soma dos vUnCom não pode exceder o preço cobrado.
    const somaDeclarada = slotsInput.reduce((acc, s) => acc + (Number(s.vUnComDeclarado) || 0), 0)
    const somaArred = Math.round(somaDeclarada * 100) / 100
    const precoArred = Math.round(precoCombo * 100) / 100
    if (somaArred > precoArred) {
      throw new Error(
        `Soma dos valores declarados dos slots (R$ ${somaArred.toFixed(2)}) excede o preço do combo (R$ ${precoArred.toFixed(2)})`
      )
    }
  }

  const combo = await tx.combo.create({ data: { productId, companyId, pricingMode } })
  for (const [sIdx, slot] of slotsInput.entries()) {
    const vUn = Number(slot.vUnComDeclarado)
    if (!Number.isFinite(vUn) || vUn <= 0) {
      // In VARIABLE mode non-anchor slots may legitimately have vUnComDeclarado
      // = 0 (the value is computed at NF-e time). Allow zero only there.
      if (!(pricingMode === 'VARIABLE' && !slot.isPriceAnchor)) {
        throw new Error(`Slot ${sIdx + 1}: valor declarado inválido`)
      }
    }
    const createdSlot = await tx.comboSlot.create({
      data: {
        comboId: combo.id,
        name: String(slot.name || `Slot ${sIdx + 1}`),
        minSelect: Number(slot.minSelect ?? 1),
        maxSelect: Number(slot.maxSelect ?? 1),
        position: sIdx,
        vUnComDeclarado: Number.isFinite(vUn) && vUn > 0 ? slot.vUnComDeclarado : 0,
        isPriceAnchor: pricingMode === 'VARIABLE' ? !!slot.isPriceAnchor : false,
      },
    })
    for (const [oIdx, opt] of (slot.options || []).entries()) {
      if (!opt.linkedProductId) {
        throw new Error(`Slot ${sIdx + 1}: opção ${oIdx + 1} sem produto`)
      }
      const linked = await tx.product.findFirst({
        where: { id: opt.linkedProductId, companyId },
        select: { id: true },
      })
      if (!linked) {
        throw new Error(`Slot ${sIdx + 1}: opção ${oIdx + 1} inválida`)
      }
      await tx.comboSlotOption.create({
        data: {
          slotId: createdSlot.id,
          linkedProductId: opt.linkedProductId,
          integrationCode: opt.integrationCode || null,
          position: oIdx,
        },
      })
    }
  }
}
