# Inbox Usability Improvements — Design

**Data:** 2026-04-08
**Status:** Aprovado

## Decisoes

| Feature | Decisao |
|---|---|
| Notas internas | Campo `internal: Bool` em Message, balao amarelo intercalado |
| Tags | Array de strings em Conversation + autocomplete por uso |
| Busca em mensagens | Global na caixa existente (LIKE em body) |
| Compressao imagens | Client-side via canvas (1080px max, JPEG 0.85) |
| Reply/quote | Nativo via Evolution API (`quoted` param) |
| Filtros | 2 linhas: status + chips (Minhas/Nao lidas) + dropdown loja |

## Schema Prisma

```prisma
model Conversation {
  // ... existentes
  tags  String[]  @default([])
}

model Message {
  // ... existentes (incluindo quotedMessageId que ja existe)
  internal      Boolean  @default(false)
  authorUserId  String?
  authorUser    User?    @relation("MessageAuthor", fields: [authorUserId], references: [id])
}

model User {
  // ... existentes
  authoredMessages Message[] @relation("MessageAuthor")
}
```

## Backend

### Endpoints novos / modificados

| Metodo | Rota | Descricao |
|--------|------|-----------|
| GET | `/inbox/conversations` | Adicionar query params: `mine`, `unread`, ampliar `search` para `messages.body` |
| POST | `/inbox/conversations/:id/send` | Aceitar `quotedMessageId`, montar payload `quoted` para evoSendText |
| POST | `/inbox/conversations/:id/internal-note` | Cria Message com `internal: true`, NAO envia para Evolution |
| PATCH | `/inbox/conversations/:id/tags` | Substitui array de tags, emite `inbox:conversation-updated` |
| GET | `/inbox/tags` | Top 20 tags mais usadas (autocomplete) |

### Helper `evoSendText` (wa.js)

Adicionar parametro opcional `quoted: { key, message }`.

### Webhook

Notas internas nao disparam notificacao browser (filtrar `internal === true` no socket emit).

## Frontend

### Componentes novos

```
views/inbox/
  ImageLightbox.vue          # Modal full-screen para visualizar imagens
  TagChips.vue               # Chips de tags com autocomplete (header)
utils/
  compressImage.js           # Helper de compressao client-side via canvas
```

### Componentes modificados

- **ConversationList.vue** — Filtros em 2 linhas, chips Minhas/Nao lidas, dropdown loja
- **ConversationItem.vue** — Avatar colorido por hash, preview de midia (icones)
- **ChatPanel.vue** — Agrupamento por dia, drag-and-drop area, paste handler
- **ChatBubble.vue** — Renderizar nota interna (amarelo), quote preview, botao reply/copy ao hover
- **ChatInput.vue** — Toggle modo nota, preview de reply, compressao antes de enviar
- **ConversationHeader.vue** — Linha de tags com autocomplete

### Pinia store

Novos campos:
```javascript
filters: {
  // ... existentes
  mine: false,
  unread: false,
}
replyToMessageId: null,
internalMode: false,
allTags: [],  // cache do autocomplete
```

Novas actions:
- `sendInternalNote(conversationId, body)`
- `updateTags(conversationId, tags)`
- `fetchAllTags()`
- `setReplyTo(messageId)`
- `clearReplyTo()`

## Compressao client-side

```javascript
// utils/compressImage.js
export async function compressImage(file, opts = {}) {
  const { maxWidth = 1080, quality = 0.85 } = opts;
  if (!file.type.startsWith('image/')) return file;
  if (file.size < 200 * 1024) return file;
  // <canvas> resize + toBlob('image/jpeg', quality)
}
```

Aplicado em `ChatInput.send()` antes de incluir no payload.

## Avatar por hash

```javascript
function colorFromName(name) {
  const colors = ['#3498db','#e74c3c','#2ecc71','#f39c12','#9b59b6','#1abc9c','#e67e22','#34495e'];
  let hash = 0;
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) | 0;
  return colors[Math.abs(hash) % colors.length];
}
```

Mesma logica em ConversationItem.vue e ConversationHeader.vue.

## Preview de midia (ConversationItem)

| Type | Preview |
|------|---------|
| TEXT | body |
| IMAGE | Foto + caption |
| AUDIO | Audio |
| VIDEO | Video |
| DOCUMENT | fileName ou Documento |
| LOCATION | Localizacao |
| STICKER | Sticker |

## Agrupamento por dia (ChatPanel)

Computed que retorna `[{type: 'separator', label: 'Hoje'}, {type: 'message', ...}, ...]`. Labels:
- Hoje (mesma data que `new Date()`)
- Ontem (date - 1)
- Nome do dia da semana (ate 7 dias atras)
- DD/MM/YYYY (mais antigo)
