export async function buildAndPersistStockMovementFromOrderItems(prismaInstance, order) {
	if (!order || !order.items || !Array.isArray(order.items) || order.items.length === 0) return null;

	const companyId = order.companyId;
	const storeId = order.storeId || null;

	const deductions = new Map(); // ingredientId -> total qty

	function addDed(ingredientId, qty) {
		if (!ingredientId) return;
		const n = Number(qty || 0);
		if (n === 0) return;
		const cur = deductions.get(ingredientId) || 0;
		deductions.set(ingredientId, cur + n);
	}

	for (const it of order.items) {
		try {
			const itemQty = Number(it.quantity || 1) || 1;

			// Resolve product (best-effort)
			let product = null;
			try {
				if (it.productId) product = await prismaInstance.product.findFirst({ where: { id: it.productId, companyId } });
				if (!product && it.name) product = await prismaInstance.product.findFirst({ where: { companyId, name: it.name } });
			} catch (e) { /* ignore */ }

			// Product technical sheet
			if (product && product.technicalSheetId) {
				try {
					const sheet = await prismaInstance.technicalSheet.findUnique({ where: { id: product.technicalSheetId }, include: { items: { include: { ingredient: true } } } });
					if (sheet && Array.isArray(sheet.items)) {
						for (const si of sheet.items) {
							if (si.ingredient && si.ingredient.controlsStock) addDed(si.ingredientId, Number(si.quantity || 0) * itemQty);
						}
					}
				} catch (e) { /* ignore */ }
			}

			// Process options: support array or object map
			if (Array.isArray(it.options)) {
				for (const optEntry of it.options) {
					try {
						// normalize option entry
						let optQty = 1;
						let optName = null;
						let optId = null;

						if (typeof optEntry === 'string') {
							optName = optEntry;
						} else if (typeof optEntry === 'object' && optEntry !== null) {
							optQty = Number(optEntry.quantity || optEntry.qty || optEntry.count || 1) || 1;
							optName = optEntry.name || (optEntry.option && optEntry.option.name) || null;
							optId = optEntry.id || optEntry.optionId || (optEntry.option && optEntry.option.id) || null;
						}

						// parse '2x Name' patterns
						if (optName && typeof optName === 'string') {
							const m = optName.match(/^\s*(\d+)\s*[x×]\s*(.*)$/i);
							if (m) {
								optQty = Number(m[1]) || optQty;
								optName = (m[2] || '').trim();
							}
						}

						// Try to resolve option by product scope then fallbacks
						let option = null;
						if (product) {
							try {
								const groups = await prismaInstance.productOptionGroup.findMany({ where: { productId: product.id }, select: { groupId: true } });
								const groupIds = Array.isArray(groups) ? groups.map(g => g.groupId) : [];
								if (groupIds.length && optName) {
									option = await prismaInstance.option.findFirst({ where: { groupId: { in: groupIds }, name: optName } });
								}
							} catch (e) { /* ignore */ }
						}

						if (!option && optId) {
							option = await prismaInstance.option.findUnique({ where: { id: optId }, include: { group: true } }).catch(() => null);
							if (option && option.group && option.group.companyId !== companyId) option = null;
						}

						if (!option && optName) {
							option = await prismaInstance.option.findFirst({ where: { name: optName }, include: { group: true } }).catch(() => null);
							if (option && option.group && option.group.companyId !== companyId) option = null;
						}

						if (!option && optName) {
							const simple = String(optName).split(' — ')[0].trim();
							if (simple) {
								option = await prismaInstance.option.findFirst({ where: { name: { startsWith: simple } }, include: { group: true } }).catch(() => null);
								if (option && option.group && option.group.companyId !== companyId) option = null;
							}
						}

						if (!option) continue;

						// If option links to a product, use its sheet; otherwise option's sheet
						if (option.linkedProductId) {
							try {
								const linked = await prismaInstance.product.findUnique({ where: { id: option.linkedProductId } });
								if (linked && linked.technicalSheetId) {
									const osheet = await prismaInstance.technicalSheet.findUnique({ where: { id: linked.technicalSheetId }, include: { items: { include: { ingredient: true } } } });
									if (osheet && Array.isArray(osheet.items)) {
										for (const osi of osheet.items) {
											if (osi.ingredient && osi.ingredient.controlsStock) addDed(osi.ingredientId, Number(osi.quantity || 0) * itemQty * optQty);
										}
									}
								}
							} catch (e) { /* ignore */ }
						} else if (option.technicalSheetId) {
							try {
								const osheet = await prismaInstance.technicalSheet.findUnique({ where: { id: option.technicalSheetId }, include: { items: { include: { ingredient: true } } } });
								if (osheet && Array.isArray(osheet.items)) {
									for (const osi of osheet.items) {
										if (osi.ingredient && osi.ingredient.controlsStock) addDed(osi.ingredientId, Number(osi.quantity || 0) * itemQty * optQty);
									}
								}
							} catch (e) { /* ignore */ }
						}
					} catch (e) { /* ignore option errors */ }
				}
			} else if (it.options && typeof it.options === 'object') {
				// options as map { key: qty }
				for (const [k, v] of Object.entries(it.options)) {
					try {
						const optQty = Number(v || 0) || 1;
						let option = await prismaInstance.option.findUnique({ where: { id: k }, include: { group: true } }).catch(() => null);
						if (!option) {
							const simple = String(k).split(' — ')[0].trim();
							option = await prismaInstance.option.findFirst({ where: { name: { startsWith: simple } }, include: { group: true } }).catch(() => null);
							if (option && option.group && option.group.companyId !== companyId) option = null;
						}
						if (!option) continue;

						if (option.linkedProductId) {
							const linked = await prismaInstance.product.findUnique({ where: { id: option.linkedProductId } });
							if (linked && linked.technicalSheetId) {
								const osheet = await prismaInstance.technicalSheet.findUnique({ where: { id: linked.technicalSheetId }, include: { items: { include: { ingredient: true } } } });
								if (osheet && Array.isArray(osheet.items)) {
									for (const osi of osheet.items) {
										if (osi.ingredient && osi.ingredient.controlsStock) addDed(osi.ingredientId, Number(osi.quantity || 0) * itemQty * optQty);
									}
								}
							}
						} else if (option.technicalSheetId) {
							const osheet = await prismaInstance.technicalSheet.findUnique({ where: { id: option.technicalSheetId }, include: { items: { include: { ingredient: true } } } });
							if (osheet && Array.isArray(osheet.items)) {
								for (const osi of osheet.items) {
									if (osi.ingredient && osi.ingredient.controlsStock) addDed(osi.ingredientId, Number(osi.quantity || 0) * itemQty * optQty);
								}
							}
						}
					} catch (e) { /* ignore */ }
				}
			}
		} catch (e) {
			/* ignore per-item errors */
		}
	}

	if (deductions.size === 0) return null;

	const items = Array.from(deductions.entries()).map(([ingredientId, quantity]) => ({ ingredientId, quantity }));

	const result = await prismaInstance.$transaction(async (tx) => {
		const movement = await tx.stockMovement.create({ data: { companyId, storeId, type: 'OUT', reason: 'Pedido automático', note: `Order:${order.id}` } });
		for (const it of items) {
			const ingredient = await tx.ingredient.findUnique({ where: { id: it.ingredientId } });
			if (!ingredient) throw new Error(`Ingrediente não encontrado: ${it.ingredientId}`);
			const qty = Number(it.quantity || 0);
			await tx.stockMovementItem.create({ data: { stockMovementId: movement.id, ingredientId: it.ingredientId, quantity: qty, unitCost: null } });
			const newStock = Number(ingredient.currentStock || 0) - qty;
			await tx.ingredient.update({ where: { id: it.ingredientId }, data: { currentStock: newStock } });
		}
		return await tx.stockMovement.findUnique({ where: { id: movement.id }, include: { items: { include: { ingredient: true } }, company: true, store: true } });
	});

	return result;
}

export default buildAndPersistStockMovementFromOrderItems;



