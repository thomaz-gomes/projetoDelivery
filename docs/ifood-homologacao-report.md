# Relatorio de Homologacao iFood - Delivery SaaS

Data: 2026-03-06

## Resumo

| Status | Quantidade |
|--------|-----------|
| OK | 14 |
| PARCIAL (precisa ajuste) | 3 |
| NAO IMPLEMENTADO | 3 |
| **Total criterios** | **20** |

---

## Criterios Obrigatorios

### V1: Polling a cada 30s + header x-polling-merchants
**Status: OK**

- `ifoodPoller.js:6` — Intervalo configurado em 30000ms (30s) conforme spec
- `client.js:42-57` — Header `x-polling-merchants` enviado com formatacao inteligente (numeric array, UUID CSV, JSON array) + fallbacks automaticos
- Polling roda como worker separado com concorrencia configuravel (max 3 empresas simultaneas)

**Arquivos:** `src/workers/ifoodPoller.js`, `src/integrations/ifood/client.js`

---

### V2: Acknowledgment para todos os eventos recebidos
**Status: OK**

- `client.js:160-192` — `ifoodAck()` envia POST `/order/v1.0/events/acknowledgment` com array de event IDs
- ACK e feito imediatamente apos processamento de cada ciclo de polling
- Webhook events sao persistidos em `WebhookEvent` e marcados como PROCESSED

**Arquivos:** `src/integrations/ifood/client.js`, `src/services/ifoodWebhookProcessor.js`

---

### V3: Receber, confirmar e despachar pedido DELIVERY/IMMEDIATE
**Status: OK**

- Webhook e polling criam pedidos com status `EM_PREPARO`
- Pipeline de status: `EM_PREPARO` -> `SAIU_PARA_ENTREGA` -> `CONFIRMACAO_PAGAMENTO` -> `CONCLUIDO`
- Ao atribuir motoboy (assign/claim), backend notifica iFood via endpoint `/orders/{id}/dispatch`
- Action endpoints mapeados: `confirm`, `dispatch`, `startPreparation`, `readyToPickup`, `requestCancellation`

**Arquivos:** `src/routes/orders.js`, `src/routes/tickets.js`, `src/integrations/ifood/orders.js`

---

### V4: Receber, confirmar e despachar pedido DELIVERY/SCHEDULED com data/hora
**Status: OK**

- Frontend extrai `orderTiming === 'SCHEDULED'` do payload
- Exibe banner amarelo "Pedido Agendado" com data e hora formatadas
- Campos extraidos: `scheduledDateTimeStart`, `scheduledDeliveryDateTime`

**Arquivo:** `Orders.vue:958-963` (extracao), `Orders.vue:3081-3084` (exibicao)

---

### V5: Cancelar pedido com consulta a /cancellationReasons
**Status: OK**

- Backend endpoint: `GET /integrations/ifood/orders/:id/cancellationReasons` consulta API iFood em tempo real
- Frontend carrega motivos dinamicamente e exibe `<select>` para o usuario escolher
- Fallback local com codigos 501-512 em `cancellationCodes.js`
- Cancellation code e enviado junto com a request de cancelamento

**Arquivos:** `src/routes/integrations.js:277-290`, `Orders.vue:2111-2164`, `src/integrations/ifood/cancellationCodes.js`

---

### V6: Receber, confirmar e avisar pronto pedido TAKEOUT (Pra Retirar)
**Status: PARCIAL — PRECISA AJUSTE**

**O que funciona:**
- Backend mapeia `READY_TO_PICKUP` -> `PRONTO` para pedidos TAKEOUT (`ifoodWebhookProcessor.js:210-213`)
- Action endpoint `readyToPickup` existe no mapeamento (`orders.js:136`)

**O que falta:**
1. **State machine nao permite EM_PREPARO -> PRONTO**: Em `stateMachine.js`, `EM_PREPARO` so pode ir para `SAIU_PARA_ENTREGA` ou `CANCELADO`. Precisa adicionar `PRONTO` como transicao valida.
2. **Frontend nao tem botao "Pronto para Retirada"**: Nao ha UI especifica para pedidos TAKEOUT. O operador precisa de um botao que chame `readyToPickup` no iFood.
3. **Frontend nao filtra/identifica pedidos TAKEOUT**: Nao ha badge ou indicador visual diferenciando TAKEOUT de DELIVERY.

