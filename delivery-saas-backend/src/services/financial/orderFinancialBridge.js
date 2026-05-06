import { prisma } from '../../prisma.js';
import { calculateFees } from './feeCalculator.js';
import { calcSettlementDate } from './settlementCalc.js';

/**
 * Bridge entre o módulo de Pedidos e o módulo Financeiro.
 *
 * Quando um pedido é CONCLUÍDO, esta função cria automaticamente
 * as transações financeiras correspondentes:
 *
 * 1. Receita da venda (RECEIVABLE)
 * 2. Taxas de marketplace (se aplicável) já deduzidas
 * 3. Comissão de motoboy (PAYABLE) se houver entregador vinculado
 * 4. Comissão de afiliado (PAYABLE) se houver afiliado vinculado
 * 5. Desconto de cupom registrado como dedução
 *
 * Uso: chamar `createFinancialEntriesForOrder(order)` no handler
 * de status CONCLUIDO em orders.js.
 *
 * @param {Object} order - Pedido completo com relações carregadas
 */
export async function createFinancialEntriesForOrder(order) {
  if (!order || !order.companyId) return;

  try {
    // Verificar se já existe transação para este pedido (evitar duplicidade)
    const existing = await prisma.financialTransaction.findFirst({
      where: { companyId: order.companyId, sourceType: 'ORDER', sourceId: order.id },
    });
    if (existing) return;

    // Buscar conta padrão da empresa
    const defaultAccount = await prisma.financialAccount.findFirst({
      where: { companyId: order.companyId, isDefault: true, isActive: true },
    });

    // Buscar centro de custo de receita de vendas
    const revenueCostCenter = await prisma.costCenter.findFirst({
      where: { companyId: order.companyId, dreGroup: 'REVENUE', isActive: true },
      orderBy: { code: 'asc' },
    });

    const orderTotal = Number(order.total || 0);
    const now = new Date();

    // Determinar se veio de marketplace (iFood, etc.).
    // Detecção robusta: pedidos do processador moderno do iFood podem ter
    // customerSource null (legacy só era setado pelo webhooks.js antigo) mas
    // têm externalId + payload.merchantId/order — então olhamos múltiplos sinais.
    const isIfood = order.customerSource === 'IFOOD'
      || /ifood/i.test(String(order.payload?.source || order.payload?.integration || ''))
      || Boolean(order.payload?.ifood)
      || Boolean(order.payload?.merchantId && order.payload?.order)
      || (Boolean(order.externalId) && Boolean(order.payload?.merchantId));
    let gatewayConfig = null;
    if (isIfood) {
      gatewayConfig = await prisma.paymentGatewayConfig.findFirst({
        where: { companyId: order.companyId, provider: 'IFOOD', isActive: true },
      });
    }

    // 1. Criar receita principal
    let feeAmount = 0;
    let netAmount = orderTotal;
    let expectedDate = now;
    let marketplaceFee = 0;
    let anticipationFee = 0;
    let isAnticipated = false;

    if (gatewayConfig) {
      // Marketplace fee — deducted at sale time. Embedded in the receivable so
      // (a) the receivable's netAmount matches what actually hits the bank and
      // (b) the bridge still creates a separate PAYABLE for DRE traceability
      // without double-counting the cash flow.
      const fees = await calculateFees(gatewayConfig.id, orderTotal, now);
      marketplaceFee = Number(fees.feeAmount || 0);
      feeAmount = marketplaceFee;
      netAmount = orderTotal - marketplaceFee;

      // Settlement date follows the gateway's schedule (DAILY/WEEKLY/MONTHLY).
      const settlement = calcSettlementDate(now, gatewayConfig);
      expectedDate = settlement.expectedDate;
      isAnticipated = settlement.isAnticipated;

      // Anticipation fee — only if the gateway has it enabled. Charged on top
      // of the marketplace commission and deducted on the (earlier) settlement.
      if (gatewayConfig.anticipationEnabled && Number(gatewayConfig.anticipationFeePercent || 0) > 0) {
        anticipationFee = Math.round(orderTotal * Number(gatewayConfig.anticipationFeePercent) * 100) / 100;
      }
    }

    // Detectar se pagamento já foi recebido (dinheiro, PIX = recebimento imediato)
    const immediatePaymentMethods = ['DINHEIRO', 'PIX', 'CASH', 'MONEY'];
    const payments = order.payload?.paymentConfirmed || [];
    const allImmediate = payments.length > 0 && payments.every(
      p => immediatePaymentMethods.includes(String(p.method || '').toUpperCase())
    );
    const txStatus = allImmediate ? 'PAID' : 'CONFIRMED';

    await prisma.financialTransaction.create({
      data: {
        companyId: order.companyId,
        type: 'RECEIVABLE',
        status: txStatus,
        description: `Venda #${order.displayId || order.displaySimple || order.id.slice(0, 8)}`,
        accountId: defaultAccount?.id || null,
        costCenterId: revenueCostCenter?.id || null,
        gatewayConfigId: gatewayConfig?.id || null,
        storeId: order.storeId || null,
        grossAmount: orderTotal,
        feeAmount,
        netAmount,
        paidAmount: allImmediate ? netAmount : 0,
        dueDate: expectedDate,
        expectedDate,
        paidAt: allImmediate ? now : null,
        issueDate: now,
        sourceType: 'ORDER',
        sourceId: order.id,
      },
    });

    // 1b. PAYABLE — Comissão Marketplace (DRE / auditoria; sem CashFlowEntry)
    //     Já está embutida em feeAmount/netAmount da receivable acima — esta
    //     PAYABLE existe só para o DRE conseguir somar Deduções por categoria.
    if (gatewayConfig && marketplaceFee > 0) {
      const mktCC = await prisma.costCenter.findFirst({
        where: { companyId: order.companyId, code: '2.01.1' },
      }) || await prisma.costCenter.findFirst({
        where: { companyId: order.companyId, code: '2.01' },
      });
      await prisma.financialTransaction.create({
        data: {
          companyId: order.companyId,
          type: 'PAYABLE',
          status: 'PAID',
          description: `Comissão ${gatewayConfig.provider} - Pedido #${order.displayId || order.id.slice(0, 8)}`,
          accountId: null,                  // sem movimento bancário (deduzido na origem)
          costCenterId: mktCC?.id || null,
          gatewayConfigId: gatewayConfig.id,
          storeId: order.storeId || null,
          grossAmount: marketplaceFee,
          feeAmount: 0,
          netAmount: marketplaceFee,
          paidAmount: marketplaceFee,
          dueDate: now,
          paidAt: now,
          issueDate: now,
          sourceType: 'MARKETPLACE_FEE',
          sourceId: order.id,
        },
      });
    }

    // 1c. PAYABLE — Taxa de Antecipação (paga no dia do repasse antecipado)
    if (gatewayConfig && anticipationFee > 0) {
      const antecipCC = await prisma.costCenter.findFirst({
        where: { companyId: order.companyId, code: '2.01.2' },
      }) || await prisma.costCenter.findFirst({
        where: { companyId: order.companyId, code: '2.01' },
      });
      await prisma.financialTransaction.create({
        data: {
          companyId: order.companyId,
          type: 'PAYABLE',
          status: 'CONFIRMED',
          description: `Taxa antecipação ${gatewayConfig.provider} - Pedido #${order.displayId || order.id.slice(0, 8)}`,
          accountId: defaultAccount?.id || null,
          costCenterId: antecipCC?.id || null,
          gatewayConfigId: gatewayConfig.id,
          storeId: order.storeId || null,
          grossAmount: anticipationFee,
          feeAmount: 0,
          netAmount: anticipationFee,
          paidAmount: 0,
          dueDate: expectedDate,
          issueDate: now,
          sourceType: 'ANTICIPATION_FEE',
          sourceId: order.id,
        },
      });
    }

    // 2. Descontos — separar por sponsor
    // discountIfood: iFood paga à loja → RECEIVABLE (entra no caixa)
    // discountMerchant: loja absorve → PAYABLE/dedução (sai do caixa)
    // Fallback: se não tem separação, usa couponDiscount como dedução (comportamento legado)
    const discIfood   = Number(order.discountIfood || 0);
    const discMerch   = Number(order.discountMerchant || 0);
    const discTotal   = Number(order.couponDiscount || 0);
    const pedidoLabel = `Pedido #${order.displayId || order.id.slice(0, 8)}`;

    if (discIfood > 0) {
      // iFood repassa à loja → registrar como receita a receber
      await prisma.financialTransaction.create({
        data: {
          companyId: order.companyId,
          type: 'RECEIVABLE',
          status: 'PENDING',
          description: `Voucher iFood (marketplace) ${order.couponCode || ''} - ${pedidoLabel}`,
          costCenterId: revenueCostCenter?.id || null,
          grossAmount: discIfood,
          feeAmount: 0,
          netAmount: discIfood,
          dueDate: now,
          issueDate: now,
          sourceType: 'COUPON',
          sourceId: order.id,
        },
      });
    }

    if (discMerch > 0) {
      // Loja absorve → registrar como dedução
      const deductionCC = await prisma.costCenter.findFirst({
        where: { companyId: order.companyId, dreGroup: 'DEDUCTIONS', code: { contains: '2.03' } },
      });
      await prisma.financialTransaction.create({
        data: {
          companyId: order.companyId,
          type: 'PAYABLE',
          status: 'PAID',
          description: `Desconto loja ${order.couponCode || ''} - ${pedidoLabel}`,
          costCenterId: deductionCC?.id || null,
          grossAmount: discMerch,
          feeAmount: 0,
          netAmount: discMerch,
          dueDate: now,
          paidAt: now,
          issueDate: now,
          sourceType: 'COUPON',
          sourceId: order.id,
        },
      });
    }

    // Fallback legado: se não tem separação por sponsor mas tem couponDiscount
    if (discTotal > 0 && discIfood === 0 && discMerch === 0) {
      const deductionCC = await prisma.costCenter.findFirst({
        where: { companyId: order.companyId, dreGroup: 'DEDUCTIONS', code: { contains: '2.03' } },
      });
      await prisma.financialTransaction.create({
        data: {
          companyId: order.companyId,
          type: 'PAYABLE',
          status: 'PAID',
          description: `Desconto cupom ${order.couponCode || ''} - ${pedidoLabel}`,
          costCenterId: deductionCC?.id || null,
          grossAmount: discTotal,
          feeAmount: 0,
          netAmount: discTotal,
          dueDate: now,
          paidAt: now,
          issueDate: now,
          sourceType: 'COUPON',
          sourceId: order.id,
        },
      });
    }

    // 3. Taxa de serviço iFood (additionalFees) — retida pelo iFood, registrar como dedução
    const addFees = Number(order.additionalFees || 0);
    if (addFees > 0) {
      const deductionCC = await prisma.costCenter.findFirst({
        where: { companyId: order.companyId, dreGroup: 'DEDUCTIONS', isActive: true },
        orderBy: { code: 'asc' },
      });
      await prisma.financialTransaction.create({
        data: {
          companyId: order.companyId,
          type: 'PAYABLE',
          status: 'PAID',
          description: `Taxa de serviço iFood - ${pedidoLabel}`,
          costCenterId: deductionCC?.id || null,
          grossAmount: addFees,
          feeAmount: 0,
          netAmount: addFees,
          dueDate: now,
          paidAt: now,
          issueDate: now,
          sourceType: 'ORDER_FEE',
          sourceId: order.id,
        },
      });
    }

    // Audit: log successful bridge execution
    await prisma.financialBridgeLog.create({
      data: { companyId: order.companyId, sourceType: 'ORDER', sourceId: order.id, status: 'SUCCESS' },
    }).catch(() => {});

  } catch (e) {
    // Não bloquear o fluxo do pedido se o financeiro falhar
    console.error('createFinancialEntriesForOrder error:', e);

    // Audit: log failed bridge execution
    await prisma.financialBridgeLog.create({
      data: { companyId: order.companyId, sourceType: 'ORDER', sourceId: order.id, status: 'FAILED', errorMessage: e.message },
    }).catch(() => {});
  }
}

