// src/services/printService.js

let connected = false;
let defaultPrinter = null;
const queue = [];
let isPrinting = false;
// Promise that represents an ongoing connect attempt. Used to coalesce concurrent calls.
let connectingPromise = null;
// ================================
// 🔌 Conectar ao QZ Tray
// ================================
export async function connectQZ() {
  try {
    const qz = window.qz;
    if (!qz) {
      console.warn("⚠️ QZ Tray não detectado no navegador (window.qz ausente).");
      return false;
    }

    // já conectado?
    if (qz.websocket && qz.websocket.isActive && qz.websocket.isActive()) {
      connected = true;
      // prefer a configured printer from localStorage when present
      try {
        const cfg = JSON.parse(localStorage.getItem('printerConfig') || '{}');
        if (cfg && cfg.printerName) {
          defaultPrinter = cfg.printerName;
        } else {
          defaultPrinter = await qz.printers.getDefault();
        }
      } catch (e) {
        defaultPrinter = await qz.printers.getDefault();
      }
      console.log("✅ QZ Tray já conectado. Impressora padrão:", defaultPrinter);
      return true;
    }

    // If there's already an ongoing connect attempt, return the same promise so
    // concurrent callers wait for the same result instead of starting new attempts.
    if (connectingPromise) {
      return await connectingPromise;
    }

    // Create a single promise for the connect flow and keep it in module scope
    // so other callers can await it. We implement an exponential backoff retry
    // strategy to avoid flooding QZ Tray while trying to connect.
    connectingPromise = (async () => {
      console.log("🔌 Tentando conectar ao QZ Tray...");
      const maxAttempts = 5;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          // Let the qz library perform its own small retry loop too.
          await qz.websocket.connect({ retries: 10, delay: 500 });

          // aguarda de fato ficar ativo
          let waitAttempts = 0;
          while (!qz.websocket.isActive() && waitAttempts < 20) {
            await new Promise(r => setTimeout(r, 200));
            waitAttempts++;
          }

          if (!qz.websocket.isActive()) throw new Error("QZ Tray não respondeu a tempo");

          connected = true;
          // prefer a configured printer from localStorage when present
          try {
            const cfg = JSON.parse(localStorage.getItem('printerConfig') || '{}');
            if (cfg && cfg.printerName) {
              defaultPrinter = cfg.printerName;
            } else {
              defaultPrinter = await qz.printers.getDefault();
            }
          } catch (e) {
            defaultPrinter = await qz.printers.getDefault();
          }
          console.log("🖨️ Conectado ao QZ Tray. Impressora padrão:", defaultPrinter);
          return true;
        } catch (err) {
          console.error(`❌ Falha ao conectar QZ Tray (tentativa ${attempt}):`, err && err.message ? err.message : err);
          if (attempt >= maxAttempts) {
            // Re-throw so outer catch can handle it and we clear connectingPromise.
            throw err;
          }
          // Exponential backoff with jitter (cap at 30s)
          const base = Math.min(2000 * Math.pow(2, attempt - 1), 30000);
          const jitter = Math.floor(Math.random() * 500);
          const delay = base + jitter;
          console.log(`Aguardando ${delay}ms antes da próxima tentativa de conexão...`);
          await new Promise(r => setTimeout(r, delay));
        }
      }
      // If we exit the loop without returning, consider it a failure.
      throw new Error('Falha desconhecida ao conectar QZ Tray');
    })();

    try {
      const res = await connectingPromise;
      return res;
    } finally {
      // Clear the connecting promise so future attempts can start fresh.
      connectingPromise = null;
    }
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
      (it) => {
        const qty = Number(it.quantity ?? it.qty ?? 1) || 1;
        const name = String(it.name || it.title || it.productName || '').slice(0, 25);
        const priceNum = Number(it.price ?? it.unitPrice ?? it.unit_price ?? it.amount ?? 0) || 0;
        return `${String(qty).padStart(2, " ")}x ${name.padEnd(25, " ")} R$${priceNum.toFixed(2).padStart(6, " ")}`;
      }
    )
    .join("\n");

  const totalNum = Number(order.total ?? order.amount ?? order.orderAmount ?? 0) || 0;
  const footer = `
------------------------------
TOTAL: R$ ${totalNum.toFixed(2)}
==============================
  Obrigado e bom apetite!
==============================
\n\n\n`;

  return header + items + footer;
}

// expose formatter so UI can preview the comanda without printing
export { formatOrderText };

// ================================
// 🖨️ Execução real da impressão
// ================================
async function printOrder(order) {
  const qz = window.qz;
  if (!qz) throw new Error("QZ Tray não disponível (window.qz ausente)");

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

  const dbg = order.displaySimple != null ? String(order.displaySimple).padStart(2,'0') : (order.displayId != null ? String(order.displayId).padStart(2,'0') : (order.id || '').slice(0,6));
  console.log(`🧾 Enviando pedido ${dbg} para impressão...`);

  await qz.print(config, data);
  console.log(`✅ Pedido ${dbg} impresso com sucesso.`);
}

// ================================
// ♻️ Desconectar do QZ Tray
// ================================
export async function disconnectQZ() {
  const qz = window.qz;
  if (qz && qz.websocket && qz.websocket.isActive && qz.websocket.isActive()) {
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

// retorna se existe uma tentativa de conexão em andamento
export function isConnecting() {
  return !!connectingPromise;
}

export default {
  connectQZ,
  enqueuePrint,
  disconnectQZ,
  isConnected,
  isConnecting,
  formatOrderText,
};