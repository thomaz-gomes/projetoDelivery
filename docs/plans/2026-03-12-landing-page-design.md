# Landing Page — Core Delivery

**Data:** 2026-03-12
**Status:** Aprovado

## Objetivo

Convencer visitantes a comprar o plano catálogo digital por R$ 47/ano. Foco em copywriting de conversão com captura de lead antes do pagamento via Kiwify.

## Fluxo do Usuário

```
Landing Page → Formulário (nome + WhatsApp) → Salva lead no backend → Redirect Kiwify checkout
                                                                        ↓
                                              Wizard (OnboardingWizard) ← Kiwify redirect pós-pagamento
```

## Abordagem Técnica

- **Vue SPA** — componente `LandingPage.vue` como rota `/`, lazy loaded, sem sidebar
- **Backend** — `POST /api/public/leads` salva nome + WhatsApp + timestamp
- **Prisma** — Model `Lead` (name, phone, source, createdAt)
- **Redirect** — Após salvar lead → `window.location.href = 'https://pay.kiwify.com.br/YmuEZ57'`
- **Kiwify retorno** — URL de redirecionamento pós-pagamento para `/setup` (wizard existente)
- **Responsivo** — Mobile-first
- **CSS** — Scoped, sem dependências extras (CSS puro com variáveis do admin)

## Estrutura das Seções

### 1. Hero Section
- **Headline:** "Seu cardápio digital profissional em minutos"
- **Sub:** "Transforme fotos amadoras em imagens profissionais com um clique. Por apenas R$ 3,92/mês."
- **CTA:** Botão "Quero meu cardápio digital" (ancora no formulário)
- **Visual:** Mockup de celular com cardápio digital (placeholder)
- **Badge:** "R$ 47/ano — menos de R$ 4 por mês"
- **Fundo:** Gradiente azul (#105784 → #1A6FA8)

### 2. Problema / Dor
- "Você ainda usa cardápio de papel ou PDF no WhatsApp?"
- 3 cards com dores:
  - Fotos ruins afastam clientes
  - Atualizar preços é um pesadelo
  - Clientes pedem cardápio e você manda PDF

### 3. Como Funciona (3 passos)
1. "Tire uma foto do seu cardápio físico" → IA cria o cardápio digital
2. "Otimize suas fotos com um clique" → IA transforma fotos amadoras em profissionais
3. "Compartilhe o link" → Catálogo digital pronto para WhatsApp e redes sociais

### 4. Showcase / Antes & Depois
- Comparativo visual: foto amadora → foto otimizada pela IA
- Print do cardápio digital no celular

### 5. Preço + Formulário de Captura
- Card de preço destacado: **R$ 47/ano**
  - Catálogo digital ilimitado
  - Otimizador de fotos com IA
  - Link personalizado para compartilhar
  - Suporte via WhatsApp
- **Formulário inline:** Nome + WhatsApp + Botão "Garantir meu cardápio — R$ 47/ano"
- Micro-copy: "Pagamento seguro via Kiwify. Acesso imediato."

### 6. Upsell (seção leve)
- "Quer ir além? Conheça o plano Completo"
- Cards: Gestor de pedidos online / Integração com iFood / Painel completo
- CTA secundário: "Saiba mais"

### 7. FAQ
- 4-5 perguntas comuns (preciso de computador? como funciona a IA? posso cancelar?)

### 8. Footer
- Logo Core, links, © 2026 Core Delivery

## Paleta de Cores (Admin do Sistema)

| Uso | Cor | Hex |
|-----|-----|-----|
| Primária | Azul profundo | #105784 |
| Primária hover | Azul escuro | #0B3D5E |
| Primária light | Azul claro | #1A6FA8 |
| CTA / Acento | Verde lima | #89D136 |
| CTA hover | Verde escuro | #6DAE1E |
| Fundo app | Verde bem claro | #EEFFED |
| Fundo seções | Branco / cinza | #FFFFFF / #F8F9FA |
| Texto principal | Quase preto | #212529 |
| Texto secundário | Cinza médio | #6C757D |
| Bordas | Cinza suave | #E6E6E6 |
| Destaque IA | Roxo | #7C3AED |

## Arquivos a Criar/Modificar

- **Criar:** `delivery-saas-frontend/src/views/LandingPage.vue`
- **Modificar:** `delivery-saas-frontend/src/router.js` — rota `/` aponta para LandingPage
- **Modificar:** `delivery-saas-frontend/src/App.vue` — esconder sidebar na rota `/`
- **Criar:** `delivery-saas-backend/src/routes/leads.js` — endpoint POST /api/public/leads
- **Modificar:** `delivery-saas-backend/prisma/schema.prisma` — model Lead
- **Modificar:** `delivery-saas-backend/src/app.js` — registrar rota de leads