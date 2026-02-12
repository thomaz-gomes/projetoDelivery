# Módulo: Controle de Estoque (STOCK)

## Descrição
Views do módulo de controle de estoque. Gerencia ingredientes, grupos de ingredientes, fichas técnicas e movimentações de estoque.

## Chave do módulo
`STOCK`

## Componentes
- **IngredientGroups.vue** — Lista de grupos de ingredientes
- **IngredientGroupForm.vue** — Formulário de criação/edição de grupo
- **Ingredients.vue** — Lista de ingredientes
- **IngredientForm.vue** — Formulário de criação/edição de ingrediente
- **TechnicalSheets.vue** — Lista de fichas técnicas
- **TechnicalSheetEdit.vue** — Edição de ficha técnica
- **StockMovements.vue** — Lista de movimentações de estoque (entradas/saídas)
- **StockMovementForm.vue** — Formulário de nova movimentação

## Rotas
- `/ingredient-groups`, `/ingredient-groups/new`, `/ingredient-groups/:id/edit`
- `/ingredients`, `/ingredients/new`, `/ingredients/:id`
- `/technical-sheets`, `/technical-sheets/:id/edit`
- `/stock-movements`, `/stock-movements/new`, `/stock-movements/:id`
