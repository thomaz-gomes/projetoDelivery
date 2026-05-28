# Design — Pizza Product Type

**Data**: 2026-05-28
**Autor**: brainstorm com usuário (ref. screenshots Saipos)
**Status**: aprovado, aguardando plano de implementação

## Contexto

Sistema atualmente suporta dois tipos de produto: simples (`Product` puro) e combo (`Product.isCombo=true` + `Combo` + `ComboSlot` + `ComboSlotOption`). Pizzarias têm necessidades específicas não cobertas:

- Sabores múltiplos por pizza (meio-a-meio, 3 sabores, 4 sabores)
- Preço pode variar com sabor escolhido (sabor premium vs. tradicional)
- Variação de tamanho (Pequena/Média/Grande/Família) com limite de sabores diferente por tamanho
- Bordas, massas e adicionais paralelos à escolha de sabores

Esse documento define o tipo `PIZZA` reaproveitando ao máximo a estrutura de combo existente.

## Decisões fechadas

| Decisão | Escolha |
|---|---|
| Modos de precificação suportados | Ambos: `BY_FLAVOR` e `FIXED` (escolha por pizza no cadastro) |
| Regra meio-a-meio (Modo BY_FLAVOR) | Configurável por loja (`Store.pizzaHalfPriceRule`), override por pizza |
| Regra de acréscimo (Modo FIXED) | Definida por pizza (`Pizza.flavorAddRule`), obrigatória |
| Modelagem de tamanhos | Único `Product` + `PizzaSize` aninhado |
| Bordas/massas/adicionais | Reusam `ComboSlot` com `slotKind` discriminado |
| Granularidade fiscal NFC-e | 1 linha por pizza vendida (agregada) |
| Borda/adicional por fatia | Fora do MVP (Fase 2) |
| Frações desiguais | Fora do MVP — sempre `1/N` |

## Modelo de dados

### Enums novos

```prisma
enum ProductKind {
  SIMPLE
  COMBO
  PIZZA
}

enum PizzaPricingMode {
  BY_FLAVOR
  FIXED
}

enum PizzaHalfPriceRule {
  MAX
  AVG
}

enum PizzaFlavorAddRule {
  MAX_ADD
  SUM_ADD
  AVG_ADD
}

enum ComboSlotKind {
  GENERIC
  FLAVOR
  BORDER
  DOUGH
  EXTRA
}
```

### Modelos

```prisma
model Product {
  // ... campos atuais
  kind        ProductKind @default(SIMPLE)
  isCombo     Boolean     @default(false)  // mantido por compat; derivado de kind
  pizza       Pizza?
  combo       Combo?
}

model Pizza {
  id                    String               @id @default(cuid())
  product               Product              @relation(fields: [productId], references: [id], onDelete: Cascade)
  productId             String               @unique
  pricingMode           PizzaPricingMode
  halfPriceRuleOverride PizzaHalfPriceRule?  // BY_FLAVOR: null = herda Store.pizzaHalfPriceRule
  flavorAddRule         PizzaFlavorAddRule?  // FIXED: obrigatório; null em BY_FLAVOR
  sizes                 PizzaSize[]
  createdAt             DateTime             @default(now())
  updatedAt             DateTime             @updatedAt
}

model PizzaSize {
  id              String              @id @default(cuid())
  pizza           Pizza               @relation(fields: [pizzaId], references: [id], onDelete: Cascade)
  pizzaId         String
  name            String              // "Pequena", "Média", "Grande"
  position        Int                 @default(0)
  maxFlavors      Int                 // limite (1, 2, 3, 4...)
  basePrice       Decimal             @db.Decimal(10,2)  // Modo FIXED; ignorado em BY_FLAVOR
  vUnComDeclarado Decimal             @db.Decimal(10,2)  // fiscal por tamanho
  flavorPrices    PizzaFlavorPrice[]
  @@unique([pizzaId, name])
}

model PizzaFlavorPrice {
  id              String           @id @default(cuid())
  size            PizzaSize        @relation(fields: [sizeId], references: [id], onDelete: Cascade)
  sizeId          String
  flavorOption    ComboSlotOption  @relation(fields: [flavorOptionId], references: [id], onDelete: Cascade)
  flavorOptionId  String
  price           Decimal          @db.Decimal(10,2)  // BY_FLAVOR: preço do sabor; FIXED: priceAdd
  @@unique([sizeId, flavorOptionId])
}

model ComboSlot {
  // ... campos atuais
  slotKind    ComboSlotKind @default(GENERIC)
  pizzaSizeId String?
  pizzaSize   PizzaSize?    @relation(fields: [pizzaSizeId], references: [id], onDelete: Cascade)
}

model Store {
  // ... campos atuais
  pizzaHalfPriceRule PizzaHalfPriceRule @default(MAX)
}
```

