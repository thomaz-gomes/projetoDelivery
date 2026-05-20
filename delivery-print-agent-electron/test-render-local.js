'use strict';
/**
 * test-render-local.js — Roda o templateEngine localmente (sem hardware) e
 * decodifica o buffer ESC/POS de volta para texto legível.
 *
 * Uso:
 *   node test-render-local.js                  # roda todos os cenários
 *   node test-render-local.js --width=58       # força 58mm
 *   node test-render-local.js --case=longname  # roda só um cenário
 */

// Mock simples para o logger antes de carregar templateEngine
const Module = require('module');
const path = require('path');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === './logger' && parent && parent.filename && parent.filename.includes('templateEngine')) {
    return path.resolve(__dirname, 'src/logger.js');
  }
  return origResolve.call(this, request, parent, ...rest);
};

const iconv = require('iconv-lite');
const { render } = require('./src/templateEngine');

// ─── Decoder ESC/POS → texto ─────────────────────────────────────────────────
/**
 * Lê o buffer ESC/POS e devolve string com:
 *  - texto imprimível em CP850 → UTF-8
 *  - LF (0x0A) preservado
 *  - comandos ESC/GS/FS ignorados (pula bytes de dados conforme tabela)
 *  - QR Code (GS ( k) substituído por marcador "[QR]"
 *  - corte (GS V) substituído por separador visual
 */
function decodeEscPos(buf) {
  const out = [];
  let i = 0;
  while (i < buf.length) {
    const b = buf[i];

    if (b === 0x1B) { // ESC
      const cmd = buf[i + 1];
      const skip = escDataBytes(cmd);
      i += 2 + skip;
      continue;
    }

    if (b === 0x1D) { // GS
      const cmd = buf[i + 1];
      if (cmd === 0x28) { // GS ( k — bloco de QR
        // Layout: GS ( k pL pH cn fn [data]
        const pL = buf[i + 3] || 0;
        const pH = buf[i + 4] || 0;
        const dataLen = pL + (pH << 8);
        // Se for o bloco de "store data" (fn=0x50), insere marcador
        if (buf[i + 6] === 0x50) {
          out.push('[QR Code aqui]\n');
        }
        i += 5 + dataLen;
        continue;
      }
      if (cmd === 0x56) { // GS V — cut
        out.push('-- corte de papel --\n');
        i += 4;
        continue;
      }
      const skip = gsDataBytes(cmd);
      i += 2 + skip;
      continue;
    }

    if (b === 0x1C) { // FS
      // FS é raro no nosso código; pular 2 bytes por segurança
      i += 2;
      continue;
    }

    if (b === 0x0A) {
      out.push('\n');
      i++;
      continue;
    }

    if (b === 0x0D) { // CR — ignora
      i++;
      continue;
    }

    if (b >= 0x20 && b <= 0x7E) {
      out.push(String.fromCharCode(b));
      i++;
      continue;
    }

    if (b >= 0x80) {
      // Tenta decodificar como CP850 (1 byte)
      try {
        out.push(iconv.decode(Buffer.from([b]), 'CP850'));
      } catch (_) {
        out.push('?');
      }
      i++;
      continue;
    }

    // Byte de controle desconhecido — pular
    i++;
  }
  return out.join('');
}

function escDataBytes(cmd) {
  switch (cmd) {
    case 0x40: return 0;  // @ init
    case 0x74: return 1;  // t codepage
    case 0x37: return 3;  // 7 density
    case 0x61: return 1;  // a align
    case 0x45: return 1;  // E bold
    case 0x21: return 1;  // ! print mode
    case 0x32: return 0;  // 2 line spacing default
    case 0x33: return 1;  // 3 line spacing
    case 0x52: return 1;  // R char table
    case 0x64: return 1;  // d feed lines
    case 0x4A: return 1;  // J feed pixels
    case 0x4B: return 1;  // K
    case 0x70: return 4;  // p pulse
    default:   return 1;  // desconhecido — pular 1 por segurança
  }
}

function gsDataBytes(cmd) {
  switch (cmd) {
    case 0x21: return 1;  // ! char size
    case 0x42: return 1;  // B invert
    case 0x4C: return 2;  // L left margin
    case 0x57: return 2;  // W print area width
    case 0x56: return 2;  // V cut (caso não tratado acima)
    case 0x66: return 2;  // f
    case 0x68: return 1;  // h
    case 0x77: return 1;  // w barcode
    case 0x6B: return 0;  // k barcode (terminado por NUL)
    default:   return 1;
  }
}

