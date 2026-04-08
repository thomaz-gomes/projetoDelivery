// src/jobs/ifoodPollWorker.js
import { prisma } from '../prisma.js';
import { ifoodPoll, ifoodAck } from '../integrations/ifood/client.js';
import { processIFoodWebhook } from '../services/ifoodWebhookProcessor.js';

const POLLING_INTERVAL_MS = process.env.IFOOD_POLL_INTERVAL_MS ? Number(process.env.IFOOD_POLL_INTERVAL_MS) : 30_000; // default 30s

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
          const result = await ifoodPoll({ integrationId: integ.id });
          const events = result?.events || [];
          const count = events.length;

          if (count > 0) console.log(`✅ [${integ.companyId}] Recebeu ${count} evento(s) iFood.`);
          else console.log(`🟢 [${integ.companyId}] Nenhum evento novo.`);

          const ackCandidates = [];

          for (const ev of events) {
            try {
              // Persist event if not exists (or update payload)
              const eventId = ev.id || ev.eventId || ev.name || JSON.stringify(ev).slice(0,20);
              const up = await prisma.webhookEvent.upsert({
                where: { eventId },
                update: { payload: ev, status: 'RECEIVED', receivedAt: new Date() },
                create: { provider: 'IFOOD', eventId, payload: ev, status: 'RECEIVED', receivedAt: new Date() },
              });

              // Process the persisted event (this will upsert/create orders and emit to UI)
              await processIFoodWebhook(up.id);

              // If processed successfully, mark for ACK
              const updated = await prisma.webhookEvent.findUnique({ where: { id: up.id } });
              if (updated && updated.status === 'PROCESSED') ackCandidates.push({ id: eventId });
            } catch (eEv) {
              console.error('[iFood Poll Worker] failed processing event:', eEv && eEv.message);
            }
          }

          // Send ACK for processed events
          if (ackCandidates.length) {
            try {
              await ifoodAck({ integrationId: integ.id }, ackCandidates);
            } catch (eAck) {
              console.warn('[iFood Poll Worker] ACK failed:', eAck && eAck.message);
            }
          }
        } catch (err) {
          console.error(`❌ [${integ.companyId}] Erro no polling iFood:`, err && err.message ? err.message : err);
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