# Landing Page — Chefiz — Refresh Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Atualizar a landing page existente (`/`) para a marca **Chefiz** (leia-se "Chef Easy") e para o novo modelo comercial: **3 planos mensais** (Básico, Pro, Premium) começando em **R$ 110/mês**, com captura de lead vinculada ao plano escolhido antes do redirect ao checkout.

**Architecture:** A landing já existe (`LandingPage.vue`, ~1120 linhas) e o backend já suporta lead-por-plano (`Lead.planId/period/paymentStatus/gatewayRef`). O foco aqui é **refresh de copy, marca e UI de pricing**, não criação. Sem novas dependências.

**Tech Stack:** Vue 3, Express.js, Prisma (PostgreSQL), Kiwify (ou gateway interno via billing-revamp).

**Design doc:** `docs/plans/2026-03-12-landing-page-design.md`

**O que JÁ está pronto (não tocar):**

- Schema: `model Lead` com `planId`, `period`, `paymentStatus`, `gatewayRef`, `gatewayProvider`, `preferenceId`, `amount`, `paidAt`.
- Backend `POST /public/leads` aceita `{ name, phone, planKey?, period? }` e resolve `planId` a partir do `SaasPlan` no banco.
- Backend `GET /public/leads/:id/status` faz polling de status de pagamento.
- Rota `/` aponta para `LandingPage.vue` e o sidebar já está escondido nessa rota.
- Logo `chefiz.png` / `chefiz-neg.png` e favicon `favicon-512x512.png` já em `public/`.

---

### Task 1: Seed dos 3 planos no `SaasPlan` (se ainda não houver)

**Files:**
- Inspect: `delivery-saas-backend/prisma/schema.prisma` (model `SaasPlan` + `SaasPlanPrice`)
- Modify ou Create: `delivery-saas-backend/src/seeds/seedPlans.js`

**Step 1: Verificar estado atual**

```bash
docker compose exec backend npx prisma studio
# Abrir tabela SaasPlan, conferir se BÁSICO/PRO/PREMIUM já existem.
```

Se já existirem com preços diferentes, **atualizar** em vez de criar. Se não existirem, prosseguir.

**Step 2: Garantir os 3 planos no seed**

Em `seedPlans.js` (criar se não existir) ou no painel admin SaaS:

```javascript
const PLANS = [
  {
    key: 'BASICO',
    name: 'Básico',
    description: 'Cardápio digital + atendimento automatizado no WhatsApp',
    modules: ['CARDAPIO_SIMPLES', 'CARDAPIO_COMPLETO', 'WHATSAPP', 'COUPONS', 'CUSTOM_DOMAIN'],
    prices: { MONTHLY: 110.00 },
  },
  {
    key: 'PRO',
    name: 'Pro',
    description: 'Tudo do Básico + entregadores, cashback e afiliados',
    modules: ['CARDAPIO_SIMPLES', 'CARDAPIO_COMPLETO', 'WHATSAPP', 'COUPONS', 'CUSTOM_DOMAIN', 'RIDERS', 'CASHBACK', 'AFFILIATES'],
    prices: { MONTHLY: 200.00 }, // CONFIRMAR
  },
  {
    key: 'PREMIUM',
    name: 'Premium',
    description: 'Tudo do Pro + NFC-e e controle de estoque',
    modules: ['CARDAPIO_SIMPLES', 'CARDAPIO_COMPLETO', 'WHATSAPP', 'COUPONS', 'CUSTOM_DOMAIN', 'RIDERS', 'CASHBACK', 'AFFILIATES', 'FISCAL', 'STOCK'],
    prices: { MONTHLY: 350.00 }, // CONFIRMAR
  },
]
```

> **A confirmar antes:** preços de Pro e Premium. Os R$ 200/R$ 350 são propostas, não definitivos.

**Step 3: Rodar o seed e validar**

```bash
docker compose exec backend node src/seeds/seedPlans.js
```

Conferir via `GET /saas/plans` (rota admin) que retorna os 3 planos com `key`, `prices.MONTHLY` e `modules`.

