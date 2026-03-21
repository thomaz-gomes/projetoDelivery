# Design: Integração aiqfome

**Data:** 2026-03-20
**Abordagem:** Espelhamento do padrão iFood (Abordagem A)

## Decisões

- **Recebimento de pedidos:** Webhook (aiqfome envia para nós) — menor consumo de servidor
- **Escopo:** Completa — receber pedidos, atualizar status, sincronizar cardápio, gerenciar loja
- **OAuth:** Redirect OAuth clássico via ID Magalu (botão "Conectar" → redirect → callback)
- **Cardápio:** Push (nosso → aiqfome), preços NÃO são copiados (prevalecem os do aiqfome)
- **Modelo de dados:** Reusar `ApiIntegration` com `provider='AIQFOME'` (mesmo padrão iFood)

## API aiqfome V2

- **Base URLs:** Sandbox `https://plataforma.aiqfome.io` | Produção `https://plataforma.aiqfome.com`
- **OAuth:** `https://id.magalu.com/oauth/token` — authorization_code grant, token 7200s, refresh token
- **Scopes:** `aqf:order:read aqf:order:create aqf:store:read aqf:store:create aqf:menu:read aqf:menu:create`

## Seção 1: Schema & Modelo de Dados

### Mudanças no Prisma

- Adicionar `AIQFOME` ao enum `CustomerSource` (atual: `PUBLIC`, `IFOOD`, `MANUAL`)
- Criar model `AiqfomePaymentMapping`:
  - `id` (UUID), `integrationId` (FK → ApiIntegration), `aiqfomeCode` (String), `systemName` (String)
  - `@@unique([integrationId, aiqfomeCode])`

### Reutilização sem mudanças

- `ApiIntegration` — `provider='AIQFOME'`, campos OAuth existentes (clientId, clientSecret, accessToken, refreshToken, tokenExpiresAt). Campo `merchantId` armazena o `store_id` do aiqfome
- `WebhookEvent` — `provider='AIQFOME'`
- `Order` — `customerSource='AIQFOME'`, `externalId` = order ID aiqfome
- `OrderStatus` enum — sem mudanças

### Diferença do iFood

OAuth2 authorization_code via ID Magalu com `redirect_uri`, vs distributed auth do iFood. Campo `authMode='AUTH_CODE'`.

## Seção 2: Autenticação OAuth2 (ID Magalu)

### Novo módulo: `src/integrations/aiqfome/oauth.js`

**Fluxo:**

1. **Iniciar conexão** — `POST /integrations/aiqfome/link/start`
   - Gera URL: `https://id.magalu.com/oauth/authorize?client_id={}&redirect_uri={}&response_type=code&scope=...`
   - Retorna URL para frontend redirecionar lojista

2. **Callback** — `GET /integrations/aiqfome/callback`
   - Recebe `?code=XXX` do ID Magalu
   - Troca code por token: `POST https://id.magalu.com/oauth/token` (grant_type=authorization_code)
   - Salva accessToken, refreshToken, tokenExpiresAt (+7200s)
   - Redireciona lojista de volta ao painel

3. **Refresh automático** — `refreshAccessToken(integrationId)`
   - `POST https://id.magalu.com/oauth/token` (grant_type=refresh_token)
   - Auto-refresh quando token < 10s para expirar

4. **Helper** — `getAiqfomeAccessToken(integrationId)`
   - Verifica expiração e auto-refresha

**Env var:** `AIQFOME_REDIRECT_URI` (ex: `https://seudominio.com/api/integrations/aiqfome/callback`)

## Seção 3: Recebimento de Pedidos (Webhook)

### Novo módulo: `src/integrations/aiqfome/webhookProcessor.js`

**Fluxo:**

1. Após OAuth, backend registra webhook: `POST /api/v2/store/:store_id/webhooks`
2. Rota `POST /webhooks/aiqfome` recebe eventos
3. Persiste como `WebhookEvent` com `provider='AIQFOME'`
4. Processa via `processAiqfomeWebhook()`

