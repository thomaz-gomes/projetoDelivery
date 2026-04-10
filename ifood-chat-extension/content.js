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
    }

    if (queue.length > 0) {
      await sleep(MESSAGE_DELAY_MS);
    }
  }

  processing = false;
}

async function sendChatMessage(orderNumber, message) {
  console.log(`[iFood Extension] Enviando mensagem para pedido ${orderNumber}...`);

  // Step 1: Abrir painel de conversas
  const chatBtn = await waitForElement(SELECTORS.chatToggleButton, 3000);
  if (!chatBtn) throw new Error('Botão de chat não encontrado');
  chatBtn.click();
  await sleep(1500);

  // Step 2: Encontrar conversa pelo número do pedido
  const conversation = await findConversationByOrderNumber(orderNumber);
  if (!conversation) throw new Error(`Conversa do pedido ${orderNumber} não encontrada`);
  conversation.click();
  await sleep(1500);

  // Step 3: Digitar mensagem
  const input = await waitForElement(SELECTORS.messageInput, 5000);
  if (!input) throw new Error('Campo de mensagem não encontrado');

  // React controlled inputs: usar native setter para disparar eventos corretamente
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

  // Step 4: Checar modo debug
  const { debugMode } = await chrome.storage.local.get(['debugMode']);
  if (debugMode) {
    console.log(`[iFood Extension] MODO DEBUG — mensagem preenchida mas NÃO enviada para pedido ${orderNumber}`);
    return;
  }

  // Step 5: Enviar
  const sendBtn = await waitForElement(SELECTORS.sendButton, 2000);
  if (sendBtn) {
    sendBtn.click();
  } else {
    // Fallback: Enter
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
  }
  await sleep(500);

  // Step 6: Voltar para lista de conversas (clicar no X)
  try {
    const closeBtn = document.querySelector(SELECTORS.closeChatButton);
    if (closeBtn) closeBtn.click();
  } catch (e) { /* ignore */ }

  console.log(`[iFood Extension] Mensagem enviada para pedido ${orderNumber}`);
}

/**
 * Encontra a conversa na lista pelo número do pedido.
 * A lista do iFood usa virtual scroll — os h2 contêm "#XXXX".
 * Busca nos h2 visíveis, e se não encontrar, scrolla a lista.
 */
async function findConversationByOrderNumber(orderNumber) {
  const cleanNumber = orderNumber.replace(/^#/, '');
  const target = `#${cleanNumber}`;

  // Tentar encontrar nos h2 visíveis
  let found = findH2WithOrderNumber(target);
  if (found) return found;

  // Não encontrou — scrollar a lista virtual para carregar mais itens
  const scrollContainer = document.querySelector(SELECTORS.conversationListScroll);
  if (scrollContainer) {
    // Primeiro, scroll até o topo
    scrollContainer.scrollTop = 0;
    await sleep(300);

    found = findH2WithOrderNumber(target);
    if (found) return found;

    // Scroll para baixo em incrementos
    const maxScrollAttempts = 15;
    for (let i = 0; i < maxScrollAttempts; i++) {
      const prevTop = scrollContainer.scrollTop;
      scrollContainer.scrollTop += 250;
      await sleep(400);

      // Se não scrollou mais, chegou ao fim
      if (scrollContainer.scrollTop === prevTop) break;

      found = findH2WithOrderNumber(target);
      if (found) return found;
    }
  }

  return null;
}

/**
 * Busca um h2 que contenha o número do pedido e retorna a row clicável (parent).
 * Estrutura do iFood: div[position:absolute] > div.row > [avatar] [content com h2] [hora]
 */
function findH2WithOrderNumber(target) {
  const headings = document.querySelectorAll(SELECTORS.conversationOrderNumber);
  for (const h2 of headings) {
    const text = (h2.textContent || '').trim();
    if (text === target) {
      // Subir até a row clicável — o parent do parent do h2 é a row principal
      // h2 > div.content > div.row (queremos clicar na row)
      let clickTarget = h2;
      // Subir até encontrar o container da conversa (div com height fixo de 82px)
      for (let i = 0; i < 6; i++) {
        if (!clickTarget.parentElement) break;
        clickTarget = clickTarget.parentElement;
        // A row da conversa é filha direta do div com position:absolute
        const parentStyle = clickTarget.parentElement?.style;
        if (parentStyle && parentStyle.position === 'absolute') {
          return clickTarget;
        }
      }
      // Fallback: retorna o h2 mesmo — o click deve propagar
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
