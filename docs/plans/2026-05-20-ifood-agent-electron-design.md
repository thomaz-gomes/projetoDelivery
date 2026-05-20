# iFood Agent Electron — Design

**Data:** 2026-05-20
**Status:** Aprovado, pronto para planejamento de implementação

## Problema

A extensão Chrome atual (`ifood-chat-extension/`) tem 3 problemas estruturais que vêm das limitações do modelo de extensão MV3:

1. **Service Worker morre** após ~30s ocioso → reconexão Socket.IO frequente, eventos perdidos.
2. **Tab em background sofre throttling** do Chrome → timers atrasam (parcialmente mitigado com MutationObserver, mas não 100%).
3. **Operador precisa lembrar de "ativar a aba certa"** → erro humano, mensagens enfileiradas demais.
4. **Chrome Web Store / instalação manual** → atrito para distribuir updates.

A proposta é substituir a extensão por um **app Electron dedicado** que abre o gestor do iFood com Socket.IO embutido e injeção controlada, eliminando esses problemas pela raiz.

## Contexto

- A empresa já mantém um app Electron (`delivery-print-agent-electron/`) instalado nos PCs dos operadores → expertise + infraestrutura de auto-update já existem.
- A extensão atual já implementou React setter nativo + MutationObserver + TTL/dedupe (`feat/ai-image-feedback` branch + main).
- Backend emite eventos `ifood:chat` via Socket.IO com `kind` (CONFIRMED/DISPATCHED/DELIVERED) e `createdAt` — esses campos já estão em produção e são consumidos pela extensão.

## Decisões de produto

1. **App Electron dedicado** (não estender o print-agent existente): isolamento total; se um crasha, o outro continua.
2. **Token próprio do app** (`ifoodAgentTokenHash`), separado do `extensionTokenHash` — permite migração paralela e revogação independente.
3. **UI com header próprio** mostrando status, fila, falhas e ações (recarregar iFood, configurações).
4. **Plataformas: Windows + macOS**. macOS requer notarização Apple ($99/ano).
5. **Migração paralela com a extensão por 2 meses**, depois deprecação gradual em mais 3-6 meses.

## Arquitetura

### Stack

- Electron 28+ (alinhado com o print-agent).
- Main process: Node.js (Socket.IO, IPC, storage, auto-update).
- Renderer: Vue 3 (header) + `<webview>` para o gestor do iFood.
- Builder: `electron-builder` (NSIS para Win, DMG notarizado para Mac).

### Estrutura de arquivos

```
delivery-ifood-agent-electron/
├── package.json
├── src/
│   ├── main.js                 # entrypoint Electron
│   ├── socketClient.js         # Socket.IO ↔ backend
│   ├── ifoodRouter.js          # roteia ifood:chat para o webview
│   ├── ttlDedupe.js            # TTL por kind + dedupe persistido
│   ├── failures.js             # histórico de falhas + tray
│   ├── tray.js                 # menu de tray
│   ├── config.js               # carrega/salva config em userData
│   └── autoUpdater.js          # electron-updater wrapper
├── renderer/
│   ├── index.html
│   ├── App.vue
│   ├── components/
│   │   ├── AppHeader.vue       # status + ações
│   │   ├── IfoodFrame.vue      # <webview> + injeção
│   │   ├── SettingsModal.vue
│   │   └── FailuresPanel.vue
│   ├── injectedScript.js       # versão sem chrome.* do content.js
│   └── selectors.js            # copiado da extensão (mesma fonte)
├── build/                      # ícones, instalador customizado
└── README.md
```

### Fluxo de mensagem

```
Backend emite ifood:chat { orderNumber, orderId, message, kind, createdAt }
  → Main socketClient recebe
  → ttlDedupe filtra (descarte se stale ou já enviado)
  → IPC → Renderer
  → IfoodFrame.vue chama webview.executeJavaScript(injectedScript + payload)
  → Script manipula DOM do iFood, retorna { ok, error?, orderNumber, kind }
  → Renderer → IPC → Main:
      ok=true  → ttlDedupe.markSent + atualiza header (contador)
      ok=false → failures.add + badge vermelho + tray notification
```

