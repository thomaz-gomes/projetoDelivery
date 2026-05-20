# iFood Agent Electron Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Substituir (em paralelo com 2 meses de coexistência) a extensão Chrome do iFood Chat por um app Electron dedicado, eliminando os problemas de service worker MV3 e throttling de tab em background.

**Architecture:** App Electron novo (`delivery-ifood-agent-electron/`) com Socket.IO no main process, `<webview>` apontando para o gestor do iFood no renderer Vue 3, e script injetado adaptado do `content.js` da extensão. Backend ganha campo `ifoodAgentTokenHash` em `PrinterSetting`, endpoint para gerar token, e middleware Socket.IO que aceita o token novo. Extensão continua funcionando inalterada.

**Tech Stack:** Electron 28, Vue 3, Vite, Socket.IO 4.8, electron-builder (NSIS Win + DMG Mac), Prisma 6 + PostgreSQL no backend.

**Design doc:** `docs/plans/2026-05-20-ifood-agent-electron-design.md`

**Branch:** criar `feat/ifood-agent-electron` a partir de `main`.

**Working dir:** `d:/Users/gomes/Documents/GitHub/projetoDelivery-crud`.

---

## Fase A — Backend: token + handshake + endpoint

### Task A1: Migration Prisma — campos novos em `PrinterSetting`

**Files:**
- Modify: `delivery-saas-backend/prisma/schema.prisma`

**Step 1: Editar o schema**

Localizar `model PrinterSetting` e adicionar 2 campos (perto dos campos `extensionToken*` existentes):

```prisma
  ifoodAgentTokenHash       String?
  ifoodAgentTokenCreatedAt  DateTime?
```

**Step 2: Aplicar migration (dev Docker)**

```bash
docker compose -p projetodelivery exec backend ./node_modules/.bin/prisma db push --skip-generate
docker compose -p projetodelivery exec backend ./node_modules/.bin/prisma generate
```
Expected: "Your database is now in sync with your Prisma schema."

**Step 3: Commit**

```bash
cd "d:/Users/gomes/Documents/GitHub/projetoDelivery-crud"
git checkout -b feat/ifood-agent-electron
git add delivery-saas-backend/prisma/schema.prisma
git -c user.name="John Doe" -c user.email="johndoe@example.com" commit -m "feat(schema): add ifoodAgentTokenHash to PrinterSetting"
```

---

### Task A2: Endpoint `POST /ifood-chat/generate-agent-token`

**Files:**
- Modify: `delivery-saas-backend/src/routes/ifoodChat.js` (adicionar handler novo)

**Step 1: Verificar como o handler de `generate-token` (extensão) funciona hoje**

```bash
grep -n "generate-token\|extensionToken\|sha256" delivery-saas-backend/src/routes/ifoodChat.js | head -10
```

Espelhar o mesmo padrão. Importar `crypto` se necessário.

**Step 2: Adicionar handler**

Antes do `export default router`, adicionar:

```javascript
import crypto from 'crypto'

function sha256(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex')
}

function randomToken(len = 24) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  const bytes = crypto.randomBytes(len)
  let out = ''
  for (let i = 0; i < len; i++) out += chars[bytes[i] % chars.length]
  return out
}

router.post('/generate-agent-token', requireRole('ADMIN'), async (req, res) => {
  const companyId = req.user.companyId
  const token = randomToken(24)
  const hash = sha256(token)
  await prisma.printerSetting.upsert({
    where: { companyId },
    update: { ifoodAgentTokenHash: hash, ifoodAgentTokenCreatedAt: new Date() },
    create: { companyId, ifoodAgentTokenHash: hash, ifoodAgentTokenCreatedAt: new Date() },
  })
  res.json({ token })
})
```

(Se `crypto`/`sha256`/`randomToken` já existirem no arquivo, reusar.)

**Step 3: Sanity test**

```bash
docker compose -p projetodelivery restart backend
sleep 3
# Login via UI ou outro test: bater curl com token JWT válido em /ifood-chat/generate-agent-token e esperar 200 com { token: "24chars" }
```

**Step 4: Commit**

```bash
git add delivery-saas-backend/src/routes/ifoodChat.js
git -c user.name="John Doe" -c user.email="johndoe@example.com" commit -m "feat(ifood-chat): endpoint generate-agent-token"
```

---

### Task A3: Middleware Socket.IO aceita `ifoodAgentToken`

**Files:**
- Modify: `delivery-saas-backend/src/index.js` (middleware `io.use(async (socket, next) => {...})`)

**Step 1: Localizar middleware atual**

```bash
grep -n "extensionToken\|io.use" delivery-saas-backend/src/index.js | head -10
```

Ver onde o handshake da extensão é tratado.

**Step 2: Adicionar bloco análogo para `ifoodAgentToken`**

Logo após o bloco da extensão, antes do `next()` final:

```javascript
// Tipo: agente iFood Electron (espelha extensionToken)
if (socket.handshake.auth?.ifoodAgentToken) {
  const companyId = socket.handshake.auth.companyId
  if (!companyId) return next(new Error('missing-company-id'))
  const setting = await prisma.printerSetting.findUnique({
    where: { companyId },
    select: { ifoodAgentTokenHash: true },
  })
  if (!setting?.ifoodAgentTokenHash) return next(new Error('no-agent-token'))
  const incomingHash = sha256(socket.handshake.auth.ifoodAgentToken)
  if (incomingHash !== setting.ifoodAgentTokenHash) {
    return next(new Error('invalid-agent-token'))
  }
  socket.ifoodAgent = { companyId }
  socket.companyId = companyId
  return next()
}
```

(Garantir que `sha256` está importado/disponível neste arquivo.)

**Step 3: Sanity**

```bash
docker compose -p projetodelivery restart backend
sleep 3
docker logs projetodelivery-backend-1 --tail 5 2>&1 | grep -i "ready\|started\|listening"
```

Expected: backend reinicia sem erro.

**Step 4: Commit**

```bash
git add delivery-saas-backend/src/index.js
git -c user.name="John Doe" -c user.email="johndoe@example.com" commit -m "feat(socket): aceitar ifoodAgentToken no handshake"
```

---

### Task A4: `emitirIfoodChat` aceita `socket.ifoodAgent`

