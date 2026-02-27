/**
 * cron.js — Tarefas agendadas do servidor
 *
 * Importado em src/index.js para iniciar os jobs junto com o servidor.
 */

import cron from 'node-cron'
import { resetAllDueCredits } from './services/aiCreditManager.js'

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

console.log('[Cron] Tarefas agendadas registradas (reset de créditos IA: dia 1 de cada mês)')
