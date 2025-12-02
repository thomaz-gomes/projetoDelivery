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
// `VITE_API_URL` is provided, the default behavior used to rely on the
// dev server proxy (empty `API_URL`) so requests were issued to the dev
// server origin and forwarded to the backend. However, when the backend
// is running in plain HTTP (DISABLE_SSL=1) the dev server proxy can cause
// the frontend to route calls to the dev origin (port 5173) which is not
// the backend. To avoid the frontend accidentally calling port 5173 for
// backend agent endpoints in local dev, if SSL is disabled prefer a direct
// `http://localhost:3000` backend URL unless the developer explicitly sets
// `VITE_API_URL`.
if (import.meta.env.DEV) {
  const disableSsl = import.meta.env.DISABLE_SSL === '1' || import.meta.env.VITE_DISABLE_SSL === '1';
  if (rawApiEnv && String(rawApiEnv).trim() !== '') {
    API_URL = String(rawApiEnv).trim();
  } else if (disableSsl) {
    API_URL = 'http://localhost:3000';
  } else {
    // Fall back to localhost backend for developer convenience when no
    // explicit VITE_API_URL is provided. Using an absolute backend URL
    // avoids relying on Vite proxy rules and prevents the dev server from
    // answering unknown API routes with a 404 (see reported "Cannot PATCH /orders/...").
    API_URL = 'http://localhost:3000';
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
