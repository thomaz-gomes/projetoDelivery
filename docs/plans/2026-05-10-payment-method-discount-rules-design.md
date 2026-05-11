# Regras de desconto por método de pagamento — Design

**Data:** 2026-05-10
**Status:** Aprovado, pronto para plano de implementação

## Problema

Lojistas precisam oferecer descontos diferenciados por forma de pagamento (ex: 5% off no PIX, 3% off no dinheiro à vista) com regras de quando e como o desconto se aplica. Hoje o cadastro de forma de pagamento não tem nenhum campo de desconto/promoção — só dados financeiros/fiscais.

## Objetivo

Adicionar uma seção opcional "Regra de desconto" em cada `PaymentMethod` que aplique desconto automático no checkout quando ativa, com controles para evitar empilhamento com cupons, controlar geração de cashback, restringir por horário e por tipo de pedido.

## Decisões já tomadas

| Decisão | Escolha |
|---|---|
| Tipo de desconto | Percentual **OU** valor fixo (lojista escolhe um) |
| Escopo de "ignorar outros descontos" | Apenas cupons (não toca preços promocionais nem resgate de cashback) |
| Cashback toggle | Override on/off simples (sem % própria) |
| Filtro por tipo de pedido | Método continua selecionável; quando tipo não casa, regra simplesmente não aplica |
| Storage | Colunas dedicadas no `PaymentMethod` + JSON para schedule/allowedOrderTypes |
| Componente de horário | Reutilizar `<AvailabilityScheduler>` |

## Modelo de dados

Estender o modelo `PaymentMethod` em `delivery-saas-backend/prisma/schema.prisma:1548`:

```prisma
model PaymentMethod {
  // ... campos existentes

  // Regra de desconto
  discountEnabled      Boolean  @default(false)
  discountPercent      Decimal? // mutuamente exclusivo com discountFixed
  discountFixed        Decimal?
  ignoreCoupons        Boolean  @default(false)
  generatesCashback    Boolean  @default(true)
  alwaysAvailable      Boolean  @default(true)
  schedule             Json?    // [{day:0..6, enabled, from:"HH:mm", to:"HH:mm"}]
  allowedOrderTypes    Json?    // ["DELIVERY","BALCAO","TAKEOUT"] — null/[] = todos
}
```

Adicionar em `Order` para auditoria:

```prisma
model Order {
  // ...
  paymentDiscount      Decimal? // valor calculado e travado no momento da criação
}
```

## Regra de aplicação (server-side, autoritativa)

Ao criar/atualizar pedido, dado um `paymentMethodId` selecionado, o desconto **aplica** se e somente se TODAS forem verdadeiras:

1. `paymentMethod.isActive` E `paymentMethod.discountEnabled`
2. `alwaysAvailable === true` **OU** (`schedule[hoje].enabled` E `agora` ∈ `[from, to)`)
3. `allowedOrderTypes` nulo/vazio **OU** contém o `orderType` normalizado do pedido (usar `src/utils/orderType.js` para normalizar BALCAO/INDOOR/TAKEOUT/PICKUP/RETIRADA)

Cálculo do valor:
- Se `discountPercent`: `round((subtotal) * discountPercent / 100, 2)`
- Se `discountFixed`: `min(discountFixed, subtotal)` (não deixa negativo)
- "subtotal" = total dos itens (não inclui taxa de entrega)

Efeitos colaterais quando regra aplica:
- `ignoreCoupons=true` → cupom é removido do pedido com aviso ao usuário
- `generatesCashback=false` → flag bloqueia geração no fluxo de cashback (verificar `src/routes/cashback` para ponto de inserção)
- Persiste `paymentDiscount` no Order para auditoria/relatórios

## UI

### Backoffice — `PaymentMethodForm.vue`

Adicionar aba **"Desconto"** entre "Geral" e "Financeiro" (ou após Geral). Mostra:

- **Switch** "Habilitar regra de desconto" — quando off, esconde o resto
- **Radio** "Desconto em %" / "Desconto em R$" + input numérico do valor
- **Switch** "Ignorar cupons ao selecionar este método"
- **Switch** "Gerar cashback" (default on)
- **Checkboxes** "Tipos de pedido permitidos": Delivery / Balcão / Retirada (Takeout)
  - Vazio = todos (mostrar hint)
