# Integração Meta — Guia de operação

Esta integração adiciona 3 novos transports ao inbox (Facebook Messenger, Instagram Direct, WhatsApp via API oficial Meta Cloud) operando em paralelo ao WhatsApp Evolution existente.

Design completo: `docs/plans/2026-05-10-meta-messaging-integration-design.md`
Plano de implementação: `docs/plans/2026-05-10-meta-messaging-integration-plan.md`

---

## Setup inicial (SUPER_ADMIN, uma vez por plataforma)

### 1. Criar Meta App

1. Acessar developers.facebook.com → My Apps → Create App
2. Tipo: Business
3. Adicionar produtos: WhatsApp, Messenger, Instagram
4. Configurar Facebook Login for Business

### 2. Submeter App Review

Escopos sensíveis que exigem aprovação:
- `pages_messaging`, `pages_show_list`, `pages_manage_metadata`
- `instagram_basic`, `instagram_manage_messages`
- `whatsapp_business_messaging`, `whatsapp_business_management`
- `business_management`

Tempo típico: 2 a 6 semanas. **Iniciar review em paralelo ao desenvolvimento.** Sem aprovação, app fica em "Development" e só Test Users do app conseguem testar.

### 3. Configurar credenciais no painel SUPER_ADMIN

Login como SUPER_ADMIN → `/saas/meta-config` → preencher:

| Campo | Onde achar |
|---|---|
| Meta App ID | App Dashboard > Settings > Basic |
| Meta App Secret | App Dashboard > Settings > Basic (Show) |
| Graph API Version | Usar `v21.0` (default) |
| Webhook Base URL | `https://<seu-dominio>/webhook/meta` |
| Webhook Verify Token | Clicar "Gerar novo" — copiar valor |
| App Review Status | `Development` durante desenvolvimento, `Live` em produção |

Clicar "Salvar" e depois "Testar conexão" — deve retornar info do app.

### 4. Configurar webhooks no Meta App

No Meta App Dashboard:
- **Messenger**: Settings > Webhooks > Subscribe to Page (URL: `<base>/webhook/meta`, Verify Token: o que você gerou). Subscribe fields: `messages`, `messaging_postbacks`.
- **Instagram**: idem (subscribe fields: `messages`).
- **WhatsApp**: Configuration > Webhooks > Edit (URL: `<base>/webhook/meta`, Verify Token idem). Subscribe field: `messages`.

A URL é a mesma para os 3 produtos — o backend distingue pelo campo `object` do payload.

### 5. Configurar variáveis de ambiente do servidor

```
CERT_STORE_KEY=<chave de 64 hex chars>  # criptografa Meta App Secret + access tokens
DATABASE_URL=...                          # PostgreSQL
```

### 6. Agendar cron de refresh de tokens

Adicionar no crontab do host:
```
15 3 * * * cd /opt/delivery/delivery-saas-backend && node scripts/cron/refreshMetaTokens.js >> /var/log/delivery/refresh-meta-tokens.log 2>&1
```

Renova tokens com 7 dias de antecedência. Sem isso, contas Meta ficam DISCONNECTED após 60 dias.

---

## Como o cliente conecta sua conta Meta

1. Cliente loga como ADMIN/SUPER_ADMIN da empresa.
2. Navega a `Configurações > Integrações Meta` (`/settings/meta-integrations`).
3. Clica "Conectar Meta" → redireciona para Facebook Login.
4. Após autorização, o callback retorna para `/settings/meta-integrations?temp=xxx`.
5. UI mostra checkboxes para cada conta disponível (Páginas FB, IG Business, números WhatsApp Business).
6. Cliente marca quais conectar + escolhe o cardápio (`Menu`) onde cada conta vai operar.
7. Clica "Conectar selecionadas" → backend persiste contas + assina webhook.

**Coexistência WhatsApp:** se um cardápio já tem Evolution WA e cliente liga Meta WA também, mensagens novas chegam pelos dois. Outbound proativo prefere Meta Cloud (oficial).