// ─── Helpers para visualizar quebras ─────────────────────────────────────────
function withRuler(text, cols) {
  const ruler = '·'.repeat(cols);
  const tens  = Array.from({ length: cols }, (_, i) => (i % 10 === 9) ? '|' : ' ').join('');
  return `${tens}\n${ruler}\n${text}\n${ruler}`;
}

// ─── Cenários de teste ───────────────────────────────────────────────────────
function baseOrder() {
  return {
    id: 'test-001',
    displaySimple: 47,
    createdAt: new Date('2026-05-12T13:21:00'),
    orderType: 'delivery',
    headerName: 'Restaurante Cantinho da Esquina',
    headerCity: 'Salvador - BA',
    customer: { name: 'João da Silva Sauro Filho', phone: '(71) 98765-4321' },
    deliveryAddress: {
      street: 'Rua das Acácias Floridas do Lago Azul',
      number: '1234B',
      complement: 'Apto 502 Bloco C Torre Sul',
      neighborhood: 'Pituba Bela Vista da Encosta',
      city: 'Salvador',
      reference: 'Em frente à padaria do seu Zé, portão verde com grade preta',
    },
    items: [
      {
        name: 'X-Burguer Artesanal Especial Cheddar Duplo com Bacon',
        quantity: 2,
        price: 38.50,
        options: [
          { name: 'Borda Recheada de Catupiry Premium Importado', quantity: 1, price: 8.00 },
          { name: 'Bacon Crocante Extra Defumado', quantity: 2, price: 4.50 },
        ],
        notes: 'Sem cebola, ponto da carne bem passado, capricha na maionese caseira',
      },
      {
        name: 'Refrigerante 2L',
        quantity: 1,
        price: 12.00,
        options: [],
      },
      {
        name: 'PALAVRAUNICAMUITOLONGASEMESPACOSPARACAUSARQUEBRAFORCADA',
        quantity: 1,
        price: 5.00,
      },
    ],
    payments: [
      { method: 'CREDIT', value: 95.50, card: { brand: 'MASTERCARD' }, prepaid: false },
    ],
    deliveryFee: 8.00,
    discount: 0,
    total: 103.50,
    subtotal: 95.50,
    notes: 'Tocar interfone duas vezes. Cuidado com o cachorro.',
    frontendUrl: 'https://app.delivery.test',
  };
}

function shortOrder() {
  return {
    id: 'test-002',
    displaySimple: 12,
    createdAt: new Date('2026-05-12T19:05:00'),
    orderType: 'pickup',
    headerName: 'Lanchonete',
    headerCity: '',
    customer: { name: 'Ana', phone: '71988887777' },
    deliveryAddress: {},
    items: [
      { name: 'Coxinha', quantity: 3, price: 6.00, options: [] },
      { name: 'Suco Lata', quantity: 1, price: 5.00, options: [] },
    ],
    payments: [{ method: 'PIX', value: 23.00, prepaid: true }],
    deliveryFee: 0,
    discount: 0,
    total: 23.00,
    subtotal: 23.00,
  };
}

const CASES = {
  longname: { name: 'Nomes/endereço longos + palavra única gigante', order: baseOrder() },
  short:    { name: 'Pedido curto (sem stress)',                       order: shortOrder() },
};

// ─── Runner ───────────────────────────────────────────────────────────────────
function parseArgs() {
  const args = { width: 80, case: null };
  for (const a of process.argv.slice(2)) {
    const m = a.match(/^--(\w+)=(.+)$/);
    if (m) args[m[1]] = isNaN(Number(m[2])) ? m[2] : Number(m[2]);
  }
  return args;
}

function run() {
  const args = parseArgs();
  const widthMm = args.width || 80;
  const cols = widthMm === 58 ? 32 : 48;

  const printer = {
    width: widthMm,
    columns: cols,
    marginLeft: 0,
    density: 8,
    characterSet: 'PC850',
    template: null, // usa default
    itemNameSize: '1x2',  // altura dupla — testar bug fix
    itemOptionSize: '1x1',
  };

  const targets = args.case ? [args.case] : Object.keys(CASES);
  for (const key of targets) {
    const c = CASES[key];
    if (!c) {
      console.error(`Caso desconhecido: ${key}. Disponíveis: ${Object.keys(CASES).join(', ')}`);
      continue;
    }
    console.log('\n' + '═'.repeat(cols + 4));
    console.log(`  CENÁRIO: ${c.name}  (${widthMm}mm / ${cols} cols)`);
    console.log('═'.repeat(cols + 4));

    const buf = render(c.order, printer);
    const text = decodeEscPos(buf);
    console.log(withRuler(text.replace(/\n+$/, ''), cols));
    console.log(`\n[buffer = ${buf.length} bytes]`);
  }
}

run();
