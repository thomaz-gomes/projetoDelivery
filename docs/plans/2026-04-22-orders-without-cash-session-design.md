# Design: Pedidos sem caixa aberto — acumular fora do kanban

**Data:** 2026-04-22

## Problema

Quando nao ha caixa aberto, os pedidos entram normalmente mas o operador nao percebe que deveria abrir o caixa. Pedidos concluidos sem sessao ficam com `outOfSession: true` mas isso so e marcado na conclusao — tarde demais.

## Decisoes

1. Pedidos novos que chegam sem caixa aberto ficam **fora do kanban**, numa caixa visual de alerta (estilo `PENDENTE_ACEITE`)
2. Ao abrir o caixa, o sistema pergunta: "Ha X pedidos fora do caixa. Vincular a sessao atual?" — se sim, vincula automaticamente e eles migram para as colunas do kanban
3. Pedidos sao aceitos normalmente (nao bloqueia operacao)

## Design

### Frontend (Orders.vue)

**Nova secao "Pedidos sem caixa"** — acima do kanban, abaixo do `pending-acceptance-box`:
- Visual laranja para diferenciar do amarelo do iFood
- Icone `bi-cash-coin` + texto "X pedido(s) sem caixa aberto — Abra o caixa para continuar"
- Cards compactos: #numero, cliente, status atual, canal, total
- Sem botoes de acao nos cards individuais
- Visivel quando: nao ha sessao aberta E existem pedidos ativos sem cashSessionId

**Logica de filtragem**:
- Computed `noCashOrders`: pedidos ativos (nao CONCLUIDO, nao CANCELADO) com `outOfSession === true`
- Computed `columnOrders(key)`: exclui `noCashOrders` das colunas do kanban
- Quando ha caixa aberto: comportamento normal, todos no kanban

### Frontend (CashControl.vue)

**Ao abrir o caixa com sucesso**:
- Verificar se ha pedidos com `outOfSession: true`
- Se sim: confirm("Ha X pedidos fora do caixa. Vincular a sessao atual?")
- Se confirmado: POST /cash/link-pending-orders
- Emitir evento para Orders.vue recarregar

### Backend

**Criacao de pedido (orders.js)**:
- Na criacao, verificar se ha sessao aberta para o canal/loja
- Se nao houver: marcar `outOfSession: true` imediatamente

**Novo endpoint POST /cash/link-pending-orders**:
- Busca pedidos ativos com `outOfSession: true` da empresa
- Vincula a sessao atual: `cashSessionId = session.id, outOfSession = false`
- Retorna contagem de pedidos vinculados

**Ajuste no conclude (orders.js)**:
- Manter logica atual de `findMatchingSession` para pedidos que ja estao no kanban

## Arquivos afetados

- `delivery-saas-frontend/src/views/Orders.vue` — nova secao + filtragem
- `delivery-saas-frontend/src/components/CashControl.vue` — prompt ao abrir caixa
- `delivery-saas-backend/src/routes/orders.js` — marcar outOfSession na criacao
- `delivery-saas-backend/src/routes/cash.js` — novo endpoint link-pending-orders