- `<AvailabilityScheduler v-model:always-available="..." v-model:schedule="..." />`

Validação client + server: apenas um entre `discountPercent` e `discountFixed` deve estar preenchido.

### Checkout público — `PublicMenu.vue`

- Quando o cliente seleciona o método de pagamento → chama recálculo do total via endpoint dedicado (`POST /public/cart/preview` ou similar — verificar arquitetura atual)
- Resumo do pedido ganha linha `Desconto pagamento  −R$ X,XX` quando aplicável
- Se método com `ignoreCoupons=true` foi escolhido e há cupom aplicado → SweetAlert: "O cupom será removido porque este método não é cumulativo. Deseja continuar?" (cancel = volta método anterior)

### POS — `POSOrderWizard.vue`

Mesma lógica de recálculo ao trocar método. Linha de desconto no resumo.

## Backend — pontos de edição

1. `delivery-saas-backend/prisma/schema.prisma` — colunas novas + migration via `prisma db push`
2. `delivery-saas-backend/src/routes/menu.js` (ou onde está payment-methods CRUD) — schema de validação (Joi) atualizado
3. **Novo helper** `delivery-saas-backend/src/utils/paymentDiscount.js`:
   - `evaluateDiscountRule(paymentMethod, { orderType, subtotal, now })` → retorna `{ applies: bool, amount: number, removesCoupon: bool, blocksCashback: bool }`
4. `delivery-saas-backend/src/routes/publicCart.js` e `orders.js` — chamar helper na criação; aplicar `paymentDiscount` ao total; remover cupom se aplicável
5. Fluxo de cashback (`src/routes/cashback` ou hook em criação de Order) — respeitar `blocksCashback`

## Frontend — pontos de edição

1. `delivery-saas-frontend/src/views/PaymentMethodForm.vue` — nova aba + binding dos campos
2. `delivery-saas-frontend/src/views/PaymentMethods.vue` — opcional: badge "desconto X%" na lista
3. `delivery-saas-frontend/src/views/PublicMenu.vue` — recálculo + linha resumo + SweetAlert cupom
4. `delivery-saas-frontend/src/components/POSOrderWizard.vue` — recálculo + linha resumo

## Casos de borda

- **Desconto > subtotal**: clampar a `subtotal` (nunca total negativo)
- **Mudança de tipo de pedido após selecionar método**: ao trocar PICKUP↔DELIVERY, reavaliar regra; se deixar de aplicar, esconder a linha de desconto silenciosamente
- **Horário muda durante a sessão (ex: regra ativa entre 11h-14h, cliente faz pedido às 13:59)**: o cálculo final é no momento da criação no backend — UI mostra preview mas o que persiste é o que o backend calcula
- **Cupom + ignoreCoupons**: se cliente aplica cupom DEPOIS de escolher método com ignoreCoupons, validar e bloquear no front com aviso
- **Edição de pedido existente**: ao editar um Order, `paymentDiscount` já travado não recalcula (auditoria), exceto se método muda
- **Múltiplos pagamentos no mesmo pedido (POS split-pay)**: fora do escopo desta v1 — documentar como limitação

## Não-objetivos (YAGNI)

- Cashback com % própria por método (escolhido: só override on/off)
- Desconto aplicado sobre frete (só sobre subtotal de itens)
- Múltiplas regras de desconto por método (faixas, valor mínimo, primeira compra, etc.) — fica para uma futura tabela `PaymentMethodDiscountRule` se necessário
- Suporte a split-payment (múltiplos métodos em um pedido)
- Desconto retroativo em pedidos abertos

## Testes

Cobertura mínima do helper `evaluateDiscountRule`:
- Regra desligada → não aplica
- Desconto % com subtotal 100 e percent 10 → amount 10
- Desconto fixo > subtotal → clamp para subtotal
- Sempre disponível true → ignora schedule
- Schedule do dia desligado → não aplica
- Hora antes de `from` → não aplica
- Hora dentro de `[from, to)` → aplica
- `allowedOrderTypes=["BALCAO"]` + orderType "INDOOR" (sinônimo) → aplica
- `allowedOrderTypes=["DELIVERY"]` + orderType "PICKUP" → não aplica
- `allowedOrderTypes=[]` → aplica em qualquer tipo

Smoke test e2e: criar pedido público via PIX com regra ativa, verificar `paymentDiscount` persistido e total final correto.
