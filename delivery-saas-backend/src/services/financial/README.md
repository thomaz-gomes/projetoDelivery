# Services - Módulo Financeiro

## Responsabilidade

Este diretório contém a lógica de negócio isolada do módulo financeiro, separada dos controllers/routes.

## Arquivos

### feeCalculator.js
Calcula taxas de operadoras (iFood, Stone, Cielo, etc.) com base na configuração `PaymentGatewayConfig`.

**Regras de negócio:**
- Suporta 3 tipos de taxa: percentual, fixa e mista
- Calcula data de recebimento (D+N) pulando finais de semana
- Retorna breakdown detalhado para auditoria

### ofxProcessor.js
Parser de arquivos OFX e algoritmo de conciliação automática.

**Regras de negócio:**
- Parse de formato SGML (padrão OFX brasileiro)
- Match automático com scoring ponderado (valor 50%, data 30%, descrição 20%)
- Threshold de 0.7 para match automático
- Itens abaixo do threshold ficam em fila para resolução manual

### orderFinancialBridge.js
Bridge entre módulos legados (Orders, Riders, Affiliates) e o financeiro.

**Regras de negócio:**
- Idempotente: verifica duplicidade antes de criar
- Não bloqueia fluxo original em caso de erro (try/catch)
- Detecta automaticamente origem marketplace (iFood) para aplicar taxas
- Registra cupons como deduções no DRE

**Como usar (em módulos legados):**
```javascript
// Em orders.js, após status CONCLUIDO:
import { createFinancialEntriesForOrder } from '../services/financial/orderFinancialBridge.js';
await createFinancialEntriesForOrder(order);

// Em riders.js, após criar RiderTransaction:
import { createFinancialEntryForRider } from '../services/financial/orderFinancialBridge.js';
await createFinancialEntryForRider(riderTransaction, companyId);

// Em affiliates.js, após criar AffiliatePayment:
import { createFinancialEntryForAffiliate } from '../services/financial/orderFinancialBridge.js';
await createFinancialEntryForAffiliate(affiliatePayment, companyId);
```