/**
 * Cria transação financeira para pagamento de motoboy.
 * Chamado quando um RiderTransaction é criado.
 * paidNow=true: cria como PAID + CashFlowEntry + atualiza saldo da conta (usado no endpoint de pagamento).
 */
export async function createFinancialEntryForRider(riderTransaction, companyId, accountId, { paidNow = false } = {}) {
  try {
    const existing = await prisma.financialTransaction.findFirst({
      where: { companyId, sourceType: 'RIDER', sourceId: riderTransaction.id },
    });
    if (existing) return;

    let resolvedAccountId = accountId || null;
    if (!resolvedAccountId) {
      const defaultAccount = await prisma.financialAccount.findFirst({
        where: { companyId, isDefault: true, isActive: true },
      });
      resolvedAccountId = defaultAccount?.id || null;
    }

    const opexCC = await prisma.costCenter.findFirst({
      where: { companyId, dreGroup: 'OPEX', code: { contains: '4.05' } },
    });

    const amount = Math.abs(Number(riderTransaction.amount));
    const now = new Date();

    if (paidNow && resolvedAccountId) {
      await prisma.$transaction(async (tx) => {
        const ft = await tx.financialTransaction.create({
          data: {
            companyId,
            type: 'PAYABLE',
            status: 'PAID',
            description: `Motoboy - ${riderTransaction.type} (${riderTransaction.note || ''})`,
            accountId: resolvedAccountId,
            costCenterId: opexCC?.id || null,
            grossAmount: amount,
            feeAmount: 0,
            netAmount: amount,
            paidAmount: amount,
            paidAt: now,
            dueDate: new Date(riderTransaction.date),
            issueDate: new Date(riderTransaction.date),
            sourceType: 'RIDER',
            sourceId: riderTransaction.id,
          },
        });

        const account = await tx.financialAccount.update({
          where: { id: resolvedAccountId },
          data: { currentBalance: { decrement: amount } },
        });

        await tx.cashFlowEntry.create({
          data: {
            companyId,
            accountId: resolvedAccountId,
            transactionId: ft.id,
            type: 'OUTFLOW',
            amount,
            balanceAfter: account.currentBalance,
            description: `Pagamento motoboy: ${riderTransaction.note || ''}`,
          },
        });
      });
    } else {
      await prisma.financialTransaction.create({
        data: {
          companyId,
          type: 'PAYABLE',
          status: 'CONFIRMED',
          description: `Motoboy - ${riderTransaction.type} (${riderTransaction.note || ''})`,
          accountId: resolvedAccountId,
          costCenterId: opexCC?.id || null,
          grossAmount: amount,
          feeAmount: 0,
          netAmount: amount,
          dueDate: new Date(riderTransaction.date),
          issueDate: new Date(riderTransaction.date),
          sourceType: 'RIDER',
          sourceId: riderTransaction.id,
        },
      });
    }
  } catch (e) {
    console.error('createFinancialEntryForRider error:', e);
  }
}

