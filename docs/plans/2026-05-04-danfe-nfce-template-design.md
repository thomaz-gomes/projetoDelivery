# Design: redesenhar template DANFE NFC-e para o padrão MOC v6.0

**Data:** 2026-05-04
**Status:** Aprovado, aguardando plano de implementação
**Função afetada:** `formatDanfeText` em `delivery-saas-backend/src/routes/agentPrint.js:117-243`

## Problema

O template atual gera um cupom com a maior parte dos blocos exigidos pelo Manual de Especificações Técnicas do DANFE NFC-e (v6.0, mar/2025), mas com várias divergências em relação ao padrão oficial. Isso compromete a aderência ao MOC e dificulta a validação visual em fiscalização ou em consultas por leitores de QR.

## Padrão oficial (resumo)

A NFC-e (modelo 65) é dividida em **divisões obrigatórias** por ordem de impressão:

| Divisão | Conteúdo |
|---|---|
| I — Cabeçalho | Razão social, CNPJ, endereço |
| II — Identificação | "DANFE NFC-e" + "Documento Auxiliar da Nota Fiscal de Consumidor Eletronica" |
| III — Itens | Tabela com `# CÓDIGO DESCRIÇÃO QTD UN VL UNIT VL TOT` |
| IV — Totais | Qtd itens, valor total, descontos, acréscimos, pagamento, troco |
| V — Consulta por chave | Texto **"Consulte pela Chave de Acesso em"** + URL + chave em grupos de 4 |
| VI — QR Code | QR (mín. 25mm) com URL conforme NT2015/002 |
| VII — NFC-e + Protocolo | NFC-e nº, série, data; "Protocolo de autorização" |
| VIII — Consumidor | "CONSUMIDOR CPF: …", "CNPJ: …" ou "CONSUMIDOR NÃO IDENTIFICADO" |

Aviso obrigatório em homologação: **"EMITIDA EM AMBIENTE DE HOMOLOGAÇÃO - SEM VALOR FISCAL"**.

## Diagnóstico

| Bloco MOC | Atual | Ação |
|---|---|---|
| Cabeçalho com CNPJ formatado | ✅ | manter |
| Título "DANFE NFC-e" | ❌ "DOCUMENTO AUXILIAR…" | corrigir |
| Tabela com `# CÓDIGO UN VL UNIT` | ❌ só `DESCRICAO QTD TOTAL` | expandir para 2 linhas/item |
| Linha de Desconto/Troco | ❌ ausente | adicionar quando > 0 |
| "Consulte pela Chave de Acesso em" | ❌ "Consulte a NF-e pelo QR Code" | corrigir |
| Identificação do consumidor | ❌ ausente | adicionar |
| Aviso homologação | ✅ | manter |
| Chave em grupos de 4 | ✅ | manter |
| Protocolo + NFC-e + Série + Emissão | ✅ | padronizar formato |

## Decisões de design

### 1. Largura mantida em 48 colunas

Impressora térmica 80mm (padrão majoritário do parque). 32 col (58mm) fica fora de escopo.

### 2. Tabela de itens em 2 linhas por item

48 colunas não comportam todas as colunas do MOC numa só linha. Padrão real do mercado é dobrar:

```
001 X-BURGUER ESPECIAL DUPLO
    2 UN  x R$ 25,00                    R$ 50,00
003 COCA-COLA 350ML
    1 UN  x R$ 6,00                     R$ 6,00
```

- `#` = sequencial 001, 002, 003 (zero-padded). Não usar `productId` (decisão validada com usuário; `productId` UUID truncado polui a leitura).
- `UN` = literal "UN" — o schema `OrderItem` não armazena unidade por item; "UN" é o default seguro para lanchonete/delivery.
- Valor unitário com `R$ 0,00` (vírgula decimal — convenção brasileira).
- Descrição quebra em até 2 linhas se passar de 44 chars (4 chars do número + espaço).

### 3. Bloco de totais expandido

```
Qtd itens: 3
Subtotal:                            R$ 56,00
Desconto:                          - R$ 6,00     ← só se vDesc > 0
Acréscimo:                         + R$ 5,00     ← só se vOutro > 0
TOTAL:                               R$ 55,00
Pagamento: Cartao de Credito
Troco:                               R$ 0,00     ← só se troco > 0
```

Lê `order.deliveryFee` como acréscimo (frete) e `order.discount` como desconto. Os valores de troco vêm de `order.payload.payment.change` (já existe em outros pontos do código).

### 4. Bloco do consumidor

Imprime **antes** da chave de acesso (Divisão VIII, conforme MOC):

- Se `order.customer?.cpf` ou `order.payload?.customer?.cpf` → `CONSUMIDOR CPF: 999.999.999-99` + linha com nome (se presente).
- Senão → `CONSUMIDOR NAO IDENTIFICADO` (sem acentos para tolerar code-pages limitadas das térmicas).

CPF é formatado: `999.999.999-99`.

### 5. Texto de consulta MOC-compliant

```
Consulte pela Chave de Acesso em
nfce-homologacao.svrs.rs.gov.br/consulta
```

A URL é a mesma que já está em uso (`consultaUrl` calculado por `tpAmb`), só o texto introdutório muda.

### 6. Linha de identificação NFC-e padronizada

```
NFC-e nro. 000123 Serie 1
Emissao: 04/05/2026 21:30
Protocolo: 135250000123456 04/05/2026 21:30:15
I.E.: 999999999
```

## O que NÃO faremos (YAGNI)

- **Tributos aproximados (Lei 12.741)** — opcional no MOC; exige tabela IBPT mensalmente atualizada. Fora do escopo.
- **Logo da loja** — exigiria raster image em ESC/POS; muda o protocolo do agente.
- **Suporte a 32 colunas (58mm)** — não há demanda atual.
- **NF-e mod 55 (DANFE retrato A4)** — esse cupom é só NFC-e (mod 65); mod 55 é responsabilidade de outro fluxo.

## Validação

1. **Visual em homologação**: emitir uma NF-e de teste com 1 item simples → conferir que o cupom impresso tem todas as 7 divisões na ordem correta + faixa de homologação.
2. **Item múltiplo + desconto**: emitir com 3 itens, aplicar desconto → ver linha "Desconto" e item enumerado 001/002/003.
3. **Cliente identificado**: emitir num pedido com CPF de cliente → bloco "CONSUMIDOR CPF" aparece.
4. **Cliente anônimo**: emitir num pedido sem CPF → "CONSUMIDOR NAO IDENTIFICADO" aparece.
5. **Troco**: pagamento em dinheiro com troco → linha "Troco" aparece com valor.

## Compatibilidade

- O agente Electron (`delivery-print-agent-electron/src/templateEngine.js`) recebe o texto via `order.receiptTemplate` e renderiza ESC/POS. Não há mudança no protocolo.
- O placeholder `[QR:url]` continua sendo substituído pelo agente como antes.
- Nenhum schema de DB muda.
- Nenhum campo novo na NfeProtocol.
