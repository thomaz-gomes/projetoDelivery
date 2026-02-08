# AI Coding Agent Instructions

These guidelines capture project-specific practices so an AI agent can be immediately productive in this repo.

## Overview
- Three services: Backend (Node/Express + Prisma + Socket.IO), Frontend (Vue 3 + Vite), Local Print Agent (Node, Socket.IO client).
- Data flow: Backend emits order events → Frontend dashboards receive `novo-pedido`; targeted print jobs are delivered to agent sockets and processed locally.
- Dev runs with Docker Compose or bare Node; production uses Compose with Postgres and containerized backend/frontend.

## Quick Start
- Dev guide: see [README_DEV.md](README_DEV.md) for Windows/PowerShell setup and bare Node workflow.
- Deploy guide: see [README_EASYPANEL.md](README_EASYPANEL.md) for EasyPanel deployment conventions and ports.
- Dev compose: see [docker-compose.dev.yml](docker-compose.dev.yml) to run backend/frontend with Postgres locally.
- Local compose preview: see [docker-compose.yml](docker-compose.yml) and [docker-compose.prod.yml](docker-compose.prod.yml).
- DB setup: see [scripts/setup-dev-db.ps1](scripts/setup-dev-db.ps1) and [scripts/setup-dev-db.sh](scripts/setup-dev-db.sh).
- First order smoke test: see [scripts/smoke_post_public_order.mjs](scripts/smoke_post_public_order.mjs).

## Components & Data Flow
- Backend: see [delivery-saas-backend/src/index.js](delivery-saas-backend/src/index.js) and [delivery-saas-backend/src/server.js](delivery-saas-backend/src/server.js).
  - Socket.IO attached in `attachSocket()`; agent auth via `handshake.auth.token` and `storeIds` validated against per-company `PrinterSetting.agentTokenHash`.
  - Emits: `emitirNovoPedido()` broadcasts to non-agent sockets; `emitirPedidoAtualizado()` broadcasts `order-updated`.
  - Agent endpoints: [delivery-saas-backend/src/routes/agentSetup.js](delivery-saas-backend/src/routes/agentSetup.js) (`GET /agent-setup`, `POST /agent-setup/token`, `POST /agent-setup/print-test`).
- Frontend: see [delivery-saas-frontend/vite.config.js](delivery-saas-frontend/vite.config.js).
  - Proxies `/api`, `/auth`, `/socket.io`, `/agent-setup`, `/agent-print` to backend; respects `VITE_API_URL`.
  - HMR is auto-disabled on Node ≥ 24 or `VITE_DISABLE_HMR=1` to avoid Windows crashes.
- Print Agent: see [delivery-print-agent/index.js](delivery-print-agent/index.js) and [delivery-print-agent/README.md](delivery-print-agent/README.md).
  - Connects with `socket.io-client`; sends `auth.token` and `storeIds`; prints via `node-thermal-printer`.

## Dev Workflows
- Docker (dev): use [docker-compose.dev.yml](docker-compose.dev.yml).
  - Backend: Node 20, runs `npm ci`, `prisma generate`, `prisma db push`, `npm run dev`.
  - Frontend: `npm ci`, `npm run dev -- --host 0.0.0.0`; `VITE_API_URL=http://localhost:3000`.
- Docker (local prod preview): see [docker-compose.yml](docker-compose.yml) and [docker-compose.prod.yml](docker-compose.prod.yml).
  - Includes `migrate` job ([delivery-saas-backend/scripts/wait-for-db-and-migrate.js](delivery-saas-backend/scripts/wait-for-db-and-migrate.js)).
- Bare Node (Windows):
  - Backend:
    ```powershell
    cd delivery-saas-backend
    npm ci
    $env:DATABASE_URL = 'postgres://postgres:postgres@localhost:5432/projetodelivery'
    npm run dev
    ```
  - Frontend:
    ```powershell
    cd delivery-saas-frontend
    npm ci
    $env:VITE_API_URL = 'http://localhost:3000'
    npm run dev
    ```
  - Backend tests:
    ```powershell
    cd delivery-saas-backend
    npm run test:unit
    ```

