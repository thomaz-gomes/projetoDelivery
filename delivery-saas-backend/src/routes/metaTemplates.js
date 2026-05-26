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

// POST /meta/templates
// body: { accountId, name, language, category, components }
//
// Submete um template novo pra aprovação Meta. O ciclo de vida (PENDING →
// APPROVED/REJECTED) é assíncrono — o worker faz polling pra refrescar o
// status. Aqui só persistimos com createdViaApp=true pro polling saber
// quais templates ele cuida.
//
// Validation rules (mirror Meta's docs):
//   - name: lowercase, digits, underscore only (regex)
//   - language: enum (pt_BR, en_US, ...) — não validamos lista; Meta rejeita
//   - category: MARKETING | UTILITY | AUTHENTICATION
//   - components: array com pelo menos um BODY type
router.post('/templates', requireRole('ADMIN'), async (req, res) => {
  try {
    const { companyId } = req.user;
    const userId = req.user.id || req.user.userId || null;
    const { accountId, name, language, category, components } = req.body || {};

    if (!accountId) return res.status(400).json({ message: 'accountId é obrigatório' });
    if (!name) return res.status(400).json({ message: 'name é obrigatório' });
    if (!language) return res.status(400).json({ message: 'language é obrigatório' });
    if (!category) return res.status(400).json({ message: 'category é obrigatório' });
    if (!Array.isArray(components) || components.length === 0) {
      return res.status(400).json({ message: 'components deve ser um array não-vazio' });
    }

    // Meta rule: name lowercase + digits + underscore only
    if (!/^[a-z0-9_]+$/.test(name)) {
      return res.status(400).json({
        message: 'Nome inválido. Use apenas letras minúsculas, números e underscore (_).',
      });
    }
    const VALID_CATEGORIES = ['MARKETING', 'UTILITY', 'AUTHENTICATION'];
    if (!VALID_CATEGORIES.includes(category)) {
      return res.status(400).json({ message: `category deve ser um de: ${VALID_CATEGORIES.join(', ')}` });
    }
    // Pelo menos um BODY component (Meta exige)
    const hasBody = components.some(c => String(c?.type || '').toUpperCase() === 'BODY');
    if (!hasBody) {
      return res.status(400).json({ message: 'O template precisa ter pelo menos um componente BODY' });
    }

    const account = await prisma.metaMessagingAccount.findFirst({
      where: { id: accountId, companyId, provider: 'META_WA' },
    });
    if (!account) return res.status(404).json({ message: 'Conta Meta WA não encontrada' });
    if (!account.wabaId) {
      return res.status(400).json({ message: 'Conta sem wabaId — necessário pra criar templates' });
    }

    // Já existe local com mesmo (account, name, language)? Evita 409 surpresa.
    const existing = await prisma.metaTemplate.findFirst({
      where: { metaWaAccountId: account.id, name, language },
    });
    if (existing) {
      return res.status(409).json({
        message: 'Já existe um template com esse nome e idioma para essa conta. Escolha outro nome.',
      });
    }

    // Submete na Meta — erros Graph API mapeiam pra 502 com a mensagem original.
    let metaResult;
    try {
      metaResult = await whatsappMetaAdapter.createTemplate(account, { name, language, category, components });
    } catch (err) {
      const metaErr = err?.response?.data?.error || err?.metaError || null;
      console.error('[meta/templates POST] Graph API erro', metaErr || err?.message);
      return res.status(502).json({
        message: metaErr?.message || 'Falha ao submeter template na Meta',
        meta: metaErr,
      });
    }

    // Cache local com flags de submissão. Se Meta já retornou APPROVED (raro,
    // só pra AUTHENTICATION), respeitamos.
    const row = await prisma.metaTemplate.create({
      data: {
        companyId,
        metaWaAccountId: account.id,
        externalId: String(metaResult.id || ''),
        name,
        language,
        category: metaResult.category || category,
        status: String(metaResult.status || 'PENDING').toUpperCase(),
        components,
        createdViaApp: true,
        submittedByUserId: userId,
        submittedAt: new Date(),
      },
      include: {
        metaWaAccount: { select: { id: true, displayName: true, externalId: true } },
      },
    });

    return res.status(201).json(row);
  } catch (err) {
    console.error('[meta/templates POST]', err);
    return res.status(500).json({ message: 'Erro ao criar template', error: err.message });
  }
});

// POST /meta/templates/:id/resubmit
// Reaproveita o builder pra resubmeter após uma rejeição. Operacional: o
// operador edita os componentes, mantém o mesmo nome+idioma, e nós
// re-postamos na Meta. Meta trata como um novo template (gera novo id).
router.post('/templates/:id/resubmit', requireRole('ADMIN'), async (req, res) => {
  try {
    const { companyId } = req.user;
    const userId = req.user.id || req.user.userId || null;
    const { id } = req.params;
    const { components } = req.body || {};

    if (!Array.isArray(components) || components.length === 0) {
      return res.status(400).json({ message: 'components deve ser um array não-vazio' });
    }

    const existing = await prisma.metaTemplate.findFirst({
      where: { id, companyId },
      include: { metaWaAccount: true },
    });
    if (!existing) return res.status(404).json({ message: 'Template não encontrado' });
    if (existing.status !== 'REJECTED' && existing.status !== 'DISABLED') {
      return res.status(400).json({
        message: `Só é possível resubmeter templates REJECTED ou DISABLED. Status atual: ${existing.status}`,
      });
    }

    let metaResult;
    try {
      metaResult = await whatsappMetaAdapter.createTemplate(existing.metaWaAccount, {
        name: existing.name,
        language: existing.language,
        category: existing.category,
        components,
      });
    } catch (err) {
      const metaErr = err?.response?.data?.error || null;
      return res.status(502).json({
        message: metaErr?.message || 'Falha ao resubmeter template',
        meta: metaErr,
      });
    }

    const row = await prisma.metaTemplate.update({
      where: { id: existing.id },
      data: {
        externalId: String(metaResult.id || existing.externalId),
        status: String(metaResult.status || 'PENDING').toUpperCase(),
        components,
        rejectionReason: null,
        submittedByUserId: userId,
        submittedAt: new Date(),
        createdViaApp: true,
      },
    });
    return res.json(row);
  } catch (err) {
    console.error('[meta/templates/:id/resubmit]', err);
    return res.status(500).json({ message: 'Erro ao resubmeter template', error: err.message });
  }
});

export default router;
