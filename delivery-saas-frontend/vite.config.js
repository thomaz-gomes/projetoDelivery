import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import fs from "fs";
import path from "path";

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
    // Proxy API requests to the backend during local development to avoid CORS
    // The proxy target protocol follows the backend SSL setting (DISABLE_SSL).
    proxy: (function() {
      const backendProto = (String(process.env.DISABLE_SSL || '').toLowerCase() === '1') ? 'http' : 'https';
      const target = `${backendProto}://localhost:3000`;
      return {
        '/api': { target, changeOrigin: true, secure: false },
        '/auth': { target, changeOrigin: true, secure: false },
        '/socket.io': { target, ws: true, changeOrigin: true, secure: false },
        // Agent setup endpoints used by the PrinterSetup UI
        '/agent-setup': { target, changeOrigin: true, secure: false },
        // allow forwarding /agent-print to backend so frontend can call it directly in dev
        '/agent-print': { target, changeOrigin: true, secure: false }
      };
    })(),
  },
});