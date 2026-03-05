# Mercado Pago com Split de Pagamento - Design

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Integrar Mercado Pago Checkout Pro com split de pagamento (modelo Marketplace) para cobranca SaaS white-label.

**Contexto:** O software e distribuido white-label. Cada gestor SaaS (cliente do dono da plataforma) revende para donos de restaurante. Pagamentos de assinatura, modulos e creditos passam pelo MP com split automatico.

---

## Modelo de Split

- **Gestor SaaS**: recebe os pagamentos dos restaurantes na sua conta MP (credenciais configuraveis no painel SUPER_ADMIN)
- **Dono da plataforma**: recebe valor fixo por transacao via `marketplace_fee` (configurado em variavel de ambiente, nao editavel pelo gestor)
- **Metodos**: PIX + Cartao de credito via Checkout Pro (redirect)

## Modelo de Dados

### Nova tabela: MercadoPagoConfig

```
MercadoPagoConfig
  id            String   @id @default(uuid())
  companyId     String   @unique    // gestor SaaS (Company)
  accessToken   String              // encrypted (AES-256)
  publicKey     String?
  refreshToken  String?             // encrypted
  mpUserId      String?             // ID do seller no MP
  isActive      Boolean  @default(true)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  company       Company  @relation(fields: [companyId])
```

### Variaveis de ambiente (plataforma)

```
MP_PLATFORM_ACCESS_TOKEN  - access_token do dono da plataforma (collector)
MP_PLATFORM_FEE           - valor fixo em centavos (ex: 200 = R$2.00)
MP_WEBHOOK_SECRET         - secret para validacao de webhook do MP
PAYMENT_ENCRYPT_KEY       - chave AES-256 para criptografar tokens no banco
```

### Alteracoes no schema existente

- `SaasPayment.gateway`: passa a aceitar "mercadopago" (alem de "manual")
- `SaasPayment.gatewayRef`: armazena o `payment.id` do MP
- `SaasPayment.metadata`: armazena dados extras (preference_id, payment_type, etc)

## Fluxo de Pagamento

```
1. Admin (restaurante) clica "Assinar modulo" / "Comprar creditos" / "Pagar fatura"
2. Frontend chama POST /payment/create-preference { invoiceId } ou { type, referenceId, period }
3. Backend:
   a. Se nao existe invoice, cria SaasInvoice + SaasInvoiceItem + SaasPayment (PENDING)
   b. Busca MercadoPagoConfig do gestor SaaS (company pai)
   c. Cria preferencia no MP Checkout Pro:
      - access_token: do gestor SaaS
      - marketplace_fee: MP_PLATFORM_FEE (valor fixo)
      - items: descricao + preco
      - external_reference: paymentId
      - back_urls: { success, failure, pending }
      - notification_url: webhook URL
   d. Retorna { checkoutUrl, preferenceId }
4. Frontend redireciona para checkoutUrl
5. MP processa pagamento (PIX ou cartao)
6. MP envia webhook (IPN) -> POST /payment/webhook
7. Backend:
   a. Valida assinatura do webhook
   b. Consulta MP API para confirmar status real do pagamento
   c. Atualiza SaasPayment (status, gatewayRef, paidAt)
   d. Se PAID: atualiza SaasInvoice, ativa modulo/creditos
8. Frontend exibe pagina de resultado (back_url)
```

## Endpoints Backend

### Novos

```
POST /payment/create-preference
  Body: { invoiceId } ou { type: "MODULE"|"CREDIT_PACK"|"INVOICE", referenceId, period? }
  Auth: ADMIN
  Response: { checkoutUrl, preferenceId, paymentId }

GET /payment/status/:paymentId
  Auth: ADMIN
  Response: { status, gateway, paidAt, invoiceId }

GET /saas/mercadopago-config
  Auth: SUPER_ADMIN
  Response: { publicKey, mpUserId, isActive, hasAccessToken }

PUT /saas/mercadopago-config
  Auth: SUPER_ADMIN
  Body: { accessToken?, publicKey?, isActive? }
```

### Modificados

```
POST /payment/webhook
  - Adaptar para receber notificacoes IPN do Mercado Pago
  - Validar assinatura x-signature do MP
  - Consultar MP API para obter status real
  - Manter compatibilidade com webhook manual existente
```

## Frontend

### Modificacoes

- **AddOnDetail.vue**: botao "Assinar" chama create-preference e redireciona
- **CreditPackStore.vue**: botao "Comprar" faz o mesmo
- **SaasBilling.vue**: faturas PENDING mostram botao "Pagar" que cria preferencia

### Novas paginas

- **PaymentResult.vue** (`/payment/result`): pagina de retorno do MP
  - Query params: status, payment_id, external_reference
  - Mostra sucesso/pendente/falha com link para voltar
  - Polling de status se pendente (PIX aguardando)

### Configuracao (SUPER_ADMIN)

- **SaasPlans.vue**: nova secao "Gateway de Pagamento" para configurar credenciais MP do gestor

## Seguranca

- `MP_PLATFORM_ACCESS_TOKEN` e `MP_PLATFORM_FEE` em env vars — SUPER_ADMIN nao acessa pelo painel
- `MercadoPagoConfig.accessToken` criptografado com AES-256 (chave em `PAYMENT_ENCRYPT_KEY`)
- Webhook valida assinatura HMAC do MP (`x-signature` header)
- Backend sempre consulta MP API para confirmar status (nao confia apenas no body do webhook)
- `external_reference` = paymentId para rastreabilidade bidirecional

## Dependencias

- `mercadopago` (SDK oficial Node.js) — instalado no backend
- Nenhuma dependencia nova no frontend (apenas redirect)

## Hierarquia de Companies (White-label)

Para o split funcionar, precisa existir a relacao de qual gestor SaaS "gerencia" cada restaurante. O campo `Company.parentId` ou similar indica o gestor SaaS pai. O `MercadoPagoConfig` e buscado pela company do gestor (pai), nao do restaurante.

Se `Company` ja tem um campo que indica o gestor pai, usar esse. Senao, adicionar `managedById` apontando para a Company do gestor SaaS.
