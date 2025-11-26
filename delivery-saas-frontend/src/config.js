// Centralized runtime configuration for the frontend
// Exposes API and Socket URLs and falls back to sensible defaults for local dev.
// Important dev case: when Vite serves the frontend over HTTPS (location.protocol === 'https:')
// and the backend only exposes HTTP (http://localhost:3000), the browser will block
// mixed-content requests. To avoid that, leave VITE_API_URL empty for local dev and
// use the Vite proxy (configured in vite.config.js) so the browser talks to the
// dev server origin and Vite forwards proxied requests to the backend.

const rawApiEnv = import.meta.env.VITE_API_URL;
let API_URL;

// Developer convenience: when running Vite in DEV mode and no explicit
// VITE_API_URL is provided, default to the "'/api'" prefix so that
// the dev server proxy (configured in vite.config.js) forwards requests
// to the backend. This keeps code using absolute paths like '/orders'
// intact if they call '/api/orders' or allows easy migration.
// If VITE_API_URL explicitly points to localhost, prefer using '/api' as well
// so the dev proxy is used instead of making direct cross-origin calls.
if (import.meta.env.DEV) {
  // In local dev prefer using the dev server origin so Vite's proxy forwards
  // requests to the backend. If the developer explicitly sets VITE_API_URL,
  // use it; otherwise leave API_URL empty so calls like `api.get('/agent-setup')`
  // are issued to the dev server origin and proxied by Vite to the backend.
  if (!rawApiEnv || String(rawApiEnv).trim() === '') {
    API_URL = '';
  } else {
    API_URL = String(rawApiEnv).trim();
  }
} else {
  API_URL = String(rawApiEnv).trim();
}

// SOCKET_URL: if explicitly provided use it; if empty and API_URL is relative,
// keep SOCKET_URL undefined so socket.io-client connects to the current origin
// (the dev server) and the proxy can forward WebSocket upgrade to the backend.
const rawSocketEnv = import.meta.env.VITE_SOCKET_URL;
let SOCKET_URL;
if (rawSocketEnv === undefined || rawSocketEnv === null || String(rawSocketEnv).trim() === '') {
  // If API_URL is an absolute URL (dev: http://localhost:3000) use it as
  // the socket endpoint. Otherwise leave undefined so socket.io-client
  // connects to same origin (useful when relying on Vite proxy).
  if (API_URL && (API_URL.startsWith('http://') || API_URL.startsWith('https://'))) {
    SOCKET_URL = API_URL;
  } else {
    SOCKET_URL = undefined;
  }
} else {
  SOCKET_URL = String(rawSocketEnv).trim();
}

export { API_URL, SOCKET_URL };
export default { API_URL, SOCKET_URL };
