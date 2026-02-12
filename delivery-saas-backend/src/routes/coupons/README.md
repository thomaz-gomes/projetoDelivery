# Módulo: Cupons (COUPONS)

## Descrição
Este módulo gerencia cupons de desconto que podem ser aplicados nos pedidos. Cupons podem ser independentes ou vinculados a afiliados.

## Chave do módulo
`COUPONS`

## Funcionalidades
- **CRUD de Cupons** — Criar, listar, editar e remover cupons de desconto
- **Tipos de desconto** — Percentual ou valor fixo
- **Regras de uso** — Máximo de usos total, máximo por cliente, subtotal mínimo, data de expiração
- **Vínculo com Afiliados** — Cupons podem ser associados a afiliados para rastreamento de vendas

## Rotas
- `GET /coupons` — Listar cupons (filtros: ativo, afiliado, código, tipo)
- `GET /coupons/:id` — Detalhes do cupom
- `POST /coupons` — Criar cupom
- `PUT /coupons/:id` — Atualizar cupom
- `DELETE /coupons/:id` — Remover cupom

## Dependências
- Prisma models: `Coupon`, `Affiliate`