### Matriz de preço por modo

| Cenário | Cálculo |
|---|---|
| `BY_FLAVOR` + rule `MAX` | `max(flavorPrices)` entre sabores escolhidos |
| `BY_FLAVOR` + rule `AVG` | `avg(flavorPrices)` arredondado a 2 casas |
| `FIXED` + rule `MAX_ADD` | `basePrice + max(0, flavorPrices)` |
| `FIXED` + rule `SUM_ADD` | `basePrice + sum(flavorPrices)` |
| `FIXED` + rule `AVG_ADD` | `basePrice + avg(flavorPrices)` |
| Acréscimo de borda/massa/extra | soma `ComboSlotOption.priceAdjust` aplicáveis |

## Fluxo de cadastro

Modal inicial em `ProductForm.vue` passa a ofertar `[Simples] [Combo] [Pizza]`. Pizza tem 5 abas:

1. **Dados** — nome, descrição, imagem, categoria, modo de preço, regra (condicional ao modo).
2. **Tamanhos** — tabela editável (drag) com `name`, `maxFlavors`, `basePrice` (oculto em BY_FLAVOR), `vUnComDeclarado`.
3. **Sabores** — matriz `sabor × tamanho` com preço em cada célula. Ações rápidas: "Copiar coluna Grande", "Preencher coluna ↓". Em `BY_FLAVOR` header = `Pequena/Média/Grande`; em `FIXED` header = `Acréscimo Pequena/...`.
4. **Opções (Bordas/Massas/Adicionais)** — reusa `ComboSlotsEditor.vue` com dropdown de `slotKind` + amarra opcional a tamanho.
5. **Disponibilidade & Fiscal** — mantido do form de produto atual.

### Validações backend (`createPizzaGraph`)

- `pricingMode` definido.
- `flavorAddRule` obrigatório se `pricingMode=FIXED`; proibido se `BY_FLAVOR`.
- `halfPriceRuleOverride` apenas se `BY_FLAVOR`.
- `sizes.length >= 1`, nomes únicos.
- Matriz `PizzaFlavorPrice` completa (toda combinação tamanho × sabor preenchida).
- Soma `vUnComDeclarado` (tamanho + slots obrigatórios) ≤ menor preço de venda possível.
- Transação atômica (igual `createComboGraph`).

## Fluxo de compra

### Componente único `<PizzaConfigurator>`

Server-side recebe seleção:

```json
{
  "productId": "...",
  "pizzaSizeId": "size_grande",
  "flavors": [
    { "optionId": "opt_mus", "fraction": 0.5 },
    { "optionId": "opt_cal", "fraction": 0.5 }
  ],
  "border": { "optionId": "opt_cat" },
  "dough":  { "optionId": "opt_trad" },
  "extras": [{ "optionId": "opt_queijo" }],
  "computedPrice": 56.00,
  "notes": "sem cebola"
}
```

Backend roda mesma `computePizzaPrice` e rejeita com 400 se divergência > R$ 0,01.

### Persistência em `OrderItem`

```json
// OrderItem.options
{
  "kind": "PIZZA",
  "pizzaSizeId": "size_grande",
  "pizzaSizeName": "Grande",
  "flavors": [
    { "optionId": "opt_mus", "name": "Mussarela", "price": 40, "fraction": 0.5 },
    { "optionId": "opt_cal", "name": "Calabresa", "price": 40, "fraction": 0.5 }
  ],
  "border": { "optionId": "opt_cat", "name": "Catupiry", "priceAdd": 8 },
  "dough":  { "optionId": "opt_trad", "name": "Tradicional", "priceAdd": 0 },
  "extras": [],
  "pricingMode": "BY_FLAVOR",
  "halfPriceRule": "MAX"
}
```

`OrderItem.name` gerado por `pizzaRender.js`:
- 2 sabores: `"Pizza Grande - 1/2 Mussarela + 1/2 Calabresa - Borda Catupiry"`
- 3+ sabores: `"Pizza Grande - 1/3 Mussarela + 1/3 Calabresa + 1/3 Camarão"`

