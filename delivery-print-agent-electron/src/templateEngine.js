'use strict';
/**
 * Motor de templates ESC/POS.
 *
 * Dois modos de renderização:
 *
 * 1) Formato JSON de blocos ({"v":2,"blocks":[...]}) — salvo pelo painel web.
 *    Placeholders: {{header_name}}, {{nome_cliente}}, {{total}}, etc.
 *    Suporta tipos: text, sep, cond, items, payments, qr
 *
 * 2) Formato texto (string com diretivas):
 *    {{variavel}}, {{#if}}, {{#each}}, [SEP], [CUT], [QR:url], [BOLD:on/off],
 *    [SIZE:2], [ALIGN:center], [FEED:3]
 *
 * Prioridade: printer.template (local) > order.receiptTemplate (JSON painel) > defaultTemplate (texto)
 */
const ESCPos = require('./printing/escpos');
const { DEFAULT_TEMPLATE_80, DEFAULT_TEMPLATE_58 } = require('./defaultTemplate');
const logger = require('./logger');

// ─── Ponto de entrada ─────────────────────────────────────────────────────────
function render(order, printer) {
  const charset = printer.characterSet || 'PC850';
  const widthMm = printer.width || 80;
  const cols    = ESCPos.columnsForWidth(widthMm);
  const margin  = printer.marginLeft || 0;

  const header = [
    ESCPos.init(),
    ESCPos.codepage(charset),
    ESCPos.density(printer.density ?? 8),
    ESCPos.lineSpacingDefault(),
  ];

  // Verificar se algum template disponível é formato JSON de blocos (v2)
  const templateSources = [printer.template, order.receiptTemplate].filter(Boolean);
  for (const src of templateSources) {
    try {
      const parsed = JSON.parse(src);
      if (parsed && parsed.v === 2 && Array.isArray(parsed.blocks)) {
        return _renderBlocks(parsed.blocks, order, printer, header, cols, margin, charset);
      }
    } catch (_) { /* não é JSON — continuar */ }
  }

  // Template texto (local do agente ou padrão embutido)
  const defaultTpl = widthMm === 58 ? DEFAULT_TEMPLATE_58 : DEFAULT_TEMPLATE_80;
  // Usar printer.template apenas se não for JSON (já foi testado acima)
  const template   = (printer.template && !printer.template.trimStart().startsWith('{'))
    ? printer.template
    : defaultTpl;
  const context    = buildContext(order, printer);
  const lines      = processTemplate(template, context);
  const parts      = [...header];

  for (const line of lines) {
    if (line.type === 'text') {
      if (margin > 0) parts.push(ESCPos.marginLeft(margin));
      parts.push(ESCPos.text(line.content, charset));
    } else if (line.type === 'sep') {
      parts.push(ESCPos.align('left'));
      parts.push(ESCPos.separator(cols - margin, line.char || '-'));
    } else if (line.type === 'bold') {
      parts.push(ESCPos.bold(line.on));
    } else if (line.type === 'size') {
      const m = line.mult || 1;
      parts.push(ESCPos.charSize(m, m));
    } else if (line.type === 'align') {
      parts.push(ESCPos.align(line.value));
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

  parts.push(ESCPos.feedLines(4));
  parts.push(ESCPos.cut('partial'));
  return Buffer.concat(parts);
}

// ─── Renderizador de blocos JSON (formato do painel) ──────────────────────────
function _renderBlocks(blocks, order, printer, header, cols, margin, charset) {
  const ctx = buildBlockContext(order, printer);
  const pl  = order.payload || {};

  // Extrai pagamentos (mesma lógica do buildContext)
  const rawPayments = Array.isArray(order.payments)              ? order.payments
    : Array.isArray(pl.paymentConfirmed)                         ? pl.paymentConfirmed
    : Array.isArray(pl.payments)                                 ? pl.payments
    : (pl.payment && typeof pl.payment === 'object')             ? [pl.payment]
    : [];

  const parts = [...header];

  for (const block of blocks) {
    switch (block.t) {

      case 'sep':
        parts.push(ESCPos.align('left'));
        parts.push(ESCPos.separator(cols - margin, '-'));
        break;

      case 'text':
      case 'cond': {
        // Bloco condicional: exibe somente se ctx[key] for truthy
        if (block.t === 'cond' && !ctx[block.key]) break;

        const align = block.a || 'left';
        parts.push(ESCPos.align(align));

        if (block.b) parts.push(ESCPos.bold(true));
        // xl → duplo (largura + altura); lg → apenas altura (evita quebra de linha)
        if (block.s === 'xl')      parts.push(ESCPos.charSize(2, 2));
        else if (block.s === 'lg') parts.push(ESCPos.charSize(1, 2));
        else                       parts.push(ESCPos.charSize(1, 1));

        const content = substituteVars(block.c || '', ctx);
        if (margin > 0) parts.push(ESCPos.marginLeft(margin));
        parts.push(ESCPos.text(content, charset));

        // Reset formatação
        if (block.b)                               parts.push(ESCPos.bold(false));
        if (block.s === 'xl' || block.s === 'lg') parts.push(ESCPos.charSize(1, 1));
        if (align !== 'left')                      parts.push(ESCPos.align('left'));
        break;
      }

      case 'items': {
        const items    = order.items || [];
        const itemBold = block.itemBold;
        const itemBig  = block.itemSize === 'lg';

        for (const item of items) {
          if (itemBold) parts.push(ESCPos.bold(true));
          if (itemBig)  parts.push(ESCPos.charSize(2, 2));

          const qty  = item.quantity || 1;
          const name = item.name || item.productName || '';
          if (margin > 0) parts.push(ESCPos.marginLeft(margin));
          parts.push(ESCPos.text(`${qty}x ${name}`, charset));

          if (itemBold) parts.push(ESCPos.bold(false));
          if (itemBig)  parts.push(ESCPos.charSize(1, 1));

          // Complementos / opções do item — altura dupla (maior que texto normal, menor que nome do item)
          if (Array.isArray(item.options) && item.options.length > 0) {
            parts.push(ESCPos.charSize(1, 2));
            for (const opt of item.options) {
              const optName  = opt.name || '';
              const optPrice = _toNum(opt.price || 0);
              const optLine  = optPrice > 0
                ? `   + ${optName}: R$ ${_fmtN(optPrice)}`
                : `   + ${optName}`;
              if (margin > 0) parts.push(ESCPos.marginLeft(margin));
              parts.push(ESCPos.text(optLine, charset));
            }
            parts.push(ESCPos.charSize(1, 1));
          }

          const obs = item.notes || item.observation || '';
          if (obs) {
            if (margin > 0) parts.push(ESCPos.marginLeft(margin));
            parts.push(ESCPos.text(`   Obs: ${obs}`, charset));
          }

          // Preço total do item (base + opções) × quantidade
          const basePrice  = _toNum(item.price);
          const optsTotal  = Array.isArray(item.options)
            ? item.options.reduce((s, o) => s + _toNum(o.price || 0), 0)
            : 0;
          const unitPrice  = basePrice + optsTotal;
          const subtotal   = unitPrice * qty;
          const priceStr   = qty > 1
            ? `   R$ ${_fmtN(unitPrice)}  (${qty}x = R$ ${_fmtN(subtotal)})`
            : `   R$ ${_fmtN(unitPrice)}`;
          if (margin > 0) parts.push(ESCPos.marginLeft(margin));
          parts.push(ESCPos.text(priceStr, charset));
        }
        break;
      }

      case 'payments': {
        for (const p of rawPayments) {
          const method = p.method || p.name || p.tipo || p.paymentMethod || '';
          const value  = _toNum(p.value || p.amount || p.valor || 0);
          if (margin > 0) parts.push(ESCPos.marginLeft(margin));
          parts.push(ESCPos.text(`${method}: R$ ${_fmtN(value)}`, charset));
        }
        break;
      }

      case 'qr': {
        const url = order.qrText || order.trackingUrl || '';
        if (url) {
          parts.push(ESCPos.align('center'));
          parts.push(ESCPos.qrCode(url, 7, 1));
          parts.push(ESCPos.align('left'));
        }
        break;
      }
    }
  }

  parts.push(ESCPos.feedLines(4));
  parts.push(ESCPos.cut('partial'));
  return Buffer.concat(parts);
}

// ─── Contexto para blocos JSON (chaves do painel) ─────────────────────────────
/**
 * Usa as mesmas chaves de placeholder que o ReceiptTemplateEditor.vue:
 * header_name, header_city, display_id, data_pedido, hora_pedido, tipo_pedido,
 * nome_cliente, telefone_cliente, endereco_cliente,
 * subtotal, taxa_entrega, desconto, total, observacoes, total_itens_count
 *
 * Valores monetários são números formatados SEM prefixo "R$ " (o template já tem "R$ ").
 * Valores zero retornam '' (falsy) para que blocos cond se ocultem.
 */
function buildBlockContext(order) {
  const createdAt = order.createdAt ? new Date(order.createdAt) : new Date();
  const pad2 = (n) => String(n).padStart(2, '0');

  const rawType     = String(order.orderType || order.type || '').toLowerCase();
  const tipo_pedido = rawType === 'delivery' ? 'DELIVERY'
                    : rawType === 'pickup'   ? 'RETIRADA'
                    : rawType === 'mesa'     ? 'MESA'
                    : rawType               ? rawType.toUpperCase()
                    : '';

  // ── Endereço ─────────────────────────────────────────────────────────────────
  // O enrichOrderForAgent já resolve order.address como string flat.
  // Filtrar sentinel "-" e tentar múltiplos fallbacks.
  let endereco_cliente = (typeof order.address === 'string' && order.address && order.address !== '-') ? order.address : '';
  if (!endereco_cliente) {
    try {
      const pl = order.payload || {};
      const da = (pl.delivery && pl.delivery.deliveryAddress)
              || pl.deliveryAddress
              || order.deliveryAddress;    // campo direto no order (pedidos legados)
      if (da && typeof da === 'string' && da !== '-') {
        endereco_cliente = da;
      } else if (da && typeof da === 'object') {
        if (da.formattedAddress) {
          endereco_cliente = da.formattedAddress;
        } else {
          const parts = [
            da.streetName || da.street || da.logradouro || '',
            da.streetNumber || da.number || da.numero || '',
            da.complement || da.complemento || '',
            da.neighborhood || da.bairro || '',
            da.city || da.cidade || '',
          ].filter(Boolean);
          endereco_cliente = parts.join(', ');
        }
      }

      // Fallback: deliveryNeighborhood (coluna desnormalizada do DB — tem pelo menos o bairro)
      if (!endereco_cliente && order.deliveryNeighborhood) {
        endereco_cliente = order.deliveryNeighborhood;
      }

      // Fallback adicional: rawPayload.address (mesmo caminho que enrichOrderForAgent usa)
      if (!endereco_cliente) {
        const raw = pl.rawPayload && pl.rawPayload.address;
        if (raw && typeof raw === 'string' && raw !== '-') {
          endereco_cliente = raw;
        } else if (raw && typeof raw === 'object') {
          if (raw.formattedAddress) {
            endereco_cliente = raw.formattedAddress;
          } else {
            const rp = [
              raw.streetName || raw.street || raw.logradouro || '',
              raw.streetNumber || raw.number || raw.numero || '',
              raw.complement || raw.complemento || '',
              raw.neighborhood || raw.bairro || '',
              raw.city || raw.cidade || '',
            ].filter(Boolean);
            if (rp.length) endereco_cliente = rp.join(', ');
          }
        }
      }
    } catch (_) { /* ignore */ }
  }

  logger.info('[tpl] endereço resolvido', {
    'order.address':  order.address,
    'order.deliveryAddress': order.deliveryAddress,
    endereco_cliente,
  });

  // ── Subtotal ─────────────────────────────────────────────────────────────────
  // Order não tem campo subtotal no schema — calcular da soma dos itens.
  // Inclui preço base dos itens × quantidade.
  const itemsTotal = (order.items || []).reduce((s, i) => {
    const base = _toNum(i.price) * (i.quantity || 1);
    // Soma opções/complementos do item
    const optsTotal = Array.isArray(i.options)
      ? i.options.reduce((os, o) => os + _toNum(o.price || 0), 0) * (i.quantity || 1)
      : 0;
    return s + base + optsTotal;
  }, 0);

  const taxaVal     = _toNum(order.deliveryFee || 0);
  const descontoVal = _toNum(order.discount || order.couponDiscount || 0);
  const subtotalVal = _toNum(order.subtotal) || itemsTotal;
  const totalVal    = _toNum(order.total);

  return {
    header_name:       order.headerName || order.store?.name || order.storeName || 'Delivery',
    header_city:       order.headerCity || '',
    display_id:        String(order.displayId || order.displaySimple || order.id || '---'),
    data_pedido:       `${pad2(createdAt.getDate())}/${pad2(createdAt.getMonth()+1)}/${createdAt.getFullYear()}`,
    hora_pedido:       `${pad2(createdAt.getHours())}:${pad2(createdAt.getMinutes())}`,
    tipo_pedido,
    nome_cliente:      order.customer?.name || order.customerName || '',
    telefone_cliente:  order.customer?.phone || order.customerPhone || '',
    endereco_cliente,
    subtotal:          subtotalVal > 0  ? _fmtN(subtotalVal)  : '0,00',
    taxa_entrega:      taxaVal > 0      ? _fmtN(taxaVal)      : '',   // '' → cond oculta
    desconto:          descontoVal > 0  ? _fmtN(descontoVal)  : '',   // '' → cond oculta
    total:             totalVal > 0     ? _fmtN(totalVal)     : '0,00',
    observacoes:       order.notes || order.observation || '',
    total_itens_count: String((order.items || []).reduce((s, i) => s + (i.quantity || 1), 0)),
  };
}

// ─── Processador de template texto ────────────────────────────────────────────
function processTemplate(template, context) {
  let resolved = resolveBlocks(template, context);
  resolved = substituteVars(resolved, context);

  const result = [];
  for (const rawLine of resolved.split('\n')) {
    const parsed = parseLine(rawLine);
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

  // {{#if key}} ... {{/if}} — iterativo para suportar aninhamento
  let prev;
  do {
    prev = tmpl;
    tmpl = tmpl.replace(/\{\{#if (\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (_, key, body) => {
      return ctx[key] ? body : '';
    });
  } while (tmpl !== prev);

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

function parseLine(line) {
  const result  = [];
  const trimmed = line.trimEnd();

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
    const data = trimmed.match(/^\[QR:(.+)\]$/)[1].trim();
    if (data) result.push({ type: 'qr', data });
  } else {
    result.push({ type: 'text', content: trimmed });
  }

  return result;
}

// ─── Construção do contexto (template texto) ──────────────────────────────────
function buildContext(order, printer) {
  const createdAt = order.createdAt ? new Date(order.createdAt) : new Date();
  const pad2 = (n) => String(n).padStart(2, '0');

  const rawType = String(order.orderType || order.type || '').toLowerCase();
  const tipo = rawType === 'delivery' ? 'DELIVERY'
             : rawType === 'pickup'   ? 'RETIRADA'
             : rawType === 'mesa'     ? 'MESA'
             : rawType               ? rawType.toUpperCase()
             : 'PEDIDO';
  const tipo_delivery = rawType === 'delivery';

  const da = (order.deliveryAddress && typeof order.deliveryAddress === 'object')
    ? order.deliveryAddress : {};
  const street       = da.street || da.streetName || da.logradouro || '';
  const streetNumber = da.number || da.streetNumber || da.numero    || '';
  const complement   = da.complement || da.complemento              || '';
  const neighborhood = da.neighborhood || da.bairro || da.district  || '';
  const city         = da.city || da.cidade                         || '';
  const reference    = da.reference || da.referencia                || '';
  const flatAddress  = order.address || '';

  const pl = order.payload || {};
  const rawPayments = Array.isArray(order.payments)              ? order.payments
    : Array.isArray(pl.paymentConfirmed)                         ? pl.paymentConfirmed
    : Array.isArray(pl.payments)                                 ? pl.payments
    : (pl.payment && typeof pl.payment === 'object')             ? [pl.payment]
    : [];

  const loja_nome = order.headerName || order.store?.name || order.storeName
    || pl.storeName || 'Delivery';

  return {
    loja_nome,
    loja_cnpj:    order.store?.cnpj || pl.storeCnpj || '',
    display_id:   order.displayId || order.id || '---',
    data:         `${pad2(createdAt.getDate())}/${pad2(createdAt.getMonth()+1)}/${createdAt.getFullYear()}`,
    hora:         `${pad2(createdAt.getHours())}:${pad2(createdAt.getMinutes())}`,
    tipo,

    cliente_nome:    order.customer?.name || order.customerName || pl.customerName || '',
    cliente_tel:     order.customer?.phone || order.customerPhone || pl.customerPhone || '',

    endereco_rua:    street || flatAddress,
    endereco_num:    streetNumber,
    endereco_comp:   complement,
    endereco_bairro: neighborhood,
    endereco_cidade: city,
    endereco_ref:    reference,
    endereco_completo: flatAddress || [street, streetNumber, complement, neighborhood, city].filter(Boolean).join(', '),

    tipo_delivery,
    endereco_rua_ok: !!(street || flatAddress),

    // Itens com complementos/opções incluídos no preço
    items: (order.items || []).map((item) => {
      const qty     = item.quantity || 1;
      const base    = _toNum(item.price);
      const optsSum = Array.isArray(item.options)
        ? item.options.reduce((s, o) => s + _toNum(o.price || 0), 0)
        : 0;
      const unit    = base + optsSum;
      const optLines = Array.isArray(item.options) && item.options.length > 0
        ? item.options.map(o => {
            const op = _toNum(o.price || 0);
            return `   + ${o.name || ''}${op > 0 ? ': R$ ' + _fmtN(op) : ''}`;
          }).join('\n')
        : '';
      return {
        qtd:        String(qty),
        nome:       item.name || item.productName || '',
        obs:        item.notes || item.observation || '',
        preco:      _fmt(unit),
        subtotal:   _fmt(unit * qty),
        tem_opcoes: !!(Array.isArray(item.options) && item.options.length > 0),
        opcoes:     optLines,
      };
    }),

    pagamentos: rawPayments.map((p) => ({
      metodo: p.method || p.name || p.tipo || p.paymentMethod || '',
      valor:  _fmt(p.value || p.amount || p.valor || 0),
    })),

    // Subtotal não existe no schema — calcular da soma dos itens
    subtotal:    _fmt((order.items || []).reduce((s, i) => {
      const u = _toNum(i.price) + (Array.isArray(i.options) ? i.options.reduce((os, o) => os + _toNum(o.price || 0), 0) : 0);
      return s + u * (i.quantity || 1);
    }, 0) || _toNum(order.subtotal)),
    taxa:        _fmt(order.deliveryFee || 0),
    desconto:    _fmt(order.discount || order.couponDiscount || 0),
    total:       _fmt(order.total),

    tem_taxa:    _toNum(order.deliveryFee) > 0,
    tem_desconto: _toNum(order.discount || order.couponDiscount) > 0,
    tem_obs:     !!(order.notes || order.observation),
    obs_pedido:  order.notes || order.observation || '',

    link_pedido: order.qrText || order.trackingUrl || '',
    tem_qr:      !!(order.qrText || order.trackingUrl),

    impressora_alias: printer?.alias || '',
  };
}

// ─── Utilitários numéricos ────────────────────────────────────────────────────
function _toNum(v) {
  if (v == null) return 0;
  const n = Number(v);
  return isFinite(n) ? n : 0;
}

/** Formata valor BRL com prefixo "R$ " (para template texto). */
function _fmt(v) {
  if (v == null) return 'R$ 0,00';
  return 'R$ ' + _toNum(v).toFixed(2).replace('.', ',');
}

/** Formata valor BRL SEM prefixo "R$ " (para template de blocos, que já tem "R$ " no texto). */
function _fmtN(v) {
  return _toNum(v).toFixed(2).replace('.', ',');
}

module.exports = { render, buildContext, buildBlockContext, processTemplate };