**Step 4: Commit**

```bash
git add delivery-saas-backend/src/seeds/seedPlans.js
git commit -m "feat(plans): seed BASICO/PRO/PREMIUM with monthly pricing"
```

---

### Task 2: Expor planos publicamente para a landing

**Files:**
- Create: `delivery-saas-backend/src/routes/publicPlans.js` (se não existir já dentro de outro arquivo)
- Modify: `delivery-saas-backend/src/index.js` (mount da rota)

**Step 1: Conferir se a rota já existe**

```bash
grep -rn "GET.*plans\|/plans" delivery-saas-backend/src/routes/ | grep -i public
```

Se existir um endpoint público de planos, pular para Task 3.

**Step 2: Criar `GET /public/plans`**

Endpoint sem auth que retorna só o necessário pra landing montar a tabela:

```javascript
// delivery-saas-backend/src/routes/publicPlans.js
import { Router } from 'express'
import { prisma } from '../prisma.js'

const router = Router()

// GET /public/plans — list active plans with monthly price + modules
router.get('/plans', async (_req, res) => {
  try {
    const plans = await prisma.saasPlan.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      include: {
        prices: { where: { period: 'MONTHLY' }, select: { amount: true, period: true } },
        modules: { include: { module: { select: { key: true, name: true } } } },
      },
    })
    const out = plans.map(p => ({
      key: p.key,
      name: p.name,
      description: p.description,
      monthlyPrice: p.prices?.[0]?.amount ?? null,
      modules: p.modules.map(m => m.module.key),
    }))
    res.json(out)
  } catch (err) {
    console.error('GET /public/plans error:', err)
    res.status(500).json({ error: 'Failed to load plans' })
  }
})

export default router
```

Mount em `index.js` ao lado do `/public/leads`:

```javascript
import publicPlansRouter from './routes/publicPlans.js'
app.use('/public', publicPlansRouter)
```

**Step 3: Testar**

```bash
curl http://localhost:3000/public/plans
# Expected: array com 3 planos (BASICO/PRO/PREMIUM), cada um com monthlyPrice e modules
```

**Step 4: Commit**

```bash
git add delivery-saas-backend/src/routes/publicPlans.js delivery-saas-backend/src/index.js
git commit -m "feat(api): add GET /public/plans for landing pricing table"
```

---

### Task 3: Mapa de URLs de checkout Kiwify por plano

**Files:**
- Decide: Kiwify (3 URLs) vs gateway interno (`/checkout`/Mercado Pago)?

**Step 1: Decidir o gateway**

Duas opções:

- **A — Kiwify (mais rápido)**: criar 3 produtos no Kiwify, cada um com sua URL pública. Mapear no front:
  ```javascript
  const KIWIFY_URLS = {
    BASICO:  'https://pay.kiwify.com.br/AAA',
    PRO:     'https://pay.kiwify.com.br/BBB',
    PREMIUM: 'https://pay.kiwify.com.br/CCC',
  }
  ```
- **B — Gateway interno (alinhado ao billing-revamp)**: enviar lead pra `POST /public/leads/{id}/checkout` que cria preference no Mercado Pago e retorna `init_point` pra redirecionar. Usa `SaasGatewayConfig` (já no schema).

Recomendação: **A** para validar o funil agora, migrar pra **B** depois (sem mexer na UX do usuário — só troca o destino do redirect).

**Step 2 (se A): Configurar URLs**

Criar `delivery-saas-frontend/src/config/kiwifyPlans.js`:

```javascript
export const KIWIFY_URLS = {
  BASICO:  import.meta.env.VITE_KIWIFY_BASICO  || '',
  PRO:     import.meta.env.VITE_KIWIFY_PRO     || '',
  PREMIUM: import.meta.env.VITE_KIWIFY_PREMIUM || '',
}
```

Adicionar no `.env` do frontend:

```
VITE_KIWIFY_BASICO=https://pay.kiwify.com.br/...
VITE_KIWIFY_PRO=https://pay.kiwify.com.br/...
VITE_KIWIFY_PREMIUM=https://pay.kiwify.com.br/...
```