**Files:**
- Modify: `delivery-saas-backend/src/socketEmitters.js` (função `emitirIfoodChat`)

**Step 1: Estender filtro**

Localizar `if (!s.extension) continue` (linha ~275). Trocar por:

```javascript
// Aceita extensão Chrome E agente Electron. Coexistência durante migração.
if (!s.extension && !s.ifoodAgent) continue
```

**Step 2: Sanity**

`docker compose -p projetodelivery restart backend && sleep 3` — sem erro de boot.

**Step 3: Commit**

```bash
git add delivery-saas-backend/src/socketEmitters.js
git -c user.name="John Doe" -c user.email="johndoe@example.com" commit -m "feat(socket): broadcast ifood:chat para agente Electron tambem"
```

---

## Fase B — App Electron: scaffold + main process

### Task B1: Scaffold do projeto

**Files:**
- Create: `delivery-ifood-agent-electron/package.json`
- Create: `delivery-ifood-agent-electron/main.js`
- Create: `delivery-ifood-agent-electron/preload.js`
- Create: `delivery-ifood-agent-electron/.gitignore`

**Step 1: `package.json`**

```json
{
  "name": "delivery-ifood-agent",
  "version": "1.0.0",
  "description": "Agente Electron que envia mensagens automáticas no chat do iFood Gestor de Pedidos",
  "main": "main.js",
  "scripts": {
    "start": "electron .",
    "dev": "electron .",
    "build:renderer": "cd renderer && vite build",
    "build:win": "set CSC_IDENTITY_AUTO_DISCOVERY=false&& npm run build:renderer && electron-builder --win",
    "build:mac": "npm run build:renderer && electron-builder --mac",
    "postinstall": "electron-builder install-app-deps"
  },
  "dependencies": {
    "socket.io-client": "^4.8.1"
  },
  "devDependencies": {
    "electron": "^28.3.3",
    "electron-builder": "^24.13.3",
    "vite": "^5.4.0",
    "vue": "^3.4.0",
    "@vitejs/plugin-vue": "^5.0.0"
  },
  "build": {
    "appId": "com.delivery.ifoodagent",
    "productName": "Delivery iFood Agent",
    "directories": { "output": "dist" },
    "files": ["main.js", "preload.js", "src/**", "renderer/dist/**", "node_modules/**"],
    "win": { "target": "nsis", "icon": "build/icon.ico" },
    "mac": { "target": "dmg", "icon": "build/icon.icns", "category": "public.app-category.business" },
    "nsis": { "oneClick": false, "perMachine": false, "allowToChangeInstallationDirectory": true }
  }
}
```

**Step 2: `main.js` mínimo (boot da janela)**

```javascript
'use strict'
const { app, BrowserWindow, ipcMain, session } = require('electron')
const path = require('path')

let mainWindow = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true, // necessário para usar <webview>
    },
  })

  const indexHtml = app.isPackaged
    ? path.join(__dirname, 'renderer', 'dist', 'index.html')
    : path.join(__dirname, 'renderer', 'index.html')

  mainWindow.loadFile(indexHtml)
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
```

**Step 3: `preload.js` bridge IPC**

```javascript
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('agentApi', {
  // Renderer → Main
  saveConfig: (cfg) => ipcRenderer.invoke('config:save', cfg),
  getConfig: () => ipcRenderer.invoke('config:get'),
  reconnect: (cfg) => ipcRenderer.invoke('socket:reconnect', cfg),
  reportSendResult: (result) => ipcRenderer.invoke('chat:result', result),
  getFailures: () => ipcRenderer.invoke('failures:list'),
  clearFailures: () => ipcRenderer.invoke('failures:clear'),

  // Main → Renderer (subscribe)
  onChatMessage: (cb) => {
    const handler = (_evt, payload) => cb(payload)
    ipcRenderer.on('chat:message', handler)
    return () => ipcRenderer.removeListener('chat:message', handler)
  },
  onSocketStatus: (cb) => {
    const handler = (_evt, st) => cb(st)
    ipcRenderer.on('socket:status', handler)
    return () => ipcRenderer.removeListener('socket:status', handler)
  },
})
```

**Step 4: `.gitignore`**

```
node_modules/
dist/
renderer/dist/
*.log
```

**Step 5: Smoke**

```bash
cd delivery-ifood-agent-electron
npm install
npm start
```
Expected: janela vazia abre (renderer ainda não tem index.html — vai dar 404; isso é OK, B7 cria).

**Step 6: Commit**

```bash
git add delivery-ifood-agent-electron/package.json delivery-ifood-agent-electron/main.js delivery-ifood-agent-electron/preload.js delivery-ifood-agent-electron/.gitignore
git -c user.name="John Doe" -c user.email="johndoe@example.com" commit -m "feat(ifood-agent): Electron scaffold + IPC bridge"
```

---

### Task B2: `src/config.js` (carrega/salva config em userData)

**Files:**
- Create: `delivery-ifood-agent-electron/src/config.js`
- Modify: `delivery-ifood-agent-electron/main.js` (handlers IPC `config:save`/`config:get`)

**Step 1: `src/config.js`**

```javascript
'use strict'
const { app } = require('electron')
const path = require('path')
const fs = require('fs')

function configPath() {
  return path.join(app.getPath('userData'), 'config.json')
}

function load() {
  try {
    const raw = fs.readFileSync(configPath(), 'utf8')
    return JSON.parse(raw)
  } catch (e) {
    return null
  }
}

function save(cfg) {
  const dir = app.getPath('userData')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2), 'utf8')
  return true
}

module.exports = { load, save }
```

**Step 2: IPC handlers em `main.js`**

Antes de `app.whenReady`:

```javascript
const config = require('./src/config')

ipcMain.handle('config:get', () => config.load())
ipcMain.handle('config:save', (_evt, cfg) => config.save(cfg))
```

**Step 3: Commit**

```bash
git add delivery-ifood-agent-electron/src/config.js delivery-ifood-agent-electron/main.js
git -c user.name="John Doe" -c user.email="johndoe@example.com" commit -m "feat(ifood-agent): config storage in userData"
```

---

### Task B3: `src/ttlDedupe.js` + testes TDD

**Files:**
- Create: `delivery-ifood-agent-electron/src/ttlDedupe.test.js`
- Create: `delivery-ifood-agent-electron/src/ttlDedupe.js`

