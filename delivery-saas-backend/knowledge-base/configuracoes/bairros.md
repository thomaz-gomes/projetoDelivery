# Bairros e Taxas de Entrega

## O que e
O cadastro de bairros permite definir as areas de entrega da sua loja e configurar taxas de entrega e de motoboy para cada bairro.

## Como acessar
Menu lateral → Configuracoes → Bairros

## Como usar

### Cadastrar um bairro
1. Clique em **Novo bairro**
2. Preencha o **Nome** do bairro
3. Adicione **Apelidos** (nomes alternativos separados por virgula) para melhorar a deteccao automatica
4. Defina a **Taxa de entrega** (valor cobrado do cliente)
5. Defina a **Taxa do motoboy** (valor pago ao entregador)
6. Clique em **Salvar**

### Editar ou remover
- Clique no icone de lapis para editar um bairro
- Clique no icone de lixeira para remover

### Importar bairros via CSV
1. Clique em **Importar CSV**
2. Selecione um arquivo .csv com as colunas: name, aliases, deliveryFee, riderFee
3. O sistema importara os bairros automaticamente

### Testar deteccao de bairro
1. Clique em **Testar deteccao**
2. Cole um endereco completo no campo de texto
3. Clique em **Testar** para verificar qual bairro o sistema identifica

## Duvidas frequentes

**Para que servem os apelidos?**
Os apelidos ajudam o sistema a reconhecer o bairro quando o cliente digita o endereco. Por exemplo, o bairro "Centro Historico" pode ter o apelido "Centro".

**Qual a diferenca entre taxa de entrega e taxa do motoboy?**
A taxa de entrega e o valor cobrado do cliente no pedido. A taxa do motoboy e o valor que voce paga ao entregador por aquela entrega.

**Posso importar muitos bairros de uma vez?**
Sim. Use a importacao por CSV com as colunas name, aliases, deliveryFee e riderFee.

**Como funciona a deteccao automatica?**
Quando o cliente informa o endereco, o sistema compara com os nomes e apelidos cadastrados para identificar o bairro e aplicar a taxa correta.
