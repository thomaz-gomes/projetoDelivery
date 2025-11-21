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
  host: 'dev.redemultilink.com.br',
    port: 5173,
  },
});