import https from "https";
import http from "http";
import tls from 'tls';
import fs from "fs";
import path from "path";
import { app, attachSocket } from "./index.js"; // attachSocket will bind Socket.IO to the server
import { startWatching } from './fileWatcher.js';

// Load SSL key/cert from several possible filenames so frontend files can be used directly
function pickFirstExisting(dir, candidates) {
  for (const c of candidates) {
    const p = path.join(dir, c);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const SSL_DIR = path.resolve(process.cwd(), 'ssl');

// include common PEM names produced by various tools (win-acme, mkcert, etc.)
const keyCandidates = [
  'localhost-key.pem',
  'private.key',
  'key.pem',
  'server.key',
  'localhost-key.pem',
  'localhost-key.pem.pem'
];
const certCandidates = [
  'localhost.pem',
  'certificate.crt',
  'cert.pem',
  'server.crt',
  'localhost-crt.pem',
  'localhost-crt.pem'
];
const caCandidates = ['ca_bundle.crt', 'ca.pem', 'chain.pem', 'localhost-chain.pem', 'localhost-chain-only.pem'];
// PFX candidates (some Windows tools write pfx files)
const pfxCandidates = ['localhost.pfx', 'certificate.pfx', 'fullchain.pfx'];

// Allow explicit SSL paths via environment (preferred when present)
const envKey = process.env.SSL_KEY_PATH;
const envCert = process.env.SSL_CERT_PATH;
const envCa = process.env.SSL_CA_PATH;

// If set to '1' or 'true' (case-insensitive) the server will run in HTTP mode
const DISABLE_SSL = String(process.env.DISABLE_SSL || '').toLowerCase() === '1' || String(process.env.DISABLE_SSL || '').toLowerCase() === 'true';

const keyPath = (envKey && fs.existsSync(envKey)) ? envKey : pickFirstExisting(SSL_DIR, keyCandidates);
const certPath = (envCert && fs.existsSync(envCert)) ? envCert : pickFirstExisting(SSL_DIR, certCandidates);
const caPath = (envCa && fs.existsSync(envCa)) ? envCa : pickFirstExisting(SSL_DIR, caCandidates);
const pfxPath = pickFirstExisting(SSL_DIR, pfxCandidates);

let options = {};
let usedPfx = false;
// If SSL is disabled we skip PFX/key/cert validation and run in plain HTTP instead
if (DISABLE_SSL) {
  console.log('DISABLE_SSL is set — starting server in plain HTTP mode (no SSL files required).');
} else {
  // Prefer explicit PFX when present -- but validate it before handing to https
  if (pfxPath && !envCert && !envKey) {
  try {
    const pfxBuf = fs.readFileSync(pfxPath);
    try {
      // try to create a secure context to validate the PFX contents
      tls.createSecureContext({ pfx: pfxBuf });
      options.pfx = pfxBuf;
      usedPfx = true;
      console.log('Using PFX file for SSL:', pfxPath);
    } catch (err) {
      console.error('Found PFX but it appears to be invalid/unreadable as PKCS#12:', pfxPath, err.message || err);
      console.error('Falling back to PEM key/cert files (if present).');
    }
  } catch (e) {
    console.error('Failed to read PFX file:', pfxPath, e.message || e);
  }
}
  if (!usedPfx) {
    if (keyPath && certPath) {
    try {
      options.key = fs.readFileSync(keyPath);
      options.cert = fs.readFileSync(certPath);
      if (caPath) options.ca = fs.readFileSync(caPath);
      console.log('Using SSL key:', keyPath);
      console.log('Using SSL cert:', certPath);
      if (caPath) console.log('Using SSL ca bundle:', caPath);
    } catch (e) {
      console.error('Failed to read key/cert/ca files:', e.message || e);
    }
  } else {
      console.error('❌ SSL key or certificate not found. Looked for:');
      console.error('   key candidates:', keyCandidates.join(', '));
      console.error('   cert candidates:', certCandidates.join(', '));
      console.error('   pfx candidates:', pfxCandidates.join(', '));
      console.error('Place your key/cert/pfx files in', SSL_DIR);
      console.error('If you want to let the reverse proxy (EasyPanel) terminate TLS and run the app over HTTP, set DISABLE_SSL=1 in the container environment.');
      process.exit(1);
  }
  }
}
if (envKey || envCert || envCa) {
  console.log('Note: one or more SSL paths were provided via environment variables and were preferred when present.');
}

const DEFAULT_PORT = Number(process.env.PORT) || 3000;

/**
 * Tenta iniciar o servidor HTTPS em `port`. Se o porto estiver em uso,
 * tenta o próximo porto (port+1) até `retries` tentativas.
 */
function startServer(port = DEFAULT_PORT, retries = 3) {
  let server;
  const useHttp = DISABLE_SSL;
  try {
    if (useHttp) {
      server = http.createServer(app);
      console.log('Starting HTTP server (DISABLE_SSL active)');
    } else {
      server = https.createServer(options, app);
    }
  } catch (e) {
    console.error('❌ Failed to create server with the provided options:', e && e.message ? e.message : e);
    // If we tried a PFX earlier and it failed here, try to give a hint
    if (pfxPath) console.error('The PFX file may be invalid or password protected:', pfxPath);
    process.exit(1);
  }

  server.on('error', (err) => {
    if (err && err.code === 'EADDRINUSE') {
      console.warn(`⚠️ Porta ${port} em uso.`);
      if (retries > 0) {
        console.log(`➡️ Tentando porta ${port + 1} (restam ${retries} tentativas)...`);
        setTimeout(() => startServer(port + 1, retries - 1), 250);
        return;
      }
      console.error(`❌ Todas as tentativas falharam; porta ${port} continua em uso.`);
      console.error('Use `netstat -ano | findstr :3000` e mate o processo que está usando a porta, ou defina PORT=XXXX');
      process.exit(1);
    }
    console.error('❌ Erro ao iniciar servidor:', err);
    process.exit(1);
  });

  server.listen(port, () => {
    const hostLabel = process.env.HOST || 'localhost';
    console.log(`✅ HTTPS rodando em https://${hostLabel}:${port}`);
    try {
      attachSocket(server);
      console.log('🔌 Socket.IO anexado ao servidor HTTPS');
      // start file watcher (if any paths configured)
      startWatching().catch(e => console.error('Failed to start file watcher:', e));
    } catch (e) {
      console.error('❌ Falha ao anexar Socket.IO:', e.message || e);
    }
  });
}

startServer();