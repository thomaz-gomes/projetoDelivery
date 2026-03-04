/**
 * menuOfflineSync.js — Utilities for menu offline sync, image precaching and GC.
 *
 * Responsibilities:
 *  1. extractMenuImageUrls(data)  — collect every image URL from a menu payload
 *  2. precacheMenuImages(urls)    — proactively trigger browser fetch so SW caches them
 *  3. gcMenuImages(keepUrls)      — ask SW (or Cache API directly) to purge orphaned images
 *  4. registerMenuServiceWorker() — register /sw-menu.js once
 */

import { assetUrl } from './assetUrl.js';

const IMAGE_CACHE_NAME = 'menu-images-v1';

// ── Image URL extraction ───────────────────────────────────────────────────────

/**
 * Walk the full menu API payload and return every absolute image URL.
 * Includes product images, option images (+ their thumbs), banners and logos.
 *
 * @param {object} data  — raw API payload from GET /public/:companyId/menu
 * @returns {string[]}   — deduplicated list of absolute URLs
 */
export function extractMenuImageUrls(data) {
  if (!data) return [];

  const urls = new Set();

  const addPath = (path) => {
    if (!path) return;
    try {
      const resolved = assetUrl(path);
      if (!resolved) return;
      // Ensure we always store an absolute URL for cache key consistency
      const abs =
        resolved.startsWith('http')
          ? resolved
          : location.origin + (resolved.startsWith('/') ? resolved : '/' + resolved);
      urls.add(abs);
    } catch {}
  };

  // Products inside categories
  for (const cat of data.categories || []) {
    for (const p of cat.products || []) {
      addPath(p.image);
      for (const g of p.optionGroups || []) {
        for (const o of g.options || []) {
          addPath(o.image);
          // Also cache the thumbnail variant used by optionThumbUrl()
          if (o.image) {
            if (o.image.includes('/public/uploads/options/')) {
              addPath(o.image.replace('/public/uploads/options/', '/public/uploads/options/thumbs/'));
            } else if (o.image.includes('public/uploads/options/')) {
              addPath(o.image.replace('public/uploads/options/', 'public/uploads/options/thumbs/'));
            }
          }
        }
      }
    }
  }

  // Uncategorized products
  for (const p of data.uncategorized || []) {
    addPath(p.image);
  }

  // Company assets
  const c = data.company;
  if (c) {
    addPath(c.banner);
    addPath(c.logo);
    if (c.store) {
      addPath(c.store.banner);
      addPath(c.store.logo);
      addPath(c.store.logoUrl);
    }
  }

  // Menu assets
  if (data.menu) {
    addPath(data.menu.banner);
    addPath(data.menu.logo);
  }

  return [...urls].filter(Boolean);
}

// ── Proactive caching ─────────────────────────────────────────────────────────

/**
 * Trigger browser image loads so the Service Worker intercepts and caches them.
 * Uses hidden <img> elements to avoid CORS complexity and stay within SW scope.
 *
 * @param {string[]} urls
 */
export function precacheMenuImages(urls) {
  if (!urls || !urls.length) return;
  // Defer to avoid blocking the render
  setTimeout(() => {
    for (const url of urls) {
      try {
        const img = new Image();
        img.src = url;
      } catch {}
    }
  }, 500);
}

// ── Garbage Collection ────────────────────────────────────────────────────────

/**
 * Remove cached images that are no longer referenced by the current menu.
 * Prefers delegating to the Service Worker via postMessage so GC runs off
 * the main thread. Falls back to direct Cache API access when no SW is active.
 *
 * @param {string[]} keepUrls — URLs that MUST be kept (all current menu images)
 */
export async function gcMenuImages(keepUrls) {
  if (!('caches' in window)) return;

  try {
    const keepSet = new Set(keepUrls);

    // Prefer SW-based GC (runs in background)
    if (navigator.serviceWorker?.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: 'GC_MENU_IMAGES',
        keepUrls: [...keepSet],
      });
      return;
    }

    // Fallback: direct Cache API access on the main thread
    const cache = await caches.open(IMAGE_CACHE_NAME);
    const keys = await cache.keys();
    const orphans = keys.filter((req) => !keepSet.has(req.url));
    if (orphans.length) {
      await Promise.allSettled(orphans.map((req) => cache.delete(req)));
      console.log(`[menuOfflineSync] GC removed ${orphans.length} orphan image(s)`);
    }
  } catch (e) {
    console.warn('[menuOfflineSync] GC error', e);
  }
}

// ── Service Worker registration ───────────────────────────────────────────────

let _swRegistered = false;

/**
 * Register the menu Service Worker (/sw-menu.js) once per page lifetime.
 * Safe to call multiple times.
 */
export function registerMenuServiceWorker() {
  if (_swRegistered || !('serviceWorker' in navigator)) return;
  _swRegistered = true;

  navigator.serviceWorker
    .register('/sw-menu.js', { scope: '/' })
    .then((reg) => {
      console.log('[SW] Menu service worker registered, scope:', reg.scope);
    })
    .catch((e) => {
      console.warn('[SW] Menu service worker registration failed:', e);
    });
}
