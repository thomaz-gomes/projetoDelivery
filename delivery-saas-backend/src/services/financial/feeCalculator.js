import { prisma } from '../../prisma.js';

/**
 * Calcula taxas com base na configuração do gateway/operadora.
 *
 * Regras de cálculo:
 * - PERCENTAGE: feeAmount = grossAmount * feePercent
 * - FIXED: feeAmount = feeFixed
 * - MIXED: feeAmount = (grossAmount * feePercent) + feeFixed
 *
 * O expectedDate é calculado como transactionDate + settlementDays (D+N).
 *
 * @param {string} gatewayConfigId - ID da configuração do gateway
 * @param {number} grossAmount - Valor bruto da transação
 * @param {Date} transactionDate - Data da transação (para calcular D+N)
 * @returns {Object} { feeAmount, netAmount, expectedDate, breakdown }
 */
export async function calculateFees(gatewayConfigId, grossAmount, transactionDate) {
  const config = await prisma.paymentGatewayConfig.findUnique({
    where: { id: gatewayConfigId },
  });

  if (!config) {
    return {
      feeAmount: 0,
      netAmount: grossAmount,
      expectedDate: transactionDate,
      breakdown: { message: 'Gateway config not found' },
    };
  }

  let feeAmount = 0;
  const breakdown = {
    provider: config.provider,
    label: config.label,
    feeType: config.feeType,
    grossAmount,
  };

  const percent = Number(config.feePercent || 0);
  const fixed = Number(config.feeFixed || 0);

  switch (config.feeType) {
    case 'PERCENTAGE':
      feeAmount = grossAmount * percent;
      breakdown.percentageFee = percent;
      breakdown.percentageAmount = feeAmount;
      break;
    case 'FIXED':
      feeAmount = fixed;
      breakdown.fixedFee = fixed;
      break;
    case 'MIXED':
      const percentPart = grossAmount * percent;
      feeAmount = percentPart + fixed;
      breakdown.percentageFee = percent;
      breakdown.percentageAmount = percentPart;
      breakdown.fixedFee = fixed;
      break;
    default:
      feeAmount = grossAmount * percent;
  }

  // Arredondar para 2 casas decimais
  feeAmount = Math.round(feeAmount * 100) / 100;
  const netAmount = Math.round((grossAmount - feeAmount) * 100) / 100;

  // Calcular data de recebimento (D+N, pulando finais de semana)
  const settlementDays = Number(config.settlementDays || 0);
  const expectedDate = addBusinessDays(new Date(transactionDate), settlementDays);

  breakdown.feeAmount = feeAmount;
  breakdown.netAmount = netAmount;
  breakdown.settlementDays = settlementDays;
  breakdown.expectedDate = expectedDate;

  return { feeAmount, netAmount, expectedDate, breakdown };
}

/**
 * Adiciona dias úteis a uma data (pula sábado e domingo).
 */
function addBusinessDays(date, days) {
  const result = new Date(date);
  let added = 0;
  while (added < days) {
    result.setDate(result.getDate() + 1);
    const dow = result.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return result;
}
