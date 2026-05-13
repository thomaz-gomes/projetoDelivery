# Integração Meta — WhatsApp Cloud, Facebook Messenger e Instagram Direct — Design

**Data:** 2026-05-10
**Status:** Aprovado, pronto para plano de implementação

## Problema

O inbox de atendimento hoje só recebe WhatsApp via Evolution API. Precisamos adicionar três novos transports operando em paralelo na mesma tela de atendimento, com as mesmas automações (saudação, fora de horário, tagging por keyword) e vinculados a cardápios da mesma forma que o WhatsApp Evolution:

1. **WhatsApp via Meta Cloud API** (oficial)
2. **Facebook Messenger via Graph API**
3. **Instagram Direct via Graph API**

O WhatsApp via Evolution permanece funcionando em paralelo (alguns clientes continuam usando, alguns vão migrar, novos podem optar por qualquer um).

## Objetivo

Estender o sistema de mensageria para suportar 4 transports (Evolution WA, Meta WA, Meta FB, Meta IG) com:

- Adapter pattern: 1 arquivo por transport, interface comum, pipeline único de persistência/automação
- UI de inbox single-source: operador responde os 4 canais na mesma tela com badges visuais distintos
- OAuth (Facebook Login for Business) para conectar contas Meta
- Configuração do App Meta gerenciada pelo SUPER_ADMIN da SaaS (não env vars)
- Tabela polimórfica `MetaMessagingAccount` cobrindo WA/FB/IG da Meta
- Coexistência transparente: cardápio pode ter Evolution WA + Meta WA simultâneos

## Decisões já tomadas

| Decisão | Escolha |
|---|---|
| Conexão Meta | Graph API direta (sem provider terceiro) |
| Vínculo cardápio | 1 Page FB + 1 IG + 1 número WA Meta por cardápio (espelha modelo Evolution) |
| Automações em FB/IG | Saudação por horário + cliente cadastrado, fora de horário, tagging por keyword |
| Remind last order | Desabilitado em FB/IG (limitação 24h messaging window da Meta) |
| Credenciais Meta App | Painel SUPER_ADMIN (Settings table), não env vars |
| Arquitetura | Adapter pattern (Opção A) |
| Schema | Tabela única `MetaMessagingAccount` polimórfica (kind discrimina) |
| Coexistência WA | Permitida (Evolution + Meta Cloud no mesmo cardápio); outbound proativo prefere Meta Cloud |

## Modelo de dados

### Novo enum

```prisma
enum MessagingProvider {
  EVOLUTION_WA   // WhatsApp via Evolution API
  META_WA        // WhatsApp via Meta Cloud API
  META_FB        // Facebook Messenger via Graph API
  META_IG        // Instagram Direct via Graph API
}
```

### Nova tabela `MetaMessagingAccount`

```prisma
model MetaMessagingAccount {
  id                  String   @id @default(uuid())
  companyId           String
  kind                MessagingProvider  // META_WA | META_FB | META_IG
  externalId          String   // phoneNumberId | pageId | igUserId
  displayName         String?
  accessToken         String   // criptografado AES-256-GCM com CERT_STORE_KEY
  refreshToken        String?
  tokenExpiresAt      DateTime?
  wabaId              String?  // só p/ META_WA (WhatsApp Business Account ID)
  fbPageId            String?  // p/ META_IG, depende de Page vinculada
  webhookVerifyToken  String   // gerado por nós, configurado no painel Meta
  status              String   @default("ACTIVE")  // ACTIVE | DISCONNECTED | ERROR
  lastError           String?
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  company             Company  @relation(fields: [companyId], references: [id])
  menusAsMetaWa       Menu[]   @relation("MenuMetaWa")
  menusAsFb           Menu[]   @relation("MenuFb")
  menusAsIg           Menu[]   @relation("MenuIg")

  @@unique([companyId, kind, externalId])
  @@index([companyId])
}
```

