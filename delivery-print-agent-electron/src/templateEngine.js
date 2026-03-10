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
 * Prioridade: printer.template (local) > defaultTemplate (texto)
 * NOTA: order.receiptTemplate (JSON v2 do banco) é ignorado para usar o template texto padrão
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
    ESCPos.printMode({ bold: false, doubleH: false, doubleW: false, smallFont: false }), // Font A padrão
    ESCPos.charSize(1, 1),
  ];

  // Verificar se o template LOCAL do agente (printer.template) é formato JSON v2
  // NOTA: order.receiptTemplate (JSON v2 do banco) é IGNORADO — usar sempre o template texto padrão
  if (printer.template) {
    try {
      const parsed = JSON.parse(printer.template);
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
    } else if (line.type === 'invert') {
      parts.push(ESCPos.invert(line.on));
    } else if (line.type === 'row') {
      const total = cols - margin;
      const left = line.left;
      const right = line.right;
      const pad = total - left.length - right.length;
      const formatted = pad > 0 ? left + ' '.repeat(pad) + right : left + ' ' + right;
      if (margin > 0) parts.push(ESCPos.marginLeft(margin));
      parts.push(ESCPos.text(formatted, charset));
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
  // Garantir que o bloco QR existe — templates salvos antes da feature não o incluem
  const hasQrBlock = blocks.some(b => b.t === 'qr' || b.type === 'qr');
  if (!hasQrBlock) {
    blocks = [...blocks, { t: 'qr' }];
  }

  const ctx = buildBlockContext(order, printer);
  const pl  = order.payload || {};
  // iFood: desempacotar envelope { order: { ... } } ou usar payload direto
  const ifoodPl = pl.order || pl;

  // Extrai pagamentos — iFood usa { methods: [], prepaid } dentro de ifoodPl.payments
  const ifoodPmts = ifoodPl.payments || null;
  const rawPaymentsBase = Array.isArray(order.payments)                               ? order.payments
    : (ifoodPmts && ifoodPmts.methods && Array.isArray(ifoodPmts.methods))            ? ifoodPmts.methods
    : Array.isArray(ifoodPmts)                                                        ? ifoodPmts
    : Array.isArray(pl.paymentConfirmed)                                              ? pl.paymentConfirmed
    : (pl.payment && typeof pl.payment === 'object')                                  ? [pl.payment]
    : [];

  // Adicionar cupom/voucher como forma de pagamento se houver desconto
  // Tentar: order.couponDiscount > order.discount > iFood benefits
  let couponVal = _toNum(order.couponDiscount || order.discount || 0);
  let couponLabel = order.couponCode ? `Voucher (${order.couponCode})` : 'Voucher Desconto';

  // Fallback: extrair desconto dos benefits do iFood (quando couponDiscount não está no order)
  if (couponVal <= 0 && Array.isArray(ifoodPl.benefits) && ifoodPl.benefits.length > 0) {
    for (const b of ifoodPl.benefits) {
      couponVal += _toNum(b.value || 0);
    }
    const desc = ifoodPl.benefits[0]?.description || ifoodPl.benefits[0]?.title || '';
    if (desc) couponLabel = `Voucher (${desc})`;
  }

  logger.info('[tpl] voucher debug', {
    couponDiscount: order.couponDiscount, discount: order.discount,
    couponCode: order.couponCode, couponVal,
    benefits: ifoodPl.benefits,
  });

  const rawPayments = couponVal > 0
    ? [...rawPaymentsBase, { method: couponLabel, amount: couponVal }]
    : rawPaymentsBase;

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
        // Preferir itens ricos do iFood (têm subitems/opções) sobre itens do DB (sem complementos)
        const ifoodRawItems = (ifoodPl.items && ifoodPl.items.length > 0) ? ifoodPl.items : null;
        const items = ifoodRawItems
          ? ifoodRawItems.map(it => ({
              name:     it.name || it.productName || '',
              quantity: Number(it.quantity || 1),
              price:    Number(it.unitPrice || it.price || 0),
              notes:    it.observations || it.notes || '',
              options:  (it.subitems || it.garnishItems || it.options || []).map(s => ({
                name:     s.name || s.description || '',
                price:    Number(s.unitPrice || s.price || 0),
                quantity: s.quantity != null ? Number(s.quantity) : null,
              })),
            }))
          : (order.items || []);

        for (const item of items) {
          const qty  = item.quantity || 1;
          const name = item.name || item.productName || '';

          // Preço: item.price × qty + SUM(opt.price × opt.qty) × qty  (mesmo cálculo do SaleDetails.vue)
          const basePrice  = _toNum(item.price);
          const optsTotal  = Array.isArray(item.options)
            ? item.options.reduce((s, o) => s + _toNum(o.price || 0) * (Number(o.quantity || 1)), 0)
            : 0;
          const itemTotal  = (basePrice * qty) + (optsTotal * qty);
          const priceVal   = _fmtN(itemTotal);

          // Linha do item: nome à esquerda, preço à direita (ROW)
          parts.push(ESCPos.bold(true));
          const leftText  = `${qty}  ${name}`;
          const rightText = priceVal;
          const totalCols = cols - margin;
          const padLen    = totalCols - leftText.length - rightText.length;
          const rowLine   = padLen > 0 ? leftText + ' '.repeat(padLen) + rightText : leftText + ' ' + rightText;
          if (margin > 0) parts.push(ESCPos.marginLeft(margin));
          parts.push(ESCPos.text(rowLine, charset));
          parts.push(ESCPos.bold(false));

          // Complementos / opções do item (exibe preço unitário da opção, como no SaleDetails.vue)
          if (Array.isArray(item.options) && item.options.length > 0) {
            for (const opt of item.options) {
              const optName  = opt.name || '';
              const optPrice = _toNum(opt.price || 0);
              const oqty     = Number(opt.quantity || 1);
              let optLine;
              if (oqty > 1) {
                optLine = optPrice > 0
                  ? `   -${oqty}x ${optName}: R$ ${_fmtN(optPrice)}`
                  : `   -${oqty}x ${optName}`;
              } else {
                optLine = optPrice > 0
                  ? `   + ${optName}: R$ ${_fmtN(optPrice)}`
                  : `   + ${optName}`;
              }
              if (margin > 0) parts.push(ESCPos.marginLeft(margin));
              parts.push(ESCPos.text(optLine, charset));
            }
          }

          const obs = item.notes || item.observation || '';
          if (obs) {
            if (margin > 0) parts.push(ESCPos.marginLeft(margin));
            parts.push(ESCPos.text(`   Obs: ${obs}`, charset));
          }
        }
        break;
      }

      case 'payments': {
        // Tamanho da fonte configurável: normal, lg (2x altura), xl (2x largura+altura)
        const pSize = block.paymentSize || 'normal';
        if (pSize === 'xl')      parts.push(ESCPos.charSize(2, 2));
        else if (pSize === 'lg') parts.push(ESCPos.charSize(1, 2));

        // Colunas efetivas (se fonte dobrada em largura, metade das colunas)
        const payCols = pSize === 'xl' ? Math.floor((cols - margin) / 2) : (cols - margin);

        parts.push(ESCPos.invert(true));
        for (const p of rawPayments) {
          const method = p.method || p.name || p.tipo || p.paymentMethod || '';
          const value  = _fmtN(_toNum(p.value || p.amount || p.valor || 0));
          const padLen    = payCols - method.length - value.length;
          const rowLine   = padLen > 0 ? method + ' '.repeat(padLen) + value : method + ' ' + value;
          if (margin > 0) parts.push(ESCPos.marginLeft(margin));
          parts.push(ESCPos.text(rowLine, charset));
        }
        parts.push(ESCPos.invert(false));

        // Reset tamanho
        if (pSize !== 'normal') {
          parts.push(ESCPos.charSize(1, 1));
        }
        break;
      }

      case 'qr': {
        const url = order.qrText || order.trackingUrl || ctx.link_pedido || '';
        if (url) {
          parts.push(ESCPos.align('center'));
          parts.push(ESCPos.qrCode(url, 7, 1));
          parts.push(ESCPos.text('Rastreie seu pedido', charset));
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
      // iFood: desempacotar envelope { order: { delivery: {...} } } ou usar payload direto
      const _ip = pl.order || pl;
      const da = (_ip.delivery && _ip.delivery.deliveryAddress)
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
  // Mesmo cálculo do SaleDetails.vue: item.price × qty + SUM(opt.price × opt.qty) × qty
  const itemsTotal = (order.items || []).reduce((s, i) => {
    const qty = i.quantity || 1;
    const base = _toNum(i.price) * qty;
    const optsTotal = Array.isArray(i.options)
      ? i.options.reduce((os, o) => os + _toNum(o.price || 0) * Number(o.quantity || 1), 0) * qty
      : 0;
    return s + base + optsTotal;
  }, 0);

  const taxaVal     = _toNum(order.deliveryFee || 0);
  const descontoVal = _toNum(order.discount || order.couponDiscount || 0);
  const subtotalVal = _toNum(order.subtotal) || itemsTotal;
  const totalVal    = _toNum(order.total);

  // iFood: campos específicos (localizador, código de coleta)
  const _plBc = order.payload || {};
  const _ifBc = _plBc.order || _plBc;
  const localizadorBc   = _ifBc.customer?.phones?.[0]?.localizer || _ifBc.customer?.phone?.localizer || '';
  const codigo_coleta = _ifBc.delivery?.pickupCode || '';

  // Data curta: "07/mar - 13:21"
  const mesesBc = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
  const horaBc = `${pad2(createdAt.getHours())}:${pad2(createdAt.getMinutes())}`;

  return {
    header_name:       order.headerName || order.store?.name || order.storeName || 'Delivery',
    header_city:       order.headerCity || '',
    display_id:        String(order.displayId || order.displaySimple || order.id || '---'),
    data_pedido:       `${pad2(createdAt.getDate())}/${pad2(createdAt.getMonth()+1)}/${createdAt.getFullYear()}`,
    data_curta:        `${pad2(createdAt.getDate())}/${mesesBc[createdAt.getMonth()]} - ${horaBc}`,
    hora_pedido:       horaBc,
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
    localizador:       localizadorBc,
    localizador_suffix: localizadorBc ? `, Localizador: ${localizadorBc}` : '',
    codigo_coleta,
    link_pedido:       _resolveQrUrl(order, tipo_pedido),
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

function resolveIfBlocks(tmpl, ctx) {
  let prev;
  do {
    prev = tmpl;
    tmpl = tmpl.replace(/\{\{#if (\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (_, key, body) => {
      return ctx[key] ? body : '';
    });
  } while (tmpl !== prev);
  return tmpl;
}

function resolveBlocks(tmpl, ctx) {
  // {{#each array}} ... {{/each}} — resolve {{#if}} aninhado com contexto do item
  tmpl = tmpl.replace(/\{\{#each (\w+)\}\}([\s\S]*?)\{\{\/each\}\}/g, (_, key, body) => {
    const arr = ctx[key];
    if (!Array.isArray(arr) || arr.length === 0) return '';
    return arr.map((item) => {
      const merged = { ...ctx, ...item };
      const resolved = resolveIfBlocks(body, merged);
      return substituteVars(resolved, merged);
    }).join('');
  });

  // {{#if key}} ... {{/if}} — iterativo para suportar aninhamento
  tmpl = resolveIfBlocks(tmpl, ctx);

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
  } else if (trimmed === '[SEP:- ]') {
    result.push({ type: 'sep', char: '- ' });
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
  } else if (/^\[INV:(on|off)\]$/i.test(trimmed)) {
    result.push({ type: 'invert', on: trimmed.toLowerCase().includes('on') });
  } else if (/^\[ROW:(.+)\]$/.test(trimmed)) {
    const content = trimmed.match(/^\[ROW:(.+)\]$/)[1];
    const lastPipe = content.lastIndexOf('|');
    if (lastPipe > 0) {
      result.push({ type: 'row', left: content.slice(0, lastPipe), right: content.slice(lastPipe + 1) });
    } else {
      result.push({ type: 'text', content: content });
    }
  } else if (/^\[QR:(.+)\]$/.test(trimmed)) {
    const data = trimmed.match(/^\[QR:(.+)\]$/)[1].trim();
    if (data) result.push({ type: 'qr', data });
  } else {
    result.push({ type: 'text', content: trimmed });
  }

  return result;
}

// ─── QR Code URL ─────────────────────────────────────────────────────────────
/**
 * Resolve QR code URL: ordem direta > payload > fallback gerado.
 * Para pedidos DELIVERY sem URL, gera automaticamente {frontendUrl}/orders/{id}.
 */
function _resolveQrUrl(order, tipo) {
  const pl = order.payload || {};
  const ifPl = pl.order || pl;
  const url = order.qrText || order.trackingUrl || pl.qrText || ifPl.qrText || order.qrUrl || '';
  if (url) {
    logger.info('[QR] url encontrada', { url });
    return url;
  }

  // Fallback: gerar URL se pedido DELIVERY
  const isPickup = ['RETIRADA', 'PICKUP', 'TAKEOUT', 'MESA', 'INDOOR'].includes(String(tipo).toUpperCase());
  if (!isPickup && order.id) {
    const fe = order.frontendUrl || (process.env.PUBLIC_FRONTEND_URL || process.env.FRONTEND_URL || '').replace(/\/$/, '');
    if (fe) {
      const fallbackUrl = `${fe}/orders/${order.id}`;
      logger.info('[QR] fallback gerado', { url: fallbackUrl });
      return fallbackUrl;
    }
    logger.warn('[QR] sem URL: frontendUrl ausente', {
      orderId: order.id,
      frontendUrl: order.frontendUrl || null,
      env_PUBLIC: process.env.PUBLIC_FRONTEND_URL || null,
      env_FRONTEND: process.env.FRONTEND_URL || null,
    });
  }
  return '';
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
  // iFood: desempacotar envelope { order: { ... } } ou usar payload direto
  const ifoodPl = pl.order || pl;
  // iFood pagamentos: { methods: [], prepaid }
  const ifoodPmtsBc = ifoodPl.payments || null;
  const rawPayments = Array.isArray(order.payments)                                        ? order.payments
    : (ifoodPmtsBc && ifoodPmtsBc.methods && Array.isArray(ifoodPmtsBc.methods))           ? ifoodPmtsBc.methods
    : Array.isArray(ifoodPmtsBc)                                                           ? ifoodPmtsBc
    : Array.isArray(pl.paymentConfirmed)                                                   ? pl.paymentConfirmed
    : (pl.payment && typeof pl.payment === 'object')                                       ? [pl.payment]
    : [];

  const loja_nome = order.headerName || order.store?.name || order.storeName
    || pl.storeName || 'Delivery';

  // Cálculo de total de itens (contagem de unidades)
  const totalItensCount = (order.items || []).reduce((s, i) => s + (i.quantity || 1), 0);

  // Data curta: "07/mar - 13:21"
  const meses = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
  const hora = `${pad2(createdAt.getHours())}:${pad2(createdAt.getMinutes())}`;
  const data_curta = `${pad2(createdAt.getDate())}/${meses[createdAt.getMonth()]} - ${hora}`;

  // Localizador suffix para linha combinada com telefone
  const localizador_bc = ifoodPl.customer?.phones?.[0]?.localizer || ifoodPl.customer?.phone?.localizer || '';
  const localizador_suffix = localizador_bc ? `, Localizador: ${localizador_bc}` : '';

  // Totais numéricos — mesmo cálculo do SaleDetails.vue
  const subtotalVal = _toNum(order.subtotal) || (order.items || []).reduce((s, i) => {
    const qty = i.quantity || 1;
    const base = _toNum(i.price) * qty;
    const opts = Array.isArray(i.options)
      ? i.options.reduce((os, o) => os + _toNum(o.price || 0) * Number(o.quantity || 1), 0) * qty
      : 0;
    return s + base + opts;
  }, 0);
  const taxaVal     = _toNum(order.deliveryFee || 0);
  let descontoVal = _toNum(order.discount || order.couponDiscount || 0);
  // Fallback: extrair desconto dos benefits do iFood
  if (descontoVal <= 0 && Array.isArray(ifoodPl.benefits) && ifoodPl.benefits.length > 0) {
    for (const b of ifoodPl.benefits) descontoVal += _toNum(b.value || 0);
  }
  const totalVal    = _toNum(order.total);

  return {
    loja_nome,
    loja_cnpj:    order.store?.cnpj || pl.storeCnpj || '',
    display_id:   order.displayId || order.id || '---',
    data:         `${pad2(createdAt.getDate())}/${pad2(createdAt.getMonth()+1)}/${createdAt.getFullYear()}`,
    data_curta,
    hora,
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
    // Mesmo cálculo do SaleDetails.vue: item.price × qty + SUM(opt.price × opt.qty) × qty
    items: (order.items || []).map((item) => {
      const qty     = item.quantity || 1;
      const base    = _toNum(item.price);
      const optsSum = Array.isArray(item.options)
        ? item.options.reduce((s, o) => s + _toNum(o.price || 0) * Number(o.quantity || 1), 0)
        : 0;
      const itemTotal = (base * qty) + (optsSum * qty);
      const optLines = Array.isArray(item.options) && item.options.length > 0
        ? item.options.map(o => {
            const op   = _toNum(o.price || 0);
            const oqty = Number(o.quantity || 1);
            if (oqty > 1) {
              return `   -${oqty}x ${o.name || ''}${op > 0 ? ': R$ ' + _fmtN(op) : ''}`;
            }
            return `   + ${o.name || ''}${op > 0 ? ': R$ ' + _fmtN(op) : ''}`;
          }).join('\n')
        : '';
      return {
        qtd:        String(qty),
        nome:       item.name || item.productName || '',
        obs:        item.notes || item.observation || '',
        preco:      _fmt(base + optsSum),
        preco_val:  _fmtN(itemTotal),
        subtotal:   _fmt(itemTotal),
        tem_opcoes: !!(Array.isArray(item.options) && item.options.length > 0),
        opcoes:     optLines,
      };
    }),

    pagamentos: [
      // Pagamentos normais
      ...rawPayments.map((p) => ({
        metodo: p.method || p.name || p.tipo || p.paymentMethod || '',
        valor:  _fmt(p.value || p.amount || p.valor || 0),
        valor_num: _fmtN(p.value || p.amount || p.valor || 0),
      })),
      // Cupom/voucher como forma de pagamento (se houver desconto)
      ...(descontoVal > 0 ? [{
        metodo: order.couponCode ? `Voucher (${order.couponCode})`
          : (ifoodPl.benefits?.[0]?.description || ifoodPl.benefits?.[0]?.title)
            ? `Voucher (${ifoodPl.benefits[0].description || ifoodPl.benefits[0].title})`
            : 'Voucher Desconto',
        valor:  _fmt(descontoVal),
        valor_num: _fmtN(descontoVal),
      }] : []),
    ],

    // Subtotal com e sem prefixo "R$ "
    subtotal:     _fmt(subtotalVal),
    subtotal_val: _fmtN(subtotalVal),
    taxa:         _fmt(taxaVal),
    taxa_val:     _fmtN(taxaVal),
    desconto:     _fmt(descontoVal),
    desconto_val: _fmtN(descontoVal),
    total:        _fmt(totalVal),
    total_val:    _fmtN(totalVal),

    tem_taxa:    taxaVal > 0,
    tem_desconto: descontoVal > 0,
    tem_obs:     !!(order.notes || order.observation),
    obs_pedido:  order.notes || order.observation || '',

    link_pedido: _resolveQrUrl(order, tipo),
    tem_qr:      !!_resolveQrUrl(order, tipo),

    // iFood: campos específicos
    localizador:   localizador_bc,
    localizador_suffix,
    codigo_coleta: ifoodPl.delivery?.pickupCode || '',

    // Canal/operador (ex: IFOOD, WHATSAPP, SISTEMA)
    canal: order.source || order.channel || order.canal || pl.source || '',

    // Contagem total de itens (unidades)
    total_itens_count: String(totalItensCount),

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
