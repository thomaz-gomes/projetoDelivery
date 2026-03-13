# Multi-Gateway Payment & Billing Design

**Date:** 2026-03-13

**Goal:** Refatorar o sistema de pagamento SaaS para suportar múltiplos gateways de pagamento com seletor global (Super Admin), área de cobranças para ADMIN, e recorrência configurável (auto/manual) por tipo de cobrança.

**Approach:** Gateway Adapter Pattern

---

## Decisões

| Decisão | Escolha |
|---------|---------|
| Escopo do gateway | Único para todo o SaaS, controlado pelo Super Admin |
| Gateways suportados | Mercado Pago agora, arquitetura extensível |
| Área de cobranças ADMIN | Lista de faturas + dashboard financeiro |
| Recorrências | Super Admin configura auto/manual por tipo (plano, módulo, créditos) |
| Arquitetura backend | Adapter pattern (`paymentGateway/` com interface comum) |

---

## 1. Modelo de Dados

### Nova tabela: `SaasGatewayConfig`

Singleton global — armazena o gateway ativo do SaaS.

```prisma
model SaasGatewayConfig {
  id            String   @id @default(uuid())
  provider      String   // "MERCADOPAGO" | "STRIPE" | etc.
  displayName   String   // "Mercado Pago"
  credentials   String   // JSON criptografado (accessToken, publicKey, etc.)
  isActive      Boolean  @default(true)
  billingMode   Json     // { plan: "AUTO"|"MANUAL", module: "AUTO"|"MANUAL", credits: "AUTO"|"MANUAL" }
  webhookSecret String?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}
```

### Alterações em modelos existentes

**SaasInvoice** — novos campos:
- `gatewayProvider String?` — qual gateway gerou/processou
- `autoCharge Boolean @default(false)` — se foi cobrada automaticamente

**SaasPayment** — campo `gateway` já existe, expandir valores possíveis.

**MercadoPagoConfig** — continua existindo para marketplace split (per-company), mas a config global do SaaS fica em `SaasGatewayConfig`.

---

## 2. Backend — Gateway Adapter Pattern

### Estrutura de arquivos

```
src/services/paymentGateway/
  index.js                  // getActiveGateway() → retorna adapter ativo
  baseAdapter.js            // interface comum (métodos obrigatórios)
  mercadopago.adapter.js    // implementação Mercado Pago
  // futuro: stripe.adapter.js
```

### Interface do Adapter

```javascript
class BaseAdapter {
  // Checkout avulso (fatura, crédito)
  createCheckout({ amount, description, externalRef, backUrls })
  // → { checkoutUrl, preferenceId }

  // Assinatura recorrente
  createSubscription({ amount, description, interval, backUrls })
  // → { subscriptionId, checkoutUrl }

  // Cancelar assinatura
  cancelSubscription(subscriptionId)
  // → boolean

  // Consultar status de pagamento
  getPaymentStatus(gatewayRef)
  // → { status, method, raw }

  // Validar webhook
  validateWebhook(req)
  // → { valid, paymentId }
}
```

### Fluxo de pagamento refatorado

1. `POST /payment/create-preference` → chama `getActiveGateway()` → adapter faz checkout
2. `POST /payment/webhook/:provider` → rota dinâmica por provider → adapter valida e processa
3. Cron job de recorrência → verifica `billingMode` → se AUTO, adapter cria cobrança; se MANUAL, gera fatura pendente

### Impacto na `payment.js` existente

- Extrair lógica MP inline para `mercadopago.adapter.js`
- Rota `create-preference` passa a ser genérica (chama adapter)
- Webhook split: `/webhook/mercadopago`, `/webhook/stripe`, etc.
- `processPaymentSuccess()` continua igual (já é gateway-agnostic)

### Rotas do Super Admin (gateway config)

```
GET    /saas/gateway          → retorna config ativa
PUT    /saas/gateway          → cria/atualiza config (provider, credentials, billingMode)
POST   /saas/gateway/test     → testa credenciais do gateway
```

---

## 3. Frontend

### Super Admin: Configuração de Gateway (`/saas/gateway`)

- Seletor de provider (dropdown: Mercado Pago, futuro Stripe...)
- Formulário dinâmico de credenciais conforme provider selecionado
- Configuração de `billingMode` por tipo: 3 toggles (Plano / Módulo / Créditos) → AUTO ou MANUAL
- Botão "Testar conexão" que valida as credenciais via API

### ADMIN: Área de Cobranças (`/billing`)

Acessível no menu lateral, junto ao widget de abrir/fechar loja.

**Tab 1 — Faturas:**
- Tabela: descrição, valor, vencimento, status (badge colorido), botão "Pagar"
- Filtros: Pendentes / Pagas / Todas
- Cobranças automáticas mostram badge "Recorrente"

**Tab 2 — Dashboard:**
- Cards resumo: Total gasto (mês), Próximo vencimento, Faturas pendentes (count)
- Mini gráfico de gastos últimos 6 meses (barras simples)
- Lista de assinaturas ativas (plano + módulos) com status e próximo vencimento

### Fluxo de ativação de módulo (ajustado)

1. ADMIN clica "Assinar módulo" na Store
2. Backend gera `SaasInvoice` (PENDING) + `SaasModuleSubscription` (PENDING)
3. Se `billingMode.module === "AUTO"` → adapter cria checkout automático → redireciona
4. Se `billingMode.module === "MANUAL"` → fatura aparece em `/billing` → ADMIN paga quando quiser
5. Webhook confirma pagamento → módulo ativa

---

## 4. Recorrência e Suspensão

### Cron Job de Recorrência (diário)

- Consulta `SaasSubscription` + `SaasModuleSubscription` com `nextDueAt <= hoje`
- Verifica `billingMode` do tipo correspondente na `SaasGatewayConfig`
- **AUTO**: adapter cria cobrança via gateway → se falhar, gera fatura PENDING como fallback
- **MANUAL**: gera `SaasInvoice` PENDING → notificação no painel do ADMIN

### Política de Suspensão

| Dias vencido | Ação |
|-------------|------|
| 0 | Fatura gerada (PENDING) |
| 3 | Status → `OVERDUE`, badge de alerta no painel |
| 7 | Status → `SUSPENDED`, módulo/funcionalidade desativada |
| Pagamento confirmado | Reativa automaticamente |

### Notificações (visuais no painel)

- Fatura gerada → badge no menu lateral do ADMIN (count de pendentes)
- 3 dias antes do vencimento → alerta visual no dashboard
- Suspensão → banner vermelho no topo do painel