### Mapeamento de payload

**Pedido:**

| Campo aiqfome | Campo local | Notas |
|---|---|---|
| `data.id` | `externalId` | ID numérico |
| `data.id` (curto) | `displayId`/`displaySimple` | Últimos dígitos |
| `data.created_at` | `createdAt` | `YYYY-MM-DD HH:MM:SS` |
| `data.is_pickup` | `orderType` | true→PICKUP, false→DELIVERY |
| `data.order_observations` | `payload.observations` | Obs do cliente |
| `data.is_scheduled` | `payload.isScheduled` | Agendado |
| `data.scheduled_dates` | `payload.scheduledDates` | Horário |
| `payment_method.total` | `total` | Total |
| `payment_method.delivery_tax` | `deliveryFee` | Entrega |
| `payment_method.coupon_value` | `couponDiscount` | Cupom |
| `payment_method.change` | `payload.payments[].troco` | Troco |
| `payment_method.name` | via `AiqfomePaymentMapping` | Pagamento |

**Cliente:**

| Campo aiqfome | Campo local |
|---|---|
| `user.name` + `user.surname` | `customerName` |
| `user.mobile_phone` / `user.phone_number` | `customerPhone` |
| `user.email` | customer.email |
| `user.document_receipt` | customer.document |
| `user.address.*` | `address` (formatado), `latitude`, `longitude`, `deliveryNeighborhood` |

**Items:**

| Campo aiqfome | Campo local |
|---|---|
| `item.name` | `name` |
| `item.quantity` | `qty` |
| `item.unit_value` | `unitPrice` |
| `item.sku` | Para `matchItemsToLocalProducts()` |
| `item.observations` | `options` (JSON) |
| `item.order_mandatory_items` | `options` (JSON) — complementos obrigatórios |
| `item.order_additional_items` | `options` (JSON) — adicionais |
| `item.order_item_subitems` | `options` (JSON) — subitems |
| `item.unit_packing_fee` | `payload.packingFee` |

**Status flags → OrderStatus:**

| Flags aiqfome | Status local |
|---|---|
| `is_read=false, is_cancelled=false` | `PENDENTE_ACEITE` |
| `is_read=true` | `EM_PREPARO` |
| `is_in_separation=true` | `EM_PREPARO` |
| `is_ready=true` | `PRONTO` |
| `is_delivered=true` | `CONCLUIDO` |
| `is_cancelled=true` | `CANCELADO` |

### Emissão — reutiliza infra existente

- `emitirNovoPedido(order)` → dashboard + print agents
- `enrichOrderForAgent()` → impressão automática
- `emitirPedidoAtualizado()` → mudanças de status

## Seção 4: Atualização de Status (nosso → aiqfome)

### Novo módulo: `src/integrations/aiqfome/orders.js`

| Status local | Endpoint aiqfome | Método |
|---|---|---|
| `EM_PREPARO` | `POST /api/v2/orders/mark-as-read` | Aceitar |
| `EM_PREPARO` (separação) | `PUT /api/v2/orders/:order/in-separation` | Separação |
| `PRONTO` | `PUT /api/v2/orders/:order/ready` | Pronto |
| `CONCLUIDO` | `PUT /api/v2/orders/:order/delivered` | Entregue |
| `CANCELADO` | Cancel endpoint | Cancelar |

### Logística (aiqentrega)

| Evento | Endpoint |
|---|---|
| Entregador a caminho | `POST /api/v2/logistic/:order_id/pickup-ongoing` |
| Chegou na loja | `POST /api/v2/logistic/:order_id/arrived-at-merchant` |
| Saiu para entrega | `POST /api/v2/logistic/:order_id/delivery-ongoing` |
| Chegou no cliente | `POST /api/v2/logistic/:order_id/arrived-at-customer` |
| Entregue | `POST /api/v2/logistic/:order_id/order-delivered` |

