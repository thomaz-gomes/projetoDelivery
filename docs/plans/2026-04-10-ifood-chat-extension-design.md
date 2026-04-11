# Extensão Chrome — Mensagens Automáticas no Chat iFood

**Data:** 2026-04-10
**Status:** Aprovado
**Abordagem:** Backend envia comandos via Socket.IO, extensão executa no DOM do iFood

## Contexto

O iFood não oferece API pública de chat. Para automatizar mensagens aos clientes (confirmação, saiu para entrega, entregue), criamos uma extensão Chrome que recebe comandos do backend via Socket.IO e executa a ação no DOM do Gestor de Pedidos iFood. Referência: extensão "Super Restaurante" do BeeFood.

## Arquitetura

```
┌─────────────────┐    Socket.IO     ┌──────────────┐
│  Backend Node   │ ───────────────► │  Extensão    │
│  (Express +     │  evento:         │  Chrome      │
│   Socket.IO)    │  "ifood:chat"    │              │
└────────┬────────┘                  └──────┬───────┘
         │                                  │
         │ status change                    │ DOM manipulation
         │ (integração iFood               │ (abre chat, digita
         │  ou botão manual)               │  mensagem, envia)
         │                                  │
┌────────┴────────┐                  ┌──────┴───────┐
│  Frontend Vue   │                  │  Gestor de   │
│  (orders.vue,   │                  │  Pedidos     │
│   painel moto)  │                  │  iFood (aba) │
└─────────────────┘                  └──────────────┘
```

### Fluxo Automático

1. Integração iFood notifica o backend que o status mudou
2. Backend verifica se há mensagem configurada e habilitada para esse status
3. Backend emite `ifood:chat` via Socket.IO: `{ orderNumber, message, storeId }`
4. Extensão recebe, localiza a conversa no Gestor de Pedidos pelo `#orderNumber`, abre o chat, insere a mensagem e envia

### Fluxo Manual (botão no Vue)

1. Operador clica botão "Enviar msg iFood" no card do pedido (orders.vue ou painel motoboy)
2. Frontend faz `POST /ifood-chat/send` com `{ orderId, storeId }`
3. Backend busca mensagem MANUAL configurada, emite `ifood:chat`
4. Extensão executa o mesmo fluxo de envio

## Extensão Chrome (Manifest V3)

### Componentes

- **Service Worker (background.js)** — Conecta ao backend via Socket.IO. Recebe eventos `ifood:chat` e repassa ao content script via `chrome.tabs.sendMessage`.
- **Content Script (content.js)** — Injetado em `gestordepedidos.ifood.com.br/*`. Manipula o DOM para enviar mensagens no chat.
- **Popup (popup.html)** — URL do backend, status da conexão, botão reconectar.
- **Seletores DOM (selectors.js)** — Arquivo isolado com todos os seletores CSS/XPath do iFood, facilitando manutenção quando o iFood muda o HTML.

### Fluxo DOM

1. Clica no ícone de chat (lista de conversas)
2. Busca na lista o item que contém `#XXXX` (número do pedido)
3. Clica na conversa
4. Aguarda campo de input carregar
5. Insere texto no campo de mensagem
6. Dispara envio (click no botão ou Enter)
7. Fecha o chat (volta ao estado anterior)

### Fila de Mensagens

Mensagens processadas uma por vez em fila FIFO, com delay de 2-3 segundos entre cada envio para evitar detecção de automação.

### Autenticação

Token de extensão gerado na tela de configurações do sistema (similar ao Print Agent: hash SHA256 armazenado no banco).

## Backend (mudanças)

### Novo Model Prisma

```prisma
model IfoodChatMessage {
  id        Int      @id @default(autoincrement())
  storeId   Int
  store     Store    @relation(fields: [storeId], references: [id])
  status    String   // CONFIRMED, DISPATCHED, DELIVERED, MANUAL
  message   String
  enabled   Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([storeId, status])
}
```

### Novos Endpoints REST

- `GET /ifood-chat/messages/:storeId` — retorna configurações de mensagens
- `PUT /ifood-chat/messages/:storeId` — atualiza mensagens
- `POST /ifood-chat/send` — envio manual: `{ orderId, storeId }` → emite `ifood:chat`

### Evento Socket.IO

- `ifood:chat` — payload: `{ orderNumber: "#0910", message: "Texto...", storeId: 123 }`

### Integração com Fluxo de Status

No ponto onde o backend processa mudança de status do iFood, adicionar: se há mensagem habilitada para aquele status → emite `ifood:chat` para a room da extensão.

### Variáveis nas Mensagens

Suporte a substituição antes de emitir: `{nome}` (nome do cliente), `{numero}` (número do pedido).

## Frontend (mudanças)

### Botão Manual

- **orders.vue** — botão com ícone de chat no card do pedido, visível apenas para pedidos iFood
- **Painel motoboy** — mesmo botão no card do pedido
- Ação: `POST /ifood-chat/send`, feedback via toast

### Tela de Configuração

Nova seção em Configurações da loja com 4 cards:
- Confirmado | Saiu para entrega | Entregue | Manual
- Cada card: toggle on/off + textarea editável + botão salvar
- Textos padrão pré-preenchidos na criação da configuração

## Riscos e Mitigações

| Risco | Mitigação |
|-------|-----------|
| iFood muda HTML, quebrando content script | Seletores isolados em `selectors.js` para atualização rápida |
| Aba do Gestor fechada, mensagens não enviadas | Badge vermelho no ícone da extensão; backend enfileira por X minutos |
| iFood detecta automação (rate limiting) | Delay 2-3s entre mensagens, fila FIFO |
| Múltiplas lojas no mesmo navegador | V1 assume uma loja por aba |
| Conversa não encontrada (pedido antigo) | Extensão reporta falha ao backend, notifica operador |
