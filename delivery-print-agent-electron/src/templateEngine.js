'use strict';
/**
 * Motor de templates ESC/POS.
 *
 * Sintaxe de template (string de texto):
 *   {{variavel}}           → substitui com valor do contexto
 *   {{#if chave}} ... {{/if}}   → bloco condicional
 *   {{#each lista}} ... {{/each}} → loop sobre array
 *   [SEP]                  → linha separadora (--- em toda a largura)
 *   [CUT]                  → corte de papel
 *   [QR:{{url}}]           → QR Code
 *   [BOLD:on] / [BOLD:off] → toggle negrito
 *   [SIZE:2]               → tamanho 2x (volta com [SIZE:1])
 *   [ALIGN:center]         → alinhamento (left/center/right)
 *   [FEED:3]               → avança 3 linhas
 *
 * O método render(order, printer) retorna um Buffer com os bytes ESC/POS.
 */
const ESCPos = require('./printing/escpos');
const { DEFAULT_TEMPLATE_80, DEFAULT_TEMPLATE_58 } = require('./defaultTemplate');

/**
 * Ponto de entrada principal.
 * @param {object} order    - Dados do pedido
 * @param {object} printer  - PrinterConfig (width, characterSet, marginLeft, density)
 * @returns {Buffer}        - Bytes ESC/POS prontos para envio
 */
function render(order, printer) {
  const defaultTpl = (printer.width === 58) ? DEFAULT_TEMPLATE_58 : DEFAULT_TEMPLATE_80;
  const template = printer.template || defaultTpl;
  const context  = buildContext(order, printer);
  const charset  = printer.characterSet || 'PC850';
  const widthMm  = printer.width || 80;
  const cols     = ESCPos.columnsForWidth(widthMm);
  const margin   = printer.marginLeft || 0;

  const parts = [
    ESCPos.init(),
    ESCPos.codepage(charset),
    ESCPos.density(printer.density ?? 8),
    ESCPos.lineSpacingDefault(),
  ];

  // Processa template linha a linha
  const lines = processTemplate(template, context);

  let currentAlign = 'left';
  let isBold = false;

  for (const line of lines) {
    if (line.type === 'text') {
      if (margin > 0) parts.push(ESCPos.marginLeft(margin));
      parts.push(ESCPos.text(line.content, charset));
    } else if (line.type === 'sep') {
      parts.push(ESCPos.align('left'));
      parts.push(ESCPos.separator(cols - margin, line.char || '-'));
    } else if (line.type === 'bold') {
      isBold = line.on;
      parts.push(ESCPos.bold(isBold));
    } else if (line.type === 'size') {
      const m = line.mult || 1;
      parts.push(ESCPos.charSize(m, m));
    } else if (line.type === 'align') {
      currentAlign = line.value;
      parts.push(ESCPos.align(currentAlign));
    } else if (line.type === 'feed') {
      parts.push(ESCPos.feed(line.lines));
    } else if (line.type === 'qr') {
      parts.push(ESCPos.align('center'));
      parts.push(ESCPos.qrCode(line.data, 4, 1));
      parts.push(ESCPos.align('left'));
    } else if (line.type === 'cut') {
      parts.push(ESCPos.feedLines(4));
      parts.push(ESCPos.cut('partial'));
    }
  }

  // Garante corte ao final
  parts.push(ESCPos.feedLines(4));
  parts.push(ESCPos.cut('partial'));

  return Buffer.concat(parts);
}

// ─── Processador de template ──────────────────────────────────────────────────
function processTemplate(template, context) {
  // Resolve {{#each}} e {{#if}} antes de processar linhas
  let resolved = resolveBlocks(template, context);
  // Substitui variáveis simples
  resolved = substituteVars(resolved, context);

  const result = [];
  for (const rawLine of resolved.split('\n')) {
    const parsed = parseLine(rawLine, context);
    result.push(...parsed);
  }
  return result;
}

