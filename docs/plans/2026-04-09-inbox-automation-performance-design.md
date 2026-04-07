# Inbox Automation & Performance — Design

**Data:** 2026-04-09
**Status:** Aprovado

## Decisoes

| Feature | Decisao |
|---|---|
| Auto-responder fora do horario | `Store.outOfHoursReplyId` (FK opcional QuickReply) |
| Saudacao 1a mensagem | `Store.greetingReplyId` + 6h de inatividade do contato |
| Deteccao de palavras-chave | Match por nome de tag existente, sem campos novos |
| Cache sessionStorage | Conversas + mensagens da conversa ativa, TTL 30min |
| Reconexao Socket.IO | Refetch completo (conversations + mensagens da ativa) |
| Pre-fetch proxima conversa | Skip (YAGNI) |
| Scroll-up paginacao | Threshold 200px + indicador "Inicio da conversa" |

## Schema Prisma

```prisma
model Store {
  // ... existentes
  outOfHoursReplyId String?
  outOfHoursReply   QuickReply? @relation("StoreOutOfHoursReply", fields: [outOfHoursReplyId], references: [id])
  greetingReplyId   String?
  greetingReply     QuickReply? @relation("StoreGreetingReply", fields: [greetingReplyId], references: [id])
}

model QuickReply {
  // ... existentes
  storesOutOfHours Store[] @relation("StoreOutOfHoursReply")
  storesGreeting   Store[] @relation("StoreGreetingReply")
}
```

## Backend

### Pipeline de automacoes em `webhookEvolution.js`

Apos persistir Message inbound (e antes do `io.emit`), executa `runAutomations(...)` em best-effort:

1. **Auto-responder fora do horario** — se `store.outOfHoursReply` existe E `isStoreOpen(store) === false`, envia o body via `evoSendText` e persiste como mensagem OUTBOUND. Pula greeting.
2. **Saudacao** — se `store.greetingReply` existe E nao houve outra mensagem inbound do mesmo contato nas ultimas 6h, envia o body.
3. **Match de tags** — busca tags distintas da empresa via `unnest`, compara com `body.toLowerCase()`, adiciona matches ao array `tags` da conversa.

### Helper `isStoreOpen(store)`

- Se `alwaysOpen` ou `open24Hours`: aberto.
- Se `weeklySchedule` invalido/vazio: aberto (safe default).
- Resolve dia/hora no timezone da loja (`store.timezone || America/Sao_Paulo`).
- Verifica entry do dia no `weeklySchedule` (formato existente: `[{day, enabled, from, to}]`).

### Helper `sendAutoReply`

```javascript
async function sendAutoReply(conversation, instanceName, body) {
  await evoSendText({ instanceName, to: conversation.channelContactId, text: body });
  await prisma.message.create({
    data: { conversationId: conversation.id, direction: 'OUTBOUND', type: 'TEXT', body, status: 'SENT' },
  });
}
```

### Endpoint

```
PATCH /stores/:id/inbox-automation
Body: { outOfHoursReplyId?: string|null, greetingReplyId?: string|null }
```

`requireRole('ADMIN')`. Permite null para desabilitar.

## Frontend

### Cache sessionStorage (stores/inbox.js)

Novas actions: `saveToSessionStorage()`, `restoreFromSessionStorage()`. TTL de 30min. Snapshot inclui:
- `conversations`
- `activeConversationId`
- `messages[activeConversationId]` (apenas a conversa ativa)

Em `Inbox.vue` `onMounted`:
- Tenta restore primeiro
- Se falhar, faz `fetchConversations`
- Watch deep + debounced (500ms) salva snapshot a cada mudanca

### Reconnect handler (Inbox.vue)

```javascript
socket.on('reconnect', async () => {
  await inboxStore.fetchConversations();
  if (inboxStore.activeConversationId) {
    delete inboxStore.messages[inboxStore.activeConversationId];
    await inboxStore.fetchMessages(inboxStore.activeConversationId);
  }
});
```

### Scroll-up melhorado (ChatPanel.vue)

- Threshold 200px (era 100)
- Estado novo `noMoreMessages: ref(false)`
- Quando `fetchMessages` retorna array vazio, marca `noMoreMessages = true`
- UI:
  - `Carregando mensagens antigas...` durante load
  - `Inicio da conversa` quando `noMoreMessages === true`

### Tela de configuracao

Nova rota: `/inbox/automation`
Novo arquivo: `views/inbox/settings/InboxAutomation.vue`
Item de menu adicionado em nav.js (junto com Quick Replies)

Layout:
- Select de loja (multi-store)
- Bloco "Auto-resposta fora do horario": select de QuickReply + preview do body + botao Salvar
- Bloco "Saudacao automatica": select de QuickReply + preview + botao Salvar

### Sem UI nova para keywords

Reusa tags existentes. Atendente cria tags via TagChips, backend faz match automatico no webhook, conversation.tags atualizado, TagChips renderiza.
