# iFood Agent — release artifacts

This directory hosts the Windows installer + electron-updater metadata for the iFood Agent Electron app.

## Operator workflow after a new release

1. Build locally:
   ```
   cd delivery-ifood-agent-electron
   npm install
   cd renderer && npm install && npm run build && cd ..
   npm run dist
   ```
2. From `delivery-ifood-agent-electron/dist-electron/`, copy these files INTO this directory:
   - `DeliveryIfoodAgent-Setup-X.Y.Z.exe` — the actual installer
   - `latest.yml` — version metadata that electron-updater consumes
   - `DeliveryIfoodAgent-Setup-X.Y.Z.exe.blockmap` — delta-update support

3. Commit and deploy backend. Running agents will pick up the new version on next launch (or within 60 min of running, since main process polls).

## URL the agent queries

The agent constructs `<backendUrl>/downloads/ifood-agent/latest.yml` using the `backendUrl` from operator config (no separate update server URL needed).

## Why this directory and not GitHub Releases or S3?

Keeps deployment inside our existing infrastructure — no extra services, secrets, or quotas. The price is that the backend serves binary downloads; for low rollout volume (operators count is bounded), that's fine.

## Static mount

Served via `app.use('/downloads', express.static(downloadsDir, { dotfiles: 'deny' }))` in `delivery-saas-backend/src/index.js` (the same mount used for `delivery-print-agent-setup.exe`). No new mount needed.
