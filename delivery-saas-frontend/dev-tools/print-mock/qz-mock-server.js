#!/usr/bin/env node
/**
 * QZ Tray minimal mock WebSocket server for local frontend testing.
 *
 * - Listens on ws://localhost:8182 by default (one of QZ's default ports for insecure WS)
 * - Responds to a small set of calls used by the frontend: getVersion, printers.getDefault, printers.find, print
 * - Saves incoming print payloads under ./prints for inspection
 *
 * Usage:
 *   npm install ws
 *   node qz-mock-server.js
 */

import fs from 'fs';
import path from 'path';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT ? Number(process.env.PORT) : 8182;
const OUTDIR = path.join(__dirname, 'prints');
if (!fs.existsSync(OUTDIR)) fs.mkdirSync(OUTDIR, { recursive: true });

const wss = new WebSocketServer({ port: PORT });
wss.on('listening', () => console.log(`✅ QZ-mock WebSocket server listening on ws://localhost:${PORT}`));

function safeJsonParse(s) {
  try { return JSON.parse(s); } catch(e) { return null; }
}

function sendResult(ws, uid, result) {
  const msg = { uid, result };
  try { ws.send(JSON.stringify(msg)); } catch(e) { console.error('Failed to send', e); }
}

wss.on('connection', (ws, req) => {
  console.log('Client connected from', req.socket.remoteAddress);

  ws.on('message', (data) => {
    // qz-tray can send plain 'ping' strings
    if (typeof data === 'string' && data === 'ping') return;

    const obj = safeJsonParse(data.toString());
    if (!obj) {
      // ignore non-json
      return;
    }

    console.log('<= recv', obj.call || (obj.certificate ? 'certificate' : 'payload'), 'uid=', obj.uid || '-');

    // handle certificate handshake (sent with uid and promise)
    if (obj.certificate !== undefined && obj.uid) {
      // reply with null result to allow client to continue
      sendResult(ws, obj.uid, null);
      return;
    }

    // handle calls
    const call = obj.call || '';
    if (!obj.uid) {
      // not a promise-style call, nothing to resolve
      return;
    }

    if (call.toLowerCase().includes('version')) {
      sendResult(ws, obj.uid, '2.2.5');
      return;
    }

    if (call === 'printers.getDefault') {
      sendResult(ws, obj.uid, 'Mock Printer');
      return;
    }

    if (call === 'printers.find') {
      sendResult(ws, obj.uid, ['Mock Printer']);
      return;
    }

    if (call === 'print') {
      // params: { printer, options, data }
      const payload = obj.params || { printer: null, options: null, data: null };
      const ts = Date.now();
      const filename = path.join(OUTDIR, `print-${ts}.json`);
      fs.writeFile(filename, JSON.stringify(payload, null, 2), (err) => {
        if (err) console.error('Failed to save print payload', err);
        else console.log(`Saved print payload -> ${filename}`);
      });
      // respond with a simple acknowledgement
      sendResult(ws, obj.uid, null);
      return;
    }

    // default: echo back params for visibility
    sendResult(ws, obj.uid, { echo: obj.params || null });
  });

  ws.on('close', () => console.log('Client disconnected'));
  ws.on('error', (err) => console.error('WS error', err));
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down server...');
  wss.close(() => process.exit(0));
});
