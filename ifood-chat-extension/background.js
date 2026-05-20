importScripts('lib/socket.io.min.js');

let socket = null;
let connected = false;
let messageQueue = [];

// Active tab — only this tab receives automated messages
let activeTabId = null;
let activeTabUrl = '';

// ── TTL por tipo de mensagem ─────────────────────────────────────────────
// Pedido tem ciclo de vida curto — mensagens antigas no backlog não fazem
// mais sentido (ex.: aviso de preparo de pedido que já foi entregue).
// Quando a aba reativa após N min, descartamos itens vencidos antes de
// despachar. `null` = sem TTL.
const KIND_TTL_MS = {
  CONFIRMED: 10 * 60 * 1000,   // 10 min — pedido confirmado, ainda relevante por pouco
  DISPATCHED: 30 * 60 * 1000,  // 30 min — saiu pra entrega
  DELIVERED: 2 * 60 * 60 * 1000, // 2h — agradecimento/avaliação
  MANUAL: 2 * 60 * 60 * 1000,  // manual: trata como DELIVERED
};
const DEFAULT_TTL_MS = 30 * 60 * 1000; // fallback genérico

function isPayloadStale(payload) {
  if (!payload || typeof payload.createdAt !== 'number') return false;
  const ttl = (payload.kind && KIND_TTL_MS[payload.kind]) || DEFAULT_TTL_MS;
  const age = Date.now() - payload.createdAt;
  return age > ttl;
}

// ── Dedupe ────────────────────────────────────────────────────────────────
// Evita enviar a mesma (orderId, kind) duas vezes. Persistido em
// chrome.storage.local com janela rolante de 24h.
const SENT_KEYS_STORAGE = 'sentChatKeys_v1';
const SENT_KEYS_RETENTION_MS = 24 * 60 * 60 * 1000;

function payloadDedupKey(payload) {
  if (!payload) return null;
  // Prefere orderId+kind; falls back para orderNumber+kind quando orderId
  // não vem (mensagens manuais antigas).
  const id = payload.orderId || payload.orderNumber;
  const kind = payload.kind || 'manual';
  if (!id) return null;
  return `${id}:${kind}`;
}

async function loadSentKeys() {
  try {
    const { [SENT_KEYS_STORAGE]: raw } = await chrome.storage.local.get(SENT_KEYS_STORAGE);
    if (!raw || typeof raw !== 'object') return {};
    // Limpa entradas expiradas
    const now = Date.now();
    const cleaned = {};
    for (const [k, ts] of Object.entries(raw)) {
      if (typeof ts === 'number' && (now - ts) < SENT_KEYS_RETENTION_MS) cleaned[k] = ts;
    }
    return cleaned;
  } catch (e) {
    return {};
  }
}

async function markSent(key) {
  if (!key) return;
  const map = await loadSentKeys();
  map[key] = Date.now();
  try { await chrome.storage.local.set({ [SENT_KEYS_STORAGE]: map }); } catch (e) { /* ignore */ }
}

async function isAlreadySent(key) {
  if (!key) return false;
  const map = await loadSentKeys();
  return !!map[key];
}

// In-flight: chaves em processamento mas ainda não confirmadas no chrome.storage.
// Fecha a race window entre `isAlreadySent()` (lê do disco) e `markSent()` (grava
// depois do send). Sem isso, 5 eventos do mesmo pedido chegando em rajada
// (DISPATCHED é o mais afetado) leem "ainda não enviado" antes do primeiro
// marcar e disparam 5 vezes.
const inFlightKeys = new Set();

function connect(config) {
  if (socket) {
    try { socket.disconnect(); } catch (e) { /* ignore */ }
    socket = null;
  }

  if (!config || !config.backendUrl || !config.extensionToken || !config.companyId) {
    console.warn('[iFood Extension] Config incompleta, ignorando conexão.');
    updateBadge();
    return;
  }

  console.log('[iFood Extension] Conectando a', config.backendUrl);

  socket = io(config.backendUrl, {
    transports: ['websocket', 'polling'],
    auth: {
      extensionToken: config.extensionToken,
      companyId: config.companyId,
    },
    reconnectionAttempts: Infinity,
    reconnectionDelay: 3000,
  });

  socket.on('connect', () => {
    console.log('[iFood Extension] Conectado ao backend');
    connected = true;
    updateBadge();
  });

  socket.on('disconnect', () => {
    console.log('[iFood Extension] Desconectado');
    connected = false;
    updateBadge();
  });

  socket.on('connect_error', (err) => {
    console.error('[iFood Extension] Erro de conexão:', err.message);
    connected = false;
    updateBadge();
  });

  socket.on('ifood:chat', (payload) => {
    console.log('[iFood Extension] Recebido ifood:chat:', payload);
    forwardToContentScript(payload);
  });
}