**Step 1: Teste failing**

```javascript
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { isStale, dedupKey, KIND_TTL_MS } = require('./ttlDedupe')

test('isStale: CONFIRMED com idade > 10min é stale', () => {
  const now = Date.now()
  const stale = { kind: 'CONFIRMED', createdAt: now - 11 * 60 * 1000 }
  const fresh = { kind: 'CONFIRMED', createdAt: now - 5 * 60 * 1000 }
  assert.equal(isStale(stale), true)
  assert.equal(isStale(fresh), false)
})

test('isStale: DELIVERED com idade > 2h é stale', () => {
  const now = Date.now()
  const stale = { kind: 'DELIVERED', createdAt: now - 3 * 60 * 60 * 1000 }
  const fresh = { kind: 'DELIVERED', createdAt: now - 1 * 60 * 60 * 1000 }
  assert.equal(isStale(stale), true)
  assert.equal(isStale(fresh), false)
})

test('isStale: sem createdAt retorna false (não descarta)', () => {
  assert.equal(isStale({ kind: 'CONFIRMED' }), false)
  assert.equal(isStale(null), false)
})

test('dedupKey: combina orderId + kind', () => {
  assert.equal(dedupKey({ orderId: '123', kind: 'CONFIRMED' }), '123:CONFIRMED')
})

test('dedupKey: fallback para orderNumber quando orderId ausente', () => {
  assert.equal(dedupKey({ orderNumber: '999', kind: 'DISPATCHED' }), '999:DISPATCHED')
})

test('dedupKey: null quando sem id nenhum', () => {
  assert.equal(dedupKey({ kind: 'CONFIRMED' }), null)
})

test('KIND_TTL_MS: valores corretos', () => {
  assert.equal(KIND_TTL_MS.CONFIRMED, 10 * 60 * 1000)
  assert.equal(KIND_TTL_MS.DISPATCHED, 30 * 60 * 1000)
  assert.equal(KIND_TTL_MS.DELIVERED, 2 * 60 * 60 * 1000)
})
```

**Step 2: Rodar — deve falhar**

```bash
cd delivery-ifood-agent-electron && node --test src/ttlDedupe.test.js
```
Expected: ERR_MODULE_NOT_FOUND.

**Step 3: Implementar `src/ttlDedupe.js`**

```javascript
'use strict'
const fs = require('fs')
const path = require('path')

const KIND_TTL_MS = {
  CONFIRMED: 10 * 60 * 1000,
  DISPATCHED: 30 * 60 * 1000,
  DELIVERED: 2 * 60 * 60 * 1000,
  MANUAL: 2 * 60 * 60 * 1000,
}
const DEFAULT_TTL_MS = 30 * 60 * 1000
const RETENTION_MS = 24 * 60 * 60 * 1000

function isStale(payload) {
  if (!payload || typeof payload.createdAt !== 'number') return false
  const ttl = (payload.kind && KIND_TTL_MS[payload.kind]) || DEFAULT_TTL_MS
  return (Date.now() - payload.createdAt) > ttl
}

function dedupKey(payload) {
  if (!payload) return null
  const id = payload.orderId || payload.orderNumber
  const kind = payload.kind || 'manual'
  if (!id) return null
  return `${id}:${kind}`
}

// In-memory + disk persistence helpers (used by main process)
function loadSent(storagePath) {
  try {
    const raw = fs.readFileSync(storagePath, 'utf8')
    const map = JSON.parse(raw)
    const now = Date.now()
    const cleaned = {}
    for (const [k, ts] of Object.entries(map)) {
      if (typeof ts === 'number' && (now - ts) < RETENTION_MS) cleaned[k] = ts
    }
    return cleaned
  } catch (e) { return {} }
}

function saveSent(storagePath, map) {
  const dir = path.dirname(storagePath)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(storagePath, JSON.stringify(map), 'utf8')
}

module.exports = { isStale, dedupKey, loadSent, saveSent, KIND_TTL_MS }
```

**Step 4: Rodar — pass**

```bash
node --test src/ttlDedupe.test.js
```
Expected: `# pass 7`.

**Step 5: Commit**

```bash
git add delivery-ifood-agent-electron/src/ttlDedupe.js delivery-ifood-agent-electron/src/ttlDedupe.test.js
git -c user.name="John Doe" -c user.email="johndoe@example.com" commit -m "feat(ifood-agent): TTL + dedupe utilities (7 tests)"
```

---

### Task B4: `src/socketClient.js`

**Files:**
- Create: `delivery-ifood-agent-electron/src/socketClient.js`
- Modify: `delivery-ifood-agent-electron/main.js`

**Step 1: `src/socketClient.js`**

```javascript
'use strict'
const { io } = require('socket.io-client')

let socket = null
let onStatusChange = () => {}
let onChatMessage = () => {}

function connect(cfg, callbacks) {
  if (socket) {
    try { socket.disconnect() } catch (_) { /* ignore */ }
    socket = null
  }
  if (!cfg || !cfg.backendUrl || !cfg.ifoodAgentToken || !cfg.companyId) {
    onStatusChange({ connected: false, reason: 'missing-config' })
    return
  }
  onStatusChange = callbacks?.onStatus || (() => {})
  onChatMessage = callbacks?.onChat || (() => {})

  socket = io(cfg.backendUrl, {
    transports: ['websocket', 'polling'],
    auth: {
      ifoodAgentToken: cfg.ifoodAgentToken,
      companyId: cfg.companyId,
    },
    reconnectionAttempts: Infinity,
    reconnectionDelay: 3000,
  })

  socket.on('connect', () => onStatusChange({ connected: true }))
  socket.on('disconnect', () => onStatusChange({ connected: false, reason: 'disconnected' }))
  socket.on('connect_error', (err) => onStatusChange({ connected: false, reason: err.message }))
  socket.on('ifood:chat', (payload) => onChatMessage(payload))
}

function disconnect() {
  if (socket) { try { socket.disconnect() } catch (_) {} socket = null }
}

module.exports = { connect, disconnect }
```

**Step 2: Wire-up no `main.js`**

