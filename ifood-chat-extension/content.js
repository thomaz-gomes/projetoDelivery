// content.js — runs on gestordepedidos.ifood.com.br
// Depends on selectors.js being loaded first (declared in manifest)

const SELECTORS = window.IFOOD_SELECTORS;
const MESSAGE_DELAY_MS = 2500;
let processing = false;
const queue = [];

chrome.runtime.sendMessage({ type: 'CONTENT_SCRIPT_READY' });

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'PING') {
    sendResponse({ ok: true });
    return false;
  }
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
      console.error('[iFood Extension] Falha ao enviar mensagem:', e);
      chrome.runtime.sendMessage({ type: 'MESSAGE_FAILED', orderNumber: payload.orderNumber, error: e.message });
      await closeChatPanel();
    }

    if (queue.length > 0) {
      await sleep(MESSAGE_DELAY_MS);
    }
  }

  processing = false;
}

async function sendChatMessage(orderNumber, message) {
  console.log(`[iFood Extension] Enviando mensagem para pedido ${orderNumber}...`);

  // Garantir estado limpo
  await closeChatPanel();
  await sleep(500);

  // FLUXO 1: Tentar pela lista de conversas existentes
  const sentViaList = await trySendViaConversationList(orderNumber, message);
  if (sentViaList) return;

  // FLUXO 2: Conversa não existe — criar via card do pedido
  console.log(`[iFood Extension] Conversa não encontrada na lista. Abrindo via card do pedido...`);
  await closeChatPanel();
  await sleep(500);
  await sendViaOrderCard(orderNumber, message);
}

/**
 * FLUXO 1: Abre a lista de conversas e tenta encontrar o pedido.
 * Retorna true se conseguiu enviar, false se conversa não existe.
 */
async function trySendViaConversationList(orderNumber, message) {
  const chatBtn = document.querySelector(SELECTORS.chatToggleButton);
  if (!chatBtn) return false;
  chatBtn.click();
  await sleep(1500);

  // Verificar que estamos na lista
  const conversasTitle = Array.from(document.querySelectorAll('h1')).find(h => h.textContent.includes('Conversas'));
  if (!conversasTitle) {
    await closeChatPanel();
    return false;
  }

  const conversation = await findConversationByOrderNumber(orderNumber);
  if (!conversation) {
    // Conversa não existe na lista
    await closeChatPanel();
    return false;
  }

  conversation.click();
  await sleep(1500);

  await typeAndSend(message, orderNumber);
  return true;
}

/**
 * FLUXO 2: Encontra o card do pedido na tela de expedição, abre detalhes,
 * clica no botão de chat (que cria a conversa) e envia a mensagem.
 */
async function sendViaOrderCard(orderNumber, message) {
  const cleanNumber = orderNumber.replace(/^#/, '');

  // Encontrar o card do pedido pelo número
  const card = findOrderCard(cleanNumber);
  if (!card) throw new Error(`Card do pedido ${orderNumber} não encontrado na tela de expedição`);

  // Clicar no card para abrir detalhes
  card.click();
  await sleep(2000);

  // Clicar no botão de chat nos detalhes do pedido (cria a conversa)
  const chatBtn = await waitForElement(SELECTORS.orderDetailsChatButton, 5000);
  if (!chatBtn) throw new Error(`Botão de chat não encontrado nos detalhes do pedido ${orderNumber}`);
  chatBtn.click();
  await sleep(2000);

  await typeAndSend(message, orderNumber);
}

/**
 * Digita a mensagem e envia (ou para se modo debug).
 * Assume que o campo de mensagem já está visível.
 */
async function typeAndSend(message, orderNumber) {
  const input = await waitForElement(SELECTORS.messageInput, 5000);
  if (!input) throw new Error('Campo de mensagem não encontrado');

  // React controlled inputs: usar native setter
  const nativeSetter =
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set ||
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;

  if (nativeSetter) {
    nativeSetter.call(input, message);
  } else {
    input.value = message;
  }
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await sleep(500);

  // Checar modo debug
  const { debugMode } = await chrome.storage.local.get(['debugMode']);
  if (debugMode) {
    console.log(`[iFood Extension] MODO DEBUG — mensagem preenchida mas NÃO enviada para pedido ${orderNumber}`);
    return;
  }

  // Enviar
  const sendBtn = await waitForElement(SELECTORS.sendButton, 2000);
  if (sendBtn) {
    sendBtn.click();
  } else {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
  }
  await sleep(1000);

  // Fechar tudo
  await closeChatPanel();
  console.log(`[iFood Extension] Mensagem enviada para pedido ${orderNumber}`);
}

/**
 * Encontra o card do pedido na tela de expedição pelo número.
 * Os cards têm [data-testid="card"] e o número aparece num span dentro.
 */
function findOrderCard(orderNumber) {
  const cards = document.querySelectorAll(SELECTORS.orderCard);
  for (const card of cards) {
    const text = card.textContent || '';
    // O número aparece como "3222" (sem #) no card
    if (text.includes(orderNumber)) {
      return card;
    }
  }
  return null;
}

/**
 * Fecha o painel de chat completamente.
 */
async function closeChatPanel() {
  // Se dentro de uma conversa (textarea visível), fechar a conversa
  const textarea = document.querySelector(SELECTORS.messageInput);
  if (textarea) {
    const closeConvBtn = document.querySelector(SELECTORS.closeConversationButton);
    if (closeConvBtn) {
      closeConvBtn.click();
      await sleep(500);
    }
  }

  // Se a lista de conversas está aberta, fechar o painel
  const listOpen = Array.from(document.querySelectorAll('h1')).find(h => h.textContent.includes('Conversas'));
  if (listOpen) {
    const closeListBtn = document.querySelector(SELECTORS.closeChatButton);
    if (closeListBtn) {
      closeListBtn.click();
      await sleep(500);
      return;
    }
    const toggleBtn = document.querySelector(SELECTORS.chatToggleButton);
    if (toggleBtn) {
      toggleBtn.click();
      await sleep(500);
    }
  }
}

/**
 * Encontra conversa na lista pelo número do pedido (virtual scroll).
 */
async function findConversationByOrderNumber(orderNumber) {
  const cleanNumber = orderNumber.replace(/^#/, '');
  const target = `#${cleanNumber}`;

  let found = findH2WithOrderNumber(target);
  if (found) return found;

  const scrollContainer = document.querySelector(SELECTORS.conversationListScroll);
  if (scrollContainer) {
    scrollContainer.scrollTop = 0;
    await sleep(300);

    found = findH2WithOrderNumber(target);
    if (found) return found;

    const maxScrollAttempts = 15;
    for (let i = 0; i < maxScrollAttempts; i++) {
      const prevTop = scrollContainer.scrollTop;
      scrollContainer.scrollTop += 250;
      await sleep(400);

      if (scrollContainer.scrollTop === prevTop) break;

      found = findH2WithOrderNumber(target);
      if (found) return found;
    }
  }

  return null;
}

/**
 * Busca h2 com o número do pedido e retorna a row clicável.
 */
function findH2WithOrderNumber(target) {
  const headings = document.querySelectorAll(SELECTORS.conversationOrderNumber);
  for (const h2 of headings) {
    const text = (h2.textContent || '').trim();
    if (text === target) {
      let clickTarget = h2;
      for (let i = 0; i < 6; i++) {
        if (!clickTarget.parentElement) break;
        clickTarget = clickTarget.parentElement;
        const parentStyle = clickTarget.parentElement?.style;
        if (parentStyle && parentStyle.position === 'absolute') {
          return clickTarget;
        }
      }
      return h2;
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
