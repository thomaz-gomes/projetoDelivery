/**
 * test-ifood-query-count.js
 *
 * Simula um pedido PLACED do iFood e conta quantas queries DB e chamadas
 * HTTP são disparadas durante o processamento.
 *
 * Uso: docker compose exec backend node src/scripts/test-ifood-query-count.js
 *   ou: node src/scripts/test-ifood-query-count.js  (se rodando local com DB acessível)
 */
import 'dotenv/config';
import crypto from 'crypto';
import { prisma } from '../prisma.js';

// ── Monkey-patch Prisma para contar queries ──────────────────────────
let queryCount = 0;
const queryCalls = [];

const originalRequest = prisma._engine.request.bind(prisma._engine);
prisma._engine.request = async function (...args) {
  queryCount++;
  // args[0] pode ser o query object — extrair model + action se possível
  try {
    const q = args[0];
    const model = q?.model || q?.modelName || '?';
    const action = q?.action || q?.method || '?';
    queryCalls.push(`${model}.${action}`);
  } catch (e) {
    queryCalls.push('unknown');
  }
  return originalRequest(...args);
};

// ── Monkey-patch console.log para capturar logs relevantes ───────────
const relevantLogs = [];
const originalLog = console.log;
const originalWarn = console.warn;
const patterns = [
  'IntegrationMatcher',
  'iFood Processor',
  'iFood Auto-accept',
  'enrichOrderForAgent',
  'Auto-print',
  'emitirNovoPedido',
  'iFood Polling',
  'iFood Ack',
  '_enriched',
  'tokenCache',
];

function captureLog(level, args) {
  const msg = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
  if (patterns.some(p => msg.includes(p))) {
    relevantLogs.push(`[${level}] ${msg.slice(0, 200)}`);
  }
}

console.log = function (...args) {
  captureLog('LOG', args);
  originalLog.apply(console, args);
};
console.warn = function (...args) {
  captureLog('WARN', args);
  originalWarn.apply(console, args);
};

// ── Main ─────────────────────────────────────────────────────────────
async function main() {
  // Encontrar uma integração iFood ativa para simular
  const integ = await prisma.apiIntegration.findFirst({
    where: { provider: 'IFOOD', enabled: true },
  });

  if (!integ) {
    console.error('Nenhuma integração iFood ativa encontrada. Abortando.');
    process.exit(1);
  }

  const companyId = integ.companyId;
  originalLog('\n========================================');
  originalLog('  TEST: iFood query count per order');
  originalLog('========================================');
  originalLog('companyId:', companyId);
  originalLog('merchantId:', integ.merchantId || integ.merchantUuid || '(none)');

  // Criar payload fake simulando PLACED
  const fakeOrderId = `TEST-QUERY-COUNT-${crypto.randomUUID()}`;
  const fakePayload = {
    id: crypto.randomUUID(),
    code: 'PLACED',
    fullCode: 'PLACED',
    orderId: fakeOrderId,
    merchantId: integ.merchantId || integ.merchantUuid || 'test-merchant',
    createdAt: new Date().toISOString(),
    order: {
      id: fakeOrderId,
      displayId: 'QRY-' + Math.floor(Math.random() * 9000 + 1000),
      orderType: 'DELIVERY',
      merchant: { id: integ.merchantId || integ.merchantUuid || 'test-merchant' },
      customer: {
        name: 'Cliente Teste Query Count',
        phone: { number: '71900000000' },
      },
      items: [
        {
          name: 'Pizza Margherita',
          quantity: 1,
          unitPrice: 39.90,
          totalPrice: 39.90,
          externalCode: 'PIZZA-001',
          subItems: [
            { name: 'Borda Recheada', quantity: 1, unitPrice: 5.00, externalCode: 'OPT-BORDA-01' },
            { name: 'Sem Cebola', quantity: 1, unitPrice: 0, externalCode: 'OPT-SEMCEB-01' },
          ],
        },
        {
          name: 'Coca-Cola 2L',
          quantity: 2,
          unitPrice: 12.00,
          totalPrice: 24.00,
          externalCode: 'BEBIDA-001',
        },
      ],
      total: { orderAmount: 63.90, deliveryFee: 7.00 },
      delivery: {
        deliveryAddress: {
          formattedAddress: 'Rua Teste Query, 456 - Pituba',
          streetName: 'Rua Teste Query',
          streetNumber: '456',
          neighborhood: 'Pituba',
          city: 'Salvador',
          state: 'BA',
          postalCode: '41810-000',
          coordinates: { latitude: -12.98, longitude: -38.45 },
        },
      },
      payments: {
        methods: [{ method: 'CASH', value: 70.90, changeFor: 80.00 }],
      },
    },
  };

  // Persistir como WebhookEvent
  const evt = await prisma.webhookEvent.create({
    data: {
      provider: 'IFOOD',
      eventId: `test-qcount-${fakePayload.id}`,
      payload: fakePayload,
      status: 'RECEIVED',
      receivedAt: new Date(),
    },
  });

  // Reset counters
  queryCount = 0;
  queryCalls.length = 0;
  relevantLogs.length = 0;

  originalLog('\n--- Processando pedido (contando queries) ---\n');

  const startTime = Date.now();

  // Importar e processar
  const { processIFoodWebhook } = await import('../services/ifoodWebhookProcessor.js');
  await processIFoodWebhook(evt.id);

  const elapsed = Date.now() - startTime;

  // ── Relatório ──────────────────────────────────────────────────────
  originalLog('\n========================================');
  originalLog('  RESULTADO');
  originalLog('========================================');
  originalLog(`Tempo total: ${elapsed}ms`);
  originalLog(`Total de queries DB: ${queryCount}`);
  originalLog('');

  // Agrupar queries por model.action
  const grouped = {};
  for (const q of queryCalls) {
    grouped[q] = (grouped[q] || 0) + 1;
  }
  originalLog('Queries por tipo:');
  for (const [key, count] of Object.entries(grouped).sort((a, b) => b[1] - a[1])) {
    originalLog(`  ${key}: ${count}x`);
  }

  originalLog('');
  originalLog(`Logs relevantes capturados: ${relevantLogs.length}`);
  for (const l of relevantLogs) {
    originalLog(`  ${l}`);
  }

  // Cleanup: remover pedido e evento de teste
  try {
    const testOrder = await prisma.order.findUnique({ where: { externalId: fakeOrderId } });
    if (testOrder) {
      await prisma.orderItem.deleteMany({ where: { orderId: testOrder.id } });
      await prisma.orderHistory.deleteMany({ where: { orderId: testOrder.id } });
      await prisma.order.delete({ where: { id: testOrder.id } });
    }
    await prisma.webhookEvent.delete({ where: { id: evt.id } });
    originalLog('\nCleanup: pedido e evento de teste removidos.');
  } catch (e) {
    originalLog('Cleanup parcial:', e.message);
  }

  originalLog('\n========================================\n');
  await prisma.$disconnect();
  process.exit(0);
}

main().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});