**Correcoes necessarias:**
- `stateMachine.js`: Adicionar `'PRONTO'` ao array de `EM_PREPARO`
- `Orders.vue`: Adicionar botao "Pronto para Retirada" visivel apenas para pedidos com `orderType === 'TAKEOUT'`
- Backend: Ao clicar "Pronto", chamar `updateIFoodOrderStatus(companyId, externalId, 'READY_TO_PICKUP')`

---

### V7: Exibir detalhes pagamento cartao (bandeira)
**Status: OK**

- `Orders.vue:734` — Exibe `m.method + (m.card.brand)` (ex: "CREDIT (VISA)")
- `Orders.vue:772` — Mapeia multiplos metodos de pagamento com bandeira
- Exibido tanto no card do pedido quanto nos detalhes

---

### V8: Exibir troco para pagamento em dinheiro
**Status: OK**

- Backend extrai `changeFor` de multiplas posicoes do payload (`ifoodWebhookProcessor.js:153-172`)
- Persiste em `payload._extractedPayment` e `payload.payment`
- Frontend extrai de `payments.methods[].changeFor` para metodo CASH (`Orders.vue:791-810`)
- Exibido no card: "Troco: R$ XX,XX" e na secao de pagamento dos detalhes

---

### V9: Exibir cupons de desconto com valor e responsavel (iFood/Loja)
**Status: OK**

- `Orders.vue:976-991` — Extrai `couponSponsor` de `benefits`/`discounts` com `sponsorshipValues`
- Identifica corretamente "iFood", "Loja" ou "iFood + Loja"
- `Orders.vue:3154-3158` — Exibe valor do desconto com responsavel entre parenteses

---

### V10: Exibir observacoes dos itens na tela e/ou comanda impressa
**Status: OK**

- **Tela:** `Orders.vue:3129-3130` — Exibe `it.notes || it.observations` para cada item
- **Comanda:** `defaultTemplate.js:73-75` — Template inclui `{{#if notes}} OBS: {{notes}} {{/if}}` por item
- Backend mapeia `it.observations` para `notes` no `mapIFoodOrder`

---

### V11: Atualizar status de pedido cancelado pelo cliente ou pelo iFood
**Status: OK**

- `ifoodWebhookProcessor.js:217` — Mapeia `CANCELLED`/`CANCEL`/`CAN` -> `CANCELADO`
- State machine permite cancelamento de qualquer estado ativo
- `emitirPedidoAtualizado` notifica frontend em tempo real via Socket.IO
- Frontend atualiza a lista de pedidos automaticamente

---

### V12: Atualizar status de pedido confirmado/cancelado por outro aplicativo
**Status: OK**

- Polling e webhook processam eventos de qualquer origem (Gestor de Pedidos, outro PDV, etc.)
- `upsertOrder` em `ifoodWebhookProcessor.js` verifica `canTransition` antes de aplicar mudanca
- `OrderHistory` registra cada transicao com motivo
- Socket.IO emite atualizacao para todos os clientes conectados

---

### V13: Descartar eventos duplicados no polling
**Status: OK**

- `ifoodWebhookProcessor.js:409-425` — Verifica se ja existe pedido com mesmo `externalId` antes de processar evento PLACED
- `webhooks.js:239-243` — `WebhookEvent.upsert` com `eventId` como chave unica
- `Order.upsert` com `externalId` como chave unica previne duplicatas no banco

---

### V14: Informar CPF/CNPJ na tela caso obrigatorio
**Status: OK**

- `Orders.vue:966-968` — Extrai `documentNumber` do payload do cliente
- `Orders.vue:3105-3108` — Exibe secao "CPF/CNPJ do Cliente" nos detalhes do pedido

**Observacao:** Nao ha preenchimento automatico no documento fiscal (NFC-e). Se a loja emite NFC-e, o CPF deve ser propagado para o modulo fiscal.

---

### V15: Processar eventos da Plataforma de Negociacao de Pedidos
**Status: NAO IMPLEMENTADO**

A Plataforma de Negociacao do iFood (eventos como `CONSUMER_CANCELLATION_REQUESTED`, `DISPUTE`) nao esta implementada. O app nao:
- Recebe eventos de negociacao
- Exibe UI para aceitar/rejeitar cancelamento do consumidor
- Chama endpoints de resposta da negociacao (`/orders/{id}/cancellationDisputeResponse`, etc.)

