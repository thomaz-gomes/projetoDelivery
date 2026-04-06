# Inbox de Atendimento Multicanal — Design

**Data:** 2026-04-06  
**Status:** Aprovado  
**Abordagem:** Socket-First (Socket.IO existente)

## Decisões

| Decisão | Escolha |
|---|---|
| Canais | WhatsApp (fase 1), Facebook + Instagram (fase 2) |
| Evolution API | v2 — webhooks granulares |
| Atendimento | Roteamento automático por loja + atribuição manual |
| Persistência | Híbrido: texto/metadados no Postgres, mídia no filesystem |
| Respostas rápidas | Por empresa |
| IA | Fase 2 |
| Notificações | Badge + som + push notification do browser |

## Arquitetura

Mensagens chegam via webhook da Evolution API v2 → backend processa e persiste → emite via Socket.IO para o frontend em tempo real. Frontend mantém estado local com Pinia e carrega histórico via REST ao abrir conversa.

A arquitetura de dados é multicanal desde o início (enum `Channel`), mas a implementação fase 1 cobre apenas WhatsApp.

## Modelo de Dados

### Conversation

```prisma
model Conversation {
  id                String    @id @default(uuid())
  companyId         String
  company           Company   @relation(fields: [companyId], references: [id])
  storeId           String?
  store             Store?    @relation(fields: [storeId], references: [id])
  channel           Channel   // WHATSAPP, FACEBOOK, INSTAGRAM
  channelContactId  String    // telefone normalizado (WA), PSID (FB), IGID (IG)
  instanceName      String?   // nome da instância Evolution (WA)
  customerId        String?
  customer          Customer? @relation(fields: [customerId], references: [id])
  assignedUserId    String?
  assignedUser      User?     @relation(fields: [assignedUserId], references: [id])
  status            ConversationStatus @default(OPEN)
  lastMessageAt     DateTime?
  unreadCount       Int       @default(0)
  contactName       String?   // pushName do WA
  contactAvatarUrl  String?
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt
  messages          Message[]

  @@unique([companyId, channel, channelContactId], name: "company_channel_contact")
  @@index([companyId, status, lastMessageAt])
  @@index([storeId, status])
}
```

### Message

```prisma
model Message {
  id              String      @id @default(uuid())
  conversationId  String
  conversation    Conversation @relation(fields: [conversationId], references: [id])
  externalId      String?     // ID na Evolution/Meta API
  direction       MessageDirection // INBOUND, OUTBOUND
  type            MessageType // TEXT, IMAGE, AUDIO, VIDEO, DOCUMENT, LOCATION, STICKER
  body            String?     // texto ou caption
  mediaUrl        String?     // caminho relativo no filesystem
  mediaMimeType   String?
  mediaFileName   String?
  latitude        Float?
  longitude       Float?
  quotedMessageId String?
  status          MessageStatus @default(SENT)
  createdAt       DateTime    @default(now())

  @@index([conversationId, createdAt])
  @@index([externalId])
}
```

### QuickReply

```prisma
model QuickReply {
  id        String   @id @default(uuid())
  companyId String
  company   Company  @relation(fields: [companyId], references: [id])
  shortcut  String   // ex: "/saudacao"
  title     String
  body      String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([companyId, shortcut])
  @@index([companyId])
}
```

### Enums

```prisma
enum Channel {
  WHATSAPP
  FACEBOOK
  INSTAGRAM
}

enum ConversationStatus {
  OPEN
  CLOSED
  ARCHIVED
}

enum MessageDirection {
  INBOUND
  OUTBOUND
}

enum MessageType {
  TEXT
  IMAGE
  AUDIO
  VIDEO
  DOCUMENT
  LOCATION
  STICKER
}

enum MessageStatus {
  PENDING
  SENT
  DELIVERED
  READ
  FAILED
}
```

## Backend — Webhook & API

### Webhook Evolution API v2

**Endpoint:** `POST /webhook/evolution` (público, sem JWT)

**Fluxo:**
1. Evolution envia evento `MESSAGES_UPSERT`
2. Backend valida payload, identifica instância por `instanceName`
3. Busca ou cria `Conversation` por `(companyId, WHATSAPP, telefone)`
4. Roteamento automático: `storeId` baseado na instância → stores vinculadas
5. Persiste `Message` (se mídia: download + salva em filesystem)
6. Atualiza `lastMessageAt`, incrementa `unreadCount`
7. Emite Socket.IO `inbox:new-message` para room `inbox:{companyId}`
8. Dispara notificação browser

**Eventos tratados:**
- `MESSAGES_UPSERT` → mensagem nova
- `MESSAGES_UPDATE` → status update (delivered, read)
- `CONNECTION_UPDATE` → atualiza `WhatsAppInstance.status`

**Segurança:** validação por `instanceName` (deve existir no banco) + header `apikey` comparado com `EVOLUTION_API_API_KEY`.

### Endpoints REST

Todos sob `/inbox`, protegidos por JWT:

| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/inbox/conversations` | Lista conversas (filtros: storeId, status, search) |
| `GET` | `/inbox/conversations/:id` | Detalhes + últimas mensagens |
| `GET` | `/inbox/conversations/:id/messages` | Histórico paginado (cursor-based) |
| `POST` | `/inbox/conversations/:id/send` | Enviar mensagem (texto, mídia, áudio) |
| `PATCH` | `/inbox/conversations/:id` | Atualizar status, atribuir atendente |
| `PATCH` | `/inbox/conversations/:id/read` | Marcar como lida |
| `POST` | `/inbox/conversations/:id/link-customer` | Vincular a cliente existente |
| `GET` | `/inbox/quick-replies` | Listar respostas rápidas |
| `POST` | `/inbox/quick-replies` | Criar |
| `PUT` | `/inbox/quick-replies/:id` | Editar |
| `DELETE` | `/inbox/quick-replies/:id` | Remover |

### Socket.IO Events

| Evento | Direção | Descrição |
|--------|---------|-----------|
| `inbox:new-message` | Server → Client | Mensagem recebida |
| `inbox:message-sent` | Server → Client | Confirmação de envio |
| `inbox:message-status` | Server → Client | Status update (delivered/read) |
| `inbox:conversation-updated` | Server → Client | Atribuição, status change |

**Room:** socket entra em `inbox:{companyId}` ao fazer `identify`. Frontend filtra por `storeId` localmente.

## Frontend — Layout & Componentes

### Layout

3 painéis (desktop): sidebar existente | lista de conversas | painel de chat.  
Mobile (< 768px): lista e chat em telas separadas (push/pop).

```
┌──────────┬───────────────────┬─────────────────────────┐
│ Sidebar  │  Lista Conversas  │   Painel de Chat        │
│ (exist.) │  Busca + Filtros  │   Header + Mensagens    │
│          │  ConversationItem │   + Input com ações      │
└──────────┴───────────────────┴─────────────────────────┘
```

### Componentes

```
views/inbox/
  Inbox.vue              — container 3 painéis
  ConversationList.vue   — lista com busca e filtros
  ConversationItem.vue   — item (avatar, nome, preview, badge unread)
  ChatPanel.vue          — header + mensagens + input
  ChatBubble.vue         — balão (texto, mídia, áudio)
  AudioPlayer.vue        — player customizado (play/pause, progress, velocidade 1x/1.5x/2x)
  ChatInput.vue          — input com anexo e quick reply trigger
  QuickReplyPicker.vue   — dropdown ativado com "/"
  ConversationHeader.vue — info do contato + ações
  LinkCustomerModal.vue  — vincular/cadastrar cliente
  AssignUserModal.vue    — atribuir atendente

views/inbox/settings/
  QuickReplies.vue       — CRUD de respostas rápidas
```

### Pinia Store

```javascript
// stores/inbox.js
state: {
  conversations: [],
  activeConversationId: null,
  messages: {},              // { [conversationId]: Message[] }
  unreadTotal: 0,
  filters: { storeId: null, status: 'OPEN', search: '' }
}
```

### Interações

| Ação | Comportamento |
|------|--------------|
| Digitar `/` | Abre QuickReplyPicker filtrado |
| Clicar 📎 | File picker → upload + envio |
| Áudio recebido | AudioPlayer com play/pause, progress, velocidade |
| Mensagem nova (socket) | Conversa sobe no topo, badge++, beep + push notification |
| "Vincular cliente" | Modal busca por telefone/nome → vincula ou cadastra |
| "Novo pedido" | Redireciona com `?customerId={id}` pré-selecionado |
| Scroll up | Lazy load mensagens antigas (cursor pagination) |

## Configuração & Integração

### Webhook automático

Ao criar/conectar instância WhatsApp, backend registra webhook automaticamente via `PUT /webhook/set/{instanceName}` com eventos `MESSAGES_UPSERT`, `MESSAGES_UPDATE`, `CONNECTION_UPDATE`.

### Mídia storage

```
public/uploads/inbox/{companyId}/{yyyy-mm}/{uuid}.{ext}
```

Mídia recebida: download imediato (URLs da Evolution expiram) → salva localmente.  
Mídia enviada: upload via multipart → salva local → envia via Evolution API.

### Navegação

Novo item no sidebar abaixo de "Pedidos":
- Label: "Inbox"
- Ícone: `bi bi-inbox`
- Badge: `unreadTotal`
- `moduleKey: 'WHATSAPP'`

### Rota

```javascript
{ path: '/inbox', component: Inbox, meta: { requiresAuth: true, requiresModule: 'WHATSAPP' } }
{ path: '/inbox/quick-replies', component: QuickReplies, meta: { requiresAuth: true, requiresModule: 'WHATSAPP' } }
```

### Compatibilidade com notify.js

Notificações automáticas existentes (rider, status, resumo) continuam funcionando. Mensagens enviadas pelo `notify.js` via `evoSendText` são capturadas pelo webhook (`MESSAGES_UPSERT` outbound) e aparecem no inbox — atendente vê histórico completo.

## Fase 2 (Futuro)

- **Facebook Messenger:** Meta Webhooks API → mesmo modelo `Conversation` com `channel: FACEBOOK`
- **Instagram DM:** Meta Instagram Messaging API → `channel: INSTAGRAM`
- **IA — Sugestão de resposta:** modelo sugere resposta, atendente aprova/edita
- **IA — Extração de pedido:** interpreta mensagem e monta pedido automaticamente