### Mudanças em `Menu`

```prisma
model Menu {
  // ... campos existentes
  whatsappInstanceId    String?  // Evolution (mantido)
  metaWaAccountId       String?  // novo
  facebookAccountId     String?  // novo
  instagramAccountId    String?  // novo

  metaWaAccount         MetaMessagingAccount? @relation("MenuMetaWa", fields: [metaWaAccountId], references: [id])
  facebookAccount       MetaMessagingAccount? @relation("MenuFb", fields: [facebookAccountId], references: [id])
  instagramAccount      MetaMessagingAccount? @relation("MenuIg", fields: [instagramAccountId], references: [id])
}
```

### Mudanças em `Conversation`

```prisma
model Conversation {
  // ... campos existentes (channel, channelContactId, etc.)
  provider              MessagingProvider  // novo
  providerAccountId     String?            // FK lógica: WhatsAppInstance.id OU MetaMessagingAccount.id

  @@index([companyId, channel, provider])
}
```

**`providerAccountId` é FK lógica (sem `@relation`)** porque pode apontar para `WhatsAppInstance` (Evolution) ou `MetaMessagingAccount` (Meta). Resolvido em runtime via `provider`. Alternativa rejeitada de 2 colunas separadas evita duplicação e branches no código.

### Mudanças em `Customer`

```prisma
model Customer {
  // ... campos existentes (incluindo whatsapp)
  metaIdentities  Json?  // [{provider: 'META_FB'|'META_IG', externalId: 'PSID-ou-IG-id'}]
}
```

### Mudanças em `Settings`

Novas chaves (criptografar APP_SECRET):

```
META_APP_ID
META_APP_SECRET           ← AES-256-GCM com CERT_STORE_KEY
META_GRAPH_VERSION        ← default 'v21.0'
META_WEBHOOK_BASE_URL     ← ex: https://api.delivery.../webhook/meta
META_WEBHOOK_VERIFY_TOKEN ← gerado, usado no handshake
META_APP_REVIEW_STATUS    ← LIVE | DEVELOPMENT
```

### Mudanças em `QuickReply`

```prisma
model QuickReply {
  // ... campos existentes
  metaTemplateId  String?  // ID de template aprovado na Meta (necessário fora 24h em WA Cloud)
}
```

Campo existe; UI de criação/submissão de templates fica para fase 2.

## Arquitetura

### Diagrama

```
┌────────────────────────────────────────────────────────────────┐
│                    delivery-saas-backend                       │
│                                                                │
│  ┌──────────────┐    ┌──────────────────┐    ┌──────────────┐  │
│  │   Webhooks   │───▶│  MessagingRouter │───▶│ Adapter (4x) │  │
│  │              │    │                  │    │              │  │
│  │ /webhook/    │    │ - dispatch by    │    │ - parseIn    │  │
│  │   evolution  │    │   channel +      │    │ - sendOut    │  │
│  │ /webhook/    │    │   provider       │    │ - download   │  │
│  │   meta       │    │ - normalize      │    │   media      │  │
│  └──────────────┘    └────────┬─────────┘    └──────┬───────┘  │
│                               │                     │          │
│                               ▼                     ▼          │
│                     ┌──────────────────┐    ┌──────────────┐   │
│                     │ Conversation/    │    │ Provider API │   │
│                     │ Message persist  │    │ (Meta Graph) │   │
│                     │ +runAutomations()│    │ (Evolution)  │   │
│                     └────────┬─────────┘    └──────────────┘   │
│                              │                                 │
│                              ▼                                 │
│                     ┌──────────────────┐                       │
│                     │  Socket.IO emit  │──────▶ Frontend Inbox │
│                     │  inbox:new-msg   │                       │
│                     └──────────────────┘                       │
└────────────────────────────────────────────────────────────────┘
```

O adapter é o único lugar que conhece o formato de cada provider. Toda lógica downstream (persistência, automações, frontend) é channel-agnostic.

