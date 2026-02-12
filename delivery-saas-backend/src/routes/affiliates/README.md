# Módulo: Afiliados (AFFILIATES)

## Descrição
Este módulo gerencia o programa de afiliados, permitindo cadastrar parceiros que divulgam a loja e recebem comissão por vendas realizadas através de seus cupons.

## Chave do módulo
`AFFILIATES`

## Funcionalidades
- **CRUD de Afiliados** — Cadastro com nome, email, WhatsApp, taxa de comissão e cupom exclusivo
- **Registro de Vendas** — Vinculação de vendas ao afiliado com cálculo automático de comissão
- **Pagamentos** — Registro de pagamentos aos afiliados com controle de saldo
- **Extrato** — Timeline combinada de vendas e pagamentos por afiliado
- **Auto-serviço** — Portal do afiliado para consultar saldo e extrato

## Rotas
- `GET /affiliates` — Listar afiliados com contadores
- `GET /affiliates/:id` — Detalhes do afiliado
- `POST /affiliates` — Criar afiliado (gera cupom automaticamente)
- `PUT /affiliates/:id` — Atualizar afiliado
- `DELETE /affiliates/:id` — Remover afiliado e cupons associados
- `POST /affiliates/:id/sales` — Registrar venda manual
- `POST /affiliates/:id/payments` — Registrar pagamento
- `GET /affiliates/:id/sales` — Listar vendas
- `GET /affiliates/:id/payments` — Listar pagamentos
- `GET /affiliates/:id/statement` — Extrato completo

## Dependências
- Prisma models: `Affiliate`, `AffiliateSale`, `AffiliatePayment`, `Coupon`
- Helper: `helpers.js` (getAffiliateIfOwned)
