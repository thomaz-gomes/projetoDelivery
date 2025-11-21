# Print mock tools

This folder contains two lightweight servers you can run locally to test printing flows without a real QZ Tray instance.

Files

- `qz-mock-server.js` — a minimal WebSocket server that mimics the QZ Tray websocket API for a few calls (version, printers.getDefault, printers.find, print). It writes incoming print payloads to `prints/`.
- `http-print-receiver.js` — a tiny Express server with `POST /print` that saves JSON payloads to `prints-http/`.

Quick start (PowerShell)

1. Open a terminal in this folder:

```powershell
cd .\delivery-saas-frontend\dev-tools\print-mock
```

2. Install dependencies for the mock WS server and HTTP receiver:

```powershell
npm install ws express body-parser
```

3. Run the WebSocket QZ mock (use this if you want the frontend to talk to a fake QZ Tray):

```powershell
node qz-mock-server.js
# listens on ws://localhost:8182
```

4. Run the HTTP receiver (alternative test path):

```powershell
node http-print-receiver.js
# listens on http://localhost:4000
```

Pointing your frontend to the mock server

- QZ-mock: The qz-tray client in the frontend will try multiple ports (8181/8182/...) — this mock listens on 8182 by default. Start it and reload your frontend. The mock logs calls and will save print payloads to `prints/`.
- HTTP receiver: If you want to test `printService` without QZ at all, temporarily change `printService.enqueuePrint` to POST to `http://localhost:4000/print` with the same payload you would send to QZ. This is a safe way to validate formatting and payload structure.

Notes

- The mock is intentionally minimal and meant for development/testing only. It does not implement the full QZ Tray protocol or security.
- Use the saved JSON files in `prints/` or `prints-http/` to inspect what your frontend would have printed.

If you want, I can:

- Add a small helper script to automatically open the prints folder after a job is saved.
- Add an npm script to the frontend `package.json` to start the mock servers more easily.
