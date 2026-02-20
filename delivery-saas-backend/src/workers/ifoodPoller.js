// src/workers/ifoodPoller.js
import 'dotenv/config';
import { prisma } from '../prisma.js';
import { pollIFood } from '../integrations/ifood/index.js';

const INTERVAL_MS = Number(process.env.IFOOD_POLL_INTERVAL_MS || 30000); // iFood spec: poll every 30s
const MAX_CONCURRENCY = Number(process.env.IFOOD_POLL_MAX_CONCURRENCY || 3);

let timer = null;
let running = false;

async function getActiveIfoodCompanies() {
  // Busca empresas que possuem integração IFOOD habilitada
  const integrations = await prisma.apiIntegration.findMany({
    where: { provider: 'IFOOD', enabled: true },
    select: { companyId: true },
  });
  // Remove duplicatas (por segurança)
  return [...new Set(integrations.map(i => i.companyId))];
}

// Pequeno pool de concorrência
async function runWithConcurrency(items, worker, max = 3) {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(max, queue.length) }, async () => {
    while (queue.length) {
      const next = queue.shift();
      try {
        await worker(next);
      } catch (e) {
        console.error('[poll] erro empresa', next, e?.response?.data || e?.message);
      }
    }
  });
  await Promise.all(workers);
}

async function tick() {
  if (running) return; // evita reentrância se o loop anterior ainda estiver rodando
  running = true;

  try {
    const companies = await getActiveIfoodCompanies();
    if (companies.length === 0) {
      console.log('⏳ Nenhuma empresa com iFood ativo.');
    } else {
      console.log(`🔁 Poll iFood para ${companies.length} empresa(s)...`);
      await runWithConcurrency(
        companies,
        async (companyId) => {
          try {
            const events = await pollIFood(companyId); // já faz ACK dentro
            if (events?.length) {
              console.log(`🏁 ${companyId}: processados ${events.length} evento(s)`);
            }
          } catch (e) {
            console.error(`❌ Falha no poll da empresa ${companyId}:`, e?.response?.data || e?.message);
          }
        },
        MAX_CONCURRENCY
      );
    }
  } catch (e) {
    console.error('❌ Erro no tick principal:', e?.response?.data || e?.message);
  } finally {
    running = false;
  }
}

function start() {
  console.log(`🟢 iFood poller iniciado. Intervalo: ${INTERVAL_MS}ms, Concorrência: ${MAX_CONCURRENCY}`);
  // Executa imediatamente um ciclo
  tick().catch(() => {});

  // E agenda intervalos
  timer = setInterval(tick, INTERVAL_MS);
}

async function stop() {
  console.log('🛑 Encerrando iFood poller...');
  if (timer) clearInterval(timer);
  try {
    await prisma.$disconnect();
  } catch {}
  process.exit(0);
}

// Sinais de encerramento (docker/pm2/terminal)
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
process.on('uncaughtException', (err) => {
  console.error('UncaughtException:', err);
  stop();
});
process.on('unhandledRejection', (reason) => {
  console.error('UnhandledRejection:', reason);
  stop();
});

start();