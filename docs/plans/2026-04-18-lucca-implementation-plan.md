# Lucca — Assistente de Suporte IA — Plano de Implementação

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Criar o assistente Lucca — um chatbot de suporte alimentado por Gemini Flash que responde dúvidas dos usuários sobre o sistema, com base em uma knowledge base em Markdown.

**Architecture:** Arquivos `.md` no backend servem como knowledge base. Uma rota POST recebe a mensagem + contexto da página, carrega toda a wiki em memória, e envia para o Gemini Flash API. O frontend tem um widget flutuante de chat em todas as páginas exceto pedidos.

**Tech Stack:** Gemini 2.0 Flash API, Express.js, Vue 3, Bootstrap 5

---

## Task 1: Instalar SDK do Gemini no backend

**Files:**
- Modify: `delivery-saas-backend/package.json`

**Step 1: Instalar dependência**

```bash
cd delivery-saas-backend && npm install @google/generative-ai
```

**Step 2: Adicionar GEMINI_API_KEY ao .env**

Adicionar no `.env` do backend:
```
GEMINI_API_KEY=your-api-key-here
```

**Step 3: Verificar que a variável é injetada no Docker**

Em `docker-compose.yml`, no serviço do backend, adicionar:
```yaml
- GEMINI_API_KEY=${GEMINI_API_KEY:-}
```

**Step 4: Commit**

```bash
git add package.json package-lock.json docker-compose.yml
git commit -m "chore: add @google/generative-ai SDK and GEMINI_API_KEY env"
```

---

## Task 2: Criar a Knowledge Base — System Prompt

**Files:**
- Create: `delivery-saas-backend/knowledge-base/_system-prompt.md`

**Step 1: Criar o arquivo**

```markdown
Você é o Lucca, assistente virtual de suporte do sistema de gestão Core Delivery.

Regras:
- Responda APENAS perguntas sobre como usar o sistema. Se perguntarem algo fora desse escopo, diga educadamente que você só pode ajudar com dúvidas sobre o sistema.
- Use linguagem simples e direta, como se estivesse explicando para alguém não técnico.
- Quando possível, dê instruções em passos numerados (1, 2, 3...).
- Se não souber a resposta com certeza, diga que não sabe e sugira contatar o suporte pelo WhatsApp.
- Nunca invente funcionalidades que não existem no sistema.
- O usuário está atualmente na página: {{currentPage}}. Use essa informação para contextualizar suas respostas. Por exemplo, se o usuário está em "/cardapio" e pergunta "como adiciono um item", responda sobre produtos do cardápio.
- Seja breve e objetivo. Máximo 3-4 parágrafos por resposta.
- Sempre que mencionar um caminho de navegação, use o formato: Menu lateral → Seção → Página.
- Trate o usuário de forma amigável, usando "você".
```

**Step 2: Commit**

```bash
git add knowledge-base/_system-prompt.md
git commit -m "feat(lucca): add system prompt for Lucca assistant"
```

---

## Task 3: Criar a Knowledge Base — Artigos (Geral, Pedidos, Cardápio)

**Files:**
- Create: `delivery-saas-backend/knowledge-base/geral/visao-geral.md`
- Create: `delivery-saas-backend/knowledge-base/geral/primeiro-acesso.md`
- Create: `delivery-saas-backend/knowledge-base/geral/navegacao.md`
- Create: `delivery-saas-backend/knowledge-base/pedidos/painel-pedidos.md`
- Create: `delivery-saas-backend/knowledge-base/pedidos/status-pedidos.md`
- Create: `delivery-saas-backend/knowledge-base/pedidos/pedido-manual.md`
- Create: `delivery-saas-backend/knowledge-base/pedidos/historico.md`
- Create: `delivery-saas-backend/knowledge-base/cardapio/menus.md`
- Create: `delivery-saas-backend/knowledge-base/cardapio/categorias.md`
- Create: `delivery-saas-backend/knowledge-base/cardapio/produtos.md`
- Create: `delivery-saas-backend/knowledge-base/cardapio/opcoes-complementos.md`
- Create: `delivery-saas-backend/knowledge-base/cardapio/importacao.md`

