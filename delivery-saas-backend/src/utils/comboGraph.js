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
 * Valida cada opção: linkedProductId presente, vUnComReferencia finito > 0, e linked product
 * pertence à mesma companyId (multi-tenant). Lança "Slot X: opção Y inválida" em falha,
 * forçando rollback da transação.
 *
 * @param {Prisma.TransactionClient} tx
 * @param {string} productId
 * @param {string} companyId
 * @param {{ slots: Array<{name?: string, minSelect?: number, maxSelect?: number, options: Array<{linkedProductId: string, vUnComReferencia: number, integrationCode?: string|null}>}> }} comboInput
 */
export async function createComboGraph(tx, productId, companyId, comboInput) {
  const combo = await tx.combo.create({ data: { productId, companyId } })
  for (const [sIdx, slot] of (comboInput.slots || []).entries()) {
    const createdSlot = await tx.comboSlot.create({
      data: {
        comboId: combo.id,
        name: String(slot.name || `Slot ${sIdx + 1}`),
        minSelect: Number(slot.minSelect ?? 1),
        maxSelect: Number(slot.maxSelect ?? 1),
        position: sIdx,
      },
    })
    for (const [oIdx, opt] of (slot.options || []).entries()) {
      const vUn = Number(opt.vUnComReferencia)
      if (!opt.linkedProductId || !Number.isFinite(vUn) || vUn <= 0) {
        throw new Error(`Slot ${sIdx + 1}: opção ${oIdx + 1} inválida`)
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
          vUnComReferencia: opt.vUnComReferencia,
          integrationCode: opt.integrationCode || null,
          position: oIdx,
        },
      })
    }
  }
}
