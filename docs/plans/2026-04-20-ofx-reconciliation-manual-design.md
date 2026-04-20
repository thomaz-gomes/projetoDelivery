# Design — Conciliação Manual OFX com Drawer

**Data**: 2026-04-20
**Status**: Aprovado

## Problema

A tela de conciliação OFX mostra itens importados mas não oferece:
- Indicação clara de match (descrição do lançamento vinculado + confiança)
- Conciliação manual quando não há match automático
- Possibilidade de desfazer um match existente
- Criação de novo lançamento a partir de item sem correspondência

## Solução

### 1. Tabela de itens melhorada

Coluna **Match** mostra descrição do lançamento vinculado + badge de confiança traduzido.

Botões contextuais por status:
- **Pendente / Sem correspondência**: "Conciliar" (primário) + "Ignorar"
- **Conciliado / Conciliado (manual)**: "Desfazer" (volta para Pendente)
- **Ignorado**: sem ações

Tradução de status (enum → UI):
| Enum | UI |
|------|-----|
| PENDING | Pendente |
| MATCHED | Conciliado |
| MANUAL | Conciliado (manual) |
| IGNORED | Ignorado |
| UNMATCHED | Sem correspondência |

### 2. Drawer lateral de conciliação (~450px à direita)

Abre ao clicar "Conciliar" em um item PENDING/UNMATCHED.

**Cabeçalho**: dados do item OFX (descrição, data, valor em destaque, FITID)

**Área 1 — Candidatos sugeridos**:
- Lista de cards com lançamentos candidatos ordenados por score
- Cada card: descrição, valor, data de vencimento, score (badge colorido)
- Botão "Vincular" em cada card → concilia como MANUAL
- Mensagem "Nenhum lançamento compatível encontrado" se lista vazia

**Área 2 — Busca manual**:
- Campo de busca por texto (filtra lançamentos por descrição)
- Resultados na mesma lista de cards com botão "Vincular"

**Área 3 — Criar novo lançamento** (botão que expande formulário):
- Formulário completo pré-preenchido com dados do OFX:
  - Tipo: A PAGAR (valor negativo) ou A RECEBER (positivo) — editável
  - Descrição: memo do OFX — editável
  - Valor bruto: valor absoluto do OFX — editável
  - Taxa: 0 — editável
  - Valor líquido: calculado (bruto - taxa)
  - Data emissão: data do OFX — editável
  - Data vencimento: data do OFX — editável
  - Data pagamento: data do OFX
  - Conta: conta da importação (pré-selecionada)
  - Centro de custo: select — obrigatório
  - Origem: MANUAL
  - Status: PAGO (já apareceu no extrato)
- Botão "Criar e Vincular" → cria lançamento + concilia automaticamente

**Rodapé**: Botão "Fechar"

### 3. Backend — novas rotas

**`GET /financial/ofx/items/:id/candidates`**
- Busca FinancialTransaction candidatos para um item OFX
- Reutiliza lógica de scoring do ofxProcessor.js (valor ±R$5, data ±3 dias)
- Aceita query `?search=texto` para busca manual por descrição
- Retorna: lista com `{ id, description, grossAmount, netAmount, dueDate, score }`

**`POST /financial/ofx/items/:id/create-and-match`**
- Recebe dados do formulário de novo lançamento
- Cria FinancialTransaction com status PAID + sourceType "MANUAL"
- Vincula ao item OFX como MANUAL com confiança 1.0
- Retorna item atualizado

**Rota existente ajustada: `POST /financial/ofx/items/:id/match`**
- Nova action `undo` → volta item para PENDING, limpa transactionId, matchConfidence, resolvedBy

### 4. Sem alterações em

- Schema Prisma (campos já existem)
- Lógica de importação/IA (continua igual)
- Outras views financeiras
