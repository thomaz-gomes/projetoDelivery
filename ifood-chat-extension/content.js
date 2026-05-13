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
 *
 * Marca isInitialConversation=true para o typeAndSend dar mais tempo pra
 * UI estabilizar — criação de conversa nova passa por um estado de
 * loading no React onde o botão de enviar nasce disabled.
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
  // Conversa nova: aguardamos mais para o React montar o textarea +
  // habilitar o botão de envio (em conversa existente o ciclo já foi).
  await sleep(2500);

  await typeAndSend(message, orderNumber, { isInitialConversation: true });
}

/**
 * Digita a mensagem e envia (ou para se modo debug).
 * Assume que o campo de mensagem já está visível.
 *
 * @param {string} message - texto a enviar
 * @param {string} orderNumber - número do pedido (pra log)
 * @param {{ isInitialConversation?: boolean }} [opts] - flags de UX
 *   isInitialConversation: indica que a conversa foi criada agora
 *     (Fluxo 2). O React do iFood mantém o botão de enviar disabled
 *     até validar o input no próximo ciclo — sem o polling adicional,
 *     o click() acontecia no botão disabled e a mensagem ficava
 *     pendurada no campo. Em conversa existente esse race é raro.
 */
async function typeAndSend(message, orderNumber, opts = {}) {
  const input = await waitForElement(SELECTORS.messageInput, 5000);
  if (!input) throw new Error('Campo de mensagem não encontrado');

  // Foco antes de "digitar" — alguns componentes React só registram
  // mudanças no estado controlado quando o elemento está focado.
  try { input.focus(); } catch (_) { /* ignore */ }
  await sleep(100);

  // React controlled inputs: usar native setter
  const nativeSetter =
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set ||
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;

  if (nativeSetter) {
    nativeSetter.call(input, message);
  } else {
    input.value = message;
  }
  // InputEvent com data + inputType simula digitação real; o componente
  // React valida o conteúdo no listener de onChange e libera o botão.
  try {
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: message }));
  } catch (_) {
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  input.dispatchEvent(new Event('change', { bubbles: true }));

  // Em conversa nova damos mais tempo pra UI estabilizar antes de
  // procurar o botão habilitado.
  await sleep(opts.isInitialConversation ? 900 : 500);

  // Checar modo debug
  const { debugMode } = await chrome.storage.local.get(['debugMode']);
  if (debugMode) {
    console.log(`[iFood Extension] MODO DEBUG — mensagem preenchida mas NÃO enviada para pedido ${orderNumber}`);
    return;
  }

  // Polling pelo botão *habilitado* (não basta existir — o iFood
  // renderiza o botão disabled enquanto o estado React não confirma
  // que tem texto. Esse era o bug do Fluxo 2: click no disabled =
  // no-op silencioso).
  const sendBtn = await waitForEnabledSendButton(opts.isInitialConversation ? 5000 : 3000);

  if (sendBtn) {
    sendBtn.click();
  } else {
    // Fallback: tentar Enter (alguns componentes ouvem keydown).
    pressEnter(input);
  }

  // Verifica se a mensagem realmente saiu olhando se o textarea esvaziou.
  // Se ainda tiver o texto, o click foi consumido por botão disabled —
  // tentamos uma segunda via via Enter.
  const cleared = await waitForCleared(input, 2000);
  if (!cleared) {
    console.warn(`[iFood Extension] Botão não enviou — tentando Enter como fallback (pedido ${orderNumber})`);
    pressEnter(input);
    const cleared2 = await waitForCleared(input, 2000);
    if (!cleared2) {
      throw new Error('Mensagem digitada mas não enviada — botão ficou disabled e Enter não disparou');
    }
  }

  await sleep(500);

  // Fechar tudo
  await closeChatPanel();
  console.log(`[iFood Extension] Mensagem enviada para pedido ${orderNumber}`);
}

/**
 * Polling do botão de envio até ele existir E estar habilitado.
 * Retorna o elemento ou null se estourar o timeout.
 */
async function waitForEnabledSendButton(timeout = 3000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const btn = document.querySelector(SELECTORS.sendButton);
    if (btn && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true') {
      return btn;
    }
    await sleep(150);
  }
  return null;
}

/**
 * Dispara a sequência de eventos de teclado equivalente a Enter no
 * elemento focado. Usado como fallback quando o botão não envia.
 */
function pressEnter(input) {
  const opts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
  input.dispatchEvent(new KeyboardEvent('keydown', opts));
  input.dispatchEvent(new KeyboardEvent('keypress', opts));
  input.dispatchEvent(new KeyboardEvent('keyup', opts));
}

/**
 * Aguarda o textarea ser limpo (sinal de envio bem-sucedido).
 */
async function waitForCleared(input, timeout = 2000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (!input.value || input.value.trim() === '') return true;
    await sleep(100);
  }
  return false;
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
