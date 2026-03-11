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
 *  [INV:on/off]         → modo invertido (branco sobre preto)
 *  [ROW:esq|dir]        → linha com texto esquerdo e direito alinhados
 *
 * Nota: Para alterar o tamanho da fonte nas formas de pagamento,
 *       troque [SIZE:1] por [SIZE:2] (ou outro) antes do bloco [INV:on].
 *
 * Variáveis disponíveis no contexto:
 *  loja_nome, display_id, data, data_curta, hora, tipo
 *  tipo_delivery         → true somente para DELIVERY
 *  cliente_nome, cliente_tel
 *  localizador, localizador_suffix → ", Localizador: XXX" (para concat com tel)
 *  endereco_rua, endereco_num, endereco_comp, endereco_bairro, endereco_cidade, endereco_ref
 *  endereco_completo     → endereço como string única (fallback)
 *  items[].qtd, .nome, .obs, .preco, .preco_val, .subtotal
 *  pagamentos[].metodo, .valor, .valor_num
 *  subtotal, subtotal_val, taxa, taxa_val, desconto, desconto_val, total, total_val
 *  tem_taxa, tem_desconto, tem_obs, obs_pedido
 *  link_pedido, tem_qr, canal, codigo_coleta
 */

// ─── 80mm (48 colunas) ────────────────────────────────────────────────────────
const DEFAULT_TEMPLATE_80 = `[ALIGN:center]
[BOLD:on]
[SIZE:2]
{{tipo}}
[SIZE:1]
[BOLD:off]
[ALIGN:right]
{{data_curta}}
[ALIGN:left]
[BOLD:on]
Pedido: #{{display_id}}
[BOLD:off]
{{cliente_nome}}
Telefone: {{cliente_tel}}{{localizador_suffix}}
{{#if tipo_delivery}}
{{endereco_completo}}
{{/if}}{{#if tem_obs}}
Obs: {{obs_pedido}}
{{/if}}[SEP]
[ROW:Qt.Descricao|Valor]

{{#each items}}[BOLD:on]
[ROW:{{qtd}}  {{nome}}|{{preco_val}}]
[BOLD:off]
{{#if tem_opcoes}}{{opcoes}}
{{/if}}{{#if obs}}   Obs: {{obs}}
{{/if}}
{{/each}}[SEP]
[ROW:Quantidade de itens:|{{total_itens_count}}]

[ROW:Total Itens(=)|{{subtotal_val}}]
[ROW:Taxa entrega(+)|{{taxa_val}}]
[ROW:Acrescimo(+)|{{acrescimo_val}}]
[ROW:Desconto(-)|{{desconto_val}}]
[ROW:TOTAL(=)|{{total_val}}]

[SEP]
[SIZE:1]
[INV:on]
[BOLD:on]
Forma de pagamento
[BOLD:off]
{{#each pagamentos}}[ROW:{{metodo}}|{{valor_num}}]
{{/each}}[INV:off]
[SIZE:1]
[SEP:- ]
{{loja_nome}}
{{#if canal}}
Op: {{canal}}
{{/if}}{{#if tem_qr}}[ALIGN:center]
Rastreie seu pedido:
[QR:{{link_pedido}}]
[ALIGN:left]
{{/if}}[FEED:3]
[CUT]`.trim();

// ─── 58mm (32 colunas) ────────────────────────────────────────────────────────
const DEFAULT_TEMPLATE_58 = `[ALIGN:center]
[BOLD:on]
[SIZE:2]
{{tipo}}
[SIZE:1]
[BOLD:off]
[ALIGN:right]
{{data_curta}}
[ALIGN:left]
[BOLD:on]
Pedido: #{{display_id}}
[BOLD:off]
{{cliente_nome}}
Telefone: {{cliente_tel}}{{localizador_suffix}}
{{#if tipo_delivery}}
{{endereco_completo}}
{{/if}}{{#if tem_obs}}
Obs: {{obs_pedido}}
{{/if}}[SEP]
[ROW:Qt.Descr.|Valor]

{{#each items}}[BOLD:on]
[ROW:{{qtd}} {{nome}}|{{preco_val}}]
[BOLD:off]
{{#if tem_opcoes}}{{opcoes}}
{{/if}}{{#if obs}} -> {{obs}}
{{/if}}
{{/each}}[SEP]
[ROW:Qtd itens:|{{total_itens_count}}]

[ROW:Itens(=)|{{subtotal_val}}]
[ROW:Entrega(+)|{{taxa_val}}]
[ROW:Acresc(+)|{{acrescimo_val}}]
[ROW:Desc(-)|{{desconto_val}}]
[ROW:TOTAL(=)|{{total_val}}]

[SEP]
[SIZE:1]
[INV:on]
[BOLD:on]Pagamento[BOLD:off]
{{#each pagamentos}}[ROW:{{metodo}}|{{valor_num}}]
{{/each}}[INV:off]
[SIZE:1]
[SEP:- ]
{{loja_nome}}
{{#if canal}}
Op: {{canal}}
{{/if}}[FEED:3]
[CUT]`.trim();

// Exporta o template de 80mm como padrão.
// O templateEngine escolhe com base em printer.width.
const DEFAULT_TEMPLATE = DEFAULT_TEMPLATE_80;

module.exports = { DEFAULT_TEMPLATE, DEFAULT_TEMPLATE_80, DEFAULT_TEMPLATE_58 };