### Por que melhor que a extensão

- Socket.IO no main process: **nunca morre** (sem service worker MV3 timer).
- `<webview>` é renderer separado mas com janela própria do app — **não sofre throttling** mesmo quando minimizada (Electron não throttla janelas próprias).
- `webContents.executeJavaScript` pode ser chamado direto sem coreografia PING/CONTENT_SCRIPT_READY.
- DevTools Protocol disponível como **camada 4 de fallback** (último recurso): `webContents.debugger.sendCommand('Input.dispatchKeyEvent', ...)` simula eventos de teclado **reais**, não sintéticos — resolve casos onde o React do iFood ignora.

### Storage persistente

| Path | Conteúdo |
|------|----------|
| `userData/cookies-ifood/` | Cookies do iFood (login persiste entre runs). Webview usa `partition: 'persist:ifood'` |
| `userData/config.json` | URL do backend, companyId, ifoodAgentToken |
| `userData/sent-keys.json` | Dedupe `(orderId, kind)` com janela rolante 24h |
| `userData/failures.json` | Últimas 50 falhas (orderNumber, kind, error, timestamp) |

## UI

### Layout

```
┌──────────────────────────────────────────────────────────────────────┐
│ ● Conectado · Empresa: ACME LTDA · Fila: 0 · Falhas: 0  [⟳ iFood] ⋮ │
└──────────────────────────────────────────────────────────────────────┘
│                                                                      │
│              webview do gestordepedidos.ifood.com.br                 │
│                       (ocupa o resto da janela)                      │
│                                                                      │
```

### Componentes do header

- **Indicador `●` colorido**: verde (conectado), amarelo (reconectando), vermelho (desconectado).
- **Empresa atual**: nome derivado do handshake do backend.
- **Fila: N** — mensagens recebidas e ainda não despachadas.
- **Falhas: N** — clicável se N>0, abre painel lateral com lista (orderNumber, kind, error, timestamp, botão "Tentar de novo").
- **`⟳ iFood`** — recarrega o webview.
- **`⋮`** — menu:
  - Configurações (URL backend, token).
  - Toggle "Modo debug" (escreve mas não envia).
  - Toggle "Sempre acima".
  - Histórico de mensagens (últimas 100 enviadas).
  - "Abrir DevTools do iFood".
  - "Limpar cookies do iFood".
  - Versão + auto-update check.

### Onboarding

Primeira execução abre direto no modal de configurações:
- Campos: URL do backend, Company ID, Token.
- Botão "Conectar" → handshake; se OK, salva config e abre o webview.
- Operador faz login no iFood normalmente; cookies persistem.

### Header altura

40px fixo.

## Script injetado

Versão Electron do `content.js` da extensão. Diferenças:

### 1. Sem `chrome.runtime` — comunicação via Promise

```js
// Em vez de chrome.runtime.sendMessage({...})
return { ok: true, orderNumber, kind }
// ou
return { ok: false, error: 'mensagem-amigável' }
```

### 2. Fallback em camadas para envio

```
1. Setter nativo + dispatchEvent('input') → ~95% dos casos
2. Click no botão de envio → ~4% dos casos
3. Enter sintético via dispatchEvent('keydown') → ~0.9%
4. Enter REAL via webContents.debugger.sendCommand → ~0.1% (último recurso)
```

### 3. Verificação semântica reforçada

Não retorna sucesso só porque o textarea esvaziou. Confirma que a mensagem aparece na thread do chat (mesma lógica da Fase 2.1 da extensão, com timeout 1s).

### 4. TTL + dedupe ficam no MAIN

Não no script injetado. É mais robusto e persiste em disco:

