/**
 * menuImport.js — Importador de cardápio via IA (GPT-4o + Puppeteer)
 *
 * Padrão assíncrono (igual customers/import):
 *   POST /menu/ai-import/parse          → inicia job, retorna { jobId } imediatamente
 *   GET  /menu/ai-import/parse/:jobId   → polling de status { done, categories, error }
 *   POST /menu/ai-import/apply          → aplica categorias ao cardápio
 */

import express from 'express';
import axios from 'axios';
import * as XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import { prisma } from '../prisma.js';
import { authMiddleware } from '../auth.js';
import { checkCredits, debitCredits, AI_SERVICE_COSTS } from '../services/aiCreditManager.js';
import { getSetting } from '../services/systemSettings.js';

const router = express.Router();
router.use(authMiddleware);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const OPENAI_MODEL = process.env.OPENAI_IMPORT_MODEL || 'gpt-4o';

// Mapa de jobs em memória: jobId → { done, categories, error }
const parseJobs = new Map();

// ─── OpenAI ──────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Você é um extrator especializado em cardápios de restaurantes e deliveries.
Analise o conteúdo fornecido e retorne APENAS um JSON válido (sem texto extra, sem markdown) no formato:
{"categories":[{"name":"Nome da Categoria","items":[{"name":"Nome do Item","description":"Descrição limpa","price":0.00,"imageUrl":null,"optionGroups":[]}]}]}

