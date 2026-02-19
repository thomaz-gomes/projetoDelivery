'use strict';
/**
 * Construtor de comandos ESC/POS puros (sem dependência de bibliotecas externas).
 *
 * Suporte:
 *  - Inicialização / configuração de densidade
 *  - Codepage (PC850 para PT-BR, UTF-8 para impressoras modernas)
 *  - Alinhamento, negrito, tamanho de fonte
 *  - Texto com encoding correto
 *  - Linha separadora
 *  - Corte de papel (parcial / total)
 *  - QR Code nativo ESC/POS (GS ( k)
 *  - Avança papel (feed)
 */
const iconv = require('iconv-lite');

// ─── Constantes ESC/POS ───────────────────────────────────────────────────────
const ESC = 0x1B;
const GS  = 0x1D;
const FS  = 0x1C;
const LF  = 0x0A;

// Codepages suportados pelo comando ESC t
const CODEPAGES = {
  PC437:  0,   // USA / Standard Europe
  PC850:  2,   // Multilingual (Western Europe / PT-BR)
  PC860:  6,   // Portuguese
  PC863:  7,   // Canadian-French
  PC865:  8,   // Nordic
  WIN1252:16,  // Windows-1252 (Western Europe)
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
/**
 * Converte string para Buffer com encoding correto.
 * PC850 é o codepage mais compatível com impressoras térmicas para PT-BR.
 */
function encodeText(text, charset) {
  if (!text) return Buffer.alloc(0);
  const str = String(text);
  if (charset === 'UTF8') {
    return Buffer.from(str, 'utf8');
  }
  // Padrão: PC850 (suporta ã, ç, ê, ó, etc.)
  try {
    return iconv.encode(str, 'CP850');
  } catch (_) {
    return Buffer.from(str, 'latin1');
  }
}

function buf(...bytes) {
  return Buffer.from(bytes.flat());
}

// ─── API Pública ─────────────────────────────────────────────────────────────
const ESCPos = {
  /**
   * ESC @ — Inicializa a impressora (reseta configurações).
   */
  init() {
    return buf([ESC, 0x40]);
  },

  /**
   * Seleciona codepage ESC t n.
   * @param {'PC850'|'PC437'|'WIN1252'} charset
   */
  codepage(charset) {
    const n = CODEPAGES[charset] ?? CODEPAGES.PC850;
    return buf([ESC, 0x74, n]);
  },

  /**
   * Configura densidade de impressão (calor da cabeça térmica).
   * ESC 7 n1 n2 n3
   *  n1 = max heat dots (0-255), n2 = heating time (0-255), n3 = heating interval (0-255)
   * density: 0–15 → mapeado para n2 (heating time)
   * Quanto maior o n2, mais escuro imprime.
   */
  density(level) {
    // level: 0-15
    const n2 = Math.min(255, Math.max(0, (level || 8) * 10 + 80)); // ~80-230 µs
    return buf([ESC, 0x37, 7, n2, 2]);
  },

  /**
   * ESC a n — Justificação: 0=esquerda, 1=centro, 2=direita.
   */
  align(alignment) {
    const n = { left: 0, center: 1, right: 2 }[alignment] ?? 0;
    return buf([ESC, 0x61, n]);
  },

  /**
   * ESC E n — Negrito: 1=on, 0=off.
   */
  bold(on) {
    return buf([ESC, 0x45, on ? 1 : 0]);
  },

  /**
   * ESC ! n — Modo de impressão combinado.
   * Bit 3: bold, Bit 4: double height, Bit 5: double width
   * Bit 0: fonte B (menor)
   */
  printMode(opts) {
    let n = 0;
    if (opts.bold)        n |= 0x08;
    if (opts.doubleH)     n |= 0x10;
    if (opts.doubleW)     n |= 0x20;
    if (opts.smallFont)   n |= 0x01;
    return buf([ESC, 0x21, n]);
  },

  /**
   * GS ! n — Tamanho do caractere.
   * Nibble alto: altura (0=1x, 1=2x, ..., 7=8x)
   * Nibble baixo: largura (0=1x, ..., 7=8x)
   */
  charSize(widthMult, heightMult) {
    const w = Math.min(7, Math.max(0, (widthMult || 1) - 1));
    const h = Math.min(7, Math.max(0, (heightMult || 1) - 1));
    return buf([GS, 0x21, (h << 4) | w]);
  },

  /**
   * ESC 2 — Espaçamento de linha padrão.
   */
  lineSpacingDefault() {
    return buf([ESC, 0x32]);
  },

  /**
   * ESC 3 n — Espaçamento de linha em dots (1/180").
   */
  lineSpacing(dots) {
    return buf([ESC, 0x33, dots & 0xFF]);
  },

  /**
   * LF — Avanço de linha.
   */
  feed(lines) {
    const n = lines || 1;
    return Buffer.alloc(n, LF);
  },

  /**
   * ESC d n — Avanço de n linhas e retorna ao início.
   */
  feedLines(n) {
    return buf([ESC, 0x64, n & 0xFF]);
  },

  /**
   * Texto puro com encoding.
   * @param {string} text
   * @param {'PC850'|'UTF8'} charset
   */
  text(text, charset) {
    return encodeText(text + '\n', charset);
  },

  /**
   * Texto sem LF no final.
   */
  textRaw(text, charset) {
    return encodeText(text, charset);
  },

  /**
   * Margem esquerda via espaços.
   * @param {number} cols  número de colunas de margem
   */
  marginLeft(cols) {
    if (!cols) return Buffer.alloc(0);
    return Buffer.alloc(cols, 0x20); // espaços
  },

  /**
   * Linha separadora.
   * @param {number} width  largura em colunas (32 para 58mm, 48 para 80mm)
   * @param {string} char   caractere (padrão: '-')
   */
  separator(width, char) {
    return Buffer.from((char || '-').repeat(width) + '\n');
  },

  /**
   * GS V — Corte de papel.
   * @param {'full'|'partial'} type
   */
  cut(type) {
    const m = type === 'full' ? 0x41 : 0x42; // 65=full, 66=partial(1 ponto)
    return buf([GS, 0x56, m, 0]);
  },

  /**
   * QR Code via GS ( k
   * @param {string} data     URL ou texto para o QR
   * @param {number} size     módulo (2-8)
   * @param {number} ecLevel  nível de correção 1(L), 2(M), 3(Q), 4(H)
   */
  qrCode(data, size, ecLevel) {
    const qrData = Buffer.from(data, 'utf8');
    const dataLen = qrData.length + 3;
    const pL = dataLen & 0xFF;
    const pH = (dataLen >> 8) & 0xFF;
    const moduleSize = size || 4;
    const ec = ecLevel || 1;

    return Buffer.concat([
      // Model: GS ( k pL pH cn fn n
      buf([GS, 0x28, 0x6B, 4, 0, 0x31, 0x41, 0x32, 0x00]),
      // Size: GS ( k 3 0 cn 43 n
      buf([GS, 0x28, 0x6B, 3, 0, 0x31, 0x43, moduleSize]),
      // Error correction: GS ( k 3 0 cn 45 n
      buf([GS, 0x28, 0x6B, 3, 0, 0x31, 0x45, ec]),
      // Store data: GS ( k pL pH cn fn [data]
      buf([GS, 0x28, 0x6B, pL, pH, 0x31, 0x50, 0x30]),
      qrData,
      // Print: GS ( k 3 0 cn 51 m
      buf([GS, 0x28, 0x6B, 3, 0, 0x31, 0x51, 0x30]),
    ]);
  },

  /**
   * Largura em colunas para um papel.
   */
  columnsForWidth(widthMm) {
    return widthMm === 58 ? 32 : 48;
  },
};

module.exports = ESCPos;
