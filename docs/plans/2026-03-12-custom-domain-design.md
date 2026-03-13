# Design — Módulo Domínio Próprio

**Data:** 2026-03-12

## Objetivo

Permitir que clientes (ADMIN) configurem domínios próprios para seus cardápios.
Exemplo: `www.meucardapio.com.br` abre diretamente o cardápio (menu) associado.

Cada domínio é vinculado a um menu específico, cobrado individualmente por período (mensal/anual), com pagamento via Mercado Pago (split), seguindo a mesma estrutura dos demais módulos.

## Modelo de Dados

```prisma
model CustomDomain {
  id          String   @id @default(uuid())
  domain      String   @unique
  menuId      String
  menu        Menu     @relation(fields: [menuId], references: [id])
  companyId   String
  company     Company  @relation(fields: [companyId], references: [id])

  // Status
  status      CustomDomainStatus @default(PENDING_PAYMENT)
  sslStatus   SslStatus          @default(NONE)
  verifiedAt  DateTime?

  // Billing (valor congelado no momento da contratação)
  price         Decimal
  billingCycle  BillingCycle  @default(MONTHLY)
  paidUntil     DateTime?
  autoRenew     Boolean       @default(true)

  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

enum CustomDomainStatus {
  PENDING_PAYMENT  // Aguardando pagamento
  PENDING_DNS      // Pago, aguardando configuração DNS
  VERIFYING        // Verificando DNS + provisionando SSL
  ACTIVE           // Funcionando
  SUSPENDED        // Pagamento vencido
}

enum SslStatus {
  NONE
  PROVISIONING
  ACTIVE
  FAILED
}

enum BillingCycle {
  MONTHLY
  YEARLY
}
```

Relação no modelo `Menu`: `customDomain CustomDomain?` (1:1 opcional).

## Fluxo do ADMIN

1. Abre MenuEdit → aba "Domínio Próprio" (sempre visível)
2. Campos congelados/desabilitados + CTA "Assinar Domínio Próprio — R$ X,XX/mês"
3. Escolhe ciclo (mensal/anual), confirma → checkout Mercado Pago com split
4. Pagamento confirmado → status `PENDING_DNS`, campos desbloqueiam
5. Digita o domínio desejado
6. Card com instruções DNS:
   - Registro **A**: Host `@`, Valor `<IP_DO_SERVIDOR>`, TTL `3600`
   - Registro **CNAME**: Host `www`, Valor `seu-dominio.com.br`
   - Orientações passo a passo para provedores comuns (Registro.br, GoDaddy, Hostinger)
   - Aviso sobre propagação DNS (até 24h)
7. Clica "Verificar DNS" → backend resolve DNS via `dns.resolve4()`
8. DNS OK → provisiona SSL via Certbot, gera config Nginx
9. SSL OK → status `ACTIVE`, domínio funciona

## SUPER_ADMIN

- Configura preços padrão (mensal/anual) para domínios customizados
- Visualiza todos os domínios do sistema com filtros por status (ACTIVE, SUSPENDED, PENDING_DNS, etc.)
- IP do servidor configurável (exibido nas instruções DNS)

## Resolução de Domínio (Runtime)

```
Request → Nginx (catch-all) → Node middleware
  ├── Host = domínio do sistema → rotas normais
  └── Host = domínio custom → lookup DB (cache 5min) → serve PublicMenu
```

1. **Nginx**: server catch-all faz proxy_pass para backend Node, incluindo header `Host`
2. **Middleware Node** (início do pipeline, antes das rotas):
   - Extrai `Host` header
   - Se for domínio do sistema → ignora, segue fluxo normal
   - Se for domínio custom → `CustomDomain.findUnique({ where: { domain } })`
   - Status `ACTIVE` e `paidUntil` válido → redireciona internamente para `/public/{companyId}/menu?menuId={menuId}`
   - Domínio não encontrado / suspenso / vencido → página de erro
3. **Cache**: Map em memória com TTL de 5 minutos

## SSL

- **Certbot (Let's Encrypt)** + script shell (`scripts/provision-ssl.sh`)
- Chamado via `child_process.exec` após verificação DNS positiva
- Executa `certbot certonly --nginx -d <domain> --non-interactive --agree-tos`
- Gera config Nginx em `/etc/nginx/sites-enabled/<domain>.conf`
- `nginx -s reload`
- Backend atualiza `sslStatus = ACTIVE`, `status = ACTIVE`

## Job de Vencimento

- Cron diário (ou setInterval)
- Verifica `CustomDomain` com `paidUntil < now()`
- Muda status para `SUSPENDED` (middleware bloqueia acesso)

## Backend — Rotas API

`src/routes/customDomain.js`:

- `GET /custom-domains` — lista domínios da empresa
- `POST /custom-domains` — cadastra domínio (valida formato, unicidade, associa ao menu)
- `PATCH /custom-domains/:id` — edita domínio, ciclo de billing
- `DELETE /custom-domains/:id` — remove domínio (revoga SSL, remove config Nginx)
- `POST /custom-domains/:id/verify` — verifica DNS (`dns.resolve4()`, checa IP do servidor)
- `POST /custom-domains/:id/renew` — renova pagamento (atualiza `paidUntil`)

## Frontend — Aba no MenuEdit

**Aba "Domínio Próprio"** no `MenuEdit.vue` — sempre visível, independente de módulo.

### Estados da UI:

**Sem assinatura:**
- Campos congelados (domínio, ciclo)
- CTA "Assinar Domínio Próprio — R$ X,XX/mês"
- Select ciclo (Mensal/Anual)

**PENDING_PAYMENT:**
- Aguardando confirmação de pagamento

**PENDING_DNS:**
- Input para domínio habilitado
- Card de instruções passo a passo:
  1. Acesse o painel do provedor de domínio (Registro.br, GoDaddy, Hostinger)
  2. Vá até Gerenciamento de DNS
  3. Crie registro A: Host `@`, Tipo `A`, Valor `<IP>`, TTL `3600`
  4. Para www, crie CNAME: Host `www`, Tipo `CNAME`, Valor `seu-dominio.com.br`
  5. Aguarde propagação (até 24h, normalmente < 1h)
  6. Clique em "Verificar DNS"
- Botão "Verificar DNS"
- Badge amarelo

**VERIFYING:**
- Spinner "Gerando certificado SSL..."
- Badge azul

**ACTIVE:**
- Badge verde "Ativo"
- Link clicável `https://<dominio>`
- Vencimento: "Válido até DD/MM/YYYY"
- Toggle auto-renovação
- Botão "Remover Domínio"

**SUSPENDED:**
- Badge vermelho "Suspenso - pagamento vencido"
- Botão "Renovar"

### Componentes
- Usa `<SelectInput>`, `<TextInput>`, Bootstrap 5
- Segue design system existente do projeto
