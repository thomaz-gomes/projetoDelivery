# Status dos Pedidos

## O que e
Cada pedido passa por uma sequencia de status que indica em qual etapa ele esta. Voce pode avancar o status manualmente ou, em alguns casos, ele muda automaticamente.

## Fluxo de status

O fluxo padrao de um pedido e:

1. **Pendente de aceite** -- O pedido acabou de chegar e aguarda voce aceitar. Aparece para pedidos de integracao (ex: iFood).
2. **Em preparo** -- O pedido foi aceito e esta sendo preparado na cozinha.
3. **Pronto para retirada** -- O pedido esta pronto e aguarda o cliente buscar (para pedidos de retirada).
4. **Saiu para entrega** -- O pedido saiu com o entregador. Nesta etapa, voce pode atribuir um entregador.
5. **Confirmacao de pagamento** -- Aguardando confirmacao do pagamento (para pedidos com pagamento na entrega).
6. **Concluido** -- O pedido foi entregue e finalizado com sucesso.

### Status especial
- **Cancelado** -- O pedido foi cancelado. Pode ser cancelado em qualquer etapa antes da conclusao.

## Como avancar o status
1. No painel de pedidos, localize o pedido desejado.
2. Clique no botao de seta (avancar) no cartao do pedido.
3. O pedido sera movido para o proximo status automaticamente.
4. Voce tambem pode arrastar o pedido para outra coluna.

## Duvidas frequentes

**Posso voltar um pedido para o status anterior?**
Nao. O fluxo de status so permite avancar. Se precisar corrigir algo, cancele o pedido e crie um novo.

**O que acontece quando cancelo um pedido?**
O pedido vai para o status "Cancelado" e nao pode mais ser alterado. Se houver controle de estoque, os itens sao devolvidos ao estoque.

**Pedidos do iFood seguem o mesmo fluxo?**
Sim, porem o primeiro status pode ser "Pendente de aceite", onde voce precisa aceitar ou recusar o pedido vindo do iFood.
