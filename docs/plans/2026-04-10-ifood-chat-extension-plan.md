# iFood Chat Extension — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Chrome extension that automatically sends messages in the iFood Gestor de Pedidos chat when order status changes, controlled by the Delivery SaaS backend via Socket.IO.

**Architecture:** Backend emits `ifood:chat` events via Socket.IO when status changes. Chrome extension (Manifest V3) receives events, manipulates the iFood DOM to send messages. Manual send triggered from Vue frontend via REST endpoint.

**Tech Stack:** Chrome Extension (Manifest V3), Socket.IO client, Express.js routes, Prisma model, Vue 3 + Bootstrap 5

---

### Task 1: Prisma Model — IfoodChatMessage

**Files:**
- Modify: `delivery-saas-backend/prisma/schema.prisma`

**Step 1: Add IfoodChatMessage model to schema**

Add after the existing `PrinterSetting` model (~line 657):

```prisma
model IfoodChatMessage {
  id        Int      @id @default(autoincrement())
  storeId   String
  store     Store    @relation(fields: [storeId], references: [id])
  status    String   // CONFIRMED, DISPATCHED, DELIVERED, MANUAL
  message   String
  enabled   Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([storeId, status])
}
```

Also add to the `Store` model the reverse relation:
```prisma
ifoodChatMessages IfoodChatMessage[]
```

**Step 2: Push schema to database**

Run: `npx prisma db push` (inside backend container)
Expected: schema synced without errors

**Step 3: Generate Prisma client**

Run: `npx prisma generate`
Expected: client generated successfully

**Step 4: Commit**

```bash
git add delivery-saas-backend/prisma/schema.prisma
git commit -m "feat(ifood-chat): add IfoodChatMessage prisma model"
```

---

### Task 2: Backend — REST Routes for Chat Message Config

**Files:**
- Create: `delivery-saas-backend/src/routes/ifoodChat.js`
- Modify: `delivery-saas-backend/src/index.js` (register route)

**Step 1: Create ifoodChat.js route file**

```javascript
import express from 'express'
import { prisma } from '../prisma.js'
import { authMiddleware, requireRole } from '../auth.js'

const router = express.Router()
router.use(authMiddleware)
router.use(requireRole('ADMIN'))

// Default messages seeded when first fetched
const DEFAULTS = [
  { status: 'CONFIRMED', message: 'Olá {nome}! 😊 Estamos preparando o seu pedido #{numero} com muito carinho. 💜', enabled: true },
  { status: 'DISPATCHED', message: '{nome}! O seu pedido #{numero} acabou de sair para entrega! 🛵 Fique atento que em breve o entregador estará no endereço solicitado.', enabled: true },
  { status: 'DELIVERED', message: 'Agora que seu pedido foi entregue, ficaríamos muito felizes se você pudesse dedicar um momento para avaliá-lo. Sua opinião é extremamente valiosa para nós! 🌟', enabled: true },
  { status: 'MANUAL', message: 'Olá {nome}! Temos uma mensagem sobre o seu pedido #{numero}.', enabled: false },
]

// GET /ifood-chat/messages/:storeId
router.get('/messages/:storeId', async (req, res) => {
  try {
    const { storeId } = req.params
    let messages = await prisma.ifoodChatMessage.findMany({ where: { storeId } })

    // Seed defaults if empty
    if (messages.length === 0) {
      await prisma.ifoodChatMessage.createMany({
        data: DEFAULTS.map(d => ({ ...d, storeId })),
        skipDuplicates: true,
      })
      messages = await prisma.ifoodChatMessage.findMany({ where: { storeId } })
    }

    res.json({ ok: true, messages })
  } catch (e) {
    console.error('GET /ifood-chat/messages failed', e)
    res.status(500).json({ ok: false, error: e.message })
  }
})

// PUT /ifood-chat/messages/:storeId
router.put('/messages/:storeId', async (req, res) => {
  try {
    const { storeId } = req.params
    const { messages } = req.body // array of { status, message, enabled }

    if (!Array.isArray(messages)) return res.status(400).json({ ok: false, message: 'messages must be an array' })

    const results = []
    for (const m of messages) {
      const updated = await prisma.ifoodChatMessage.upsert({
        where: { storeId_status: { storeId, status: m.status } },
        update: { message: m.message, enabled: m.enabled },
        create: { storeId, status: m.status, message: m.message, enabled: m.enabled },
      })
      results.push(updated)
    }

    res.json({ ok: true, messages: results })
  } catch (e) {
    console.error('PUT /ifood-chat/messages failed', e)
    res.status(500).json({ ok: false, error: e.message })
  }
})

// POST /ifood-chat/send — manual send
router.post('/send', async (req, res) => {
  try {
    const { orderId, storeId } = req.body
    if (!orderId || !storeId) return res.status(400).json({ ok: false, message: 'orderId and storeId required' })

    const order = await prisma.order.findUnique({ where: { id: orderId } })
    if (!order) return res.status(404).json({ ok: false, message: 'Order not found' })

    const msgConfig = await prisma.ifoodChatMessage.findUnique({
      where: { storeId_status: { storeId, status: 'MANUAL' } },
    })
    if (!msgConfig || !msgConfig.enabled) return res.status(400).json({ ok: false, message: 'Manual message not configured or disabled' })

    // Resolve order number from iFood (displayId or externalId short form)
    const orderNumber = order.displayId || order.externalId || String(order.id)
    const customerName = order.payload?.customer?.name || order.payload?.order?.customer?.name || 'Cliente'

    const finalMessage = msgConfig.message
      .replace(/\{nome\}/g, customerName)
      .replace(/\{numero\}/g, orderNumber)

    // Emit to extension via Socket.IO
    const { emitirIfoodChat } = await import('../index.js')
    emitirIfoodChat({ orderNumber, message: finalMessage, storeId, companyId: order.companyId })

    res.json({ ok: true, sent: true })
  } catch (e) {
    console.error('POST /ifood-chat/send failed', e)
    res.status(500).json({ ok: false, error: e.message })
  }
})

export default router
```

