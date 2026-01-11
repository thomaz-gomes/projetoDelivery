import axios from 'axios';
import { API_URL } from './config';

const api = axios.create({
  baseURL: API_URL,
  withCredentials: true, // permitir envio de cookie public_phone para sessão pública
  timeout: 15000,
});

api.interceptors.request.use((cfg) => {
  const token = localStorage.getItem('token');
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

// Global response interceptor to handle auth expiration (401)
api.interceptors.response.use(
  (r) => r,
  (err) => {
    try {
      if (err && err.response && err.response.status === 401) {
        const skipRedirect = err.config && err.config.headers && (err.config.headers['x-no-redirect'] || err.config.headers['X-No-Redirect'])
        const hadToken = !!localStorage.getItem('token');
        const authHeader = err.config && err.config.headers && (err.config.headers.Authorization || err.config.headers.authorization);
        // If caller asked to skip redirect, just reject so callers can handle inline
        if (skipRedirect) return Promise.reject(err)

        // Only treat 401 as session-expired when we previously had a token or the request carried an auth header
        if (hadToken || authHeader) {
          try { localStorage.removeItem('token'); } catch(e){}
          try { alert('Sessão expirada. Faça login novamente.'); } catch(e){}
          if (typeof window !== 'undefined') window.location.href = '/login';
        }
        // otherwise, it's an unauthenticated public request — just reject silently
      }
    } catch (e) {}
    return Promise.reject(err);
  }
);

export default api;