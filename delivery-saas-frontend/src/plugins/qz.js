// src/plugins/qz.js
// Use the QZ Tray instance provided by the script tags in index.html (window.qz)
// This avoids bundling a second copy of qz-tray and ensures the global
// dependencies loaded via CDN (RSVP, js-sha256) are available.
export async function initQZ() {
  const qz = window.qz;
  if (!qz) return console.warn("⚠️ QZ Tray não encontrado em window.qz (verifique index.html)");

  // Define uso de Promises nativas
  try {
    qz.api.setPromiseType((resolver) => new Promise(resolver));

    // Em ambiente de desenvolvimento podemos usar certificado vazio (já definido em index.html)
    if (qz.security) {
      qz.security.setCertificatePromise(() => Promise.resolve(""));
      qz.security.setSignaturePromise(() => Promise.resolve(""));
    }

    if (!qz.websocket.isActive()) {
      await qz.websocket.connect();
      console.log("✅ QZ Tray conectado!");
    }
  } catch (e) {
    console.error("❌ Erro ao conectar ao QZ Tray:", e);
  }
}

/**
 * Imprime uma comanda simples
 */
export async function printComanda(order) {
  if (!order) return console.warn("⚠️ Pedido indefinido");

  const config = qz.configs.create(order.printer || "EPSON");

  const display = order.displaySimple != null ? String(order.displaySimple).padStart(2,'0') : (order.displayId != null ? String(order.displayId).padStart(2,'0') : order.id.slice(0,6));
  const data = [
    { type: "raw", format: "plain", data: "\x1B@\n" }, // reset
  { type: "raw", format: "plain", data: `PEDIDO: ${display}\n` },
    { type: "raw", format: "plain", data: `Cliente: ${order.customerName || "Cliente"}\n` },
    { type: "raw", format: "plain", data: `Endereço: ${order.address || "N/A"}\n\n` },
    ...(order.items || []).map((it) => ({
      type: "raw",
      format: "plain",
      data: `${it.quantity}x ${it.name} - R$${it.price?.toFixed(2) ?? 0}\n`,
    })),
    { type: "raw", format: "plain", data: `\nTOTAL: R$${order.total?.toFixed(2) ?? 0}\n\n\x1DV0` },
  ];

    try {
      await qz.print(config, data);
  console.log(`🖨️ Comanda impressa (${display})`);
    } catch (err) {
      console.error("❌ Erro ao imprimir:", err.message);
    }
}