**Step 2: Register route in index.js**

In `delivery-saas-backend/src/index.js`, import and register the route alongside existing routes (find where `printerSettingRouter` is mounted, ~line 100-150 area):

```javascript
import ifoodChatRouter from './routes/ifoodChat.js'
// ... in route registration:
app.use('/ifood-chat', ifoodChatRouter)
```

**Step 3: Commit**

```bash
git add delivery-saas-backend/src/routes/ifoodChat.js delivery-saas-backend/src/index.js
git commit -m "feat(ifood-chat): add REST routes for message config and manual send"
```

---

### Task 3: Backend — Socket.IO Emit Function + Extension Auth

**Files:**
- Modify: `delivery-saas-backend/src/index.js` (add `emitirIfoodChat` function + extension auth middleware)

**Step 1: Add `emitirIfoodChat` export function**

Add after `emitirEntregadorOffline` (~line 902):

```javascript
export function emitirIfoodChat({ orderNumber, message, storeId, companyId }) {
  if (!io) {
    console.warn('⚠️ Socket.IO não inicializado — ifood:chat não emitido.');
    return;
  }
  try {
    const payload = { orderNumber, message, storeId };
    const sockets = Array.from(io.sockets.sockets.values());
    let sent = 0;
    for (const s of sockets) {
      // Only send to extension sockets of the same company
      if (!s.extension) continue;
      if (s.companyId && s.companyId !== companyId) continue;
      try { s.emit('ifood:chat', payload); sent++; } catch (e) { /* ignore */ }
    }
    console.log(`📨 ifood:chat emitido para ${sent} extensões — pedido: ${orderNumber}`);
  } catch (e) {
    console.warn('Falha ao emitir ifood:chat:', e?.message || e);
  }
}
```

**Step 2: Add extension auth to Socket.IO middleware**

In the existing `io.use(async (socket, next) => { ... })` middleware (~line 511-588), add extension token validation alongside agent token validation. After the agent auth block, add:

```javascript
// Extension authentication (similar to agent auth)
const extensionToken = socket.handshake.auth.extensionToken;
if (extensionToken) {
  try {
    const companyId = socket.handshake.auth.companyId;
    if (!companyId) return next(new Error('extension-missing-companyId'));
    const setting = await prisma.printerSetting.findUnique({
      where: { companyId },
      select: { extensionTokenHash: true },
    });
    if (!setting || !setting.extensionTokenHash) return next(new Error('extension-not-configured'));
    const incomingHash = sha256(extensionToken);
    if (incomingHash !== setting.extensionTokenHash) return next(new Error('invalid-extension-token'));
    socket.extension = { companyId };
    socket.companyId = companyId;
    console.log(`🧩 Extensão iFood autenticada — company: ${companyId}`);
  } catch (e) {
    return next(new Error('extension-auth-error'));
  }
  return next();
}
```

**Step 3: Add `extensionTokenHash` field to PrinterSetting**

In `prisma/schema.prisma`, add to `PrinterSetting` model:

```prisma
extensionTokenHash       String?
extensionTokenCreatedAt  DateTime?
```

Run: `npx prisma db push && npx prisma generate`

**Step 4: Add extension token rotation endpoint**

In `delivery-saas-backend/src/routes/ifoodChat.js`, add:

