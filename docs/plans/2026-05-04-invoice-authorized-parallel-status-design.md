# Design: `INVOICE_AUTHORIZED` como status paralelo

**Data:** 2026-05-04
**Status:** Aprovado, aguardando plano de implementação

## Problema

Hoje, quando a NF-e de um pedido é autorizada pelo SEFAZ, o backend sobrescreve o `status` do pedido para `INVOICE_AUTHORIZED`. Isso quebra dois fluxos:

1. **Kanban** — o quadro em `Orders.vue` só renderiza 4 colunas (`EM_PREPARO`, `SAIU_PARA_ENTREGA` + `PRONTO`, `CONFIRMACAO_PAGAMENTO`, `CONCLUIDO`). Pedidos com `status='INVOICE_AUTHORIZED'` somem da visão operacional.
2. **Caixa** — o pedido fica fora dos critérios usados para vincular ao caixa, impedindo o fechamento financeiro.

A intenção do usuário é que "nota autorizada" seja um **flag paralelo** ao status operacional. Cenário típico: pedido `CONCLUIDO` **e** com NF-e autorizada simultaneamente.

## Causa raiz

`delivery-saas-backend/src/services/nfe.js:50`:

```javascript
await prisma.order.update({
  where: { id: orderId },
  data: { payload: newPayload, status: 'INVOICE_AUTHORIZED' }
})
```

Esta é a **única** linha do backend que define `status='INVOICE_AUTHORIZED'`. Todas as demais ocorrências do enum no código são apenas *labels* e cores para exibição.

## Decisão

A informação "NF-e autorizada" já tem fonte da verdade: `order.payload.nfe.nProt` (preenchido pelo mesmo `saveNfeProtocol`). Não precisamos de outra coluna nem de outro enum.

**Abordagem aceita:** parar de sobrescrever `status`. O `payload.nfe` permanece como única fonte da verdade do estado fiscal.

## Mudanças

### 1. Backend — não alterar status na autorização

`services/nfe.js:50` passa a atualizar apenas o `payload`:

```javascript
await prisma.order.update({
  where: { id: orderId },
  data: { payload: newPayload }
})
```

### 2. Migração de dados (one-shot)

Pedidos já gravados com `status='INVOICE_AUTHORIZED'` precisam voltar para um status do kanban. O cenário típico é que essas notas foram emitidas em pedidos já finalizados, então `CONCLUIDO` é o fallback seguro.

Script: `delivery-saas-backend/prisma/scripts/restore-invoice-authorized-status.js`. Equivalente a:

```sql
UPDATE "Order" SET status = 'CONCLUIDO'
WHERE status = 'INVOICE_AUTHORIZED'
  AND payload -> 'nfe' ->> 'nProt' IS NOT NULL;
```

A condição extra (`nProt IS NOT NULL`) garante que só migramos pedidos que de fato têm nota — caso teórico de status setado sem `payload.nfe`.

### 3. Badge "NFC-e ✓" no card do kanban

Em `Orders.vue`, no card de cada pedido, exibir um badge pequeno quando `order.payload?.nfe?.nProt` for verdadeiro. Estilo discreto, alinhado com a identidade visual já usada (provavelmente cor `info` ou um verde claro). O atendente vê de relance se já há nota emitida sem precisar abrir o detalhe.

### 4. Limpeza

- Remover `INVOICE_AUTHORIZED` da lista `statusFilters` em `Orders.vue:3168` — após a migração, não retornará mais resultados, então é cruft.
- **Manter** os labels e cores de `INVOICE_AUTHORIZED` em `OrderHistory.vue`, `OrderStatus.vue`, `CustomerProfile.vue` e `Orders.vue` STATUS_LABEL — defesa contra dados residuais.
- **Manter** o valor `INVOICE_AUTHORIZED` no enum `OrderStatus` do Prisma — remover exigiria migration destrutiva sem ganho real.

## Não faremos (YAGNI)

- Adicionar coluna `invoiceAuthorized: Boolean` na tabela Order — duplicaria info que já está em `payload.nfe.nProt`.
- Remover `INVOICE_AUTHORIZED` do enum Prisma — migration arriscada, sem benefício.
- Filtro dedicado "tem nota / não tem nota" no kanban — não foi pedido; o badge já cobre a necessidade visual.

## Validação

- Emitir uma NF-e em um pedido `CONCLUIDO` no ambiente de homologação → verificar que o pedido permanece na coluna **Concluído** com badge **NFC-e ✓**.
- Verificar que o pedido continua aparecendo nos critérios do caixa (rota `/cash/...`).
- Verificar que `payload.nfe.nProt`, `cStat` e `xMotivo` continuam corretos no detalhe do pedido.
- Rodar o script de migração e contar linhas afetadas.