### Estrutura de arquivos backend

```
delivery-saas-backend/src/
├── messaging/
│   ├── adapters/
│   │   ├── base.adapter.js              ← interface + helpers
│   │   ├── whatsappEvolution.adapter.js ← refatorado de webhookEvolution.js
│   │   ├── whatsappMeta.adapter.js      ← novo
│   │   ├── facebook.adapter.js          ← novo
│   │   └── instagram.adapter.js         ← novo
│   ├── router.js                        ← dispatch por (channel, provider)
│   ├── inboundPipeline.js               ← persiste + automações + socket
│   └── crypto.js                        ← criptografa accessToken
└── routes/
    ├── webhookEvolution.js              ← reduzido a thin handler
    ├── webhookMeta.js                   ← novo (único endpoint Meta WA/FB/IG)
    ├── metaOauth.js                     ← OAuth callback + listar contas
    └── adminMetaConfig.js               ← config Meta App (SUPER_ADMIN)
```

### Interface do adapter

```js
{
  provider: 'EVOLUTION_WA' | 'META_WA' | 'META_FB' | 'META_IG',
  channel:  'WHATSAPP' | 'FACEBOOK' | 'INSTAGRAM',

  verifyWebhook(req, res),           // GET handshake (Meta exige)
  parseInbound(payload, account),    // → array de NormalizedMessage
  sendMessage(account, to, content), // content: { type, text?, mediaUrl?, mimeType? }
  sendMedia(account, to, mediaUrl, type, caption),
  resolveAccount(externalId),        // achar conta pelo ID do webhook
  downloadMedia(mediaId, account),
}
```

### Formato `NormalizedMessage`

```js
{
  externalId,          // ID original (dedup)
  channel,             // WHATSAPP | FACEBOOK | INSTAGRAM
  provider,            // EVOLUTION_WA | META_WA | META_FB | META_IG
  companyId,
  channelContactId,    // phone normalized | PSID | IG-scoped-user-id
  contactName,
  contactProfilePic,   // URL (Meta fornece, Evolution não)
  type,                // TEXT | IMAGE | AUDIO | VIDEO | DOCUMENT | LOCATION | STICKER
  body,
  mediaUrl,            // baixada para nosso storage (não URL temporária Meta)
  mimeType,
  timestamp,
  raw,                 // payload original para debug
}
```

### Webhook Meta (único endpoint `/webhook/meta`)

```
GET /webhook/meta — handshake
  query: hub.mode=subscribe, hub.verify_token, hub.challenge
  busca account por verifyToken, responde challenge

POST /webhook/meta
  Valida X-Hub-Signature-256 com APP_SECRET (gate de segurança)
  body.object → 'whatsapp_business_account' | 'page' | 'instagram'
  Discrimina provider e roteia para adapter correto
```

### Inbound pipeline

Reaproveita 90% da lógica de `webhookEvolution.js`:

1. Resolve `account` por external ID (ou já vem do webhook)
2. Para cada `NormalizedMessage`:
   - Busca/cria `Customer`:
     - WhatsApp: por phone matching (atual)
     - FB/IG: por `metaIdentities`, ou cria Customer minimal
   - Busca/cria `Conversation` por `(companyId, channel, channelContactId)`, com `provider` setado
   - Persiste `Message` com `externalId` (dedup)
   - Roda `runAutomations(conversation, message)`:
     - Greeting por horário (todos canais)
     - Out-of-hours (todos canais)
     - Greeting cliente cadastrado (todos canais, usa metaIdentities + pedidos do Customer linkado)
     - Keyword tagging (todos canais)
     - Remind last order: **skipa se channel ≠ WHATSAPP**
   - Emite `inbox:new-message` via Socket.IO

### Refatoração de `webhookEvolution.js`

Vira thin handler:

```js
router.post('/webhook/evolution', async (req, res) => {
  const account = await resolveEvolutionInstance(req.body.instance);
  await routeInbound('EVOLUTION_WA', req.body, account);
  res.sendStatus(200);
});
```

