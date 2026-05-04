import { prisma } from '../../prisma.js';

/**
 * Reverses all financial transactions for an order that was CONCLUIDO and is now being CANCELADO.
 * - Marks original transaction as REVERSED
 * - Creates reversal PAYABLE transaction (for revenue)
 * - Adjusts cash session balance if payment was immediate
 * - Creates CashFlowEntry OUTFLOW for the reversal
 * - Reverses dependent transactions (rider, affiliate, coupon)
 * - Reverses cashback credits
 */
export async function reverseFinancialEntriesForOrder(order) {
  try {
    const companyId = order.companyId;

    // 1. Find original revenue transaction
    const originalTx = await prisma.financialTransaction.findFirst({
      where: { companyId, sourceType: 'ORDER', sourceId: order.id },
    });

    if (!originalTx || originalTx.status === 'REVERSED') {
      console.log(`[reversalBridge] No transaction to reverse for order ${order.id}`);
      return { reversed: false, reason: 'no_transaction' };
    }

    // 2. Find or create cancellation cost center (2.05 - Cancelamentos)
    let cancelCC = await prisma.costCenter.findFirst({
      where: { companyId, code: { startsWith: '2.0' }, name: { contains: 'Cancel' }, isActive: true },
    });
    if (!cancelCC) {
      cancelCC = await prisma.costCenter.create({
        data: { companyId, code: '2.05', name: 'Cancelamentos / Estornos', dreGroup: 'DEDUCTIONS', isActive: true },
      });
    }

    const now = new Date();
    const results = [];

    // 3. Mark original as REVERSED and create reversal transaction
    await prisma.$transaction(async (tx) => {
      await tx.financialTransaction.update({
        where: { id: originalTx.id },
        data: { status: 'REVERSED' },
      });

      const reversal = await tx.financialTransaction.create({
        data: {
          company: { connect: { id: companyId } },
          type: 'PAYABLE',
          status: 'PAID',
          description: `Estorno - Venda #${order.displayId || order.id} (cancelamento)`,
          accountId: originalTx.accountId,
          costCenterId: cancelCC.id,
          grossAmount: originalTx.grossAmount,
          feeAmount: 0,
          netAmount: originalTx.grossAmount,
          paidAmount: originalTx.grossAmount,
          issueDate: now,
          dueDate: now,
          paidAt: now,
          sourceType: 'ORDER_REVERSAL',
          sourceId: order.id,
          reversedTransactionId: originalTx.id,
          storeId: order.storeId || null,
          createdBy: 'system',
        },
      });
      results.push(reversal);

      // 4. Adjust cash session balance if order was linked and payment was immediate
      if (order.cashSessionId) {
        const payments = order.payload?.paymentConfirmed || [];
        const isImmediate = payments.length
          ? payments.every(p => /din|pix|cash|money/i.test(p.method))
          : /din|pix|cash|money/i.test(order.payload?.payment?.method || '');

        if (isImmediate) {
          await tx.cashSession.update({
            where: { id: order.cashSessionId },
            data: { currentBalance: { decrement: Number(order.total) } },
          });

          // Create CashFlowEntry for the reversal
          if (originalTx.accountId) {
            const account = await tx.financialAccount.update({
              where: { id: originalTx.accountId },
              data: { currentBalance: { decrement: Number(order.total) } },
            });

            await tx.cashFlowEntry.create({
              data: {
                companyId,
                accountId: originalTx.accountId,
                transactionId: reversal.id,
                type: 'OUTFLOW',
                amount: Number(order.total),
                balanceAfter: account.currentBalance,
                entryDate: now,
                description: `Estorno pedido #${order.displayId || order.id}`,
                storeId: order.storeId || null,
              },
            });
          }
        }
      }
    });

    // 5. Reverse dependent transactions (rider, affiliate, coupon)
    const dependentTxs = await prisma.financialTransaction.findMany({
      where: {
        companyId,
        sourceId: order.id,
        sourceType: { in: ['RIDER', 'AFFILIATE', 'COUPON'] },
        status: { not: 'REVERSED' },
      },
    });

    for (const depTx of dependentTxs) {
      await prisma.$transaction(async (tx) => {
        await tx.financialTransaction.update({
          where: { id: depTx.id },
          data: { status: 'REVERSED' },
        });

        await tx.financialTransaction.create({
          data: {
            company: { connect: { id: companyId } },
            type: depTx.type === 'PAYABLE' ? 'RECEIVABLE' : 'PAYABLE',
            status: 'PAID',
            description: `Estorno - ${depTx.description} (cancelamento pedido)`,
            accountId: depTx.accountId,
            costCenterId: depTx.costCenterId,
            grossAmount: depTx.grossAmount,
            feeAmount: 0,
            netAmount: depTx.grossAmount,
            paidAmount: depTx.grossAmount,
            issueDate: now,
            dueDate: now,
            paidAt: now,
            sourceType: 'ORDER_REVERSAL',
            sourceId: order.id,
            reversedTransactionId: depTx.id,
            storeId: order.storeId || null,
            createdBy: 'system',
          },
        });
      });
    }

    // 6. Reverse cashback credits
    try {
      const cashbackTxs = await prisma.cashbackTransaction.findMany({
        where: { orderId: order.id, type: 'CREDIT' },
      });
      for (const cbTx of cashbackTxs) {
        await prisma.cashbackTransaction.create({
          data: {
            walletId: cbTx.walletId,
            orderId: order.id,
            type: 'DEBIT',
            amount: cbTx.amount,
            description: `Estorno cashback - pedido #${order.displayId || order.id} cancelado`,
          },
        });
        await prisma.cashbackWallet.update({
          where: { id: cbTx.walletId },
          data: { balance: { decrement: Number(cbTx.amount) } },
        });
      }
    } catch (e) {
      console.error('[reversalBridge] cashback reversal error:', e.message);
    }

    console.log(`[reversalBridge] Reversed ${results.length + dependentTxs.length} transactions for order ${order.id}`);
    return { reversed: true, count: results.length + dependentTxs.length };
  } catch (e) {
    console.error('[reversalBridge] Error:', e);
    return { reversed: false, error: e.message };
  }
}
