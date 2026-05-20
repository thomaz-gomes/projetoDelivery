# QA — Checklist Manual End-to-End

Roteiro para validar o Agente iFood Electron antes de promover para produção. Cobrir todos os itens antes de declarar a versão estável.

## Pré-requisitos

- Build local funcionando: `npm install` na raiz + `npm install` em `renderer/` + `npm start`
- Login válido no iFood Gestor de Pedidos (`https://gestordepedidos.ifood.com.br/`)
- Backend rodando (Docker local na porta 3000 ou produção) com:
  - Pelo menos uma loja iFood configurada
  - Mensagens de chat configuradas (CONFIRMED, DISPATCHED, DELIVERED) habilitadas
- Conta ADMIN no painel para gerar o `ifoodAgentToken`

## 1. Onboarding

- [ ] Apagar `userData/config.json` (Windows: `%APPDATA%/Delivery iFood Agent/`; Linux: `~/.config/Delivery iFood Agent/`).
- [ ] Abrir o app. Modal "Configurações do Agente" deve aparecer automaticamente em primeira execução.
- [ ] Botão "Cancelar" NÃO deve aparecer (é first-run).
- [ ] Preencher URL inválida (ex: `http://nao-existe`). Salvar. Status do header deve ir para `erro` ou `desconectado`.
- [ ] Reabrir Configurações pelo ícone ⚙. Preencher dados corretos. Salvar.
- [ ] Status do header deve ir para `conectado` em até 5s.

## 2. Conexão e reconexão

- [ ] Com app conectado, parar o backend. Status deve ir para `desconectado`.
- [ ] Reiniciar backend. Status deve voltar para `conectado` automaticamente (reconnect do socket.io).
- [ ] Trocar para token inválido em Configurações → Salvar. Status deve mostrar erro `invalid-ifood-agent-token` ou similar.

## 3. Envio automático CONFIRMED

- [ ] Garantir que o iFood Gestor está logado dentro do webview (rolar até a tela de pedidos).
- [ ] Pelo painel Delivery SaaS, mover um pedido iFood para status "Em preparo" (CONFIRMED).
- [ ] Em até 10s, observar no app:
  - Header: contador "Fila" sobe para 1
  - O webview do iFood abre o painel de Conversas, encontra o pedido, abre a conversa, escreve a mensagem e envia
  - Header: contador "Fila" volta para 0
- [ ] No iFood, abrir a conversa do pedido e confirmar que a mensagem foi entregue.

## 4. Envio automático DISPATCHED

- [ ] Mover o mesmo pedido para "Saiu para entrega" (DISPATCHED). Repetir validações.

## 5. Envio automático DELIVERED

- [ ] Mover o pedido para "Entregue" (DELIVERED). Repetir validações.

## 6. Dedupe persistente

- [ ] Mover um pedido para CONFIRMED. Aguardar envio.
- [ ] No painel Delivery, mover o pedido para outro status e voltar para CONFIRMED (forçar reenvio).
- [ ] O app NÃO deve enviar de novo (dedupe por `orderId:kind`).
- [ ] Verificar arquivo `userData/sent-keys.json` — deve conter a chave do pedido.

## 7. TTL — descarte de mensagens antigas

- [ ] Desconectar o app (parar o app).
- [ ] No backend, mover um pedido para CONFIRMED (mensagem fica acumulada no broadcast — ou, se backend não acumula, simular com `curl` direto disparando emit com `createdAt` 11min no passado).
- [ ] Reabrir o app. Mensagem com `createdAt > 10min` (TTL CONFIRMED) deve ser descartada SEM envio e SEM aparecer na fila.
- [ ] Abrir painel de Falhas. Deve haver entrada `error: stale-ttl` para esse pedido.

## 8. Falhas — pedido não encontrado

- [ ] No iFood Gestor, garantir que NÃO existe um pedido com número fictício (ex: `#999999`).
- [ ] Disparar via backend (rota interna ou script) um `ifood:chat` com `orderNumber: '999999'` válido (não-stale).
- [ ] App tenta abrir a conversa, não encontra, tenta FLUXO 2 (card do pedido), também não encontra.
- [ ] Resultado: failure registrado, header mostra "Falhas: 1".
- [ ] Painel de Falhas mostra a entrada com erro descritivo (`textarea not found` ou `cannot open chat`).
- [ ] Botão "Limpar tudo" zera a lista.

## 9. Recarregar iFood

- [ ] Botão "Recarregar iFood" no header recarrega o webview sem fechar o app nem perder a conexão socket.
- [ ] Após reload, próximo envio funciona normalmente.

## 10. Multi-app coexistência com a extensão Chrome

- [ ] Manter a extensão Chrome ativa em outro browser/perfil, conectada com o mesmo `companyId`.
- [ ] Manter o app Electron também conectado.
- [ ] Disparar um envio. Apenas UM dos dois deve efetivar o envio no iFood (dedupe distribuído ainda NÃO está implementado neste milestone — verificar se há duplicação; se houver, registrar como limitação conhecida).

## 11. Persistência entre execuções

- [ ] Fechar o app completamente.
- [ ] Reabrir. Não deve pedir configuração novamente.
- [ ] Estado de "sent-keys" deve persistir — pedidos já enviados anteriormente não reenviam.

## 12. Build Windows

- [ ] `npm run build:win` produz `dist-electron/DeliveryIfoodAgent-Setup-<versão>.exe`.
- [ ] Instalar o `.exe` em máquina limpa (VM Windows).
- [ ] Atalho na área de trabalho criado.
- [ ] App abre, executa onboarding normalmente.
- [ ] Envio funciona igual à versão dev.

## 13. Logs e diagnóstico

- [ ] Abrir DevTools do renderer (Ctrl+Shift+I no app). Console não deve mostrar erros vermelhos durante operação normal.
- [ ] Logs do main process aparecem no terminal quando rodado via `npm start`.

## Critérios de aprovação

Para liberar para piloto, TODAS as seções 1–9 e 11 devem passar. Seções 10 (coexistência) e 12 (build instalado) são fortemente recomendadas. Seção 13 é diagnóstico complementar.

Limitações conhecidas aceitáveis no piloto:
- Sem Mac build (D2 pendente)
- Sem auto-update (D3 pendente)
- Sem aviso "loja sem agente há 24h" no painel (E2 pendente)