Toda lógica de parsing/persistência/automação sai dali, vai para adapter + pipeline. **Regressão zero é gate de merge.**

## OAuth e Onboarding

### Setup do dev (uma vez)

1. Criar App na Meta (produtos: WhatsApp, Messenger, Instagram)
2. Configurar Facebook Login for Business
3. Submeter App Review com escopos sensíveis:
   - `pages_messaging`, `pages_show_list`, `pages_manage_metadata`
   - `instagram_basic`, `instagram_manage_messages`
   - `whatsapp_business_messaging`, `whatsapp_business_management`
   - `business_management`

**Iniciar Review em paralelo ao desenvolvimento** (pode demorar 2-6 semanas).

### Fluxo do cliente

```
1. Configurações → "Integrações Meta" → "Conectar conta Meta"
2. Redirect para Facebook Login (popup ou redirect)
3. Cliente seleciona Business Account + concede permissões
4. Callback /auth/meta/callback?code=xxx&state=nonce
5. Backend valida state, troca code → short-lived → long-lived token (60d)
6. Backend lista:
   - GET /me/accounts → Páginas FB
   - GET /{page-id}?fields=instagram_business_account → IG vinculada
   - GET /{business-id}/owned_whatsapp_business_accounts → WABAs → phone_numbers
7. UI mostra lista com checkboxes; usuário escolhe quais conectar e a qual cardápio
8. Para cada selecionada: cria MetaMessagingAccount
9. Subscribe webhook: POST /{page-id}/subscribed_apps e POST /{phone-number-id}/register
```

### Refresh de token

Job diário (`scripts/cron/refreshMetaTokens.js`):
- Para cada conta com `tokenExpiresAt` < 7 dias: chama `fb_exchange_token`
- Se falhar: marca `status=DISCONNECTED`, notifica admin no UI

## Painel SUPER_ADMIN (Configuração Meta App)

### Tela `src/views/admin/MetaPlatformConfig.vue`

Visível só para `SUPER_ADMIN`. Campos:

- Meta App ID
- Meta App Secret (mascarado no GET, `***últimos 4`)
- Graph API Version (select)
- Webhook Base URL (com instrução "Cole no painel Meta App > Webhooks")
- Webhook Verify Token (com botão regenerar; `crypto.randomBytes(32)`)
- App Review Status (Development / Live; aviso quando Dev)
- Botão "Testar conexão" — chama `GET https://graph.facebook.com/{version}/{app-id}?access_token={app-id}|{app-secret}`

### Rotas

- `GET /admin/meta-config` (SUPER_ADMIN) — APP_SECRET mascarado
- `PUT /admin/meta-config` (SUPER_ADMIN) — salva criptografado
- `POST /admin/meta-config/test` (SUPER_ADMIN) — testa app access token
- `POST /admin/meta-config/regenerate-verify-token` (SUPER_ADMIN)

### Helper

`src/services/metaConfig.js`:

```js
export async function getMetaConfig() {
  // lê Settings, decripta APP_SECRET
  // throws MetaNotConfiguredError se faltar APP_ID/APP_SECRET
  return { appId, appSecret, graphVersion, webhookBaseUrl, ... }
}
```

Adapters Meta consomem via `getMetaConfig()`, não `process.env`. Se não configurado e cliente tentar conectar: UI mostra "Integração Meta indisponível — contate o suporte".

## Frontend (Inbox)

### `ConversationItem.vue` — badge de canal

```
┌─────────────────────────────────┐
│ [avatar] João Silva  🟢 [WA]    │
│ Quando vai chegar?    14:23 (3) │
└─────────────────────────────────┘
```

Cores (consistência com brand de cada canal):

