const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const PORT = process.env.PRINTER_HTTP_PORT || 4000;
const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: '5mb' }));

// Simple in-memory sample printers list for dev. This can be extended to
// detect local printers or integrate with OS-specific libs later.
const SAMPLE_PRINTERS = [
  { name: process.env.PRINTER_INTERFACE || 'Printer-1' }
];

app.get('/printers', (req, res) => {
  try {
    return res.json(SAMPLE_PRINTERS);
  } catch (e) {
    return res.status(500).json({ error: String(e && e.message) });
  }
});

// Accept a print payload and persist to disk (dev convenience)
app.post('/print', (req, res) => {
  try {
    const outDir = path.resolve(process.cwd(), 'dev-print-endpoint');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const ts = Date.now();
    const file = path.join(outDir, `${ts}.json`);
    fs.writeFileSync(file, JSON.stringify({ receivedAt: ts, payload: req.body }, null, 2), 'utf8');
    return res.json({ ok: true, file });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e && e.message) });
  }
});

app.listen(PORT, () => {
  console.log(`Local printer HTTP endpoint listening on http://localhost:${PORT}`);
});

module.exports = app;
