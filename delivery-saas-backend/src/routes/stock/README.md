# Módulo: Controle de Estoque (STOCK)

## Descrição
Este módulo gerencia todo o sistema de controle de estoque da plataforma, incluindo ingredientes, grupos de ingredientes, fichas técnicas e movimentações de estoque.

## Chave do módulo
`STOCK`

## Funcionalidades
- **Grupos de Ingredientes** (`ingredientGroups.js`) — CRUD de grupos hierárquicos para organizar ingredientes
- **Ingredientes** (`ingredients.js`) — CRUD de ingredientes com unidades (UN, GR, KG, ML, L), controle de estoque mínimo e custo médio
- **Fichas Técnicas** (`technicalSheets.js`) — Composição de produtos com ingredientes e quantidades
- **Movimentações de Estoque** (`stockMovements.js`) — Registro de entradas (IN) e saídas (OUT) com recálculo automático de estoque e custo médio

## Rotas
- `/ingredient-groups` — Grupos de ingredientes
- `/ingredients` — Ingredientes
- `/technical-sheets` — Fichas técnicas
- `/stock-movements` — Movimentações de estoque

## Dependências
- Prisma models: `Ingredient`, `IngredientGroup`, `TechnicalSheet`, `TechnicalSheetItem`, `StockMovement`, `StockMovementItem`
