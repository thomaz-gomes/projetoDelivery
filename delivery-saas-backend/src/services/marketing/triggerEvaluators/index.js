// src/services/marketing/triggerEvaluators/index.js
//
// Registry de evaluators de TRIGGER. Adicionar um trigger novo = criar o
// arquivo de evaluator + registrar aqui. Tudo channel-agnostic — emitem
// candidatos { conversationId, customerId, lastInboundAt, ... } que o
// sweep usa pra criar MarketingMessage.

import { evaluateWindowNoOrder } from './windowNoOrder.js'
import { evaluateWindowWithOrder } from './windowWithOrder.js'

export const TRIGGER_EVALUATORS = {
  WINDOW_NO_ORDER: evaluateWindowNoOrder,
  WINDOW_WITH_ORDER: evaluateWindowWithOrder,
}

export const TRIGGER_LABELS = {
  WINDOW_NO_ORDER: 'Cliente abriu janela 24h sem fazer pedido',
  WINDOW_WITH_ORDER: 'Cliente abriu janela 24h e fez pedido',
}

export function getEvaluator(triggerType) {
  return TRIGGER_EVALUATORS[triggerType] || null
}