```javascript
import { randomToken, sha256 } from '../utils.js'

// POST /ifood-chat/generate-token
router.post('/generate-token', async (req, res) => {
  try {
    const companyId = req.user.companyId
    if (!companyId) return res.status(400).json({ ok: false, message: 'No company' })

    const token = randomToken(24)
    const tokenHash = sha256(token)

    await prisma.printerSetting.upsert({
      where: { companyId },
      update: { extensionTokenHash: tokenHash, extensionTokenCreatedAt: new Date() },
      create: { companyId, extensionTokenHash: tokenHash, extensionTokenCreatedAt: new Date() },
    })

    res.json({ ok: true, token })
  } catch (e) {
    console.error('POST /ifood-chat/generate-token failed', e)
    res.status(500).json({ ok: false, error: e.message })
  }
})
```

**Step 5: Commit**

```bash
git add delivery-saas-backend/src/index.js delivery-saas-backend/src/routes/ifoodChat.js delivery-saas-backend/prisma/schema.prisma
git commit -m "feat(ifood-chat): add Socket.IO emit function, extension auth, and token generation"
```

---

### Task 4: Backend — Hook into Status Change Flow

**Files:**
- Modify: `delivery-saas-backend/src/services/ifoodWebhookProcessor.js` (~line 797)
- Modify: `delivery-saas-backend/src/routes/orders.js` (multiple status change points)

**Step 1: Create helper function for ifood chat emission**

Create: `delivery-saas-backend/src/services/ifoodChatEmitter.js`

```javascript
import { prisma } from '../prisma.js'

/**
 * Maps internal status to IfoodChatMessage status key.
 * Returns null if status should not trigger a chat message.
 */
function mapStatusToChatKey(internalStatus) {
  switch (internalStatus) {
    case 'EM_PREPARO': return 'CONFIRMED'
    case 'SAIU_PARA_ENTREGA': return 'DISPATCHED'
    case 'CONCLUIDO': return 'DELIVERED'
    default: return null
  }
}

/**
 * Check if order is from iFood integration.
 */
function isIfoodOrder(order) {
  if (!order?.payload) return false
  const p = order.payload
  return (
    p.provider === 'IFOOD' ||
    p.order?.salesChannel === 'IFOOD' ||
    p.salesChannel === 'IFOOD' ||
    Boolean(p.order?.merchant || p.merchant)
  )
}

/**
 * Attempts to emit an ifood:chat event for an order status change.
 * Non-blocking, best-effort. Call after emitirPedidoAtualizado.
 */
export async function tryEmitIfoodChat(order, newStatus) {
  try {
    if (!isIfoodOrder(order)) return

    const chatKey = mapStatusToChatKey(newStatus)
    if (!chatKey) return

    const storeId = order.storeId
    if (!storeId) return

    const msgConfig = await prisma.ifoodChatMessage.findUnique({
      where: { storeId_status: { storeId, status: chatKey } },
    })
    if (!msgConfig || !msgConfig.enabled) return

    const orderNumber = order.displayId || order.externalId || String(order.id)
    const customerName = order.payload?.customer?.name || order.payload?.order?.customer?.name || 'Cliente'

    const finalMessage = msgConfig.message
      .replace(/\{nome\}/g, customerName)
      .replace(/\{numero\}/g, orderNumber)

    const { emitirIfoodChat } = await import('../index.js')
    emitirIfoodChat({ orderNumber, message: finalMessage, storeId, companyId: order.companyId })
  } catch (e) {
    console.warn('[ifoodChatEmitter] tryEmitIfoodChat failed:', e?.message || e)
  }
}
```

**Step 2: Hook into ifoodWebhookProcessor.js**

At `delivery-saas-backend/src/services/ifoodWebhookProcessor.js` line 797, after `emitirPedidoAtualizado(savedOrder)`:

```javascript
import { tryEmitIfoodChat } from './ifoodChatEmitter.js'

// ... at line ~798, after emitirPedidoAtualizado:
tryEmitIfoodChat(savedOrder, res.to).catch(() => {});
```

**Step 3: Hook into orders.js status change points**

At each point in `delivery-saas-backend/src/routes/orders.js` where `emitirPedidoAtualizado` is called, add the chat emit call right after. There are ~5 call sites (lines 278, 347, 541, 586, 644). For each one, add:

```javascript
import { tryEmitIfoodChat } from '../services/ifoodChatEmitter.js'

// After each emitirPedidoAtualizado call:
tryEmitIfoodChat(order_or_updated, newStatus).catch(() => {});
```

The main one at line 644 (generic status advance):
```javascript
try { const idx = await import('../index.js'); idx.emitirPedidoAtualizado(updated); } catch (e) { console.warn('...'); }
tryEmitIfoodChat(updated, status).catch(() => {});
```

**Step 4: Commit**

