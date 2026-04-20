# Design: Gamificação de Metas para Entregadores

**Data:** 2026-04-17
**Status:** Aprovado

## Resumo

Substituir o ranking atual dos motoboys por um sistema de metas gamificado com estrelas de dificuldade, barras de progresso e prêmios (dinheiro e/ou customizáveis). Metas podem ser globais (todos os riders) ou individuais, com períodos fixos ou recorrentes. Prêmios em dinheiro integram com o extrato financeiro do motoboy.

## Decisões

- **Escopo:** Metas globais + individuais
- **Prêmios:** Dinheiro e/ou customizáveis (texto livre)
- **Aprovação:** Configurável por meta (automático ou manual)
- **Visibilidade:** Web + app mobile (web primeiro)
- **Períodos:** Fixos (data início/fim) + recorrentes (semanal/mensal)
- **Ranking atual:** Substituído completamente pela tela de metas
- **Arquitetura:** Cálculo sob demanda (sem tabela de cache), verificação de conquista nos eventos-chave

## Modelo de Dados

### RiderGoal (Definição da meta)

| Campo | Tipo | Descrição |
|-------|------|-----------|
| id | UUID | PK |
| companyId | UUID | FK -> Company |
| name | String | Ex: "Velocista do Mês" |
| description | String? | Descrição detalhada |
| ruleType | Enum | `CANCELLATION_RATE`, `CODE_COMPLETION_RATE`, `CONSECUTIVE_CHECKINS`, `AVG_DELIVERY_TIME`, `DELIVERY_COUNT` |
| ruleOperator | Enum | `LTE` (<=), `GTE` (>=) |
| ruleValue | Decimal | Valor alvo |
| scope | Enum | `GLOBAL`, `INDIVIDUAL` |
| periodType | Enum | `FIXED`, `WEEKLY`, `MONTHLY` |
| startDate | DateTime | Início do período/ciclo |
| endDate | DateTime? | Fim (null para recorrentes) |
| rewardType | Enum | `MONEY`, `CUSTOM`, `MONEY_AND_CUSTOM` |
| rewardAmount | Decimal? | Valor em R$ |
| rewardDescription | String? | Descrição do prêmio customizado |
| autoApprove | Boolean | Crédito automático ou precisa aprovação |
| active | Boolean | default true |
| createdAt | DateTime | |

### RiderGoalAssignment (Vínculo meta individual <-> rider)

| Campo | Tipo | Descrição |
|-------|------|-----------|
| id | UUID | PK |
| goalId | UUID | FK -> RiderGoal |
| riderId | UUID | FK -> Rider |

### RiderGoalAchievement (Registro de conquista)

| Campo | Tipo | Descrição |
|-------|------|-----------|
| id | UUID | PK |
| goalId | UUID | FK -> RiderGoal |
| riderId | UUID | FK -> Rider |
| cycleStart | DateTime | Início do ciclo |
| cycleEnd | DateTime | Fim do ciclo |
| achievedAt | DateTime | Quando atingiu |
| status | Enum | `PENDING_APPROVAL`, `APPROVED`, `CREDITED`, `REJECTED` |
| rewardAmount | Decimal? | Valor creditado |
| transactionId | UUID? | FK -> RiderTransaction |

### Alteração existente

- `RiderTransactionType`: adicionar `GOAL_REWARD`

## Regras de Cálculo de Progresso

| ruleType | Fonte | Cálculo |
|----------|-------|---------|
| `CANCELLATION_RATE` | Order (riderId) | (canceladas pelo rider / total atribuídas) * 100 |
| `CODE_COMPLETION_RATE` | Order (riderId, COMPLETED) | (com código iFood / total concluídas) * 100 |
| `CONSECUTIVE_CHECKINS` | RiderCheckin + RiderBonusRule | Dias consecutivos com check-in antes do deadlineTime |
| `AVG_DELIVERY_TIME` | Order (riderId, COMPLETED) | média(completedAt - departedAt) em minutos |
| `DELIVERY_COUNT` | Order (riderId, COMPLETED) | Contagem simples |

## Verificação de Conquista (Eventos)

| Evento | ruleTypes verificados |
|--------|----------------------|
| Entrega concluída | `DELIVERY_COUNT`, `AVG_DELIVERY_TIME`, `CODE_COMPLETION_RATE` |
| Entrega cancelada | `CANCELLATION_RATE` |
| Check-in realizado | `CONSECUTIVE_CHECKINS` |