**Instruções:** Gerar cada artigo analisando os componentes Vue e rotas do backend correspondentes. Seguir o formato padrão:

```markdown
# Título

## O que é
Explicação breve.

## Como acessar
Menu lateral → Seção → Página

## Como usar
1. Passo
2. Passo
3. Passo

## Dúvidas frequentes
**Pergunta?**
Resposta.
```

Para cada artigo, ler o código-fonte da view Vue correspondente e a rota backend para entender os campos, ações e fluxos disponíveis. O conteúdo deve refletir fielmente o que o sistema faz.

**Step final: Commit**

```bash
git add knowledge-base/geral/ knowledge-base/pedidos/ knowledge-base/cardapio/
git commit -m "feat(lucca): add knowledge base articles - geral, pedidos, cardapio"
```

---

## Task 4: Criar a Knowledge Base — Artigos (Clientes, Entregadores, Estoque)

**Files:**
- Create: `delivery-saas-backend/knowledge-base/clientes/cadastro.md`
- Create: `delivery-saas-backend/knowledge-base/clientes/grupos.md`
- Create: `delivery-saas-backend/knowledge-base/clientes/perfil.md`
- Create: `delivery-saas-backend/knowledge-base/entregadores/cadastro.md`
- Create: `delivery-saas-backend/knowledge-base/entregadores/conta-corrente.md`
- Create: `delivery-saas-backend/knowledge-base/entregadores/turnos.md`
- Create: `delivery-saas-backend/knowledge-base/entregadores/metas-bonus.md`
- Create: `delivery-saas-backend/knowledge-base/entregadores/rastreamento.md`
- Create: `delivery-saas-backend/knowledge-base/estoque/ingredientes.md`
- Create: `delivery-saas-backend/knowledge-base/estoque/fichas-tecnicas.md`
- Create: `delivery-saas-backend/knowledge-base/estoque/movimentacoes.md`
- Create: `delivery-saas-backend/knowledge-base/estoque/fornecedores.md`

**Instruções:** Mesmo processo da Task 3 — analisar views Vue e rotas para gerar conteúdo fiel.

**Step final: Commit**

```bash
git add knowledge-base/clientes/ knowledge-base/entregadores/ knowledge-base/estoque/
git commit -m "feat(lucca): add knowledge base articles - clientes, entregadores, estoque"
```

---

## Task 5: Criar a Knowledge Base — Artigos (Financeiro, Fiscal, Integrações)

**Files:**
- Create: `delivery-saas-backend/knowledge-base/financeiro/contas.md`
- Create: `delivery-saas-backend/knowledge-base/financeiro/lancamentos.md`
- Create: `delivery-saas-backend/knowledge-base/financeiro/fluxo-caixa.md`
- Create: `delivery-saas-backend/knowledge-base/financeiro/dre.md`
- Create: `delivery-saas-backend/knowledge-base/financeiro/gateways.md`
- Create: `delivery-saas-backend/knowledge-base/financeiro/ofx.md`
- Create: `delivery-saas-backend/knowledge-base/fiscal/dados-fiscais.md`
- Create: `delivery-saas-backend/knowledge-base/fiscal/nfce.md`
- Create: `delivery-saas-backend/knowledge-base/integracoes/ifood.md`
- Create: `delivery-saas-backend/knowledge-base/integracoes/whatsapp.md`
- Create: `delivery-saas-backend/knowledge-base/integracoes/aiqfome.md`

**Step final: Commit**

```bash
git add knowledge-base/financeiro/ knowledge-base/fiscal/ knowledge-base/integracoes/
git commit -m "feat(lucca): add knowledge base articles - financeiro, fiscal, integracoes"
```

---

