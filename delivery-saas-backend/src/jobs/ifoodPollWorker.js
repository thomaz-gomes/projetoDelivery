// src/jobs/ifoodPollWorker.js
import { prisma } from '../prisma.js';
import { ifoodPoll, ifoodAck } from '../integrations/ifood/client.js';
import { processIFoodWebhook } from '../services/ifoodWebhookProcessor.js';

const POLLING_INTERVAL_MS = process.env.IFOOD_POLL_INTERVAL_MS ? Number(process.env.IFOOD_POLL_INTERVAL_MS) : 30_000; // default 30s

let polling = false;

/**
 * Executa polling contínuo para todas as empresas com integração ativa do iFood.
 * Usa setTimeout recursivo para evitar sobreposição de ciclos (o próximo ciclo
 * só é agendado depois que o atual termina).
 */
export async function startIFoodPollingWorker() {
  console.log('🚀 Iniciando iFood Polling Worker...');

  async function executePollingCycle() {
    if (polling) return;
    polling = true;

    try {
      // Busca todas as empresas com integração ativa
      const integrations = await prisma.apiIntegration.findMany({
        where: { provider: 'IFOOD', enabled: true },
      });

      if (!integrations.length) return;

      for (const integ of integrations) {
        try {
          const result = await ifoodPoll({ integrationId: integ.id });
          const events = result?.events || [];
          const count = events.length;

          if (count > 0) console.log(`[iFood Poll] [${integ.companyId}] ${count} evento(s)`);

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
          console.error(`[iFood Poll] [${integ.companyId}] Erro:`, err && err.message ? err.message : err);
        }
      }
    } catch (globalErr) {
      console.error('[iFood Poll] Erro no ciclo:', globalErr.message);
    } finally {
      polling = false;
      // Agenda o PRÓXIMO ciclo somente após o atual terminar
      setTimeout(executePollingCycle, POLLING_INTERVAL_MS);
    }
  }

  // Executa imediatamente na inicialização (setTimeout recursivo cuida do resto)
  executePollingCycle();
}