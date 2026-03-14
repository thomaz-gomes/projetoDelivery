# Design: Plano TRIAL

**Data:** 2026-03-14
**Status:** Aprovado

## Resumo

Adicionar um plano fixo TRIAL ao sistema de planos SaaS. O plano é invisível para clientes, configurável pelo SUPER_ADMIN, e funciona como um upgrade temporário gratuito. Após expirar, a empresa reverte ao plano original. O cliente pode ativar o trial uma vez (futuro CTA); o admin pode resetar para permitir reativação.

## Abordagem

**Opção A (escolhida):** Trial como flag no `SaasPlan` + tabela `CompanyTrial` separada.

O plano TRIAL é um `SaasPlan` normal com `isTrial: true`. Uma tabela `CompanyTrial` rastreia o estado do trial por empresa (plano original, datas, status).

## Modelo de Dados

### Alterações no `SaasPlan`

Novos campos:
- `isTrial: Boolean @default(false)` — marca o plano como trial
- `trialDurationDays: Int?` — duração padrão em dias (só relevante para planos trial)

### Nova tabela `CompanyTrial`

```
CompanyTrial
├── id: String @id @default(cuid())
├── companyId: String (FK -> Company)
├── trialPlanId: String (FK -> SaasPlan)
├── originalPlanId: String (FK -> SaasPlan)
├── originalPeriod: String? (período da subscription original)
├── durationDays: Int (copiado do plano no momento da ativação)
├── priceAfterTrial: Decimal (valor cobrado após trial, copiado do plano)
├── status: String (ACTIVE, EXPIRED, CANCELED)
├── startedAt: DateTime @default(now())
├── expiresAt: DateTime (startedAt + durationDays)
├── expiredAt: DateTime? (quando efetivamente reverteu)
├── createdAt: DateTime @default(now())
```

- `companyId` NÃO é unique — permite histórico de trials
- Apenas 1 trial ACTIVE por empresa (validado na lógica de negócio)

## Fluxo de Ativação

1. Cliente com plano básico pago clica no CTA (futuro)
2. Backend valida: sem trial ACTIVE, sem trial EXPIRED sem reset
3. Cria `CompanyTrial` com dados do plano trial atual
4. Salva `planId` e `period` atuais como `originalPlanId` / `originalPeriod`
5. Altera `SaasSubscription` para apontar para o plano TRIAL
6. Empresa tem acesso imediato aos módulos do trial

## Fluxo de Expiração

Job periódico `POST /saas/jobs/expire-trials`:
1. Busca `CompanyTrial` com `status = ACTIVE` e `expiresAt <= now()`
2. Reverte `SaasSubscription` para `originalPlanId` / `originalPeriod`
3. Marca `CompanyTrial.status = EXPIRED` e `expiredAt = now()`

## Reset pelo SUPER_ADMIN

- `POST /saas/companies/:id/reset-trial`
- Marca todos os `CompanyTrial` da empresa como EXPIRED
- Permite reativação futura

## API

```
TRIAL CONFIG (SUPER_ADMIN):
PUT    /saas/plans/:id              — aceita trialDurationDays

TRIAL OPERATIONS:
GET    /saas/trial/eligibility      — verifica elegibilidade (ADMIN)
POST   /saas/trial/activate         — ativa trial (ADMIN)
POST   /saas/companies/:id/reset-trial — reset trial (SUPER_ADMIN)

JOB:
POST   /saas/jobs/expire-trials     — expira trials vencidos
```

## Frontend

### SUPER_ADMIN
- **SaasPlans.vue**: Plano TRIAL com badge, campo "Duração do Trial (dias)" ao editar
- **SaasCompanies.vue**: Badge trial ativo + dias restantes, botão "Resetar Trial"

### Cliente (ADMIN)
- Sem mudanças visíveis por agora (CTA futuro)
- Store `saas.js` expõe `isOnTrial` e `trialDaysRemaining`

## Seed

Plano TRIAL no `seed_saas.mjs`:
- `name: "Trial"`, `isSystem: true`, `isTrial: true`, `isActive: false`
- `trialDurationDays: 7`, `price: 0`
- Sem módulos (admin configura)

## Visibilidade

- `GET /saas/plans` por ADMIN: filtra `isTrial: true`
- `GET /saas/plans` por SUPER_ADMIN: mostra todos
