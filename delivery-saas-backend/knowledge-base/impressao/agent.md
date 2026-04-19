# Instalacao do Agente de Impressao

## O que e
O Delivery Print Agent e um programa instalado no computador da loja que recebe os pedidos do sistema e envia direto para a impressora termica, sem abrir nenhuma janela de impressao do Windows.

## Requisitos
- Windows 10 ou 11 (64 bits)
- Impressora termica instalada no computador
- Conexao com a internet

## Como instalar

1. No painel do sistema, acesse **Configuracoes → Impressao Termica**
2. Clique em **Baixar Agente** para baixar o instalador (.exe, aproximadamente 50 MB)
3. Execute o arquivo baixado no computador da loja
4. Quando solicitado, informe a **URL do servidor** que aparece na tela de configuracao
5. No painel do sistema, clique em **Gerar codigo de pareamento**
6. Digite o codigo de 6 caracteres no agente
7. Quando o icone verde aparecer na bandeja do Windows (proximo ao relogio), a conexao esta ativa

## Como funciona
- O agente fica rodando em segundo plano no computador da loja
- Quando um novo pedido e recebido, o sistema envia automaticamente para o agente
- O agente imprime o pedido na impressora configurada sem intervencao manual

## Duvidas frequentes

**O agente precisa ficar sempre aberto?**
Sim. Se o programa for fechado, os pedidos nao serao impressos automaticamente. Recomendamos configurar o agente para iniciar junto com o Windows.

**Como sei se o agente esta funcionando?**
Verifique o icone na bandeja do Windows (area de notificacao). Icone verde significa conectado. Voce tambem pode verificar o status na tela de Impressao Termica do painel.

**Posso usar o agente em mais de um computador?**
Cada computador precisa de sua propria instalacao e pareamento.

**A impressora precisa de alguma configuracao especial?**
Para impressoras USB, instale o driver "Generic / Text Only" no Windows. Isso permite que o agente envie dados diretamente sem passar pelo spooler de impressao.

**O que fazer se o agente desconectar?**
Verifique a conexao com a internet e se o programa esta rodando. Se necessario, gere um novo codigo de pareamento.