---

## Limitações da janela de 24h (Meta)

Meta restringe envios fora da janela de 24h após última mensagem do cliente:
- Dentro: mensagem livre liberada.
- Fora: só "message templates" pré-aprovados pela Meta.

O inbox detecta isso e mostra banner amarelo + desabilita input livre. UI de templates aprovados é Fase 2 (campo `QuickReply.metaTemplateId` existe, criação via Meta Business Manager).

**Automações de WhatsApp que NÃO funcionam em FB/IG:**
- Lembrar último pedido (proativo após 6h sem msg) — exige janela aberta, foi desabilitado por design para canais Meta.

---

## WA Evolution vs WA Meta Cloud — diferenças

| Aspecto | Evolution API | Meta Cloud API |
|---|---|---|
| Custo | Servidor próprio + Baileys + ~R$30-50/mês manutenção | Pago por conversa (~$0.005-0.05 dependendo do país) |
| Estabilidade | Quebra quando WhatsApp atualiza protocolo | Oficial, alta disponibilidade |
| Recursos | Chamadas, status, todas mensagens | TEXT/IMAGE/AUDIO/VIDEO/DOCUMENT/STICKER/LOCATION/INTERACTIVE |
| Aprovação | Sem revisão | Exige App Review da Meta (2-6 semanas) |
| Janela 24h | Não se aplica | Aplica |
| Templates | Não | Sim (aprovados pela Meta) |
| Outbound proativo | Livre | Só com template aprovado fora 24h |
| Banimento | Risco alto se mal usado | Risco zero se respeitar políticas |

**Recomendação:** Meta Cloud para clientes maiores e operação séria. Evolution para clientes pequenos / dev / nichos onde custo importa mais que estabilidade.

---

## Troubleshooting

### Conta Meta aparece como DISCONNECTED

Causas comuns:
1. **Token expirou** (60 dias sem refresh) — cron de refresh não rodou. Solução: rodar `scripts/cron/refreshMetaTokens.js` manualmente, ou cliente reconecta via `/settings/meta-integrations`.
2. **Cliente revogou app no Facebook** — cliente precisa reconectar.
3. **Permissão removida pela Meta** — checar `MetaMessagingAccount.lastError` no banco para detalhes.

### Webhook Meta retorna 403

Causas:
1. `X-Hub-Signature-256` mismatch — App Secret no painel SUPER_ADMIN diferente do App Secret da Meta. Atualizar no painel.
2. Verify token mismatch no handshake — clicar "Gerar novo" no painel + atualizar no Meta App Dashboard.

### Mensagens chegando mas não aparecem no inbox

1. Conferir se `MetaMessagingAccount` correspondente existe e está `ACTIVE`.
2. Conferir se está vinculado a um Menu (`Menu.metaWaAccountId` / `facebookAccountId` / `instagramAccountId`).
3. Conferir `lastError` na conta — pode indicar problema no parse do webhook.
4. Logs: `docker compose logs backend | grep webhook/meta` para ver o que chegou.

### Operador não consegue responder em FB/IG

Causas comuns:
1. Conversa fora da janela 24h (banner amarelo aparece) — aguardar nova mensagem do cliente ou usar template aprovado.
2. Conta Meta com `status=DISCONNECTED` — reconectar.

### Customer aparece duplicado em FB/IG

`Customer.metaIdentities` linka PSID/IGSID a um cliente já cadastrado. Se o operador não fez o link manual, o sistema cria Customer minimal a cada primeira mensagem.

Solução: ContactPanel → "Vincular cliente existente" → escolher o real. Sistema adiciona entrada em `metaIdentities` (idempotente).

---

## Smoke E2E checklist (validação manual após App Review aprovado)

Use após Meta App estiver em "Live" e ao menos 1 conta de teste estiver conectada.

### Setup verificação

