# Inbox — Painel de Contato & Pedido Embutido — Design

**Data:** 2026-04-06
**Status:** Aprovado

## Decisoes

| Decisao | Escolha |
|---|---|
| Painel de pedido | Reaproveitar POSOrderWizard inline (sem modal) |
| Largura painel direito | Fixo ~350px, toggle em telas <1400px |
| Auto-cadastro contato | Automatico no webhook (pushName + telefone) |
| Salvamento campos | Blur (campo a campo, sem botao salvar) |
| Estado carrinho | Pinia em memoria, mapa por conversationId |

## Layout — 4 Paineis

```
Sidebar | Lista Conversas (360px) | Chat (flex-grow) | Painel Contato (350px)
```

- Desktop >=1400px: 4 paineis visiveis
- Desktop 768-1399px: 3 paineis, toggle button para painel direito
- Mobile <768px: tela unica, navegacao push/pop

## Painel Contato — 3 Secoes

### Secao 1: Dados do Contato

Campos editaveis (blur save):
- `fullName` — editavel inline no topo
- `cpf` — input
- `email` — input
- `phone` — input secundario

Campos read-only:
- `whatsapp` — vem do channelContactId
- `createdAt` — data de cadastro
- `totalSpent` — total gasto acumulado
- Contagem de pedidos

Cada campo salva via `PATCH /inbox/customer/:id` no blur.

### Secao 2: Endereco

Campos editaveis (blur save):
- `street`, `number` — row lado a lado
- `neighborhood` — SelectInput com bairros + taxa de entrega
- `complement`, `reference`, `observation`

Lista de enderecos salvos clicavel (radio selection), preenche os campos.
Botao "+ Novo endereco" para criar endereco adicional.

Salva via:
- `PATCH /inbox/customer/:id/addresses/:addrId` — atualiza existente
- `POST /inbox/customer/:id/addresses` — cria novo

### Secao 3: Pedido

- Botao "Iniciar Pedido" quando nao ha draft
- Select tipo: BALCAO / DELIVERY
- POSOrderWizard renderizado inline com prop `embedded: true`
  - Pula steps 1 e 2 (cliente e endereco ja preenchidos)
  - Inicia no step de produtos
  - Recebe: customerId, customerName, address, orderType
- Ao finalizar: emite `@order-created`, limpa draft

## Auto-cadastro no Webhook

No `webhookEvolution.js`, ao processar MESSAGES_UPSERT inbound:

1. Busca Customer por (companyId, whatsapp: phone)
2. Se nao encontra: cria com `{ companyId, fullName: pushName || phone, whatsapp: phone }`
3. Vincula customerId na Conversation

Todo contato que manda mensagem tera Customer criado automaticamente.

## Novos Endpoints Backend

```
PATCH /inbox/customer/:id              — update parcial (fullName, cpf, email, phone)
PATCH /inbox/customer/:id/addresses/:addrId — update parcial endereco
POST  /inbox/customer/:id/addresses    — criar novo endereco
GET   /inbox/customer/:id              — dados completos com addresses e stats
```

Todos scoped por companyId via JWT.

## Estado por Conversa (Pinia)

Novo campo no inbox store:

```javascript
orderDrafts: {}  // { [conversationId]: { active, orderType, cart, step, ... } }
```

- Trocar conversa troca o draft (ou mostra "Iniciar Pedido")
- Carrinho persiste em memoria ao navegar entre conversas
- Finalizar pedido limpa o draft

## Novo Componente

```
views/inbox/
  ContactPanel.vue       — container das 3 secoes
  ContactInfo.vue        — secao 1: dados do contato (blur save)
  ContactAddress.vue     — secao 2: endereco (blur save + lista salvos)
  InboxOrderWizard.vue   — secao 3: wrapper do POSOrderWizard embedded
```

## Modificacoes em Componentes Existentes

- `Inbox.vue` — adicionar 4o painel (ContactPanel) com logica de toggle
- `POSOrderWizard.vue` — adicionar prop `embedded` que pula steps 1-2
- `ConversationHeader.vue` — remover botao "Novo Pedido" (agora no painel)
- `webhookEvolution.js` — auto-criar Customer no MESSAGES_UPSERT
- `inbox.js` store — adicionar orderDrafts, actions de customer update