```javascript
const socketClient = require('./src/socketClient')

let activeWebContents = null  // o webContents do renderer principal

function emitToRenderer(channel, payload) {
  if (activeWebContents && !activeWebContents.isDestroyed()) {
    activeWebContents.send(channel, payload)
  }
}

ipcMain.handle('socket:reconnect', (_evt, cfg) => {
  config.save(cfg)
  socketClient.connect(cfg, {
    onStatus: (st) => emitToRenderer('socket:status', st),
    onChat: (payload) => emitToRenderer('chat:message', payload),
  })
  return { ok: true }
})

// Após createWindow, salvar webContents pra emitToRenderer:
app.whenReady().then(() => {
  createWindow()
  if (mainWindow) activeWebContents = mainWindow.webContents
  // Auto-conectar com config salva, se houver
  const cfg = config.load()
  if (cfg) {
    socketClient.connect(cfg, {
      onStatus: (st) => emitToRenderer('socket:status', st),
      onChat: (payload) => emitToRenderer('chat:message', payload),
    })
  }
})
```

**Step 3: Smoke**

`npm start` — sem config, abre vazio. Não deve crashar.

**Step 4: Commit**

```bash
git add delivery-ifood-agent-electron/src/socketClient.js delivery-ifood-agent-electron/main.js
git -c user.name="John Doe" -c user.email="johndoe@example.com" commit -m "feat(ifood-agent): Socket.IO client + IPC to renderer"
```

---

### Task B5: `src/failures.js` + testes

**Files:**
- Create: `delivery-ifood-agent-electron/src/failures.test.js`
- Create: `delivery-ifood-agent-electron/src/failures.js`

**Step 1: Teste failing**

```javascript
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { add, list, clear, MAX_FAILURES } = require('./failures')

test('failures: add + list (em memória)', () => {
  clear()
  add({ orderNumber: '123', kind: 'CONFIRMED', error: 'algo' })
  add({ orderNumber: '456', kind: 'DISPATCHED', error: 'outro' })
  const items = list()
  assert.equal(items.length, 2)
  assert.equal(items[0].orderNumber, '456') // mais recente primeiro
})

test('failures: respeita MAX_FAILURES (50)', () => {
  clear()
  for (let i = 0; i < 60; i++) add({ orderNumber: String(i), kind: 'MANUAL', error: 'x' })
  assert.equal(list().length, MAX_FAILURES)
  assert.equal(list()[0].orderNumber, '59') // mais recente
})

test('failures: clear esvazia', () => {
  add({ orderNumber: '999', kind: 'MANUAL', error: 'x' })
  clear()
  assert.equal(list().length, 0)
})
```

**Step 2: Rodar — fail**

```bash
node --test src/failures.test.js
```

**Step 3: Implementar**

```javascript
'use strict'
const MAX_FAILURES = 50
let failures = []

function add(failure) {
  failures.unshift({ ...failure, at: Date.now() })
  if (failures.length > MAX_FAILURES) failures = failures.slice(0, MAX_FAILURES)
}

function list() {
  return [...failures]
}

function clear() {
  failures = []
}

module.exports = { add, list, clear, MAX_FAILURES }
```

**Step 4: Rodar — pass**

```bash
node --test src/failures.test.js
```
Expected: `# pass 3`.

**Step 5: Commit**

```bash
git add delivery-ifood-agent-electron/src/failures.js delivery-ifood-agent-electron/src/failures.test.js
git -c user.name="John Doe" -c user.email="johndoe@event.com" commit -m "feat(ifood-agent): failures store (3 tests)"
```

---

### Task B6: `src/ifoodRouter.js` (orquestra socket → renderer com filtros)

**Files:**
- Create: `delivery-ifood-agent-electron/src/ifoodRouter.js`
- Modify: `delivery-ifood-agent-electron/main.js`

**Step 1: `src/ifoodRouter.js`**

```javascript
'use strict'
const path = require('path')
const { app } = require('electron')
const { isStale, dedupKey, loadSent, saveSent } = require('./ttlDedupe')
const failures = require('./failures')

const SENT_PATH = () => path.join(app.getPath('userData'), 'sent-keys.json')
let sentMap = null  // lazy

function loadSentMapOnce() {
  if (sentMap === null) sentMap = loadSent(SENT_PATH())
  return sentMap
}

function markSent(key) {
  if (!key) return
  const map = loadSentMapOnce()
  map[key] = Date.now()
  saveSent(SENT_PATH(), map)
}

function isAlreadySent(key) {
  if (!key) return false
  return !!loadSentMapOnce()[key]
}

// Decide se descarta ou despacha ao renderer. Retorna true se despachou.
function routePayload(payload, onDispatch) {
  if (isStale(payload)) {
    console.warn('[Router] DESCARTADO (TTL):', payload?.orderNumber, payload?.kind)
    return false
  }
  const key = dedupKey(payload)
  if (key && isAlreadySent(key)) {
    console.log('[Router] DESCARTADO (dedup):', key)
    return false
  }
  onDispatch(payload)
  return true
}

// Chamado quando renderer reporta resultado do envio
function handleSendResult(result) {
  const { ok, payload, error } = result
  const key = dedupKey(payload)
  if (ok) {
    if (key) markSent(key)
  } else {
    failures.add({
      orderNumber: payload?.orderNumber,
      kind: payload?.kind,
      error: error || 'desconhecido',
    })
  }
}

module.exports = { routePayload, handleSendResult }
```

**Step 2: Wire-up no `main.js`**

Substituir o callback `onChat` da B4 para passar pelo router:

```javascript
const ifoodRouter = require('./src/ifoodRouter')
const failures = require('./src/failures')

ipcMain.handle('chat:result', (_evt, result) => {
  ifoodRouter.handleSendResult(result)
  return { ok: true }
})

ipcMain.handle('failures:list', () => failures.list())
ipcMain.handle('failures:clear', () => { failures.clear(); return { ok: true } })

// Atualizar conexão para passar pelo router
function onChatMessage(payload) {
  ifoodRouter.routePayload(payload, (p) => emitToRenderer('chat:message', p))
}

// Substituir nas chamadas socketClient.connect(...) onChat: onChatMessage
```

**Step 3: Smoke**

`npm start` — sem crash.

**Step 4: Commit**

```bash
git add delivery-ifood-agent-electron/src/ifoodRouter.js delivery-ifood-agent-electron/main.js
git -c user.name="John Doe" -c user.email="johndoe@example.com" commit -m "feat(ifood-agent): router with TTL/dedup + failures wire-up"
```

