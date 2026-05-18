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
 * Cria Combo + ComboSlot[] + ComboSlotOption[] para um produto dentro de uma transação Prisma.
 * O valor declarado fiscal (vUnComDeclarado) é por SLOT, não por opção: qualquer opção
 * escolhida dentro de um slot recebe o mesmo vUnCom no rateio fiscal.
 * Valida slot.vUnComDeclarado finito > 0, soma <= precoCombo (NFC-e não pode declarar
 * mais do que o cliente pagou) e cada opção: linkedProductId presente e pertencente
 * à mesma companyId (multi-tenant). Lança erro descritivo em falha, forçando rollback.
 *
 * @param {number} [precoCombo] Preço pago pelo cliente (Product.price). Quando informado,
 *                              valida que a soma dos vUnComDeclarado dos slots não ultrapassa.
 */
export async function createComboGraph(tx, productId, companyId, comboInput, precoCombo) {
  const slotsInput = comboInput.slots || []
  // valida soma total antes de criar qualquer registro
  if (typeof precoCombo === 'number' && Number.isFinite(precoCombo) && precoCombo > 0) {
    const somaDeclarada = slotsInput.reduce((acc, s) => acc + (Number(s.vUnComDeclarado) || 0), 0)
    const somaArred = Math.round(somaDeclarada * 100) / 100
    const precoArred = Math.round(precoCombo * 100) / 100
    if (somaArred > precoArred) {
      throw new Error(
        `Soma dos valores declarados dos slots (R$ ${somaArred.toFixed(2)}) excede o preço do combo (R$ ${precoArred.toFixed(2)})`
      )
    }
  }
  const combo = await tx.combo.create({ data: { productId, companyId } })
  for (const [sIdx, slot] of slotsInput.entries()) {
    const vUn = Number(slot.vUnComDeclarado)
    if (!Number.isFinite(vUn) || vUn <= 0) {
      throw new Error(`Slot ${sIdx + 1}: valor declarado inválido`)
    }
    const createdSlot = await tx.comboSlot.create({
      data: {
        comboId: combo.id,
        name: String(slot.name || `Slot ${sIdx + 1}`),
        minSelect: Number(slot.minSelect ?? 1),
        maxSelect: Number(slot.maxSelect ?? 1),
        position: sIdx,
        vUnComDeclarado: slot.vUnComDeclarado,
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
