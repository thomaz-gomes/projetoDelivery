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
    console.log('[menuDb] loading snapshot, key:', cacheKey);
    const db = await openDb();
    const result = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(cacheKey);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
    console.log('[menuDb] load result:', result ? `found (savedAt: ${new Date(result.savedAt).toLocaleString()}, categories: ${result.data?.categories?.length})` : 'null');
    return result;
  } catch (e) {
    console.error('[menuDb] load error', e);
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
    console.log('[menuDb] saving snapshot, key:', cacheKey, 'has data:', !!data, 'categories:', data?.categories?.length);
    const db = await openDb();
    console.log('[menuDb] db opened, stores:', [...db.objectStoreNames]);
    // Clone data to strip any non-serializable content (Vue proxies, etc.)
    const plainData = JSON.parse(JSON.stringify(data));
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.oncomplete = () => { console.log('[menuDb] transaction committed'); resolve(); };
      tx.onerror = (e) => { console.error('[menuDb] transaction error', e); reject(tx.error); };
      tx.onabort = (e) => { console.error('[menuDb] transaction aborted', tx.error); reject(tx.error); };
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(
        { cacheKey, savedAt: Date.now(), data: plainData },
        cacheKey
      );
      req.onsuccess = () => console.log('[menuDb] put request succeeded');
      req.onerror = () => { console.error('[menuDb] put request error', req.error); reject(req.error); };
    });
    console.log('[menuDb] snapshot saved successfully');
  } catch (e) {
    console.error('[menuDb] save error', e);
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
