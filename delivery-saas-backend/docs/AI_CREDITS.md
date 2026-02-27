# Sistema de Créditos de IA

## O que são créditos de IA?

Créditos de IA são a unidade de medida de consumo de recursos de inteligência artificial dentro da plataforma. Cada chamada a um modelo de IA (OpenAI GPT-4o, GPT-4o Vision, etc.) tem um custo computacional real — o sistema de créditos traduz esse custo em uma métrica simples e previsível para o cliente, desacoplando a fatura da OpenAI da cobrança ao usuário final.

**Analogia:** 1 crédito ≈ 1 unidade de trabalho útil entregue pela IA ao cliente. A plataforma absorve a variação de tokens e latência; o cliente vê apenas "X créditos por operação".

---

## Arquitetura

```
SaasPlan.aiCreditsMonthlyLimit          ← Define quantos créditos o plano dá por mês
        │
        ▼
Company.aiCreditsBalance                ← Saldo atual da empresa (decrementado a cada uso)
        │
        ▼
AiCreditTransaction                     ← Log imutável de cada débito (auditoria)
```

O saldo é restaurado automaticamente no **dia 1 de cada mês** via cron job, baseado no limite do plano contratado.

---

## Critério de Valoração dos Créditos

O custo de cada operação foi definido com base em três fatores:

### 1. Custo proporcional ao esforço computacional da IA

| Operação | Custo | Justificativa |
|---|---|---|
| `MENU_IMPORT_ITEM` | **1 crédito/item** | Extração de texto estruturado. Modelo GPT-4o com prompt de sistema fixo. Custo médio estimado: ~200 tokens de saída por item. O mais barato e previsível. |
| `MENU_IMPORT_PHOTO` | **5 créditos/foto** | Usa GPT-4o Vision (multimodal). Cada imagem aumenta significativamente o consumo de tokens de entrada (imagem = ~765–1020 tokens base + conteúdo). 5× mais caro que texto puro. |
| `GENERATE_DESCRIPTION` | **2 créditos/descrição** | Geração de texto criativo. Menos tokens que uma análise completa de cardápio, mas mais do que extração simples. |
| `OCR_PHOTO` | **5 créditos/foto** | Equivalente ao `MENU_IMPORT_PHOTO` — leitura de imagem com modelo Vision. |

### 2. Previsibilidade para o cliente

O modelo por **unidade de resultado** (item, foto, descrição) é preferível ao modelo por tokens porque:
- O cliente sabe antecipadamente o custo ("tenho 50 itens → gastarei 50 créditos")
- Não há surpresas por variação de tamanho do texto
- A estimativa aparece no modal de importação **antes** de confirmar a operação

### 3. Margem de operação

O custo em créditos foi calibrado para que o **plano base (100 créditos/mês)** atenda a operações típicas:

| Cenário típico | Consumo estimado |
|---|---|
| Importar cardápio de 80 itens via link | 80 créditos |
| Importar via planilha com 60 itens | 60 créditos |
| Analisar 4 fotos de cardápio (2 páginas frente/verso) | 20 créditos |
| Gerar descrições para 10 produtos | 20 créditos |

Um plano de 100 créditos/mês cobre 1–2 importações completas por mês, que é o padrão para restaurantes que atualizam o cardápio sazonalmente.

---

## Tabela de Serviços Cadastrados

Armazenados na tabela `AiCreditService` (e também como constante em `aiCreditManager.js`):

| key | name | creditsPerUnit | Modelo de IA utilizado |
|---|---|---|---|
| `MENU_IMPORT_ITEM` | Importação de Item de Cardápio | 1 | GPT-4o (texto) |
| `MENU_IMPORT_PHOTO` | Análise de Foto (OCR/Visão) | 5 | GPT-4o Vision |
| `GENERATE_DESCRIPTION` | Geração de Descrição | 2 | GPT-4o (texto) |
| `OCR_PHOTO` | OCR de Foto | 5 | GPT-4o Vision |

---

## Fluxo de Consumo

```
1. Cliente clica em "Importar com IA"
        │
        ▼
2. Backend verifica: company.aiCreditsBalance >= 1?
   ├─ NÃO → retorna HTTP 402, frontend bloqueia o botão
   └─ SIM → inicia job assíncrono de parse
        │
        ▼
3. Job de IA processa (scraping / foto / planilha)
   → Conta os itens encontrados
   → Calcula creditEstimate = { itemCount, costPerUnit, totalCost }
   → Retorna estimativa junto com as categorias no polling
        │
        ▼
4. Frontend exibe estimativa no Step 3 (Revisão):
   "Esta operação consumirá X créditos (Y itens × Z crédito cada)"
   → Botão desabilitado se saldo < totalCost
        │
        ▼
5. Cliente confirma → POST /menu/ai-import/apply
   → Backend verifica saldo novamente (evita race condition)
   → Debita créditos atomicamente via prisma.$transaction
   → Registra AiCreditTransaction (log de auditoria)
   → Importa os itens no cardápio
        │
        ▼
6. Frontend atualiza widget de saldo (useAiCreditsStore().fetch())
```

---

## Reset Mensal

O saldo é restaurado automaticamente via cron job:

```
Cron: "1 0 1 * *"  →  Todo dia 1 do mês, às 00:01 (horário de São Paulo)
```

O valor restaurado é sempre `SaasPlan.aiCreditsMonthlyLimit` — não acumula saldo não utilizado.

Também é possível disparar o reset manualmente pelo painel SUPER_ADMIN:
```
POST /ai-credits/admin/reset-all
POST /ai-credits/admin/reset/:companyId
```

---

## Como Integrar um Novo Módulo de IA

Qualquer rota ou serviço futuro pode consumir créditos em 3 passos:

### Passo 1 — Registrar o serviço

Em `src/services/aiCreditManager.js`, adicione a constante de custo:

```javascript
export const AI_SERVICE_COSTS = {
  // ... serviços existentes ...
  MEU_NOVO_SERVICO: 3,  // 3 créditos por unidade
}
```

Opcionalmente, insira um registro no banco para exibição no catálogo:
```sql
INSERT INTO "AiCreditService" (id, key, name, "creditsPerUnit", description)
VALUES (gen_random_uuid(), 'MEU_NOVO_SERVICO', 'Meu Novo Serviço', 3, 'Descrição do que faz');
```

### Passo 2 — Verificar e debitar na rota

```javascript
import { checkCredits, debitCredits } from '../services/aiCreditManager.js'

router.post('/meu-endpoint', authMiddleware, async (req, res) => {
  const companyId = req.user?.companyId
  const quantity = req.body.items.length  // quantas unidades serão processadas

  // 1. Verificar saldo
  const check = await checkCredits(companyId, 'MEU_NOVO_SERVICO', quantity)
  if (!check.ok) {
    return res.status(402).json({
      message: `Créditos insuficientes. Necessário: ${check.totalCost}, Disponível: ${check.balance}`,
      required: check.totalCost,
      balance: check.balance,
    })
  }

  // 2. Executar a chamada de IA
  const resultado = await minhaFuncaoDeIA(req.body.items)

  // 3. Debitar créditos (após sucesso da IA)
  await debitCredits(
    companyId,
    'MEU_NOVO_SERVICO',
    quantity,
    { fonte: 'meu-endpoint', detalhe: '...' },  // metadata para auditoria
    req.user?.id,
  )

  res.json(resultado)
})
```

### Passo 3 — Frontend (opcional)

O widget de saldo (`AiCreditsWidget.vue`) já exibe o saldo atualizado automaticamente. Se quiser mostrar o custo antes da operação, leia o catálogo:

```javascript
const res = await api.get('/ai-credits/services')
const servico = res.data.find(s => s.key === 'MEU_NOVO_SERVICO')
// servico.creditsPerUnit → custo por unidade
```

---

## Endpoints da API

| Método | Rota | Acesso | Descrição |
|---|---|---|---|
| GET | `/ai-credits/balance` | ADMIN | Saldo atual, limite mensal e data de próximo reset |
| GET | `/ai-credits/transactions` | ADMIN | Histórico paginado (`?page=1&limit=20`) |
| GET | `/ai-credits/services` | ADMIN | Catálogo de serviços e custos |
| POST | `/ai-credits/admin/reset/:companyId` | SUPER_ADMIN | Reset manual de uma empresa |
| PUT | `/ai-credits/admin/company/:companyId` | SUPER_ADMIN | Ajustar saldo manualmente |
| POST | `/ai-credits/admin/reset-all` | SUPER_ADMIN | Reset mensal de todas as empresas |

---

## Estrutura do Banco de Dados

```prisma
model Company {
  aiCreditsBalance     Int      @default(0)   // saldo atual
  aiCreditsLastReset   DateTime @default(now()) // data do último reset
}

model SaasPlan {
  aiCreditsMonthlyLimit Int @default(100)     // limite mensal do plano
}

model AiCreditService {
  key            String  @unique  // identificador da operação
  name           String
  creditsPerUnit Int             // custo em créditos por unidade
  description    String?
  isActive       Boolean
}

model AiCreditTransaction {
  companyId     String          // empresa que consumiu
  userId        String?         // usuário que disparou (null = cron/sistema)
  serviceKey    String          // qual serviço foi consumido
  creditsSpent  Int             // total debitado
  balanceBefore Int             // saldo antes do débito
  balanceAfter  Int             // saldo após o débito
  metadata      Json?           // dados extras (menuId, itemCount, source, ...)
  createdAt     DateTime

  @@index([companyId, createdAt])
}
```

---

## Arquivos do Sistema

| Arquivo | Responsabilidade |
|---|---|
| `src/services/aiCreditManager.js` | Service layer central (verificar, debitar, resetar) |
| `src/routes/aiCredits.js` | Endpoints REST de gestão |
| `src/cron.js` | Reset automático mensal |
| `prisma/schema.prisma` | Modelos `AiCreditService` e `AiCreditTransaction` |
| `src/routes/menuImport.js` | Primeiro consumidor integrado (referência de uso) |
| `src/stores/aiCredits.js` *(frontend)* | Pinia store — estado reativo do saldo |
| `src/components/AiCreditsWidget.vue` *(frontend)* | Widget reutilizável de exibição do saldo |
