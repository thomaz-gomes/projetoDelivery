Deploy para EasyPanel — instruções

Este documento descreve como configurar o deploy automático do repositório para o EasyPanel.

Visão geral
- O workflow do GitHub Actions (".github/workflows/build-and-push.yml") constrói duas imagens Docker (backend e frontend) e publica no GitHub Container Registry (GHCR).
- Opcionalmente o workflow notifica um webhook do EasyPanel (se configurado) para acionar o deploy automático.

Pré-requisitos
- Conta GitHub e permissões do repositório para adicionar secrets.
- Dockerfiles presentes no repositório (`delivery-saas-backend/Dockerfile` e `delivery-saas-frontend/Dockerfile`).
- EasyPanel configurado no servidor com acesso para puxar imagens do GHCR ou aceitar webhook de deploy.

Passo a passo

1) Habilitar o GHCR para o repositório

- O workflow usa o `GITHUB_TOKEN` para autenticar no GHCR e publicar imagens. Em repositórios públicos isso costuma funcionar sem configuração adicional. Para repositórios privados, verifique permissões do token.

2) Adicionar secret (opcional): `EASYPANEL_DEPLOY_HOOK`

- Se o seu EasyPanel ou um serviço de automação expor um webhook que inicia um deploy (ou pull), adicione a URL do webhook como secret no repositório: Settings > Secrets and variables > Actions > New repository secret.
- Nome: `EASYPANEL_DEPLOY_HOOK`
- Exemplo do payload enviado pelo workflow (POST JSON):

  { "ref": "refs/heads/develop", "backend": "ghcr.io/OWNER/projetodelivery-backend:develop", "frontend": "ghcr.io/OWNER/projetodelivery-frontend:develop" }

3) Configurar o EasyPanel para usar as imagens

Opção A — EasyPanel puxa imagens do GHCR (recomendado)

- No painel do EasyPanel crie/edite o app Backend:
  - Image: `ghcr.io/<GITHUB_OWNER>/projetodelivery-backend:develop` (ou tag desejada)
  - Configure env vars (DATABASE_URL, JWT_SECRET, etc.) como secrets no EasyPanel.
  - Ports: mapear 3000 para a porta desejada.
  - Volumes: mapeie persistência se precisar (uploads, etc.).
- Crie/edite o app Frontend:
  - Image: `ghcr.io/<GITHUB_OWNER>/projetodelivery-frontend:develop`
  - Configure porta 80 e, se quiser, variáveis de ambiente (por ex. VITE_API_URL apontando para backend público).

Opção B — EasyPanel faz build diretamente do repositório (se suportado)

- Informe a URL do repositório e a branch `develop` e defina o caminho do Dockerfile (ex.: `delivery-saas-backend/Dockerfile`).

4) Deploy automático

- Com o workflow, sempre que houver push na branch `develop` o Action fará build e push para GHCR.
- Se `EASYPANEL_DEPLOY_HOOK` estiver configurado, o Action irá chamar o webhook após publicar as imagens — configure o EasyPanel para responder ao webhook e puxar as imagens (ou use um script no servidor que faça `docker pull` e `docker-compose up -d`).

Exemplo de script remoto para servidor (executar via SSH no servidor EasyPanel)

```
#!/bin/sh
docker pull ghcr.io/OWNER/projetodelivery-backend:develop
docker pull ghcr.io/OWNER/projetodelivery-frontend:develop
docker-compose -f /path/to/docker-compose.prod.yml up -d
```

Notas e recomendações
- Segurança: mantenha segredos (DB, JWT secret) apenas no EasyPanel e no GitHub Secrets quando necessário.
- Migrations: defina como executar migrations do Prisma com segurança. Recomendo rodar `npx prisma migrate deploy` manualmente ou via job controlado antes de apontar tráfego para a nova versão.
- Rollback: use tags ou versões semânticas nas imagens para facilitar rollback.

Próximos passos que posso fazer por você
- Gerar um `docker-compose.prod.yml` exemplo e um pequeno script de deploy para o servidor EasyPanel.
- Criar um arquivo com a lista de variáveis de ambiente necessárias (posso inspecionar o código para descobrir variáveis usadas).

## Variáveis de ambiente (backend)
Seguem as variáveis de ambiente usadas pelo backend, com explicação e valores de exemplo. Marque como "secret" aquelas que devem ficar somente no painel (EasyPanel) ou em um cofre.

- DATABASE_URL (required) — string de conexão do Prisma. Exemplo: `postgres://app:strongpass@db:5432/appdb` ou `file:./prisma/prisma/dev.db` para dev. (secret)
- PORT — porta onde o backend escuta (padrão: `3000`).
- HOST — host label para logs/URL do servidor (usado apenas para imprimir a URL em logs). Exemplo: `example.com`.
- JWT_SECRET (required) — segredo para assinar JWTs (usado em `src/auth.js`). Exemplo: `your-very-secret-key` (secret)
- PUBLIC_FRONTEND_URL — URL pública do frontend (usada para gerar links públicos, ex.: `/rider/claim`). Exemplo: `https://app.example.com`.
- FRONTEND_ORIGIN — origem permitida para CORS/headers (ex.: `https://app.example.com`).
- IFOOD_WEBHOOK_SECRET — segredo para validar assinaturas de webhooks do iFood (secret).
- IFOOD_CLIENT_ID, IFOOD_CLIENT_SECRET, IFOOD_MERCHANT_ID — credenciais usadas para integrações com iFood (client id/secret + merchant opcional). (secret)
- IFOOD_BASE_URL, IFOOD_AUTH_BASE, IFOOD_USER_CODE_PATH, IFOOD_TOKEN_PATH, IFOOD_VERIFICATION_URL_DEFAULT — endpoints configuráveis da API iFood (padrões já presentes no `.env`).
- IFOOD_POLL_INTERVAL_MS, IFOOD_POLL_MAX_CONCURRENCY — configuração do worker de polling do iFood (intervalo em ms e concorrência).
- EVOLUTION_API_BASE_URL, EVOLUTION_API_API_KEY — URL e chave da API Evolution (WhatsApp integration). (secret)
- CERT_STORE_KEY — chave usada para criptografar segredos do store de certificados (base64/hex raw). Necessário para `src/utils/secretStore.js`. (secret)
- SSL_KEY_PATH, SSL_CERT_PATH, SSL_CA_PATH — caminhos para arquivos SSL (PEM). Se não informados, o servidor procura arquivos na pasta `ssl/`.
- NODE_ENV — ambiente (`development` | `production`). Afeta comportamento (ex.: respostas com menos dados em produção).
- OPENAI_API_KEY — chave para integração com OpenAI (se usada). (secret)
- USE_AI_PARSER — flag para habilitar parser AI (ex.: `true`/`false`).
- PRINTER_INTERFACE, PRINTER_TYPE, PRINTER_WIDTH — configuração de impressoras/receivers.

Notas:
- Valores sensíveis (DATABASE_URL, JWT_SECRET, IFOOD_CLIENT_SECRET, EVOLUTION_API_API_KEY, CERT_STORE_KEY, OPENAI_API_KEY, IFOOD_WEBHOOK_SECRET) devem ser definidos apenas no EasyPanel como secrets e nunca comitados no repositório.
- Para ambientes com DB externo (RDS, Cloud SQL), a `DATABASE_URL` deve apontar para o serviço gerenciado e o container do backend deve ter a variável definida no painel.

Se quiser, posso gerar um arquivo de exemplo `prod.env.example` com todas essas variáveis listadas (sem valores sensíveis). Quer que eu adicione esse arquivo ao repositório?
