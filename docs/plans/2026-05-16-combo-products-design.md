# Combo Products — Design

**Data:** 2026-05-16
**Status:** Aprovado, pronto para planejamento de implementação

## Problema

Hoje combos são vendidos como produto único e declarados na NFe como **um item só**. Isso impede:
- Declarar valores fiscais por componente (NCM, CFOP, ICMS distintos por item)
- Aplicar tributação correta quando os componentes pertencem a categorias fiscais diferentes (ex.: refrigerante vs alimento)
- Auditar o que efetivamente foi vendido dentro do combo

A necessidade é tratar combos como **produtos compostos**: do ponto de vista do cliente, um item único com preço fechado; do ponto de vista fiscal, N itens com valores rateados.

## Contexto atual relevante

- `Product` é uma entidade única com `dadosFiscais` (NCM/CFOP/ICMS) próprios.
- `OrderItem` guarda 1 linha + `options[]` em JSON.
- Commit `93e6a4c` já expande cada option em `<det>` separado na NFC-e com seu próprio fiscal e suprime o "guarda-chuva" quando o preço dele é ≤ R$ 0,10.
- `Option` já tem `linkedProductId` opcional (option pode referenciar um Product real).
- `integrationMatcher.js` resolve item principal por `Product.integrationCode` e subitens por `Option.integrationCode` (e por `linkedProduct.integrationCode`).

## Decisões de produto

1. **Componentes variáveis** — combo tem slots com escolha (não componentes fixos).
2. **Preço único pago pelo cliente** — combo tem preço fixo independente da escolha.
3. **Operador define vUnCom de referência por opção** — cada `(slot, opção)` tem um valor fiscal de referência cadastrado no admin.
4. **Backend faz rateio proporcional** — soma das referências dos slots escolhidos é ajustada por um fator para fechar exatamente o preço do combo na NFe.
5. **Combo coexiste com complementos tradicionais** — além dos slots obrigatórios, o cliente pode marcar OptionGroups extras pagos (ex.: "bacon extra +R$3").
6. **No public menu, combo se comporta como item com opcionais** — UX familiar, slots renderizados antes de complementos tradicionais.

## Arquitetura

### Modelagem (Prisma)

Novos modelos, sem quebrar nada existente:

```prisma
model Product {
  // ... campos atuais
  isCombo Boolean @default(false)
  combo   Combo?
}

model Combo {
  id        String      @id @default(uuid())
  productId String      @unique
  product   Product     @relation(fields: [productId], references: [id])
  companyId String
  slots     ComboSlot[]
  createdAt DateTime    @default(now())
  updatedAt DateTime    @updatedAt
  @@index([companyId])
}

model ComboSlot {
  id        String            @id @default(uuid())
  comboId   String
  combo     Combo             @relation(fields: [comboId], references: [id], onDelete: Cascade)
  name      String
  minSelect Int               @default(1)
  maxSelect Int               @default(1)
  position  Int               @default(0)
  options   ComboSlotOption[]
}

model ComboSlotOption {
  id               String    @id @default(uuid())
  slotId           String
  slot             ComboSlot @relation(fields: [slotId], references: [id], onDelete: Cascade)
  linkedProductId  String
  linkedProduct    Product   @relation(fields: [linkedProductId], references: [id])
  vUnComReferencia Decimal
  integrationCode  String?
  position         Int       @default(0)
  @@index([slotId])
}
```

- `Product.price` no combo continua sendo o **preço pago pelo cliente**.
- `Product.productOptionGroups` mantém o uso atual para complementos adicionais.
- Estoque/ficha técnica do combo vem dos componentes (cada `linkedProduct` tem seu `stockIngredient`).
- Deletar Product usado em `ComboSlotOption` deve falhar (proteção de integridade).

### Cadastro no admin

Ao clicar em "Novo produto", modal inicial pergunta tipo:
- **Produto** → fluxo atual sem mudança.
- **Combo** → cadastro estendido com aba "Componentes do combo".

