# Dados Fiscais

## O que e
Os dados fiscais sao as configuracoes de impostos e classificacoes que o sistema precisa para emitir notas fiscais corretamente. Cada grupo de dados fiscais pode ser associado a categorias ou produtos do seu cardapio.

## Como acessar
Menu lateral → Configuracoes → Dados Fiscais

## Como usar

### Criar um novo grupo de dados fiscais
1. Clique em **Criar novo**.
2. Preencha a **Descricao** (exemplo: "Bebidas alcoólicas", "Alimentos prontos").
3. Preencha o **EAN** (codigo de barras) se aplicavel.
4. Selecione a **NCM** (classificacao do produto) usando a busca por codigo ou descricao.
5. Escolha a **Origem da Mercadoria** (nacional, importada, etc.).

### Configurar impostos (aba Impostos)
Na aba **Impostos**, preencha as aliquotas de:
- **ICMS**: percentual de base, aliquota, modalidade e FCP.
- **ICMS ST**: se o produto tem substituicao tributaria.
- **PIS / COFINS / IPI**: aliquotas de cada tributo.

### Configurar CFOPs (aba CFOPs)
1. Clique na aba **CFOPs**.
2. Use a busca para encontrar e adicionar os CFOPs aplicaveis (exemplo: 5102 para venda interna).
3. Para cada CFOP adicionado, selecione o **CSOSN**, **CST IPI**, **CST PIS** e **CST COFINS**.

### Configurar CEST (aba CEST)
1. Selecione uma NCM primeiro.
2. Na aba **CEST**, o sistema mostra os codigos CEST disponiveis para aquela NCM.
3. Selecione o CEST correto, se aplicavel.

### Editar ou remover
- Na lista de dados fiscais, clique em **Editar** para alterar ou **Remover** para excluir.

## Duvidas frequentes

**Preciso criar um grupo para cada produto?**
Nao. Voce pode criar grupos por tipo de produto (exemplo: "Alimentos", "Bebidas") e associar o mesmo grupo a varios produtos ou categorias.

**O que e NCM?**
E um codigo que classifica o tipo de produto para fins fiscais. O sistema oferece uma lista com busca para facilitar a escolha.

**O que e CFOP?**
E o codigo que identifica o tipo de operacao fiscal (venda, devolucao, transferencia). Cada situacao pode ter um CFOP diferente.

**Preciso de um contador para preencher isso?**
Sim, e altamente recomendado. As configuracoes fiscais devem seguir a legislacao do seu estado e regime tributario. Consulte seu contador para definir os valores corretos.
