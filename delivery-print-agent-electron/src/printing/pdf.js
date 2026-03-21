'use strict';
/**
 * Impressora virtual PDF para modo teste.
 *
 * Re-renderiza o pedido como texto formatado (fonte mono) em um PDF
 * que simula visualmente o papel térmico (80mm ou 58mm).
 *
 * O tamanho da fonte é calculado dinamicamente para que N colunas
 * encaixem exatamente na largura do papel — sem quebra de linha.
 */
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const logger = require('../logger');
const { buildContext, buildBlockContext, processTemplate } = require('../templateEngine');
const configManager = require('../config');
const { DEFAULT_TEMPLATE_80, DEFAULT_TEMPLATE_58 } = require('../defaultTemplate');

// Dimensões em pontos (1mm ≈ 2.835pt)
// Escala 1.3× para melhor legibilidade no PDF (não afeta impressão térmica)
const PDF_SCALE = 1.3;
const PAPER_80MM = Math.round(226 * PDF_SCALE);
const PAPER_58MM = Math.round(165 * PDF_SCALE);
const MARGIN = Math.round(8 * PDF_SCALE);

// Courier: largura de cada caractere ≈ 0.6 × fontSize
const COURIER_RATIO = 0.6;

/**
 * Calcula fontSize para que `cols` caracteres Courier caibam em `contentWidth` pt.
 */
function calcFontSize(cols, contentWidth) {
  const charWidth = contentWidth / cols;
  return charWidth / COURIER_RATIO;
}

/**
 * @param {Object} order
 * @param {Object} printer
 * @param {string} outputDir
 * @returns {Promise<string>}
 */
async function print(order, printer, outputDir) {
  const widthMm = printer.width || 80;
  const cols = widthMm === 58 ? 32 : 48;
  const pageWidth = widthMm === 58 ? PAPER_58MM : PAPER_80MM;
  const contentWidth = pageWidth - MARGIN * 2;

  // Tamanhos de fonte calculados para caber nas colunas
  const BASE_SIZE = calcFontSize(cols, contentWidth);
  const BASE_LH = BASE_SIZE * 1.35;
  // "lg" = dobro da altura → cols iguais, fonte maior verticalmente
  const LG_SIZE = BASE_SIZE * 1.4;
  const LG_LH = LG_SIZE * 1.35;
  // "xl" = dobro largura+altura → metade das colunas
  const XL_SIZE = calcFontSize(Math.floor(cols / 2), contentWidth);
  const XL_LH = XL_SIZE * 1.35;

  // Template
  const cfg = configManager.load();
  let useBlocks = false;
  let blocks = null;
  const tpl = printer.template || cfg.receiptTemplate;
  if (tpl) {
    try {
      const parsed = typeof tpl === 'string' ? JSON.parse(tpl) : tpl;
      if (parsed && parsed.v === 2 && Array.isArray(parsed.blocks)) {
        useBlocks = true;
        blocks = parsed.blocks;
      }
    } catch (_) {}
  }

  // Nome do arquivo
  const displayId = order.displayId || order.displaySimple || order.id || 'unknown';
  const ts = new Date();
  const timeStr = `${_pad(ts.getHours())}${_pad(ts.getMinutes())}${_pad(ts.getSeconds())}`;
  const filename = `pedido-${_sanitize(String(displayId))}-${timeStr}.pdf`;
  const filePath = path.join(outputDir, filename);

  // Acumular linhas primeiro, depois renderizar com altura exata
  const lines = []; // { text, font, fontSize, lineHeight, align, inverted }

  function addLine(text, opts = {}) {
    lines.push({
      text: text || '',
      font: opts.bold ? 'Courier-Bold' : 'Courier',
      fontSize: opts.fontSize || BASE_SIZE,
      lineHeight: opts.lineHeight || BASE_LH,
      align: opts.align || 'left',
      inverted: opts.inverted || false,
    });
  }

  function addSep(char) {
    addLine((char || '-').repeat(cols));
  }

  function addRow(left, right, opts = {}) {
    const pad = cols - left.length - right.length;
    const line = pad > 0 ? left + ' '.repeat(pad) + right : left + ' ' + right;
    addLine(line, opts);
  }

  function addFeed(n) {
    for (let i = 0; i < (n || 1); i++) addLine('');
  }

  // ── Gerar linhas ──────────────────────────────────────────────────────────
  if (useBlocks) {
    _renderBlockLines(blocks, order, printer, cols, addLine, addSep, addRow, addFeed,
      BASE_SIZE, BASE_LH, LG_SIZE, LG_LH, XL_SIZE, XL_LH);
  } else {
    _renderTextLines(tpl, widthMm, order, printer, cols, addLine, addSep, addRow, addFeed,
      BASE_SIZE, BASE_LH, XL_SIZE, XL_LH);
  }

  // ── Calcular altura total ─────────────────────────────────────────────────
  const totalHeight = lines.reduce((h, l) => h + l.lineHeight, 0) + MARGIN * 2 + 4;

  // ── Criar PDF com altura exata ────────────────────────────────────────────
  const doc = new PDFDocument({
    size: [pageWidth, totalHeight],
    margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
  });

  const stream = fs.createWriteStream(filePath);
  doc.pipe(stream);

  let y = MARGIN;

  for (const l of lines) {
    doc.font(l.font).fontSize(l.fontSize);

    if (l.inverted && l.text.trim()) {
      doc.save();
      doc.rect(MARGIN, y, contentWidth, l.lineHeight).fill('#333');
      doc.fillColor('#fff');
    }

    if (l.align === 'center') {
      const tw = doc.widthOfString(l.text);
      const x = MARGIN + Math.max(0, (contentWidth - tw) / 2);
      doc.text(l.text, x, y, { lineBreak: false });
    } else if (l.align === 'right') {
      const tw = doc.widthOfString(l.text);
      const x = MARGIN + Math.max(0, contentWidth - tw);
      doc.text(l.text, x, y, { lineBreak: false });
    } else {
      doc.text(l.text, MARGIN, y, { lineBreak: false });
    }

    if (l.inverted && l.text.trim()) {
      doc.fillColor('#000');
      doc.restore();
    }

    y += l.lineHeight;
  }

  doc.end();

  return new Promise((resolve, reject) => {
    stream.on('finish', () => {
      logger.info(`[pdf] PDF gerado: ${filePath}`);
      resolve(filePath);
    });
    stream.on('error', (err) => {
      logger.error(`[pdf] Erro ao gerar PDF: ${err.message}`);
      reject(err);
    });
  });
}