## Task 6: Criar a Knowledge Base — Artigos (Cupons, Cashback, Afiliados, Impressão, Relatórios, Caixa, Configurações)

**Files:**
- Create: `delivery-saas-backend/knowledge-base/cupons/cupons.md`
- Create: `delivery-saas-backend/knowledge-base/cashback/cashback.md`
- Create: `delivery-saas-backend/knowledge-base/afiliados/afiliados.md`
- Create: `delivery-saas-backend/knowledge-base/impressao/configuracao.md`
- Create: `delivery-saas-backend/knowledge-base/impressao/agent.md`
- Create: `delivery-saas-backend/knowledge-base/relatorios/relatorios.md`
- Create: `delivery-saas-backend/knowledge-base/caixa/frentes-caixa.md`
- Create: `delivery-saas-backend/knowledge-base/configuracoes/empresa.md`
- Create: `delivery-saas-backend/knowledge-base/configuracoes/bairros.md`
- Create: `delivery-saas-backend/knowledge-base/configuracoes/lojas.md`
- Create: `delivery-saas-backend/knowledge-base/configuracoes/usuarios.md`
- Create: `delivery-saas-backend/knowledge-base/configuracoes/formas-pagamento.md`

**Step final: Commit**

```bash
git add knowledge-base/cupons/ knowledge-base/cashback/ knowledge-base/afiliados/ knowledge-base/impressao/ knowledge-base/relatorios/ knowledge-base/caixa/ knowledge-base/configuracoes/
git commit -m "feat(lucca): add knowledge base articles - remaining modules"
```

---

## Task 7: Criar a rota backend `POST /api/lucca/chat`

**Files:**
- Create: `delivery-saas-backend/src/routes/lucca.js`
- Modify: `delivery-saas-backend/src/index.js` (registrar rota)

**Step 1: Criar `src/routes/lucca.js`**

```javascript
import express from 'express'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { authMiddleware } from '../auth.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const luccaRouter = express.Router()

// ── Cache da knowledge base em memória ──
let cachedKB = null
let systemPromptTemplate = null

function loadKnowledgeBase() {
  if (cachedKB) return { kb: cachedKB, systemPrompt: systemPromptTemplate }

  const kbDir = path.resolve(__dirname, '../../knowledge-base')
  const articles = []

  function readDir(dir) {
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        readDir(full)
      } else if (entry.name.endsWith('.md') && entry.name !== '_system-prompt.md') {
        const relative = path.relative(kbDir, full).replace(/\\/g, '/')
        articles.push(`<!-- ${relative} -->\n${fs.readFileSync(full, 'utf-8')}`)
      }
    }
  }

  // Carregar system prompt
  const spPath = path.join(kbDir, '_system-prompt.md')
  systemPromptTemplate = fs.existsSync(spPath) ? fs.readFileSync(spPath, 'utf-8') : ''

  readDir(kbDir)
  cachedKB = articles.join('\n\n---\n\n')
  return { kb: cachedKB, systemPrompt: systemPromptTemplate }
}

// ── Gemini client ──
let genAI = null
function getModel() {
  if (!genAI) {
    genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  }
  return genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })
}

// ── Rota de chat ──
luccaRouter.use(authMiddleware)

luccaRouter.post('/chat', async (req, res) => {
  const { message, currentPage, history } = req.body

  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ message: 'message é obrigatório' })
  }

  if (!process.env.GEMINI_API_KEY) {
    return res.status(503).json({ message: 'Assistente indisponível no momento' })
  }

  try {
    const { kb, systemPrompt } = loadKnowledgeBase()
    const resolvedSystemPrompt = systemPrompt.replace('{{currentPage}}', currentPage || 'desconhecida')

    // Montar histórico no formato Gemini
    const contents = []

    // System instruction + KB como primeira mensagem do usuário (Gemini não tem system role separado no SDK básico)
    const systemContext = `${resolvedSystemPrompt}\n\n---\n\nBase de Conhecimento do Sistema:\n\n${kb}`

    // Histórico de conversa
    if (Array.isArray(history)) {
      for (const msg of history.slice(-10)) { // limitar a 10 últimas mensagens
        contents.push({
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: msg.content }]
        })
      }
    }

    // Mensagem atual
    contents.push({
      role: 'user',
      parts: [{ text: message }]
    })

    const model = getModel()
    const result = await model.generateContent({
      contents,
      systemInstruction: { parts: [{ text: systemContext }] }
    })

    const reply = result.response.text()
    res.json({ reply })
  } catch (e) {
    console.error('[Lucca] Error:', e.message || e)
    res.status(500).json({ message: 'Erro ao processar sua pergunta. Tente novamente.' })
  }
})

// ── Rota para invalidar cache (útil em dev) ──
luccaRouter.post('/reload-kb', authMiddleware, async (req, res) => {
  cachedKB = null
  systemPromptTemplate = null
  res.json({ ok: true, message: 'Knowledge base recarregada' })
})
```

