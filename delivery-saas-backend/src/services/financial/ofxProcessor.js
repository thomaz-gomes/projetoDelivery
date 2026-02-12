import { prisma } from '../../prisma.js';

/**
 * Parser simplificado de conteúdo OFX (SGML-like).
 *
 * O formato OFX usa tags SGML sem fechamento consistente.
 * Este parser extrai transações de blocos <STMTTRN>.
 *
 * @param {string} content - Conteúdo bruto do arquivo OFX
 * @returns {Object} { transactions: Array, periodStart: Date, periodEnd: Date }
 */
export function parseOfxContent(content) {
  if (!content) return null;

  const transactions = [];

  // Extrair período do extrato
  const periodStart = extractTag(content, 'DTSTART');
  const periodEnd = extractTag(content, 'DTEND');

  // Extrair blocos de transação <STMTTRN>...</STMTTRN>
  const txRegex = /<STMTTRN>([\s\S]*?)(?:<\/STMTTRN>|(?=<STMTTRN>|<\/BANKTRANLIST))/gi;
  let match;
  while ((match = txRegex.exec(content)) !== null) {
    const block = match[1];
    const tx = {
      type: extractTag(block, 'TRNTYPE'),       // DEBIT, CREDIT, etc.
      date: parseOfxDate(extractTag(block, 'DTPOSTED')),
      amount: parseFloat(extractTag(block, 'TRNAMT') || '0'),
      fitId: extractTag(block, 'FITID'),
      checkNum: extractTag(block, 'CHECKNUM'),
      refNum: extractTag(block, 'REFNUM'),
      memo: extractTag(block, 'MEMO'),
    };
    if (tx.date) transactions.push(tx);
  }

  return {
    transactions,
    periodStart: parseOfxDate(periodStart),
    periodEnd: parseOfxDate(periodEnd),
  };
}

/**
 * Tenta fazer match automático dos itens OFX com transações financeiras existentes.
 *
 * Algoritmo de matching:
 * 1. Para cada item OFX, buscar transações financeiras no período (±3 dias)
 *    com valor próximo (tolerância de R$0.05).
 * 2. Calcular score de confiança baseado em:
 *    - Proximidade de valor (peso 0.5)
 *    - Proximidade de data (peso 0.3)
 *    - Match de descrição/memo (peso 0.2)
 * 3. Se score >= 0.7, marcar como MATCHED automaticamente.
 *
 * @param {string} companyId
 * @param {string} importId
 * @param {Array} items - itens OFX criados no banco
 * @returns {Object} { matched: number, unmatched: number }
 */
export async function matchOfxItems(companyId, importId, items) {
  let matched = 0;
  let unmatched = 0;

  for (const item of items) {
    try {
      const ofxDate = new Date(item.ofxDate);
      const daysBefore = new Date(ofxDate);
      daysBefore.setDate(daysBefore.getDate() - 3);
      const daysAfter = new Date(ofxDate);
      daysAfter.setDate(daysAfter.getDate() + 3);

      const ofxAmount = Math.abs(Number(item.amount));
      const isCredit = Number(item.amount) > 0;

      // Buscar transações candidatas
      const candidates = await prisma.financialTransaction.findMany({
        where: {
          companyId,
          type: isCredit ? 'RECEIVABLE' : 'PAYABLE',
          status: { in: ['PENDING', 'CONFIRMED', 'PAID'] },
          dueDate: { gte: daysBefore, lte: daysAfter },
        },
      });

      let bestMatch = null;
      let bestScore = 0;

      for (const candidate of candidates) {
        const candidateAmount = Math.abs(Number(candidate.netAmount));
        // Score de valor: 1.0 se exato, decresce com diferença
        const valueDiff = Math.abs(ofxAmount - candidateAmount);
        const valueScore = valueDiff <= 0.05 ? 1.0 : valueDiff <= 1.0 ? 0.8 : valueDiff <= 5.0 ? 0.5 : 0;

        // Score de data: 1.0 no mesmo dia, decresce
        const dateDiff = Math.abs(ofxDate.getTime() - new Date(candidate.dueDate).getTime()) / (1000 * 60 * 60 * 24);
        const dateScore = dateDiff <= 0 ? 1.0 : dateDiff <= 1 ? 0.9 : dateDiff <= 3 ? 0.6 : 0.3;

        // Score de descrição (se memo contém parte da descrição)
        let descScore = 0;
        if (item.memo && candidate.description) {
          const memoLower = (item.memo || '').toLowerCase();
          const descLower = (candidate.description || '').toLowerCase();
          if (memoLower.includes(descLower) || descLower.includes(memoLower)) descScore = 1.0;
          else {
            // Comparar palavras
            const memoWords = memoLower.split(/\s+/).filter(w => w.length > 3);
            const descWords = descLower.split(/\s+/).filter(w => w.length > 3);
            const commonWords = memoWords.filter(w => descWords.some(d => d.includes(w) || w.includes(d)));
            descScore = memoWords.length > 0 ? commonWords.length / memoWords.length : 0;
          }
        }

        const score = (valueScore * 0.5) + (dateScore * 0.3) + (descScore * 0.2);
        if (score > bestScore) {
          bestScore = score;
          bestMatch = candidate;
        }
      }

      if (bestMatch && bestScore >= 0.7) {
        await prisma.ofxReconciliationItem.update({
          where: { id: item.id },
          data: {
            matchStatus: 'MATCHED',
            transactionId: bestMatch.id,
            matchConfidence: bestScore,
            matchNotes: `Auto-match (score: ${bestScore.toFixed(2)})`,
          },
        });
        matched++;
      } else {
        await prisma.ofxReconciliationItem.update({
          where: { id: item.id },
          data: { matchStatus: bestMatch ? 'PENDING' : 'UNMATCHED' },
        });
        unmatched++;
      }
    } catch (e) {
      console.error('matchOfxItems error for item', item.id, e);
      unmatched++;
    }
  }

  return { matched, unmatched };
}

/**
 * Extrai valor de uma tag SGML no formato OFX.
 * Ex: <TRNAMT>-150.00  -> "-150.00"
 */
function extractTag(content, tagName) {
  const regex = new RegExp(`<${tagName}>([^<\\n\\r]+)`, 'i');
  const match = content.match(regex);
  return match ? match[1].trim() : null;
}

/**
 * Converte data OFX (YYYYMMDDHHMMSS ou YYYYMMDD) para Date.
 */
function parseOfxDate(str) {
  if (!str) return null;
  // Remove timezone info [timezone:offset] se presente
  const clean = str.replace(/\[.*\]/, '').trim();
  if (clean.length >= 8) {
    const y = parseInt(clean.substring(0, 4), 10);
    const m = parseInt(clean.substring(4, 6), 10) - 1;
    const d = parseInt(clean.substring(6, 8), 10);
    const h = clean.length >= 10 ? parseInt(clean.substring(8, 10), 10) : 0;
    const min = clean.length >= 12 ? parseInt(clean.substring(10, 12), 10) : 0;
    const sec = clean.length >= 14 ? parseInt(clean.substring(12, 14), 10) : 0;
    return new Date(y, m, d, h, min, sec);
  }
  return null;
}
