# Delivery SaaS

Sistema de gestão de pedidos para delivery — backend Express + Prisma + PostgreSQL, frontend Vue 3 + Vite, tudo orquestrado via Docker.

---

## Desenvolvimento local

**Pré-requisitos**: Docker Desktop instalado e rodando.

```bash
# 1. Iniciar todos os serviços (banco, backend, frontend)
docker compose up -d

# 2. Acompanhar logs do backend
docker compose logs -f backend

# 3. Parar tudo
docker compose down
```

| Serviço  | URL                    |
|----------|------------------------|
| Frontend | http://localhost:5173  |
| Backend  | http://localhost:3000  |
| Banco    | localhost:5433         |

### Na primeira vez / após mudanças no schema

O `dev-start.sh` já roda `prisma db push` automaticamente ao subir o container. Não é necessário nenhum comando adicional.

### Variável OPENAI_API_KEY (importação AI de cardápio)

Defina no ambiente do sistema **antes** de subir o Docker:

```bash
# Windows (PowerShell) — persiste na sessão atual
$env:OPENAI_API_KEY = "sk-..."
docker compose up -d

# Windows (permanente, requer reiniciar o terminal)
[System.Environment]::SetEnvironmentVariable("OPENAI_API_KEY","sk-...","User")
```

---

## Instalar na VPS (primeira vez)

> Guia completo: [`deploy/DEPLOY-GUIDE.md`](deploy/DEPLOY-GUIDE.md)

```bash
# 1. Conectar na VPS
ssh root@IP_DO_SEU_VPS

# 2. Clonar o repositório
cd /opt
git clone https://github.com/thomaz-gomes/projetoDelivery.git delivery
cd /opt/delivery

# 3. Criar arquivo de configuração
cp deploy/.env.example deploy/.env
nano deploy/.env   # preencha os valores obrigatórios (veja abaixo)

# 4. Executar setup inicial (Docker, Nginx, SSL)
bash deploy/scripts/setup-vps.sh

# 5. Primeiro deploy
docker compose -f deploy/docker-compose.production.yml up -d --build
```

### Variáveis obrigatórias no `deploy/.env`

```env
API_DOMAIN=api.seudominio.com.br
APP_DOMAIN=app.seudominio.com.br

VITE_API_URL=https://api.seudominio.com.br
PUBLIC_FRONTEND_URL=https://app.seudominio.com.br
FRONTEND_ORIGIN=https://app.seudominio.com.br

POSTGRES_USER=delivery
POSTGRES_PASSWORD=SuaSenhaForteAqui!
POSTGRES_DB=delivery_prod
DATABASE_URL=postgresql://delivery:SuaSenhaForteAqui%21@delivery_db:5432/delivery_prod

JWT_SECRET=   # gere com: openssl rand -base64 32

SSL_EMAIL=seu@email.com
```

> **Atenção**: Se a senha tiver caracteres especiais (`#`, `@`, `!`, `%`), faça URL-encode na `DATABASE_URL`:
> `#` → `%23` | `@` → `%40` | `!` → `%21`

---

## Atualizar na VPS (nova versão)

```bash
ssh root@IP_DO_SEU_VPS
cd /opt/delivery
bash deploy/scripts/update.sh
```

O script faz automaticamente: backup do banco → `git pull` → rebuild → reinício dos containers → verificação de saúde.

### Atualização manual (sem o script)

```bash
cd /opt/delivery

# Salvar .env (garantia)
cp deploy/.env /tmp/deploy-env-backup

# Atualizar código
git pull origin main

# Rebuild e restart
docker compose -f deploy/docker-compose.production.yml up -d --build

# Verificar
docker compose -f deploy/docker-compose.production.yml ps
curl https://api.seudominio.com.br/health
```

---

## Mudanças no schema do banco

Tanto dev quanto produção usam `prisma db push` — não há arquivos de migration para gerenciar.

```bash
# 1. Edite prisma/schema.prisma
# 2. Localmente: reinicie o backend (ou force restart)
docker compose restart backend
# O dev-start.sh aplica o db push automaticamente

# 3. Na VPS: o deploy já aplica o push via wait-for-db-and-migrate.js
bash deploy/scripts/update.sh
```

---

## Estrutura do projeto

```
projetoDelivery/
├── delivery-saas-backend/      # API Express + Prisma
├── delivery-saas-frontend/     # Vue 3 + Vite
├── delivery-print-agent/       # Agente de impressão (Windows)
├── deploy/
│   ├── .env.example            # Template de configuração de produção
│   ├── docker-compose.production.yml
│   ├── DEPLOY-GUIDE.md         # Guia completo de deploy
│   └── scripts/
│       ├── setup-vps.sh        # Setup inicial (rodar 1x)
│       ├── update.sh           # Atualização de produção
│       └── backup-db.sh        # Backup manual do banco
├── docker-compose.yml          # Dev local (igual docker-compose.dev.yml)
└── docker-compose.dev.yml      # Dev local (referência)
```

---

## Comandos úteis

```bash
# --- Dev local ---
docker compose up -d                          # Subir tudo
docker compose down                           # Parar tudo
docker compose restart backend                # Reiniciar só o backend
docker compose logs -f backend                # Logs do backend em tempo real
docker compose exec backend sh                # Shell no container do backend

# --- Produção (VPS) ---
# (prefixe todos com: cd /opt/delivery)
docker compose -f deploy/docker-compose.production.yml ps
docker compose -f deploy/docker-compose.production.yml logs -f backend
docker compose -f deploy/docker-compose.production.yml restart backend
docker compose -f deploy/docker-compose.production.yml exec delivery_db psql -U delivery delivery_prod
bash deploy/scripts/backup-db.sh             # Backup manual
```
