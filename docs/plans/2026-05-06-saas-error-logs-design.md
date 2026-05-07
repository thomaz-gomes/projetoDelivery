# SaaS Error Logs — Design

**Data**: 2026-05-06
**Escopo**: Tela de monitoramento de logs de erro do sistema acessível pelo SaaS Admin.

## Objetivo

Capturar automaticamente erros do backend (apenas erros — não logs informacionais) e expor uma tela em `/saas/error-logs` para SUPER_ADMIN visualizar, marcar como solucionado e apagar.

## Decisões

- **Escopo de captura**: apenas backend (Express).
- **Mecanismo**: middleware Express de erro + handlers `uncaughtException`/`unhandledRejection`. Não substitui `console.error` global e não exige refator.
- **Dedup**: agrupamento por `fingerprint = sha256(message + route).slice(0,16)`. Erros idênticos incrementam `occurrences` e atualizam `lastSeen` em vez de criar nova linha.
- **Retenção**: auto-purga diária de logs com `resolved=true AND resolvedAt < now() - 90 dias`. Logs abertos nunca são purgados automaticamente.
- **Reabertura**: erro que reaparece após ser marcado como resolvido volta para `resolved=false` no `upsert`.

## Modelo de dados

Novo modelo Prisma em [delivery-saas-backend/prisma/schema.prisma](../../delivery-saas-backend/prisma/schema.prisma):

```prisma
model ErrorLog {
  id           Int       @id @default(autoincrement())
  fingerprint  String    @unique
  message      String    @db.Text
  stack        String?   @db.Text
  route        String?
  method       String?
  statusCode   Int?
  companyId    String?
  userId       String?
  occurrences  Int       @default(1)
  firstSeen    DateTime  @default(now())
  lastSeen     DateTime  @default(now())
  resolved     Boolean   @default(false)
  resolvedAt   DateTime?
  resolvedBy   String?
  company      Company?  @relation(fields: [companyId], references: [id], onDelete: SetNull)

  @@index([resolved, lastSeen])
  @@index([companyId])
}
```

Aplicar via `prisma db push` (padrão de desenvolvimento do projeto).

## Backend

### `src/utils/errorLogger.js` (novo)

Função `logError({ err, req? })` que:

1. Extrai `message`, `stack`, `route` (`req.method + req.originalUrl`), `statusCode`, `companyId` (de `req.user`), `userId`.
2. Calcula `fingerprint = sha256(message + route).slice(0, 16)`.
3. Faz `prisma.errorLog.upsert({ where: { fingerprint }, create, update })`:
   - `create`: todos os campos, `occurrences: 1`.
   - `update`: `occurrences: { increment: 1 }`, `lastSeen: now()`, `resolved: false`, `resolvedAt: null`.
4. Envolve tudo em try/catch — se o logging falhar, não pode crashar a app.

### Integrações

**Middleware Express** ([delivery-saas-backend/src/index.js](../../delivery-saas-backend/src/index.js)) — após todas as rotas:

```js
app.use((err, req, res, next) => {
  logError({ err, req });
  next(err);
});
```

**Process handlers** ([delivery-saas-backend/src/server.js](../../delivery-saas-backend/src/server.js)) — no startup:

```js
process.on('uncaughtException', err => logError({ err }));
process.on('unhandledRejection', reason => {
  logError({ err: reason instanceof Error ? reason : new Error(String(reason)) });
});
```

**Job de purga** (também em `server.js`): `setInterval` 24h que executa
```js
prisma.errorLog.deleteMany({
  where: { resolved: true, resolvedAt: { lt: new Date(Date.now() - 90*24*60*60*1000) } }
});
```

### Endpoints

Adicionar em [delivery-saas-backend/src/routes/saas.js](../../delivery-saas-backend/src/routes/saas.js) (todos protegidos por SUPER_ADMIN como demais rotas SaaS):

| Método | Rota | Descrição |
|---|---|---|
| GET | `/saas/error-logs` | Lista paginada (50/pág). Query: `status=open\|resolved\|all`, `q=texto`, `page=N`. Ordem `lastSeen DESC`. Inclui `company.name`. |
| PATCH | `/saas/error-logs/:id/resolve` | Toggle `resolved`. Quando true, grava `resolvedAt=now()` e `resolvedBy=req.user.id`. |
| DELETE | `/saas/error-logs/:id` | Apagar um log. |
| POST | `/saas/error-logs/purge-resolved` | Apaga todos os logs com `resolved=true`. Retorna `{ count }`. |

