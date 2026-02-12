# Módulo: WhatsApp (WHATSAPP)

## Descrição
Este módulo integra o sistema com o WhatsApp Business via Evolution API, permitindo criar instâncias, conectar dispositivos via QR Code e enviar mensagens.

## Chave do módulo
`WHATSAPP`

## Funcionalidades
- **Gerenciamento de Instâncias** — Criar e remover instâncias WhatsApp por loja
- **Conexão via QR Code** — Gerar QR Code para conectar dispositivo
- **Status** — Consultar status da conexão (CONNECTED, DISCONNECTED, QRCODE, etc.)
- **Envio de Mensagens** — Enviar mensagens de texto para números

## Rotas
- `POST /wa/instances` — Criar instância
- `GET /wa/instances` — Listar instâncias da empresa
- `GET /wa/instances/:name/status` — Status da instância
- `GET /wa/instances/:name/qr` — Obter QR Code
- `POST /wa/instances/:name/send-text` — Enviar mensagem
- `DELETE /wa/instances/:name` — Remover instância

## Dependências
- Prisma model: `WhatsAppInstance`
- Service: `src/wa.js` (Evolution API client)
