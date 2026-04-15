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
 *  [SIZE:2]             → dobrar tamanho largura+altura (reset com [SIZE:1])
 *  [SIZE:1x2]           → altura dobrada, largura normal (estilo SAIPOS: esticado vertical)
 *  [ALIGN:center]       → centralizar
 *  [FEED:n]             → avançar n linhas
 *  [QR:url]             → QR Code
 *  [CUT]                → cortar papel
 *  [INV:on/off]         → modo invertido (branco sobre preto)
 *  [ROW:esq|dir]        → linha com texto esquerdo e direito alinhados
 *
 * Nota: O corpo usa [SIZE:1x2] (esticado vertical, estilo SAIPOS).
 *       O header usa [SIZE:2] (dobrado em ambas direções).
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
 *  size_item_nome            → [SIZE:WxH] configurável (printer.itemNameSize, padrão "1x2")
 *  size_item_opcao           → [SIZE:WxH] configurável (printer.itemOptionSize, padrão "1x2")
 */

// ─── 80mm (48 colunas) ── Estilo SAIPOS ──────────────────────────────────────
const DEFAULT_TEMPLATE_80 = `[ALIGN:center]
[BOLD:on]
[SIZE:2]
{{tipo}} #{{display_id}}
[SIZE:1x2]
[BOLD:off]
[ALIGN:right]
{{data_curta}}
[ALIGN:left]
{{cliente_nome}}
Telefone: {{cliente_tel}}{{localizador_suffix}}
[SEP]
{{#if tipo_delivery}}
{{endereco_completo}}
[SEP]
{{/if}}{{#if tem_obs}}
Obs: {{obs_pedido}}
{{/if}}
[ROW:Qt.Descricao|Valor]
[SEP]
{{#each items}}{{size_item_nome}}
[BOLD:on]
[ROW:{{qtd}}  {{nome}}|{{preco_val}}]
[BOLD:off]
{{size_item_opcao}}
{{#if tem_opcoes}}{{opcoes}}
{{/if}}{{#if obs}}   ** {{obs}} **
{{/if}}
{{/each}}[SIZE:1x2]
[SEP]
[BOLD:on]
[ROW:Quantidade de itens:|{{total_itens_count}}]
[BOLD:off]
[SEP]
[ROW:Total itens(=)|{{subtotal_val}}]
[ROW:Taxa de entrega(+)|{{taxa_val}}]
[ROW:Taxa servico|{{acrescimo_val}}]
[ROW:Desconto(-)|{{desconto_val}}]
[BOLD:on]
[ROW:TOTAL FATURADO|{{total_val}}]
[BOLD:off]
[SEP]
[INV:on]
[BOLD:on]
Forma de pagamento
[BOLD:off]
{{#each pagamentos}}[ROW:{{metodo}}|{{valor_num}}]
{{/each}}
{{#if tem_troco}}[BOLD:on]
Troco para R$ {{troco}}
[BOLD:off]
{{/if}}[INV:off]
[SEP]
[ALIGN:center]
[SIZE:1x2]
[BOLD:on]
{{loja_nome}}
[BOLD:off]
[SIZE:1]
{{#if sales_channel}}
{{sales_channel}}
{{/if}}[ALIGN:left]
{{#if tem_qr}}[ALIGN:center]
Rastreie seu pedido:
[QR:{{link_pedido}}]
[ALIGN:left]
{{/if}}[FEED:3]
[CUT]`.trim();

// ─── 58mm (32 colunas) ── Estilo SAIPOS ──────────────────────────────────────
const DEFAULT_TEMPLATE_58 = `[ALIGN:center]
[BOLD:on]
[SIZE:2]
{{tipo}} #{{display_id}}
[SIZE:1x2]
[BOLD:off]
[ALIGN:right]
{{data_curta}}
[ALIGN:left]
{{cliente_nome}}
Tel: {{cliente_tel}}{{localizador_suffix}}
[SEP]
{{#if tipo_delivery}}
{{endereco_completo}}
[SEP]
{{/if}}{{#if tem_obs}}
Obs: {{obs_pedido}}
{{/if}}
[ROW:Qt.Descr.|Valor]
[SEP]
{{#each items}}{{size_item_nome}}
[BOLD:on]
[ROW:{{qtd}} {{nome}}|{{preco_val}}]
[BOLD:off]
{{size_item_opcao}}
{{#if tem_opcoes}}{{opcoes}}
{{/if}}{{#if obs}}   ** {{obs}} **
{{/if}}
{{/each}}[SIZE:1x2]
[SEP]
[ROW:Qtd itens:|{{total_itens_count}}]

[ROW:Itens(=)|{{subtotal_val}}]
[ROW:Entrega(+)|{{taxa_val}}]
[ROW:Taxa serv|{{acrescimo_val}}]
[ROW:Desc(-)|{{desconto_val}}]
[BOLD:on]
[ROW:TOTAL FAT.|{{total_val}}]
[BOLD:off]
[SEP]
[INV:on]
[BOLD:on]
Pagamento
[BOLD:off]
{{#each pagamentos}}[ROW:{{metodo}}|{{valor_num}}]
{{/each}}
{{#if tem_troco}}[BOLD:on]
Troco p/ R$ {{troco}}
[BOLD:off]
{{/if}}[INV:off]
[SEP]
[ALIGN:center]
[SIZE:1x2]
[BOLD:on]
{{loja_nome}}
[BOLD:off]
[SIZE:1]
{{#if sales_channel}}
{{sales_channel}}
{{/if}}[ALIGN:left]
[FEED:3]
[CUT]`.trim();

// Exporta o template de 80mm como padrão.
// O templateEngine escolhe com base em printer.width.
const DEFAULT_TEMPLATE = DEFAULT_TEMPLATE_80;

module.exports = { DEFAULT_TEMPLATE, DEFAULT_TEMPLATE_80, DEFAULT_TEMPLATE_58 };
