import { prisma } from '../../prisma.js';
import OpenAI from 'openai';

const BATCH_SIZE = 10;
const HIGH_CONFIDENCE = 85;
const LOW_CONFIDENCE = 50;

export async function reconcileOfxItems(importId, companyId) {
  const items = await prisma.ofxReconciliationItem.findMany({
    where: { importId, matchStatus: 'PENDING' },
  });

  const results = { exact: 0, aiAuto: 0, aiSuggested: 0, unmatched: 0 };

  // Get candidate transactions (not yet reconciled, within date range)
  const dates = items.map(i => i.ofxDate);
  if (!dates.length) return results;

  const minDate = new Date(Math.min(...dates.map(d => d.getTime())));
  const maxDate = new Date(Math.max(...dates.map(d => d.getTime())));
  minDate.setDate(minDate.getDate() - 5);
  maxDate.setDate(maxDate.getDate() + 5);

  const candidates = await prisma.financialTransaction.findMany({
    where: {
      companyId,
      status: { in: ['PAID', 'CONFIRMED', 'PARTIALLY'] },
      issueDate: { gte: minDate, lte: maxDate },
    },
    select: {
      id: true, description: true, grossAmount: true, netAmount: true,
      issueDate: true, sourceType: true, type: true,
    },
  });

  const matchedTxIds = new Set();
  const ambiguous = [];

  // Stage 1: Exact match (no AI)
  for (const item of items) {
    const absAmount = Math.abs(Number(item.amount));
    const exactMatches = candidates.filter(c => {
      if (matchedTxIds.has(c.id)) return false;
      const txAmount = Number(c.netAmount || c.grossAmount);
      if (Math.abs(txAmount - absAmount) > 0.01) return false;
      const daysDiff = Math.abs(item.ofxDate.getTime() - c.issueDate.getTime()) / (1000 * 60 * 60 * 24);
      return daysDiff <= 3;
    });

    if (exactMatches.length === 1) {
      await prisma.ofxReconciliationItem.update({
        where: { id: item.id },
        data: {
          matchStatus: 'MATCHED',
          transactionId: exactMatches[0].id,
          matchConfidence: 100,
          matchMethod: 'EXACT',
          matchNotes: 'Match exato por valor e data',
        },
      });
      matchedTxIds.add(exactMatches[0].id);
      results.exact++;
    } else {
      ambiguous.push({ item, possibleMatches: exactMatches });
    }
  }

  // Stage 2: AI match (for ambiguous items)
  if (ambiguous.length > 0) {
    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) {
      for (const { item } of ambiguous) {
        await prisma.ofxReconciliationItem.update({
          where: { id: item.id },
          data: { matchStatus: 'UNMATCHED', matchMethod: 'MANUAL' },
        });
        results.unmatched++;
      }
      return results;
    }

    const openai = new OpenAI({ apiKey: openaiKey });
    const remainingCandidates = candidates.filter(c => !matchedTxIds.has(c.id));

    for (let i = 0; i < ambiguous.length; i += BATCH_SIZE) {
      const batch = ambiguous.slice(i, i + BATCH_SIZE);

      const prompt = `Você é um assistente de conciliação bancária para restaurantes.

Abaixo estão lançamentos de extrato bancário que precisam ser vinculados a transações financeiras do sistema.

LANÇAMENTOS DO EXTRATO:
${batch.map((b, idx) => `${idx + 1}. Data: ${b.item.ofxDate.toISOString().split('T')[0]}, Valor: R$${Math.abs(Number(b.item.amount)).toFixed(2)}, Tipo: ${b.item.ofxType}, Descrição: "${b.item.memo || 'sem descrição'}"`).join('\n')}

TRANSAÇÕES CANDIDATAS DO SISTEMA:
${remainingCandidates.slice(0, 50).map(c => `- ID: ${c.id}, Data: ${c.issueDate.toISOString().split('T')[0]}, Valor: R$${Number(c.netAmount).toFixed(2)}, Tipo: ${c.type}, Fonte: ${c.sourceType || 'MANUAL'}, Desc: "${c.description}"`).join('\n')}

Para cada lançamento, responda em JSON:
{"matches": [{"index": 1, "matchId": "id_da_transacao" ou null, "confidence": 0-100, "reasoning": "explicação curta"}]}

Se nenhuma transação corresponde, use matchId: null e confidence: 0.`;

      try {
        const response = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          response_format: { type: 'json_object' },
          temperature: 0.1,
        });

        const content = JSON.parse(response.choices[0].message.content);
        const matches = content.matches || content.results || content;

        for (const match of (Array.isArray(matches) ? matches : [])) {
          const batchItem = batch[(match.index || 1) - 1];
          if (!batchItem) continue;

          const confidence = Number(match.confidence || 0);

          if (match.matchId && confidence >= HIGH_CONFIDENCE) {
            await prisma.ofxReconciliationItem.update({
              where: { id: batchItem.item.id },
              data: {
                matchStatus: 'MATCHED',
                transactionId: match.matchId,
                matchConfidence: confidence,
                matchMethod: 'AI_AUTO',
                aiReasoning: match.reasoning,
                matchNotes: `IA auto-match (${confidence}%)`,
              },
            });
            matchedTxIds.add(match.matchId);
            results.aiAuto++;
          } else if (match.matchId && confidence >= LOW_CONFIDENCE) {
            await prisma.ofxReconciliationItem.update({
              where: { id: batchItem.item.id },
              data: {
                matchStatus: 'PENDING',
                transactionId: match.matchId,
                matchConfidence: confidence,
                matchMethod: 'AI_SUGGESTED',
                aiReasoning: match.reasoning,
                matchNotes: `Sugestão IA (${confidence}%) — aguarda revisão`,
              },
            });
            results.aiSuggested++;
          } else {
            await prisma.ofxReconciliationItem.update({
              where: { id: batchItem.item.id },
              data: {
                matchStatus: 'UNMATCHED',
                matchConfidence: confidence,
                matchMethod: 'MANUAL',
                aiReasoning: match.reasoning || null,
              },
            });
            results.unmatched++;
          }
        }
      } catch (e) {
        console.error('[ofxAiMatcher] AI batch error:', e.message);
        for (const { item } of batch) {
          await prisma.ofxReconciliationItem.update({
            where: { id: item.id },
            data: { matchStatus: 'UNMATCHED', matchMethod: 'MANUAL', matchNotes: 'Erro na IA: ' + e.message },
          });
          results.unmatched++;
        }
      }
    }
  }

  console.log(`[ofxAiMatcher] Reconciliation results for import ${importId}:`, results);
  return results;
}
