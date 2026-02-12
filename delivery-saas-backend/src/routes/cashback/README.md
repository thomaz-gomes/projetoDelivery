# Módulo: Cashback (CASHBACK)

## Descrição
Este módulo permite configurar e gerenciar um sistema de cashback para clientes, com percentual padrão ou regras por produto.

## Chave do módulo
`CASHBACK`

## Funcionalidades
- **Configurações** — Habilitar/desabilitar cashback, definir percentual padrão e valor mínimo de resgate
- **Regras por Produto** — Cashback personalizado por produto (sobrepõe o padrão)
- **Carteira do Cliente** — Consulta de saldo de cashback por cliente
- **Crédito/Débito Manual** — Operações manuais de crédito e débito na carteira

## Rotas
- `GET /cashback/settings` — Configurações de cashback
- `PUT /cashback/settings` — Atualizar configurações
- `GET /cashback/product-rules` — Regras por produto
- `POST /cashback/product-rules` — Criar regra
- `DELETE /cashback/product-rules/:id` — Remover regra
- `GET /cashback/wallet` — Consultar carteira do cliente
- `POST /cashback/credit` — Creditar manualmente
- `POST /cashback/debit` — Debitar manualmente

## Dependências
- Prisma models: `CashbackSetting`, `CashbackProductRule`, `CashbackWallet`, `CashbackTransaction`
- Service: `src/services/cashback.js`
