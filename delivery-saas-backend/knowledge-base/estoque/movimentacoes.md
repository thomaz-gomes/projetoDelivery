# Movimentacoes de Estoque

## O que e
As movimentacoes registram todas as entradas e saidas de ingredientes do estoque. Cada vez que voce compra insumos (entrada) ou consome para producao (saida), o registro fica armazenado aqui para controle e rastreabilidade.

## Como acessar
Menu lateral > Estoque > Movimentacoes

## Como usar

### Registrar uma nova movimentacao
1. Clique em **Novo Lancamento**
2. Selecione o tipo: **Entrada** ou **Saida**
3. Adicione os ingredientes com suas quantidades
4. Preencha a descricao e salve

### Consultar movimentacoes
1. Use os filtros de data para selecionar o periodo desejado
2. Clique em **Buscar** para carregar os registros
3. Use a barra de busca para filtrar por nome de ingrediente ou descricao

### Entender a tabela
A tabela de movimentacoes exibe:
- **Data**: quando a movimentacao foi registrada
- **Descricao**: nome do ingrediente movimentado
- **Quantidade**: quantidade movimentada
- **Tipo**: Entrada ou Saida
- **Valor**: valor da movimentacao (positivo para entradas, negativo para saidas)

### Ver detalhes
Clique em **Ver** ao lado de uma movimentacao para abrir os detalhes completos.

### Paginacao
Use o seletor de "Por pagina" para definir quantos itens exibir (10, 25 ou 50) e os botoes Anterior/Proxima para navegar.

## Duvidas frequentes

**As saidas de pedidos aparecem aqui?**
Sim, quando um pedido e concluido e o produto tem ficha tecnica vinculada, a baixa automatica de estoque aparece como uma saida.

**Posso registrar uma saida manual?**
Sim, use o botao "Novo Lancamento" para registrar saidas por perda, consumo interno ou ajuste de inventario.

**O custo medio do ingrediente e atualizado nas entradas?**
Sim, a cada nova entrada, o custo medio do ingrediente e recalculado automaticamente com base no historico de compras.
