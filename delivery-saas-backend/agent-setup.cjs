const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.AGENT_SETUP_PORT || 3001;

// Try to read a simple stores.json (simulate DB) placed next to this file.
function loadStores() {
  const p = path.join(__dirname, 'stores.json');
  if (fs.existsSync(p)) {
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch(e) { return null; }
  }
  return null;
}

app.get('/agent-setup', (req, res) => {
  // In a real backend you'd query the DB for company -> stores mapping for
  // the current authenticated user. For this example we return a simple
  // payload read from stores.json or environment vars.
  const storesData = loadStores();
  const storeIds = (storesData && storesData.storeIds) || (process.env.EXAMPLE_STORE_IDS ? process.env.EXAMPLE_STORE_IDS.split(',') : ['store-1']);
  const socketUrl = process.env.SOCKET_URL || 'http://localhost:3000';
  const tokenHint = process.env.AGENT_TOKEN_HINT || '';

  res.json({ socketUrl, storeIds, tokenHint });
});

app.listen(PORT, () => console.log(`Agent-setup helper listening on http://localhost:${PORT}`));
