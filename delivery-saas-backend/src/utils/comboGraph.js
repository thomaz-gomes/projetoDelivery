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
 * Valida slot.vUnComDeclarado finito > 0 e cada opção: linkedProductId presente e
 * pertencente à mesma companyId (multi-tenant). Lança erro descritivo em falha,
 * forçando rollback da transação.
 */
export async function createComboGraph(tx, productId, companyId, comboInput) {
  const combo = await tx.combo.create({ data: { productId, companyId } })
  for (const [sIdx, slot] of (comboInput.slots || []).entries()) {
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
