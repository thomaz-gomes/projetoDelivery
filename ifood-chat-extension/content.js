// content.js — runs on gestordepedidos.ifood.com.br
// Depends on selectors.js being loaded first (declared in manifest)

const SELECTORS = window.IFOOD_SELECTORS;
const MESSAGE_DELAY_MS = 2500;
let processing = false;
const queue = [];

chrome.runtime.sendMessage({ type: 'CONTENT_SCRIPT_READY' });

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

  // React controlled inputs need native setter
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
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
  }
  await sleep(500);

  // Step 5: Close chat
  try {
    const closeBtn = document.querySelector(SELECTORS.closeChatButton);
    if (closeBtn) closeBtn.click();
  } catch (e) { /* ignore */ }

  console.log(`[iFood Extension] Message sent to order ${orderNumber}`);
}

async function findConversationByOrderNumber(orderNumber) {
  const cleanNumber = orderNumber.replace(/^#/, '');

  const items = document.querySelectorAll(SELECTORS.conversationItem);
  for (const item of items) {
    const text = item.textContent || '';
    if (text.includes(`#${cleanNumber}`) || text.includes(cleanNumber)) {
      return item;
    }
  }

  // Scroll through list to find
  const list = document.querySelector(SELECTORS.conversationList);
  if (list) {
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