Regras obrigatórias:
- Extraia SOMENTE pratos, bebidas e produtos do cardápio — ignore menus de navegação, botões, textos de login, status da loja, taxas de entrega e quaisquer elementos de interface
- "price" deve ser número decimal (ex: 29.90), nunca string. Se houver "A partir de R$ X", use X como preço
- "description" deve ser texto limpo: sem HTML, sem emojis excessivos, sem quebras de linha
- "imageUrl": use a URL da imagem SOMENTE se tiver CERTEZA que ela pertence a este produto específico (baseando-se no alt text ou texto próximo à imagem). Em caso de dúvida use null. Nunca associe imagens genéricas ou de outros produtos
- "optionGroups": use sempre [] (lista vazia)
- Se não identificar categorias, use "Geral"
- Preserve 100% dos itens — não omita nenhum produto
- Remova apenas caracteres especiais que não sejam letras, números, pontuação padrão`;

async function callOpenAI(messages) {
  const key = await getSetting('openai_api_key', 'OPENAI_API_KEY');
  if (!key) throw new Error('Chave da API OpenAI não configurada. Acesse Painel SaaS → Configurações para inserir sua chave.');
  const model = await getSetting('openai_model', 'OPENAI_IMPORT_MODEL') || OPENAI_MODEL;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 100_000); // 100s timeout

  let res;
  try {
    res = await fetch(OPENAI_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
      body: JSON.stringify({ model, temperature: 0, max_tokens: 8192, messages }),
    });
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Timeout: OpenAI não respondeu em 100 segundos');
    throw e;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI API error ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  const rawContent = data.choices?.[0]?.message?.content || '';
  const usage = data.usage || {};
  console.log(`[OpenAI] finish_reason=${data.choices?.[0]?.finish_reason} | tokens: prompt=${usage.prompt_tokens} completion=${usage.completion_tokens}`);
  console.log(`[OpenAI] raw response (primeiros 1000 chars):\n${rawContent.slice(0, 1000)}`);

  if (data.choices?.[0]?.finish_reason === 'length') {
    console.warn('[OpenAI] AVISO: resposta cortada (finish_reason=length) — JSON pode estar incompleto');
  }

  return { json: extractJSON(rawContent), rawContent, usage };
}

function extractJSON(text) {
  try { return JSON.parse(text.trim()); } catch (_) {}
  const match = text.match(/\{[\s\S]*\}/);
  if (match) { try { return JSON.parse(match[0]); } catch (_) {} }
  throw new Error('IA não retornou JSON válido. Tente novamente.');
}

// ─── Puppeteer ───────────────────────────────────────────────────────────────

function findChromiumPath() {
  const candidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);
  return candidates.find(p => { try { return fs.existsSync(p); } catch (_) { return false; } }) || null;
}

// onStage(stageName) — callback opcional para notificar progresso
async function scrapeWithBrowser(url, onStage) {
  let puppeteer;
  try { puppeteer = (await import('puppeteer-core')).default; }
  catch (e) { throw new Error('puppeteer-core não encontrado. Execute: npm install puppeteer-core'); }

  const executablePath = findChromiumPath();
  if (!executablePath) throw new Error(
    'Chromium não encontrado. Em Docker, rode: docker compose build backend. ' +
    'Localmente, instale o Google Chrome.'
  );

  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-zygote'],
  });

  try {
    const page = await browser.newPage();

    await page.setRequestInterception(true);
    page.on('request', req => {
      if (['font', 'media'].includes(req.resourceType())) req.abort();
      else req.continue();
    });

    await page.setViewport({ width: 1280, height: 900 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36');

    // ── Helpers ───────────────────────────────────────────────────────────────
    async function scrollFull() {
      await page.evaluate(async () => {
        await new Promise(resolve => {
          let total = 0;
          const h = Math.min(document.body.scrollHeight, 12000);
          const timer = setInterval(() => {
            window.scrollBy(0, 400);
            total += 400;
            if (total >= h) { clearInterval(timer); resolve(); }
          }, 120);
        });
      });
      await new Promise(r => setTimeout(r, 600));
      await page.evaluate(() => window.scrollTo(0, 0));
      await new Promise(r => setTimeout(r, 300));
    }

    async function extractText() {
      return page.evaluate(() => {
        // Extração ancorada em preços + cabeçalhos de categoria (h2/h3).
        // Itera o DOM em ordem para preservar a estrutura de seções.
        // findProductBlock sobe até o MAIOR ancestral ≤ 1000 chars (card completo).
        const priceRe = /R\$\s*\d/;
        const seen = new Set();
        const lines = [];

        function findProductBlock(el) {
          let cur = el;
          let best = (el.innerText || '').replace(/\s+/g, ' ').trim();
          for (let i = 0; i < 8; i++) {
            if (!cur.parentElement || cur.parentElement.tagName === 'BODY') break;
            cur = cur.parentElement;
            const t = (cur.innerText || '').replace(/\s+/g, ' ').trim();
            if (t.length > 1000) break; // container grande demais — para aqui
            if (t.length >= 20) best = t; // continua subindo, prefere o maior
          }
          return best.slice(0, 1000);
        }

        for (const el of document.querySelectorAll('*')) {
          const tag = el.tagName.toLowerCase();
          const rawText = (el.innerText || '').replace(/\s+/g, ' ').trim();

          // Cabeçalhos de categoria (h2, h3 sem preço)
          if ((tag === 'h2' || tag === 'h3') &&
              rawText.length >= 3 && rawText.length <= 80 && !priceRe.test(rawText)) {
            const key = 'h:' + rawText.toLowerCase();
            if (!seen.has(key)) {
              seen.add(key);
              lines.push(`\n=== ${rawText} ===`);
            }
            continue;
          }

          // Blocos de produto: elementos com preço, ≤ 8 filhos, ≤ 1000 chars
          if (el.children.length > 8) continue;
          if (!priceRe.test(rawText)) continue;
          if (rawText.length > 1000) continue;

          const block = findProductBlock(el);
          if (block.length < 15 || seen.has(block)) continue;
          seen.add(block);
          lines.push(block);
        }

        const productCount = lines.filter(l => !l.trim().startsWith('=')).length;
        if (productCount >= 2) {
          return lines.join('\n').slice(0, 12000);
        }

        // Fallback: clone sem navegação (para páginas sem preços explícitos no DOM)
        const clone = document.body?.cloneNode(true);
        if (!clone) return '';
        clone.querySelectorAll('script, style, noscript, head, header, nav, footer, aside, [role="navigation"], [role="banner"], [role="contentinfo"]').forEach(e => e.remove());
        return (clone.innerText || '').replace(/\s{3,}/g, '\n').trim().slice(0, 12000);
      });
    }

    // Remove linhas de navegação/interface que não são itens de menu
    function cleanMenuText(raw) {
      const noiseRe = /fazer login|entrar|cadastr|calcular taxa|taxa de entrega|loja fechada|abre \w+ às|início|pedidos\b|perfil\b|sacola\b|endereço\b|meu pedido|rastrear|suporte|privacidade|termos de uso/i;
      return raw.split('\n').filter(line => !noiseRe.test(line.trim())).join('\n').replace(/\n{3,}/g, '\n\n').trim();
    }

    // ── Carrega a página e aguarda o SPA renderizar ──────────────────────────
    onStage?.('scraping');
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    try { await page.waitForNetworkIdle({ idleTime: 1000, timeout: 8000 }); } catch (_) {}
    await new Promise(r => setTimeout(r, 3000));
    await scrollFull();

    // ── Helper: extrai imagens visíveis da página ────────────────────────────
    async function extractImages(seenSrcs) {
      return page.evaluate((seen) => {
        const result = [];
        document.querySelectorAll('img[src]').forEach(img => {
          if (result.length >= 80) return;
          const src = img.src;
          if (!src?.startsWith('http')) return;
          if (/logo|icon|banner|avatar|flag|arrow|chevron|spinner/i.test(src)) return;
          if ((img.naturalWidth || img.width) <= 60) return;
          if (seen.includes(src)) return;
          const alt = ((img.alt || img.title || img.getAttribute('aria-label') || '').trim()).slice(0, 100);
          const container = img.closest('[class]') || img.parentElement;
          const nearText = ((container?.innerText || '').replace(/\s+/g, ' ').trim()).slice(0, 150);
          result.push({ src, alt, nearText });
        });
        return result;
      }, seenSrcs);
    }

    // Screenshot da viewport (não fullPage) — payload menor para a OpenAI
    // O texto da página já cobre todo o conteúdo; screenshot serve para layout + imagens
    const screenshotBuffer = await page.screenshot({ fullPage: false, type: 'jpeg', quality: 65 });

    const seenImgSrcs = [];
    const initialImgs = await extractImages(seenImgSrcs);
    initialImgs.forEach(i => seenImgSrcs.push(i.src));
    const allImgData = [...initialImgs];

    const initialText = cleanMenuText(await extractText());
    const allTexts = [initialText];

    // ── Detecção de abas: agrupa candidatos por faixa Y e pega o maior grupo ─
    // Abas de categoria em SPAs de delivery ficam numa fileira horizontal.
    // Coleta candidatos de TODOS os seletores sem sair cedo (sem break prematuro),
    // depois escolhe o maior grupo com ≥2 elementos na mesma altura.
    const catTabs = await page.evaluate(() => {
      const priceRe = /R\$[\s\d]/;
      const seenTexts = new Set();
      const candidates = [];
      const selectors = [
        '[role="tab"]',
        '[class*="categor"]', '[class*="Categor"]',
        '[class*="section-tab"]', '[class*="menu-tab"]',
        '[class*="tab-"]', '[class*="-tab"]',
        'nav a', 'nav button', 'nav li',
        'ul li a', 'ul li button',
      ];
      for (const sel of selectors) {
        for (const el of document.querySelectorAll(sel)) {
          const text = (el.innerText || '').trim().replace(/\s+/g, ' ');
          if (text.length < 2 || text.length > 50 || priceRe.test(text)) continue;
          const key = text.toLowerCase();
          if (seenTexts.has(key)) continue;
          seenTexts.add(key);
          const rect = el.getBoundingClientRect();
          if (rect.width < 20 || rect.height < 8) continue;
          candidates.push({
            text,
            x: Math.round(rect.left + rect.width / 2),
            y: Math.round(rect.top + rect.height / 2),
          });
        }
      }
      // Agrupa por faixa Y (bucket de 30px) e seleciona o maior grupo
      const bands = new Map();
      for (const c of candidates) {
        const band = Math.round(c.y / 30) * 30;
        if (!bands.has(band)) bands.set(band, []);
        bands.get(band).push(c);
      }
      let best = [];
      for (const [, group] of bands) {
        if (group.length > best.length) best = group;
      }
      if (best.length < 2) return []; // sem grupo significativo → sem abas
      best.sort((a, b) => a.x - b.x);
      return best.slice(0, 15);
    });

    console.log(`[menuImport] Abas encontradas: ${catTabs.length}${catTabs.length ? ' — ' + catTabs.map(t => `"${t.text}"`).join(', ') : ''}`);

    for (const tab of catTabs) {
      try {
        const urlBefore = page.url();
        await page.mouse.click(tab.x, tab.y);
        await new Promise(r => setTimeout(r, 1800));

        if (page.url() !== urlBefore) {
          // Clique navegou para outra URL — reverter e pular
          try { await page.goBack({ waitUntil: 'domcontentloaded', timeout: 8000 }); } catch (_) {}
          await new Promise(r => setTimeout(r, 800));
          continue;
        }

        try { await page.waitForNetworkIdle({ idleTime: 600, timeout: 3000 }); } catch (_) {}
        await scrollFull();

        const tabText = cleanMenuText(await extractText());
        if (tabText && tabText !== initialText) {
          allTexts.push(`\n=== ${tab.text} ===\n${tabText}`);
          console.log(`[menuImport] Aba "${tab.text}": ${tabText.length} chars`);
        }

        // Coleta imagens novas desta aba
        const tabImgs = await extractImages(seenImgSrcs);
        tabImgs.forEach(i => { seenImgSrcs.push(i.src); allImgData.push(i); });

      } catch (e) {
        console.warn(`[menuImport] Aba "${tab.text}" falhou:`, e.message);
      }
    }

    // Se nenhuma aba acrescentou seção nova (DOM com todos os produtos ao mesmo tempo),
    // injeta os nomes das abas como dica de categoria para o GPT segmentar corretamente.
    if (allTexts.length === 1 && catTabs.length > 0) {
      const catHint = `[Categorias do cardápio: ${catTabs.map(t => t.text).join(' | ')}]\n`;
      allTexts[0] = catHint + allTexts[0];
      console.log(`[menuImport] Nenhuma aba gerou texto diferente — injetando dica de categorias: ${catTabs.map(t => t.text).join(', ')}`);
    }

    const combinedText = allTexts.join('\n').slice(0, 24000);
    console.log(`[menuImport] Texto total: ${combinedText.length} chars (${allTexts.length} seções) | Imagens: ${allImgData.length}`);

    return {
      screenshotBase64: `data:image/jpeg;base64,${screenshotBuffer.toString('base64')}`,
      text: combinedText,
      imgData: allImgData,
      productDetailsText: '',
    };
  } finally {
    await browser.close();
  }
}

// Fallback sem Puppeteer (extrai src e alt do HTML estático)
function stripHtml(html) {
  const imgData = [];
  const seenSrcs = new Set();
  const imgRe = /<img([^>]+)>/gi;
  let m;
  while ((m = imgRe.exec(html)) !== null) {
    if (imgData.length >= 30) break;
    const attrs = m[1];
    const srcM = attrs.match(/src=["']([^"']+)["']/i);
    const altM = attrs.match(/alt=["']([^"']+)["']/i);
    const src = srcM?.[1];
    if (!src?.startsWith('http') || seenSrcs.has(src)) continue;
    if (src.includes('logo') || src.includes('icon') || src.includes('banner')) continue;
    seenSrcs.add(src);
    imgData.push({ src, alt: (altM?.[1] || '').trim().slice(0, 100), nearText: '' });
  }
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/\s{2,}/g, ' ').trim();
  return { text, imgData };
}

// ─── Processamento assíncrono do parse ───────────────────────────────────────

async function runParseJob(jobId, method, input) {
  const job = parseJobs.get(jobId);
  if (!job) return;

  try {
    let parsed;

    if (method === 'link') {
      const url = String(input).trim();
      let screenshotBase64 = null;
      let pageText = '';

      job.stage = 'scraping';
      let imgData = [];
      let productDetailsText = '';
      try {
        console.log(`[menuImport:${jobId}] Abrindo ${url} com Puppeteer...`);
        const result = await scrapeWithBrowser(url, (stage) => { job.stage = stage; });
        screenshotBase64 = result.screenshotBase64;
        pageText = result.text;
        imgData = result.imgData || [];
        productDetailsText = result.productDetailsText || '';
        job.debug = {
          usedPuppeteer: true,
          textLength: pageText.length,
          screenshotTaken: !!screenshotBase64,
          screenshotSizeKB: screenshotBase64 ? Math.round(screenshotBase64.length * 0.75 / 1024) : 0,
          imgDataFound: imgData.length,
          productDetailsChars: productDetailsText.length,
        };
        console.log(`[menuImport:${jobId}] Puppeteer OK — texto: ${pageText.length} chars, screenshot: ${job.debug.screenshotSizeKB}KB, detalhes: ${productDetailsText.length} chars`);
      } catch (puppeteerErr) {
        console.warn(`[menuImport:${jobId}] Puppeteer falhou (${puppeteerErr.message}), usando fallback HTTP`);
        job.debug = { usedPuppeteer: false, puppeteerError: puppeteerErr.message };
        try {
          const response = await axios.get(url, {
            timeout: 12000,
            headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html' },
            maxContentLength: 1024 * 1024,
          });
          const html = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
          const stripped = stripHtml(html);
          pageText = stripped.text;
          imgData = stripped.imgData || [];
          job.debug.textLength = pageText.length;
          job.debug.imgDataFound = imgData.length;
        } catch (axiosErr) {
          throw new Error(`Não foi possível acessar o link: ${axiosErr.message}`);
        }
      }

      job.stage = 'ai_analyzing';

      // Contexto estruturado de imagens para melhor associação produto→imagem
      const imgContext = imgData.slice(0, 40).map((img, i) => {
        let line = `${i + 1}. ${img.src}`;
        if (img.alt) line += ` [alt: "${img.alt}"]`;
        if (img.nearText) line += ` [próximo a: "${img.nearText.slice(0, 80)}"]`;
        return line;
      }).join('\n');

      const detailsSection = productDetailsText
        ? `\n\nDetalhes dos produtos e dados de API (opcionais/complementos — use estes dados para preencher optionGroups de cada item):\n${productDetailsText.slice(0, 18000)}`
        : '';

      // ── DEBUG: logar dados enviados para GPT ──────────────────────────────
      console.log(`\n${'='.repeat(60)}`);
      console.log(`[DEBUG SCRAPE] URL: ${url}`);
      console.log(`[DEBUG SCRAPE] Texto da página (${pageText.length} chars):\n${pageText.slice(0, 600)}`);
      console.log(`[DEBUG SCRAPE] Imagens encontradas: ${imgData.length}`);
      console.log(`[DEBUG SCRAPE] productDetailsText (${productDetailsText.length} chars):\n${productDetailsText.slice(0, 2000)}`);
      console.log(`${'='.repeat(60)}\n`);

      // Atualizar debug no job para ficar visível via polling
      if (job.debug) {
        job.debug.pageTextSample = pageText.slice(0, 400);
        job.debug.productDetailsSample = productDetailsText.slice(0, 800);
        job.debug.imgDataSample = imgData.slice(0, 5).map(i => ({ src: i.src.slice(0, 80), alt: i.alt }));
        job.debug.hasDetails = productDetailsText.length > 0;
      }

      // Não enviamos screenshot para evitar recusa de política de conteúdo da OpenAI
      // (screenshots de SPAs mostram UI com "Fazer login", "Loja Fechada" etc.)
      // O texto extraído por âncora de preços já contém apenas blocos de produtos.
      const userContent =
        `Cardápio de restaurante — extraia todos os produtos com nome, descrição e preço.\n` +
        (imgContext ? `\nImagens da página (associe pelo alt ou texto próximo ao produto correto):\n${imgContext}\n` : '') +
        (pageText ? `\nTexto do cardápio (seções separadas por === quando houver múltiplas categorias):\n${pageText.slice(0, 8000)}` : '') +
        detailsSection;

      const userMessages = [{ role: 'user', content: userContent }];

      const aiResult = await callOpenAI([{ role: 'system', content: SYSTEM_PROMPT }, ...userMessages]);
      parsed = aiResult.json;
      if (job.debug) {
        job.debug.openaiUsage = aiResult.usage;
        job.debug.finishReason = aiResult.rawContent ? (aiResult.rawContent.length < 100 ? aiResult.rawContent : 'ok') : 'empty';
        job.debug.rawResponseSample = aiResult.rawContent?.slice(0, 500);
      }

    } else if (method === 'photo') {
      // Suporta uma ou múltiplas imagens (array de data URLs)
      const images = Array.isArray(input)
        ? input.map(s => String(s).trim()).filter(s => s.startsWith('data:image/'))
        : [String(input).trim()].filter(s => s.startsWith('data:image/'));
      if (!images.length) throw new Error('Nenhuma imagem válida recebida. Envie imagens no formato data:image/...');
      job.stage = 'ai_analyzing';

      // Processa cada imagem individualmente e mescla por categoria
      // (enviar múltiplas imagens juntas faz o GPT ignorar as secundárias)
      const mergedCategories = [];
      const catIndex = new Map(); // key: nome em lowercase → índice em mergedCategories

      for (let i = 0; i < images.length; i++) {
        console.log(`[menuImport:${jobId}] Foto ${i + 1}/${images.length} — chamando OpenAI...`);
        const aiResult = await callOpenAI([
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: [
            {
              type: 'text',
              text: images.length > 1
                ? `Analise esta imagem de cardápio (página ${i + 1} de ${images.length}) e extraia todos os itens com nome, descrição e preço.`
                : 'Analise esta imagem de cardápio e extraia todos os itens com nome, descrição e preço.',
            },
            { type: 'image_url', image_url: { url: images[i], detail: 'high' } },
          ]},
        ]);
        const pageResult = aiResult.json;
        if (!pageResult?.categories) continue;

        for (const cat of pageResult.categories) {
          const catName = String(cat.name || 'Geral').trim();
          const key = catName.toLowerCase();
          if (catIndex.has(key)) {
            // Mescla itens na categoria existente
            mergedCategories[catIndex.get(key)].items.push(...(cat.items || []));
          } else {
            catIndex.set(key, mergedCategories.length);
            mergedCategories.push({ name: catName, items: cat.items || [] });
          }
        }
      }

      parsed = { categories: mergedCategories };

    } else if (method === 'spreadsheet') {
      job.stage = 'ai_analyzing';
      const base64 = String(input).trim();
      const base64Data = base64.includes(',') ? base64.split(',')[1] : base64;
      const buffer = Buffer.from(base64Data, 'base64');
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      if (!sheetName) throw new Error('Planilha vazia ou inválida');
      const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });
      if (!rows.length) throw new Error('Nenhuma linha encontrada na planilha');
      const headers = Object.keys(rows[0] || {});
      const aiResult = await callOpenAI([
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content:
          `Planilha com ${rows.length} linhas.\nColunas: ${headers.join(', ')}\n` +
          `Exemplos: ${JSON.stringify(rows.slice(0, 3), null, 2)}\n` +
          `Todos os dados: ${JSON.stringify(rows.slice(0, 200), null, 2)}\n` +
          `Mapeie as colunas para nome, descrição, preço e categoria.`
        },
      ]);
      parsed = aiResult.json;
    } else {
      throw new Error(`Método desconhecido: ${method}`);
    }

    // Normalizar resultado
    if (!parsed || !Array.isArray(parsed.categories)) {
      throw new Error('A IA não conseguiu extrair itens. Tente com uma foto do cardápio.');
    }

    const categories = parsed.categories
      .map(cat => ({
        name: String(cat.name || 'Geral').trim(),
        items: (cat.items || []).map(item => ({
          name: String(item.name || '').trim(),
          description: String(item.description || '').trim(),
          price: parseFloat(item.price) || 0,
          imageUrl: item.imageUrl && String(item.imageUrl).startsWith('http') ? item.imageUrl : null,
          optionGroups: (item.optionGroups || []).map(og => ({
            name: String(og.name || '').trim(),
            min: parseInt(og.min) || 0,
            max: parseInt(og.max) || 1,
            options: (og.options || []).map(opt => ({
              name: String(opt.name || '').trim(),
              price: parseFloat(opt.price) || 0,
            })).filter(o => o.name),
          })).filter(og => og.name && og.options.length > 0),
        })).filter(item => item.name),
      }))
      .filter(cat => cat.items.length > 0);

    const itemCount = categories.reduce((a, c) => a + c.items.length, 0);
    // Determinar custo por unidade baseado no método de importação
    const serviceKey = job.method === 'photo' ? 'MENU_IMPORT_PHOTO' : 'MENU_IMPORT_ITEM';
    const costPerUnit = AI_SERVICE_COSTS[serviceKey] ?? 1;

    job.done = true;
    job.categories = categories;
    job.rawCount = itemCount;
    job.creditEstimate = { itemCount, serviceKey, costPerUnit, totalCost: itemCount * costPerUnit };

  } catch (e) {
    console.error(`[menuImport:${jobId}] Erro:`, e.message);
    job.done = true;
    job.error = e.message || 'Erro ao processar com IA';
  }

  // Limpar job da memória após 15 minutos
  setTimeout(() => parseJobs.delete(jobId), 15 * 60 * 1000);
}

// ─── POST /menu/ai-import/parse — inicia job, retorna imediatamente ──────────

router.post('/ai-import/parse', async (req, res) => {
  const { method, input } = req.body;
  if (!method || !input) return res.status(400).json({ message: 'method e input são obrigatórios' });

  if (method === 'link') {
    const url = String(input).trim();
    if (!url.startsWith('http')) return res.status(400).json({ message: 'URL inválida. Deve começar com http://' });
  }

  // Verificar se a empresa tem saldo mínimo de créditos antes de iniciar o job
  const companyId = req.user?.companyId;
  if (companyId) {
    const serviceKey = method === 'photo' ? 'MENU_IMPORT_PHOTO' : 'MENU_IMPORT_ITEM';
    const check = await checkCredits(companyId, serviceKey, 1);
    if (!check.ok) {
      const now = new Date();
      const nextReset = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      return res.status(402).json({
        message: 'Créditos de IA insuficientes. Seu saldo está zerado.',
        balance: check.balance,
        monthlyLimit: check.monthlyLimit,
        nextReset,
      });
    }
  }

  const jobId = randomUUID();
  parseJobs.set(jobId, { done: false, categories: null, error: null, rawCount: 0, stage: 'pending', debug: {}, method });

  // Responde imediatamente — processa em segundo plano (igual customers/import)
  res.json({ jobId });

  runParseJob(jobId, method, input).catch(e => {
    const job = parseJobs.get(jobId);
    if (job) { job.done = true; job.error = e.message; }
  });
});

// ─── GET /menu/ai-import/parse/:jobId — polling de status ───────────────────

router.get('/ai-import/parse/:jobId', (req, res) => {
  const job = parseJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ message: 'Job não encontrado ou expirado' });
  res.json(job);
});

// ─── POST /menu/ai-import/apply ──────────────────────────────────────────────

router.post('/ai-import/apply', async (req, res) => {
  try {
    const { menuId, overwrite, categories } = req.body;
    const companyId = req.user?.companyId;

    if (!menuId) return res.status(400).json({ message: 'menuId é obrigatório' });
    if (!companyId) return res.status(401).json({ message: 'Não autenticado' });
    if (!Array.isArray(categories) || !categories.length) return res.status(400).json({ message: 'Nenhuma categoria para importar' });

    const menu = await prisma.menu.findFirst({ where: { id: menuId, store: { company: { id: companyId } } } });
    if (!menu) return res.status(404).json({ message: 'Cardápio não encontrado' });

    // ── Verificação e débito de créditos de IA ──
    const totalItems = categories.reduce((sum, cat) => sum + (cat.items?.length ?? 0), 0);
    if (totalItems > 0) {
      const check = await checkCredits(companyId, 'MENU_IMPORT_ITEM', totalItems);
      if (!check.ok) {
        const now = new Date();
        const nextReset = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        return res.status(402).json({
          message: `Créditos de IA insuficientes. Esta importação requer ${check.totalCost} crédito(s), mas você possui apenas ${check.balance}.`,
          required: check.totalCost,
          balance: check.balance,
          nextReset,
        });
      }
      await debitCredits(
        companyId,
        'MENU_IMPORT_ITEM',
        totalItems,
        { menuId, itemCount: totalItems, source: 'menu_import_apply' },
        req.user?.id,
      );
    }
    // ────────────────────────────────────────────

    if (overwrite) {
      // 1. Remover vínculos ProductOptionGroup antes de deletar os produtos (FK constraint)
      const productsToDelete = await prisma.product.findMany({
        where: { menuId, companyId },
        select: { id: true },
      });
      if (productsToDelete.length > 0) {
        const ids = productsToDelete.map(p => p.id);
        await prisma.productOptionGroup.deleteMany({ where: { productId: { in: ids } } });
      }
      // 2. Deletar produtos e categorias
      await prisma.product.deleteMany({ where: { menuId, companyId } });
      await prisma.menuCategory.deleteMany({ where: { menuId, companyId } });
    }

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    let totalCategories = 0, totalProducts = 0, totalOptionGroups = 0;

    // Cache de OptionGroups criados nesta importação (e existentes no banco) para evitar duplicatas
    // Chave: nome em lowercase → OptionGroup.id
    const optionGroupCache = new Map();

    async function resolveOptionGroup(og) {
      const groupName = String(og.name || '').trim();
      if (!groupName) return null;
      const key = groupName.toLowerCase();

      // Já resolvido nesta importação?
      if (optionGroupCache.has(key)) return optionGroupCache.get(key);

      // Já existe no banco para esta empresa?
      const existing = await prisma.optionGroup.findFirst({ where: { companyId, name: groupName } });
      if (existing) {
        optionGroupCache.set(key, existing.id);
        return existing.id;
      }

      // Criar novo OptionGroup com suas opções
      const newGroup = await prisma.optionGroup.create({
        data: {
          companyId,
          name: groupName,
          min: parseInt(og.min) || 0,
          max: parseInt(og.max) || 1,
          isActive: true,
          options: {
            create: (og.options || []).map((opt, pi) => ({
              name: String(opt.name || '').trim(),
              price: parseFloat(opt.price) || 0,
              isAvailable: true,
              position: pi,
            })).filter(o => o.name),
          },
        },
      });
      optionGroupCache.set(key, newGroup.id);
      totalOptionGroups++;
      return newGroup.id;
    }

    for (let ci = 0; ci < categories.length; ci++) {
      const cat = categories[ci];
      const items = Array.isArray(cat.items) ? cat.items : [];
      if (!items.length) continue;

      const newCat = await prisma.menuCategory.create({
        data: { companyId, menuId, name: String(cat.name || 'Geral').trim(), isActive: true, position: ci },
      });
      totalCategories++;

      for (let pi = 0; pi < items.length; pi++) {
        const item = items[pi];
        const name = String(item.name || '').trim();
        if (!name) continue;

        const newProd = await prisma.product.create({
          data: {
            companyId, menuId, categoryId: newCat.id, name,
            description: String(item.description || '').trim() || null,
            price: parseFloat(item.price) || 0, isActive: true, position: pi,
          },
        });
        totalProducts++;

        if (item.imageUrl?.startsWith('http')) {
          downloadAndSaveProductImage(newProd.id, item.imageUrl, baseUrl, companyId, name);
        }

        // Criar/linkar option groups
        for (const og of (item.optionGroups || [])) {
          const groupId = await resolveOptionGroup(og);
          if (!groupId) continue;
          // Cria o vínculo Product ↔ OptionGroup (ignora se já existe)
          await prisma.productOptionGroup.upsert({
            where: { productId_groupId: { productId: newProd.id, groupId } },
            update: {},
            create: { productId: newProd.id, groupId },
          });
        }
      }
    }

    return res.json({ success: true, created: { categories: totalCategories, products: totalProducts, optionGroups: totalOptionGroups } });

  } catch (e) {
    console.error('[menuImport/apply]', e);
    return res.status(500).json({ message: e.message || 'Erro ao importar cardápio' });
  }
});

// ─── Image downloader (fire-and-forget) ──────────────────────────────────────

async function downloadAndSaveProductImage(productId, imageUrl, baseUrl, companyId, productName) {
  try {
    let origin = '';
    try { origin = new URL(imageUrl).origin; } catch (_) {}
    const resp = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 12000,
      maxRedirects: 5,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        ...(origin ? { 'Referer': origin + '/' } : {}),
      },
    });
    const contentType = resp.headers['content-type'] || 'image/jpeg';
    const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : contentType.includes('gif') ? 'gif' : 'jpg';
    const uploadsDir = path.join(__dirname, '../../public/uploads/products');
    fs.mkdirSync(uploadsDir, { recursive: true });
    const fileName = `${productId}.${ext}`;
    const filePath = path.join(uploadsDir, fileName);
    fs.writeFileSync(filePath, resp.data);
    const imagePublicUrl = `${baseUrl}/public/uploads/products/${fileName}`;
    await prisma.product.update({ where: { id: productId }, data: { image: imagePublicUrl } });

    // Registrar na biblioteca de mídia da empresa
    if (companyId) {
      const mimeType = contentType.split(';')[0].trim();
      const displayName = productName ? `${productName}.${ext}` : fileName;
      await prisma.media.create({
        data: {
          id: randomUUID(),
          companyId,
          filename: displayName,
          mimeType,
          size: resp.data.byteLength,
          url: imagePublicUrl,
        },
      });
    }

    console.log(`[menuImport] Imagem salva: ${fileName} (${Math.round(resp.data.byteLength / 1024)}KB)`);
  } catch (e) {
    console.warn(`[menuImport] image download failed for ${productId}: ${e.message}`);
  }
}

export default router;