**Step 3 (se B): Implementar checkout interno**

Fora do escopo deste plan — abrir um plan separado referenciando o `billing-revamp-plan.md` e o `multi-gateway-billing-plan.md`.

**Step 4: Commit (caso A)**

```bash
git add delivery-saas-frontend/src/config/kiwifyPlans.js
git commit -m "feat(landing): map plan keys to Kiwify checkout URLs"
```

---

### Task 4: Reescrita do `LandingPage.vue` — copy + UI de 3 planos

**Files:**
- Modify: `delivery-saas-frontend/src/views/LandingPage.vue` (~1120 linhas)

A landing existe e funciona, mas está com a copy do plano antigo (Core Delivery, R$ 47/ano). Refresh em 4 frentes:

**Step 1: Hero**

Trocar:
- Badge `"R$ 47/ano — menos de R$ 4 por mês"` → `"+1.000 restaurantes vendendo no WhatsApp"` (ou outra social-proof real).
- Headline antiga → `"O jeito Chef Easy de vender pelo WhatsApp"`.
- Subtítulo → `"Cardápio digital + atendimento automatizado no WhatsApp. A partir de R$ 110/mês."`
- CTA `"Garantir meu cardápio"` → `"Ver planos"` (ancora em `#pricing`).
- Esconder qualquer ref a `Core Delivery` no JSX/CSS.

**Step 2: Seção "Problema/Dor"**

Reescrever os 3 cards com foco em WhatsApp, não em fotos:

```text
"Cliente pede cardápio e demora pra receber"
"Pedido vem confuso e você anota errado"
"Difícil saber quem é cliente recorrente"
```

(O texto antigo "Fotos ruins afastam clientes" pode ir pra um upsell de AI Studio.)

**Step 3: Seção `#pricing` — substituir card único por grid de 3**

Estrutura HTML (esqueleto):

```vue
<section id="pricing" class="pricing">
  <h2>Planos para todo restaurante</h2>
  <div class="pricing-grid">
    <article
      v-for="plan in plans"
      :key="plan.key"
      class="pricing-card"
      :class="{ recommended: plan.key === 'PRO' }"
    >
      <span v-if="plan.key === 'PRO'" class="recommended-badge">⭐ Recomendado</span>
      <h3>{{ plan.name }}</h3>
      <div class="pricing-price">
        <span class="currency">R$</span>
        <span class="amount">{{ formatPrice(plan.monthlyPrice) }}</span>
        <span class="pricing-period">/mês</span>
      </div>
      <p class="pricing-description">{{ plan.description }}</p>
      <ul class="pricing-features">
        <li v-for="m in plan.modules" :key="m">
          <i class="bi bi-check2"></i> {{ moduleLabel(m) }}
        </li>
      </ul>
      <button class="btn-cta" @click="selectPlan(plan)">
        Quero o {{ plan.name }}
      </button>
    </article>
  </div>
</section>
```

Lista de planos vinda do `GET /public/plans` (Task 2), com fallback hardcoded pro caso da API falhar:

```javascript
import { ref, onMounted } from 'vue'
import api from '../api'
import { KIWIFY_URLS } from '../config/kiwifyPlans'

const plans = ref([])
const FALLBACK_PLANS = [
  { key: 'BASICO',  name: 'Básico',  monthlyPrice: 110, description: '...', modules: ['CARDAPIO_COMPLETO','WHATSAPP','COUPONS','CUSTOM_DOMAIN'] },
  { key: 'PRO',     name: 'Pro',     monthlyPrice: 200, description: '...', modules: [...] },
  { key: 'PREMIUM', name: 'Premium', monthlyPrice: 350, description: '...', modules: [...] },
]

onMounted(async () => {
  try {
    const { data } = await api.get('/public/plans')
    plans.value = Array.isArray(data) && data.length ? data : FALLBACK_PLANS
  } catch {
    plans.value = FALLBACK_PLANS
  }
})

const MODULE_LABELS = {
  CARDAPIO_SIMPLES:  'Cardápio digital',
  CARDAPIO_COMPLETO: 'Gestor de pedidos',
  WHATSAPP:          'WhatsApp API',
  COUPONS:           'Cupons',
  CUSTOM_DOMAIN:     'Domínio próprio',
  RIDERS:            'App do motoboy',
  CASHBACK:          'Cashback',
  AFFILIATES:        'Afiliados',
  FISCAL:            'NFC-e / NF-e',
  STOCK:             'Controle de estoque',
}
function moduleLabel(key) { return MODULE_LABELS[key] || key }
function formatPrice(v) { return Number(v).toFixed(0).replace('.', ',') }
```

