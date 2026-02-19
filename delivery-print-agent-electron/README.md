# Delivery Print Agent (Electron v2)

Agente de impressão térmica para sistema de delivery — desktop robusta com suporte a impressoras USB, TCP/IP e Serial.

## Estrutura do Projeto

```
delivery-print-agent-electron/
├── main.js                      # Electron: lifecycle, tray, janelas, IPC
├── preload.js                   # Electron: bridge segura para o renderer
├── package.json
├── src/
│   ├── config.js                # Gerenciamento de config (JSON em %APPDATA%)
│   ├── logger.js                # Log diário com rotação (7 dias)
│   ├── tray.js                  # System Tray com indicador de status
│   ├── socketClient.js          # Socket.IO client + backoff exponencial
│   ├── printQueue.js            # Fila FIFO + retry (3x) + deduplicação
│   ├── printerManager.js        # Roteamento por categoria + listagem Windows
│   ├── templateEngine.js        # Motor: {{var}}, {{#each}}, {{#if}}, [SEP], [QR]
│   ├── defaultTemplate.js       # Templates padrão 80mm e 58mm
│   └── printing/
│       ├── index.js             # Dispatcher de interface
│       ├── escpos.js            # Construtor ESC/POS puro (sem dependências)
│       ├── network.js           # TCP/IP socket direto (porta 9100)
│       ├── usb.js               # Windows RAW via PowerShell/winspool.drv
│       └── serial.js            # COM port via serialport
├── renderer/
│   ├── index.html               # Painel de configuração
│   └── setup.html               # Wizard de primeiro uso
└── assets/
    ├── icon.ico                 # Ícone do app (forneça)
    ├── tray-green.png           # Ícone bandeja: conectado
    ├── tray-red.png             # Ícone bandeja: desconectado
    └── tray-yellow.png          # Ícone bandeja: conectando
```

## Requisitos

- Node.js 18+
- Windows 10/11 (x64)
- Para impressoras USB: driver instalado (recomendado: "Generic / Text Only")
- Para impressoras Serial: `npm install serialport` após `npm install`

## Desenvolvimento

```bash
npm install
npm start          # inicia em modo dev (NODE_ENV=development)
```

## Build do Instalador

```bash
# Instala dependências (electron-rebuild recompila módulos nativos)
npm install

# Gera instalador NSIS one-click em /dist
npm run build
```

O instalador gerado em `dist/Delivery Print Agent Setup 2.0.0.exe` instala com um clique e registra o app no auto-start do Windows.

## Configuração de Impressoras

### Parâmetros por Impressora

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `alias` | string | Nome amigável: "Cozinha 1", "Bar" |
| `interface` | `network` \| `usb` \| `serial` | Tipo de conexão |
| `host` | string | IP da impressora (rede) |
| `port` | number | Porta TCP, padrão `9100` |
| `windowsPrinterName` | string | Nome exato no Painel de Controle (USB) |
| `comPort` | string | Ex: `COM3` (Serial) |
| `baudRate` | number | Ex: `9600`, `19200` (Serial) |
| `width` | `58` \| `80` | Largura do papel em mm |
| `characterSet` | `PC850` \| `PC437` \| `UTF8` | Codepage para acentuação correta |
| `density` | 0–15 | Calor da cabeça térmica (padrão: `8`) |
| `marginLeft` | 0–10 | Margem esquerda em colunas |
| `copies` | 1–5 | Número de vias |
| `categories` | `["all"]` | Categorias que essa impressora recebe |
| `enabled` | bool | Liga/desliga |

### Roteamento por Categoria

- `["all"]` → recebe todos os pedidos
- `["food", "kitchen"]` → recebe apenas pedidos com itens dessas categorias
- O backend deve enviar `item.category` nos itens do pedido

## Sintaxe do Template

```
[ALIGN:center]         → centraliza
[BOLD:on] / [BOLD:off] → negrito
[SIZE:2] / [SIZE:1]    → dobra / restaura tamanho
[SEP]                  → linha ----
[SEP:=]                → linha ====
[FEED:3]               → avança 3 linhas
[QR:{{link_pedido}}]   → imprime QR Code
[CUT]                  → corta o papel

{{loja_nome}}           {{display_id}}    {{data}}    {{hora}}
{{cliente_nome}}        {{cliente_tel}}
{{endereco_rua}}        {{endereco_num}}  {{endereco_bairro}}
{{subtotal}}            {{taxa}}          {{desconto}}  {{total}}

{{#each items}}
  {{qtd}}x {{nome}}  {{preco}}
  {{#if obs}}Obs: {{obs}}{{/if}}
{{/each}}

{{#each pagamentos}}
  {{metodo}}: {{valor}}
{{/each}}
```

## Impressão USB sem Diálogo

O módulo `src/printing/usb.js` usa PowerShell + `winspool.drv` para enviar bytes RAW diretamente ao spooler do Windows. Nenhum diálogo aparece. Requer:
1. Impressora instalada com **driver "Generic / Text Only"** (ideal) ou driver nativo
2. Nome exato da impressora em `windowsPrinterName` (visível em "Dispositivos e Impressoras")

## Auto-start

O app usa `app.setLoginItemSettings({ openAtLogin: true })` do Electron para registrar no Windows Login Items — mais seguro que manipulação direta do registro.
