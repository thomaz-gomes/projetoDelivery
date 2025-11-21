import express from 'express';
import { authMiddleware, requireRole } from '../auth.js';
import { readConfig, addOrUpdateCompanyPath, previewNormalizedPayload } from '../fileWatcher.js';

export const fileSourcesRouter = express.Router();
fileSourcesRouter.use(authMiddleware);

// GET /file-sources - returns configured path for the company (or null)
fileSourcesRouter.get('/', requireRole('ADMIN'), async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const cfg = await readConfig();
    const p = cfg[companyId] || null;
    res.json({ path: p });
  } catch (e) {
    res.status(500).json({ message: 'Erro ao ler configuração de pasta', error: e?.message || e });
  }
});

// POST /file-sources - set folder path for this company
fileSourcesRouter.post('/', requireRole('ADMIN'), async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { path } = req.body || {};
    if (!path) return res.status(400).json({ message: 'path é obrigatório' });
    await addOrUpdateCompanyPath(companyId, path);
    res.json({ ok: true, path });
  } catch (e) {
    const msg = e?.message || String(e);
    if (msg && msg.includes('Prisma model FileSource')) {
      return res.status(500).json({ message: 'Falha ao salvar path', error: msg, hint: 'Execute: npx prisma migrate dev --name add_file_source && npx prisma generate' });
    }
    res.status(500).json({ message: 'Falha ao salvar path', error: msg });
  }
});

// DELETE /file-sources - remove path for this company
fileSourcesRouter.delete('/', requireRole('ADMIN'), async (req, res) => {
  try {
    const companyId = req.user.companyId;
    await addOrUpdateCompanyPath(companyId, null);
    res.json({ ok: true });
  } catch (e) {
    const msg = e?.message || String(e);
    if (msg && msg.includes('Prisma model FileSource')) {
      return res.status(500).json({ message: 'Falha ao remover path', error: msg, hint: 'Execute: npx prisma migrate dev --name add_file_source && npx prisma generate' });
    }
    res.status(500).json({ message: 'Falha ao remover path', error: msg });
  }
});

// POST /file-sources/preview - accept pasted content and return normalized payload (for debugging)
fileSourcesRouter.post('/preview', requireRole('ADMIN'), async (req, res) => {
  try {
    const { content, filename } = req.body || {};
    if (!content) return res.status(400).json({ message: 'content is required in body' });
    const normalized = await previewNormalizedPayload(content, filename);
    res.json({ ok: true, normalized });
  } catch (e) {
    res.status(400).json({ ok: false, message: 'Failed to parse/normalize content', error: e?.message || String(e) });
  }
});
