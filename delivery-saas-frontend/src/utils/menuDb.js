/**
 * menuDb.js — IndexedDB wrapper for offline menu snapshots.
 * Uses only native IndexedDB APIs (no extra dependencies).
 *
 * Schema:
 *   DB:    menu-offline  (v1)
 *   Store: snapshots     (keyPath = cacheKey string)
 *   Value: { cacheKey, savedAt: timestamp, data: APIPayload }
 */

const DB_NAME = 'menu-offline';
const DB_VERSION = 1;
const STORE_NAME = 'snapshots';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME); // out-of-line key (cacheKey string)
      }
    };

    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Load a menu snapshot from IndexedDB.
 * @param {string} cacheKey
 * @returns {Promise<{ cacheKey, savedAt, data } | null>}
 */
export async function loadMenuSnapshot(cacheKey) {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(cacheKey);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.warn('[menuDb] load error', e);
    return null;
  }
}

/**
 * Persist a menu payload snapshot to IndexedDB.
 * Overwrites any existing snapshot for this cacheKey.
 * @param {string} cacheKey
 * @param {object} data  — raw API payload ({ categories, company, menu, … })
 */
export async function saveMenuSnapshot(cacheKey, data) {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const req = tx.objectStore(STORE_NAME).put(
        { cacheKey, savedAt: Date.now(), data },
        cacheKey
      );
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.warn('[menuDb] save error', e);
  }
}

/**
 * Remove a specific snapshot from IndexedDB.
 * @param {string} cacheKey
 */
export async function deleteMenuSnapshot(cacheKey) {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const req = tx.objectStore(STORE_NAME).delete(cacheKey);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.warn('[menuDb] delete error', e);
  }
}
