# Emissao de NFC-e (Nota Fiscal ao Consumidor)

## O que e
A NFC-e (Nota Fiscal de Consumidor Eletronica) e o cupom fiscal digital emitido para o cliente final. O sistema permite emitir NFC-e diretamente, preenchendo os dados do emitente, destinatario, itens e forma de pagamento.

## Como acessar
Menu lateral → Fiscal → Emissao NF-e

## Como usar

### Configuracao inicial
Na primeira vez, o sistema tenta carregar automaticamente os dados do emitente (CNPJ, razao social, endereco) a partir das configuracoes da loja. Se nao estiverem cadastrados, preencha manualmente.

### Preencher a nota

**1. Identificacao**
- **Natureza da Operacao**: geralmente "VENDA".
- **Modelo**: escolha 65 para NFC-e ou 55 para NF-e.
- **Serie**: numero da serie (geralmente 1).
- **Numero NF**: numero sequencial da nota.
- **Ambiente**: Homologacao (testes) ou Producao (notas validas).

**2. Emitente**
- Dados da sua empresa: CNPJ, razao social, inscricao estadual e endereco completo.

**3. Destinatario**
- Escolha o tipo de documento (CPF ou CNPJ).
- Preencha o documento e o nome do cliente (opcional para NFC-e de baixo valor).

**4. Itens**
- Clique em **Adicionar Item**.
- Preencha a descricao, NCM, CFOP, unidade, quantidade e valor unitario.
- O valor total e o ICMS sao calculados automaticamente.

**5. Pagamento**
- Selecione a forma de pagamento (Dinheiro, Cartao de Credito, Debito, PIX, etc.).
- Informe o valor pago.

### Emitir a nota
1. Confira todos os dados.
2. Clique em **Emitir NF-e**.
3. Aguarde o retorno da SEFAZ.
4. Se autorizada, o sistema mostra o numero do protocolo.
5. Se rejeitada, leia a mensagem de erro e corrija os dados.

## Duvidas frequentes

**O que e o ambiente de Homologacao?**
E o ambiente de testes da SEFAZ. Use para testar a emissao sem gerar notas fiscais validas. Mude para Producao apenas quando tudo estiver funcionando.

**Preciso de certificado digital?**
Sim. O certificado digital deve estar configurado nas configuracoes da loja para que a emissao funcione.

**O que fazer se a nota for rejeitada?**
Leia a mensagem de erro retornada pela SEFAZ (campo "xMotivo"). Os erros mais comuns sao dados do emitente incorretos, NCM invalido ou CFOP incompativel. Corrija e tente novamente.

**Posso emitir NFC-e a partir de um pedido?**
Sim, e possivel emitir diretamente a partir dos dados de um pedido, porem a emissao manual tambem esta disponivel nesta tela.