```bash
git add delivery-saas-backend/src/services/ifoodChatEmitter.js delivery-saas-backend/src/services/ifoodWebhookProcessor.js delivery-saas-backend/src/routes/orders.js
git commit -m "feat(ifood-chat): hook chat emission into status change flow"
```

---

### Task 5: Chrome Extension — Project Structure + Manifest

**Files:**
- Create: `ifood-chat-extension/manifest.json`
- Create: `ifood-chat-extension/popup.html`
- Create: `ifood-chat-extension/popup.js`
- Create: `ifood-chat-extension/background.js`
- Create: `ifood-chat-extension/content.js`
- Create: `ifood-chat-extension/selectors.js`
- Create: `ifood-chat-extension/icons/` (placeholder)

**Step 1: Create manifest.json**

```json
{
  "manifest_version": 3,
  "name": "Delivery SaaS - iFood Chat",
  "version": "1.0.0",
  "description": "Envia mensagens automáticas no chat do iFood Gestor de Pedidos",
  "permissions": ["storage", "activeTab", "scripting"],
  "host_permissions": ["https://gestordepedidos.ifood.com.br/*"],
  "background": {
    "service_worker": "background.js",
    "type": "module"
  },
  "content_scripts": [
    {
      "matches": ["https://gestordepedidos.ifood.com.br/*"],
      "js": ["selectors.js", "content.js"],
      "run_at": "document_idle"
    }
  ],
  "action": {
    "default_popup": "popup.html",
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  },
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```