**Step 4: Formulário + redirect plan-aware**

```javascript
const selectedPlan = ref(null)

function selectPlan(plan) {
  selectedPlan.value = plan
  document.getElementById('lead-form')?.scrollIntoView({ behavior: 'smooth' })
}

async function submitLead() {
  if (!selectedPlan.value) { error.value = 'Escolha um plano'; return }
  // validação de name/phone (mantém o que já existe)
  loading.value = true
  try {
    const { data } = await api.post('/public/leads', {
      name: name.value.trim(),
      phone: digits,
      planKey: selectedPlan.value.key,
      period: 'MONTHLY',
    })
    const url = KIWIFY_URLS[selectedPlan.value.key]
    if (!url) throw new Error('Plan checkout URL not configured')
    window.location.href = url
  } catch (e) {
    error.value = e?.message || 'Erro ao enviar. Tente novamente.'
    loading.value = false
  }
}
```

O backend já aceita `planKey` (Task 2 do plano antigo era `name/phone` só; o `leads.js` atual resolve o plano por chave). Confirmar com `git log src/routes/leads.js` que essa assinatura está mesmo lá; se não, atualizar o endpoint (rotina trivial).

**Step 5: Footer + brand global**

- Logo: trocar para `/chefiz.png` no header e `/chefiz-neg.png` no footer (se o footer for escuro).
- "© 2026 Core Delivery" → "© 2026 Chefiz".
- Page title (`document.title`) → "Chefiz — Vender pelo WhatsApp ficou fácil".

**Step 6: Buscar "Core Delivery"/"R$ 47" no arquivo todo e eliminar**

```bash
grep -nE "Core Delivery|R\\\$ ?47|/ano|cardápio digital ilimitado" \
  delivery-saas-frontend/src/views/LandingPage.vue
```

Deve retornar zero matches no fim.

**Step 7: Commit**

```bash
git add delivery-saas-frontend/src/views/LandingPage.vue \
        delivery-saas-frontend/src/config/kiwifyPlans.js
git commit -m "feat(landing): rebrand to Chefiz with 3-tier pricing (BASICO/PRO/PREMIUM)"
```

---

### Task 5: Estilos — verde Chefiz como cor de marca

**Files:**
- Modify: `delivery-saas-frontend/src/views/LandingPage.vue` (CSS scoped)

**Step 1: Inverter hierarquia azul/verde**

