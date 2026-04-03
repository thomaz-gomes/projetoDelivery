# Rider Check-in, Bonificacao e Ranking

**Data:** 2026-04-02
**Status:** Aprovado

## Contexto

O sistema de riders ja possui GPS em tempo real, sistema financeiro (RiderAccount/RiderTransaction) e dashboard com metricas basicas. Faltam: check-in com localizacao, regras de bonificacao configuraveis e ranking gamificado.

## Requisitos

1. Motoboy faz check-in com geolocalizacao ao iniciar turno
2. Sistema valida se esta dentro do raio da loja para aceitar
3. Relatorio de check-ins com endereco e horario
4. Regras de bonificacao configuraveis (primeira regra: check-in antes de horario X = +R$ por entrega)
5. Ranking visivel para admin e motoboy (gamificacao)
6. Persistir se entrega foi concluida com codigo iFood

## Modelos de Dados

### RiderShift (novo)
- `id` (uuid, PK)
- `companyId` (FK Company)
- `name` (String — ex: "Almoco", "Jantar")
- `startTime` (String "HH:mm")
- `endTime` (String "HH:mm")
- `active` (Boolean, default true)
- `createdAt` (DateTime)

### RiderCheckin (novo)
- `id` (uuid, PK)
- `riderId` (FK Rider)
- `companyId` (FK Company)
- `shiftId` (FK RiderShift)
- `lat` (Float)
- `lng` (Float)
- `address` (String — reverse geocode)
- `checkinAt` (DateTime)
- `distanceMeters` (Float — distancia ate a loja)
- `createdAt` (DateTime)

### RiderBonusRule (novo)
- `id` (uuid, PK)
- `companyId` (FK Company)
- `name` (String — ex: "Bonus pontualidade almoco")
- `type` (enum: EARLY_CHECKIN — extensivel)
- `deadlineTime` (String "HH:mm" — check-in ate este horario)
- `bonusAmount` (Decimal — valor extra por entrega)
- `shiftId` (FK RiderShift, opcional — null = qualquer turno)
- `active` (Boolean, default true)
- `createdAt` (DateTime)

### Alteracoes em models existentes

**RiderTransactionType** — novo valor:
- `EARLY_CHECKIN_BONUS`

**Order** — novo campo:
- `closedByIfoodCode` (Boolean, default false)

## Rotas Backend

### Turnos (admin)
| Metodo | Rota | Descricao |
|--------|------|-----------|
| GET | `/riders/shifts` | Listar turnos da empresa |
| POST | `/riders/shifts` | Criar turno |
| PATCH | `/riders/shifts/:id` | Editar turno |
| DELETE | `/riders/shifts/:id` | Desativar turno |

### Check-in (motoboy)
| Metodo | Rota | Descricao |
|--------|------|-----------|
| POST | `/riders/me/checkin` | Fazer check-in (lat/lng, shiftId) |
| GET | `/riders/me/checkins` | Historico de check-ins do motoboy |

### Check-in (admin)
| Metodo | Rota | Descricao |
|--------|------|-----------|
| GET | `/riders/checkins` | Relatorio de check-ins (filtro data, rider) |

### Regras de bonificacao (admin)
| Metodo | Rota | Descricao |
|--------|------|-----------|
| GET | `/riders/bonus-rules` | Listar regras |
| POST | `/riders/bonus-rules` | Criar regra |
| PATCH | `/riders/bonus-rules/:id` | Editar regra |
| DELETE | `/riders/bonus-rules/:id` | Desativar regra |

### Ranking
| Metodo | Rota | Descricao |
|--------|------|-----------|
| GET | `/riders/ranking` | Admin: todos; Motoboy: proprio + posicao |

## Logica do Check-in

1. Motoboy envia `{ lat, lng, shiftId }`
2. Backend busca endereco da loja principal da empresa
3. Calcula distancia (Haversine) entre motoboy e loja
4. Se distancia > raio configurado (padrao 200m) -> rejeita 400
5. Reverse geocode (Nominatim) para obter endereco textual
6. Salva `RiderCheckin`

## Logica do Bonus

Dentro de `addDeliveryAndDailyIfNeeded` (chamado ao concluir pedido):
1. Busca `RiderCheckin` do rider naquele dia
2. Busca `RiderBonusRule` ativas da empresa tipo `EARLY_CHECKIN`
3. Se check-in foi antes do `deadlineTime` da regra -> cria `RiderTransaction` tipo `EARLY_CHECKIN_BONUS`
4. Controle: 1 bonus por regra por dia, aplicado em cada entrega daquele dia

## Ranking — Metricas

1. **Total de entregas** no periodo
2. **Tempo medio de entrega** (SAIU_PARA_ENTREGA -> CONCLUIDO)
3. **Pontualidade** (% check-ins antes do deadline)
4. **Taxa de conclusao** (concluidas vs canceladas)
5. **Taxa de entrega com codigo iFood** (% closedByIfoodCode = true)
6. **Score ponderado** (pesos configuraveis, ex: 40% entregas, 20% tempo, 15% pontualidade, 15% codigo iFood, 10% conclusao)

## Frontend — Telas

### Admin
1. **RiderShifts.vue** — CRUD de turnos (tabela + modal)
2. **RiderBonusRules.vue** — CRUD de regras de bonificacao (tabela + modal)
3. **RiderCheckins.vue** — Relatorio de check-ins (filtros data/rider, indicador visual verde/vermelho)
4. **Ranking** — Dentro do RidersDashboard ou nova aba (tabela com posicao, medalhas ouro/prata/bronze)

### Motoboy
5. **rider/Checkin.vue** — Relogio em tempo real (grande, atualiza a cada segundo), select turno, botao check-in, feedback sucesso/erro
6. **rider/Ranking.vue** — Posicao destacada, lista completa, visual gamificado (medalhas, barras)

## Resumo de escopo

| Item | Models | Rotas | Telas |
|------|--------|-------|-------|
| Turnos | RiderShift | 4 CRUD | 1 admin |
| Check-in | RiderCheckin | 3 | 1 admin + 1 motoboy |
| Bonificacao | RiderBonusRule + enum | 4 CRUD + logica addDelivery | 1 admin |
| Ranking | — (queries) | 1 | 1 admin + 1 motoboy |
| Codigo iFood | campo closedByIfoodCode | ajuste evento iFood | — |

**Total**: 3 novos models, 1 campo novo, 1 enum value, 12 rotas, 6 telas.