---

## Fase C — Renderer (Vue 3 + webview)

### Task C1: Vite setup para renderer

**Files:**
- Create: `delivery-ifood-agent-electron/renderer/package.json`
- Create: `delivery-ifood-agent-electron/renderer/vite.config.js`
- Create: `delivery-ifood-agent-electron/renderer/index.html`
- Create: `delivery-ifood-agent-electron/renderer/src/main.js`
- Create: `delivery-ifood-agent-electron/renderer/src/App.vue` (placeholder)

**Step 1: `renderer/package.json`**

```json
{
  "name": "ifood-agent-renderer",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build"
  },
  "dependencies": {
    "vue": "^3.4.0"
  },
  "devDependencies": {
    "vite": "^5.4.0",
    "@vitejs/plugin-vue": "^5.0.0"
  }
}
```

**Step 2: `renderer/vite.config.js`**

```javascript
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'

export default defineConfig({
  plugins: [vue()],
  base: './',
  build: { outDir: 'dist', emptyOutDir: true },
})
```

**Step 3: `renderer/index.html`**

```html
<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <title>Delivery iFood Agent</title>
    <style>html,body,#app{margin:0;padding:0;height:100%;font-family:system-ui,sans-serif}</style>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.js"></script>
  </body>
</html>
```

**Step 4: `renderer/src/main.js`**

```javascript
import { createApp } from 'vue'
import App from './App.vue'

createApp(App).mount('#app')
```

**Step 5: `renderer/src/App.vue` placeholder**

```vue
<template>
  <div style="padding:1rem">
    <h3>iFood Agent — em construção</h3>
    <p>Configure o token + URL do backend para começar.</p>
  </div>
</template>
```

**Step 6: Smoke**

```bash
cd renderer && npm install && npm run build
cd .. && npm start
```
Expected: Electron abre com a página placeholder.

**Step 7: Commit**

```bash
git add delivery-ifood-agent-electron/renderer/
git -c user.name="John Doe" -c user.email="johndoe@example.com" commit -m "feat(ifood-agent): Vite + Vue 3 renderer scaffold"
```

---

### Task C2: `App.vue` + `AppHeader.vue`

**Files:**
- Modify: `delivery-ifood-agent-electron/renderer/src/App.vue`
- Create: `delivery-ifood-agent-electron/renderer/src/components/AppHeader.vue`
- Create: `delivery-ifood-agent-electron/renderer/src/components/IfoodFrame.vue` (placeholder)

**Step 1: `App.vue`**

```vue
<template>
  <div class="agent-root">
    <AppHeader
      :status="status"
      :company-name="companyName"
      :queue-count="queueCount"
      :failures-count="failuresCount"
      @reload-ifood="onReloadIfood"
      @open-settings="settingsOpen = true"
      @open-failures="failuresOpen = true"
    />
    <IfoodFrame ref="ifoodFrame" @send-result="onSendResult" />
    <!-- SettingsModal e FailuresPanel virão em C5/C6 -->
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import AppHeader from './components/AppHeader.vue'
import IfoodFrame from './components/IfoodFrame.vue'

const status = ref({ connected: false })
const companyName = ref('—')
const queueCount = ref(0)
const failuresCount = ref(0)
const settingsOpen = ref(false)
const failuresOpen = ref(false)
const ifoodFrame = ref(null)

let unsubStatus, unsubChat

onMounted(() => {
  unsubStatus = window.agentApi.onSocketStatus((st) => { status.value = st })
  unsubChat = window.agentApi.onChatMessage((payload) => {
    queueCount.value++
    ifoodFrame.value?.dispatch(payload)
  })
  reloadFailuresCount()
  // Auto-reconectar com config salva (se houver)
  window.agentApi.getConfig().then(cfg => {
    if (cfg) window.agentApi.reconnect(cfg)
    else settingsOpen.value = true  // primeira execução
  })
})

onUnmounted(() => {
  if (unsubStatus) unsubStatus()
  if (unsubChat) unsubChat()
})

async function reloadFailuresCount() {
  const list = await window.agentApi.getFailures()
  failuresCount.value = list.length
}

function onSendResult(result) {
  queueCount.value = Math.max(0, queueCount.value - 1)
  window.agentApi.reportSendResult(result).then(reloadFailuresCount)
}

function onReloadIfood() { ifoodFrame.value?.reload() }
</script>

<style>
.agent-root { display: flex; flex-direction: column; height: 100vh; }
</style>
```

**Step 2: `AppHeader.vue`**

```vue
<template>
  <div class="agent-header">
    <span class="status-dot" :class="status.connected ? 'connected' : 'disconnected'"></span>
    <strong>{{ status.connected ? 'Conectado' : 'Desconectado' }}</strong>
    <span v-if="companyName !== '—'" class="muted">· Empresa: {{ companyName }}</span>
    <span class="muted">· Fila: {{ queueCount }}</span>
    <span :class="failuresCount > 0 ? 'failures' : 'muted'" @click="$emit('open-failures')" style="cursor:pointer">
      · Falhas: {{ failuresCount }}
    </span>
    <span style="flex:1"></span>
    <button @click="$emit('reload-ifood')" title="Recarregar iFood">⟳ iFood</button>
    <button @click="$emit('open-settings')" title="Configurações">⋮</button>
  </div>
</template>

<script setup>
defineProps(['status', 'companyName', 'queueCount', 'failuresCount'])
defineEmits(['reload-ifood', 'open-settings', 'open-failures'])
</script>

<style scoped>
.agent-header {
  display: flex; align-items: center; gap: .5rem;
  height: 40px; padding: 0 1rem;
  background: #2c2c2c; color: #fff; font-size: 0.85rem;
}
.status-dot { width: 8px; height: 8px; border-radius: 50%; background: #888; }
.status-dot.connected { background: #28a745; }
.status-dot.disconnected { background: #dc3545; }
.muted { color: #aaa; }
.failures { color: #ff6961; font-weight: 600; }
button { background: transparent; color: #fff; border: 1px solid #555; padding: 4px 10px; border-radius: 4px; cursor: pointer; }
button:hover { background: rgba(255,255,255,0.1); }
</style>
```

**Step 3: `IfoodFrame.vue` placeholder (real impl em C3)**