A aba **Complementos** continua exatamente como hoje (`ProductOptionGroup`) — o combo herda essa funcionalidade automaticamente.

Aba "Componentes":
- Lista de slots ordenáveis, cada slot com `name`, `minSelect`, `maxSelect`.
- Picker de opção busca produtos da mesma `companyId`. `vUnComReferencia` pré-preenchido com `linkedProduct.price`, editável.
- Campo opcional `integrationCode` por ComboSlotOption (para SKU específico do iFood).

Validações ao salvar:
- `Product.price > 0`.
- Cada slot tem ≥ 1 opção e `minSelect ≤ maxSelect`.
- Cada `vUnComReferencia > 0`.
- Warning (não bloqueio) se `soma(maior vUnCom de cada slot)` ou `soma(menor vUnCom de cada slot)` divergir muito de `Product.price` — rateio vai distorcer muito.

### Public menu / carrinho

Combo renderizado pelo mesmo componente de "produto com opcionais":
- Slots (radio, 1 de N) renderizados **antes** dos complementos.
- Opções dos slots **não exibem preço** (preço já está no combo).
- Complementos tradicionais continuam mostrando `+R$ X,XX` e somando ao subtotal.
- Botão "Adicionar" só habilita quando todos os slots estão preenchidos.

Payload `addToCart`:
```json
{
  "productId": "<combo-product-id>",
  "quantity": 1,
  "options": [
    { "kind": "combo_slot", "slotId": "...", "optionId": "...",
      "productId": "<linkedProductId>", "name": "X-Tudo",
      "vUnComReferencia": 25.00 },
    { "kind": "addon", "optionId": "<optionId>",
      "name": "Bacon extra", "price": 3.00 }
  ]
}
```

Cálculo do preço da linha:
```
linePrice = Product.price                            // fixo do combo
          + soma(addon.price) onde kind === 'addon'
          + soma(option.price) onde kind ausente     // compat legado
```
Slots NÃO somam — já estão dentro do `Product.price`.

### NFe — rateio fiscal e expansão em `<det>`

Estende `delivery-saas-backend/src/services/nfe.js:563`. Para cada `OrderItem` cujo Product tem `isCombo=true`:

```
slots      = options.filter(o => o.kind === 'combo_slot')
addons     = options.filter(o => o.kind === 'addon' || !o.kind)

precoCombo = OrderItem.price
somaRef    = soma(slot.vUnComReferencia)
fator      = precoCombo / somaRef

para cada slot:
   vUnCom_ajustado = round(slot.vUnComReferencia × fator, 4)
   vProd           = vUnCom_ajustado × quantity

// Diferença de centavos (arredondamento) cai no último slot.
```

Casos extremos:
- `somaRef === precoCombo` → fator=1, sem ajuste.
- `somaRef > precoCombo` → fator<1, comprime.
- `somaRef < precoCombo` → fator>1, expande.
- `somaRef === 0` → throw (cadastro inválido).
- `quantity > 1` → rateio sobre `precoCombo`, `qCom = quantity` no mesmo `<det>` por componente.

**Guarda-chuva**: Product combo é **sempre suprimido** quando `isCombo=true` (independente do preço). Slots e addons viram os `<det>`.

**Addons**: sem mudança. Continuam expandindo com seu próprio `vUnCom = addon.price`, usando `dadosFiscais` do `Option.linkedProduct` ou fallback.

**Fiscal por componente**: cada slot usa `linkedProduct.dadosFiscais` (com fallback de categoria — lógica já existente).

**DANFE térmica / cupom**: espelha a expansão (compartilha builder).

### OrderItem, KDS, cupom, relatórios