**Step 2: Registrar a rota em `src/index.js`**

Adicionar import:
```javascript
import { luccaRouter } from './routes/lucca.js'
```

Adicionar mount (junto com as outras rotas, sem requireModule — disponível para todos):
```javascript
app.use('/lucca', luccaRouter)
```

**Step 3: Testar manualmente**

```bash
curl -X POST http://localhost:3000/lucca/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"message": "como cadastro um produto?", "currentPage": "/cardapio/produtos"}'
```

**Step 4: Commit**

```bash
git add src/routes/lucca.js src/index.js
git commit -m "feat(lucca): add /lucca/chat API route with Gemini Flash integration"
```

---

## Task 8: Criar o componente frontend `LuccaChat.vue`

**Files:**
- Create: `delivery-saas-frontend/src/components/LuccaChat.vue`

**Step 1: Criar o componente**

```vue
<template>
  <!-- Não renderizar na página de pedidos -->
  <div v-if="showWidget" class="lucca-widget">
    <!-- Botão flutuante -->
    <button
      v-if="!chatOpen"
      type="button"
      class="lucca-fab"
      title="Falar com o Lucca"
      @click="chatOpen = true"
    >
      <i class="bi bi-chat-dots-fill"></i>
    </button>

    <!-- Painel de chat -->
    <div v-if="chatOpen" class="lucca-panel">
      <div class="lucca-header">
        <div class="d-flex align-items-center gap-2">
          <div class="lucca-avatar">L</div>
          <div>
            <div class="fw-semibold text-white" style="font-size:0.95rem">Lucca</div>
            <div class="text-white-50" style="font-size:0.75rem">Assistente de suporte</div>
          </div>
        </div>
        <button type="button" class="btn btn-link text-white p-0" @click="chatOpen = false">
          <i class="bi bi-x-lg"></i>
        </button>
      </div>

      <div ref="messagesEl" class="lucca-messages">
        <div
          v-for="(msg, i) in messages"
          :key="i"
          class="lucca-msg"
          :class="msg.role === 'user' ? 'lucca-msg--user' : 'lucca-msg--bot'"
        >
          <div class="lucca-bubble" v-html="renderMarkdown(msg.content)"></div>
        </div>
        <div v-if="loading" class="lucca-msg lucca-msg--bot">
          <div class="lucca-bubble lucca-typing">
            <span></span><span></span><span></span>
          </div>
        </div>
      </div>

      <form class="lucca-input" @submit.prevent="send">
        <input
          v-model="input"
          type="text"
          placeholder="Pergunte algo sobre o sistema..."
          :disabled="loading"
          class="form-control form-control-sm"
        />
        <button type="submit" class="btn btn-sm btn-success" :disabled="loading || !input.trim()">
          <i class="bi bi-send-fill"></i>
        </button>
      </form>
    </div>
  </div>
</template>

<script>
import { ref, computed, watch, nextTick, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import api from '@/api.js'

export default {
  name: 'LuccaChat',
  setup() {
    const route = useRoute()
    const chatOpen = ref(false)
    const input = ref('')
    const loading = ref(false)
    const messages = ref([])
    const messagesEl = ref(null)

    // Não mostrar na página de pedidos, rotas públicas, login, rider
    const showWidget = computed(() => {
      const p = route?.path || ''
      if (p.startsWith('/pedidos') || p.startsWith('/orders')) return false
      if (p.startsWith('/public')) return false
      if (p.startsWith('/login') || p === '/register') return false
      if (p.startsWith('/rider')) return false
      if (p === '/' || p.startsWith('/trial')) return false
      return true
    })

    // Restaurar histórico do sessionStorage
    onMounted(() => {
      try {
        const saved = sessionStorage.getItem('lucca-history')
        if (saved) messages.value = JSON.parse(saved)
      } catch (e) { /* ignore */ }
    })

    // Salvar histórico no sessionStorage
    watch(messages, (val) => {
      try { sessionStorage.setItem('lucca-history', JSON.stringify(val)) } catch (e) { /* ignore */ }
    }, { deep: true })

    // Scroll automático
    watch(messages, () => {
      nextTick(() => {
        if (messagesEl.value) messagesEl.value.scrollTop = messagesEl.value.scrollHeight
      })
    }, { deep: true })

    // Quando abre o chat pela primeira vez, mostrar mensagem de boas-vindas
    watch(chatOpen, (open) => {
      if (open && messages.value.length === 0) {
        messages.value.push({
          role: 'assistant',
          content: 'Olá! Sou o **Lucca**, seu assistente de suporte. Como posso te ajudar?'
        })
      }
      if (open) {
        nextTick(() => {
          if (messagesEl.value) messagesEl.value.scrollTop = messagesEl.value.scrollHeight
        })
      }
    })

    async function send() {
      const text = input.value.trim()
      if (!text || loading.value) return

      messages.value.push({ role: 'user', content: text })
      input.value = ''
      loading.value = true

      try {
        const res = await api.post('/lucca/chat', {
          message: text,
          currentPage: route?.path || '',
          history: messages.value.slice(0, -1) // enviar histórico anterior
        })
        messages.value.push({ role: 'assistant', content: res.data.reply })
      } catch (e) {
        messages.value.push({
          role: 'assistant',
          content: 'Desculpe, não consegui processar sua pergunta. Tente novamente em alguns instantes.'
        })
      } finally {
        loading.value = false
      }
    }

    // Renderização simples de markdown (bold e listas)
    function renderMarkdown(text) {
      if (!text) return ''
      return text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\n(\d+)\.\s/g, '<br/>$1. ')
        .replace(/\n- /g, '<br/>• ')
        .replace(/\n/g, '<br/>')
    }

    return { showWidget, chatOpen, input, loading, messages, messagesEl, send, renderMarkdown }
  }
}
</script>

<style scoped>
.lucca-widget {
  position: fixed;
  bottom: 24px;
  right: 24px;
  z-index: 1050;
  font-family: inherit;
}

.lucca-fab {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: #89d136;
  color: #fff;
  border: none;
  box-shadow: 0 4px 16px rgba(0,0,0,0.2);
  font-size: 1.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: transform 0.15s, box-shadow 0.15s;
}
.lucca-fab:hover {
  transform: scale(1.08);
  box-shadow: 0 6px 24px rgba(0,0,0,0.3);
}

.lucca-panel {
  width: 360px;
  max-width: calc(100vw - 32px);
  height: 500px;
  max-height: calc(100vh - 100px);
  background: #fff;
  border-radius: 16px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.18);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.lucca-header {
  background: #89d136;
  padding: 14px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}

.lucca-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: rgba(255,255,255,0.25);
  color: #fff;
  font-weight: 700;
  font-size: 1.1rem;
  display: flex;
  align-items: center;
  justify-content: center;
}

.lucca-messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.lucca-msg { display: flex; }
.lucca-msg--user { justify-content: flex-end; }
.lucca-msg--bot { justify-content: flex-start; }

.lucca-bubble {
  max-width: 85%;
  padding: 10px 14px;
  border-radius: 14px;
  font-size: 0.875rem;
  line-height: 1.45;
  word-break: break-word;
}
.lucca-msg--user .lucca-bubble {
  background: #89d136;
  color: #fff;
  border-bottom-right-radius: 4px;
}
.lucca-msg--bot .lucca-bubble {
  background: #f1f3f5;
  color: #212529;
  border-bottom-left-radius: 4px;
}

/* Typing indicator */
.lucca-typing {
  display: flex;
  gap: 4px;
  padding: 12px 18px;
}
.lucca-typing span {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #adb5bd;
  animation: lucca-bounce 1.2s infinite;
}
.lucca-typing span:nth-child(2) { animation-delay: 0.2s; }
.lucca-typing span:nth-child(3) { animation-delay: 0.4s; }

@keyframes lucca-bounce {
  0%, 60%, 100% { transform: translateY(0); }
  30% { transform: translateY(-6px); }
}

.lucca-input {
  padding: 12px;
  border-top: 1px solid #e9ecef;
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}
.lucca-input .form-control {
  border-radius: 20px;
  font-size: 0.875rem;
}
.lucca-input .btn {
  border-radius: 50%;
  width: 34px;
  height: 34px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

@media (max-width: 575.98px) {
  .lucca-widget { bottom: 76px; right: 12px; }
  .lucca-panel {
    width: calc(100vw - 24px);
    height: calc(100vh - 140px);
    border-radius: 12px;
  }
}
</style>
```