**Implementação:** Hook em `POST /orders/:id/status`. Verifica `customerSource='AIQFOME'` e chama `updateAiqfomeOrderStatus()`.

### HTTP Client: `src/integrations/aiqfome/client.js`

- Base URL configurável (sandbox/produção)
- Bearer token via `getAiqfomeAccessToken()`
- Rate limit handling (429 + backoff)
- Helpers: `aiqfomeGet()`, `aiqfomePost()`, `aiqfomePut()`

## Seção 5: Sincronização de Cardápio (nosso → aiqfome)

### Novo módulo: `src/integrations/aiqfome/menu.js`

**Direção:** Push (nosso → aiqfome). **Preços NÃO são copiados** — prevalecem os configurados no aiqfome.

### Entidades

| Nosso sistema | API aiqfome | Direção |
|---|---|---|
| Categoria | Category management | Push (sem preço) |
| Produto | Item management | Push (sem preço) |
| Opcionais | Item complements | Push (sem preço) |
| Disponibilidade | Item daily sales | Push |

### Fluxo

1. **Sync inicial** — Exporta cardápio completo ao ativar integração. Guarda IDs remotos em `integrationCode`.
2. **Sync incremental** — Hook no CRUD do menu. Detecta integração ativa e envia mudança.
3. **Sync de disponibilidade** — Pausar/ativar item localmente → reflete no aiqfome.

**Limitação por design:** Edições no painel aiqfome não refletem no nosso sistema (nosso cardápio é master para estrutura).

## Seção 6: Frontend — Painel de Configuração

### Componente: `AiqfomeConfig.vue`

1. **Conexão OAuth:** Botão "Conectar aiqfome" → redirect ID Magalu → callback → status "Conectado"
2. **Config por loja:** Select store local, toggles autoAccept e enabled
3. **Mapeamento pagamentos:** Tabela código aiqfome ↔ nome sistema
4. **Sync cardápio:** Botão sync manual, toggle sync automático, status último sync
5. **Webhook:** Status, URL readonly, botão reconfigurar

**Rota:** `/settings/integrations/aiqfome`

## Seção 7: Gestão de Loja

| Ação local | Endpoint aiqfome |
|---|---|
| Abrir loja | `POST /api/v2/store/:store_id/open` |
| Fechar loja | `POST /api/v2/store/:store_id/close` |
| Standby | `PUT /api/v2/store/:store_id/stand-by` |
| Tempo preparo | `PUT /api/v2/store/:store_id/preparation-time` |
| Tempo entrega | `PUT /api/v2/store/:store_id/delivery-time` |

**Implementação:** Hook nas rotas de store management. Falha silenciosa com log.

## Arquivos Novos

```
delivery-saas-backend/src/integrations/aiqfome/
  oauth.js          — OAuth2 ID Magalu
  client.js         — HTTP client com rate limiting
  orders.js         — Status updates nosso → aiqfome
  menu.js           — Sync de cardápio push
  webhookProcessor.js — Processamento de pedidos recebidos

delivery-saas-frontend/src/components/
  AiqfomeConfig.vue — Painel de configuração
```

## Arquivos Modificados

```
delivery-saas-backend/prisma/schema.prisma          — CustomerSource enum, AiqfomePaymentMapping
delivery-saas-backend/src/routes/integrations.js     — Rotas OAuth + config aiqfome
delivery-saas-backend/src/routes/webhooks.js         — Handler POST /webhooks/aiqfome
delivery-saas-backend/src/routes/orders.js           — Hook status → updateAiqfomeOrderStatus
delivery-saas-backend/src/routes/stores.js           — Hook abrir/fechar → sync aiqfome
delivery-saas-backend/src/routes/menu.js             — Hook CRUD → sync cardápio
delivery-saas-frontend/src/router/index.js           — Rota /settings/integrations/aiqfome
delivery-saas-frontend/src/views/Settings.vue        — Link para config aiqfome
```
