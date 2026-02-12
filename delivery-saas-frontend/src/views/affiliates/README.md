# Módulo: Afiliados (AFFILIATES)

## Descrição
Views do módulo de programa de afiliados. Gerencia parceiros, vendas, pagamentos e extratos.

## Chave do módulo
`AFFILIATES`

## Componentes
- **AffiliateListing.vue** — Lista de afiliados com saldo e contadores
- **AffiliateCreate.vue** — Formulário de novo afiliado
- **AffiliateEdit.vue** — Edição de afiliado existente
- **AffiliateSaleNew.vue** — Registro manual de venda para afiliado
- **AffiliatePaymentNew.vue** — Registro de pagamento ao afiliado
- **AffiliateStatement.vue** — Extrato do afiliado (visão admin)
- **AffiliateHome.vue** — Dashboard do afiliado (auto-serviço)
- **StatementSelf.vue** — Extrato do afiliado (visão auto-serviço)

## Rotas
- `/affiliates`, `/affiliates/new`, `/affiliates/:id/edit`
- `/affiliates/:id/sales/new`, `/affiliates/:id/payments/new`
- `/affiliates/:id/statement`
- `/affiliate` (home auto-serviço), `/affiliate/statement`
