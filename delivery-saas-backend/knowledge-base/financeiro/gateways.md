# Taxas e Operadoras

## O que e
Aqui voce cadastra as operadoras e plataformas que cobram taxas sobre suas vendas, como iFood, Rappi, Stone, Cielo, PagSeguro, Mercado Pago, entre outras. O sistema usa essas configuracoes para calcular automaticamente o valor liquido que voce realmente recebe em cada venda.

## Como acessar
Menu lateral → Financeiro → Taxas e Operadoras

## Como usar

### Cadastrar uma nova operadora
1. Clique em **Nova Configuracao**.
2. Escolha a **Operadora** na lista (iFood, Rappi, Stone, Cielo, PagSeguro, Mercado Pago, PIX Manual ou Outro).
3. Preencha o **Label** para diferenciar configuracoes da mesma operadora (exemplo: "Stone Credito", "Stone Debito").
4. Escolha o **Tipo de Taxa**:
   - Percentual: cobra um percentual sobre o valor da venda.
   - Fixa: cobra um valor fixo por transacao.
   - Mista: cobra percentual mais valor fixo.
5. Informe a **Taxa %** (exemplo: 0.12 para 12%) e/ou a **Taxa Fixa** em reais.
6. Defina o **Prazo** em dias uteis para recebimento (D+N).
7. Opcionalmente, informe a **Taxa de Antecipacao** se a operadora cobrar para antecipar recebimentos.
8. Clique em **Salvar**.

### Simular taxas
1. Na lista de operadoras, clique em **Simular** ao lado da configuracao desejada.
2. Informe o **Valor Bruto** da venda.
3. Clique em **Calcular** para ver o valor da taxa, o valor liquido e a data prevista de recebimento.

### Editar uma configuracao
Clique em **Editar** ao lado da operadora para alterar taxas, prazos ou labels.

## Duvidas frequentes

**Preciso cadastrar uma operadora para cada forma de pagamento?**
Sim, e recomendado. Por exemplo, a Stone pode ter taxas diferentes para credito e debito, entao crie duas configuracoes com labels diferentes.

**O que e o D+N?**
E o prazo em dias uteis para o dinheiro cair na sua conta. Exemplo: D+1 significa que voce recebe no dia util seguinte a venda.

**O calculo de taxas e automatico nos pedidos?**
Sim. Quando voce associa uma operadora a um lancamento, o sistema calcula a taxa e o valor liquido automaticamente.
