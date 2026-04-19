# Integracao aiqfome

## O que e
A integracao com o aiqfome permite receber pedidos dessa plataforma diretamente no seu sistema, de forma semelhante a integracao com o iFood. A conexao e feita atraves do servico aiqbridge, que faz a ponte entre o aiqfome e o sistema.

## Como acessar
Menu lateral → Integracoes → aiqfome

## Como usar

### Conectar sua loja

1. Clique em **Adicionar integracao**.
2. Selecione a **Loja** do sistema.
3. Acesse o [dashboard aiqbridge](https://www.aiqbridge.com.br/web/) e gere um token.
4. Cole o **Token aiqbridge** no campo indicado.
5. Opcionalmente, preencha o **Merchant ID** (ID da loja no aiqfome).
6. Clique em **Salvar e conectar**.

### Configurar o webhook
Apos conectar, o sistema exibe a **URL do Webhook**. Copie essa URL e configure no dashboard aiqbridge para que os pedidos sejam enviados ao sistema.

### Aceite automatico
Ative o botao **Aceite automatico** para que os pedidos do aiqfome sejam aceitos automaticamente.

### Controle da loja
Use os botoes ao lado da integracao conectada para:
- **Abrir**: colocar a loja online no aiqfome.
- **Fechar**: tirar a loja do ar.
- **Standby**: colocar em modo de espera.

### Mapear formas de pagamento (aba Pagamentos)
1. Clique na aba **Pagamentos**.
2. Para cada codigo de pagamento do aiqfome, defina o nome correspondente no sistema.
3. Clique em **Salvar**.

### Sincronizar cardapio (aba Cardapio)
1. Clique na aba **Cardapio**.
2. Selecione o cardapio do sistema que deseja enviar ao aiqfome.
3. Clique em **Sincronizar**.
4. A estrutura do cardapio sera enviada. Os precos sao gerenciados diretamente no aiqfome.

## Duvidas frequentes

**O que e o aiqbridge?**
E um servico intermediario que permite a comunicacao entre o aiqfome e sistemas externos como o nosso. Voce precisa ter acesso ao dashboard aiqbridge para gerar o token de conexao.

**Os pedidos chegam em tempo real?**
Sim, desde que o webhook esteja configurado corretamente no aiqbridge.

**Posso conectar mais de uma loja?**
Sim. Cada loja do sistema pode ter sua propria integracao com o aiqfome.