**Step 2: Create popup.html**

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { width: 320px; padding: 16px; font-family: -apple-system, sans-serif; font-size: 14px; }
    h3 { margin: 0 0 12px; font-size: 16px; }
    label { display: block; margin-bottom: 4px; font-weight: 600; }
    input { width: 100%; padding: 6px 8px; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box; margin-bottom: 12px; }
    .status { padding: 8px; border-radius: 4px; text-align: center; margin-bottom: 12px; font-weight: 600; }
    .status.connected { background: #d4edda; color: #155724; }
    .status.disconnected { background: #f8d7da; color: #721c24; }
    button { width: 100%; padding: 8px; border: none; border-radius: 4px; cursor: pointer; font-weight: 600; }
    .btn-primary { background: #0d6efd; color: #fff; }
    .btn-primary:hover { background: #0b5ed7; }
    .queue-info { font-size: 12px; color: #666; margin-top: 8px; }
  </style>
</head>
<body>
  <h3>🍔 iFood Chat Extension</h3>
  <div id="statusIndicator" class="status disconnected">Desconectado</div>

  <label>URL do Backend</label>
  <input type="text" id="backendUrl" placeholder="https://seudominio.com">

  <label>Token da Extensão</label>
  <input type="text" id="extensionToken" placeholder="Token gerado no sistema">

  <label>Company ID</label>
  <input type="text" id="companyId" placeholder="ID da empresa">

  <button class="btn-primary" id="saveBtn">Salvar e Conectar</button>
  <div class="queue-info" id="queueInfo"></div>

  <script src="popup.js"></script>
</body>
</html>
```

**Step 3: Create popup.js**

```javascript
const backendUrlInput = document.getElementById('backendUrl');
const tokenInput = document.getElementById('extensionToken');
const companyIdInput = document.getElementById('companyId');
const saveBtn = document.getElementById('saveBtn');
const statusIndicator = document.getElementById('statusIndicator');
const queueInfo = document.getElementById('queueInfo');

// Load saved config
chrome.storage.local.get(['backendUrl', 'extensionToken', 'companyId'], (data) => {
  if (data.backendUrl) backendUrlInput.value = data.backendUrl;
  if (data.extensionToken) tokenInput.value = data.extensionToken;
  if (data.companyId) companyIdInput.value = data.companyId;
});

// Check connection status
chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (response) => {
  if (response && response.connected) {
    statusIndicator.textContent = 'Conectado';
    statusIndicator.className = 'status connected';
  }
  if (response && response.queueLength > 0) {
    queueInfo.textContent = `${response.queueLength} mensagem(ns) na fila`;
  }
});

saveBtn.addEventListener('click', () => {
  const config = {
    backendUrl: backendUrlInput.value.trim().replace(/\/+$/, ''),
    extensionToken: tokenInput.value.trim(),
    companyId: companyIdInput.value.trim(),
  };
  chrome.storage.local.set(config, () => {
    chrome.runtime.sendMessage({ type: 'RECONNECT', config });
    saveBtn.textContent = 'Salvo!';
    setTimeout(() => { saveBtn.textContent = 'Salvar e Conectar'; }, 1500);
  });
});
```

**Step 4: Commit**

```bash
git add ifood-chat-extension/
git commit -m "feat(ifood-chat): create Chrome extension structure with manifest and popup"
```

---

### Task 6: Chrome Extension — Background Service Worker

**Files:**
- Create: `ifood-chat-extension/background.js`

**Step 1: Implement background.js with Socket.IO connection**

Note: Manifest V3 service workers can't use ES modules with Socket.IO easily. We'll bundle socket.io-client standalone (download `socket.io.min.js` from CDN and include it).

```javascript
// background.js
// Import socket.io client (bundled as IIFE, loaded via importScripts)
importScripts('lib/socket.io.min.js');

let socket = null;
let connected = false;
let messageQueue = [];

// Connect to backend
async function connect(config) {
  if (socket) {
    socket.disconnect();
    socket = null;
  }

  if (!config.backendUrl || !config.extensionToken || !config.companyId) {
    console.warn('[iFood Extension] Missing config');
    return;
  }

  socket = io(config.backendUrl, {
    transports: ['polling', 'websocket'],
    auth: {
      extensionToken: config.extensionToken,
      companyId: config.companyId,
    },
    reconnectionAttempts: Infinity,
    reconnectionDelay: 3000,
  });

  socket.on('connect', () => {
    console.log('[iFood Extension] Connected to backend');
    connected = true;
    updateBadge('on');
  });

  socket.on('disconnect', () => {
    console.log('[iFood Extension] Disconnected');
    connected = false;
    updateBadge('off');
  });

  socket.on('connect_error', (err) => {
    console.error('[iFood Extension] Connection error:', err.message);
    connected = false;
    updateBadge('off');
  });

  // Listen for chat commands
  socket.on('ifood:chat', (payload) => {
    console.log('[iFood Extension] Received ifood:chat:', payload);
    forwardToContentScript(payload);
  });
}

// Forward message to content script running on iFood tab
async function forwardToContentScript(payload) {
  try {
    const tabs = await chrome.tabs.query({ url: 'https://gestordepedidos.ifood.com.br/*' });
    if (tabs.length === 0) {
      console.warn('[iFood Extension] No iFood tab found. Queuing message.');
      messageQueue.push(payload);
      return;
    }

    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, { type: 'SEND_CHAT_MESSAGE', payload });
    }
  } catch (e) {
    console.error('[iFood Extension] Failed to forward to content script:', e);
    messageQueue.push(payload);
  }
}

// Badge indicator
function updateBadge(state) {
  if (state === 'on') {
    chrome.action.setBadgeText({ text: '✓' });
    chrome.action.setBadgeBackgroundColor({ color: '#28a745' });
  } else {
    chrome.action.setBadgeText({ text: '!' });
    chrome.action.setBadgeBackgroundColor({ color: '#dc3545' });
  }
}

// Handle messages from popup and content script
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'GET_STATUS') {
    sendResponse({ connected, queueLength: messageQueue.length });
    return true;
  }
  if (msg.type === 'RECONNECT') {
    connect(msg.config);
    sendResponse({ ok: true });
    return true;
  }
  if (msg.type === 'CONTENT_SCRIPT_READY') {
    // Flush queued messages
    if (messageQueue.length > 0) {
      const queued = [...messageQueue];
      messageQueue = [];
      for (const payload of queued) {
        forwardToContentScript(payload);
      }
    }
    sendResponse({ ok: true });
    return true;
  }
  if (msg.type === 'MESSAGE_SENT') {
    console.log('[iFood Extension] Message sent successfully:', msg.orderNumber);
    sendResponse({ ok: true });
    return true;
  }
  if (msg.type === 'MESSAGE_FAILED') {
    console.error('[iFood Extension] Message failed:', msg.orderNumber, msg.error);
    // Could re-queue or notify backend
    sendResponse({ ok: true });
    return true;
  }
});

// Auto-connect on startup
chrome.storage.local.get(['backendUrl', 'extensionToken', 'companyId'], (config) => {
  if (config.backendUrl && config.extensionToken) {
    connect(config);
  } else {
    updateBadge('off');
  }
});
```

**Step 2: Download socket.io client library**

Run: `mkdir -p ifood-chat-extension/lib && curl -o ifood-chat-extension/lib/socket.io.min.js https://cdn.socket.io/4.7.5/socket.io.min.js`

**Step 3: Commit**

```bash
git add ifood-chat-extension/background.js ifood-chat-extension/lib/
git commit -m "feat(ifood-chat): implement background service worker with Socket.IO"
```

---

### Task 7: Chrome Extension — DOM Selectors File

**Files:**
- Create: `ifood-chat-extension/selectors.js`

**Step 1: Create selectors.js**

This file isolates all iFood DOM selectors for easy maintenance. **These selectors need to be verified against the actual iFood Gestor de Pedidos DOM.** Use Chrome DevTools to inspect elements.