## Frontend

### Nova view `delivery-saas-frontend/src/views/SaasErrorLogs.vue`

Usa o design system do projeto:

- `<ListCard>` com `title`, `quick-search`, `actions` (botões "Atualizar" e "Limpar solucionados") e `filters` (tabs `nav-tabs` para Abertos/Solucionados/Todos).
- Tabela `<table class="table table-hover align-middle">` com colunas: Última ocorrência, Mensagem (+ badge `×N`), Rota (`<code>`), Empresa, Status (badge), Ações.
- Linha expansível (toggle por chevron) que mostra `firstSeen`, `statusCode`, `userId` e `stack` em `<pre class="small bg-zebra p-3 rounded">`.
- Botões de ação por linha: `<BaseIconButton color="success">` para resolver e `<BaseIconButton color="danger">` para apagar — ambos com confirmação `Swal.fire({ icon: 'warning', showCancelButton: true })`.
- Estado vazio (modo "Abertos"): card centralizado com `bi-shield-check` e mensagem "Nenhum erro registrado — sistema operando normalmente".
- Polling: `load()` em `onMounted` + `setInterval(30000)`. `onBeforeUnmount` limpa o intervalo.

### Roteamento

Adicionar em [delivery-saas-frontend/src/router.js](../../delivery-saas-frontend/src/router.js):

```js
{ path: '/saas/error-logs', component: SaasErrorLogs,
  meta: { requiresAuth: true, role: 'SUPER_ADMIN' } }
```

Adicionar `['/saas/error-logs', 'Logs de erro']` na lista de breadcrumbs.

### Card no painel SaaS

Em [delivery-saas-frontend/src/views/SaasAdmin.vue](../../delivery-saas-frontend/src/views/SaasAdmin.vue):

- Adicionar `errorLogsOpen` ao `Promise.all` em `load()` via `api.get('/saas/error-logs?status=open&page=1').then(r => r.data.total)`.
- Novo stat tile no `stats` computed:
  ```js
  { label: 'Logs de erro', value: errorLogsOpen.value,
    icon: 'bi-exclamation-triangle',
    color: errorLogsOpen.value > 0 ? 'danger' : 'success',
    to: '/saas/error-logs', sub: 'em aberto' }
  ```

## Tratamento de erros

- O próprio logger nunca pode crashar — todo o `upsert` envolto em try/catch que apenas faz `console.error('errorLogger failed:', e)` em caso de falha.
- O middleware repassa o erro original para o handler padrão do Express — comportamento HTTP existente não muda.
- Endpoints da tela retornam 500 padrão em caso de falha no Prisma; UI exibe `Swal.fire({ icon: 'error' })`.

## Testes

Foco em testes manuais (alinhado ao padrão do projeto):

1. Forçar erro em rota existente (ex: `throw new Error('test')` temporário) → conferir registro com `occurrences=1`.
2. Disparar mesmo erro 3x → conferir `occurrences=3` e `lastSeen` atualizado, sem nova linha.
3. Marcar como solucionado → conferir badge muda e linha some do filtro "Abertos".
4. Disparar mesmo erro novamente → conferir reabertura (`resolved=false`).
5. Apagar log → conferir remoção.
6. Login como ADMIN comum → conferir 403 nos endpoints e bloqueio da rota.

## Arquivos novos vs. alterados

**Novos**:
- `delivery-saas-backend/src/utils/errorLogger.js`
- `delivery-saas-frontend/src/views/SaasErrorLogs.vue`

**Alterados**:
- `delivery-saas-backend/prisma/schema.prisma` — modelo `ErrorLog` + relação em `Company`
- `delivery-saas-backend/src/index.js` — middleware de erro
- `delivery-saas-backend/src/server.js` — process handlers + purge job
- `delivery-saas-backend/src/routes/saas.js` — 4 endpoints
- `delivery-saas-frontend/src/router.js` — rota + breadcrumb
- `delivery-saas-frontend/src/views/SaasAdmin.vue` — stat tile

## Fora de escopo (YAGNI)

- Captura de erros frontend.
- Captura de eventos não-erro (info, warn, debug).
- Notificações por e-mail/Slack quando novo erro aparece.
- Exportação CSV/JSON.
- Filtros avançados (período, empresa, severidade).
- Gráficos de tendência.