```js
// main/ifoodRouter.js
socket.on('ifood:chat', async (payload) => {
  if (ttlDedupe.isStale(payload)) return logger.warn('stale')
  if (ttlDedupe.isAlreadySent(payload)) return logger.warn('dup')
  const result = await sendToWebview(payload)
  if (result.ok) ttlDedupe.markSent(payload)
  else failures.add(payload, result.error)
})
```

Constantes (espelham as da extensão): CONFIRMED=10min, DISPATCHED=30min, DELIVERED/MANUAL=2h.

### Reaproveitamento da extensão

- `selectors.js` → cópia idêntica (mesma fonte de seletores).
- `content.js` → adaptado (remove `chrome.*`, troca por `return` de Promise).
- `waitForEnabledSendButton`, `waitForCleared` → mantém MutationObserver/listener `input`.

## Empacotamento

```yaml
# build:
mac:    [dmg]      # universal (arm64 + x64), notarizado
win:    [nsis]     # instalador 64-bit, idioma pt-BR
```

### Auto-update

- `electron-updater` apontado para feed em `gh-releases` ou bucket S3.
- Padrão: `releases.deliverywl.com.br/ifood-agent/latest-mac.yml` (idem Win).
- Check no boot + a cada 6h.
- Notifica via toast; aplica no próximo restart.

### Instalador Windows

- NSIS, idioma pt-BR.
- Cria atalho Desktop + Start Menu.
- Opção "Iniciar com o Windows" (gravado em registry `Run`).
- Desinstalador limpa `userData` opcionalmente.

### Instalador Mac

- `.dmg` com janela drag-to-Applications.
- Auto-launch via `app.setLoginItemSettings({ openAtLogin: true })` (opt-in).

### Tamanho esperado

- Win NSIS: ~80MB.
- Mac DMG: ~90MB (universal binary).

### Distribuição

Página `Configurações → Integrações → Agente iFood` no admin:
- Botões "Baixar Windows / macOS" → link do release.
- Botão "Gerar token" → cria `ifoodAgentToken` (1 ativo por empresa).
- QR code/link mobile-friendly.

## Backend

### Schema (Prisma)

Adiciona em `PrinterSetting` (reaproveita modelo que já tem `extensionTokenHash`):

```prisma
model PrinterSetting {
  // ... campos atuais
  extensionTokenHash         String?
  extensionTokenCreatedAt    DateTime?
  ifoodAgentTokenHash        String?    // novo
  ifoodAgentTokenCreatedAt   DateTime?  // novo
}
```

Mantém os 2 separados para revogar um sem afetar o outro durante a migração paralela.

### Geração do token

`POST /ifood-chat/generate-agent-token` (ADMIN-only):
- Gera 24 chars `[a-zA-Z0-9]` (mesmo padrão do `extensionToken`).
- Salva apenas SHA256 em `ifoodAgentTokenHash`.
- Retorna `{ token }` **uma única vez** ao admin (não fica armazenado em claro).
- Sobrescreve token anterior se houver — apenas 1 ativo por empresa.

### Handshake Socket.IO

Estende o middleware existente em `index.js`:

```javascript
if (auth.ifoodAgentToken) {
  const companyId = auth.companyId
  if (!companyId) return next(new Error('missing-company-id'))
  const setting = await prisma.printerSetting.findUnique({
    where: { companyId },
    select: { ifoodAgentTokenHash: true },
  })
  if (!setting?.ifoodAgentTokenHash) return next(new Error('no-agent-token'))
  const incomingHash = sha256(auth.ifoodAgentToken)
  if (incomingHash !== setting.ifoodAgentTokenHash) {
    return next(new Error('invalid-agent-token'))
  }
  socket.ifoodAgent = { companyId }
  socket.companyId = companyId
  return next()
}
```

### Roteamento da emissão

`emitirIfoodChat()` em `socketEmitters.js`:

```javascript
for (const s of sockets) {
  // Aceita TANTO extensão quanto agente Electron — paralelismo nativo.
  if (!s.extension && !s.ifoodAgent) continue
  // ...
}
```

### Dedupe entre extensão e agente