// ── Blocos JSON v2 → linhas ─────────────────────────────────────────────────
function _renderBlockLines(blocks, order, printer, cols, addLine, addSep, addRow, addFeed,
  BASE_SIZE, BASE_LH, LG_SIZE, LG_LH, XL_SIZE, XL_LH) {

  const ctx = buildBlockContext(order, printer);
  const pl = order.payload || {};
  const ifoodPl = pl.order || pl;

  const hasQr = blocks.some(b => b.t === 'qr');
  if (!hasQr) blocks = [...blocks, { t: 'qr' }];

  // Pagamentos
  const ifoodPmts = ifoodPl.payments || null;
  const rawPaymentsBase = Array.isArray(order.payments) ? order.payments
    : (ifoodPmts && ifoodPmts.methods && Array.isArray(ifoodPmts.methods)) ? ifoodPmts.methods
    : Array.isArray(ifoodPmts) ? ifoodPmts
    : Array.isArray(pl.paymentConfirmed) ? pl.paymentConfirmed
    : (pl.payment && typeof pl.payment === 'object') ? [pl.payment]
    : [];

  let couponVal = _toNum(order.couponDiscount || order.discount || 0);
  let couponLabel = order.couponCode ? `Voucher (${order.couponCode})` : 'Voucher Desconto';
  if (couponVal <= 0 && Array.isArray(ifoodPl.benefits) && ifoodPl.benefits.length > 0) {
    for (const b of ifoodPl.benefits) couponVal += _toNum(b.value || 0);
    const desc = ifoodPl.benefits[0]?.description || ifoodPl.benefits[0]?.title || '';
    if (desc) couponLabel = `Voucher (${desc})`;
  }
  const rawPayments = couponVal > 0
    ? [...rawPaymentsBase, { method: couponLabel, amount: couponVal }]
    : rawPaymentsBase;

  for (const block of blocks) {
    switch (block.t) {
      case 'sep':
        addSep('-');
        break;

      case 'text':
      case 'cond': {
        if (block.t === 'cond' && !ctx[block.key]) break;
        const align = block.a || 'left';
        const bold = !!block.b;
        let fontSize = BASE_SIZE, lineHeight = BASE_LH;
        if (block.s === 'xl') { fontSize = XL_SIZE; lineHeight = XL_LH; }
        else if (block.s === 'lg') { fontSize = LG_SIZE; lineHeight = LG_LH; }

        const content = _substituteVars(block.c || '', ctx);
        addLine(content, { bold, align, fontSize, lineHeight });
        break;
      }

      case 'items': {
        const ifoodRawItems = (ifoodPl.items && ifoodPl.items.length > 0) ? ifoodPl.items : null;
        const items = ifoodRawItems
          ? ifoodRawItems.map(it => ({
              name: it.name || it.productName || '',
              quantity: Number(it.quantity || 1),
              price: Number(it.unitPrice || it.price || 0),
              notes: it.observations || it.notes || '',
              options: (it.subitems || it.garnishItems || it.options || []).map(s => ({
                name: s.name || s.description || '',
                price: Number(s.unitPrice || s.price || 0),
                quantity: s.quantity != null ? Number(s.quantity) : null,
              })),
            }))
          : (order.items || []);

        for (const item of items) {
          const qty = item.quantity || 1;
          const name = item.name || item.productName || '';
          const basePrice = _toNum(item.price);
          const optsTotal = Array.isArray(item.options)
            ? item.options.reduce((s, o) => s + _toNum(o.price || 0) * (Number(o.quantity || 1)), 0) : 0;
          const itemTotal = (basePrice * qty) + (optsTotal * qty);

          addRow(`${qty}  ${name}`, _fmtN(itemTotal), { bold: true });

          if (Array.isArray(item.options)) {
            for (const opt of item.options) {
              const optPrice = _toNum(opt.price || 0);
              const oqty = Number(opt.quantity || 1);
              const totalQty = oqty * qty;
              const totalSuffix = qty > 1 ? ` (${totalQty} total)` : '';
              const line = optPrice > 0
                ? `   ${oqty}x ${opt.name}: R$ ${_fmtN(optPrice)}${totalSuffix}`
                : `   ${oqty}x ${opt.name}${totalSuffix}`;
              addLine(line);
            }
          }
          const obs = item.notes || item.observation || '';
          if (obs) addLine(`   Obs: ${obs}`);
        }
        break;
      }

      case 'payments': {
        for (const p of rawPayments) {
          const method = _paymentLabel(p);
          const value = _fmtN(_toNum(p.value || p.amount || p.valor || 0));
          // Padding interno para não encostar nas bordas do fundo invertido
          const innerCols = cols - 2;
          const padLen = innerCols - method.length - value.length;
          const paddedLine = ' ' + (padLen > 0 ? method + ' '.repeat(padLen) + value : method + ' ' + value) + ' ';
          addLine(paddedLine, { inverted: true });
        }
        break;
      }

      case 'qr': {
        const url = order.qrText || order.trackingUrl || ctx.link_pedido || '';
        if (url) {
          addLine('Rastreie seu pedido', { align: 'center' });
          addLine(url, { align: 'center', fontSize: BASE_SIZE * 0.8, lineHeight: BASE_LH * 0.8 });
        }
        break;
      }
    }
  }

  // Auto-injetar resumo de totais se nenhum bloco text/cond já renderizou subtotal ou total
  const blocksHaveTotals = blocks.some(b =>
    (b.t === 'text' || b.t === 'cond') && b.c && (b.c.includes('{{subtotal}}') || b.c.includes('{{total}}'))
  );
  if (!blocksHaveTotals) {
    addSep('-');
    addRow('Qtd itens:', ctx.total_itens_count || '0');
    addRow('Total Itens(=)', ctx.subtotal || ctx.subtotal_val || '0,00');
    addRow('Taxa entrega(+)', ctx.taxa_entrega || ctx.taxa_val || '0,00');
    addRow('Acrescimo(+)', ctx.acrescimo || ctx.acrescimo_val || '0,00');
    addRow('Desconto(-)', ctx.desconto || ctx.desconto_val || '0,00');
    addRow('TOTAL(=)', ctx.total || ctx.total_val || '0,00', { bold: true });
  }
}

