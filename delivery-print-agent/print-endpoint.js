require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const printerService = require('./printerService');

const app = express();
// CORS: allow all in dev or when PRINT_AGENT_ALLOW_ALL_CORS is truthy
const ALLOW_ALL_CORS = String(process.env.PRINT_AGENT_ALLOW_ALL_CORS || '').toLowerCase() === '1' || (process.env.NODE_ENV !== 'production');
if (ALLOW_ALL_CORS) {
  app.use(cors());
} else {
  // optionally allow specific origins via PRINT_AGENT_ORIGINS (comma-separated)
  const origins = (process.env.PRINT_AGENT_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  app.use(cors({ origin: origins.length ? origins : false }));
}
app.use(express.json({ limit: '1mb' }));

const fs = require('fs');
const mkdirp = require('mkdirp');
const LOG_DIR = path.resolve(process.env.LOG_DIR || path.join(__dirname, 'logs'));
mkdirp.sync(LOG_DIR);
const PORT = process.env.PRINT_AGENT_HTTP_PORT ? Number(process.env.PRINT_AGENT_HTTP_PORT) : 4000;

function getCurrentAuthToken() {
  return process.env.PRINT_AGENT_TOKEN || process.env.TOKEN || '';
}

function requireAuth(req, res) {
  const AUTH_TOKEN = getCurrentAuthToken();
  if (!AUTH_TOKEN) return true;
  const header = (req.headers['x-print-agent-token'] || req.headers['x-agent-token'] || '').toString();
  if (header && header === AUTH_TOKEN) return true;
  // allow token via query string for convenience (dev only)
  if (req.query && req.query.token && req.query.token === AUTH_TOKEN) return true;
  res.status(401).json({ ok: false, error: 'unauthorized' });
  return false;
}

app.get('/api/print/health', (req, res) => {
  if (!requireAuth(req, res)) return;
  const dryRun = String(process.env.DRY_RUN || 'false').toLowerCase() === 'true';
  res.json({ ok: true, dryRun });
});

// Dev-only: expose current token for debugging (only when CORS allows all / dev)
if (ALLOW_ALL_CORS) {
  app.get('/api/debug/token', (req, res) => {
    try {
      const t = process.env.PRINT_AGENT_TOKEN || process.env.TOKEN || '';
      return res.json({ token: t ? '***' : '', present: !!t });
    } catch (e) {
      return res.status(500).json({ error: String(e && e.message) });
    }
  });
}

app.get('/api/print/printers', async (req, res) => {
  if (!requireAuth(req, res)) return;
  // Try to enumerate installed printers on the host (Windows PowerShell),
  // returning an array of { name, port, driver, default } when possible.
  // If enumeration fails (non-Windows or missing permissions), fall back
  // to a best-effort response with configured interface and type.
  const iface = process.env.PRINTER_INTERFACE || 'printer:default';
  const type = process.env.PRINTER_TYPE || 'EPSON';

  // attempt PowerShell Get-Printer (Windows)
  try {
    const { exec } = require('child_process');
    const ps = 'Get-Printer | Select-Object Name,PortName,DriverName,Default | ConvertTo-Json -Compress';
    exec(`powershell -NoProfile -Command "${ps}"`, { windowsHide: true, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        // fallback to basic info
        return res.json({ ok: true, interface: iface, type, connected: null });
      }
      try {
        const data = JSON.parse(stdout || '[]');
        const list = Array.isArray(data) ? data : [data];
        const mapped = list.map(p => ({ name: p.Name, port: p.PortName, driver: p.DriverName, default: !!p.Default }));
        return res.json(mapped);
      } catch (e) {
        return res.json({ ok: true, interface: iface, type, connected: null });
      }
    });
    return;
  } catch (e) {
    // not running on Windows or exec not available — fallback
  }

  // final fallback
  res.json({ ok: true, interface: iface, type, connected: null });
});