### UI PDV

Atendente clica produto `kind=PIZZA` → painel com seleção de tamanho (radio), sabores (checkbox c/ limite dinâmico `maxFlavors`), borda/massa/adicionais. Diagrama SVG de fatias (`<PizzaSliceDiagram>`) acima do subtotal. Botão **Adicionar** desabilitado até `flavors.length >= 1`.

### Edição

Reabrir item passa `OrderItem.options` como `initialSelection` ao `PizzaConfigurator`.

## Fiscal (NFC-e)

Pizza = **1 linha NFC-e por OrderItem** (não multi-linha como combo):

| Campo | Origem |
|---|---|
| `cProd` | `Product.id` ou `integrationCode` |
| `xProd` | `OrderItem.name` |
| `NCM`, `CFOP`, `CEST`, unidade | `Product` |
| `qCom` | `OrderItem.quantity` |
| `vUnCom` | `OrderItem.price` (calculado) |
| `vUnComReferencia` | `PizzaSize.vUnComDeclarado` |

`vUnComDeclarado` por slot serve apenas para:
- Validação invariante no cadastro.
- Relatórios internos (margem por componente via `rateioPizza`).
- Rateio em caso de desconto na nota (proporcional sobre componentes).

NF-e mod 55 não é alvo (pizzaria B2C). Módulo aceita ambos sem mudança.

## Migração e rollout

### Schema

1. Editar `schema.prisma` com enums/modelos/campos novos.
2. Dev: `npx prisma db push` (sem `migrate dev` por convenção do projeto).
3. Prod: gerar SQL via `prisma migrate diff` e aplicar manualmente no VPS.

### Backfill obrigatório

```sql
UPDATE "Product"  SET kind = CASE WHEN "isCombo" THEN 'COMBO' ELSE 'SIMPLE' END;
UPDATE "ComboSlot" SET "slotKind" = 'GENERIC';
UPDATE "Store"    SET "pizzaHalfPriceRule" = 'MAX';
```

`Product.isCombo` permanece como derivado por 1-2 releases para compat com frontend legado.

### Arquivos impactados

**Backend** (novos): `pizzaGraph.js`, `pizzaPricing.js`, `pizzaRender.js`.
**Backend** (alterados): `schema.prisma`, `routes/menu.js`, `routes/orders.js`, `utils/enrichOrderForAgent.js`.
**Frontend** (novos): `PizzaSizesEditor.vue`, `PizzaFlavorsMatrix.vue`, `PizzaConfigurator.vue`, `PizzaSliceDiagram.vue`, `utils/pizzaPricing.js`.
**Frontend** (alterados): `ProductForm.vue`, `ComboSlotsEditor.vue`, `OrderForm.vue` (PDV), menu público delivery, stores `products`/`cart`.
**Print agent**: `defaultTemplate.js` ganha helper `{{#each item.options.flavors}}`.

### Testes

Backend:
- `pizzaGraph.test.js` — CRUD, validações, soma fiscal.
- `pizzaPricing.test.js` — matriz `BY_FLAVOR×{MAX,AVG} × FIXED×{MAX_ADD,SUM_ADD,AVG_ADD} × {1,2,3,4 sabores}`.
- `orders.pizza.test.js` — POST /orders com pizza, divergência `computedPrice` rejeitada.

Frontend: smoke em browser real (rule do projeto: feature ≠ type-check).

### Rollout

- Sem feature flag — tipo novo, não substitui.
- Backend deploy → migration → frontend deploy.
- Smoke num tenant de homologação antes de divulgar.

### Riscos

| Risco | Mitigação |
|---|---|
| Divergência preço cliente × servidor | Backend é fonte da verdade; 400 em divergência |
| Matriz incompleta no cadastro | Validação + UI destaca células vazias |
| `Product.isCombo` legado quebrar | Triggers/recompute mantêm sincronia |
| NCM diferente borda × pizza | Doc orienta consistência; multi-linha fica Fase 2 |

## Fora do MVP (Fase 2)

- Bordas/adicionais por fatia (amarrar a `flavorOptionId`).
- Frações desiguais (1/2 + 1/4 + 1/4).
- Imagem por sabor.
- Variantes especiais (calzone, pizza doce).
- Promoção combinada ("2 grandes por R$ X").
- Remoção do `Product.isCombo` legado.
- Granularidade fiscal multi-linha por componente.
