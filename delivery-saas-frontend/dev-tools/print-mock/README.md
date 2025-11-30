# Print mock tools

Este diretório contém utilitários leves para testar fluxos de impressão durante o
desenvolvimento. A dependência de QZ Tray foi removida — em vez de usar um
mock WebSocket, o fluxo recomendado agora é enviar a impressão para um endpoint
HTTP local (por exemplo `/api/print`) que sua API/backend ou um agente local
pode processar.

Arquivos

- `http-print-receiver.js` — um servidor Express simples com `POST /print` que
	salva payloads JSON em `prints-http/` para inspeção.

Quick start (PowerShell)

1. Abra um terminal neste diretório:

```powershell
cd .\delivery-saas-frontend\dev-tools\print-mock
```

2. Instale dependências para o receiver HTTP (se ainda não instalou):

```powershell
npm install express body-parser
```

3. Execute o receiver HTTP:

```powershell
node http-print-receiver.js
# escuta em http://localhost:4000 por padrão
```

4. Aponte seu frontend para `http://localhost:4000/print` (ou para o endpoint
da sua API) para testar o payload de impressão sem depender do QZ Tray.

Notas

- O receiver é uma ferramenta de desenvolvimento e não implementa autenticação
	ou segurança. Use apenas em ambiente local.
- Os arquivos JSON salvos em `prints-http/` permitem inspecionar o conteúdo que
	teria sido enviado para impressão.

Se desejar, posso:

- Adicionar um script npm para iniciar o receiver mais facilmente.
- Ajudar a adaptar o frontend para enviar impressões diretamente ao backend/agent.

