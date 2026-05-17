# Cadastrar e operar combos

## O que é um combo?

Combo é um produto formado por outros produtos, vendido com **preço fechado** (ex.: "Combo X-Bacon" por R$ 35,00 = lanche + refri + batata). No cardápio o cliente vê 1 card com 1 preço; na NFC-e cada componente escolhido aparece como item separado, com os dados fiscais corretos do componente. Isso permite trabalhar com preço promocional sem perder a rastreabilidade fiscal de cada produto.

## Quando usar combo vs produto comum?

- Use **Produto** se for um item único (X-Bacon avulso, refrigerante avulso).
- Use **Combo** se forem vários produtos vendidos juntos por um preço fechado, onde o cliente **escolhe** o que vai em cada slot (ex.: "Lanche + Bebida + Acompanhamento").
- Para um produto com adicionais opcionais (bacon extra, molho extra), use **Produto** comum com **Complementos**, não Combo.

## Passo a passo: criar um combo no admin

1. **Cadastro → Cardápio → Novo produto** e escolha o tipo **"Combo"**.
2. Preencha os campos básicos como em um produto normal: nome, descrição, **preço** (o valor fixo que o cliente paga), categoria, imagem.
3. Vá até a aba **Componentes do combo**.
4. Adicione 1 ou mais **Slots** (ex.: "Lanche", "Bebida", "Acompanhamento"). Cada slot representa uma escolha que o cliente faz no momento do pedido.
5. Em cada slot, defina:
   - **Nome do slot** (visível para o cliente, ex.: "Escolha o lanche").
   - **minSelect / maxSelect** — quantas opções o cliente pode escolher (na maioria dos casos 1/1).
   - **Opções**: lista de produtos que podem ser escolhidos no slot. Para cada opção:
     - **Produto** (autocomplete por nome — o produto precisa estar cadastrado antes).
     - **vUnCom de referência** — valor fiscal que esse produto vale dentro do combo. A soma dos vUnCom escolhidos pelo cliente deveria bater com o preço do combo (se divergir, o sistema rateia proporcionalmente).
     - **Código de integração** (opcional) — SKU usado no iFood, se o cadastro lá tiver código próprio para esse componente.
6. (Opcional) Adicione **complementos pagos** na aba "Complementos" — bacon extra, molho especial, etc. Funcionam como em um produto comum: são adicionais e **somam** ao preço do combo.
7. **Salve**.

## Como o combo aparece para o cliente

- No cardápio público: 1 card único "Combo X-Bacon" com 1 preço.
- Ao clicar: modal com radios/checkboxes para cada slot configurado.
- Subtotal: **preço fixo do combo** (slots não somam, apenas selecionam) + addons selecionados (se houver).

## Como o combo aparece na NFC-e

- O produto-combo **NÃO** aparece como item único na nota fiscal.
- Cada componente escolhido pelo cliente vira um `<det>` separado com:
  - Nome do produto do componente.
  - **NCM / CFOP / ICMS** do **componente** (dadosFiscais do produto linkado).
  - **vUnCom rateado** proporcionalmente ao `vUnComReferencia` cadastrado em cada opção.
- A soma de todos os `<det>` = preço pago pelo cliente.
- Complementos pagos (addons) aparecem como `<det>` separados, com seus próprios valores fiscais.

## Como o combo aparece no cupom impresso

- Linha principal do combo com o preço:
  - `Combo X-Bacon ............ R$ 35,00`
- Sub-linhas indentadas para cada componente escolhido:
  - `  Lanche: X-Tudo`
  - `  Bebida: Coca lata`
  - `  Acomp: Batata G`
  - `  + Bacon extra` (quando houver addon)

## iFood: como cadastrar

- No iFood, cadastre o combo como **1 produto** com **complementos** (modelo nativo do iFood).
- O `integrationCode` do produto-combo no iFood deve ser **igual** ao `integrationCode` cadastrado no admin do Delivery SaaS.
- Cada componente (no iFood é um "complemento") deve ter `integrationCode` igual a:
  - O `integrationCode` cadastrado em **ComboSlotOption** (campo opcional), **OU**
  - O `integrationCode` do **Product linkado** (fallback automático, sem precisar duplicar cadastro).
- Quando um pedido chegar do iFood, o sistema reconhece o combo e categoriza os subitens automaticamente.

## Pitfalls comuns

- **vUnComReferencia em zero**: o sistema bloqueia o salvamento. Garanta que toda opção tenha `vUnCom > 0`.
- **Combo com componente que é outro combo**: não suportado. O picker de opções já filtra `isCombo=true` para evitar.
- **Soma dos vUnCom muito diferente do preço do combo**: o sistema rateia mesmo assim, mas isso distorce o valor fiscal de cada item (ex.: um refri marcado como "R$ 10,00" pode sair como "R$ 2,50" na NFe). Alinhe com o contador antes de cadastrar.
- **Migrar um combo antigo** (cadastrado como Product + OptionGroup obrigatório): **NÃO** há conversão automática. Crie o combo novo e desative o cadastro antigo.

## Onde ver / debugar

- **Lista de pedidos** (Orders): cada pedido com combo mostra os componentes agrupados no detalhe.
- **NFC-e** (Emissões Fiscais): o XML com os itens expandidos pode ser baixado pelo módulo de NFe.
- **Cupom**: o template do print-agent espelha a mesma expansão exibida no detalhe do pedido.

## Suporte

Quando algo der errado, anote o **ID do pedido** e o **ID do combo** envolvidos, e abra uma issue no GitHub referenciando `docs/plans/2026-05-16-combo-products-design.md`.
