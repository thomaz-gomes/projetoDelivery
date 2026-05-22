// Public endpoint used by the trial onboarding wizard (Step 4 — "Da foto").
//
// Same vision-AI extraction as routes/menuImport.js#runParseJob (method='photo')
// but with no auth and no credit deduction, since the user hasn't completed
// signup yet. Cost is contained by:
//   - Per-IP rate limit (3 photo-parses per hour).
//   - Global daily cap circuit-breaker (50 parses per day).
//   - Each call is capped at 4 images.
//
// Wire flow:
//   POST /public/onboarding/menu-from-photo   { photos: dataURL[] } → { jobId }
//   GET  /public/onboarding/menu-from-photo/:jobId → { done, stage, categories?, error? }
//
// Categories shape matches the authed endpoint so the frontend can flatten
// it the same way.

import express from 'express';
import { randomUUID } from 'crypto';
import { rateLimit } from '../middleware/rateLimit.js';
import { callVisionAI } from '../services/aiProvider.js';

export const publicOnboardingRouter = express.Router();

const SYSTEM_PROMPT = `Você é um extrator especializado em cardápios de restaurantes e deliveries.
Analise o conteúdo fornecido e retorne APENAS um JSON válido (sem texto extra, sem markdown) no formato:
{"categories":[{"name":"Nome da Categoria","items":[{"name":"Nome do Item","description":"Descrição limpa","price":0.00}]}]}

Regras obrigatórias:
- Extraia SOMENTE pratos, bebidas e produtos do cardápio — ignore menus de navegação, botões, textos de login, status da loja, taxas de entrega e quaisquer elementos de interface
- "price" deve ser número decimal (ex: 29.90), nunca string. Se houver "A partir de R$ X", use X como preço
- "description" deve ser texto limpo: sem HTML, sem emojis excessivos, sem quebras de linha
- Se não identificar categorias, use "Geral"
- Preserve 100% dos itens — não omita nenhum produto`;

function extractJSON(text) {
  try { return JSON.parse(text.trim()); } catch (_) {}
  const match = text.match(/\{[\s\S]*\}/);
  if (match) { try { return JSON.parse(match[0]); } catch (_) {} }
  throw new Error('IA não retornou JSON válido. Tente novamente.');
}

// Per-IP and global throttling. The values are intentionally conservative —
// legitimate trial users upload once; abusers see a 429 fast.
const photoLimiter = rateLimit({
  windowMs: 60 * 60_000,
  max: 3,
  message: 'Você atingiu o limite de testes da IA. Tente novamente em 1 hora ou use o modelo pronto.',
});

const GLOBAL_DAILY_CAP = Number(process.env.PUBLIC_ONBOARDING_AI_DAILY_CAP || 50);
let globalCounter = { day: new Date().toISOString().slice(0, 10), count: 0 };
function bumpGlobalCounter() {
  const today = new Date().toISOString().slice(0, 10);
  if (globalCounter.day !== today) globalCounter = { day: today, count: 0 };
  globalCounter.count += 1;
  return globalCounter.count <= GLOBAL_DAILY_CAP;
}

// In-memory job store. Jobs are cleaned up 15 minutes after completion to
// avoid memory bloat; matches the pattern in routes/menuImport.js.
const jobs = new Map();
function setJob(id, patch) {
  const cur = jobs.get(id) || {};
  jobs.set(id, { ...cur, ...patch });
}

publicOnboardingRouter.post('/onboarding/menu-from-photo', photoLimiter, async (req, res) => {
  const { photos } = req.body || {};
  const list = Array.isArray(photos) ? photos : [photos];
  const valid = list
    .map(p => String(p || '').trim())
    .filter(p => p.startsWith('data:image/'))
    .slice(0, 4); // cap at 4 images per request
  if (!valid.length) {
    return res.status(400).json({ message: 'Envie pelo menos uma imagem (data:image/...).' });
  }

  if (!bumpGlobalCounter()) {
    return res.status(503).json({
      message: 'O recurso de IA está temporariamente indisponível por excesso de uso. Tente o modelo pronto enquanto isso.',
    });
  }

  const jobId = randomUUID();
  setJob(jobId, { done: false, stage: 'pending', categories: null, error: null });
  res.json({ jobId });

  // Process in background — same merge-by-category strategy as menuImport.js.
  (async () => {
    try {
      setJob(jobId, { stage: 'ai_analyzing' });
      const merged = [];
      const indexByName = new Map();

      for (let i = 0; i < valid.length; i++) {
        const dataUrl = valid[i];
        const m = dataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
        const mime = m?.[1] || 'image/jpeg';
        const b64 = m?.[2] || dataUrl;
        const prompt = valid.length > 1
          ? `Analise esta imagem de cardápio (página ${i + 1} de ${valid.length}) e extraia todos os itens com nome, descrição e preço.`
          : 'Analise esta imagem de cardápio e extraia todos os itens com nome, descrição e preço.';
        const { text } = await callVisionAI(
          'MENU_IMPORT_PHOTO',
          SYSTEM_PROMPT,
          prompt,
          b64,
          mime,
          { maxTokens: 8192, timeoutMs: 100_000 },
        );
        const parsed = extractJSON(text);
        if (!parsed?.categories) continue;
        for (const cat of parsed.categories) {
          const catName = String(cat.name || 'Geral').trim();
          const key = catName.toLowerCase();
          if (indexByName.has(key)) {
            merged[indexByName.get(key)].items.push(...(cat.items || []));
          } else {
            indexByName.set(key, merged.length);
            merged.push({ name: catName, items: cat.items || [] });
          }
        }
      }

      setJob(jobId, { done: true, stage: 'done', categories: merged });
    } catch (err) {
      console.error('[publicOnboarding] photo parse failed:', err?.message || err);
      setJob(jobId, { done: true, stage: 'error', error: err?.message || 'Falha ao processar a imagem.' });
    } finally {
      setTimeout(() => jobs.delete(jobId), 15 * 60_000);
    }
  })();
});

publicOnboardingRouter.get('/onboarding/menu-from-photo/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ message: 'Job não encontrado ou expirado.' });
  res.json(job);
});

export default publicOnboardingRouter;
