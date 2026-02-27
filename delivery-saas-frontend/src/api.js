import axios from 'axios';
import { API_URL } from './config';

const api = axios.create({
  baseURL: API_URL,
  withCredentials: true, // permitir envio de cookie public_phone para sessão pública
  timeout: 15000,
});

api.interceptors.request.use((cfg) => {
  const url = String(cfg.url || '');
  // For public customer routes (/public/<companyId>/...) use a namespaced token so
  // it never conflicts with the admin session token stored under 'token'.
  const publicMatch = url.match(/^\/public\/([^/]+)/);
  if (publicMatch) {
    const cid = publicMatch[1];
    const publicToken = localStorage.getItem(`public_token_${cid}`);
    if (publicToken) cfg.headers.Authorization = `Bearer ${publicToken}`;
    // Do NOT fall through to the admin token for public routes
  } else {
    const token = localStorage.getItem('token');
    if (token) cfg.headers.Authorization = `Bearer ${token}`;
  }
  return cfg;
});

// Global response interceptor to handle auth expiration (401)
api.interceptors.response.use(
  (r) => r,
  (err) => {
    try {
      if (err && err.response && err.response.status === 401) {
        const url = String((err.config && err.config.url) || '');
        const isPublicRoute = url.startsWith('/public/');
        const skipRedirect = err.config && err.config.headers && (err.config.headers['x-no-redirect'] || err.config.headers['X-No-Redirect'])

        // Public routes and explicit skip-redirect callers should never destroy the admin session
        if (isPublicRoute || skipRedirect) return Promise.reject(err)

        const hadToken = !!localStorage.getItem('token');
        const authHeader = err.config && err.config.headers && (err.config.headers.Authorization || err.config.headers.authorization);

        // Only treat 401 as session-expired when we previously had an admin token
        if (hadToken || authHeader) {
          try { localStorage.removeItem('token'); } catch(e){}
          try { alert('Sessão expirada. Faça login novamente.'); } catch(e){}
          if (typeof window !== 'undefined') window.location.href = '/login';
        }
      }
    } catch (e) {}
    return Promise.reject(err);
  }
);

export default api;