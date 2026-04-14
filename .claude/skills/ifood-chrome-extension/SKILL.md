---
name: ifood-chrome-extension
description: Guia completo para construir a extensão Chrome que integra com o iFood Gestor de Pedidos para enviar mensagens automáticas no chat. Use esta skill sempre que precisar recriar, modificar, debugar ou entender a extensão do Chrome para iFood, incluindo manipulação de DOM no gestordepedidos.ifood.com.br, integração Socket.IO com o backend, e automação de mensagens por status de pedido.
---

# iFood Chrome Extension - Guia de Reconstrução

Esta skill contém todo o conhecimento necessário para construir do zero a extensão Chrome que envia mensagens automáticas no chat do iFood Gestor de Pedidos, integrada ao backend Delivery SaaS via Socket.IO.

## Visão Geral da Arquitetura

A extensão funciona como uma ponte entre o backend (que sabe quando um pedido muda de status) e a interface web do iFood (onde as mensagens são enviadas no chat). O fluxo completo:

```
Pedido muda de status no backend
  → tryEmitIfoodChat() resolve template de mensagem
  → emitirIfoodChat() emite evento Socket.IO "ifood:chat"
  → Background service worker da extensão recebe o evento
  → Encaminha para content script na aba ativa do iFood
  → Content script manipula o DOM para enviar a mensagem no chat
```

## Estrutura de Arquivos da Extensão

