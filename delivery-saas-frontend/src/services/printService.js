// src/services/printService.js
const qz = window.qz;

let connected = false;
let defaultPrinter = null;
const queue = [];
let isPrinting = false;
// ================================
// 🔌 Conectar ao QZ Tray
// ================================
export async function connectQZ() {
  try {
    if (!window.qz) {
      console.warn("⚠️ QZ Tray não detectado no navegador (window.qz ausente).");
      return false;
    }

    // já conectado?
    if (qz.websocket.isActive()) {
      connected = true;
      defaultPrinter = await qz.printers.getDefault();
      console.log("✅ QZ Tray já conectado. Impressora padrão:", defaultPrinter);
      return true;
    }

    console.log("🔌 Tentando conectar ao QZ Tray...");

    await qz.websocket.connect({ retries: 10, delay: 500 });

    // aguarda de fato ficar ativo
    let attempts = 0;
    while (!qz.websocket.isActive() && attempts < 20) {
      await new Promise(r => setTimeout(r, 200));
      attempts++;
    }

    if (!qz.websocket.isActive()) throw new Error("QZ Tray não respondeu a tempo");

    connected = true;
    defaultPrinter = await qz.printers.getDefault();
    console.log("🖨️ Conectado ao QZ Tray. Impressora padrão:", defaultPrinter);
    return true;
  } catch (err) {
    console.error("❌ Falha ao conectar QZ Tray:", err.message);
    connected = false;
    return false;
  }
}


// ================================
// 🖨️ Função para imprimir um pedido
// ================================
export async function enqueuePrint(order) {
  queue.push(order);
  processQueue();
}

// ================================
// ⏳ Processa a fila de impressão
// ================================
async function processQueue() {
  if (isPrinting || queue.length === 0) return;

  isPrinting = true;
  const order = queue.shift();

  try {
    await printOrder(order);
  } catch (err) {
    console.error("❌ Erro ao imprimir pedido:", err.message || err);
  } finally {
    isPrinting = false;
    if (queue.length > 0) {
      processQueue();
    }
  }
}

// ================================
// 🧾 Gera o conteúdo de texto da comanda
// ================================
function formatOrderText(order) {
  const display = order.displaySimple != null ? String(order.displaySimple).padStart(2, '0') : (order.displayId != null ? String(order.displayId).padStart(2,'0') : "PEDIDO");
  const header = `
==============================
      ${display}
==============================
Cliente: ${order.customerName || "Não informado"}
Endereço: ${order.address || "-"}
------------------------------
`;
  const items = (order.items || [])
    .map(
      (it) =>
        `${String(it.quantity).padStart(2, " ")}x ${it.name.padEnd(25, " ")} R$${it.price
          .toFixed(2)
          .padStart(6, " ")}`
    )
    .join("\n");

  const footer = `
------------------------------
TOTAL: R$ ${order.total?.toFixed(2) || "0.00"}
==============================
  Obrigado e bom apetite!
==============================
\n\n\n`;

  return header + items + footer;
}

// ================================
// 🖨️ Execução real da impressão
// ================================
async function printOrder(order) {
  if (!connected) {
    const ok = await connectQZ();
    if (!ok) throw new Error("QZ Tray não conectado");
  }

  if (!defaultPrinter) {
    defaultPrinter = await qz.printers.getDefault();
    if (!defaultPrinter) throw new Error("Nenhuma impressora padrão definida");
  }

  const text = formatOrderText(order);

  const config = qz.configs.create(defaultPrinter, {
    encoding: "UTF-8",
    copies: 1,
    colorType: "grayscale",
  });

  const data = [{ type: "raw", format: "plain", data: text }];

  const dbg = order.displaySimple != null ? String(order.displaySimple).padStart(2,'0') : (order.displayId != null ? String(order.displayId).padStart(2,'0') : order.id.slice(0,6));
  console.log(`🧾 Enviando pedido ${dbg} para impressão...`);

  await qz.print(config, data);
  console.log(`✅ Pedido ${dbg} impresso com sucesso.`);
}

// ================================
// ♻️ Desconectar do QZ Tray
// ================================
export async function disconnectQZ() {
  if (qz.websocket.isActive()) {
    await qz.websocket.disconnect();
    connected = false;
    console.log("🔌 Desconectado do QZ Tray.");
  }
}

// ================================
// 🚦 Estado do serviço
// ================================
export function isConnected() {
  return connected;
}

export default {
  connectQZ,
  enqueuePrint,
  disconnectQZ,
  isConnected,
};