Hoje a landing usa azul (#105784) como cor principal. Trocar para verde Chefiz (#89D136) nas seguintes classes:

- `.hero` — gradiente `#8cbe1f → #89D136` (igual ao das login pages).
- `.btn-cta` — fundo `#89D136`, hover `#6DAE1E` (já está, conferir).
- `.btn-hero` — texto `#3F3F3F` (cinza do logo), fundo branco.
- `.badge-pill` — fundo branco semi-transparente, texto cinza do logo.

**Step 2: Card "Pro" destacado**

```css
.pricing-card.recommended {
  border: 2px solid var(--chefiz-green, #89D136);
  transform: scale(1.05);
  box-shadow: 0 1rem 2rem rgba(137, 209, 54, 0.15);
}
.recommended-badge {
  position: absolute;
  top: -0.75rem;
  left: 50%;
  transform: translateX(-50%);
  background: #89D136;
  color: #fff;
  font-weight: 600;
  padding: 0.25rem 0.75rem;
  border-radius: 2rem;
  font-size: 0.78rem;
}
```

**Step 3: Responsivo**

Grid de 3 colunas vira coluna única abaixo de 768px:

```css
.pricing-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1.5rem; }
@media (max-width: 768px) {
  .pricing-grid { grid-template-columns: 1fr; }
  .pricing-card.recommended { transform: none; }
}
```

**Step 4: Commit**

```bash
git add delivery-saas-frontend/src/views/LandingPage.vue
git commit -m "style(landing): switch primary accent to Chefiz green + Pro card emphasis"
```

---

### Task 6: FAQ atualizado

**Files:**
- Modify: `delivery-saas-frontend/src/views/LandingPage.vue` (seção `.faq`)

Substituir as 4-5 perguntas antigas por 5-6 alinhadas ao novo posicionamento (ver `2026-03-12-landing-page-design.md` seção 7):

1. "Preciso ter um número novo do WhatsApp ou uso o meu?"
2. "O que acontece se eu cancelar?"
3. "A IA das fotos custa à parte?"
4. "Funciona com iFood?"
5. "Posso emitir NFC-e?"
6. "Já tenho cardápio em outro lugar — dá pra importar?"

Cada resposta em 1-3 linhas, sem jargão técnico.

**Commit:**

```bash
git add delivery-saas-frontend/src/views/LandingPage.vue
git commit -m "docs(landing): refresh FAQ for WhatsApp-first positioning"
```

---

### Task 7: Polish + teste manual

**Step 1: Teste cross-device**

DevTools → testar em 375px, 414px, 768px, 1440px:

- Hero legível, CTAs visíveis, gradiente sem corte estranho.
- Grid de planos: 3 colunas no desktop, 1 coluna no mobile, card Pro continua destacado mas sem `scale(1.05)` no mobile.
- Formulário utilizável, máscara de telefone funcional.

**Step 2: Teste do funil completo**

1. Visitar `/` deslogado → landing renderiza.
2. Clicar "Quero o Básico" → form scrolla, plano marcado.
3. Preencher nome + WhatsApp → submit.
4. Logs do backend mostram lead criado com `planId` correto.
5. Browser redireciona pro Kiwify URL específica do Básico.
6. (Manual) finalizar pagamento → Kiwify redireciona pra `/setup`.

Repetir o ciclo para Pro e Premium.

**Step 3: Smoke test "Core Delivery" zerado**

```bash
grep -rni "core delivery" delivery-saas-frontend/src/views/LandingPage.vue
# Esperado: zero linhas
```

**Step 4: Commit final**

```bash
git add -A
git commit -m "feat(landing): final polish for Chefiz multi-tier launch"
```

---

## Checklist de aceite

- [ ] `GET /public/plans` retorna 3 planos com preço mensal e módulos.
- [ ] `POST /public/leads` aceita `{ planKey, period }` e persiste `planId`/`period`.
- [ ] Landing exibe 3 cards (Básico/Pro/Premium) com Pro destacado.
- [ ] Clicar em cada CTA pré-seleciona o plano no form, e o redirect leva à URL Kiwify correta daquele plano.
- [ ] Nenhuma menção a "Core Delivery" ou "R$ 47/ano" sobrou.
- [ ] Logo Chefiz aparece no topo e no footer.
- [ ] Mobile (375px) tem 1 coluna, CTAs visíveis sem scroll horizontal.
- [ ] FAQ atualizada com perguntas WhatsApp-first.

## Pendências antes de publicar

1. Preços definitivos de **Pro** e **Premium** (atualizar Task 1 e fallback do front).
2. URLs Kiwify dos 3 planos (ou decisão de migrar pro gateway interno via billing-revamp).
3. Decidir se Pro tem direito a Custom Domain (hoje no Básico) ou se isso vai pro Premium.
4. Confirmar que `CARDAPIO_COMPLETO` (gestor de pedidos) faz parte do Básico — caso contrário, o WhatsApp não fecha pedido e o pacote perde sentido.
