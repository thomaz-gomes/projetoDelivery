// src/messaging/templates/defaultsCatalog.js
//
// Catálogo dos templates padrão do sistema, alinhado 1:1 com
// TEMPLATE_PARAM_BUILDERS em src/services/notify.js. A ordem das variáveis
// {{1}}, {{2}}, ... bate com a ordem dos `textParam(...)` que o builder gera
// para cada NotificationType. Se você mudar um aqui, mude o outro também.
//
// Convenções:
// - Categoria: UTILITY (transacional — aprovação rápida e barata).
// - Idioma: pt_BR.
// - Nome: snake_case lowercase com prefixo `dwl_` (Delivery WL) pra não
//   colidir com templates existentes do operador.

export const DEFAULT_TEMPLATE_LANGUAGE = 'pt_BR'
export const DEFAULT_TEMPLATE_CATEGORY = 'UTILITY'

export const DEFAULT_TEMPLATES = [
  {
    notificationType: 'ORDER_SUMMARY',
    name: 'dwl_order_summary',
    description: 'Confirmação do pedido recebido',
    bodyText:
      'Olá {{1}}! 🎉\n\n' +
      'Seu pedido {{2}} no *{{3}}* foi recebido com sucesso.\n' +
      'Em instantes começamos a preparar. Te aviso quando atualizar o status!',
  },
  {
    notificationType: 'CONFIRMACAO_PAGAMENTO',
    name: 'dwl_confirmacao_pagamento',
    description: 'Pagamento confirmado',
    bodyText:
      'Olá {{1}}! ✅\n\n' +
      'Recebemos o pagamento do seu pedido {{2}} no *{{3}}*.\n' +
      'Já vamos começar a preparar. 🍔',
  },
  {
    notificationType: 'EM_PREPARO',
    name: 'dwl_em_preparo',
    description: 'Pedido em preparo',
    bodyText:
      'Olá {{1}}! 👨‍🍳\n\n' +
      'Seu pedido {{2}} no *{{3}}* está em preparo.\n' +
      'Te aviso assim que sair pra entrega!',
  },
  {
    notificationType: 'SAIU_PARA_ENTREGA',
    name: 'dwl_saiu_para_entrega',
    description: 'Pedido saiu para entrega',
    bodyText:
      '{{1}}, seu pedido {{2}} no *{{3}}* saiu para entrega! 🛵\n\n' +
      'Fica atento(a) — em alguns minutos chega aí.',
  },
  {
    notificationType: 'CONCLUIDO',
    name: 'dwl_concluido',
    description: 'Pedido entregue',
    bodyText:
      '{{1}}, seu pedido {{2}} no *{{3}}* foi entregue! 🎉\n\n' +
      'Esperamos que tenha gostado. Obrigado pela preferência!',
  },
  {
    notificationType: 'CANCELADO',
    name: 'dwl_cancelado',
    description: 'Pedido cancelado',
    bodyText:
      '{{1}}, seu pedido {{2}} no *{{3}}* foi cancelado.\n\n' +
      'Se tiver dúvidas ou precisar de ajuda, é só responder essa mensagem.',
  },
  {
    notificationType: 'RIDER_ASSIGNED',
    name: 'dwl_rider_assigned',
    description: 'Notificação para o entregador',
    bodyText:
      '🛵 Nova entrega\n\n' +
      'Pedido: {{1}}\n' +
      'Cliente: {{2}}\n' +
      'Endereço: {{3}}\n' +
      'Mapa: {{4}}',
  },
  {
    notificationType: 'CASHBACK_CREDIT',
    name: 'dwl_cashback_credit',
    description: 'Crédito de cashback',
    bodyText:
      '{{1}}, você ganhou cashback! 💰\n\n' +
      'Valor ganho: {{2}}\n' +
      'Saldo total: {{3}}\n\n' +
      'Use no seu próximo pedido!',
  },
]

// Converte uma entrada do catálogo no formato `components[]` esperado pela
// Meta Graph API. O adapter `whatsappMeta.adapter.js#normalizeTemplateComponent`
// vai auto-gerar `example.body_text` quando submeter na Meta.
export function buildComponentsForTemplate(catalogEntry) {
  return [
    {
      type: 'BODY',
      text: catalogEntry.bodyText,
    },
  ]
}
