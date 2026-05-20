# Delivery iFood Agent

App Electron que substitui a extensão Chrome para enviar mensagens automáticas no chat do iFood Gestor de Pedidos. Roda como aplicativo desktop, mantém conexão Socket.IO persistente com o backend e injeta mensagens na webview do iFood conforme o status dos pedidos muda.

## Por que migrar da extensão

- Service worker MV3 morre sozinho após ~30s sem atividade, derrubando a conexão Socket.IO.
- Abas em background no Chrome sofrem throttling agressivo de timers e network.
- Persistência em disco (`userData/sent-keys.json`) é mais previsível do que `chrome.storage.local`.
- Janela dedicada evita que o operador feche o iFood por engano e quebre o fluxo.

## Como usar (operador)

1. Baixe o instalador pelo painel admin em "Agente iFood" (link gerado por loja).
2. Instale e abra o app.
3. Na primeira execução, preencha no modal de onboarding:
   - Backend URL (ex.: `https://app.deliveryfacil.com.br`)
   - `agentToken` (gerado pelo admin)
   - `companyId`
4. Mantenha o app aberto durante o expediente. Não precisa ficar em foco.

## Como desenvolver

```
cd delivery-ifood-agent-electron
npm install
cd renderer && npm install && cd ..
```

Dev (dois terminais):
- `cd renderer && npm run dev` (Vite na porta 5174)
- `npm start` na raiz (carrega `main.js` apontando para o dev server)

Testes dos utilitários do main process:
```
cd src && node --test ttlDedupe.test.js failures.test.js ifoodRouter.test.js
```

## Como buildar o instalador Windows

```
npm run build:win
```

Gera `dist-electron/DeliveryIfoodAgent-Setup-<versão>.exe`. Adicione `build/icon.ico` antes para evitar o ícone genérico do Electron (ver `build/README.md`).

## Arquitetura — visão de 1 minuto

- **Main process** mantém Socket.IO com o backend (`ifoodAgentToken` no handshake).
- Backend emite `ifood:chat` quando um pedido muda de status.
- `ifoodRouter` filtra cada evento: descarta se `stale` (TTL por `kind`) ou já enviado (dedupe persistente em `userData/sent-keys.json`).
- Renderer recebe via IPC `chat:message`, processa fila, executa `webview.executeJavaScript()` com script gerado por `buildSendScript()` (`injectedScript.js`).
- Resultado volta via `chat:result` IPC → router marca como `sent` ou registra falha em `failures.json`.

## Arquivos importantes

| Caminho | Propósito |
| --- | --- |
| `main.js` | Bootstrap Electron, BrowserWindow, IPC bridge |
| `preload.js` | Expõe API segura ao renderer (`window.agentApi`) |
| `src/config.js` | Lê/grava config persistente em `userData/config.json` |
| `src/socketClient.js` | Conexão Socket.IO com reconnect/backoff |
| `src/ttlDedupe.js` | TTL por kind + dedupe em disco |
| `src/failures.js` | Log de falhas com retenção e rotação |
| `src/ifoodRouter.js` | Roteia eventos `ifood:chat` → fila do renderer |
| `renderer/src/App.vue` | Shell, webview, modal de onboarding |
| `renderer/src/IfoodFrame.vue` | Webview do iFood e fila de envio |
| `renderer/src/injectedScript.js` | Seletores DOM do iFood, `buildSendScript()` |
| `renderer/src/FailuresPanel.vue` | Lista de falhas + retry manual |

## Coexistência com a extensão Chrome

A extensão atual continua funcionando em paralelo por dois meses (até `2026-07-20`). O backend aceita ambos os tokens (`extensionToken` e `ifoodAgentToken`) no mesmo período. Depois disso, a extensão sai e só o app é suportado.

## Limitações conhecidas

- DevTools Protocol não é usado (último recurso). Os seletores do iFood Gestor estão em `injectedScript.js` e podem quebrar quando o iFood atualiza o frontend — basta atualizar o arquivo.
- Se a sessão do iFood expirou, o app não tenta re-login automaticamente; o operador precisa abrir a janela e logar de novo.
- Auto-update ainda não está habilitado (tarefa D3 pendente). Atualizações por enquanto são manuais via novo instalador.

## Troubleshooting

- **App conecta mas nada envia**: verifique no painel "Falhas" se há erros de seletor; provavelmente `injectedScript.js` precisa ajuste.
- **Reconnect infinito**: confira backend URL e `agentToken` no modal de configurações; tokens revogados causam loop.
- **Mensagem duplicada**: cheque `userData/sent-keys.json`; se foi apagado, o TTL precisa expirar para o dedupe estabilizar.
- **Webview do iFood não carrega**: abra DevTools da webview (`Ctrl+Shift+I` com foco na webview) e veja erros de rede ou CSP.