app.post('/api/print', async (req, res) => {
  if (!requireAuth(req, res)) return;
  const body = req.body || {};
  const order = body.order;
  const opts = body.opts || {};

  if (!order) {
    return res.status(400).json({ ok: false, error: 'missing order in body' });
  }

  try {
    // Log a sanitized summary of the incoming print request for debugging
    try {
      const summary = {
        ts: new Date().toISOString(),
        id: order.id || order.displayId || order.displaySimple || null,
        storeId: order.storeId || order.store || null,
        items: Array.isArray(order.items) ? order.items.length : 0,
        payments: Array.isArray(order.payments) ? order.payments.map(p => ({ method: p.method || p.type || p.name, amount: p.amount || p.value })) : (order.paymentMethod ? [{ method: order.paymentMethod, amount: order.paymentAmount || order.total }] : []),
        subtotal: order.subtotal || order.itemsTotal || null,
        total: order.total || order.amount || null,
        customerName: order.customerName || order.name || null,
        address: order.addressFull || order.address || order.addressString || null,
        qrPresent: !!(order.qrDataUrl || order.qrImage || order.qr || order.qrUrl),
        opts: opts || {}
      };
      const entry = `[${summary.ts}] POST /api/print summary: ${JSON.stringify(summary)}\n`;
      fs.appendFileSync(path.join(LOG_DIR, 'http-print.log'), entry);
      console.log(entry);
      // Also write a short preview of the formatted text for inspection
      try {
        if (typeof printerService.formatOrderText === 'function') {
          const preview = printerService.formatOrderText(order, opts);
          const previewPath = path.join(LOG_DIR, `preview-${Date.now()}-${summary.id || 'noid'}.txt`);
          fs.writeFileSync(previewPath, preview, 'utf8');
          console.log('Wrote preview to', previewPath);
          // Diagnostic: if a QR data URL/image is present, save it as a PNG for inspection
          try {
            const qrVal = order.qrDataUrl || order.qrImage || order.qr || order.qrUrl || (order.payload && (order.payload.qrUrl || order.payload.qr)) || (order._normalized && (order._normalized.qrUrl || order._normalized.qr));
            if (qrVal && typeof qrVal === 'string') {
              const short = qrVal.slice(0, 200);
              fs.appendFileSync(previewPath, `\n\n[QR_PRESENCE] ${short}${qrVal.length > 200 ? '...[truncated]' : ''}\n`);
              if (qrVal.startsWith('data:image')) {
                try {
                  const parts = qrVal.split(',');
                  const b64 = parts[1] || '';
                  const buf = Buffer.from(b64, 'base64');
                  const qpath = path.join(LOG_DIR, `qr-${Date.now()}-${summary.id || 'noid'}.png`);
                  fs.writeFileSync(qpath, buf);
                  console.log('Wrote QR PNG to', qpath);
                } catch (e2) {
                  console.warn('Failed to decode/write qrDataUrl PNG', e2 && e2.message);
                }
              }
            }
            // write a small sanitized JSON snapshot for debugging
            try {
              const snap = { ts: summary.ts, id: summary.id, qrPresent: summary.qrPresent, payments: summary.payments, opts };
              const snapPath = path.join(LOG_DIR, `order-snap-${Date.now()}-${summary.id || 'noid'}.json`);
              fs.writeFileSync(snapPath, JSON.stringify(snap, null, 2), 'utf8');
            } catch (e3) { /* ignore */ }
          } catch (edi) { /* ignore diagnostics */ }
        }
      } catch (epr) {
        /* ignore preview write errors */
      }
    } catch (elog) {
      console.warn('Failed to write incoming print summary log', elog && elog.message ? elog.message : elog);
    }
    await printerService.printOrder(order, opts);
    return res.json({ ok: true });
  } catch (e) {
    // printerService already logs and persists failed payloads, but respond error
    return res.status(500).json({ ok: false, error: String(e && e.message ? e.message : e) });
  }
});

app.listen(PORT, () => {
  console.log(`Print agent HTTP endpoint listening on http://localhost:${PORT} (POST /api/print)`);
});

module.exports = app;