function resolveBlocks(tmpl, ctx) {
  // {{#each array}} ... {{/each}}
  tmpl = tmpl.replace(/\{\{#each (\w+)\}\}([\s\S]*?)\{\{\/each\}\}/g, (_, key, body) => {
    const arr = ctx[key];
    if (!Array.isArray(arr) || arr.length === 0) return '';
    return arr.map((item) => substituteVars(body, { ...ctx, ...item })).join('');
  });

  // {{#if key}} ... {{/if}}
  tmpl = tmpl.replace(/\{\{#if (\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (_, key, body) => {
    return ctx[key] ? body : '';
  });

  return tmpl;
}

function substituteVars(str, ctx) {
  return str.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (_, key) => {
    const val = _get(ctx, key);
    return val !== undefined && val !== null ? String(val) : '';
  });
}

function _get(obj, path) {
  return path.split('.').reduce((o, k) => (o != null ? o[k] : undefined), obj);
}

function parseLine(line, ctx) {
  const result = [];
  const trimmed = line.trimEnd();

  // Diretivas especiais
  if (trimmed === '[SEP]' || trimmed === '[SEP:-]') {
    result.push({ type: 'sep', char: '-' });
  } else if (trimmed === '[SEP:=]') {
    result.push({ type: 'sep', char: '=' });
  } else if (trimmed === '[CUT]') {
    result.push({ type: 'cut' });
  } else if (/^\[BOLD:(on|off)\]$/i.test(trimmed)) {
    result.push({ type: 'bold', on: trimmed.toLowerCase().includes('on') });
  } else if (/^\[SIZE:(\d)\]$/.test(trimmed)) {
    const m = parseInt(trimmed.match(/\[SIZE:(\d)\]/)[1]);
    result.push({ type: 'size', mult: m });
  } else if (/^\[ALIGN:(left|center|right)\]$/i.test(trimmed)) {
    const v = trimmed.match(/\[ALIGN:(\w+)\]/i)[1].toLowerCase();
    result.push({ type: 'align', value: v });
  } else if (/^\[FEED:(\d+)\]$/.test(trimmed)) {
    const n = parseInt(trimmed.match(/\[FEED:(\d+)\]/)[1]);
    result.push({ type: 'feed', lines: n });
  } else if (/^\[QR:(.+)\]$/.test(trimmed)) {
    const data = trimmed.match(/^\[QR:(.+)\]$/)[1];
    result.push({ type: 'qr', data });
  } else {
    result.push({ type: 'text', content: trimmed });
  }

  return result;
}

// ─── Construção do contexto ───────────────────────────────────────────────────
function buildContext(order, printer) {
  const createdAt = order.createdAt ? new Date(order.createdAt) : new Date();
  const pad2 = (n) => String(n).padStart(2, '0');

  const ctx = {
    // Cabeçalho
    loja_nome:    order.storeName || order.store?.name || 'Delivery',
    loja_cnpj:    order.store?.cnpj || '',
    display_id:   order.displayId || order.id || '---',
    data:         `${pad2(createdAt.getDate())}/${pad2(createdAt.getMonth()+1)}/${createdAt.getFullYear()}`,
    hora:         `${pad2(createdAt.getHours())}:${pad2(createdAt.getMinutes())}`,
    tipo:         order.type === 'delivery' ? 'DELIVERY' : order.type === 'pickup' ? 'RETIRADA' : 'MESA',

    // Cliente
    cliente_nome:    order.customer?.name || order.customerName || '',
    cliente_tel:     order.customer?.phone || order.customerPhone || '',

    // Endereço
    endereco_rua:    order.deliveryAddress?.street || '',
    endereco_num:    order.deliveryAddress?.number || '',
    endereco_comp:   order.deliveryAddress?.complement || '',
    endereco_bairro: order.deliveryAddress?.neighborhood || '',
    endereco_cidade: order.deliveryAddress?.city || '',
    endereco_ref:    order.deliveryAddress?.reference || '',

    // Itens (array para {{#each}})
    items: (order.items || []).map((item) => ({
      qtd:    String(item.quantity || 1),
      nome:   item.name || item.productName || '',
      obs:    item.notes || item.observation || '',
      preco:  _fmt(item.price),
      subtotal: _fmt((item.price || 0) * (item.quantity || 1)),
    })),

    // Pagamentos
    pagamentos: (order.payments || []).map((p) => ({
      metodo: p.method || p.name || '',
      valor:  _fmt(p.value),
    })),

    // Totais
    subtotal:    _fmt(order.subtotal),
    taxa:        _fmt(order.deliveryFee || 0),
    desconto:    _fmt(order.discount || 0),
    total:       _fmt(order.total),

    // Condicional helpers
    tem_taxa:    !!order.deliveryFee,
    tem_desconto: !!order.discount,
    tem_obs:     !!(order.notes || order.observation),
    obs_pedido:  order.notes || order.observation || '',

    // QR / link de rastreio
    link_pedido: order.trackingUrl || '',
    tem_qr:      !!(order.trackingUrl),

    // Impressora
    impressora_alias: printer?.alias || '',
  };

  return ctx;
}

function _fmt(cents) {
  if (cents == null) return '0,00';
  return 'R$ ' + (cents / 100).toFixed(2).replace('.', ',');
}

module.exports = { render, buildContext, processTemplate };
