/**
 * cron.js — Tarefas agendadas do servidor
 *
 * Importado em src/index.js para iniciar os jobs junto com o servidor.
 */

import cron from 'node-cron'
import { resetAllDueCredits } from './services/aiCreditManager.js'
import { prisma } from './prisma.js'
import { runRecurringBilling } from './jobs/recurringBilling.js'
import { aggregateMenuEvents } from './jobs/aggregateMenuEvents.js'
import { generateRecurringExpenses } from './jobs/generateRecurringExpenses.js'

/**
 * Reset mensal de créditos de IA: toda empresa tem seus créditos restaurados
 * ao limite definido no plano SaaS, no dia 1 de cada mês às 00:01.
 */
cron.schedule('1 0 1 * *', async () => {
  console.log('[Cron] Iniciando reset mensal de créditos de IA...')
  try {
    const result = await resetAllDueCredits()
    console.log(`[Cron] Reset mensal concluído: ${result.resetCount} empresa(s)`)
  } catch (err) {
    console.error('[Cron] Erro no reset mensal de créditos de IA:', err)
  }
}, {
  timezone: 'America/Sao_Paulo',
})

/**
 * Domínios customizados vencidos: verifica diariamente às 01:00 se algum
 * domínio ACTIVE possui paidUntil no passado e o suspende automaticamente.
 */
cron.schedule('0 1 * * *', async () => {
  console.log('[Cron] Verificando domínios customizados vencidos...')
  try {
    const result = await prisma.customDomain.updateMany({
      where: {
        status: 'ACTIVE',
        paidUntil: { lt: new Date() }
      },
      data: { status: 'SUSPENDED' }
    })
    if (result.count > 0) {
      console.log(`[Cron] ${result.count} domínio(s) suspenso(s) por vencimento`)
    }
  } catch (err) {
    console.error('[Cron] Erro ao verificar domínios vencidos:', err)
  }
}, {
  timezone: 'America/Sao_Paulo',
})

/**
 * Recurring billing: gera faturas para assinaturas vencidas e suspende
 * módulos com faturas inadimplentes. Executa diariamente às 06:00 UTC.
 */
cron.schedule('0 6 * * *', async () => {
  console.log('[Cron] Iniciando cobrança recorrente...')
  try {
    await runRecurringBilling()
    console.log('[Cron] Cobrança recorrente concluída')
  } catch (err) {
    console.error('[Cron] Erro na cobrança recorrente:', err)
  }
})

/**
 * Agregação diária de eventos de menu: agrega os eventos do dia anterior
 * em resumos diários e remove eventos brutos com mais de 90 dias.
 */
cron.schedule('30 2 * * *', async () => {
  console.log('[Cron] Iniciando agregação de eventos de menu...')
  try {
    await aggregateMenuEvents()
    console.log('[Cron] Agregação de eventos de menu concluída')
  } catch (err) {
    console.error('[Cron] Erro na agregação de eventos de menu:', err)
  }
}, {
  timezone: 'America/Sao_Paulo',
})

/**
 * Auto-checkout de entregadores: a cada 30 minutos verifica check-ins ainda
 * abertos e encerra automaticamente os que passaram 2h do fim do turno.
 */
cron.schedule('*/30 * * * *', async () => {
  try {
    const BRT_OFFSET_MS = 3 * 60 * 60 * 1000;
    const openCheckins = await prisma.riderCheckin.findMany({
      where: { checkoutAt: null },
      include: { shift: true },
    });

    const now = new Date();
    let count = 0;

    for (const checkin of openCheckins) {
      if (!checkin.shift?.endTime) continue;
      const [endH, endM] = checkin.shift.endTime.split(':').map(Number);

      // Calcula o horário de fim do turno no dia BRT do check-in
      const checkinBRT = new Date(new Date(checkin.checkinAt).getTime() - BRT_OFFSET_MS);
      checkinBRT.setUTCHours(endH, endM, 0, 0);
      let shiftEndUTC = new Date(checkinBRT.getTime() + BRT_OFFSET_MS);

      // Turno noturno: se fim < início, avança 1 dia
      if (shiftEndUTC <= checkin.checkinAt) {
        shiftEndUTC = new Date(shiftEndUTC.getTime() + 24 * 60 * 60 * 1000);
      }

      const autoCheckout = new Date(shiftEndUTC.getTime() + 2 * 60 * 60 * 1000);

      if (now >= autoCheckout) {
        await prisma.riderCheckin.update({
          where: { id: checkin.id },
          data: { checkoutAt: autoCheckout },
        });
        count++;
      }
    }

    if (count > 0) console.log(`[Cron] Auto-checkout: ${count} entregador(es) encerrado(s) automaticamente`);
  } catch (err) {
    console.error('[Cron] Erro no auto-checkout de entregadores:', err);
  }
});

/**
 * Despesas recorrentes: gera lançamentos financeiros para templates com
 * vencimento nos próximos 3 dias. Executa no startup e diariamente às 09:00 UTC (06:00 BRT).
 */
generateRecurringExpenses().catch(console.error);

cron.schedule('0 9 * * *', async () => {
  console.log('[Cron] Gerando lançamentos de despesas recorrentes...')
  try {
    const n = await generateRecurringExpenses()
    console.log(`[Cron] Despesas recorrentes: ${n} lançamento(s) gerado(s)`)
  } catch (err) {
    console.error('[Cron] Erro ao gerar despesas recorrentes:', err)
  }
})

console.log('[Cron] Tarefas agendadas registradas (reset de créditos IA: dia 1 de cada mês; domínios vencidos: diário às 01:00; cobrança recorrente: diário às 06:00 UTC; agregação eventos menu: diário às 02:30; auto-checkout entregadores: a cada 30 min; despesas recorrentes: startup + diário às 09:00 UTC)')
