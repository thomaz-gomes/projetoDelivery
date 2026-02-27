# Desenvolvimento local

O projeto roda **exclusivamente via Docker** em desenvolvimento. Não é necessário instalar Node.js localmente.

## Pré-requisitos

- Docker Desktop instalado e rodando

## Iniciar

```bash
# Na raiz do repositório
docker compose up -d
```

Isso sobe 3 containers:

| Container | Porta  | Descrição                        |
|-----------|--------|----------------------------------|
| db        | 5433   | PostgreSQL (dados em volume)     |
| backend   | 3000   | Express + Prisma (hot-reload)    |
| frontend  | 5173   | Vue 3 + Vite (hot-reload)        |

O backend aguarda o banco estar saudável antes de iniciar. O `dev-start.sh` executa:
1. `npm ci` — instala dependências
2. `prisma generate` — gera o Prisma Client
3. `prisma db push --skip-generate` — sincroniza o schema com o banco
4. `npm run dev` — inicia com nodemon

## Parar

```bash
docker compose down         # Para e remove os containers (banco persiste no volume)
docker compose down -v      # Para, remove containers E apaga o volume do banco
```

## Variável OPENAI_API_KEY

Para usar a importação de cardápio com IA, defina a variável **antes** de subir o Docker:

```powershell
# PowerShell — válido na sessão atual
$env:OPENAI_API_KEY = "sk-..."
docker compose up -d
```

```powershell
# Permanente (reinicie o terminal após executar)
[System.Environment]::SetEnvironmentVariable("OPENAI_API_KEY","sk-...","User")
```

## Mudanças no schema

1. Edite [`delivery-saas-backend/prisma/schema.prisma`](delivery-saas-backend/prisma/schema.prisma)
2. Reinicie o backend — o `db push` é aplicado automaticamente:
   ```bash
   docker compose restart backend
   ```

Não há arquivos de migration para criar ou gerenciar. O `prisma db push` sincroniza diretamente.

## Logs

```bash
docker compose logs -f backend    # Backend em tempo real
docker compose logs -f frontend   # Frontend em tempo real
docker compose logs -f            # Todos os serviços
```

## Shell no container

```bash
docker compose exec backend sh    # Shell no backend
docker compose exec db psql -U postgres projetodelivery   # Banco direto
```