```vue
<template>
  <div class="ifood-frame">
    <webview
      ref="webview"
      src="https://gestordepedidos.ifood.com.br"
      partition="persist:ifood"
      allowpopups
    ></webview>
  </div>
</template>

<script setup>
import { ref, defineExpose } from 'vue'
const webview = ref(null)

function reload() { webview.value?.reload() }
function dispatch(_payload) { /* C3 */ }

defineExpose({ reload, dispatch })
</script>

<style scoped>
.ifood-frame { flex: 1; display: flex; }
webview { flex: 1; width: 100%; height: 100%; }
</style>
```

**Step 4: Build + smoke**

```bash
cd renderer && npm run build && cd ..
npm start
```
Expected: header escuro no topo + webview carregando gestor do iFood (pode pedir login).

**Step 5: Commit**

```bash
git add delivery-ifood-agent-electron/renderer/src/
git -c user.name="John Doe" -c user.email="johndoe@example.com" commit -m "feat(ifood-agent): App.vue + AppHeader.vue + webview placeholder"
```

---

### Task C3: `IfoodFrame.vue` real — injeção via `executeJavaScript`

**Files:**
- Modify: `delivery-ifood-agent-electron/renderer/src/components/IfoodFrame.vue`
- Create: `delivery-ifood-agent-electron/renderer/src/injectedScript.js`
- Create: `delivery-ifood-agent-electron/renderer/src/selectors.js`

**Step 1: `selectors.js`**

Copiar literal de `ifood-chat-extension/selectors.js`:

```javascript
export const IFOOD_SELECTORS = {
  chatToggleButton: '[data-test-id="CONSUMER_CHAT_REBORN_HEADER_ENTRY_POINT"]',
  closeChatButton: 'span.ifdl-icon-close',
  closeConversationButton: '[data-testid="close-icon"]',
  conversationListScroll: '[style*="overflow: auto"]',
  conversationOrderNumber: 'h2',
  messageInput: 'textarea[aria-label="Campo de mensagem"]',
  sendButton: 'button[aria-label="Enviar mensagem"]',
  orderCard: '[data-testid="card"]',
  orderDetailsChatButton: '[data-test-id="CONSUMER_CHAT_REBORN_MESSAGING_ORDER_DETAILS_ENTRY_POINT"]',
}
```

**Step 2: `injectedScript.js`**

Adaptar `ifood-chat-extension/content.js`: remover `chrome.runtime`, transformar em uma função `runOnce(payload, selectors)` que retorna `{ ok, error? }`. Cole o conteúdo das funções (`waitForElement`, `waitForEnabledSendButton`, `waitForCleared`, `typeAndSend`, `trySendViaConversationList`, `sendViaOrderCard`, `findOrderCard`, `closeChatPanel`, `findConversationByOrderNumber`, `pressEnter`, `sleep`). Estrutura final:

```javascript
// Será serializado como string e enviado via webview.executeJavaScript.
// NÃO usa imports do Vite — código bruto autoexecutável.
export const injectedFnSource = `
async function _ifoodSend(payload, SELECTORS) {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms))

  // ... [colar TODAS as funções do content.js aqui, com pequenas adaptações]
  // ... (waitForElement, waitForEnabledSendButton, waitForCleared, etc)

  try {
    await sendChatMessage(payload.orderNumber, payload.message)
    return { ok: true, orderNumber: payload.orderNumber, kind: payload.kind }
  } catch (e) {
    return { ok: false, error: e.message, orderNumber: payload.orderNumber, kind: payload.kind }
  }
}
_ifoodSend
`
```

(Pasta `selectors.js` separada para reuso em testes — script injetado pode receber via parameter substitution.)

**Step 3: `IfoodFrame.vue` (implementação real)**

```vue
<template>
  <div class="ifood-frame">
    <webview
      ref="webview"
      src="https://gestordepedidos.ifood.com.br"
      partition="persist:ifood"
      allowpopups
    ></webview>
  </div>
</template>

<script setup>
import { ref, onMounted, defineExpose, defineEmits } from 'vue'
import { injectedFnSource } from '../injectedScript.js'
import { IFOOD_SELECTORS } from '../selectors.js'

const emit = defineEmits(['send-result'])
const webview = ref(null)
const sending = ref(false)
const queue = []

onMounted(() => {
  webview.value?.addEventListener('dom-ready', () => {
    console.log('[IfoodFrame] webview DOM ready')
  })
})

function reload() { webview.value?.reload() }

async function dispatch(payload) {
  queue.push(payload)
  if (!sending.value) processQueue()
}

async function processQueue() {
  sending.value = true
  while (queue.length > 0) {
    const payload = queue.shift()
    let result
    try {
      const code = `(${injectedFnSource})(${JSON.stringify(payload)}, ${JSON.stringify(IFOOD_SELECTORS)})`
      result = await webview.value.executeJavaScript(code, true)
    } catch (e) {
      result = { ok: false, error: e.message, orderNumber: payload.orderNumber, kind: payload.kind }
    }
    emit('send-result', { ...result, payload })
    if (queue.length > 0) await new Promise(r => setTimeout(r, 2500))
  }
  sending.value = false
}

defineExpose({ reload, dispatch })
</script>

<style scoped>
.ifood-frame { flex: 1; display: flex; }
webview { flex: 1; width: 100%; height: 100%; }
</style>
```

**Step 4: Build + smoke**

```bash
cd renderer && npm run build && cd ..
npm start
```
Expected: webview do iFood carrega. Para teste real, precisa: configurar token (próxima task), logar no iFood, disparar mensagem do backend.

**Step 5: Commit**

```bash
git add delivery-ifood-agent-electron/renderer/src/
git -c user.name="John Doe" -c user.email="johndoe@example.com" commit -m "feat(ifood-agent): IfoodFrame com injeção via executeJavaScript"
```

---

### Task C4: `SettingsModal.vue` (onboarding)

**Files:**
- Create: `delivery-ifood-agent-electron/renderer/src/components/SettingsModal.vue`
- Modify: `delivery-ifood-agent-electron/renderer/src/App.vue` (mostrar quando `settingsOpen`)

**Step 1: `SettingsModal.vue`**