/**
 * Cria transação financeira para pagamento de comissão de afiliado.
 * Chamado quando um AffiliatePayment é criado.
 */
export async function createFinancialEntryForAffiliate(affiliatePayment, companyId, accountId) {
  try {
    const existing = await prisma.financialTransaction.findFirst({
      where: { companyId, sourceType: 'AFFILIATE', sourceId: affiliatePayment.id },
    });
    if (existing) return;

    let resolvedAccountId = accountId || null;
    if (!resolvedAccountId) {
      const defaultAccount = await prisma.financialAccount.findFirst({
        where: { companyId, isDefault: true, isActive: true },
      });
      resolvedAccountId = defaultAccount?.id || null;
    }

    const opexCC = await prisma.costCenter.findFirst({
      where: { companyId, dreGroup: 'OPEX', code: { contains: '4.06' } },
    });

    await prisma.financialTransaction.create({
      data: {
        companyId,
        type: 'PAYABLE',
        status: 'PAID',
        description: `Comissão afiliado - ${affiliatePayment.method || 'N/A'}`,
        accountId: resolvedAccountId,
        costCenterId: opexCC?.id || null,
        grossAmount: Number(affiliatePayment.amount),
        feeAmount: 0,
        netAmount: Number(affiliatePayment.amount),
        dueDate: new Date(affiliatePayment.paymentDate),
        paidAt: new Date(affiliatePayment.paymentDate),
        issueDate: new Date(affiliatePayment.paymentDate),
        sourceType: 'AFFILIATE',
        sourceId: affiliatePayment.id,
      },
    });
  } catch (e) {
    console.error('createFinancialEntryForAffiliate error:', e);
  }
}

