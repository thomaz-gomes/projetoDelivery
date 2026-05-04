import { prisma } from '../../prisma.js';
import { calculateInstallmentDates } from './installmentCalculator.js';

/**
 * Creates PAYABLE financial transactions for a purchase import.
 *
 * @param {string} purchaseImportId
 * @param {Object} paymentParams
 * @param {string} paymentParams.payablePaymentMethodId
 * @param {number} paymentParams.installmentCount
 * @param {string} paymentParams.firstDueDate
 * @param {Array}  [paymentParams.installments] - User-edited installments override
 * @returns {Object} { supplierId, transactionIds }
 */
export async function createFinancialEntriesForPurchase(purchaseImportId, paymentParams = {}) {
  const importRecord = await prisma.purchaseImport.findUnique({
    where: { id: purchaseImportId },
    include: { store: true },
  });
  if (!importRecord) throw new Error('Importação não encontrada');

  const companyId = importRecord.companyId;
  const totalValue = Number(importRecord.totalValue || 0);
  if (totalValue <= 0) return { supplierId: null, transactionIds: [] };

  // 1. Upsert Supplier
  let supplierId = importRecord.supplierId || null;
  if (!supplierId && importRecord.supplierCnpj) {
    const cleanCnpj = importRecord.supplierCnpj.replace(/\D/g, '');
    if (cleanCnpj.length === 14) {
      let supplier = await prisma.supplier.findUnique({
        where: { companyId_cnpj: { companyId, cnpj: cleanCnpj } },
      });
      if (!supplier) {
        supplier = await prisma.supplier.create({
          data: {
            companyId,
            cnpj: cleanCnpj,
            name: importRecord.supplierName || `Fornecedor ${cleanCnpj}`,
          },
        });
      }
      supplierId = supplier.id;
      await prisma.purchaseImport.update({
        where: { id: purchaseImportId },
        data: { supplierId },
      });
    }
  }

  // 2. Load payment method
  const { payablePaymentMethodId, installmentCount = 1, firstDueDate } = paymentParams;
  let method = null;
  if (payablePaymentMethodId) {
    method = await prisma.payablePaymentMethod.findUnique({
      where: { id: payablePaymentMethodId },
    });
  }

  // 3. Calculate installment dates
  let installments;
  if (paymentParams.installments && Array.isArray(paymentParams.installments) && paymentParams.installments.length > 0) {
    installments = paymentParams.installments.map((inst, i) => ({
      number: i + 1,
      dueDate: new Date(inst.dueDate),
      amount: Number(inst.amount),
    }));
  } else {
    const baseDate = firstDueDate ? new Date(firstDueDate) : (importRecord.issueDate || new Date());
    const methodType = method?.type || 'BOLETO';
    const result = calculateInstallmentDates(methodType, baseDate, installmentCount, {
      closingDay: method?.closingDay || 1,
      dueDay: method?.dueDay || 10,
      template: '30d',
    });
    const perInstallment = Math.floor((totalValue / installmentCount) * 100) / 100;
    const remainder = Math.round((totalValue - perInstallment * installmentCount) * 100) / 100;
    installments = result.installments.map((inst, i) => ({
      ...inst,
      amount: i === 0 ? perInstallment + remainder : perInstallment,
    }));
  }

  // 4. Find COGS cost center
  let costCenterId = null;
  try {
    const cogs = await prisma.costCenter.findFirst({
      where: { companyId, dreGroup: 'COGS', isActive: true },
    });
    if (cogs) costCenterId = cogs.id;
  } catch (e) { /* ignore */ }

  // 5. Find default financial account
  let accountId = null;
  if (method?.accountId) {
    accountId = method.accountId;
  } else {
    try {
      const defaultAcc = await prisma.financialAccount.findFirst({
        where: { companyId, isDefault: true, isActive: true },
      });
      if (defaultAcc) accountId = defaultAcc.id;
    } catch (e) { /* ignore */ }
  }

  // 6. Create transactions
  const nfeLabel = importRecord.nfeNumber ? `NFe #${importRecord.nfeNumber}` : 'Compra';
  const supplierLabel = importRecord.supplierName || 'Fornecedor';
  const totalInstallments = installments.length;
  const transactionIds = [];

  await prisma.$transaction(async (tx) => {
    for (const inst of installments) {
      const suffix = totalInstallments > 1 ? ` (${inst.number}/${totalInstallments})` : '';
      const txn = await tx.financialTransaction.create({
        data: {
          company: { connect: { id: companyId } },
          type: 'PAYABLE',
          status: 'PENDING',
          description: `${nfeLabel} - ${supplierLabel}${suffix}`,
          sourceType: 'STOCK_PURCHASE',
          sourceId: purchaseImportId,
          supplierId: supplierId || null,
          accountId,
          costCenterId,
          payablePaymentMethodId: payablePaymentMethodId || null,
          grossAmount: inst.amount,
          feeAmount: 0,
          netAmount: inst.amount,
          issueDate: importRecord.issueDate || new Date(),
          dueDate: inst.dueDate,
          storeId: importRecord.storeId || null,
          installmentNumber: inst.number,
          totalInstallments,
        },
      });
      transactionIds.push(txn.id);
    }
  });

  return { supplierId, transactionIds };
}
