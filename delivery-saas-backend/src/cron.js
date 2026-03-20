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

console.log('[Cron] Tarefas agendadas registradas (reset de créditos IA: dia 1 de cada mês; domínios vencidos: diário às 01:00; cobrança recorrente: diário às 06:00 UTC; agregação eventos menu: diário às 02:30)')