```
ifood-chat-extension/
├── manifest.json          # Manifest V3
├── background.js          # Service worker — Socket.IO + roteamento
├── content.js             # Manipulação DOM no iFood
├── selectors.js           # Seletores CSS do iFood (isolados para fácil manutenção)
├── popup.html             # UI de configuração
├── popup.js               # Controller do popup
├── lib/
│   └── socket.io.min.js   # Socket.IO v4.7.5 client (bundled)
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

## 1. manifest.json — Configuração Manifest V3

```json
{
  "manifest_version": 3,
  "name": "Delivery SaaS - iFood Chat",
  "version": "1.0.0",
  "description": "Envia mensagens automáticas no chat do iFood Gestor de Pedidos",
  "permissions": ["storage", "activeTab", "tabs", "scripting"],
  "host_permissions": ["https://gestordepedidos.ifood.com.br/*"],
  "background": {
    "service_worker": "background.js"
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
    "default_icon": { "16": "icons/icon16.png", "48": "icons/icon48.png", "128": "icons/icon128.png" }
  },
  "icons": { "16": "icons/icon16.png", "48": "icons/icon48.png", "128": "icons/icon128.png" }
}
```

Detalhes importantes:
- **Manifest V3** (obrigatório para Chrome moderno) — usa service worker, não background page
- **Permissões**: `storage` (config persistente), `activeTab` + `tabs` (gerenciar abas), `scripting` (injeção dinâmica)
- **host_permissions**: restrito ao domínio do iFood Gestor de Pedidos
- **content_scripts**: `selectors.js` carrega ANTES de `content.js` (dependência)
- **run_at**: `document_idle` — espera DOM carregar antes de injetar

## 2. selectors.js — Seletores DOM do iFood

Os seletores são isolados em arquivo separado porque o iFood pode mudar o HTML a qualquer momento. Quando quebrar, basta atualizar este arquivo.

```javascript
window.IFOOD_SELECTORS = {
  // Painel de conversas (header)
  chatToggleButton: '[data-test-id="CONSUMER_CHAT_REBORN_HEADER_ENTRY_POINT"]',
  closeChatButton: 'span.ifdl-icon-close',
  closeConversationButton: '[data-testid="close-icon"]',

  // Lista de conversas (virtual scroll)
  conversationListScroll: '[style*="overflow: auto"]',
  conversationOrderNumber: 'h2',

  // Dentro de uma conversa
  messageInput: 'textarea[aria-label="Campo de mensagem"]',
  sendButton: 'button[aria-label="Enviar mensagem"]',

  // Cards de pedido (tela de expedição)
  orderCard: '[data-testid="card"]',

  // Botão de chat nos detalhes do pedido (cria conversa se não existir)
  orderDetailsChatButton: '[data-test-id="CONSUMER_CHAT_REBORN_MESSAGING_ORDER_DETAILS_ENTRY_POINT"]',
};
```

Atenção aos seletores:
- `data-test-id` (com hífen) vs `data-testid` (sem hífen) — o iFood usa AMBOS. Não confundir.
- `chatToggleButton` e `orderDetailsChatButton` usam `data-test-id` (com hífen)
- `closeConversationButton` e `orderCard` usam `data-testid` (sem hífen)
- A lista de conversas usa **virtual scroll** — nem todos os itens estão no DOM ao mesmo tempo

## 3. background.js — Service Worker

O service worker é o coração da extensão. Ele mantém a conexão Socket.IO com o backend e roteia mensagens para o content script.

### Conceitos-chave

**Importação do Socket.IO**: Em Manifest V3, service workers usam `importScripts()`:
```javascript
importScripts('lib/socket.io.min.js');
```

**Estado gerenciado**:
```javascript
let socket = null;
let connected = false;
let messageQueue = [];    // Fila para quando não há aba ativa
let activeTabId = null;   // Apenas UMA aba recebe automação
let activeTabUrl = '';
```

**Conexão Socket.IO**: Autentica com `extensionToken` + `companyId` via handshake auth:
```javascript
socket = io(config.backendUrl, {
  transports: ['websocket', 'polling'],
  auth: {
    extensionToken: config.extensionToken,
    companyId: config.companyId,
  },
  reconnectionAttempts: Infinity,
  reconnectionDelay: 3000,
});
```

**Evento principal** — recebe `ifood:chat` e encaminha para content script:
```javascript
socket.on('ifood:chat', (payload) => {
  forwardToContentScript(payload);
});
```

**Injeção dinâmica com retry**: Se o content script não responde (ex: página recarregou), re-injeta e tenta de novo (3 tentativas):
```javascript
async function sendMessageToTab(tabId, message, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await chrome.tabs.sendMessage(tabId, message);
    } catch (e) {
      if (attempt < retries) {
        await injectContentScripts(tabId);  // re-injeta
      } else {
        throw e;
      }
    }
  }
}
```

**Fila de mensagens**: Se não há aba ativa, mensagens são enfileiradas e despachadas quando uma aba é ativada ou o content script reporta `CONTENT_SCRIPT_READY`.

**Badge de status**:
- Verde (sem texto): conectado + aba ativa = tudo OK
- Amarelo (⚡): conectado mas sem aba ativa
- Vermelho (!): desconectado

**Listeners do Chrome** (DEVEM ser registrados no top-level, requisito MV3):
- `chrome.runtime.onMessage`: roteamento de mensagens internas
- `chrome.tabs.onRemoved`: limpa aba ativa se fechada
- `chrome.tabs.onUpdated`: limpa aba ativa se navega fora do iFood
- `chrome.runtime.onStartup` + `onInstalled`: reconecta Socket.IO

### Tipos de mensagem interna

| Tipo | Origem | Ação |
|------|--------|------|
| `GET_STATUS` | popup | Retorna { connected, queueLength, activeTabId, activeTabUrl } |
| `RECONNECT` | popup | Reconecta Socket.IO com nova config |
| `SET_ACTIVE_TAB` | popup | Ativa aba + injeta scripts + flush fila |
| `CLEAR_ACTIVE_TAB` | popup | Desativa aba |
| `CONTENT_SCRIPT_READY` | content | Flush fila se é a aba ativa |
| `MESSAGE_SENT` | content | Log de sucesso |
| `MESSAGE_FAILED` | content | Log de falha |
| `SEND_CHAT_MESSAGE` | background→content | Envia mensagem no chat |
| `PING` | background→content | Health check |

## 4. content.js — Manipulação DOM no iFood

Este é o arquivo mais delicado porque depende da estrutura DOM do iFood, que é uma aplicação React.

### Dois fluxos para enviar mensagem

**FLUXO 1 — Via lista de conversas existentes** (preferencial):
1. Clica no botão de chat no header → abre painel de conversas
2. Verifica que o título "Conversas" apareceu (valida que abriu certo)
3. Busca conversa pelo número do pedido (com virtual scroll)
4. Clica na conversa → abre chat
5. Digita e envia mensagem

**FLUXO 2 — Via card do pedido** (fallback quando conversa não existe):
1. Encontra o card do pedido na tela de expedição pelo número
2. Clica no card → abre detalhes
3. Clica no botão de chat nos detalhes (isso CRIA a conversa)
4. Digita e envia mensagem

### Técnica crítica: React Controlled Inputs

O iFood usa React, então `input.value = "texto"` não funciona — o React ignora. A solução é usar o setter nativo do prototype:

```javascript
const nativeSetter =
  Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set ||
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;

if (nativeSetter) {
  nativeSetter.call(input, message);
} else {
  input.value = message;
}

// Disparar eventos que o React escuta
input.dispatchEvent(new Event('input', { bubbles: true }));
input.dispatchEvent(new Event('change', { bubbles: true }));
```

### Virtual Scroll na lista de conversas

O iFood usa virtual scroll — apenas as conversas visíveis estão no DOM. Para encontrar uma conversa:

```javascript
// Scroll incremental de 250px, até 15 tentativas
const scrollContainer = document.querySelector(SELECTORS.conversationListScroll);
scrollContainer.scrollTop = 0;  // Começa do topo