```vue
<template>
  <div v-if="visible" class="modal-backdrop" @click.self="$emit('close')">
    <div class="modal-content">
      <h4>Configurações</h4>
      <label>URL do backend</label>
      <input v-model="form.backendUrl" placeholder="https://api.deliverywl.com.br" />
      <label>Company ID</label>
      <input v-model="form.companyId" placeholder="uuid da empresa" />
      <label>Token do Agente iFood</label>
      <input v-model="form.ifoodAgentToken" placeholder="24 caracteres" />
      <p v-if="error" class="error">{{ error }}</p>
      <div class="actions">
        <button @click="$emit('close')">Cancelar</button>
        <button :disabled="saving" @click="save">{{ saving ? 'Salvando...' : 'Conectar' }}</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue'

const props = defineProps({ visible: Boolean })
const emit = defineEmits(['close', 'saved'])

const form = ref({ backendUrl: '', companyId: '', ifoodAgentToken: '' })
const saving = ref(false)
const error = ref('')

watch(() => props.visible, async (v) => {
  if (v) {
    const cfg = await window.agentApi.getConfig()
    if (cfg) form.value = { ...cfg }
    error.value = ''
  }
})

async function save() {
  error.value = ''
  if (!form.value.backendUrl || !form.value.companyId || !form.value.ifoodAgentToken) {
    error.value = 'Preencha todos os campos.'
    return
  }
  saving.value = true
  try {
    await window.agentApi.saveConfig(form.value)
    await window.agentApi.reconnect(form.value)
    emit('saved')
    emit('close')
  } catch (e) {
    error.value = e.message || 'Falha ao conectar'
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.4); display: flex; align-items: center; justify-content: center; z-index: 1000; }
.modal-content { background: #fff; padding: 1.5rem; border-radius: 8px; width: 400px; max-width: 90%; }
label { display: block; margin-top: .8rem; font-size: 0.85rem; font-weight: 600; }
input { width: 100%; padding: 6px 8px; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box; }
.actions { display: flex; gap: .5rem; justify-content: flex-end; margin-top: 1rem; }
.actions button { padding: 6px 14px; border: 1px solid #888; border-radius: 4px; cursor: pointer; background: #fff; }
.actions button:last-child { background: #105784; color: white; border-color: #105784; }
.error { color: #dc3545; font-size: 0.85rem; margin-top: .5rem; }
</style>
```

**Step 2: Integrar no `App.vue`**

Adicionar import + componente:

```vue
<SettingsModal :visible="settingsOpen" @close="settingsOpen = false" @saved="onConfigSaved" />
```

E o método:

```javascript
import SettingsModal from './components/SettingsModal.vue'

function onConfigSaved() {
  // recarregar webview e contadores
  ifoodFrame.value?.reload()
}
```

**Step 3: Build + smoke**

`npm run build && cd .. && npm start`. Primeira execução abre modal de config. Preencher e salvar.

**Step 4: Commit**

```bash
git add delivery-ifood-agent-electron/renderer/src/
git -c user.name="John Doe" -c user.email="johndoe@example.com" commit -m "feat(ifood-agent): SettingsModal para onboarding"
```

---

### Task C5: `FailuresPanel.vue` (lista + retry)

**Files:**
- Create: `delivery-ifood-agent-electron/renderer/src/components/FailuresPanel.vue`
- Modify: `delivery-ifood-agent-electron/renderer/src/App.vue` (mostrar quando `failuresOpen`)

Implementação análoga ao SettingsModal:
- Lista das falhas via `await window.agentApi.getFailures()`.
- Cada item: orderNumber, kind, error, timestamp formatado, botão "Limpar".
- Botão "Limpar tudo" no topo → `window.agentApi.clearFailures()`.

Cumprir mesmo padrão visual.

**Commit:**

```bash
git add delivery-ifood-agent-electron/renderer/src/
git -c user.name="John Doe" -c user.email="johndoe@example.com" commit -m "feat(ifood-agent): FailuresPanel"
```

---

## Fase D — Empacotamento

### Task D1: Configurar electron-builder Windows

**Files:**
- Modify: `delivery-ifood-agent-electron/package.json` (já tem skeleton; refinar)
- Create: `delivery-ifood-agent-electron/build/icon.ico` (256x256, gerado)

**Step 1: Geração de ícones**

Copiar `icon.png` do print-agent (`delivery-print-agent-electron/assets/`) e converter via `https://icoconvert.com` ou similar para `icon.ico`. Tamanhos: 256, 128, 64, 32, 16.

**Step 2: Refinar `build` no package.json**

```json
"build": {
  "appId": "com.delivery.ifoodagent",
  "productName": "Delivery iFood Agent",
  "copyright": "Copyright © 2026 Delivery SaaS",
  "directories": { "output": "dist" },
  "files": [
    "main.js", "preload.js",
    "src/**/*.js",
    "!src/**/*.test.js",
    "renderer/dist/**",
    "node_modules/**"
  ],
  "win": {
    "target": "nsis",
    "icon": "build/icon.ico",
    "publisherName": "Delivery SaaS"
  },
  "nsis": {
    "oneClick": false,
    "perMachine": false,
    "allowToChangeInstallationDirectory": true,
    "createDesktopShortcut": true,
    "createStartMenuShortcut": true,
    "shortcutName": "Delivery iFood Agent",
    "language": "1046"
  }
}
```

**Step 3: Build local**

```bash
npm run build:win
```
Expected: `dist/Delivery iFood Agent Setup 1.0.0.exe` criado.

**Step 4: Smoke install (manual)**

Executar o `.exe` em uma VM ou outra pasta, confirmar que instala e abre.

**Step 5: Commit**

```bash
git add delivery-ifood-agent-electron/package.json delivery-ifood-agent-electron/build/icon.ico
git -c user.name="John Doe" -c user.email="johndoe@example.com" commit -m "feat(ifood-agent): NSIS Windows installer"
```

---

### Task D2: Configurar Mac DMG + notarização

**Files:**
- Modify: `delivery-ifood-agent-electron/package.json`
- Create: `delivery-ifood-agent-electron/build/icon.icns`
- Create: `delivery-ifood-agent-electron/build/entitlements.mac.plist`

**Step 1: Ícone Mac**

Converter PNG → ICNS (`iconutil` no Mac ou online). 1024x1024 base.

