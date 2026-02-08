/**
 * defaultTemplate.js - Template padrão da comanda de impressão
 *
 * Placeholders disponíveis:
 *   {{header_name}}       - Nome do estabelecimento
 *   {{header_city}}       - Cidade
 *   {{display_id}}        - Número do pedido
 *   {{data_pedido}}       - Data do pedido
 *   {{hora_pedido}}       - Hora do pedido
 *   {{nome_cliente}}      - Nome do cliente
 *   {{telefone_cliente}}  - Telefone do cliente
 *   {{endereco_cliente}}  - Endereço de entrega
 *   {{tipo_pedido}}       - DELIVERY ou PICKUP
 *   {{total_itens_count}} - Quantidade total de itens
 *   {{subtotal}}          - Subtotal dos itens
 *   {{taxa_entrega}}      - Taxa de entrega
 *   {{desconto}}          - Desconto aplicado
 *   {{total}}             - Total do pedido
 *   {{observacoes}}       - Observações
 *   {{qr_url}}           - URL do QR code (despacho)
 *
 * QR Code:
 *   Use [QR:{{qr_url}}] em uma linha isolada para imprimir
 *   o QR code na impressora térmica.
 *
 * Blocos iteráveis:
 *   {{#each items}} ... {{/each}}
 *     {{item_qty}}    - Quantidade
 *     {{item_name}}   - Nome do item
 *     {{item_price}}  - Preço total do item
 *     {{notes}}       - Observação do item
 *     {{#each item_options}} ... {{/each}}
 *       {{option_qty}}   - Quantidade da opção
 *       {{option_name}}  - Nome da opção
 *       {{option_price}} - Preço da opção
 *
 *   {{#each pagamentos}} ... {{/each}}
 *     {{payment_method}} - Método de pagamento
 *     {{payment_value}}  - Valor do pagamento
 */

const DEFAULT_TEMPLATE = `================================================
{{header_name}}
{{header_city}}
================================================

*** PEDIDO #{{display_id}} ***
Data: {{data_pedido}}  Hora: {{hora_pedido}}
{{#if tipo_pedido}}
Tipo: {{tipo_pedido}}
{{/if}}

------------------------------------------------
CLIENTE: {{nome_cliente}}
Telefone: {{telefone_cliente}}
Endereco: {{endereco_cliente}}
------------------------------------------------

QT  Descricao                        Valor
{{#each items}}
{{item_qty}}x  {{item_name}}  R$ {{item_price}}
{{#each item_options}}
  -- {{option_qty}}x {{option_name}}  R$ {{option_price}}
{{/each}}
{{#if notes}}
  OBS: {{notes}}
{{/if}}
{{/each}}

------------------------------------------------
Qtd itens: {{total_itens_count}}
Subtotal:              R$ {{subtotal}}
{{#if taxa_entrega}}
Taxa entrega:          R$ {{taxa_entrega}}
{{/if}}
{{#if desconto}}
Desconto:              R$ {{desconto}}
{{/if}}
TOTAL:                 R$ {{total}}
------------------------------------------------

FORMAS DE PAGAMENTO
{{#each pagamentos}}
{{payment_method}}   R$ {{payment_value}}
{{/each}}

{{#if observacoes}}
OBS: {{observacoes}}
{{/if}}
{{#if qr_url}}
[QR:{{qr_url}}]
{{/if}}
================================================
Obrigado e bom apetite!
================================================`;

const DEFAULT_TEMPLATE_V2 = {
  v: 2,
  blocks: [
    { t: 'sep' },
    { t: 'text', c: '{{header_name}}', a: 'center', b: true, s: 'lg' },
    { t: 'text', c: '{{header_city}}', a: 'center' },
    { t: 'sep' },
    { t: 'text', c: 'PEDIDO #{{display_id}}', a: 'center', b: true, s: 'xl' },
    { t: 'text', c: 'Data: {{data_pedido}}  Hora: {{hora_pedido}}' },
    { t: 'cond', key: 'tipo_pedido', c: 'Tipo: {{tipo_pedido}}' },
    { t: 'sep' },
    { t: 'text', c: 'CLIENTE: {{nome_cliente}}', b: true },
    { t: 'text', c: 'Telefone: {{telefone_cliente}}' },
    { t: 'text', c: 'Endereco: {{endereco_cliente}}' },
    { t: 'sep' },
    { t: 'items', itemBold: true, itemSize: 'normal' },
    { t: 'sep' },
    { t: 'text', c: 'Qtd itens: {{total_itens_count}}' },
    { t: 'text', c: 'Subtotal: R$ {{subtotal}}' },
    { t: 'cond', key: 'taxa_entrega', c: 'Taxa entrega: R$ {{taxa_entrega}}' },
    { t: 'cond', key: 'desconto', c: 'Desconto: R$ {{desconto}}' },
    { t: 'text', c: 'TOTAL: R$ {{total}}', b: true, s: 'lg' },
    { t: 'sep' },
    { t: 'text', c: 'FORMAS DE PAGAMENTO', b: true },
    { t: 'payments' },
    { t: 'cond', key: 'observacoes', c: 'OBS: {{observacoes}}' },
    { t: 'qr' },
    { t: 'sep' },
    { t: 'text', c: 'Obrigado e bom apetite!', a: 'center' },
    { t: 'sep' }
  ]
};

module.exports = DEFAULT_TEMPLATE;
module.exports.DEFAULT_TEMPLATE_V2 = DEFAULT_TEMPLATE_V2;