/**
 * Recreates the marketplace transactions for a single order.
 *
 * Deletes any FinancialTransaction with sourceType in
 * (ORDER, MARKETPLACE_FEE, ANTICIPATION_FEE, ORDER_FEE, COUPON) tied to the
 * order, then runs the bridge again so the entries follow the current model
 * (gross receivable + separate marketplace + anticipation PAYABLEs, with the
 * gateway's settlement schedule).
 *
 * Skips orders whose receivable is already settled (status PAID with a
 * paidAt timestamp) — those represent real cash that already moved.
 *
 * Returns { deleted, recreated:boolean, skipped?:string }.
 */
export async function recreateFinancialEntriesForOrder(orderId) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: true },
  });
  if (!order) return { deleted: 0, recreated: false, skipped: 'order_not_found' };
  if (order.status !== 'CONCLUIDO') return { deleted: 0, recreated: false, skipped: 'not_concluido' };

  const linkedTypes = ['ORDER', 'MARKETPLACE_FEE', 'ANTICIPATION_FEE', 'ORDER_FEE', 'COUPON'];
  const settled = await prisma.financialTransaction.findFirst({
    where: {
      companyId: order.companyId,
      sourceType: 'ORDER',
      sourceId: order.id,
      status: 'PAID',
      paidAt: { not: null },
    },
  });
  if (settled) return { deleted: 0, recreated: false, skipped: 'already_settled' };

  // Look up all transactions about to be deleted so we can null out the FK
  // on CashFlowEntry first (the relation has no onDelete cascade and Postgres
  // refuses the delete otherwise).
  const txs = await prisma.financialTransaction.findMany({
    where: {
      companyId: order.companyId,
      sourceId: order.id,
      sourceType: { in: linkedTypes },
    },
    select: { id: true },
  });
  const txIds = txs.map((t) => t.id);

  let del = { count: 0 };
  await prisma.$transaction(async (tx) => {
    if (txIds.length > 0) {
      await tx.cashFlowEntry.updateMany({
        where: { transactionId: { in: txIds } },
        data: { transactionId: null },
      });
    }
    del = await tx.financialTransaction.deleteMany({
      where: {
        companyId: order.companyId,
        sourceId: order.id,
        sourceType: { in: linkedTypes },
      },
    });
  });

  await createFinancialEntriesForOrder(order);
  return { deleted: del.count, recreated: true };
}