```javascript
// selectors.js — iFood Gestor de Pedidos DOM selectors
// Update these when iFood changes their HTML structure
window.IFOOD_SELECTORS = {
  // Chat panel
  chatToggleButton: '[data-testid="chat-toggle"], .chat-button, [aria-label="Chat"]',
  conversationList: '[data-testid="conversation-list"], .conversations-list',
  conversationItem: '[data-testid="conversation-item"], .conversation-item',
  conversationOrderNumber: '.conversation-order-number, .order-number',

  // Inside a conversation
  messageInput: '[data-testid="message-input"], .chat-input textarea, .chat-input input',
  sendButton: '[data-testid="send-button"], .chat-send-button, button[type="submit"]',

  // Close/back button
  closeChatButton: '[data-testid="close-chat"], .close-chat, .back-button',
};
```

> **IMPORTANT:** These selectors are placeholders. Before deploying, inspect the actual iFood Gestor de Pedidos DOM and update selectors accordingly. The iFood page is a React SPA — selectors may need to target `data-testid`, class names, or aria attributes.

**Step 2: Commit**

```bash
git add ifood-chat-extension/selectors.js
git commit -m "feat(ifood-chat): add DOM selectors file (to be verified against live iFood page)"
```

---

### Task 8: Chrome Extension — Content Script

**Files:**
- Create: `ifood-chat-extension/content.js`

**Step 1: Implement content.js**

```javascript
// content.js — runs on gestordepedidos.ifood.com.br
// Depends on selectors.js being loaded first (declared in manifest)

const SELECTORS = window.IFOOD_SELECTORS;
const MESSAGE_DELAY_MS = 2500; // delay between messages to avoid rate limiting
let processing = false;
const queue = [];

// Notify background that content script is ready
chrome.runtime.sendMessage({ type: 'CONTENT_SCRIPT_READY' });

// Listen for messages from background
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'SEND_CHAT_MESSAGE') {
    queue.push(msg.payload);
    processQueue();
    sendResponse({ ok: true, queued: true });
  }
  return true;
});

async function processQueue() {
  if (processing || queue.length === 0) return;
  processing = true;

  while (queue.length > 0) {
    const payload = queue.shift();
    try {
      await sendChatMessage(payload.orderNumber, payload.message);
      chrome.runtime.sendMessage({ type: 'MESSAGE_SENT', orderNumber: payload.orderNumber });
    } catch (e) {
      console.error('[iFood Extension] Failed to send message:', e);
      chrome.runtime.sendMessage({ type: 'MESSAGE_FAILED', orderNumber: payload.orderNumber, error: e.message });
    }

    // Delay between messages
    if (queue.length > 0) {
      await sleep(MESSAGE_DELAY_MS);
    }
  }

  processing = false;
}

async function sendChatMessage(orderNumber, message) {
  // Step 1: Open chat panel
  const chatBtn = await waitForElement(SELECTORS.chatToggleButton, 3000);
  if (!chatBtn) throw new Error('Chat button not found');
  chatBtn.click();
  await sleep(1000);

  // Step 2: Find conversation by order number
  const conversationList = await waitForElement(SELECTORS.conversationList, 3000);
  if (!conversationList) throw new Error('Conversation list not found');

  const conversation = await findConversationByOrderNumber(orderNumber);
  if (!conversation) throw new Error(`Conversation for order ${orderNumber} not found`);
  conversation.click();
  await sleep(1000);

  // Step 3: Type message
  const input = await waitForElement(SELECTORS.messageInput, 3000);
  if (!input) throw new Error('Message input not found');

  // Set value and dispatch input event (React controlled inputs need this)
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype, 'value'
  )?.set || Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype, 'value'
  )?.set;

  if (nativeInputValueSetter) {
    nativeInputValueSetter.call(input, message);
  } else {
    input.value = message;
  }
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await sleep(300);

  // Step 4: Click send
  const sendBtn = await waitForElement(SELECTORS.sendButton, 2000);
  if (sendBtn) {
    sendBtn.click();
  } else {
    // Fallback: press Enter
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
  }
  await sleep(500);

  // Step 5: Close chat (go back to conversation list or close panel)
  try {
    const closeBtn = document.querySelector(SELECTORS.closeChatButton);
    if (closeBtn) closeBtn.click();
  } catch (e) { /* ignore */ }

  console.log(`[iFood Extension] Message sent to order ${orderNumber}`);
}

async function findConversationByOrderNumber(orderNumber) {
  // Clean the order number (remove # if present)
  const cleanNumber = orderNumber.replace(/^#/, '');

  const items = document.querySelectorAll(SELECTORS.conversationItem);
  for (const item of items) {
    const text = item.textContent || '';
    if (text.includes(`#${cleanNumber}`) || text.includes(cleanNumber)) {
      return item;
    }
  }

  // If not found in visible list, try scrolling
  const list = document.querySelector(SELECTORS.conversationList);
  if (list) {
    // Scroll through the list to find the conversation
    const scrollAttempts = 5;
    for (let i = 0; i < scrollAttempts; i++) {
      list.scrollTop += 300;
      await sleep(500);
      const items = document.querySelectorAll(SELECTORS.conversationItem);
      for (const item of items) {
        const text = item.textContent || '';
        if (text.includes(`#${cleanNumber}`) || text.includes(cleanNumber)) {
          return item;
        }
      }
    }
  }

  return null;
}

