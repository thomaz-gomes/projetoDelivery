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
  const colsA   = printer.columns || ESCPos.columnsForWidth(widthMm);
  const colsB   = printer.fontBColumns || ESCPos.columnsForFont(widthMm, 'B');
  const margin  = printer.marginLeft || 0;

  const header = [
    ESCPos.init(),
    ESCPos.codepage(charset),
    ESCPos.density(printer.density ?? 8),
    ESCPos.lineSpacingDefault(),
    ESCPos.font('A'), // garante reset para Font A no início
    ESCPos.charSize(1, 1),
  ];

  // Verificar se o template LOCAL do agente (printer.template) é formato JSON v2
  // NOTA: order.receiptTemplate (JSON v2 do banco) é IGNORADO — usar sempre o template texto padrão
  if (printer.template) {
    try {
      const parsed = JSON.parse(printer.template);
      if (parsed && parsed.v === 2 && Array.isArray(parsed.blocks)) {
        return _renderBlocks(parsed.blocks, order, printer, header, colsA, margin, charset);
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

  let curWidthMult = 1;  // multiplicador de LARGURA ativo (altura NÃO afeta colunas)
  let curFont      = 'A'; // fonte ativa: A=base, B=mais estreita

  /** Colunas úteis no momento atual, considerando font e size. */
  const effectiveCols = () => {
    const base = curFont === 'B' ? colsB : colsA;
    return Math.floor((base - margin) / curWidthMult);
  };

  for (const line of lines) {
    if (line.type === 'text') {
      const textCols = effectiveCols();
      const textLines = line.content.split('\n');
      for (const tl of textLines) {
        if (tl.length <= textCols) {
          if (margin > 0) parts.push(ESCPos.marginLeft(margin));
          parts.push(ESCPos.text(tl, charset));
        } else {
          const indent = _autoIndentForLine(tl);
          const wrapped = _wrapLinesWithIndent(tl, textCols, indent);
          for (const wl of wrapped) {
            if (margin > 0) parts.push(ESCPos.marginLeft(margin));
            parts.push(ESCPos.text(wl, charset));
          }
        }
      }
    } else if (line.type === 'sep') {
      parts.push(ESCPos.align('left'));
      parts.push(ESCPos.separator(effectiveCols(), line.char || '-'));
    } else if (line.type === 'bold') {
      parts.push(ESCPos.bold(line.on));
    } else if (line.type === 'size') {
      const w = line.w || line.mult || 1;
      const h = line.h || line.mult || 1;
      // Apenas a LARGURA dobrada reduz colunas. Altura dupla (h>=2, w=1) NÃO reduz.
      curWidthMult = Math.max(1, w);
      parts.push(ESCPos.charSize(w, h));
    } else if (line.type === 'font') {
      curFont = String(line.value || 'A').toUpperCase() === 'B' ? 'B' : 'A';
      parts.push(ESCPos.font(curFont));
    } else if (line.type === 'align') {
      parts.push(ESCPos.align(line.value));
    } else if (line.type === 'feed') {
      parts.push(ESCPos.feed(line.lines));
    } else if (line.type === 'invert') {
      parts.push(ESCPos.invert(line.on));
    } else if (line.type === 'row') {
      const rowIndent = _autoIndentForRowLeft(line.left);
      parts.push(..._rowWithWrap(line.left, line.right, effectiveCols(), margin, charset, rowIndent));
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

// ─── Helper: ROW com word-wrap (reutilizado em blocos e template texto) ───────
/**
 * Gera buffers ESC/POS para uma linha left|right.
 * Cada linha emitida tem EXATAMENTE effCols caracteres (padded com espaços),
 * garantindo que a impressora nunca faça wrap no hardware.
 *
 * Se left+right não cabem: trunca left por palavras, preço fixo na 1ª linha,
 * continuação indentada nas linhas seguintes (sem preço).
 */
function _rowWithWrap(left, right, effCols, margin, charset, indent) {
  const bufs = [];
  const minGap = 1;
  const indentN  = indent || 0;
  const maxFirst = effCols - right.length - minGap;
  const contMax  = Math.max(1, effCols - indentN);
  const indentStr = indentN > 0 ? ' '.repeat(indentN) : '';

  /** Emite uma linha com EXATAMENTE effCols chars (pad com espaços). */
  function emit(text) {
    const padded = text.length < effCols ? text + ' '.repeat(effCols - text.length) : text.slice(0, effCols);
    if (margin > 0) bufs.push(ESCPos.marginLeft(margin));
    bufs.push(ESCPos.text(padded, charset));
  }

  if (maxFirst <= 0) {
    // Não cabe de jeito nenhum: emite o `left` em múltiplas linhas e o `right` sozinho no fim
    let rest = left;
    while (rest.length > 0) {
      const { chunk, consumed } = _wordBreakSmart(rest, effCols);
      rest = rest.slice(consumed).trimStart();
      emit(chunk);
    }
    emit(' '.repeat(effCols - right.length) + right);
  } else if (left.length <= maxFirst) {
    // Cabe numa linha
    const padN = effCols - left.length - right.length;
    emit(left + ' '.repeat(padN) + right);
  } else {
    // Trunca por palavras — preço fixo na 1ª linha
    const first = _wordBreakSmart(left, maxFirst);
    let rest = left.slice(first.consumed).trimStart();
    const firstPad = effCols - first.chunk.length - right.length;
    emit(first.chunk + ' '.repeat(firstPad) + right);

    // Linhas de continuação (indentadas, sem preço, cada uma exatamente effCols)
    while (rest.length > 0) {
      const { chunk, consumed } = _wordBreakSmart(rest, contMax);
      rest = rest.slice(consumed).trimStart();
      emit(indentStr + chunk);
    }
  }
  return bufs;
}

/** Quebra texto no último espaço antes de maxWidth, ou em maxWidth se não houver espaço. */
function _wordBreak(text, maxWidth) {
  if (text.length <= maxWidth) return text;
  const breakAt = text.lastIndexOf(' ', maxWidth);
  return breakAt > 0 ? text.slice(0, breakAt) : text.slice(0, maxWidth);
}

/**
 * Versão "smart" do word-break: retorna { chunk, consumed }.
 *  - chunk    = string a ser impressa (pode incluir '-' final em quebra forçada)
 *  - consumed = quantos chars do texto original foram consumidos (sem contar o '-' adicionado)
 *
 * Regras:
 *   - Se cabe inteiro: chunk = texto, consumed = texto.length
 *   - Se há espaço antes de maxWidth: corta no espaço, consumed = posição do espaço
 *   - Senão (palavra única > maxWidth): corta em maxWidth-1 e adiciona '-' como sinal de continuação
 */
function _wordBreakSmart(text, maxWidth) {
  if (!text) return { chunk: '', consumed: 0 };
  if (text.length <= maxWidth) return { chunk: text, consumed: text.length };
  const breakAt = text.lastIndexOf(' ', maxWidth);
  if (breakAt > 0) return { chunk: text.slice(0, breakAt), consumed: breakAt };
  if (maxWidth > 3) {
    const cutAt = maxWidth - 1;
    return { chunk: text.slice(0, cutAt) + '-', consumed: cutAt };
  }
  return { chunk: text.slice(0, maxWidth), consumed: maxWidth };
}

/**
 * Quebra texto em múltiplas linhas respeitando largura, com indent opcional
 * nas linhas a partir da 2ª. Força quebra com hífen quando palavra única excede.
 *
 * @param {string} text
 * @param {number} maxWidth   largura da 1ª linha
 * @param {number} indent     número de espaços de indent para 2ª linha em diante (0 = sem indent)
 * @returns {string[]} array de linhas (cada uma <= maxWidth chars)
 */
function _wrapLinesWithIndent(text, maxWidth, indent) {
  if (!text) return [''];
  if (text.length <= maxWidth) return [text];
  const indentN  = indent || 0;
  const contMax  = Math.max(1, maxWidth - indentN);
  const indentStr = indentN > 0 ? ' '.repeat(indentN) : '';
  const lines = [];
  let rest = text;
  let first = true;
  while (rest.length > 0) {
    const width = first ? maxWidth : contMax;
    const { chunk, consumed } = _wordBreakSmart(rest, width);
    lines.push(first ? chunk : indentStr + chunk);
    rest = rest.slice(consumed).trimStart();
    first = false;
  }
  return lines;
}

/**
 * Detecta o indent ideal para continuação da linha, em ordem:
 *   1) "Label: " → posição depois do ": "
 *   2) "  Nx Item" ou "1  Item" → posição depois do prefixo de quantidade
 *   3) "   ** obs **" → posição depois dos asteriscos
 *   4) Espaços iniciais → preservar como indent mínimo
 * Limitado a 16 chars para evitar indents absurdos.
 */
function _autoIndentForLine(line) {
  if (!line) return 0;
  const cap = (n) => (n > 0 && n <= 16) ? n : 0;

  // 1) "CLIENTE: " / "Obs: " / "Ref: " — com até ~14 chars antes do ":"
  const labelM = line.match(/^( *)([A-Za-zÀ-ÿ.()][A-Za-zÀ-ÿ.() ]{0,14}:)\s/);
  if (labelM) {
    const n = labelM[1].length + labelM[2].length + 1;
    if (n > 0 && n <= 16) return n;
  }

  // 2) "2  Item" / "1x Item" / "   3x Item"
  const qtyM = line.match(/^( *)(\d+x?\s+)/);
  if (qtyM) {
    const n = qtyM[1].length + qtyM[2].length;
    if (n > 0 && n <= 16) return n;
  }

  // 3) "   ** obs **"
  const astM = line.match(/^( *)(\*\*\s+)/);
  if (astM) {
    const n = astM[1].length + astM[2].length;
    if (n > 0 && n <= 16) return n;
  }

  // 4) Espaços iniciais
  const leading = line.match(/^ */)[0].length;
  return cap(leading);
}

/** Versão de `_autoIndentForLine` para o lado esquerdo de uma row (sem labels). */
function _autoIndentForRowLeft(left) {
  if (!left) return 0;
  const m = left.match(/^( *)(\d+x?\s+)/);
  if (m) {
    const n = m[1].length + m[2].length;
    if (n > 0 && n <= 16) return n;
  }
  return 0;
}

// ─── Renderizador de blocos JSON (formato do painel) ──────────────────────────
function _renderBlocks(blocks, order, printer, header, cols, margin, charset) {
  // Garantir que o bloco QR existe — templates salvos antes da feature não o incluem
  const hasQrBlock = blocks.some(b => b.t === 'qr' || b.type === 'qr');
  if (!hasQrBlock) {
    blocks = [...blocks, { t: 'qr' }];
  }

  const pl  = order.payload || {};
  // iFood: desempacotar envelope { order: { ... } } ou usar payload direto
  const ifoodPl = pl.order || pl;

  // Recalcular subtotal usando a MESMA fonte de itens que será exibida (payload iFood se disponível, senão DB)
  // Evita divergência quando DB tem totalPrice antigo mas payload tem unitPrice correto
  const ifoodRawItemsForCalc = (ifoodPl.items && ifoodPl.items.length > 0) ? ifoodPl.items : null;
  let calcSubtotal = 0;
  if (ifoodRawItemsForCalc) {
    for (const it of ifoodRawItemsForCalc) {
      const qty = Number(it.quantity || 1);
      const base = Number(it.unitPrice || it.price || 0);
      const opts = (it.subitems || it.garnishItems || it.options || [])
        .reduce((s, o) => s + Number(o.unitPrice || o.price || 0) * Number(o.quantity || 1), 0);
      calcSubtotal += (base * qty) + (opts * qty);
    }
  } else {
    for (const it of (order.items || [])) {
      const qty = it.quantity || 1;
      const base = _toNum(it.price) * qty;
      const opts = Array.isArray(it.options)
        ? it.options.reduce((s, o) => s + _toNum(o.price || 0) * Number(o.quantity || 1), 0) * qty
        : 0;
      calcSubtotal += base + opts;
    }
  }

  const ctx = buildBlockContext(order, printer);
  // Sobrescrever subtotal com o valor recalculado da fonte correta
  if (calcSubtotal > 0) ctx.subtotal = _fmtN(calcSubtotal);

  // Extrai pagamentos — iFood usa { methods: [], prepaid } dentro de ifoodPl.payments
  const ifoodPmts = ifoodPl.payments || null;
  const rawPaymentsBase = Array.isArray(order.payments)                               ? order.payments
    : (ifoodPmts && ifoodPmts.methods && Array.isArray(ifoodPmts.methods))            ? ifoodPmts.methods
    : Array.isArray(ifoodPmts)                                                        ? ifoodPmts
    : Array.isArray(pl.paymentConfirmed)                                              ? pl.paymentConfirmed
    : (pl.payment && typeof pl.payment === 'object')                                  ? [pl.payment]
    : [];

  // Adicionar vouchers como formas de pagamento, separando por sponsor:
  // - iFood/marketplace: "Voucher iFood" (iFood repassa à loja)
  // - Loja: "Voucher Loja" (loja absorve)
  const voucherPayments = [];
  const discIfood   = _toNum(order.discountIfood || 0);
  const discMerch   = _toNum(order.discountMerchant || 0);

  if (discIfood > 0 || discMerch > 0) {
    // Dados separados por sponsor (novo formato)
    if (discIfood > 0)  voucherPayments.push({ method: 'Voucher iFood', amount: discIfood, _systemLabel: 'Voucher iFood' });
    if (discMerch > 0)  voucherPayments.push({ method: 'Voucher Loja', amount: discMerch, _systemLabel: 'Voucher Loja' });
  } else {
    // Fallback: extrair do couponDiscount ou benefits (sem separação por sponsor)
    let couponVal = _toNum(order.couponDiscount || order.discount || 0);
    let couponLabel = order.couponCode ? `Voucher (${order.couponCode})` : 'Voucher Desconto';
    if (couponVal <= 0 && Array.isArray(ifoodPl.benefits) && ifoodPl.benefits.length > 0) {
      // Tentar separar por sponsorshipValues do payload
      let ifVal = 0, merchVal = 0;
      for (const b of ifoodPl.benefits) {
        const bVal = _toNum(b.value || 0);
        if (Array.isArray(b.sponsorshipValues)) {
          for (const sv of b.sponsorshipValues) {
            const svVal = _toNum(sv.value || sv.amount || 0);
            const name = String(sv.name || '').toUpperCase();
            if (name === 'MERCHANT') merchVal += svVal;
            else ifVal += svVal;
          }
        } else {
          ifVal += bVal;
        }
        couponVal += bVal;
      }
      const desc = ifoodPl.benefits[0]?.description || ifoodPl.benefits[0]?.title || '';
      if (ifVal > 0 && merchVal > 0) {
        voucherPayments.push({ method: 'Voucher iFood', amount: ifVal, _systemLabel: 'Voucher iFood' });
        voucherPayments.push({ method: 'Voucher Loja', amount: merchVal, _systemLabel: 'Voucher Loja' });
      } else if (couponVal > 0) {
        if (desc) couponLabel = `Voucher (${desc})`;
        voucherPayments.push({ method: couponLabel, amount: couponVal, _systemLabel: couponLabel });
      }
    } else if (couponVal > 0) {
      voucherPayments.push({ method: couponLabel, amount: couponVal, _systemLabel: couponLabel });
    }
  }

  const rawPayments = [...rawPaymentsBase, ...voucherPayments];

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
        // Apenas 'xl' (largura+altura dobradas) reduz colunas. 'lg' é só altura — colunas inalteradas.
        const wMult = (block.s === 'xl') ? 2 : 1;
        const textCols = Math.floor((cols - margin) / wMult);

        // Quebrar conteúdo em linhas que cabem na largura da impressora,
        // detectando prefixo de label para indentar continuação ("CLIENTE: João da Silva...")
        const rawLines = content.split('\n');
        for (const rawLine of rawLines) {
          if (rawLine.length <= textCols) {
            if (margin > 0) parts.push(ESCPos.marginLeft(margin));
            parts.push(ESCPos.text(rawLine, charset));
          } else {
            const indent = _autoIndentForLine(rawLine);
            const wrapped = _wrapLinesWithIndent(rawLine, textCols, indent);
            for (const wl of wrapped) {
              if (margin > 0) parts.push(ESCPos.marginLeft(margin));
              parts.push(ESCPos.text(wl, charset));
            }
          }
        }

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

        // Tamanho — bloco tem prioridade, senão usa printer.itemNameSize/itemOptionSize
        const rawNameSize = block.itemNameSize || printer.itemNameSize || null;
        const rawOptSize  = block.itemOptionSize || printer.itemOptionSize || null;
        const nameSize = rawNameSize ? _parseSize(rawNameSize) : null;
        const optSize  = rawOptSize  ? _parseSize(rawOptSize) : null;
        let curItemW = 1; // multiplicador de largura ativo

        for (const item of items) {
          const qty  = item.quantity || 1;
          const name = item.name || item.productName || '';

          // Preço: item.price × qty + SUM(opt.price × opt.qty) × qty
          const basePrice  = _toNum(item.price);
          const optsTotal  = Array.isArray(item.options)
            ? item.options.reduce((s, o) => s + _toNum(o.price || 0) * (Number(o.quantity || 1)), 0)
            : 0;
          const itemTotal  = (basePrice * qty) + (optsTotal * qty);
          const priceVal   = _fmtN(itemTotal);

          // Nome do item em SIZE configurado, quebra limpa por palavras
          if (nameSize) {
            parts.push(ESCPos.charSize(nameSize.w, nameSize.h));
            curItemW = Math.max(1, nameSize.w);
          }
          parts.push(ESCPos.bold(true));
          const nameCols = Math.floor((cols - margin) / curItemW);
          const qtyPrefix = `${qty}x  `;
          const fullName = qtyPrefix + name;
          const nameIndent = _autoIndentForLine(fullName);
          const nameWrapped = _wrapLinesWithIndent(fullName, nameCols, nameIndent);
          for (const nl of nameWrapped) {
            if (margin > 0) parts.push(ESCPos.marginLeft(margin));
            parts.push(ESCPos.text(nl, charset));
          }
          parts.push(ESCPos.bold(false));
          // Preço à direita usando align nativo — sem padding manual
          parts.push(ESCPos.charSize(1, 1));
          parts.push(ESCPos.align('right'));
          if (margin > 0) parts.push(ESCPos.marginLeft(margin));
          parts.push(ESCPos.text(priceVal, charset));
          parts.push(ESCPos.align('left'));

          // Complementos imediatamente após o nome (sem espaço entre eles)
          if (optSize) {
            parts.push(ESCPos.charSize(optSize.w, optSize.h));
            curItemW = Math.max(1, optSize.w);
          } else if (nameSize) {
            parts.push(ESCPos.charSize(1, 1));
            curItemW = 1;
          }
          const optCols = Math.floor((cols - margin) / curItemW);

          if (Array.isArray(item.options) && item.options.length > 0) {
            const optIndent = 3;
            const optPrefix = ' '.repeat(optIndent);
            const maxOpt    = Math.max(1, optCols - optIndent);
            for (const opt of item.options) {
              const optName  = opt.name || '';
              const oqty     = Number(opt.quantity || 1);
              const optText = `${oqty}x ${optName}`;
              let rest = optText;
              while (rest.length > 0) {
                const { chunk, consumed } = _wordBreakSmart(rest, maxOpt);
                rest = rest.slice(consumed).trimStart();
                const raw = optPrefix + chunk;
                const padded = raw.length < optCols ? raw + ' '.repeat(optCols - raw.length) : raw.slice(0, optCols);
                if (margin > 0) parts.push(ESCPos.marginLeft(margin));
                parts.push(ESCPos.text(padded, charset));
              }
            }
          }

          const obs = item.notes || item.observation || '';
          if (obs) {
            const obsText = `   ** ${obs} **`;
            const obsPad = obsText.length < optCols ? obsText + ' '.repeat(optCols - obsText.length) : obsText.slice(0, optCols);
            if (margin > 0) parts.push(ESCPos.marginLeft(margin));
            parts.push(ESCPos.text(obsPad, charset));
          }

          // Linha em branco entre itens
          parts.push(ESCPos.feed(2));
        }
        // Reset SIZE se alterou
        if (nameSize || optSize) parts.push(ESCPos.charSize(1, 1));
        break;
      }

      case 'payments': {
        // Tamanho da fonte configurável: normal, lg (2x altura), xl (2x largura+altura)
        const pSize = block.paymentSize || 'normal';
        // Sempre setar charSize explícito para garantir reset (evita herdar tamanho de bloco anterior)
        if (pSize === 'xl')      parts.push(ESCPos.charSize(2, 2));
        else if (pSize === 'lg') parts.push(ESCPos.charSize(1, 2));
        else                     parts.push(ESCPos.charSize(1, 1));

        // Colunas efetivas: apenas 'xl' (largura+altura) reduz cols. 'lg' é só altura.
        const payCols = (pSize === 'xl') ? Math.floor((cols - margin) / 2) : (cols - margin);

        parts.push(ESCPos.invert(true));
        for (const p of rawPayments) {
          const method = _paymentLabel(p);
          const value  = _fmtN(_toNum(p.value || p.amount || p.valor || 0));
          const inner = payCols - 2;
          const maxMethod = Math.max(1, inner - value.length - 1);
          let truncMethod, rest;
          if (method.length > maxMethod) {
            const sb = _wordBreakSmart(method, maxMethod);
            truncMethod = sb.chunk;
            rest = method.slice(sb.consumed).trimStart();
          } else {
            truncMethod = method;
            rest = '';
          }
          const pad1 = inner - truncMethod.length - value.length;
          const line1 = ' ' + truncMethod + ' '.repeat(Math.max(pad1, 1)) + value + ' ';
          const padded1 = line1.length < payCols ? line1 + ' '.repeat(payCols - line1.length) : line1.slice(0, payCols);
          if (margin > 0) parts.push(ESCPos.marginLeft(margin));
          parts.push(ESCPos.text(padded1, charset));
          // Linhas de continuação para method com várias quebras (cont máxima = inner - 1 char indent)
          while (rest.length > 0) {
            const { chunk, consumed } = _wordBreakSmart(rest, Math.max(1, inner - 1));
            rest = rest.slice(consumed).trimStart();
            const line2 = '  ' + chunk; // 1 char de invert margin + 1 char indent
            const padded2 = line2.length < payCols ? line2 + ' '.repeat(payCols - line2.length) : line2.slice(0, payCols);
            if (margin > 0) parts.push(ESCPos.marginLeft(margin));
            parts.push(ESCPos.text(padded2, charset));
          }
        }
        parts.push(ESCPos.invert(false));

        // Reset tamanho
        if (pSize !== 'normal') {
          parts.push(ESCPos.charSize(1, 1));
        }

        // Troco (se pagamento em dinheiro com changeFor)
        const trocoVal = _toNum(ctx.troco_raw);
        if (trocoVal > 0) {
          if (margin > 0) parts.push(ESCPos.marginLeft(margin));
          parts.push(ESCPos.bold(true));
          parts.push(ESCPos.text(`Troco para R$ ${_fmtN(trocoVal)}`, charset));
          parts.push(ESCPos.bold(false));
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

  // Auto-injetar resumo de totais se nenhum bloco text/cond já renderizou subtotal ou total
  const blocksHaveTotals = blocks.some(b =>
    (b.t === 'text' || b.t === 'cond') && b.c && (b.c.includes('{{subtotal}}') || b.c.includes('{{total}}'))
  );

  const totalCols = cols - margin;
  const _row = (label, val) => {
    const pad = totalCols - label.length - val.length;
    const line = pad > 0 ? label + ' '.repeat(pad) + val : label + ' ' + val;
    if (margin > 0) parts.push(ESCPos.marginLeft(margin));
    parts.push(ESCPos.text(line, charset));
  };

  if (!blocksHaveTotals) {
    parts.push(ESCPos.align('left'));
    parts.push(ESCPos.separator(totalCols, '-'));

    _row('Qtd itens:', ctx.total_itens_count || '0');
    _row('Total Itens(=)', ctx.subtotal || '0,00');
    _row('Taxa entrega(+)', ctx.taxa_entrega || ctx.taxa_val || '0,00');
    _row('Taxa serviço', ctx.acrescimo || ctx.acrescimo_val || '0,00');
    _row('Desconto(-)', ctx.desconto || ctx.desconto_val || '0,00');
    parts.push(ESCPos.bold(true));
    _row('TOTAL FATURADO', ctx.total || ctx.total_val || '0,00');
    parts.push(ESCPos.bold(false));
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
  // Extrair campos individuais + montar endereço multilinha completo.
  let endereco_cliente = '';
  let end_rua = '', end_numero = '', end_complemento = '', end_bairro = '';
  let end_cidade = '', end_referencia = '', end_cep = '';
  try {
    const pl = order.payload || {};
    const _ip = pl.order || pl;
    const da = (_ip.delivery && _ip.delivery.deliveryAddress)
            || _ip.delivery
            || pl.deliveryAddress
            || order.deliveryAddress;

    if (da && typeof da === 'object') {
      end_rua         = da.streetName || da.street || da.logradouro || '';
      end_numero      = da.streetNumber || da.number || da.numero || '';
      end_complemento = da.complement || da.complemento || '';
      end_bairro      = da.neighborhood || da.bairro || '';
      end_cidade      = da.city || da.cidade || '';
      end_referencia  = da.reference || da.referencia || '';
      end_cep         = da.postalCode || da.zipCode || da.cep || '';

      if (end_rua || end_numero) {
        const lines = [];
        lines.push(end_rua + (end_numero ? ', ' + end_numero : ''));
        if (end_complemento) lines.push('Compl: ' + end_complemento);
        if (end_bairro) lines.push('Bairro: ' + end_bairro);
        if (end_cidade) lines.push(end_cidade);
        if (end_referencia) lines.push('Ref: ' + end_referencia);
        endereco_cliente = lines.join('\n');
      }
    } else if (da && typeof da === 'string' && da !== '-') {
      endereco_cliente = da;
    }

    // Fallback: order.address (string flat do DB)
    if (!endereco_cliente && order.address && typeof order.address === 'string' && order.address !== '-') {
      endereco_cliente = order.address;
    }

    // Fallback: deliveryNeighborhood
    if (!endereco_cliente && order.deliveryNeighborhood) {
      endereco_cliente = order.deliveryNeighborhood;
    }

    // Fallback adicional: rawPayload.address
    if (!endereco_cliente) {
      const raw = pl.rawPayload && pl.rawPayload.address;
      if (raw && typeof raw === 'string' && raw !== '-') {
        endereco_cliente = raw;
      } else if (raw && typeof raw === 'object') {
        endereco_cliente = _buildMultilineAddress(raw, '');
      }
    }
  } catch (_) { /* ignore */ }

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

  // iFood: campos específicos (localizador, código de coleta)
  const _plBc = order.payload || {};
  const _ifBc = _plBc.order || _plBc;

  // Taxas adicionais (taxa de serviço iFood, etc.)
  const acrescimoVal = _toNum(order.additionalFees ?? _ifBc.total?.additionalFees ?? 0);
  // Total faturado = cliente pagou + iFood repassa - taxa serviço retida pelo iFood
  const discIfoodValBc = _toNum(order.discountIfood || 0);
  const totalVal    = _toNum(order.total) + discIfoodValBc - acrescimoVal;
  const localizadorBc   = _ifBc.customer?.phones?.[0]?.localizer || _ifBc.customer?.phone?.localizer || '';
  const codigo_coleta = _ifBc.delivery?.pickupCode || '';

  // Data curta: "07/mar - 13:21"
  const mesesBc = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
  const horaBc = `${pad2(createdAt.getHours())}:${pad2(createdAt.getMinutes())}`;

  return {
    header_name:       order.headerName || order.store?.name || order.storeName || 'Delivery',
    header_city:       order.headerCity || '',
    display_id:        _padDisplay(order.displaySimple ?? order.displayId ?? order.id),
    data_pedido:       `${pad2(createdAt.getDate())}/${pad2(createdAt.getMonth()+1)}/${createdAt.getFullYear()}`,
    data_curta:        `${pad2(createdAt.getDate())}/${mesesBc[createdAt.getMonth()]} - ${horaBc}`,
    hora_pedido:       horaBc,
    tipo_pedido:       `${tipo_pedido} #${_padDisplay(order.displaySimple ?? order.displayId ?? order.id)}`,
    nome_cliente:      order.customer?.name || order.customerName || '',
    telefone_cliente:  order.customer?.phone || order.customerPhone || '',
    endereco_cliente,
    end_rua,
    end_numero,
    end_complemento,
    end_bairro,
    end_cidade,
    end_referencia,
    end_cep,
    subtotal:          subtotalVal > 0  ? _fmtN(subtotalVal)  : '0,00',
    taxa_entrega:      _fmtN(taxaVal),
    acrescimo:         _fmtN(acrescimoVal),
    acrescimo_val:     acrescimoVal > 0 ? _fmtN(acrescimoVal) : '',
    desconto:          _fmtN(descontoVal),
    total:             totalVal > 0     ? _fmtN(totalVal)     : '0,00',
    observacoes:       order.notes || order.observation || '',
    total_itens_count: String((order.items || []).reduce((s, i) => s + (i.quantity || 1), 0)),
    localizador:       localizadorBc,
    localizador_suffix: localizadorBc ? `, Localizador: ${localizadorBc}` : '',
    codigo_coleta,
    loc_coleta:        [localizadorBc ? `Loc: ${localizadorBc}` : '', codigo_coleta ? `Coleta: ${codigo_coleta}` : ''].filter(Boolean).join('  '),
    link_pedido:       _resolveQrUrl(order, tipo_pedido),

    // Canal combinado e salesChannel separado
    canal: order.canal || order.source || order.channel || _plBc.source || '',
    sales_channel: _resolveSalesChannel(order, _plBc),

    // Troco (changeFor) — extraído pelo enrichOrderForAgent
    troco_raw:         _toNum(order.payment?.changeFor || order.changeFor || _ifBc.payments?.methods?.find(m => m.cash)?.cash?.changeFor || 0),
    troco:             _fmtN(_toNum(order.payment?.changeFor || order.changeFor || _ifBc.payments?.methods?.find(m => m.cash)?.cash?.changeFor || 0)),
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
  } else if (/^\[SIZE:(\d)x(\d)\]$/i.test(trimmed)) {
    const match = trimmed.match(/\[SIZE:(\d)x(\d)\]/i);
    result.push({ type: 'size', w: parseInt(match[1]), h: parseInt(match[2]) });
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
  } else if (/^\[FONT:([AB])\]$/i.test(trimmed)) {
    const v = trimmed.match(/\[FONT:([AB])\]/i)[1].toUpperCase();
    result.push({ type: 'font', value: v });
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
  const acrescimoVal = _toNum(order.additionalFees ?? ifoodPl.total?.additionalFees ?? 0);
  let descontoVal = _toNum(order.discount || order.couponDiscount || 0);
  // Fallback: extrair desconto dos benefits do iFood
  if (descontoVal <= 0 && Array.isArray(ifoodPl.benefits) && ifoodPl.benefits.length > 0) {
    for (const b of ifoodPl.benefits) descontoVal += _toNum(b.value || 0);
  }
  // Total faturado = cliente pagou + iFood repassa - taxa serviço retida pelo iFood
  const discIfoodVal = _toNum(order.discountIfood || 0);
  const totalVal    = _toNum(order.total) + discIfoodVal - acrescimoVal;

  return {
    loja_nome,
    loja_cnpj:    order.store?.cnpj || pl.storeCnpj || '',
    display_id:   _padDisplay(order.displaySimple ?? order.displayId ?? order.id),
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
    endereco_completo: _buildMultilineAddress(da, flatAddress),

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
            const oqty = Number(o.quantity || 1);
            return `   ${oqty}x ${o.name || ''}`;
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
        metodo: _paymentLabel(p),
        valor:  _fmt(p.value || p.amount || p.valor || 0),
        valor_num: _fmtN(p.value || p.amount || p.valor || 0),
      })),
      // Vouchers separados por sponsor
      ..._buildVoucherPayments(order, ifoodPl).map(v => ({
        metodo: v.method,
        valor: _fmt(v.amount),
        valor_num: _fmtN(v.amount),
      })),
    ],

    // Subtotal com e sem prefixo "R$ "
    subtotal:     _fmt(subtotalVal),
    subtotal_val: _fmtN(subtotalVal),
    taxa:         _fmt(taxaVal),
    taxa_val:     _fmtN(taxaVal),
    acrescimo:    _fmt(acrescimoVal),
    acrescimo_val: _fmtN(acrescimoVal),
    desconto:     _fmt(descontoVal),
    desconto_val: _fmtN(descontoVal),
    total:        _fmt(totalVal),
    total_val:    _fmtN(totalVal),

    tem_taxa:    true,
    tem_desconto: true,
    tem_obs:     !!(order.notes || order.observation),
    obs_pedido:  order.notes || order.observation || '',

    link_pedido: _resolveQrUrl(order, tipo),
    tem_qr:      !!_resolveQrUrl(order, tipo),

    // iFood: campos específicos
    localizador:   localizador_bc,
    localizador_suffix,
    codigo_coleta: ifoodPl.delivery?.pickupCode || '',
    loc_coleta:    [localizador_bc ? `Loc: ${localizador_bc}` : '', (ifoodPl.delivery?.pickupCode) ? `Coleta: ${ifoodPl.delivery.pickupCode}` : ''].filter(Boolean).join('  '),

    // Canal combinado e salesChannel separado
    canal: order.canal || order.source || order.channel || pl.source || '',
    sales_channel: _resolveSalesChannel(order, pl),

    // Contagem total de itens (unidades)
    total_itens_count: String(totalItensCount),

    impressora_alias: printer?.alias || '',

    // Troco (changeFor) — extraído pelo enrichOrderForAgent
    troco_raw:  _toNum(order.payment?.changeFor || order.changeFor || ifoodPl.payments?.methods?.find(m => m.cash)?.cash?.changeFor || 0),
    troco:      _fmtN(_toNum(order.payment?.changeFor || order.changeFor || ifoodPl.payments?.methods?.find(m => m.cash)?.cash?.changeFor || 0)),
    tem_troco:  _toNum(order.payment?.changeFor || order.changeFor || 0) > 0,

    // Tamanhos configuráveis — resolvem para diretivas [SIZE:WxH] no template
    // printer.itemNameSize / printer.itemOptionSize: "1x2", "2", "1" etc.
    size_item_nome:  `[SIZE:${printer?.itemNameSize || '1x2'}]`,
    size_item_opcao: `[SIZE:${printer?.itemOptionSize || '1x2'}]`,
  };
}

// ─── Utilitários de pagamento ─────────────────────────────────────────────────
const PAY_METHOD_MAP = {
  'CASH': 'Dinheiro', 'CREDIT': 'Credito', 'DEBIT': 'Debito',
  'CREDIT_CARD': 'Credito', 'DEBIT_CARD': 'Debito',
  'MEAL_VOUCHER': 'Vale Refeicao', 'FOOD_VOUCHER': 'Vale Alimentacao',
  'GIFT_CARD': 'Gift Card', 'PIX': 'PIX', 'PREPAID': 'Pre-pago',
  'ONLINE': 'Pago Online', 'WALLET': 'Carteira Digital', 'VOUCHER': 'Voucher',
  'DINHEIRO': 'Dinheiro', 'CREDITO': 'Credito', 'DEBITO': 'Debito',
};

/**
 * Resolve label da forma de pagamento no mesmo formato da tela de detalhes:
 *   "Credito VISA (pago online)", "Dinheiro (cobrar do cliente)", "Voucher desconto"
 */
function _paymentLabel(p) {
  const raw = p._systemLabel || p.method || p.name || p.tipo || p.paymentMethod || '';
  const upper = String(raw).toUpperCase().trim();

  // Voucher/desconto não precisa de sufixo
  if (upper.includes('VOUCHER')) return raw;

  // Traduzir método
  let label = PAY_METHOD_MAP[upper] || null;
  if (!label) {
    for (const [k, v] of Object.entries(PAY_METHOD_MAP)) {
      if (upper.startsWith(k)) { label = v; break; }
    }
  }
  if (!label) label = raw;

  // Adicionar bandeira do cartão (VISA, MASTERCARD, etc.)
  const brand = p.card?.brand;
  if (brand) label += ` ${brand}`;

  // Sufixo: (pago online) ou (cobrar do cliente)
  const isPrepaid = p.prepaid === true || String(p.type || '').toUpperCase() === 'ONLINE';
  label += isPrepaid ? ' (pago online)' : ' (cobrar do cliente)';

  return label;
}

// ─── Utilitários de voucher ───────────────────────────────────────────────────
/** Monta array de vouchers como pagamentos, separando iFood vs Loja quando possível. */
function _buildVoucherPayments(order, ifoodPl) {
  const result = [];
  const discIfood = _toNum(order.discountIfood || 0);
  const discMerch = _toNum(order.discountMerchant || 0);

  if (discIfood > 0 || discMerch > 0) {
    if (discIfood > 0)  result.push({ method: 'Voucher iFood', amount: discIfood, _systemLabel: 'Voucher iFood' });
    if (discMerch > 0)  result.push({ method: 'Voucher Loja', amount: discMerch, _systemLabel: 'Voucher Loja' });
    return result;
  }

  // Fallback: extrair do couponDiscount ou benefits
  let couponVal = _toNum(order.couponDiscount || order.discount || 0);
  if (couponVal <= 0 && Array.isArray(ifoodPl?.benefits) && ifoodPl.benefits.length > 0) {
    let ifVal = 0, merchVal = 0;
    for (const b of ifoodPl.benefits) {
      couponVal += _toNum(b.value || 0);
      if (Array.isArray(b.sponsorshipValues)) {
        for (const sv of b.sponsorshipValues) {
          const svVal = _toNum(sv.value || sv.amount || 0);
          if (String(sv.name || '').toUpperCase() === 'MERCHANT') merchVal += svVal;
          else ifVal += svVal;
        }
      }
    }
    if (ifVal > 0 && merchVal > 0) {
      result.push({ method: 'Voucher iFood', amount: ifVal, _systemLabel: 'Voucher iFood' });
      result.push({ method: 'Voucher Loja', amount: merchVal, _systemLabel: 'Voucher Loja' });
      return result;
    }
  }

  if (couponVal > 0) {
    const label = order.couponCode ? `Voucher (${order.couponCode})`
      : (ifoodPl?.benefits?.[0]?.description || ifoodPl?.benefits?.[0]?.title)
        ? `Voucher (${ifoodPl.benefits[0].description || ifoodPl.benefits[0].title})`
        : 'Voucher Desconto';
    result.push({ method: label, amount: couponVal, _systemLabel: label });
  }
  return result;
}

// ─── Utilitários de endereço ──────────────────────────────────────────────────
/** Monta endereço multilinha a partir do objeto deliveryAddress ou fallback flat. */
function _buildMultilineAddress(da, flatAddress) {
  if (!da || typeof da !== 'object' || Object.keys(da).length === 0) return flatAddress || '';
  const street = da.streetName || da.street || da.logradouro || '';
  const num    = da.streetNumber || da.number || da.numero || '';
  if (!street && !num) return flatAddress || '';
  const lines = [];
  lines.push(street + (num ? ', ' + num : ''));
  const comp = da.complement || da.complemento || '';
  if (comp) lines.push('Compl: ' + comp);
  const bairro = da.neighborhood || da.bairro || da.district || '';
  if (bairro) lines.push('Bairro: ' + bairro);
  const city = da.city || da.cidade || '';
  if (city) lines.push(city);
  const ref = da.reference || da.referencia || '';
  if (ref) lines.push('Ref: ' + ref);
  return lines.join('\n');
}

// ─── Utilitários de canal ─────────────────────────────────────────────────────
/** Resolve salesChannel: "iFood", "PDV", "WhatsApp", etc. */
function _resolveSalesChannel(order, pl) {
  const ip = (pl && pl.order) || pl || {};
  if (ip.merchant || ip.salesChannel === 'IFOOD' || String(ip.salesChannel || '').toUpperCase() === 'IFOOD') return 'iFood';
  const raw = pl?.rawPayload?.source || pl?.source || order.source || '';
  if (raw) return String(raw);
  return '';
}

// ─── Utilitários de display ───────────────────────────────────────────────────
/** Formata displaySimple com padding de 2 dígitos: 3 → "03", 12 → "12". */
function _padDisplay(v) {
  if (v == null) return '---';
  const n = Number(v);
  if (isFinite(n) && n > 0) return String(n).padStart(2, '0');
  return String(v);
}

// ─── Utilitários de tamanho ───────────────────────────────────────────────────
/** Parseia "1x2", "2", "1" → { w, h }. Padrão: { w: 1, h: 1 }. */
function _parseSize(s) {
  if (!s) return { w: 1, h: 1 };
  const str = String(s).toLowerCase();
  const m = str.match(/^(\d)x(\d)$/);
  if (m) return { w: parseInt(m[1]), h: parseInt(m[2]) };
  const n = parseInt(str);
  return isFinite(n) && n > 0 ? { w: n, h: n } : { w: 1, h: 1 };
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
