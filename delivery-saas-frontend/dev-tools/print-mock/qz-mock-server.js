#!/usr/bin/env node
/**
 * Simple HTTP print receiver used for frontend development/testing.
 * Exposes:
 *  - GET /printers  -> returns a small list of mock printers
 *  - POST /print    -> saves incoming print payloads to ./prints
 *
 * Usage: node qz-mock-server.js
 */

import http from 'http';
import fs from 'fs';
import path from 'path';

const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;
const OUTDIR = path.join(process.cwd(), 'dev-print-receiver-prints');
if (!fs.existsSync(OUTDIR)) fs.mkdirSync(OUTDIR, { recursive: true });

const server = http.createServer(async (req, res) => {
  try {
    // Allow cross-origin requests from the frontend dev server (Vite)
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method === 'GET' && req.url.startsWith('/printers')) {
      const printers = ['Mock Printer', 'Network POS Printer'];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ printers }));
      return;
    }

    if (req.method === 'POST' && (req.url === '/print' || req.url === '/printers/print')) {
      let body = '';
      for await (const chunk of req) body += chunk;
      const ts = Date.now();
      const filename = path.join(OUTDIR, `print-${ts}.json`);
      fs.writeFileSync(filename, body || '{}');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ saved: filename }));
      console.log('Saved print payload ->', filename);
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  } catch (e) {
    console.error('Error in print mock server:', e);
    res.writeHead(500);
    res.end('Server error');
  }
});

server.listen(PORT, () => console.log(`Mock HTTP print receiver listening on http://localhost:${PORT}`));

process.on('SIGINT', () => {
  console.log('Shutting down mock server');
  server.close(() => process.exit(0));
});
