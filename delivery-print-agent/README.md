# Delivery Print Agent

Este agente roda localmente (no restaurante) e conecta ao backend SaaS via WebSocket para imprimir pedidos automaticamente em uma impressora térmica.

Principais funcionalidades:
- Conecta ao backend via `socket.io-client` usando um identificador (STORE_ID / token).
- Escuta evento `novo-pedido` e imprime automaticamente usando `node-thermal-printer`.
- Configuração via `.env`.
- Pode rodar em background com `pm2`.

Instalação

1. No servidor/terminal local do cliente (máquina que tem a impressora):

```powershell
cd delivery-print-agent
npm install
```

2. Copie o `.env` de exemplo e edite as variáveis necessárias. Você pode usar o instalador PowerShell para Windows automatizar isso:

```powershell
# execute no diretório delivery-print-agent
.\install.ps1
```

O instalador irá:
- verificar Node.js
- executar `npm install`
- copiar `config.example.env` para `.env` (se não existir) e abrir no Notepad para edição
- instalar `pm2` globalmente (se necessário) e iniciar o agente com `ecosystem.config.js`

Requisitos de autenticação
- O agente envia um token na conexão Socket.IO chamado `PRINT_AGENT_TOKEN`.
- Configure `PRINT_AGENT_TOKEN` em `.env` (ou em variável de ambiente) para que o backend valide a conexão.
- Se o token não estiver presente o agente irá encerrar com erro para evitar conexões não autorizadas.

Multi-store support
- If a single machine should handle printing for multiple stores in the same company, set `STORE_IDS` in the `.env` as a comma-separated list. The agent will send the list as `storeIds` in the Socket.IO `auth` payload. The backend can then map that token to multiple store records.
- Example: `STORE_IDS=store-1,store-2`

Exemplo mínimo de `.env` (já presente em `config.example.env`):

```
BACKEND_SOCKET_URL=https://your-saas-backend.example.com
STORE_ID=store-123
PRINTER_INTERFACE=printer:EPSON_TM_T20
PRINTER_TYPE=EPSON
DRY_RUN=false
LOG_DIR=./logs
```

Uso (manualmente sem instalador)

- Rodar manualmente para testar:

```powershell
npm start
```

- Rodar como serviço usando `pm2` (recomendado em produção):

```powershell
npm install -g pm2
pm2 start ecosystem.config.js --only delivery-print-agent
pm2 save
pm2 logs delivery-print-agent
```

Logs

- Logs básicos estão em `./logs/agent.log` por padrão.
- Em caso de falha na impressão, os payloads são salvos em `failed-print/`.

Notas

- `PRINTER_INTERFACE` depende do sistema operacional e do driver da impressora.
  - Windows: geralmente `printer:EPSON TM-T20` (nome do driver instaladoo)
  - Linux: `/dev/usb/lp0` ou `tcp://192.168.x.y` para impressoras de rede

- Se preferir autenticação por token, adapte o arquivo `index.js` para enviar token no `auth` do socket ou em query params.

- Teste com `DRY_RUN=true` para validar o fluxo sem enviar comandos para a impressora.

Segurança

- Execute o agente apenas em máquinas seguras e proteja o `.env` (contém tokens/identificadores).

Licença

Este é um exemplo de agente; adapte conforme necessidades do seu ambiente.