for (let i = 0; i < 15; i++) {
  const prevTop = scrollContainer.scrollTop;
  scrollContainer.scrollTop += 250;
  await sleep(400);  // Espera renderizar
  if (scrollContainer.scrollTop === prevTop) break;  // Chegou no fim
  // Busca o h2 com o número do pedido
}
```

### Encontrar o elemento clicável na virtual scroll

Quando acha o `<h2>` com o número, precisa subir até o container clicável:

```javascript
function findH2WithOrderNumber(target) {
  const headings = document.querySelectorAll('h2');
  for (const h2 of headings) {
    if (h2.textContent.trim() === target) {  // ex: "#3222"
      let clickTarget = h2;
      for (let i = 0; i < 6; i++) {
        if (!clickTarget.parentElement) break;
        clickTarget = clickTarget.parentElement;
        // Virtual scroll items têm parent com position: absolute
        if (clickTarget.parentElement?.style?.position === 'absolute') {
          return clickTarget;
        }
      }
      return h2;
    }
  }
  return null;
}
```

### Envio da mensagem (botão ou Enter)

```javascript
const sendBtn = await waitForElement(SELECTORS.sendButton, 2000);
if (sendBtn) {
  sendBtn.click();
} else {
  // Fallback: simula Enter
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
  input.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
  input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
}
```

### Tempos de espera (sleeps)

Os sleeps são necessários porque o iFood é React e renderiza assincronamente:
- `1500ms` após clicar para abrir painel de chat
- `1500ms` após clicar em conversa
- `2000ms` após clicar no card do pedido (detalhes carregam)
- `2000ms` após clicar no botão de chat nos detalhes
- `500ms` após preencher campo de mensagem (React processar)
- `1000ms` após enviar (garantir envio)
- `2500ms` entre mensagens da fila (MESSAGE_DELAY_MS)
- `400ms` entre scrolls na virtual scroll
- `500ms` para fechar painéis

### Fila interna do content script

O content script tem sua própria fila para processar mensagens sequencialmente:
```javascript
let processing = false;
const queue = [];

