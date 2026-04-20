# Design: "Todos os Itens" — Gestão Unificada de Categorias

**Data:** 2026-04-20  
**Status:** Aprovado

## Objetivo

Criar um cardápio virtual fixo "Todos os itens" no topo da lista de cardápios que permite gestão unificada de todas as categorias e produtos da empresa, com badges indicando os cardápios vinculados. Isso elimina a necessidade de navegar cardápio por cardápio para pausar/editar itens.

## Mudança de Modelo de Dados

### De (atual)
- `MenuCategory.menuId` — FK nullable para Menu (relação 1:N)
- Uma categoria pertence a no máximo 1 cardápio

### Para (novo)
- Tabela intermediária `MenuCategoryMenu` (relação N:N)
- Uma categoria pode pertencer a múltiplos cardápios

### Nova tabela: `MenuCategoryMenu`

| Campo | Tipo | Descrição |
|-------|------|-----------|
| id | UUID | PK |
| menuCategoryId | UUID (FK) | Referência a MenuCategory |
| menuId | UUID (FK) | Referência a Menu |
| position | Int | Posição da categoria dentro daquele cardápio |
| unique | (menuCategoryId, menuId) | Impede duplicatas |

### Migração
- Para cada `MenuCategory` existente com `menuId` não-nulo, criar registro em `MenuCategoryMenu`
- Remover campo `menuId` de `MenuCategory`

## Tela "Todos os Itens"

### Acesso
- Aparece como **primeiro item fixo** na lista de cardápios (`Menus.vue`)
- Não pode ser editado, deletado, nem tem configurações
- Ao clicar, abre interface idêntica ao `MenuAdmin.vue`

### Layout
- Mesmo layout do `MenuAdmin.vue` (lista de categorias com produtos expandíveis)
- Cada categoria exibe **badges** com os nomes dos cardápios vinculados:
  - `Hot Dog` `[Lanchão]` `[Old Dog]`
  - `Bebidas` `[Todos os cardápios]` (quando vinculada a todos)
  - `Sobremesas` `[Sem cardápio]` (quando sem vínculo)

### Vincular categorias a cardápios
- Botão/ícone em cada categoria na tela "Todos os itens"
- Abre dropdown com checkboxes dos cardápios disponíveis
- Salva imediatamente ao alterar

### Pausar itens/categorias
- Toggle `isActive` no registro — pausa **global** em todos os cardápios vinculados
- Comportamento idêntico ao atual do `MenuAdmin`

## Cardápios Individuais

- Continuam funcionando como hoje
- Filtram apenas categorias vinculadas àquele cardápio (via `MenuCategoryMenu`)
- Posição da categoria é independente por cardápio (campo `position` na tabela intermediária)

## Rotas Backend

### Existentes (ajustar)
- `GET /categories` — sem `menuId`: retorna todas da empresa com array `menus[]` incluído
- `GET /categories?menuId=X` — filtra pela tabela intermediária
- `POST /categories` — não recebe mais `menuId` direto; vincular via rota separada
- `PATCH /categories/:id` — remove lógica de `menuId`

### Nova rota
- `POST /categories/:id/menus` — atualiza vínculos
  - Body: `{ menuIds: ["uuid1", "uuid2", ...] }`
  - Sincroniza: remove vínculos ausentes, cria novos
  - Atribui `position` automática para novos vínculos

### Reordering
- `POST /reorder` — ajustar para usar `MenuCategoryMenu.position` quando contexto é um cardápio específico
- Na tela "Todos os itens", reorder pode usar uma posição global ou ser desabilitado (posição é por cardápio)

## Decisões

1. **Relação N:N** — mesma categoria, mesmos produtos, aparece em múltiplos cardápios
2. **Pausa global** — `isActive` no registro original, sem granularidade por cardápio
3. **Posição por cardápio** — cada cardápio pode ter sua própria ordem de categorias
4. **Sem duplicação** — editar categoria/produto reflete em todos os cardápios vinculados
5. **Cardápio fixo** — "Todos os itens" não é um registro no banco, é virtual no frontend
