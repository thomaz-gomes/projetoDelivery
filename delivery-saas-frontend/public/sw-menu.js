/* Service Worker — Core Delivery Menu Offline Cache
 *
 * Estratégias:
 *  - App shell (HTML + JS/CSS do Vite): network-first com fallback para cache
 *  - Imagens de produto:               cache-first
 *  - GC via postMessage:               remove imagens órfãs
 */

const IMAGE_CACHE = 'menu-images-v1';
const SHELL_CACHE  = 'app-shell-v1';

// ── Helpers ────────────────────────────────────────────────────────────────

const isImageRequest = (url) =>
  url.includes('/public/uploads/') || url.includes('/uploads/') || url.includes('/settings/stores/');

// Não interceptar: HMR interno do Vite (quebraria hot-reload em dev)
const isViteHmr = (url) =>
  url.includes('/__vite_') || url.includes('/@vite/client') || url.includes('/socket.io');

// Módulos JS/CSS servidos pelo Vite (mesma origem do SW)
const isStaticAsset = (url, origin) => {
  try {
    const { pathname, origin: o } = new URL(url);
    if (o !== origin) return false;
    return (
      pathname.startsWith('/src/') ||
      pathname.startsWith('/assets/') ||
      pathname.startsWith('/node_modules/') ||
      pathname.endsWith('.js') ||
      pathname.endsWith('.css') ||
      pathname.endsWith('.svg') ||
      pathname.endsWith('.png') ||
      pathname.endsWith('.webp')
    );
  } catch { return false; }
};

// ── Lifecycle ─────────────────────────────────────────────────────────────

self.addEventListener('install', (event) => {
  // Pré-cachear o shell HTML mínimo ('/') para permitir boot offline
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => cache.add('/').catch(() => { /* ignora se Vite não está rodando */ }))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// ── Fetch ─────────────────────────────────────────────────────────────────

self.addEventListener('fetch', (event) => {
  const { url, method } = event.request;
  if (method !== 'GET') return;
  if (isViteHmr(url)) return;

  // 1. Imagens dos produtos: cache-first
  if (isImageRequest(url)) {
    event.respondWith(handleImage(event.request));
    return;
  }

  // 2. Navegação (requisições HTML/SPA): network-first com fallback para shell
  if (event.request.mode === 'navigate') {
    event.respondWith(handleNavigation(event.request));
    return;
  }

  // 3. Módulos JS/CSS do Vite: stale-while-revalidate
  //    Normaliza o cache key removendo query params (?t=xxx do Vite)
  if (isStaticAsset(url, self.location.origin)) {
    event.respondWith(handleStaticAsset(event.request, url));
    return;
  }
});

// ── Estratégias de fetch ──────────────────────────────────────────────────

/** Navegação: tenta rede, cai no shell cacheado se offline */
async function handleNavigation(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      // Atualiza o shell em cache com a resposta mais recente
      caches.open(SHELL_CACHE)
        .then(c => c.put('/', response.clone()))
        .catch(() => {});
    }
    return response;
  } catch {
    const cached = await caches.match('/');
    if (cached) return cached;
    // Fallback mínimo se nada estiver em cache
    return new Response(
      '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Offline</title></head>' +
      '<body style="font-family:sans-serif;text-align:center;padding:60px">' +
      '<h2>&#x1F4F5; Sem conexão</h2>' +
      '<p>Carregue o cardápio online pelo menos uma vez para ativar o modo offline.</p>' +
      '<button onclick="location.reload()">Tentar novamente</button>' +
      '</body></html>',
      { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }
}

/** Assets estáticos: stale-while-revalidate com key normalizada (sem ?t=xxx) */
async function handleStaticAsset(request, rawUrl) {
  // Normaliza URL removendo query string (Vite usa ?t=timestamp em dev)
  let cacheKey;
  try {
    const u = new URL(rawUrl);
    cacheKey = u.origin + u.pathname;
  } catch {
    cacheKey = rawUrl;
  }
  const normalizedRequest = new Request(cacheKey);

  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(normalizedRequest);

  if (cached) {
    // Retorna o cache imediatamente e atualiza em background
    fetch(request).then(res => {
      if (res && res.ok) cache.put(normalizedRequest, res.clone()).catch(() => {});
    }).catch(() => {});
    return cached;
  }

  // Sem cache: busca na rede
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(normalizedRequest, response.clone()).catch(() => {});
    return response;
  } catch {
    return new Response('', { status: 404 });
  }
}

/** Imagens: cache-first */
async function handleImage(request) {
  try {
    const cache = await caches.open(IMAGE_CACHE);
    const cached = await cache.match(request);
    if (cached) return cached;

    const response = await fetch(request);
    // Cache both normal (ok) and opaque (cross-origin no-cors) responses.
    // Opaque responses have status 0 and ok=false but contain valid image data.
    if (response && (response.ok || response.type === 'opaque')) {
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch {
    return new Response('', { status: 404, headers: { 'Content-Type': 'text/plain' } });
  }
}

// ── GC via postMessage ────────────────────────────────────────────────────

self.addEventListener('message', async (event) => {
  if (!event.data || event.data.type !== 'GC_MENU_IMAGES') return;

  const keepSet = new Set(event.data.keepUrls || []);
  try {
    const cache = await caches.open(IMAGE_CACHE);
    const keys = await cache.keys();
    let removed = 0;
    for (const req of keys) {
      if (!keepSet.has(req.url)) {
        await cache.delete(req);
        removed++;
      }
    }
    if (removed > 0) console.log(`[SW] GC: removeu ${removed} imagem(ns) órfã(s)`);
    if (event.source) event.source.postMessage({ type: 'GC_DONE', removed });
  } catch (e) {
    console.warn('[SW] GC error', e);
  }
});