// Cada mensagem é processada uma por vez
// Em caso de falha, closeChatPanel() limpa o estado
// Entre mensagens, espera MESSAGE_DELAY_MS (2500ms)
```

### Modo Debug

Preenche o campo de mensagem mas NÃO envia — útil para testar sem enviar mensagens reais:
```javascript
const { debugMode } = await chrome.storage.local.get(['debugMode']);
if (debugMode) {
  console.log('MODO DEBUG — mensagem preenchida mas NÃO enviada');
  return;
}
```

### Limpeza de estado (closeChatPanel)

Antes de cada nova mensagem e após falhas, limpar o painel de chat:
1. Se textarea visível → fechar conversa (closeConversationButton)
2. Se lista "Conversas" aberta → fechar painel (closeChatButton ou chatToggleButton)

## 5. popup.html + popup.js — Interface de Configuração

O popup tem:
- **Status**: Indicador verde/vermelho de conexão
- **Aba Ativa**: Mostra qual aba está recebendo automação, com botões ativar/desativar
- **Campos de config**: URL do backend, token da extensão, company ID
- **Debug mode**: Checkbox
- **Salvar e Conectar**: Persiste em `chrome.storage.local` e envia `RECONNECT`

Lógica de ativação de aba:
- Se 1 aba do iFood → ativa automaticamente
- Se múltiplas → mostra lista para escolher
- Se nenhuma → mostra aviso

Estilo: popup com 340px de largura, CSS inline minimalista, cores Bootstrap.

## 6. Backend — Integração Socket.IO

### Autenticação da extensão (index.js)

O backend valida a extensão no middleware Socket.IO:
```javascript
io.use(async (socket, next) => {
  const extensionToken = socket.handshake.auth.extensionToken;
  if (extensionToken) {
    const companyId = socket.handshake.auth.companyId;
    const setting = await prisma.printerSetting.findUnique({
      where: { companyId },
      select: { extensionTokenHash: true },
    });
    const incomingHash = sha256(extensionToken);
    if (incomingHash !== setting.extensionTokenHash) {
      return next(new Error('invalid-extension-token'));
    }
    socket.extension = { companyId };
    socket.companyId = companyId;
  }
  return next();
});
```

Segurança: token nunca é armazenado em texto — apenas o SHA256 hash em `PrinterSetting.extensionTokenHash`.

### Função de broadcast (index.js)

```javascript
export function emitirIfoodChat({ orderNumber, message, storeId, companyId }) {
  const sockets = Array.from(io.sockets.sockets.values());
  for (const s of sockets) {
    if (!s.extension) continue;                    // Só extensões
    if (s.companyId && s.companyId !== companyId) continue;  // Isolamento por empresa
    s.emit('ifood:chat', { orderNumber, message, storeId });
  }
}
```

### Rotas REST (routes/ifoodChat.js)

| Rota | Auth | Função |
|------|------|--------|
| `GET /ifood-chat/messages/:storeId` | ADMIN | Lista mensagens configuradas (seed defaults se vazio) |
| `PUT /ifood-chat/messages/:storeId` | ADMIN | Atualiza templates de mensagem |
| `POST /ifood-chat/send` | Autenticado | Envio manual de mensagem |
| `POST /ifood-chat/generate-token` | ADMIN | Gera token de 24 chars, salva hash |

### Emissão automática por status (services/ifoodChatEmitter.js)

```javascript
export async function tryEmitIfoodChat(order, newStatus) {
  if (!isIfoodOrder(order)) return;  // Só pedidos iFood
  const chatKey = mapStatusToChatKey(newStatus);
  // EM_PREPARO → CONFIRMED, SAIU_PARA_ENTREGA → DISPATCHED, CONCLUIDO → DELIVERED
  if (!chatKey) return;

  const msgConfig = await prisma.ifoodChatMessage.findUnique({
    where: { storeId_status: { storeId, status: chatKey } },
  });
  if (!msgConfig || !msgConfig.enabled) return;

  const finalMessage = msgConfig.message
    .replace(/\{nome\}/g, customerName)
    .replace(/\{numero\}/g, orderNumber);

  emitirIfoodChat({ orderNumber, message: finalMessage, storeId, companyId });
}
```

Chamada em: `routes/orders.js` (accept/update) e `services/ifoodWebhookProcessor.js`.

### Modelo Prisma

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

Campo `extensionTokenHash` e `extensionTokenCreatedAt` ficam no modelo `PrinterSetting` (reaproveitado).

## 7. Templates de Mensagem

Variáveis disponíveis: `{nome}` (cliente) e `{numero}` (número do pedido).

| Status | Mensagem Padrão | Ativo |
|--------|-----------------|-------|
| CONFIRMED | Olá {nome}! Estamos preparando o seu pedido #{numero} com muito carinho. | Sim |
| DISPATCHED | {nome}! O seu pedido #{numero} acabou de sair para entrega! Fique atento que em breve o entregador estará no endereço solicitado. | Sim |
| DELIVERED | Agora que seu pedido foi entregue, ficaríamos muito felizes se você pudesse dedicar um momento para avaliá-lo. Sua opinião é extremamente valiosa para nós! | Sim |
| MANUAL | Olá {nome}! Temos uma mensagem sobre o seu pedido #{numero}. | Não |

## 8. Checklist de Reconstrução

Ao recriar a extensão do zero, siga esta ordem:

1. Criar estrutura de diretórios e baixar `socket.io.min.js` v4.7.5
2. Criar `manifest.json` (Manifest V3)
3. Criar `selectors.js` — inspecionar o DOM atual do iFood e atualizar seletores
4. Criar `content.js` — dois fluxos (lista de conversas + card do pedido)
5. Criar `background.js` — Socket.IO client + roteamento + fila
6. Criar `popup.html` + `popup.js` — configuração e ativação de aba
7. Gerar ícones (16, 48, 128px)
8. Backend: criar modelo `IfoodChatMessage` no Prisma schema
9. Backend: adicionar `extensionTokenHash` ao `PrinterSetting`
10. Backend: criar `routes/ifoodChat.js` e `services/ifoodChatEmitter.js`
11. Backend: adicionar auth de extensão no middleware Socket.IO (`index.js`)
12. Backend: exportar `emitirIfoodChat()` em `index.js`
13. Backend: chamar `tryEmitIfoodChat()` nos pontos de mudança de status
14. Frontend: adicionar UI de configuração (token, mensagens por loja)
15. Testar com modo debug ativado primeiro

## 9. Armadilhas Conhecidas

- **Seletores mudam**: o iFood atualiza o HTML periodicamente. Sempre verificar seletores atuais antes de assumir que os documentados aqui ainda funcionam.
- **React controlled inputs**: NUNCA usar `input.value = x` diretamente. Sempre usar native setter + dispatch events.
- **Virtual scroll**: conversas fora da viewport não existem no DOM. Precisa scrollar para encontrá-las.
- **`data-test-id` vs `data-testid`**: o iFood usa ambas as convenções. Cuidado ao copiar seletores.
- **Service worker MV3**: listeners Chrome DEVEM ser registrados synchronously no top-level. Não colocar dentro de callbacks ou async functions.
- **Sleep é necessário**: o iFood é React SPA — transições de tela levam tempo. Sem sleeps adequados, elementos não existem no DOM no momento do querySelector.
- **Uma aba ativa por vez**: evita automação duplicada em múltiplas abas do iFood.