async function injectContentScripts(tabId) {
  console.log('[iFood Extension] Injetando content scripts na aba', tabId);
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['selectors.js'],
  });
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['content.js'],
  });
  // Wait for scripts to initialize
  await new Promise(r => setTimeout(r, 1000));
  console.log('[iFood Extension] Content scripts injetados');
}

async function sendMessageToTab(tabId, message, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, message);
      return response;
    } catch (e) {
      console.warn(`[iFood Extension] Tentativa ${attempt}/${retries} falhou:`, e.message);
      if (attempt < retries) {
        // Re-inject and retry
        try {
          await injectContentScripts(tabId);
        } catch (injectErr) {
          console.error('[iFood Extension] Falha ao injetar:', injectErr.message);
        }
      } else {
        throw e;
      }
    }
  }
}

async function forwardToContentScript(payload) {
  // Descarte 1: stale (TTL excedido). Evita enviar "saiu pra entrega" muito
  // depois quando o pedido já foi concluído.
  if (isPayloadStale(payload)) {
    const age = payload?.createdAt ? Math.round((Date.now() - payload.createdAt) / 1000) : '?';
    console.warn(`[iFood Extension] DESCARTADO (TTL): pedido ${payload?.orderNumber} kind=${payload?.kind} age=${age}s`);
    return;
  }

  // Descarte 2: já enviado (dedup) OU em processamento agora. Cobre
  // re-emissão do backend, backlog duplicado entre reativações, e a race
  // window onde 5 eventos chegam antes do markSent gravar no disco.
  const dedupKey = payloadDedupKey(payload);
  if (dedupKey) {
    if (inFlightKeys.has(dedupKey)) {
      console.log(`[iFood Extension] DESCARTADO (in-flight): ${dedupKey} já em processamento.`);
      return;
    }
    if (await isAlreadySent(dedupKey)) {
      console.log(`[iFood Extension] DESCARTADO (dedup): ${dedupKey} já enviado anteriormente.`);
      return;
    }
    inFlightKeys.add(dedupKey);
  }

  try {
    if (!activeTabId) {
      console.warn('[iFood Extension] Nenhuma aba ativada. Enfileirando mensagem.');
      messageQueue.push(payload);
      return;
    }

    const tab = await chrome.tabs.get(activeTabId).catch(() => null);
    if (!tab) {
      console.warn('[iFood Extension] Aba ativada não existe mais. Desativando.');
      activeTabId = null;
      activeTabUrl = '';
      messageQueue.push(payload);
      updateBadge();
      return;
    }

    try {
      await sendMessageToTab(activeTabId, { type: 'SEND_CHAT_MESSAGE', payload });
      // Sucesso: marca como enviado.
      if (dedupKey) await markSent(dedupKey);
    } catch (e) {
      console.error('[iFood Extension] Falha ao enviar após retries:', e.message);
      messageQueue.push(payload);
      // NÃO marca como enviado, MAS sai do in-flight pra permitir retry.
    }
  } finally {
    if (dedupKey) inFlightKeys.delete(dedupKey);
  }
}

// Contador de mensagens que falharam — exposto no badge pra operador
// notar imediatamente em vez do "dry-run mágico" antigo.
let failedCount = 0;

function updateBadge() {
  try {
    if (failedCount > 0) {
      // Falhas pendentes têm prioridade visual — operador precisa abrir popup.
      chrome.action.setBadgeText({ text: String(failedCount) });
      chrome.action.setBadgeBackgroundColor({ color: '#dc3545' });
      return;
    }
    if (connected && activeTabId) {
      // Connected + tab active = all good
      chrome.action.setBadgeText({ text: '' });
      chrome.action.setBadgeBackgroundColor({ color: '#28a745' });
    } else if (connected && !activeTabId) {
      // Connected but no tab = needs attention
      chrome.action.setBadgeText({ text: '⚡' });
      chrome.action.setBadgeBackgroundColor({ color: '#ffc107' });
    } else {
      // Disconnected
      chrome.action.setBadgeText({ text: '!' });
      chrome.action.setBadgeBackgroundColor({ color: '#dc3545' });
    }
  } catch (e) { /* ignore badge errors */ }
}