- [ ] Login como SUPER_ADMIN → `/saas/meta-config` → todos campos preenchidos
- [ ] "Testar conexão" retorna OK
- [ ] Como ADMIN de empresa de teste, conectar conta Meta via OAuth (Test User da Meta em modo Development)
- [ ] Vincular 1 Page FB + 1 IG + 1 número WA Cloud a 1 cardápio

### WhatsApp Evolution (regressão zero)

- [ ] Mensagem inbound aparece no inbox com badge WA (tooltip "Evolution")
- [ ] Operador responde — chega no WA do cliente
- [ ] Saudação por horário dispara automaticamente
- [ ] Out-of-hours dispara fora do horário do cardápio
- [ ] Tagging por keyword tagueia conversa
- [ ] Cliente cadastrado (≥1 pedido CONCLUIDO) recebe greeting diferenciado + botão "Repetir pedido"
- [ ] Tap em "Repetir pedido" gera magic-link e responde
- [ ] Operador digita resposta no Evolution admin UI — echo aparece no inbox

### WhatsApp Meta Cloud

- [ ] Mensagem inbound do Test User aparece no inbox com badge WA + tooltip "Meta Cloud"
- [ ] Imagens/áudios baixados via Bearer token, aparecem nas mensagens
- [ ] Operador responde — chega no WA do Test User
- [ ] Saudação por horário dispara
- [ ] Out-of-hours dispara
- [ ] Tagging por keyword funciona
- [ ] Banner janela 24h NÃO aparece (cliente acabou de mandar mensagem)
- [ ] Aguardar 24h (ou mockar `lastInboundAt`) — banner aparece + input desabilitado
- [ ] Tentar enviar via API fora janela → backend retorna `MetaWindowExpiredError`

### Facebook Messenger

- [ ] Mensagem inbound do Test User aparece com badge FB (cor azul)
- [ ] Imagens/anexos visíveis (URLs CDN, sem auth)
- [ ] Operador responde — chega no Messenger
- [ ] Postback com `reorder:<orderId>` → magic-link
- [ ] Skip de `is_echo: true` funcionando (mensagens enviadas pela Page não aparecem como inbound)

### Instagram Direct

- [ ] Mensagem inbound aparece com badge IG (gradient)
- [ ] Story reply: body prefixado com `[Story reply]`
- [ ] Story mention: type=IMAGE, body `[Story mention]`
- [ ] Shared post: tratado como IMAGE
- [ ] Operador responde — chega no IG do Test User

### Filtro + UI

- [ ] Filtro "WhatsApp" oculta FB/IG conversas
- [ ] Filtro "Messenger" mostra só FB
- [ ] Filtro "Instagram" mostra só IG
- [ ] Filtro "Todos" volta ao normal

### Customer matching FB/IG

- [ ] Mensagem inbound nova de PSID/IGSID desconhecido cria Customer minimal
- [ ] ContactPanel → "Vincular cliente existente" → escolher cliente real
- [ ] Verificar `Customer.metaIdentities` no banco contém `{provider, externalId}` correto
- [ ] Nova mensagem do mesmo PSID/IGSID encontra o Customer existente (não cria duplicata)

### Token refresh cron

- [ ] Setar `tokenExpiresAt` de uma conta para 5 dias no futuro
- [ ] Rodar `node scripts/cron/refreshMetaTokens.js`
- [ ] Verificar `tokenExpiresAt` atualizado para ~60 dias no futuro
- [ ] Setar `tokenExpiresAt` para passado + decryptable token → cron marca `status=DISCONNECTED` com lastError

### Segurança

- [ ] Acesso a `/saas/meta-config` como ADMIN (não SUPER_ADMIN) → 403
- [ ] Acesso a `/settings/meta-integrations` como RIDER → bloqueado
- [ ] `POST /webhook/meta` com `X-Hub-Signature-256` inválida → 403
- [ ] `GET /webhook/meta?hub.verify_token=ERRADO` → 403
- [ ] OAuth `state` parameter validado no callback (não aceita state inválido)
