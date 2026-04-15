import { prisma } from '../../prisma.js';
import { calculateFees } from './feeCalculator.js';

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

    // Determinar se veio de marketplace (iFood, etc.)
    const source = order.customerSource;
    let gatewayConfig = null;
    if (source === 'IFOOD') {
      gatewayConfig = await prisma.paymentGatewayConfig.findFirst({
        where: { companyId: order.companyId, provider: 'IFOOD', isActive: true },
      });
    }

    // 1. Criar receita principal
    let feeAmount = 0;
    let netAmount = orderTotal;
    let expectedDate = now;

    if (gatewayConfig) {
      const fees = await calculateFees(gatewayConfig.id, orderTotal, now);
      feeAmount = fees.feeAmount;
      netAmount = fees.netAmount;
      expectedDate = fees.expectedDate;
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
        dueDate: expectedDate,
        expectedDate,
        paidAt: allImmediate ? now : null,
        issueDate: now,
        sourceType: 'ORDER',
        sourceId: order.id,
      },
    });

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
 */
export async function createFinancialEntryForRider(riderTransaction, companyId, accountId) {
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

    await prisma.financialTransaction.create({
      data: {
        companyId,
        type: 'PAYABLE',
        status: 'CONFIRMED',
        description: `Motoboy - ${riderTransaction.type} (${riderTransaction.note || ''})`,
        accountId: resolvedAccountId,
        costCenterId: opexCC?.id || null,
        grossAmount: Math.abs(Number(riderTransaction.amount)),
        feeAmount: 0,
        netAmount: Math.abs(Number(riderTransaction.amount)),
        dueDate: new Date(riderTransaction.date),
        issueDate: new Date(riderTransaction.date),
        sourceType: 'RIDER',
        sourceId: riderTransaction.id,
      },
    });
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
