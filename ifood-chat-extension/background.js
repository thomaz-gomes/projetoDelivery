importScripts('lib/socket.io.min.js');

let socket = null;
let connected = false;
let messageQueue = [];

// Active tab — only this tab receives automated messages
let activeTabId = null;
let activeTabUrl = '';

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

async function forwardToContentScript(payload) {
  // Only send to the activated tab
  if (!activeTabId) {
    console.warn('[iFood Extension] Nenhuma aba ativada. Enfileirando mensagem.');
    messageQueue.push(payload);
    return;
  }

  try {
    // Verify the tab still exists
    const tab = await chrome.tabs.get(activeTabId).catch(() => null);
    if (!tab) {
      console.warn('[iFood Extension] Aba ativada não existe mais. Desativando.');
      activeTabId = null;
      activeTabUrl = '';
      messageQueue.push(payload);
      updateBadge();
      return;
    }

    await chrome.tabs.sendMessage(activeTabId, { type: 'SEND_CHAT_MESSAGE', payload });
  } catch (e) {
    console.error('[iFood Extension] Falha ao enviar para aba ativada:', e.message);
    messageQueue.push(payload);
  }
}

function updateBadge() {
  try {
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
    console.log('[iFood Extension] Aba ativada:', activeTabId, activeTabUrl);
    updateBadge();
    // Flush queued messages
    if (messageQueue.length > 0) {
      const queued = [...messageQueue];
      messageQueue = [];
      for (const payload of queued) {
        forwardToContentScript(payload);
      }
    }
    sendResponse({ ok: true });
    return false;
  }
  if (msg.type === 'CLEAR_ACTIVE_TAB') {
    activeTabId = null;
    activeTabUrl = '';
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
    sendResponse({ ok: true });
    return false;
  }
  if (msg.type === 'MESSAGE_FAILED') {
    console.error('[iFood Extension] Mensagem falhou:', msg.orderNumber, msg.error);
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
    updateBadge();
  }
});

// Clear active tab if it navigates away from iFood
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (tabId === activeTabId && changeInfo.url && !changeInfo.url.includes('gestordepedidos.ifood.com.br')) {
    console.log('[iFood Extension] Aba ativada saiu do iFood');
    activeTabId = null;
    activeTabUrl = '';
    updateBadge();
  }
});

// Re-connect when service worker wakes up
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

// Initial connection
chrome.storage.local.get(['backendUrl', 'extensionToken', 'companyId'], (config) => {
  if (config && config.backendUrl && config.extensionToken && config.companyId) {
    connect(config);
  } else {
    updateBadge();
  }
});
