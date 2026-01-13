# Development setup (backend + frontend on localhost)

This file explains the quick ways to run the project in development mode where both backend and frontend run on localhost and talk to each other.

Two options are supported:

1) Run with docker-compose (recommended, reproducible)

  - Builds ephemeral containers for a local Postgres and runs backend/frontend with source mounted for live reload.

  Open a PowerShell in the repository root and run:

```powershell
# start services (runs Postgres, backend and frontend)
docker compose -f .\docker-compose.dev.yml up --build

# stop and remove
docker compose -f .\docker-compose.dev.yml down
```

Notes:
  - Backend will be available at http://localhost:3000
  - Frontend (Vite) will be available at http://localhost:5173
  - The compose file uses `DISABLE_SSL=1` so the backend serves plain HTTP for local dev and CORS is configured to accept `http://localhost:5173`.

  If your host maps the frontend container to port 5173, use that port in the host URL (e.g. `http://deliverywl.com.br:5173`).

2) Run without Docker (native Node.js)

Prereqs: Node 20+, npm, and a local Postgres instance (or adjust DATABASE_URL to a local sqlite file if you prefer).

Backend:
```powershell
cd .\delivery-saas-backend
npm ci
# create a .env for local dev or copy from ../.env.dev
copy ..\.env.dev .\.env
# option A: start dev server (without auto-generating Prisma client)
npm run dev

# option B: one-step local dev that generates Prisma client, pushes schema and starts server
# (safe for local SQLite; DO NOT run this against production)
npm run dev:local
```

Frontend:
```powershell
cd .\delivery-saas-frontend
npm ci
# Vite will pick up .env.development values
npm run dev -- --host
```

What to change for production
- Set the backend `DATABASE_URL` to your production database connection string.
- Set `DISABLE_SSL=0` (or remove) if your app will manage TLS itself. When using a reverse proxy (EasyPanel, nginx) that terminates TLS, keep `DISABLE_SSL=1` and configure the proxy.
- Set `FRONTEND_ORIGIN` (or `FRONTEND_ORIGINS`) to your production frontend URL(s) (e.g. https://app.example.com).
- Build the frontend for production with VITE_API_URL set to your production API URL:

```powershell
# example (locally)
cd .\delivery-saas-frontend
setx VITE_API_URL "https://api.example.com" /M
npm run build
```

Or use CI to inject `VITE_API_URL` as a build-arg into the frontend Docker image (recommended for reproducible builds).

Quick checklist
- [ ] Run `docker compose -f docker-compose.dev.yml up` and confirm both servers are reachable.
- [ ] Test the frontend in the browser at http://localhost:5173 and confirm API calls reach http://localhost:3000.

Dev convenience: one-shot launcher
---------------------------------
If you prefer a very simple developer flow that starts backend, frontend and the print agent with a single command, use the `start-all.ps1` script in the repo root.

Usage:

```powershell
# from repo root
.\start-all.ps1
```

What it does:
- Generates a short random token and writes it to `.print-agent-token`.
- Starts backend, frontend and the print agent in separate PowerShell windows, exporting `PRINT_AGENT_TOKEN` into each process so they can authenticate automatically.

Important: this is a developer convenience only. For production use a proper secret store and register agent tokens from the backend admin UI.

#run projeto
pull origin develop && docker compose -f docker-compose.yml -f docker-compose.prod.yml down && docker compose -f docker-compose.prod.yml up -d --build



command run project
Aqui está o passo a passo de como você deve fazer:

1. Alterar o Schema

precisa ter um arquivo .env.migration


DATABASE_URL="postgresql://tomgomes:03t01F007TF@72.60.7.28:5432/tomgomes"
DB_HOST=delivery_db
DB_USER=tomgomes
DB_NAME=tomgomes
DB_PORT=5432
 
 
Abra o arquivo prisma/schema.postgres.prisma e adicione o novo campo ao modelo desejado.

Code snippet

model User {
  id    Int    @id @default(autoincrement())
  name  String
  email String @unique
  phone String? // <--- Novo campo adicionado
}
2. Gerar a Migration (Na sua máquina local)
Para que o Prisma crie o arquivo SQL que altera o banco, rode o comando que configuramos no seu package.json:

Bash

npm run migrate
O que isso faz: O Prisma compara seu schema com o banco, cria uma nova pasta em prisma/migrations contendo o comando ALTER TABLE... e atualiza o seu Prisma Client local.

3. Enviar para o Servidor
Faça o commit e o push dessas alterações (incluindo a nova pasta de migrations que foi gerada):

Bash

git add .
git commit -m "add phone field to user"
git push origin develop
4. Atualizar o Servidor (Produção)
Agora, no servidor, você roda aquele comando completo que discutimos:

Bash

git pull origin develop && \
docker compose -f docker-compose.prod.yml up -d --build
Por que esse fluxo é seguro?
Histórico: A pasta prisma/migrations mantém o registro de todas as mudanças.

Automação: Como seu Dockerfile roda o script wait-for-db-and-migrate.js, assim que o container subir com a nova imagem, ele vai detectar a nova migration e aplicar o prisma migrate deploy automaticamente no Postgres.

Consistência: O campo novo existirá tanto no banco de dados quanto nas tipagens do seu código Node.js.

Uma dica importante:
Nunca altere o banco de dados manualmente (via DBeaver, pgAdmin, etc). Sempre altere o schema.postgres.prisma e gere uma migration. Se você alterar o banco por fora, o Prisma pode se perder e tentar sobrescrever suas mudanças.