### Fluxo

1. Evento ocorre (entrega/check-in)
2. Busca metas ativas para o rider (globais + individuais)
3. Filtra metas cujo ruleType é relevante ao evento
4. Calcula progresso atual
5. Se atingiu meta E não tem Achievement neste ciclo:
   - `autoApprove = true` → cria Achievement CREDITED + RiderTransaction GOAL_REWARD
   - `autoApprove = false` → cria Achievement PENDING_APPROVAL + notifica admin via Socket.IO

## Cálculo Automático de Estrelas (Dificuldade)

Compara ruleValue contra a média histórica dos riders da empresa nos últimos 3 meses:

| Regra | ⭐ Fácil | ⭐⭐ Médio | ⭐⭐⭐ Difícil |
|-------|---------|----------|-------------|
| DELIVERY_COUNT | <= 80% da média | 80-120% | > 120% |
| AVG_DELIVERY_TIME | >= 120% da média | 80-120% | < 80% |
| CODE_COMPLETION_RATE | <= 70% | 70-90% | > 90% |
| CANCELLATION_RATE | >= 10% | 5-10% | < 5% |
| CONSECUTIVE_CHECKINS | <= 5 dias | 5-15 dias | > 15 dias |

Sem histórico suficiente: default ⭐⭐ (médio).

## API Endpoints

### Admin

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | /goals | Listar metas (filtros: active, scope, ruleType) |
| POST | /goals | Criar meta |
| PUT | /goals/:id | Editar meta |
| DELETE | /goals/:id | Desativar (soft delete) |
| POST | /goals/:id/assign | Vincular riders (body: { riderIds }) |
| DELETE | /goals/:id/assign/:riderId | Remover rider |
| GET | /goals/achievements | Listar conquistas (filtros: status, riderId, goalId) |
| PUT | /goals/achievements/:id/approve | Aprovar conquista → credita prêmio |
| PUT | /goals/achievements/:id/reject | Rejeitar conquista |

### Rider

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | /riders/me/goals | Metas ativas com progresso calculado |
| GET | /riders/me/achievements | Histórico de conquistas |

### Resposta /riders/me/goals

```json
[
  {
    "id": "uuid",
    "name": "Velocista do Mês",
    "description": "Mantenha o tempo médio abaixo de 25min",
    "ruleType": "AVG_DELIVERY_TIME",
    "ruleOperator": "LTE",
    "ruleValue": 25,
    "rewardType": "MONEY",
    "rewardAmount": 50.00,
    "rewardDescription": null,
    "periodType": "MONTHLY",
    "cycleStart": "2026-04-01",
    "cycleEnd": "2026-04-30",
    "difficulty": 3,
    "progress": {
      "current": 22.5,
      "target": 25,
      "percentage": 100,
      "achieved": true,
      "unit": "min"
    }
  }
]
```

## Frontend

### Tela do Motoboy (substitui RiderRanking.vue)

- Header: "Minhas Metas" + período atual
- Cards por meta com:
  - Ícone por ruleType
  - Nome + descrição
  - Estrelas de dificuldade (1-3)
  - Barra de progresso colorida (verde > 80%, amarelo > 50%, vermelho < 50%)
  - Valor atual / alvo
  - Prêmio
  - Badge "Meta!" quando atingida
- Seção inferior: histórico de conquistas recentes

### Tela Admin - Gestão de Metas

**Listagem:**
- Tabela: nome, tipo regra, escopo (badge GLOBAL/INDIVIDUAL), período, prêmio, ativo
- Filtros por tipo de regra e escopo
- Botão "Nova Meta"

**Formulário criação/edição:**
- Nome + descrição
- Tipo de regra (select) → campos dinâmicos
- Operador + valor alvo
- Escopo: Global ou Individual (multi-select riders)
- Período: Fixo (date pickers) ou Recorrente (semanal/mensal + data início)
- Prêmio: Dinheiro / Customizado / Ambos
- Auto-aprovar: toggle

**Painel de conquistas pendentes:**
- Lista de achievements PENDING_APPROVAL
- Botões aprovar/rejeitar
- Aprovação em lote