## Modules & SaaS
- Routers gated by modules when `ENFORCE_MODULES=1`:
  - Printing: [delivery-saas-backend/src/index.js](delivery-saas-backend/src/index.js#L160-L190) gates `/agent-print` via `requireModule('printing')`.
  - NFE: `/nfe` via `requireModule('nfe')`.
  - iFood: `/ifood` via `requireModule('ifood')`.
- Middleware: [delivery-saas-backend/src/modules.js](delivery-saas-backend/src/modules.js) provides `requireModule()` and a cache; disabled unless `ENFORCE_MODULES` is true.
- Admin APIs: [delivery-saas-backend/src/routes/saas.js](delivery-saas-backend/src/routes/saas.js)
  - `GET /saas/modules` (SUPER_ADMIN), `POST /saas/modules`, `PUT/DELETE /saas/modules/:id`.
  - `GET /saas/plans`, `POST /saas/plans`, `PUT/DELETE /saas/plans/:id` with module assignments.
  - `POST /saas/subscriptions` and `GET /saas/subscription/me`.
  - `GET /saas/modules/me` returns enabled module keys for the current company.

## Printing & Agent Tokens
- Token lifecycle: per-company token stored as SHA256 in `PrinterSetting`.
  - Admin rotates via `POST /agent-setup/token`; plaintext token is returned once. See [delivery-saas-backend/docs/agent-tokens.md](delivery-saas-backend/docs/agent-tokens.md).
  - Dev convenience files: `.print-agent-token` and `.print-agent-company` auto-register token on backend startup.
- Agent connects with `handshake.auth = { token, storeIds }`; rejected on `invalid-agent-token` or missing `storeIds`.
- Print test: `POST /agent-setup/print-test` targets connected agent sockets for a `storeId`.

## Conventions & Patterns
- CORS: configured via `FRONTEND_ORIGINS` or `FRONTEND_ORIGIN`; dev allows all origins. See [delivery-saas-backend/src/index.js](delivery-saas-backend/src/index.js).
- Socket targeting: backend avoids broadcasting print jobs to agent sockets; uses targeted emits and a queue in [delivery-saas-backend/src/printQueue.js](delivery-saas-backend/src/printQueue.js).
- Debug routes (dev-only): `/debug/agents`, `/debug/disconnect-agents`, `/debug/agent-print`, `/debug/emit-test-order`.
- Roles & permissions: static maps in [settings/rolePermissions.json](settings/rolePermissions.json) and labels in [settings/permissionMetadata.json](settings/permissionMetadata.json).

## SSL & Dev Certificates (Windows)
- Vite HTTPS optional via `VITE_DEV_HTTPS=1` and cert files under [delivery-saas-frontend/ssl](delivery-saas-frontend/ssl).
- Helper scripts: [dev-apply-cert.ps1](dev-apply-cert.ps1) and [sync-cert-backend-to-frontend.ps1](sync-cert-backend-to-frontend.ps1).
  - These copy/convert certs between backend/ frontend `ssl/` folders and guide restarts.

## Useful Examples
- Smoke test a public order: [scripts/smoke_post_public_order.mjs](scripts/smoke_post_public_order.mjs).
- Print Agent: [delivery-print-agent/README.md](delivery-print-agent/README.md).

## When modifying code
- For backend routes, mount under existing prefixes (`/orders`, `/agent-setup`, etc.) and reflect changes in the frontend proxies.
- For agent-related features, keep `handshake.auth` contract stable and update token logic via `rotateAgentToken()`.
- For DB changes, prefer Postgres schema and run `prisma generate` + migrations; in Docker, rely on the `migrate` service.
