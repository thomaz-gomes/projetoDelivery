/*
  Simple HTTP server to expose local printers to the browser during setup.
  Usage: node printer-http.cjs
  - GET /printers -> returns JSON array of printers (Windows via PowerShell)
  - GET /ping -> { ok: true }

  Note: This uses PowerShell `Get-Printer` so it works on Windows machines.
*/

const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');

const PORT = process.env.PRINTER_HTTP_PORT || 4000;

const app = express();
app.use(cors());
app.use(express.json());

app.get('/ping', (req, res) => res.json({ ok: true }));

app.get('/printers', (req, res) => {
  // Use PowerShell to list printers as JSON
  const ps = 'Get-Printer | Select-Object Name,PortName,DriverName,Default | ConvertTo-Json -Compress';
  exec(`powershell -NoProfile -Command "${ps}"`, { windowsHide: true, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
    if (err) {
      return res.status(500).json({ error: String(err), stderr });
    }
    try {
      const data = JSON.parse(stdout || '[]');
      // Ensure array
      const list = Array.isArray(data) ? data : [data];
      return res.json(list.map(p => ({ name: p.Name, port: p.PortName, driver: p.DriverName, default: !!p.Default })));
    } catch (e) {
      return res.status(500).json({ error: 'parse_error', details: String(e), raw: stdout });
    }
  });
});

app.listen(PORT, () => console.log(`Printer HTTP helper listening on http://localhost:${PORT}`));
