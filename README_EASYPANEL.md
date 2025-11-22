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