**Correcao necessaria:**
1. Mapear eventos de negociacao no `determineStatusFromIFoodEvent`
2. Criar UI no frontend para o operador responder (aceitar ou rejeitar cancelamento)
3. Implementar endpoints de resposta na API

---

### V16: Exibir codigo de coleta do pedido
**Status: OK**

- **Tela:** `Orders.vue:953-955` extrai `pickupCode`, `Orders.vue:3100-3102` exibe com fonte monospace grande
- **Comanda:** `defaultTemplate.js:62-64` — Template imprime `Cod. Coleta: {{codigo_coleta}}`
- `templateEngine.js:258` — Extrai `ifoodPayload.delivery?.pickupCode`

---

### V17: Renovar token somente quando prestes a expirar
**Status: OK**

- `oauth.js:226` — Verifica `Date.now() > exp - 10_000` (10 segundos antes de expirar)
- So chama `refreshAccessToken` quando necessario
- Token nao e renovado a cada request; e cacheado no banco (`tokenExpiresAt`)

---

### V18: Respeitar rate limit dos endpoints
**Status: NAO IMPLEMENTADO**

Nenhum tratamento de rate limit encontrado:
- Nao ha interceptor axios para tratar HTTP 429
- Nao ha leitura do header `Retry-After`
- Nao ha backoff/retry em caso de rate limit
- Nao ha controle de requests por segundo

**Correcao necessaria:**
1. Adicionar interceptor axios no `client.js` que detecte HTTP 429 e faca retry com `Retry-After`
2. Implementar backoff exponencial para todas as chamadas a API iFood

---

## Criterios Desejaveis

### V19: Comanda impressa seguir modelo sugerido pela documentacao
**Status: OK**

- `defaultTemplate.js` segue estrutura similar ao modelo iFood:
  - Cabecalho com nome do estabelecimento
  - Numero do pedido em destaque
  - Dados do cliente e endereco
  - Lista de itens com quantidade, descricao e preco
  - Observacoes por item
  - Subtotal, taxa de entrega, desconto, total
  - Formas de pagamento
  - QR code para rastreamento

---

### V20: Exibir delivery.observations na tela e/ou comanda impressa
**Status: PARCIAL**

- **Tela: OK** — `Orders.vue:971-973` extrai `delivery.observations`, `Orders.vue:3094-3095` exibe com icone "Obs. entrega:"
- **Comanda: FALTA** — O template de impressao NAO inclui `delivery.observations`. O campo `{{observacoes}}` refere-se a observacoes gerais do pedido, nao as da entrega especificamente.

**Correcao necessaria:**
- Adicionar placeholder `{{obs_entrega}}` no `defaultTemplate.js`
- Mapear `delivery.observations` para esse placeholder no `templateEngine.js`

---

## Resumo de Acoes Necessarias

### Prioridade ALTA (bloqueante para homologacao)

| # | Acao | Arquivos |
|---|------|----------|
| 1 | Implementar fluxo TAKEOUT completo (state machine + botao "Pronto para Retirada" + notificar iFood) | `stateMachine.js`, `Orders.vue`, `orders.js` |
| 2 | Implementar Plataforma de Negociacao (receber eventos, UI de resposta, endpoints) | `ifoodWebhookProcessor.js`, `Orders.vue`, `integrations.js` |
| 3 | Implementar tratamento de rate limit (interceptor 429 + retry com backoff) | `client.js`, `orders.js` |

### Prioridade MEDIA (pode ser questionado na homologacao)

| # | Acao | Arquivos |
|---|------|----------|
| 4 | Propagar CPF/CNPJ automaticamente para documento fiscal (NFC-e) | `nfe.js` |
| 5 | Adicionar `delivery.observations` na comanda impressa | `defaultTemplate.js`, `templateEngine.js` |

### Prioridade BAIXA (melhorias)

| # | Acao | Arquivos |
|---|------|----------|
| 6 | Adicionar badge visual diferenciando TAKEOUT de DELIVERY na lista de pedidos | `Orders.vue` |
| 7 | Exibir troco na comanda impressa (placeholder `{{troco}}`) | `defaultTemplate.js`, `templateEngine.js` |
