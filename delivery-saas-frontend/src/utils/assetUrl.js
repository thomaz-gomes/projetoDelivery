// Resolve asset URLs returned by the backend (which may be relative paths
// like `/public/...` or `/settings/...`). When a path is relative to the
// backend, prefix it with the API base URL so the browser loads it from the
// backend origin rather than the frontend dev server.
export function assetUrl(u){
  try{
    if(!u) return u
    const s = String(u || '')
  // data URLs, blob URLs and absolute URLs should be returned as-is
  if(s.startsWith('data:') || s.startsWith('blob:') || s.startsWith('http://') || s.startsWith('https://')) return s
    // if it's an absolute path (starts with /), assume it's meant for the backend
    const base = (import.meta.env.VITE_API_URL && import.meta.env.VITE_API_URL !== '') ? import.meta.env.VITE_API_URL : 'https://localhost:3000'
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
