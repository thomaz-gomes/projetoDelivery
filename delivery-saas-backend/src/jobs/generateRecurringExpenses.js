import { prisma } from '../prisma.js';

function calcNextDueDate(current, recurrence, dayOfMonth) {
  const d = new Date(current);
  switch (recurrence) {
    case 'WEEKLY':    d.setDate(d.getDate() + 7);        break;
    case 'BIWEEKLY':  d.setDate(d.getDate() + 14);       break;
    case 'MONTHLY':   d.setMonth(d.getMonth() + 1);      break;
    case 'QUARTERLY': d.setMonth(d.getMonth() + 3);      break;
    case 'ANNUAL':    d.setFullYear(d.getFullYear() + 1); break;
    default:          d.setMonth(d.getMonth() + 1);      break;
  }
  if (dayOfMonth && ['MONTHLY', 'QUARTERLY', 'ANNUAL'].includes(recurrence)) {
    const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(dayOfMonth, lastDay));
  }
  return d;
}

export async function generateForTemplate(template, companyId) {
  const dueDate = new Date(template.nextDueDate);
  const dueDateStart = new Date(dueDate.toISOString().slice(0, 10));
  const dueDateEnd = new Date(dueDate.toISOString().slice(0, 10) + 'T23:59:59Z');

  const existing = await prisma.financialTransaction.findFirst({
    where: {
      companyId,
      sourceType: 'RECURRING',
      sourceId: template.id,
      dueDate: { gte: dueDateStart, lte: dueDateEnd },
    },
  });
  if (existing) return existing;

  const tx = await prisma.financialTransaction.create({
    data: {
      companyId,
      type: 'PAYABLE',
      status: 'CONFIRMED',
      description: template.description,
      accountId: template.accountId || null,
      costCenterId: template.costCenterId || null,
      grossAmount: Number(template.grossAmount),
      feeAmount: 0,
      netAmount: Number(template.grossAmount),
      dueDate,
      issueDate: new Date(),
      sourceType: 'RECURRING',
      sourceId: template.id,
      notes: template.notes || null,
    },
  });

  const next = calcNextDueDate(dueDate, template.recurrence, template.dayOfMonth);
  await prisma.recurringExpense.update({
    where: { id: template.id },
    data: { lastGeneratedAt: new Date(), nextDueDate: next },
  });

  return tx;
}

export async function generateRecurringExpenses() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + 3);

  const templates = await prisma.recurringExpense.findMany({
    where: { isActive: true, nextDueDate: { lte: cutoff } },
  });

  let generated = 0;
  for (const template of templates) {
    try {
      const tx = await generateForTemplate(template, template.companyId);
      if (tx) generated++;
    } catch (e) {
      console.error(`[RecurringExpenses] Erro no template ${template.id}:`, e.message);
    }
  }

  if (generated > 0) console.log(`[RecurringExpenses] ${generated} lançamento(s) gerado(s)`);
  return generated;
}