// All Chrome event handlers MUST be registered synchronously at top level (MV3 requirement)

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'GET_STATUS') {
    sendResponse({
      connected,
      queueLength: messageQueue.length,
      activeTabId,
      activeTabUrl,
    });
    return false;
  }
  if (msg.type === 'RECONNECT') {
    connect(msg.config);
    sendResponse({ ok: true });
    return false;
  }
  if (msg.type === 'SET_ACTIVE_TAB') {
    activeTabId = msg.tabId;
    activeTabUrl = msg.tabUrl || '';
    // Persist so the active tab survives MV3 service worker restarts
    chrome.storage.local.set({ activeTabId, activeTabUrl });
    console.log('[iFood Extension] Aba ativada:', activeTabId, activeTabUrl);
    updateBadge();
    // Always inject content scripts on activation
    injectContentScripts(activeTabId).then(() => {
      console.log('[iFood Extension] Scripts prontos na aba ativada');
      // Flush queued messages
      if (messageQueue.length > 0) {
        const queued = [...messageQueue];
        messageQueue = [];
        for (const payload of queued) {
          forwardToContentScript(payload);
        }
      }
    }).catch(e => {
      console.error('[iFood Extension] Falha ao injetar na ativação:', e.message);
    });
    sendResponse({ ok: true });
    return false;
  }
  if (msg.type === 'CLEAR_ACTIVE_TAB') {
    activeTabId = null;
    activeTabUrl = '';
    chrome.storage.local.remove(['activeTabId', 'activeTabUrl']);
    console.log('[iFood Extension] Aba desativada');
    updateBadge();
    sendResponse({ ok: true });
    return false;
  }
  if (msg.type === 'CONTENT_SCRIPT_READY') {
    // Only flush if this is the active tab
    if (sender.tab && sender.tab.id === activeTabId && messageQueue.length > 0) {
      const queued = [...messageQueue];
      messageQueue = [];
      for (const payload of queued) {
        forwardToContentScript(payload);
      }
    }
    sendResponse({ ok: true });
    return false;
  }
  if (msg.type === 'MESSAGE_SENT') {
    console.log('[iFood Extension] Mensagem enviada:', msg.orderNumber);
    // Decrementa badge de falhas se houvera retry com sucesso
    if (failedCount > 0) { failedCount = Math.max(0, failedCount - 1); updateBadge(); }
    sendResponse({ ok: true });
    return false;
  }
  if (msg.type === 'MESSAGE_FAILED') {
    console.error('[iFood Extension] Mensagem falhou:', msg.orderNumber, msg.error);
    failedCount += 1;
    updateBadge();
    // Persiste a falha para o popup exibir histórico/contexto.
    chrome.storage.local.get(['failedMessages']).then(({ failedMessages = [] }) => {
      const list = Array.isArray(failedMessages) ? failedMessages : [];
      list.unshift({
        orderNumber: msg.orderNumber,
        kind: msg.kind || null,
        error: msg.error || 'desconhecido',
        at: Date.now(),
      });
      // mantém apenas 50 falhas mais recentes
      chrome.storage.local.set({ failedMessages: list.slice(0, 50) });
    });
    sendResponse({ ok: true });
    return false;
  }
  if (msg.type === 'CLEAR_FAILURES') {
    failedCount = 0;
    chrome.storage.local.set({ failedMessages: [] });
    updateBadge();
    sendResponse({ ok: true });
    return false;
  }
  return false;
});

// Clear active tab if it gets closed
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === activeTabId) {
    console.log('[iFood Extension] Aba ativada foi fechada');
    activeTabId = null;
    activeTabUrl = '';
    chrome.storage.local.remove(['activeTabId', 'activeTabUrl']);
    updateBadge();
  }
});

// Clear active tab if it navigates away from iFood
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (tabId === activeTabId && changeInfo.url && !changeInfo.url.includes('gestordepedidos.ifood.com.br')) {
    console.log('[iFood Extension] Aba ativada saiu do iFood');
    activeTabId = null;
    activeTabUrl = '';
    chrome.storage.local.remove(['activeTabId', 'activeTabUrl']);
    updateBadge();
  }
});

chrome.runtime.onStartup.addListener(() => {
  chrome.storage.local.get(['backendUrl', 'extensionToken', 'companyId'], (config) => {
    connect(config);
  });
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['backendUrl', 'extensionToken', 'companyId'], (config) => {
    connect(config);
  });
});

// Initial connection — also restore activeTabId persisted from the previous service worker lifecycle
chrome.storage.local.get(['backendUrl', 'extensionToken', 'companyId', 'activeTabId', 'activeTabUrl'], (data) => {
  // Restore active tab (verify it still exists and is still on iFood)
  if (data.activeTabId) {
    chrome.tabs.get(data.activeTabId, (tab) => {
      if (chrome.runtime.lastError || !tab) {
        // Tab no longer exists — clear stale entry
        chrome.storage.local.remove(['activeTabId', 'activeTabUrl']);
      } else if (tab.url && tab.url.includes('gestordepedidos.ifood.com.br')) {
        activeTabId = data.activeTabId;
        activeTabUrl = data.activeTabUrl || tab.url || '';
        console.log('[iFood Extension] Aba ativa restaurada após reinício:', activeTabId);
      } else {
        // Tab navigated away from iFood
        chrome.storage.local.remove(['activeTabId', 'activeTabUrl']);
      }
      updateBadge();
    });
  }
  if (data.backendUrl && data.extensionToken && data.companyId) {
    connect(data);
  } else {
    updateBadge();
  }
});