| Canal | Cor | Ícone |
|---|---|---|
| WhatsApp (qualquer provider) | `#25D366` | ícone WA |
| Facebook | `#0084FF` | ícone Messenger |
| Instagram | gradient `#833AB4 → #FD1D1D → #FCB045` | ícone IG |

Tooltip em WA mostra `(Evolution)` ou `(Meta Cloud)`.

### `ConversationList.vue` — filtro por canal

Chips: Todos / WhatsApp / Facebook / Instagram. Reutiliza padrão dos filtros existentes (storeId, status, etc.).

### `ChatPanel.vue`

Header mostra ícone+nome do canal. **Banner janela 24h** quando `provider in [META_WA, META_FB, META_IG]` AND última inbound > 24h:

> "Janela de 24h expirada — Meta restringe envio livre. Use template aprovado."

Desabilita input livre. Botão alternativo: "Enviar template" (UI completa em fase 2).

### `ChatBubble.vue`

Sem mudanças. Mídia FB/IG vem normalizada como URL pelo adapter.

### Pinia store (`stores/inbox.js`)

Adicionar `channelFilter` ao state e às actions de fetch. Sem refator grande.

### Tela de Onboarding (clientes)

Nova view `src/views/settings/MetaIntegrations.vue` — botão "Conectar Meta", lista contas disponíveis após OAuth, dropdown para vincular cada uma a um cardápio. Warning explícito quando cardápio já tem Evolution WA e usuário ativa Meta WA também.

### Socket.IO

Sem mudanças. Eventos `inbox:new-message`, `inbox:message-status` já são channel-agnostic.

## Customer matching para FB/IG

Problema: PSID e IG-scoped-user-id são opacos, não casam com `Customer.whatsapp`.

Solução:
- Campo `Customer.metaIdentities Json?` armazena `[{provider, externalId}]`
- Primeiro inbound: cria Customer minimal com `fullName` do perfil Meta + `metaIdentities`
- Operador pode "linkar" Customer existente via ContactPanel (rota `link-customer` atualiza `metaIdentities`)
- Saudação cliente cadastrado em FB/IG: conta como cadastrado se Customer linkado tem ≥1 pedido CONCLUIDO

## Segurança

| Risco | Mitigação |
|---|---|
| App Secret vazado | AES-256-GCM com `CERT_STORE_KEY`. Mascarado no GET admin. |
| Access token vazado | Criptografado em rest. Logs nunca incluem token. |
| Webhook spoofing | Valida `X-Hub-Signature-256` com APP_SECRET em todos POSTs Meta. 403 se inválido. |
| Verify token adivinhável | `crypto.randomBytes(32)`. Botão regenerar no admin. |
| OAuth CSRF | `state` parameter com nonce assinado, validado no callback. |
| Cross-tenant leak | Toda query MetaMessagingAccount filtrada por `companyId` do `req.user`. |
| Token expirado | Job diário renova com 7 dias antecedência. UI mostra DISCONNECTED se falhar. |
| Outbound fora 24h em FB/IG | Adapter retorna `MetaWindowExpiredError`; UI exibe banner; Message marcada FAILED com motivo. |

## Migration plan

1. **Schema** — `prisma db push` em dev; em prod gerar SQL via `prisma migrate diff` e aplicar manualmente (CLAUDE.md alerta para drift)
2. **Adapter layer + refactor `webhookEvolution.js`** — isolado, sem features novas, testes verdes
3. **Backfill** — `scripts/backfill-conversation-provider.js`: seta `provider=EVOLUTION_WA` + `providerAccountId` em Conversations existentes. Idempotente.
4. **Settings + admin UI Meta Config** — pode merger antes das integrações
5. **Adapters Meta + webhook + OAuth** — sub-PRs por canal se ficar grande (META_WA → META_FB → META_IG)
6. **Frontend inbox (badges + filtro + banner 24h)** — paralelo às integrações

Rollback: cada fase é reversível. Colunas novas nullable não quebram código antigo.

## Testes

Backend (`delivery-saas-backend/tests/`), integração com DB real (sem mocks de DB, per CLAUDE.md):

