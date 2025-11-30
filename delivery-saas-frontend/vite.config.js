import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import fs from "fs";
import path from "path";
// Explicitly load dotenv for the dev server so VITE_API_URL / DISABLE_SSL
// from `.env.development` are available when running `npm run dev` from
// different shells or tools that may not automatically load env files.
try {
  const dotenv = await import('dotenv');
  const mode = process.env.NODE_ENV || 'development';
  const envPath = path.resolve(__dirname, `.env.${mode}`);
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
    console.log('Loaded env file for Vite:', envPath);
  }
} catch (e) {
  // ignore if dotenv not available or import fails
}

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  server: {
  // To use a custom certificate for dev.redemultilink.com.br, place these files under
    // <project>/delivery-saas-frontend/ssl/:
    // - private.key (your private key)
    // - certificate.crt (server certificate)
    // - ca_bundle.crt (optional CA bundle / chain)
    https: (function() {
      try {
        // Enable HTTPS only when explicitly requested via VITE_DEV_HTTPS=1.
        // Default is to start the dev server without TLS to avoid mixed-content
        // issues during development.
        if (String(process.env.VITE_DEV_HTTPS || '').toLowerCase() !== '1') return false;

        const sslDir = path.resolve(__dirname, './ssl');
        const backendSslDir = path.resolve(__dirname, '../delivery-saas-backend/ssl');
        const keyPath = fs.existsSync(path.join(sslDir, 'private.key')) ? path.join(sslDir, 'private.key') : path.join(backendSslDir, 'localhost-key.pem');
        const certPath = fs.existsSync(path.join(sslDir, 'certificate.crt')) ? path.join(sslDir, 'certificate.crt') : path.join(backendSslDir, 'localhost-crt.pem');
        const caPath = fs.existsSync(path.join(sslDir, 'ca_bundle.crt')) ? path.join(sslDir, 'ca_bundle.crt') : path.join(backendSslDir, 'localhost-chain.pem');

        const opts = {};
        if (fs.existsSync(keyPath)) opts.key = fs.readFileSync(keyPath);
        if (fs.existsSync(certPath)) opts.cert = fs.readFileSync(certPath);
        // prefer explicit ca bundle if provided
        if (fs.existsSync(caPath)) opts.ca = fs.readFileSync(caPath);

        // if none found, return false to let Vite start without HTTPS
        if (!opts.key || !opts.cert) return false;
        return opts;
      } catch (e) {
        console.warn('Failed to load SSL certs for dev host', e.message);
        return false;
      }
    })(),
  // Allow overriding the dev host via env (VITE_DEV_HOST) so you can run on localhost or a custom dev domain
  host: process.env.VITE_DEV_HOST || process.env.HOST || 'localhost',
    port: process.env.VITE_PORT ? Number(process.env.VITE_PORT) : 5173,
    // Proxy API requests to the backend during local development to avoid CORS.
    // Prefer an explicit `VITE_API_URL` if provided (works reliably even when
    // environment vars are not loaded the same way in different shells). If
    // `VITE_API_URL` is not set, fall back to the DISABLE_SSL heuristic.
    proxy: (function() {
      let target = null;
      // Prefer explicit VITE_API_URL if present (this should be set in .env.development)
      if (process.env.VITE_API_URL) {
        target = process.env.VITE_API_URL.replace(/\/$/, '');
      } else {
        const backendProto = (String(process.env.DISABLE_SSL || '').toLowerCase() === '1') ? 'http' : 'https';
        target = `${backendProto}://localhost:3000`;
      }
      // ensure target has protocol
      if (!/^https?:\/\//i.test(target)) target = `http://${target}`;
      try { console.log('Vite proxy target resolved to:', target); } catch(e) {}
      // Prefer HTTP for agent endpoints during local development to avoid
      // TLS/EPROTO errors when backend runs with DISABLE_SSL=1.
      const agentTarget = (String(process.env.DISABLE_SSL || '').toLowerCase() === '1') ? 'http://localhost:3000' : target;
      try { console.log('Vite proxy agent endpoints target:', agentTarget); } catch(e) {}
      return {
        '/api': { target, changeOrigin: true, secure: false },
        '/auth': { target, changeOrigin: true, secure: false },
        '/socket.io': { target: agentTarget, ws: true, changeOrigin: true, secure: false },
        // Agent setup endpoints used by the PrinterSetup UI
        '/agent-setup': { target: agentTarget, changeOrigin: true, secure: false },
        // allow forwarding /agent-print to backend so frontend can call it directly in dev
        '/agent-print': { target: agentTarget, changeOrigin: true, secure: false }
      };
    })(),
  },
});