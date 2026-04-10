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
      // Tentar fechar o chat para limpar estado antes da próxima
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

  // Step 1: Garantir que o painel de chat está fechado primeiro
  await closeChatPanel();
  await sleep(500);

  // Step 2: Abrir painel de conversas (lista)
  const chatBtn = await waitForElement(SELECTORS.chatToggleButton, 3000);
  if (!chatBtn) throw new Error('Botão de chat não encontrado');
  chatBtn.click();
  await sleep(1500);

  // Step 3: Verificar que estamos na lista de conversas (h1 "Conversas" visível)
  const conversasTitle = await waitForElement('h1', 3000);
  if (!conversasTitle || !conversasTitle.textContent.includes('Conversas')) {
    // Pode estar dentro de uma conversa — fechar e reabrir
    console.log('[iFood Extension] Não está na lista, tentando fechar e reabrir...');
    await closeChatPanel();
    await sleep(500);
    chatBtn.click();
    await sleep(1500);
  }

  // Step 4: Encontrar conversa pelo número do pedido
  const conversation = await findConversationByOrderNumber(orderNumber);
  if (!conversation) throw new Error(`Conversa do pedido ${orderNumber} não encontrada`);
  conversation.click();
  await sleep(1500);

  // Step 5: Digitar mensagem
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

  // Step 6: Checar modo debug
  const { debugMode } = await chrome.storage.local.get(['debugMode']);
  if (debugMode) {
    console.log(`[iFood Extension] MODO DEBUG — mensagem preenchida mas NÃO enviada para pedido ${orderNumber}`);
    return;
  }

  // Step 7: Enviar
  const sendBtn = await waitForElement(SELECTORS.sendButton, 2000);
  if (sendBtn) {
    sendBtn.click();
  } else {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
  }
  await sleep(1000);

  // Step 8: Fechar o painel de chat completamente (pronto para próxima mensagem)
  await closeChatPanel();

  console.log(`[iFood Extension] Mensagem enviada para pedido ${orderNumber}`);
}

/**
 * Fecha o painel de chat completamente.
 * 1. Se estiver dentro de uma conversa, fecha a conversa primeiro (volta à lista)
 * 2. Depois fecha o painel inteiro (volta ao gestor)
 */
async function closeChatPanel() {
  // Passo 1: Se estiver dentro de uma conversa (textarea visível), fechar a conversa
  const textarea = document.querySelector(SELECTORS.messageInput);
  if (textarea) {
    const closeConvBtn = document.querySelector(SELECTORS.closeConversationButton);
    if (closeConvBtn) {
      closeConvBtn.click();
      await sleep(500);
    }
  }

  // Passo 2: Se a lista de conversas está aberta, fechar o painel inteiro
  const listOpen = Array.from(document.querySelectorAll('h1')).find(h => h.textContent.includes('Conversas'));
  if (listOpen) {
    // Usar o X genérico da lista
    const closeListBtn = document.querySelector(SELECTORS.closeChatButton);
    if (closeListBtn) {
      closeListBtn.click();
      await sleep(500);
      return;
    }
    // Fallback: toggle button
    const toggleBtn = document.querySelector(SELECTORS.chatToggleButton);
    if (toggleBtn) {
      toggleBtn.click();
      await sleep(500);
    }
  }
}

/**
 * Encontra a conversa na lista pelo número do pedido.
 * A lista do iFood usa virtual scroll — os h2 contêm "#XXXX".
 */
async function findConversationByOrderNumber(orderNumber) {
  const cleanNumber = orderNumber.replace(/^#/, '');
  const target = `#${cleanNumber}`;

  let found = findH2WithOrderNumber(target);
  if (found) return found;

  // Scrollar a lista virtual para carregar mais itens
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
 * Busca um h2 que contenha o número do pedido e retorna a row clicável.
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
