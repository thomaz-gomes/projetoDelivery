// src/jobs/ifoodPollWorker.js
import { prisma } from '../prisma.js';
import { ifoodPoll } from '../integrations/ifood/client.js';

const POLLING_INTERVAL_MS = 30_000; // 30 segundos

/**
 * Executa polling contínuo para todas as empresas com integração ativa do iFood
 */
export async function startIFoodPollingWorker() {
  console.log('🚀 Iniciando iFood Polling Worker...');

  async function executePollingCycle() {
    try {
      // Busca todas as empresas com integração ativa
      const integrations = await prisma.apiIntegration.findMany({
        where: { provider: 'IFOOD', enabled: true },
      });

      if (!integrations.length) {
        console.log('⚠️ Nenhuma integração iFood ativa encontrada.');
        return;
      }

      console.log(`🔁 Executando polling para ${integrations.length} empresa(s)...`);

      for (const integ of integrations) {
        try {
          const result = await ifoodPoll(integ.companyId);
          const count = result?.events?.length || 0;

          if (count > 0) {
            console.log(
              `✅ [${integ.companyId}] Recebeu ${count} evento(s) iFood.`
            );
          } else {
            console.log(`🟢 [${integ.companyId}] Nenhum evento novo.`);
          }
        } catch (err) {
          console.error(
            `❌ [${integ.companyId}] Erro no polling iFood:`,
            err.message
          );
        }
      }
    } catch (globalErr) {
      console.error('🔥 Erro no ciclo de polling iFood:', globalErr.message);
    }
  }

  // Executa imediatamente na inicialização
  await executePollingCycle();

  // E agenda repetição a cada 30s
  setInterval(executePollingCycle, POLLING_INTERVAL_MS);
}