- OrderItem schema inalterado. `options[]` JSON ganha discriminador `kind`.
- Items legados sem `kind` continuam como `addon` (compatibilidade).
- Cupom de cozinha renderiza slots com label (`Lanche:`, `Bebida:`) e addons com `+`.
- Relatório de produtos vendidos: combo conta como produto próprio; componentes NÃO somam (evita duplicação).
- Relatório de estoque: componentes aparecem (são eles que mexem em ingredientes).
- Relatório fiscal: usa os `<det>` da NFe (cada componente em sua categoria).
- Estoque: ao confirmar pedido, baixa por componente (cada `linkedProduct.stockIngredient`).

### Integração iFood

Webhook `integrationMatcher`:
1. Item principal por `externalCode` → bate com `Product`. Se `isCombo=true`, ativa modo combo.
2. Para cada subitem:
   - Procura primeiro em `ComboSlotOption` deste combo (por `integrationCode` direto, depois por `linkedProduct.integrationCode`). Match → `kind=combo_slot` com `vUnComReferencia` do cadastro.
   - Senão, procura em `Option` associada (OptionGroups tradicionais). Match → `kind=addon` com preço do iFood.
   - Senão, fallback `kind=addon` com nome+preço do iFood (graceful, não trava).

`ComboSlotOption.integrationCode` é opcional — vazio cai no `linkedProduct.integrationCode`, evitando duplicação para operadores que já cadastram componentes como produtos com integrationCode próprio.

## Migração e rollout

- Nova migration: campo `Product.isCombo` (default false), tabelas `Combo`, `ComboSlot`, `ComboSlotOption`.
- Dados existentes: zero impacto (todos os products entram com `isCombo=false`; OrderItems sem `kind` tratados como `addon`).
- Combos atuais (modelados como Product + OptionGroups obrigatórios): conversão manual via UI. Doc curto em `docs/operacao/` explica o passo a passo.
- Sem feature flag — `isCombo` já é o gate natural. Empresa sem combo não vê mudança.

Ordem sugerida de rollout:
1. Schema + migration + service NFe (rateio).
2. Admin (cadastro).
3. Public menu + carrinho.
4. Webhook iFood matcher.
5. Print agent (template).
6. 1 empresa de teste antes de geral.

## Testes mínimos

Unit:
- Rateio com `somaRef === / > / < precoCombo`.
- Rateio com `quantity > 1`.
- Rateio com floats problemáticos (33,33 × 3 ≠ 100) → diferença de centavo no último item.
- Matcher iFood: subitem em slot, em option, sem match.

Integration:
- Emitir NFC-e de combo em homologação SVRS, validar expansão e total.

Manual:
- Cadastrar combo no admin.
- Vender via public menu.
- Vender via PDV.
- Vender via webhook iFood.

## Arquivos a tocar

**Backend (`delivery-saas-backend/`)**:
- `prisma/schema.prisma` — adiciona models (1 migration).
- `src/routes/products.js` (ou rota equivalente) — POST/PUT aceita payload combo.
- `src/services/nfe.js:563` — expansão com rateio.
- `src/utils/danfeText.js` — espelhar expansão no cupom.
- `src/utils/integrationMatcher.js` — categorizar subitens (slot vs addon).
- `src/services/ifoodWebhookProcessor.js` — propagar `kind`.

**Frontend (`delivery-saas-frontend/`)**:
- View de cadastro de produto — modal "tipo: produto/combo", aba "Componentes".
- Cardápio público — renderizar slots antes de complementos.
- PDV / Orders / SaleDetails — exibir componentes agrupados.

**Print agent (`delivery-print-agent-electron/`)**:
- `src/defaultTemplate.js` / `src/templateEngine.js` — slot vs addon (provavelmente só formatação; backend pode entregar pronto).

## Não escopo

- Combos com componentes fixos (sem escolha) — possível extensão futura (slot com 1 opção e min=max=1 já cobre).
- Promo de combo dinâmico (preço varia conforme dia/hora) — pode reusar o sistema de availability/cashback existente, fora deste design.
- Marketplace além do iFood — quando novos provedores forem integrados, replicar lógica do matcher.
- Conversão automática de combos legados — manual no admin.
