# Frontend - Módulo Financeiro

## Estrutura de Views

```
src/views/financial/
├── FinancialDashboard.vue    # Painel principal com resumo (cards + atalhos)
├── FinancialAccounts.vue     # CRUD de contas bancárias/caixas/marketplaces
├── FinancialTransactions.vue # Contas a pagar/receber com filtros e paginação
├── FinancialCashFlow.vue     # Fluxo de caixa realizado vs. previsto
├── FinancialDRE.vue          # Demonstrativo de Resultado com detalhamento
├── FinancialGateways.vue     # Configuração de taxas + simulador
├── FinancialOFX.vue          # Importação e conciliação de extratos OFX
├── FinancialCostCenters.vue  # Centros de custo hierárquicos (seed DRE)
└── README.md
```

## Rotas

Todas as rotas estão sob `/financial` e requerem `role: 'ADMIN'`:

| Rota | Componente | Descrição |
|------|-----------|-----------|
| `/financial` | FinancialDashboard | Dashboard com resumo financeiro |
| `/financial/transactions` | FinancialTransactions | Contas a pagar/receber |
| `/financial/cash-flow` | FinancialCashFlow | Fluxo de caixa |
| `/financial/dre` | FinancialDRE | DRE por período |
| `/financial/accounts` | FinancialAccounts | Contas bancárias |
| `/financial/gateways` | FinancialGateways | Taxas e operadoras |
| `/financial/ofx` | FinancialOFX | Conciliação OFX |
| `/financial/cost-centers` | FinancialCostCenters | Centros de custo |

## Padrões Seguidos

- Usa `api` (axios) de `src/api.js` (nunca fetch)
- Componentes `<TextInput>` e `<SelectInput>` dos wrappers existentes
- Modais inline com Bootstrap (sem lib externa)
- Formatação de moeda: `Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })`
- Menu lateral: entrada com `moduleKey: 'financial'` para gating via SaaS

## Gating no Menu

O item "Financeiro" no Sidebar usa `moduleKey: 'financial'`, que é verificado contra a lista de módulos habilitados no plano SaaS da empresa. Se o módulo `FINANCIAL` não estiver ativado no plano, o menu não aparece.
