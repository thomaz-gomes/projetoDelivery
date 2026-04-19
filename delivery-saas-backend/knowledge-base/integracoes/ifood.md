# Integracao iFood

## O que e
A integracao com o iFood permite que os pedidos feitos pelos clientes no aplicativo do iFood cheguem automaticamente no seu sistema. Voce pode conectar uma ou mais lojas, configurar aceite automatico de pedidos e mapear as formas de pagamento.

## Como acessar
Menu lateral → Integracoes → iFood

## Como usar

### Conectar sua loja ao iFood
A conexao e feita em 3 passos simples:

1. Clique em **Adicionar nova integracao**.
2. **Selecione a loja** do sistema que corresponde ao seu perfil no iFood.
3. Opcionalmente, preencha o **ID da loja no iFood** (encontrado no Portal do Parceiro iFood, em Perfil da loja).
4. Clique em **Gerar codigo de autorizacao**. Um codigo sera exibido na tela.
5. Clique em **Abrir Portal iFood**. O portal vai abrir em uma nova aba.
6. Cole o codigo no portal e autorize o acesso.
7. O iFood vai gerar um **codigo de confirmacao**. Copie esse codigo.
8. Volte ao sistema e cole o codigo de confirmacao no campo indicado.
9. Clique em **Conectar**.

### Aceite automatico de pedidos
Ative o botao **Aceite automatico** ao lado da integracao conectada para que os pedidos do iFood sejam aceitos automaticamente pelo sistema.

### Reconectar ou desconectar
- **Reconectar**: use se a conexao expirou ou parou de funcionar.
- **Desconectar**: remove a autorizacao do iFood. Pedidos param de chegar.
- **Remover**: exclui a integracao completamente do sistema.

### Mapear formas de pagamento (aba Formas de Pagamento)
1. Clique na aba **Formas de Pagamento**.
2. O sistema exibe os codigos de pagamento usados pelo iFood.
3. Para cada codigo, defina o nome que sera usado no sistema (exemplo: "CREDIT" → "Cartao de Credito").
4. Clique em **Salvar mapeamentos**.

### Chat automatico (aba Chat Automatico)
1. Clique na aba **Chat Automatico**.
2. Selecione a loja.
3. Configure as mensagens enviadas automaticamente no chat do iFood quando o status do pedido mudar:
   - Pedido Confirmado
   - Saiu para Entrega
   - Pedido Entregue
4. Use `{nome}` para inserir o nome do cliente e `{numero}` para o numero do pedido.
5. Ative ou desative cada mensagem individualmente.

## Duvidas frequentes

**A conexao com o iFood expira?**
Sim. O sistema renova automaticamente, mas em casos raros pode ser necessario reconectar manualmente.

**Posso conectar mais de uma loja?**
Sim. Clique em "Adicionar nova integracao" para cada loja que deseja conectar.

**Os pedidos do iFood aparecem automaticamente?**
Sim, apos a conexao, os pedidos chegam em tempo real no painel de pedidos do sistema.
