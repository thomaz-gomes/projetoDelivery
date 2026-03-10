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
 *   {{codigo_coleta}}    - Código de coleta iFood (pickupCode)
 *   {{localizador}}      - Localizador do pedido iFood (phone.localizer)
 *   {{horario_agendado}} - Horário agendado (DD/MM HH:MM) para pedidos SCHEDULED
 *
 * QR Code:
 *   Use [QR:{{qr_url}}] em uma linha isolada para imprimir
 *   o QR code na impressora térmica.
 *
 * Blocos iteráveis:
 *   {{#each items}} ... {{/each}}
 *     {{item_qty}}          - Quantidade
 *     {{item_name}}         - Nome do item
 *     {{item_price}}        - Preco total da linha (item + adicionais) x qty
 *     {{item_unit_price}}   - Preco unitario do item
 *     {{item_has_unit_hint}}- "1" quando qty > 1 (para exibir /un)
 *     {{notes}}             - Observacao do item
 *     {{#each item_options}} ... {{/each}}
 *       {{option_qty}}       - Qtd por unidade do item pai
 *       {{option_total_qty}} - Qtd total (option_qty x item_qty)
 *       {{option_name}}      - Nome da opcao
 *       {{option_price}}     - Preco unitario da opcao
 *       {{has_total}}        - "1" quando item pai qty > 1
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
{{#if horario_agendado}}
*** AGENDADO PARA: {{horario_agendado}} ***
{{/if}}

------------------------------------------------
CLIENTE: {{nome_cliente}}
Telefone: {{telefone_cliente}}
{{#if localizador}}
Localizador: {{localizador}}
{{/if}}
Endereco: {{endereco_cliente}}
{{#if codigo_coleta}}
Cod. Coleta: {{codigo_coleta}}
{{/if}}
------------------------------------------------

QT  Descricao                        Valor
{{#each items}}
{{item_qty}}x {{item_name}}  R${{item_price}}
{{#if item_has_unit_hint}}
  (R${{item_unit_price}}/un)
{{/if}}
{{#each item_options}}
 +{{option_qty}}/un {{option_name}} R${{option_price}}/un
{{#if has_total}}
  (={{option_total_qty}} total)
{{/if}}
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
{{#if taxa_servico}}
Taxa servico:          R$ {{taxa_servico}}
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

{{#if troco}}
TROCO PARA:            R$ {{troco}}
{{/if}}

{{#if observacoes}}
OBS: {{observacoes}}
{{/if}}
{{#if obs_entrega}}
OBS ENTREGA: {{obs_entrega}}
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
    { t: 'cond', key: 'horario_agendado', c: '*** AGENDADO PARA: {{horario_agendado}} ***', b: true },
    { t: 'sep' },
    { t: 'text', c: 'CLIENTE: {{nome_cliente}}', b: true },
    { t: 'text', c: 'Telefone: {{telefone_cliente}}' },
    { t: 'cond', key: 'localizador', c: 'Localizador: {{localizador}}' },
    { t: 'text', c: 'Endereco: {{endereco_cliente}}' },
    { t: 'cond', key: 'codigo_coleta', c: 'Cod. Coleta: {{codigo_coleta}}' },
    { t: 'sep' },
    { t: 'items', itemBold: true, itemSize: 'normal' },
    { t: 'sep' },
    { t: 'text', c: 'Qtd itens: {{total_itens_count}}' },
    { t: 'text', c: 'Subtotal: R$ {{subtotal}}' },
    { t: 'cond', key: 'taxa_entrega', c: 'Taxa entrega: R$ {{taxa_entrega}}' },
    { t: 'cond', key: 'taxa_servico', c: 'Taxa servico: R$ {{taxa_servico}}' },
    { t: 'cond', key: 'desconto', c: 'Desconto: R$ {{desconto}}' },
    { t: 'text', c: 'TOTAL: R$ {{total}}', b: true, s: 'lg' },
    { t: 'sep' },
    { t: 'text', c: 'FORMAS DE PAGAMENTO', b: true },
    { t: 'payments' },
    { t: 'cond', key: 'troco', c: 'TROCO PARA: R$ {{troco}}' },
    { t: 'cond', key: 'observacoes', c: 'OBS: {{observacoes}}' },
    { t: 'cond', key: 'obs_entrega', c: 'OBS ENTREGA: {{obs_entrega}}' },
    { t: 'qr' },
    { t: 'sep' },
    { t: 'text', c: 'Obrigado e bom apetite!', a: 'center' },
    { t: 'sep' }
  ]
};

module.exports = DEFAULT_TEMPLATE;
module.exports.DEFAULT_TEMPLATE_V2 = DEFAULT_TEMPLATE_V2;