// Utility: wait for element to appear in DOM
function waitForElement(selector, timeout = 5000) {
  return new Promise((resolve) => {
    const el = document.querySelector(selector);
    if (el) return resolve(el);

    const observer = new MutationObserver(() => {
      const el = document.querySelector(selector);
      if (el) {
        observer.disconnect();
        resolve(el);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    setTimeout(() => {
      observer.disconnect();
      resolve(null);
    }, timeout);
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

**Step 2: Commit**

```bash
git add ifood-chat-extension/content.js
git commit -m "feat(ifood-chat): implement content script with DOM manipulation and message queue"
```

---

### Task 9: Frontend — Botão Manual no Card do Pedido

**Files:**
- Modify: `delivery-saas-frontend/src/views/Orders.vue` (~line 3328)
- Modify: `delivery-saas-frontend/src/views/RiderOrders.vue` (~line 73)

**Step 1: Add button to Orders.vue**

In `Orders.vue` at line ~3328, after the NF-e button and before the "Pronto para Retirada" button, add:

```html
<button v-if="isIfoodOrder(o)" class="btn btn-sm btn-outline-danger" @click.stop="sendIfoodChat(o)" title="Enviar mensagem no chat iFood">
  <i class="bi bi-chat-dots"></i>
</button>
```

Add the `sendIfoodChat` method in the `<script setup>` section:

```javascript
async function sendIfoodChat(order) {
  if (!order.storeId) {
    toast.error('Pedido sem loja associada');
    return;
  }
  try {
    await api.post('/ifood-chat/send', { orderId: order.id, storeId: order.storeId });
    toast.success('Mensagem enviada no chat iFood');
  } catch (e) {
    console.error('sendIfoodChat failed', e);
    toast.error('Falha ao enviar mensagem: ' + (e.response?.data?.message || e.message));
  }
}
```

**Step 2: Add button to RiderOrders.vue**

In `RiderOrders.vue` at line ~86, after the "Marcar entregue" button, add:

```html
<button
  v-if="isIfoodOrder(o)"
  class="btn btn-outline-danger w-100"
  @click="sendIfoodChat(o)"
>
  <i class="bi bi-chat-dots me-1"></i>Msg iFood
</button>
```

Add `isIfoodOrder` function (same logic as Orders.vue) and `sendIfoodChat` method.

**Step 3: Commit**

```bash
git add delivery-saas-frontend/src/views/Orders.vue delivery-saas-frontend/src/views/RiderOrders.vue
git commit -m "feat(ifood-chat): add manual send button to order cards"
```

---

### Task 10: Frontend — Tela de Configuração de Mensagens

**Files:**
- Create: `delivery-saas-frontend/src/components/IfoodChatConfig.vue`
- Modify: `delivery-saas-frontend/src/router.js`
- Modify: `delivery-saas-frontend/src/config/nav.js` (if applicable)

**Step 1: Create IfoodChatConfig.vue**

```vue
<template>
  <div class="container py-4" style="max-width:800px;">
    <h4 class="mb-4">Mensagens Automáticas — Chat iFood</h4>

    <div class="alert alert-info small">
      <i class="bi bi-info-circle me-1"></i>
      Configure as mensagens enviadas automaticamente no chat do iFood quando o status do pedido mudar.
      Use <code>{nome}</code> para o nome do cliente e <code>{numero}</code> para o número do pedido.
    </div>

    <!-- Token Section -->
    <div class="card mb-4">
      <div class="card-body">
        <h6 class="card-title">Token da Extensão Chrome</h6>
        <p class="small text-muted">Gere um token para autenticar a extensão do Chrome. Cole-o no popup da extensão.</p>
        <div class="d-flex gap-2">
          <input v-if="token" :value="token" class="form-control form-control-sm" readonly />
          <button class="btn btn-sm btn-primary" @click="generateToken" :disabled="generatingToken">
            {{ generatingToken ? 'Gerando...' : (token ? 'Regenerar Token' : 'Gerar Token') }}
          </button>
        </div>
      </div>
    </div>

    <div v-if="loading" class="text-center py-4">
      <div class="spinner-border text-primary" role="status"></div>
    </div>

    <div v-else>
      <div v-for="msg in messages" :key="msg.status" class="card mb-3">
        <div class="card-body">
          <div class="d-flex justify-content-between align-items-center mb-2">
            <h6 class="mb-0">{{ statusLabels[msg.status] || msg.status }}</h6>
            <div class="form-check form-switch">
              <input class="form-check-input" type="checkbox" v-model="msg.enabled" />
              <label class="form-check-label small">{{ msg.enabled ? 'Ativo' : 'Inativo' }}</label>
            </div>
          </div>
          <textarea class="form-control" v-model="msg.message" rows="3"></textarea>
        </div>
      </div>

      <button class="btn btn-success" @click="save" :disabled="saving">
        {{ saving ? 'Salvando...' : 'Salvar Configurações' }}
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import api from '../api'
import { useToast } from 'vue-toastification'

const toast = useToast()
const props = defineProps({ storeId: String })

const loading = ref(true)
const saving = ref(false)
const messages = ref([])
const token = ref('')
const generatingToken = ref(false)

const statusLabels = {
  CONFIRMED: '✅ Pedido Confirmado',
  DISPATCHED: '🛵 Saiu para Entrega',
  DELIVERED: '📦 Pedido Entregue',
  MANUAL: '💬 Mensagem Manual (botão)',
}

onMounted(async () => {
  try {
    const storeId = props.storeId || localStorage.getItem('selectedStoreId')
    if (!storeId) {
      toast.error('Selecione uma loja')
      return
    }
    const { data } = await api.get(`/ifood-chat/messages/${storeId}`)
    messages.value = data.messages || []
  } catch (e) {
    toast.error('Erro ao carregar configurações')
  } finally {
    loading.value = false
  }
})

async function save() {
  saving.value = true
  try {
    const storeId = props.storeId || localStorage.getItem('selectedStoreId')
    await api.put(`/ifood-chat/messages/${storeId}`, { messages: messages.value })
    toast.success('Configurações salvas')
  } catch (e) {
    toast.error('Erro ao salvar')
  } finally {
    saving.value = false
  }
}

async function generateToken() {
  generatingToken.value = true
  try {
    const { data } = await api.post('/ifood-chat/generate-token')
    token.value = data.token
    toast.success('Token gerado. Copie e cole na extensão.')
  } catch (e) {
    toast.error('Erro ao gerar token')
  } finally {
    generatingToken.value = false
  }
}
</script>
```

**Step 2: Add route in router.js**

In `delivery-saas-frontend/src/router.js`, after the iFood settings route (line ~184):

```javascript
{ path: '/settings/ifood-chat', component: () => import('./components/IfoodChatConfig.vue'), meta: { requiresAuth: true, role: 'ADMIN' } },
```

**Step 3: Commit**

```bash
git add delivery-saas-frontend/src/components/IfoodChatConfig.vue delivery-saas-frontend/src/router.js
git commit -m "feat(ifood-chat): add message configuration view and route"
```

---

### Task 11: Testing — Verify End-to-End Flow

**Step 1: Start dev environment**

Run: `docker compose up -d`

**Step 2: Push schema and verify**

Run inside backend container: `npx prisma db push && npx prisma generate`

**Step 3: Test REST endpoints manually**

```bash
# Get messages (should seed defaults)
curl -H "Authorization: Bearer <token>" http://localhost:3000/ifood-chat/messages/<storeId>

# Update messages
curl -X PUT -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"messages":[{"status":"CONFIRMED","message":"Test {nome}","enabled":true}]}' \
  http://localhost:3000/ifood-chat/messages/<storeId>

# Generate extension token
curl -X POST -H "Authorization: Bearer <token>" http://localhost:3000/ifood-chat/generate-token
```

**Step 4: Load Chrome extension**

1. Open `chrome://extensions/`
2. Enable Developer Mode
3. Click "Load unpacked" → select `ifood-chat-extension/` folder
4. Open popup, configure backend URL + token + companyId
5. Verify badge turns green (connected)

**Step 5: Test with real iFood Gestor de Pedidos**

1. Open `gestordepedidos.ifood.com.br` in Chrome
2. Use DevTools to inspect chat DOM elements
3. Update `selectors.js` with real selectors
4. Trigger a status change on an iFood order
5. Verify message appears in the iFood chat

**Step 6: Verify manual send**

1. Open Orders view in Delivery SaaS
2. Find an iFood order
3. Click the chat button
4. Verify message is sent in the iFood chat

**Step 7: Commit final adjustments**

```bash
git add -A
git commit -m "feat(ifood-chat): finalize and test end-to-end flow"
```
