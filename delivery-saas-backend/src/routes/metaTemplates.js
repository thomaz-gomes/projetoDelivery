// src/routes/metaTemplates.js
// CRUD de cache local + sincronização com a Graph API dos templates aprovados
// na WhatsApp Business Account (WABA). Templates são pré-requisito para
// enviar mensagens fora da janela de 24h ou em campanhas iniciadas pela
// empresa. O ciclo de vida (criação, aprovação) acontece no Meta Business
// Manager — aqui só consumimos/listamos.

import { Router } from 'express';
import { prisma } from '../prisma.js';
import { authMiddleware, requireRole } from '../auth.js';
import whatsappMetaAdapter from '../messaging/adapters/whatsappMeta.adapter.js';

const router = Router();
router.use(authMiddleware);

// GET /meta/templates?accountId=...
// Lista templates cacheados localmente. Filtro opcional por account.
router.get('/templates', async (req, res) => {
  try {
    const { companyId } = req.user;
    const { accountId, status } = req.query;

    const where = { companyId };
    if (accountId) where.metaWaAccountId = String(accountId);
    if (status) where.status = String(status).toUpperCase();

    const templates = await prisma.metaTemplate.findMany({
      where,
      orderBy: [{ status: 'asc' }, { name: 'asc' }],
      include: {
        metaWaAccount: { select: { id: true, displayName: true, externalId: true } },
      },
    });
    return res.json(templates);
  } catch (err) {
    console.error('[meta/templates GET]', err);
    return res.status(500).json({ message: 'Erro ao listar templates', error: err.message });
  }
});

// POST /meta/templates/sync
// body: { accountId }
// Puxa do Graph API e upserta no cache local. Marca como DELETED os templates
// que existiam no cache mas não retornaram da Meta (foram removidos lá).
router.post('/templates/sync', requireRole('ADMIN'), async (req, res) => {
  try {
    const { companyId } = req.user;
    const { accountId } = req.body || {};
    if (!accountId) return res.status(400).json({ message: 'accountId é obrigatório' });

    const account = await prisma.metaMessagingAccount.findFirst({
      where: { id: accountId, companyId, provider: 'META_WA' },
    });
    if (!account) return res.status(404).json({ message: 'Conta Meta WA não encontrada' });
    if (!account.wabaId) {
      return res.status(400).json({ message: 'Conta sem wabaId — necessário pra listar templates' });
    }

    let remoteTemplates;
    try {
      remoteTemplates = await whatsappMetaAdapter.listTemplates(account, { limit: 100 });
    } catch (err) {
      const metaErr = err?.response?.data?.error || err?.metaError || null;
      console.error('[meta/templates/sync] Graph API erro', metaErr || err?.message);
      return res.status(502).json({
        message: 'Falha ao consultar templates na Meta',
        meta: metaErr,
      });
    }

    // Upsert each remote template.
    const seenKeys = new Set();
    const upserted = [];
    for (const t of remoteTemplates) {
      if (!t?.name || !t?.language) continue;
      const key = `${t.name}|${t.language}`;
      seenKeys.add(key);
      const row = await prisma.metaTemplate.upsert({
        where: {
          metaWaAccountId_name_language: {
            metaWaAccountId: account.id,
            name: t.name,
            language: t.language,
          },
        },
        create: {
          companyId,
          metaWaAccountId: account.id,
          externalId: String(t.id || ''),
          name: t.name,
          language: t.language,
          category: String(t.category || 'UTILITY'),
          status: String(t.status || 'PENDING'),
          components: t.components || [],
        },
        update: {
          externalId: String(t.id || ''),
          category: String(t.category || 'UTILITY'),
          status: String(t.status || 'PENDING'),
          components: t.components || [],
          syncedAt: new Date(),
        },
      });
      upserted.push(row);
    }

    // Mark stale rows (existed locally but not in Meta response) as DELETED.
    const localRows = await prisma.metaTemplate.findMany({
      where: { metaWaAccountId: account.id },
      select: { id: true, name: true, language: true, status: true },
    });
    const staleIds = localRows
      .filter(r => !seenKeys.has(`${r.name}|${r.language}`) && r.status !== 'DELETED')
      .map(r => r.id);
    if (staleIds.length) {
      await prisma.metaTemplate.updateMany({
        where: { id: { in: staleIds } },
        data: { status: 'DELETED', syncedAt: new Date() },
      });
    }

    return res.json({
      synced: upserted.length,
      markedDeleted: staleIds.length,
      templates: upserted,
    });
  } catch (err) {
    console.error('[meta/templates/sync]', err);
    return res.status(500).json({ message: 'Erro ao sincronizar templates', error: err.message });
  }
});

export default router;