Os dois podem estar conectados simultaneamente durante a transição.
- TTL + dedupe **no lado cliente** já garantem que cada (orderId, kind) só é enviado 1 vez por instalação.
- Pior caso: extensão e agente disparam ao mesmo tempo antes de saber um do outro → 2 mensagens iguais. Aceitável para v1; **YAGNI** sobre dedupe centralizado no backend.

## Migração paralela

### Coexistência (2 meses)

- `extensionToken` continua aceito (zero quebra para quem usa extensão).
- `emitirIfoodChat()` apenas amplia o filtro (`!s.extension && !s.ifoodAgent`).
- Tela "Configurações → Agente iFood" no admin convive com "Configurações → Extensão Chrome".

### Por loja

1. Operador baixa app, cola token, faz login no iFood.
2. Mantém extensão também por 1-2 semanas (validação).
3. Quando confiar, desinstala a extensão. Nada precisa ser feito no backend.

### Sinalizações no admin (opcional)

- Quando ambos conectados → toast leve: *"Você pode desinstalar a extensão; o agente já está cobrindo."*
- Após 30 dias sem extensão conectada → some o card da extensão.

### Deprecação após 2 meses

- Não publica novas versões da extensão.
- +3 meses: banner pedindo migração final.
- +6 meses: remove caminho `extensionToken` do middleware + card do admin.

### Telemetria

- Log de cada conexão (`extension` vs `ifoodAgent`) com `companyId` e `at`.
- Query ad-hoc no painel SaaS Admin lista empresas por tipo de conexão. Sem UI dedicada.

### Risco principal

Loja que desinstala a extensão sem ativar o agente → fica sem mensagens.

**Mitigação**: admin web mostra aviso *"Sua loja não tem nem extensão nem agente conectados há 24h"* quando ambos estão offline.

## Não escopo

- Substituir o print-agent existente (continua independente).
- Pedidos via interface própria (operador continua usando gestor do iFood).
- Dedupe centralizado no backend (YAGNI v1).
- Linux (Windows + Mac apenas).

## Arquivos a tocar

**Repo novo:**
- `delivery-ifood-agent-electron/` (estrutura completa acima).

**Backend (`delivery-saas-backend/`):**
- `prisma/schema.prisma` — 2 campos novos em `PrinterSetting`.
- `src/index.js` — middleware Socket.IO aceita `ifoodAgentToken`.
- `src/socketEmitters.js` — filtro `emitirIfoodChat` aceita `ifoodAgent`.
- `src/routes/ifoodChat.js` — novo endpoint `POST /generate-agent-token`.

**Frontend (`delivery-saas-frontend/`):**
- Página "Configurações → Integrações → Agente iFood" — botões de download + gerar token + status.
- Aviso "sua loja não tem extensão nem agente conectados há 24h" (no Dashboard ou Header).

**Distribuição:**
- Build CI (workflow GitHub Actions ou similar) para gerar `.exe` e `.dmg` notarizado.
- Storage do release (S3 ou GitHub Releases).

## Testes mínimos

Unit (no main process do Electron):
- `ttlDedupe.isStale()` com diferentes `kind` e idades.
- `ttlDedupe.isAlreadySent()` com cache vazio, cheio, expirado.
- `failures.add()` mantém só 50 mais recentes.

Integration (manual):
- Fluxo onboarding: cola token inválido → erro claro; token válido → conecta.
- Recebe `ifood:chat` → envia mensagem real no iFood.
- Recebe `ifood:chat` stale (createdAt > TTL) → descarta com log.
- Recebe `ifood:chat` duplicado → descarta no 2º.
- Minimiza janela → ainda envia mensagem ao receber evento.
- Faz logout do iFood na webview → próxima mensagem falha com erro claro; recarregar resolve.
- Backend desconecta → indicador vai pra vermelho; reconecta automaticamente.

Coexistência:
- Extensão + agente conectados simultaneamente → backend emite para os 2; mensagem chega 1 vez no cliente final (ou 2 no pior caso, aceitável).
