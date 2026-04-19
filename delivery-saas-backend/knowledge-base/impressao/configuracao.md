# Configuracao de Impressora

## O que e
A configuracao de impressora permite conectar uma impressora termica ao sistema para imprimir pedidos automaticamente. O sistema usa um programa chamado "Delivery Print Agent" instalado no computador da loja para enviar os pedidos diretamente para a impressora.

## Como acessar
Menu lateral → Configuracoes → Impressao Termica

## Como usar

### Verificar status da conexao
Ao abrir a tela de impressao, o sistema mostra se o agente esta **Conectado** (verde) ou **Desconectado** (cinza).

### Conectar o agente pela primeira vez
1. Clique em **Baixar Agente** para baixar o programa no computador da loja
2. Instale e execute o programa
3. No painel, clique em **Gerar codigo de pareamento**
4. Um codigo de 6 caracteres sera exibido na tela
5. Digite esse codigo no programa do agente para concluir a conexao
6. Quando conectado, as impressoras detectadas aparecerao na tela

### Quando o agente ja esta conectado
- Voce vera a lista de impressoras detectadas no computador
- Clique em **Atualizar lista de impressoras** para recarregar

### Acompanhar atividade
A secao "Atividade" mostra um historico das acoes recentes (conexao, deteccao de impressoras, erros).

## Duvidas frequentes

**O codigo de pareamento tem validade?**
Sim. O codigo expira apos alguns minutos. Se expirar, gere um novo codigo.

**Preciso instalar algum driver?**
Para impressoras USB, instale o driver "Generic / Text Only" no Windows antes de configurar. Isso garante que a impressao funcione corretamente.

**O agente precisa ficar aberto o tempo todo?**
Sim. O programa precisa estar rodando no computador da loja para receber e imprimir os pedidos.

**Posso usar mais de uma impressora?**
Sim. O agente detecta todas as impressoras instaladas no computador.
