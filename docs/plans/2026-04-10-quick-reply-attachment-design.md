# Quick Reply Attachment — Design

**Data:** 2026-04-10
**Status:** Aprovado

## Decisoes

| Item | Escolha |
|---|---|
| Anexo por reply | 1 opcional + body opcional |
| Storage | `public/uploads/quick-replies/{companyId}/{yyyy-mm}/` |
| Envio | Media com caption (1 mensagem via Evolution) |
| Auto-replies | Tambem enviam midia + caption |
| Upload UI | Input generico (qualquer arquivo, sem crop) |

## Schema Prisma

```prisma
model QuickReply {
  id            String   @id @default(uuid())
  companyId     String
  company       Company  @relation(fields: [companyId], references: [id])
  shortcut      String
  title         String
  body          String?  // passa a ser opcional
  mediaUrl      String?  // novo
  mediaMimeType String?  // novo
  mediaFileName String?  // novo
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  storesOutOfHours Store[] @relation("StoreOutOfHoursReply")
  storesGreeting   Store[] @relation("StoreGreetingReply")
  @@unique([companyId, shortcut])
  @@index([companyId])
}
```

Backend valida: ao menos um de `body` ou `mediaUrl` presente.

## Backend

### `POST /inbox/quick-replies` e `PUT /inbox/quick-replies/:id`

Ambos passam a aceitar `multipart/form-data` via multer memoryStorage (limit 25MB). Campos:
- `shortcut` (obrigatorio)
- `title` (obrigatorio)
- `body` (opcional se tem arquivo)
- `file` (arquivo opcional)
- `removeMedia` (PUT apenas) — remove anexo existente

Arquivo salvo em `public/uploads/quick-replies/{companyId}/{yyyy-mm}/{uuid}{ext}`.

No PUT: se `file` presente substitui (deleta antigo best-effort), se `removeMedia === 'true'` remove, senao mantem.

### Novo endpoint `POST /inbox/conversations/:id/send-quick-reply`

Body: `{ quickReplyId }`. Backend:
1. Verifica ownership da conversation E da quickReply
2. Monta payload baseado na presenca de `mediaUrl`
3. Se midia: `evoSendMediaUrl` com URL absoluta + caption do body
4. Se apenas texto: `evoSendText`
5. Persiste Message (type derivado do mime)
6. Emite `inbox:new-message` + `inbox:new-message:broadcast`

### `sendAutoReply` atualizado (webhookEvolution.js)

Recebe agora o objeto QuickReply inteiro (nao so o body). Se tem `mediaUrl`, envia como midia+caption, senao texto. Persiste Message com campos de midia quando presentes.

O `runAutomations` passa a selecionar tambem `mediaUrl, mediaMimeType, mediaFileName` no `store.outOfHoursReply`/`greetingReply`.

### Helper `detectMessageType(mime)`

Retorna `IMAGE | VIDEO | AUDIO | DOCUMENT` baseado no prefixo do mime.

## Frontend

### QuickReplies.vue

- Body textarea sem `required`
- Novo bloco de upload: input file generico aceitando `image/*,application/pdf,.doc,.docx,.xls,.xlsx,video/*,audio/*`
- Preview do arquivo selecionado OU do anexo existente (no edit) com botao "Remover"
- State extra no form: `existingMediaUrl`, `existingMediaFileName`, `removeMedia`
- Submit muda de JSON para FormData
- Validacao client: body ou anexo obrigatorios
- Max 25 MB

### Tabela de quick replies

Nova coluna indicador: icone paperclip quando `mediaUrl` presente, texto fallback "(apenas anexo)" se sem body.

### Store Pinia

`createQuickReply(payload)` e `updateQuickReply(id, payload)` detectam `payload instanceof FormData` e ajustam headers automaticamente.

Nova action `sendQuickReplyById(conversationId, quickReplyId)` chama o novo endpoint e aplica optimistic update via `handleNewMessage`.

### ChatInput.vue

- `sendQuickReply(reply)` usa `inboxStore.sendQuickReplyById` em vez de `sendMessage`
- Chip de quick reply mostra icone paperclip quando `reply.mediaUrl` existe