**Step 2: Commit**

```bash
git add src/components/LuccaChat.vue
git commit -m "feat(lucca): add LuccaChat.vue floating widget component"
```

---

## Task 9: Montar o LuccaChat no App.vue

**Files:**
- Modify: `delivery-saas-frontend/src/App.vue`

**Step 1: Adicionar import**

Após os outros imports (linha ~20 em App.vue), adicionar:
```javascript
import LuccaChat from './components/LuccaChat.vue';
```

**Step 2: Adicionar componente no template**

Após o botão `rider-qr-fab` (linha ~359 em App.vue), antes do `</div>` final do template, adicionar:
```html
<LuccaChat />
```

**Step 3: Verificar no browser**

- Acessar `http://localhost:5173/cardapio/menus`
- Verificar que o botão verde aparece no canto inferior direito
- Clicar e verificar que o painel de chat abre
- Navegar para `/pedidos` e verificar que o botão NÃO aparece
- Testar enviar uma mensagem e verificar a resposta

**Step 4: Commit**

```bash
git add src/App.vue
git commit -m "feat(lucca): mount LuccaChat widget in App.vue"
```

---

## Task 10: Teste end-to-end e ajustes finais

**Step 1: Verificar backend funcionando**

```bash
docker compose up -d
```

Verificar logs: `docker compose logs -f backend`

**Step 2: Testar fluxo completo**

1. Login no painel
2. Navegar para `/cardapio/produtos`
3. Clicar no botão do Lucca
4. Perguntar "como cadastro um produto?"
5. Verificar que a resposta é contextualizada (sabe que estamos no cardápio)
6. Perguntar "como configuro uma impressora?"
7. Verificar que responde corretamente sobre impressão

**Step 3: Verificar exclusões**

1. Navegar para `/pedidos` → widget NÃO deve aparecer
2. Navegar para `/public/...` → widget NÃO deve aparecer
3. Navegar para `/rider/...` → widget NÃO deve aparecer

**Step 4: Commit final**

```bash
git add -A
git commit -m "feat(lucca): complete Lucca AI support assistant integration"
```
