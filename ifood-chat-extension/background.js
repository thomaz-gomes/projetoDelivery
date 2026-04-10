importScripts('lib/socket.io.min.js');

let socket = null;
let connected = false;
let messageQueue = [];

function connect(config) {
  if (socket) {
    try { socket.disconnect(); } catch (e) { /* ignore */ }
    socket = null;
  }

  if (!config || !config.backendUrl || !config.extensionToken || !config.companyId) {
    console.warn('[iFood Extension] Config incompleta, ignorando conexão.');
    updateBadge('off');
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
    updateBadge('on');
  });

  socket.on('disconnect', () => {
    console.log('[iFood Extension] Desconectado');
    connected = false;
    updateBadge('off');
  });

  socket.on('connect_error', (err) => {
    console.error('[iFood Extension] Erro de conexão:', err.message);
    connected = false;
    updateBadge('off');
  });

  socket.on('ifood:chat', (payload) => {
    console.log('[iFood Extension] Recebido ifood:chat:', payload);
    forwardToContentScript(payload);
  });
}

async function forwardToContentScript(payload) {
  try {
    const tabs = await chrome.tabs.query({ url: 'https://gestordepedidos.ifood.com.br/*' });
    if (tabs.length === 0) {
      console.warn('[iFood Extension] Nenhuma aba do iFood encontrada. Enfileirando mensagem.');
      messageQueue.push(payload);
      return;
    }

    for (const tab of tabs) {
      try {
        await chrome.tabs.sendMessage(tab.id, { type: 'SEND_CHAT_MESSAGE', payload });
      } catch (e) {
        console.warn('[iFood Extension] Falha ao enviar para tab', tab.id, e.message);
      }
    }
  } catch (e) {
    console.error('[iFood Extension] Falha ao encaminhar para content script:', e);
    messageQueue.push(payload);
  }
}

function updateBadge(state) {
  try {
    if (state === 'on') {
      chrome.action.setBadgeText({ text: '' });
      chrome.action.setBadgeBackgroundColor({ color: '#28a745' });
    } else {
      chrome.action.setBadgeText({ text: '!' });
      chrome.action.setBadgeBackgroundColor({ color: '#dc3545' });
    }
  } catch (e) { /* ignore badge errors */ }
}

// All Chrome event handlers MUST be registered synchronously at top level (MV3 requirement)

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'GET_STATUS') {
    sendResponse({ connected, queueLength: messageQueue.length });
    return false;
  }
  if (msg.type === 'RECONNECT') {
    connect(msg.config);
    sendResponse({ ok: true });
    return false;
  }
  if (msg.type === 'CONTENT_SCRIPT_READY') {
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

// Re-connect when service worker wakes up (MV3 can kill/restart the worker)
chrome.runtime.onStartup.addListener(() => {
  chrome.storage.local.get(['backendUrl', 'extensionToken', 'companyId'], (config) => {
    connect(config);
  });
});

// Also connect on install/update
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['backendUrl', 'extensionToken', 'companyId'], (config) => {
    connect(config);
  });
});

// Initial connection attempt
chrome.storage.local.get(['backendUrl', 'extensionToken', 'companyId'], (config) => {
  if (config && config.backendUrl && config.extensionToken && config.companyId) {
    connect(config);
  } else {
    updateBadge('off');
  }
});
