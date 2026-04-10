importScripts('lib/socket.io.min.js');

let socket = null;
let connected = false;
let messageQueue = [];

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

  socket.on('ifood:chat', (payload) => {
    console.log('[iFood Extension] Received ifood:chat:', payload);
    forwardToContentScript(payload);
  });
}

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

function updateBadge(state) {
  if (state === 'on') {
    chrome.action.setBadgeText({ text: '' });
    chrome.action.setBadgeBackgroundColor({ color: '#28a745' });
  } else {
    chrome.action.setBadgeText({ text: '!' });
    chrome.action.setBadgeBackgroundColor({ color: '#dc3545' });
  }
}

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
    sendResponse({ ok: true });
    return true;
  }
});

chrome.storage.local.get(['backendUrl', 'extensionToken', 'companyId'], (config) => {
  if (config.backendUrl && config.extensionToken) {
    connect(config);
  } else {
    updateBadge('off');
  }
});