**Step 2: Entitlements**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-jit</key><true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/>
  <key>com.apple.security.cs.disable-library-validation</key><true/>
  <key>com.apple.security.network.client</key><true/>
</dict>
</plist>
```

**Step 3: Build config**

```json
"mac": {
  "target": "dmg",
  "icon": "build/icon.icns",
  "category": "public.app-category.business",
  "hardenedRuntime": true,
  "entitlements": "build/entitlements.mac.plist",
  "entitlementsInherit": "build/entitlements.mac.plist",
  "gatekeeperAssess": false,
  "notarize": {
    "teamId": "TEAM_ID_DO_DEVELOPER_ACCOUNT"
  }
},
"afterSign": "build/notarize.js"
```

**Step 4: Variáveis de ambiente para notarização**

`APPLE_ID`, `APPLE_ID_PASSWORD` (app-specific), `APPLE_TEAM_ID` no ambiente.

**Step 5: Build (em Mac obrigatório)**

```bash
npm run build:mac
```

**Step 6: Commit**

```bash
git add delivery-ifood-agent-electron/build/ delivery-ifood-agent-electron/package.json
git -c user.name="John Doe" -c user.email="johndoe@example.com" commit -m "feat(ifood-agent): macOS DMG + notarization config"
```

---

### Task D3: Auto-update

**Files:**
- Modify: `delivery-ifood-agent-electron/main.js` (handler de auto-update)
- Modify: `delivery-ifood-agent-electron/package.json` (`build.publish`)

**Step 1: Adicionar `electron-updater` ao package.json deps**

```bash
cd delivery-ifood-agent-electron && npm install electron-updater
```

**Step 2: `main.js`**

```javascript
const { autoUpdater } = require('electron-updater')

app.whenReady().then(() => {
  // ... existing
  setTimeout(() => autoUpdater.checkForUpdatesAndNotify().catch(() => {}), 5000)
  setInterval(() => autoUpdater.checkForUpdatesAndNotify().catch(() => {}), 6 * 60 * 60 * 1000)
})
```

**Step 3: `package.json#build.publish`**

```json
"publish": {
  "provider": "generic",
  "url": "https://releases.deliverywl.com.br/ifood-agent"
}
```

(Ou GitHub Releases via `"provider": "github"` se preferir.)

**Step 4: Commit**

```bash
git add delivery-ifood-agent-electron/package.json delivery-ifood-agent-electron/main.js
git -c user.name="John Doe" -c user.email="johndoe@example.com" commit -m "feat(ifood-agent): auto-update via electron-updater"
```

---

## Fase E — Frontend admin (UI distribuição)

### Task E1: Página "Agente iFood" no admin

**Files:**
- Create: `delivery-saas-frontend/src/views/IfoodAgentSettings.vue`
- Modify: `delivery-saas-frontend/src/router.js`
- Modify: `delivery-saas-frontend/src/config/nav.js`

**Step 1: View**

Layout do design (Seção 6):
- Status (busca via novo endpoint `GET /ifood-chat/agent-status` que retorna se há socket conectado).
- Botão "Baixar Windows" / "Baixar Mac".
- Botão "Regenerar token" → `POST /ifood-chat/generate-agent-token`.

**Step 2: Rota + nav**

```javascript
{ path: '/integrations/ifood-agent', component: () => import('./views/IfoodAgentSettings.vue'), meta: { requiresAuth: true, role: 'ADMIN' } }
```

Item de menu em "Configurações → Integrações" (ou "Marketing → Agente iFood", o que fizer sentido).

**Step 3: Commit**

```bash
git add delivery-saas-frontend/src/views/IfoodAgentSettings.vue delivery-saas-frontend/src/router.js delivery-saas-frontend/src/config/nav.js
git -c user.name="John Doe" -c user.email="johndoe@example.com" commit -m "feat(admin): página Agente iFood (download + token)"
```

---

### Task E2: Aviso "loja sem extensão nem agente há 24h"

**Files:**
- Modify: backend — adicionar campo `lastIfoodIntegrationConnect` ou query on demand.
- Modify: frontend Dashboard ou Header — exibir alerta.

**Mínimo viável**: query no Dashboard que verifica se há `ifoodAgent` ou `extension` socket conectado **agora**; se não, mostra alerta.

Se for mais simples, postergar para fase futura.

**Commit:**

```bash
git -c user.name="John Doe" -c user.email="johndoe@example.com" commit -m "feat(admin): aviso de integração iFood desconectada"
```

---

## Fase F — QA + docs

### Task F1: QA manual end-to-end

Checklist para o operador rodar localmente:

1. Backend rodando + extensão também rodando (paralelismo).
2. No admin web: `Integrações → Agente iFood` → Regenerar token → copiar token.
3. Baixar app Win (ou rodar `npm start` na pasta).
4. Modal de config: colar URL backend + companyId + token → Conectar.
5. Webview do iFood abre. Fazer login normalmente.
6. Disparar pedido teste (via PDV ou simulação). Backend emite `ifood:chat`.
7. Conferir que a mensagem é enviada no iFood.
8. Provocar falha (errar selector via DevTools manual). Conferir badge vermelho + falha listada no FailuresPanel.
9. Reiniciar app. Conferir que config + login persistem.
10. Repetir com extensão ainda ativa: backend emite para ambos; dedup local impede 2x.

### Task F2: README

`delivery-ifood-agent-electron/README.md` com:
- Visão geral.
- Como rodar dev (`npm install && npm start`).
- Como buildar (`npm run build:win` / `build:mac`).
- Estrutura do projeto.
- Como atualizar selectors quando o iFood quebrar.
- Linkar `docs/plans/2026-05-20-ifood-agent-electron-design.md`.

---

## Notas finais

- **Branch nova**: `feat/ifood-agent-electron` a partir de main.
- **Commits pequenos**: cada task fecha 1 commit. Cuidado para `node_modules/` não entrar.
- **Renderer não compartilha workspace com o main**: cada um tem seu `package.json` e `node_modules` (sub-pasta).
- **Cookies do iFood**: persistidos via `partition: 'persist:ifood'` — não tocar.
- **Auto-update**: precisa de hosting do feed antes de publicar v1. Fase D3 pode ser opcional na v1 (manual download).
- **Compatibilidade extensão**: NUNCA mexer em `ifood-chat-extension/` neste plano. Manter intacta para coexistência.