/**
 * Bulk version: recreates entries for every CONCLUIDO order of a gateway
 * provider in a date range. Used by the "Recriar lançamentos iFood" button
 * after the merchant changes the gateway configuration.
 */
export async function recreateFinancialEntriesForProvider({ companyId, provider, from, to }) {
  const where = { companyId, status: 'CONCLUIDO' };
  if (provider === 'IFOOD') {
    // Robust detection: orders may have customerSource null when created via
    // the modern ifoodWebhookProcessor. Match on any iFood signal.
    where.OR = [
      { customerSource: 'IFOOD' },
      { externalId: { not: null } },
    ];
  }
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = new Date(from);
    if (to) where.createdAt.lte = new Date(to);
  }
  // Backfill customerSource on legacy iFood orders that lack it (so future
  // queries can use the simple customerSource filter).
  if (provider === 'IFOOD') {
    await prisma.order.updateMany({
      where: { companyId, externalId: { not: null }, customerSource: null },
      data: { customerSource: 'IFOOD' },
    }).catch(() => {});
  }

  const orders = await prisma.order.findMany({ where, select: { id: true } });
  console.log(`[recreateFinancialEntries] starting batch for provider=${provider}, ${orders.length} order(s)`);
  let recreated = 0, skipped = 0, deleted = 0, failed = 0;
  const errors = [];
  const startTime = Date.now();
  for (let i = 0; i < orders.length; i++) {
    const o = orders[i];
    try {
      const r = await recreateFinancialEntriesForOrder(o.id);
      if (r.recreated) { recreated++; deleted += r.deleted; }
      else skipped++;
    } catch (e) {
      failed++;
      const msg = e?.message || String(e);
      console.error(`[recreateFinancialEntries] order ${o.id} failed:`, msg);
      if (errors.length < 5) errors.push({ orderId: o.id, error: msg });
    }
    if ((i + 1) % 50 === 0) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`[recreateFinancialEntries] progress ${i + 1}/${orders.length} (${elapsed}s) — ok:${recreated} skip:${skipped} fail:${failed}`);
    }
  }
  const total = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[recreateFinancialEntries] done in ${total}s — recreated:${recreated} skipped:${skipped} failed:${failed}`);
  return { totalOrders: orders.length, recreated, skipped, failed, deletedTransactions: deleted, errors };
}
