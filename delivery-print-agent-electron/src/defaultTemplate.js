'use strict';
/**
 * Template padrão de cupom para 80mm e 58mm.
 *
 * Sintaxe:
 *  {{var}}              → variável simples
 *  {{#each items}}      → loop
 *  {{#if chave}}        → condicional (suporta aninhamento)
 *  [SEP]                → linha tracejada
 *  [SEP:=]              → linha dupla (===)
 *  [BOLD:on/off]        → negrito
 *  [SIZE:2]             → dobrar tamanho (reset com [SIZE:1])
 *  [ALIGN:center]       → centralizar
 *  [FEED:n]             → avançar n linhas
 *  [QR:url]             → QR Code
 *  [CUT]                → cortar papel
 *
 * Variáveis disponíveis no contexto:
 *  loja_nome, display_id, data, hora, tipo
 *  tipo_delivery         → true somente para DELIVERY
 *  cliente_nome, cliente_tel
 *  endereco_rua, endereco_num, endereco_comp, endereco_bairro, endereco_cidade, endereco_ref
 *  endereco_completo     → endereço como string única (fallback)
 *  items[].qtd, .nome, .obs, .preco, .subtotal
 *  pagamentos[].metodo, .valor
 *  subtotal, taxa, desconto, total
 *  tem_taxa, tem_desconto, tem_obs, obs_pedido
 *  link_pedido, tem_qr
 */

// ─── 80mm (48 colunas) ────────────────────────────────────────────────────────
const DEFAULT_TEMPLATE_80 = `
[ALIGN:center]
[BOLD:on]
[SIZE:2]
{{loja_nome}}
[SIZE:1]
[BOLD:off]
[SEP:=]
[ALIGN:left]
Pedido #{{display_id}}       {{data}} {{hora}}
Tipo: {{tipo}}
[SEP]
[BOLD:on]
CLIENTE
[BOLD:off]
Nome: {{cliente_nome}}
Tel:  {{cliente_tel}}
{{#if tipo_delivery}}
End:  {{endereco_rua}}, {{endereco_num}} {{endereco_comp}}
      {{endereco_bairro}} - {{endereco_cidade}}
{{/if}}
{{#if endereco_ref}}
Ref:  {{endereco_ref}}
{{/if}}
[SEP]
[BOLD:on]
ITENS
[BOLD:off]
{{#each items}}
{{qtd}}x {{nome}}
{{#if tem_opcoes}}
{{opcoes}}
{{/if}}
{{#if obs}}
   Obs: {{obs}}
{{/if}}
   {{preco}}
{{/each}}
[SEP]
{{#if tem_taxa}}
Taxa de Entrega:         {{taxa}}
{{/if}}
{{#if tem_desconto}}
Desconto:               -{{desconto}}
{{/if}}
[SEP:=]
[BOLD:on]
TOTAL:                  {{total}}
[BOLD:off]
[SEP]
[BOLD:on]
PAGAMENTO
[BOLD:off]
{{#each pagamentos}}
{{metodo}}:             {{valor}}
{{/each}}
{{#if tem_obs}}
[SEP]
Obs: {{obs_pedido}}
{{/if}}
{{#if tem_qr}}
[SEP]
[ALIGN:center]
Rastreie seu pedido:
[QR:{{link_pedido}}]
[ALIGN:left]
{{/if}}
[FEED:3]
[CUT]
`.trim();

// ─── 58mm (32 colunas) ────────────────────────────────────────────────────────
const DEFAULT_TEMPLATE_58 = `
[ALIGN:center]
[BOLD:on]
{{loja_nome}}
[BOLD:off]
[SEP:=]
[ALIGN:left]
Pedido #{{display_id}}
{{data}} {{hora}} | {{tipo}}
[SEP]
{{cliente_nome}}
{{cliente_tel}}
{{#if tipo_delivery}}
{{endereco_rua}}, {{endereco_num}}
{{endereco_bairro}}
{{/if}}
[SEP]
[BOLD:on]
ITENS
[BOLD:off]
{{#each items}}
{{qtd}}x {{nome}}
{{#if tem_opcoes}}
{{opcoes}}
{{/if}}
{{#if obs}}
 -> {{obs}}
{{/if}}
{{preco}}
{{/each}}
[SEP]
{{#if tem_taxa}}
Entrega: {{taxa}}
{{/if}}
[BOLD:on]
TOTAL: {{total}}
[BOLD:off]
[SEP]
{{#each pagamentos}}
{{metodo}}: {{valor}}
{{/each}}
[FEED:3]
[CUT]
`.trim();

// Exporta o template de 80mm como padrão.
// O templateEngine escolhe com base em printer.width.
const DEFAULT_TEMPLATE = DEFAULT_TEMPLATE_80;

module.exports = { DEFAULT_TEMPLATE, DEFAULT_TEMPLATE_80, DEFAULT_TEMPLATE_58 };
