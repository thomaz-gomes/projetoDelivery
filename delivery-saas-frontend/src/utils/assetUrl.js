// Resolve asset URLs returned by the backend (which may be relative paths
// like `/public/...` or `/settings/...`). When a path is relative to the
// backend, prefix it with the API base URL so the browser loads it from the
// backend origin rather than the frontend dev server.
import { API_URL } from '../config';

// Development-time defensive adjustment:
// Some developers set `VITE_API_URL` to an HTTPS dev host with invalid
// certificates (e.g. `https://dev.rede...:3000`). Browsers then show
// repeated TLS errors when trying to load backend-hosted assets.
// To reduce noisy console errors during local development, when running
// in Vite's DEV mode and the API_URL looks like a `https://dev...` host,
// prefer the same host using `http://` instead of `https://` so the
// browser attempts a plain HTTP request (developers can still fix their
// env or provide proper certs if needed).
const adjustedApiUrl = (() => {
  try {
    const base = String(API_URL || '');
    if (import.meta.env && import.meta.env.DEV && base.startsWith('https://')) {
      // If host looks like a dev hostname (contains 'dev.') prefer http
      if (/\bdev\.[\w.-]+/i.test(base)) {
        return base.replace(/^https:\/\//i, 'http://');
      }
    }
    return base;
  } catch (e) {
    return API_URL;
  }
})();

export function assetUrl(u){
  try{
    if(!u) return u
    const s = String(u || '')
  // data URLs, blob URLs and absolute URLs should be returned as-is
  if(s.startsWith('data:') || s.startsWith('blob:') || s.startsWith('http://') || s.startsWith('https://')) return s
    // if it's an absolute path (starts with /), assume it's meant for the backend
    const base = adjustedApiUrl || API_URL
    if(s.startsWith('/')){
      // avoid double slash when base ends with '/'
      return `${base.replace(/\/$/, '')}${s}`
    }
    // handle common backend-relative paths that may lack a leading slash
    // examples: 'public/uploads/..', 'settings/stores/...', 'uploads/...'
    if(/^(public|settings|uploads)\//i.test(s)){
      return `${base.replace(/\/$/, '')}/${s.replace(/^\/+/, '')}`
    }
    // otherwise it's a relative path (already served by frontend public folder)
    return s
  }catch(e){ return u }
}
