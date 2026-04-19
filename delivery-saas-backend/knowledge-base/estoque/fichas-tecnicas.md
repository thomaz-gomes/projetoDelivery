# Fichas Tecnicas

## O que e
A ficha tecnica e a receita de um produto. Ela lista todos os ingredientes necessarios para preparar um item do cardapio, com as quantidades exatas. Com isso, o sistema calcula automaticamente o custo de producao e faz a baixa de estoque quando um pedido e concluido.

## Como acessar
Menu lateral > Estoque > Fichas Tecnicas

## Como usar

### Criar uma ficha tecnica
1. Clique em **Nova Ficha**
2. Informe o nome da ficha (normalmente o nome do produto, ex: "Pizza Calabresa Grande")
3. Salve para abrir a edicao completa

### Adicionar ingredientes a ficha
1. Abra a ficha para edicao
2. Selecione o ingrediente na lista
3. Informe a quantidade utilizada na receita
4. Clique em **Adicionar**
5. Repita para cada ingrediente da receita

### Entender o custo da ficha
A tabela de itens mostra:
- **Ingrediente**: nome do insumo
- **Unidade**: unidade de medida
- **Custo unitario**: custo medio do ingrediente por unidade
- **Quantidade**: quanto e usado na receita
- **Custo total**: custo do ingrediente nessa receita (custo unitario x quantidade)

O custo total da ficha e a soma de todos os custos dos ingredientes.

### Importar fichas com IA
1. Clique em **Importar com IA**
2. Siga as instrucoes para criar fichas automaticamente

### Duplicar ou excluir uma ficha
- **Duplicar**: cria uma copia com todos os ingredientes
- **Excluir**: remove a ficha permanentemente

### Auditoria de unidades
Se houver ingredientes com unidades incompativeis na ficha, um alerta aparecera no topo da pagina. Clique em **Ver itens** para identificar e corrigir os problemas.

## Duvidas frequentes

**O custo da ficha atualiza automaticamente?**
Sim, o custo e recalculado sempre que o custo medio de um ingrediente muda (por exemplo, apos uma nova entrada de estoque).

**O estoque e baixado automaticamente?**
Sim, quando um pedido com produtos vinculados a fichas tecnicas e concluido, o sistema desconta automaticamente os ingredientes do estoque.

**Posso usar a mesma ficha para produtos diferentes?**
Sim, uma ficha tecnica pode ser vinculada a varios produtos do cardapio.
