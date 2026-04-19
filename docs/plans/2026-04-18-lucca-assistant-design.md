# Lucca — Assistente de Suporte IA

**Data**: 2026-04-18
**Status**: Aprovado

## Resumo

Assistente de IA chamado "Lucca" integrado ao painel de gestão do Delivery SaaS. Responde dúvidas dos usuários sobre como usar o sistema, baseado em uma knowledge base em Markdown. Usa Gemini 2.0 Flash com context stuffing (sem RAG).

## Decisões de Design

| Decisão | Escolha | Motivo |
|---------|---------|--------|
| Provider IA | Gemini 2.0 Flash | Melhor custo-benefício ($0.10/1M input), contexto de 1M tokens |
| Armazenamento KB | Arquivos Markdown no git | Simples, versionado, sem infra extra |
| Estratégia de retrieval | Context stuffing (wiki inteira no prompt) | Wiki ~50-80K tokens, cabe no contexto do Gemini |
| Interface | Widget flutuante (chat) | Acessível em todas as páginas sem sair do fluxo |
| Contexto de página | Sim, via `useRoute().path` | Respostas mais precisas e relevantes |

## Escopo

- **Inclui**: Dúvidas sobre uso do sistema (como cadastrar, como configurar, como usar)
- **Não inclui**: Consulta a dados operacionais (faturamento, pedidos, etc.) — fase futura

## Estrutura da Knowledge Base

Localização: `delivery-saas-backend/knowledge-base/`

```
knowledge-base/
├── _system-prompt.md          # Personalidade e instruções do Lucca
├── geral/
│   ├── visao-geral.md         # O que é o sistema, conceitos básicos
│   ├── primeiro-acesso.md     # Wizard, configurações iniciais
│   └── navegacao.md           # Menu lateral, estrutura do painel
├── pedidos/
│   ├── painel-pedidos.md      # Como funciona o painel de pedidos
│   ├── status-pedidos.md      # Fluxo de status (pendente → concluído)
│   ├── pedido-manual.md       # Criar pedido manualmente
│   └── historico.md           # Consultar histórico
├── cardapio/
│   ├── menus.md               # Criar/gerenciar menus
│   ├── categorias.md          # Categorias de produtos
│   ├── produtos.md            # Cadastro de produtos
│   ├── opcoes-complementos.md # Grupos de opções e complementos
│   └── importacao.md          # Importar cardápio
├── clientes/
│   ├── cadastro.md            # Cadastrar clientes
│   ├── grupos.md              # Grupos de clientes e descontos
│   └── perfil.md              # Visualizar perfil do cliente
├── entregadores/
│   ├── cadastro.md            # Cadastrar entregadores
│   ├── conta-corrente.md      # Conta do entregador
│   ├── turnos.md              # Turnos e check-ins
│   ├── metas-bonus.md         # Metas e regras de bônus
│   └── rastreamento.md        # Mapa e GPS
├── estoque/
│   ├── ingredientes.md        # Cadastro de ingredientes
│   ├── fichas-tecnicas.md     # Fichas técnicas
│   ├── movimentacoes.md       # Entradas e saídas
│   └── fornecedores.md        # Fornecedores
├── financeiro/
│   ├── contas.md              # Contas financeiras
│   ├── lancamentos.md         # Lançamentos (pagar/receber)
│   ├── fluxo-caixa.md         # Fluxo de caixa
│   ├── dre.md                 # DRE
│   ├── gateways.md            # Gateways de pagamento
│   └── ofx.md                 # Importação OFX
├── fiscal/
│   ├── dados-fiscais.md       # Configurar dados fiscais
│   └── nfce.md                # Emitir NFC-e
├── integracoes/
│   ├── ifood.md               # Integração iFood
│   ├── whatsapp.md            # WhatsApp e Inbox
│   └── aiqfome.md             # AiqFome
├── cupons/
│   └── cupons.md              # Criar e gerenciar cupons
├── cashback/
│   └── cashback.md            # Configurar cashback
├── afiliados/
│   └── afiliados.md           # Módulo de afiliados
├── impressao/
│   ├── configuracao.md        # Configurar impressora
│   └── agent.md               # Instalar print agent
├── relatorios/
│   └── relatorios.md          # Todos os relatórios disponíveis
├── caixa/
│   └── frentes-caixa.md       # Abertura/fechamento de caixa
└── configuracoes/
    ├── empresa.md             # Dados da empresa
    ├── bairros.md             # Bairros e taxas de entrega
    ├── lojas.md               # Multi-loja
    ├── usuarios.md            # Usuários e permissões
    └── formas-pagamento.md    # Formas de pagamento
```

## Formato dos Artigos

```markdown
# Título da Funcionalidade

## O que é
Explicação breve do que é e para que serve.

## Como acessar
Menu lateral → Seção → Página

## Como usar
1. Passo um
2. Passo dois
3. Passo três

## Dúvidas frequentes
**Pergunta comum?**
Resposta direta.
```

## System Prompt do Lucca

```
Você é o Lucca, assistente de suporte do sistema de gestão.

Regras:
- Responda APENAS sobre o uso do sistema. Não responda perguntas fora desse escopo.
- Use linguagem simples e direta, como se estivesse explicando para alguém não técnico.
- Quando possível, dê passos numerados (1, 2, 3...).
- Se não souber a resposta, diga que não sabe e sugira contatar o suporte.
- Nunca invente funcionalidades que não existem.
- O usuário está na página: {{currentPage}}. Use isso para contextualizar respostas.
- Seja breve. Máximo 3-4 parágrafos por resposta.
```

## API

### `POST /api/lucca/chat`

**Auth**: JWT (usuário logado)

**Request**:
```json
{
  "message": "como cadastro um produto?",
  "currentPage": "/cardapio/produtos",
  "history": [
    { "role": "user", "content": "oi" },
    { "role": "assistant", "content": "Olá! Sou o Lucca..." }
  ]
}
```

**Response**:
```json
{
  "reply": "Para cadastrar um produto, siga estes passos: ..."
}
```

**Fluxo interno**:
1. Recebe mensagem + página atual + histórico
2. Carrega arquivos `.md` do cache em memória
3. Monta prompt: system prompt (com `{{currentPage}}` substituído) + wiki completa + histórico + mensagem
4. Chama Gemini 2.0 Flash API
5. Retorna resposta

**Cache**: Arquivos `.md` lidos uma vez na inicialização e mantidos em memória. Invalidação no restart do servidor.

## Frontend — Widget LuccaChat

- Componente `LuccaChat.vue` montado no `App.vue`
- Botão circular no canto inferior direito
- Abre painel de chat com header, área de mensagens e input
- Envia `currentPage` via `useRoute().path`
- Histórico em `sessionStorage` (limpa ao fechar aba)
- **Não renderiza** em rotas que começam com `/pedidos`
- Visual consistente com Bootstrap 5 do projeto

## Dependências Novas

- `@google/generative-ai` (SDK do Gemini) no backend
- Variável de ambiente `GEMINI_API_KEY`

## Evolução Futura

1. Consulta a dados operacionais via function calling
2. Migração para RAG se a wiki crescer muito
3. Painel admin para editar artigos sem deploy
4. Analytics de perguntas mais frequentes