| Arquivo | Cobertura |
|---|---|
| `messaging/router.test.js` | Dispatch por (channel, provider). Cria Conversation com provider. Dedupe externalId. |
| `messaging/inboundPipeline.test.js` | Customer matching (WA phone vs FB/IG metaIdentities). Automações. Skip remindLastOrder. |
| `messaging/adapters/whatsappEvolution.test.js` | Comportamento atual preservado. Fixtures de payloads reais. |
| `messaging/adapters/whatsappMeta.test.js` | Parse Cloud API. Verificação X-Hub-Signature-256. |
| `messaging/adapters/facebook.test.js` | Parse `entry[].messaging[]` (texto + attachments). |
| `messaging/adapters/instagram.test.js` | Parse IG. Story replies. |
| `routes/webhookMeta.test.js` | GET handshake. POST com signature inválida → 403. |
| `routes/metaOauth.test.js` | Token exchange (mock HTTP Meta com `nock`, DB real). |
| `routes/adminMetaConfig.test.js` | Auth SUPER_ADMIN. APP_SECRET mascarado. Cripto. |

Mocks permitidos: apenas HTTP externo (Meta Graph). DB sempre real.

Frontend: validação manual no browser (badges, filtro, banner 24h, tela admin).

Smoke test manual:
1. Configurar Meta no Admin
2. Conectar 1 Page FB de teste (Test User da Meta em modo dev)
3. Vincular ao cardápio
4. Mandar mensagem do Test User → aparece no Inbox com badge FB
5. Responder do operador → mensagem chega no Messenger
6. Disparar saudação por horário → reply automático

## Fora de escopo (YAGNI)

- ❌ UI de criação/submissão de templates Meta (campo `metaTemplateId` existe, UI fase 2)
- ❌ Remind last order (proativo) em FB/IG
- ❌ Telegram, Discord
- ❌ Provider terceiro Meta (Z-API/Wati)
- ❌ Compartilhamento de Page entre cardápios
- ❌ Reactions, polls, voz/vídeo
- ❌ Merge automático de conversas Evolution ↔ Meta WA mesmo número
- ❌ Métricas/analytics novos (relatórios atuais já são agnósticos a canal)
- ❌ Push mobile

## Riscos abertos

1. **App Review Meta (2-6 semanas)** — iniciar em paralelo ao dev. Sem aprovação, app fica em Development (só Test Users).
2. **Refator `webhookEvolution.js`** — risco de regressão. Mitigação: fixtures de 5-10 webhooks reais capturados de prod.
3. **Prisma migration drift** (CLAUDE.md) — `db push` em dev, SQL revisado manualmente em prod.

## Arquivos principais afetados

**Backend:**
- `prisma/schema.prisma` — novo enum + tabela + campos
- `src/messaging/` — pasta nova completa
- `src/routes/webhookEvolution.js` — refator
- `src/routes/webhookMeta.js` — novo
- `src/routes/metaOauth.js` — novo
- `src/routes/adminMetaConfig.js` — novo
- `src/services/metaConfig.js` — novo
- `src/services/notify.js` — ajustar `persistOutboundWhatsappMessage` para usar router
- `scripts/backfill-conversation-provider.js` — novo
- `scripts/cron/refreshMetaTokens.js` — novo
- `tests/messaging/**` — nova suite

**Frontend:**
- `src/views/inbox/Inbox.vue` — filtro canal
- `src/views/inbox/ConversationItem.vue` — badge canal
- `src/views/inbox/ConversationList.vue` — chips filtro
- `src/views/inbox/ChatPanel.vue` — header + banner 24h
- `src/views/settings/MetaIntegrations.vue` — novo (clientes)
- `src/views/admin/MetaPlatformConfig.vue` — novo (SUPER_ADMIN)
- `src/stores/inbox.js` — channelFilter
- `src/router.js` — novas rotas