// ── Template texto → linhas ─────────────────────────────────────────────────
function _renderTextLines(tpl, widthMm, order, printer, cols, addLine, addSep, addRow, addFeed,
  BASE_SIZE, BASE_LH, XL_SIZE, XL_LH) {

  const defaultTpl = widthMm === 58 ? DEFAULT_TEMPLATE_58 : DEFAULT_TEMPLATE_80;
  const template = (tpl && typeof tpl === 'string' && !tpl.trimStart().startsWith('{'))
    ? tpl : defaultTpl;
  const context = buildContext(order, printer);
  const parsed = processTemplate(template, context);

  let currentBold = false;
  let currentAlign = 'left';
  let currentFontSize = BASE_SIZE;
  let currentLineHeight = BASE_LH;
  let inverted = false;

  for (const line of parsed) {
    switch (line.type) {
      case 'text':
        addLine(line.content, {
          bold: currentBold,
          align: currentAlign,
          fontSize: currentFontSize,
          lineHeight: currentLineHeight,
          inverted,
        });
        break;
      case 'sep':
        addSep(line.char || '-');
        break;
      case 'bold':
        currentBold = line.on;
        break;
      case 'size': {
        const m = line.mult || 1;
        if (m >= 2) { currentFontSize = XL_SIZE; currentLineHeight = XL_LH; }
        else { currentFontSize = BASE_SIZE; currentLineHeight = BASE_LH; }
        break;
      }
      case 'align':
        currentAlign = line.value || 'left';
        break;
      case 'feed':
        addFeed(line.lines || 1);
        break;
      case 'invert':
        inverted = line.on;
        break;
      case 'row':
        addRow(line.left, line.right, {
          bold: currentBold,
          fontSize: currentFontSize,
          lineHeight: currentLineHeight,
        });
        break;
      case 'qr':
        addLine(line.data, { align: 'center', fontSize: BASE_SIZE * 0.8, lineHeight: BASE_LH * 0.8 });
        break;
      case 'cut':
        break;
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Resolve label da forma de pagamento com brand e sufixo "Pago Online" / "Cobrar do cliente".
 * Replica _paymentLabel() do templateEngine.js.
 */
const _PAY_MAP = {
  'CASH': 'Dinheiro', 'CREDIT': 'Credito', 'DEBIT': 'Debito',
  'CREDIT_CARD': 'Credito', 'DEBIT_CARD': 'Debito',
  'MEAL_VOUCHER': 'Vale Refeicao', 'FOOD_VOUCHER': 'Vale Alimentacao',
  'GIFT_CARD': 'Gift Card', 'PIX': 'PIX', 'PREPAID': 'Pre-pago',
  'ONLINE': 'Pago Online', 'WALLET': 'Carteira Digital', 'VOUCHER': 'Voucher',
  'DINHEIRO': 'Dinheiro', 'CREDITO': 'Credito', 'DEBITO': 'Debito',
};

function _paymentLabel(p) {
  const raw = p._systemLabel || p.method || p.name || p.tipo || p.paymentMethod || '';
  const upper = String(raw).toUpperCase().trim();

  if (upper.includes('VOUCHER')) return raw;

  let label = _PAY_MAP[upper] || null;
  if (!label) {
    for (const [k, v] of Object.entries(_PAY_MAP)) {
      if (upper.startsWith(k)) { label = v; break; }
    }
  }
  if (!label) label = raw;

  const brand = p.card?.brand;
  if (brand) label += ` ${brand}`;

  const isPrepaid = p.prepaid === true || String(p.type || '').toUpperCase() === 'ONLINE';
  label += isPrepaid ? ' (pago online)' : ' (cobrar do cliente)';

  return label;
}

function _substituteVars(str, ctx) {
  return str.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (_, key) => {
    const val = key.split('.').reduce((o, k) => (o != null ? o[k] : undefined), ctx);
    return val !== undefined && val !== null ? String(val) : '';
  });
}

function _toNum(v) {
  if (v == null) return 0;
  const n = Number(v);
  return isFinite(n) ? n : 0;
}

function _fmtN(v) {
  return _toNum(v).toFixed(2).replace('.', ',');
}

function _pad(n) {
  return String(n).padStart(2, '0');
}

function _sanitize(s) {
  return s.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 30);
}

module.exports = { print };
