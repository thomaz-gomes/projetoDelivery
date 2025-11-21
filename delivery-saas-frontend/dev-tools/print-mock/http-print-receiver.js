#!/usr/bin/env node
/**
 * Simple HTTP print receiver to capture print jobs for testing.
 * POST /print with JSON body will save the payload to ./prints-http
 *
 * Usage:
 *   npm install express body-parser
 *   node http-print-receiver.js
 */

import fs from 'fs';
import path from 'path';
import express from 'express';
import bodyParser from 'body-parser';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;
const OUTDIR = path.join(__dirname, 'prints-http');
if (!fs.existsSync(OUTDIR)) fs.mkdirSync(OUTDIR, { recursive: true });

const app = express();
app.use(bodyParser.json({ limit: '5mb' }));

app.post('/print', (req, res) => {
  const payload = req.body || {};
  const ts = Date.now();
  const filename = path.join(OUTDIR, `print-http-${ts}.json`);
  fs.writeFile(filename, JSON.stringify(payload, null, 2), (err) => {
    if (err) {
      console.error('Failed to save payload', err);
      return res.status(500).send({ ok: false });
    }
    console.log(`Saved HTTP print payload -> ${filename}`);
    res.send({ ok: true, file: filename });
  });
});

app.get('/', (req, res) => res.send('HTTP print receiver running'));

app.listen(PORT, () => console.log(`✅ HTTP print receiver listening on http://localhost:${PORT}`));
