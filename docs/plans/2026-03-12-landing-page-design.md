# Landing Page — Chefiz

**Data:** 2026-03-12 (atualizado 2026-05-22)
**Status:** Aprovado

> **Marca:** Chefiz — leia-se "Chef Easy". O nome carrega a promessa central: levar o
> restaurante para o digital de forma fácil. Antes "Core Delivery"; rebrand
> consolidado em 2026-05.

## Objetivo

Vender o **plano Básico (R$ 110/mês)** como porta de entrada e abrir a porta
para upsell de Pro e Premium. Foco em copywriting de conversão com captura de
lead antes do checkout via Kiwify (ou gateway interno multi-gateway, conforme
o billing-revamp de 2026-03-13).

O ticket subiu do antigo R$ 47/ano (cardápio puro) para R$ 110/mês porque o
Básico agora já inclui a **API de WhatsApp** — o canal que efetivamente fecha
pedido. Sem WhatsApp o cardápio é catálogo passivo; com WhatsApp, é loja
operando.

## Fluxo do Usuário

```
Landing Page → Comparar planos → Formulário (nome + WhatsApp + plano)
                                          ↓
                              Salva lead no backend (POST /public/leads)
                                          ↓
                              Redirect Kiwify checkout do plano escolhido
                                          ↓
                  OnboardingWizard (/setup) ← Kiwify redirect pós-pagamento
```

Cada plano tem um link Kiwify próprio (3 produtos no Kiwify hoje, ou
sub-planos do mesmo produto). O lead carrega `plan` (BASIC/PRO/PREMIUM) para
o backend identificar a intenção antes do checkout.

## Abordagem Técnica

- **Vue SPA** — componente `LandingPage.vue` como rota `/`, lazy loaded, sem sidebar.
- **Backend** — `POST /api/public/leads` salva `{ name, phone, plan, source, createdAt }`.
- **Prisma** — Model `Lead` (campo `plan` adicional comparado ao design original).
- **Redirect** — Após salvar lead → `window.location.href = KIWIFY_URLS[plan]`.
- **Kiwify retorno** — URL pós-pagamento para `/setup` (OnboardingWizard existente).
- **Responsivo** — Mobile-first.
- **CSS** — Scoped, sem dependências extras (variáveis do admin).

## Planos & Preços

| Plano | Preço | Módulos incluídos | Para quem |
|-------|-------|-------------------|-----------|
| **Básico** | R$ 110/mês | Cardápio (simples + completo), WhatsApp API, Cupons, Custom Domain | Quem está digitalizando o atendimento e quer receber pedido pelo WhatsApp |
| **Pro** | R$ ? /mês | _Básico_ + Riders, Cashback, Afiliados | Quem já entrega e quer crescer com fidelização e indicação |
| **Premium** | R$ ? /mês | _Pro_ + Fiscal (NFC-e), Estoque | Quem opera no fiscal e precisa controlar custo de prato |

> **A preencher:** valores de Pro e Premium. Recomendação inicial — Pro R$ 200/mês,
> Premium R$ 350/mês — mas confirmar antes de publicar.

### Módulos chave (do sistema, todos disponíveis hoje)

`CARDAPIO_SIMPLES`, `CARDAPIO_COMPLETO`, `RIDERS`, `AFFILIATES`, `STOCK`,
`CASHBACK`, `COUPONS`, `WHATSAPP`, `FINANCIAL`, `FISCAL`, `CUSTOM_DOMAIN`.

### Recursos cross-tier (em todos os planos)

- **Inbox** unificada (WhatsApp via Evolution e via Meta Cloud, Messenger, Instagram).
- **Saudações automáticas** por menu, including out-of-hours e saudação de cliente recorrente.
- **Botão "Repetir pedido"** via link mágico no WhatsApp.
- **AI Studio** com geração/otimização de imagens (créditos consumidos à parte).
- **Importação de cardápio por IA** (foto física → cardápio digital).
- **Integração iFood** (recebimento de pedido, manifestação NF-e, chat).
- **Integração aiqfome**.
- **Print Agent** (Electron) — impressão térmica em servidor local da loja.
- **App do motoboy** (PWA mobile com tracking GPS e checkin/ranking).

## Estrutura das Seções

### 1. Hero

- **Headline:** "O jeito Chef Easy de vender pelo WhatsApp"
- **Sub:** "Cardápio digital + atendimento automatizado no WhatsApp. A partir de R$ 110/mês."
- **CTA:** Botão "Quero meu Chefiz" (ancora no formulário) + "Ver planos" (ancora na tabela)
- **Visual:** Mockup de celular com cardápio + balão de mensagem do WhatsApp.
- **Badge:** "+1.000 restaurantes vendendo no WhatsApp"
- **Fundo:** Gradiente verde Chefiz (#8cbe1f → #89D136), CTA em cinza-escuro da marca.

### 2. Problema / Dor

"Você ainda manda PDF no WhatsApp e perde pedido?"
3 cards:
- "Cliente pede cardápio e demora pra receber" → WhatsApp automatizado responde na hora.
- "Pedido vem confuso e você anota errado" → Pedido entra estruturado direto no painel.
- "Difícil saber quem é cliente recorrente" → Saudação automática reconhece quem já comprou.

### 3. Como Funciona (3 passos)

1. **Cadastra o cardápio** (em minutos, com IA a partir de foto do físico).
2. **Conecta o WhatsApp** (1 número da loja, sem complicação técnica).
3. **Recebe pedido** (cliente abre o link, monta o pedido, paga, chega tudo no painel).

### 4. Showcase / Recursos

Carrossel ou grid de 4-6 features visuais:
- Cardápio responsivo (mockup mobile).
- Inbox unificada (foto da tela do painel).
- Pedido entrando no Kanban em tempo real.
- Botão "Repetir pedido" no WhatsApp do cliente.
- App do motoboy com mapa (para o tier Pro).
- NFC-e sendo emitida (para o tier Premium).

### 5. Tabela de Planos + Formulário de Captura

Card grid com 3 planos lado a lado:

```
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│ BÁSICO           │  │ PRO ⭐ Recomendado │  │ PREMIUM           │
│ R$ 110/mês       │  │ R$ ?/mês          │  │ R$ ?/mês          │
│                  │  │                   │  │                   │
│ ✓ Cardápio       │  │ Tudo do Básico   │  │ Tudo do Pro       │
│ ✓ WhatsApp API   │  │ + Motoboys       │  │ + NFC-e/NF-e      │
│ ✓ Cupons         │  │ + Cashback       │  │ + Estoque         │
│ ✓ Domínio próprio │  │ + Afiliados      │  │                   │
│                  │  │                   │  │                   │
│ [Quero o Básico] │  │ [Quero o Pro]    │  │ [Quero o Premium] │
└──────────────────┘  └──────────────────┘  └──────────────────┘
```

- **Pro destacado** com selo "Recomendado" — é o tier-âncora que justifica
  o ticket dos outros dois (regra clássica de pricing: 3 opções, meio
  destacado).
- Cada CTA abre o **mesmo formulário** (Nome + WhatsApp), com o plano
  pré-selecionado por hidden field — chega ao backend já com o `plan`
  certo e o redirect Kiwify usa o link específico.
- Micro-copy: "Pagamento seguro via Kiwify. Acesso imediato pós-pagamento."

### 6. Diferenciais (seção de prova)

3 blocos curtos com social proof / benefício:
- "Sua marca, seu domínio" (foto do `seunome.com.br` carregando o cardápio).
- "Conversa que vende sozinha" (capture da saudação + repetir pedido).
- "Painel no mesmo lugar do iFood" (integração nativa).

### 7. FAQ

5-6 perguntas, focadas no novo posicionamento:
- "Preciso ter um número novo do WhatsApp ou uso o meu?" (uso o seu, conectado via QR).
- "O que acontece se eu cancelar?" (mantém acesso até o fim do mês pago).
- "A IA das fotos custa à parte?" (sim, créditos avulsos no AI Studio — explicar com preço de pacote).
- "Funciona com iFood?" (sim, recebe pedido do iFood no mesmo painel).
- "Posso emitir NFC-e?" (sim, no Premium — com seu certificado A1).
- "E se eu já tenho cardápio em outro lugar?" (importamos via IA a partir de foto/PDF).

### 8. Footer

- Logo Chefiz (`/chefiz.png`).
- Links: Termos de Serviço, Política de Privacidade, Contato.
- "© 2026 Chefiz. Todos os direitos reservados."

## Paleta de Cores

Mantemos a paleta do admin (consistência visual com o painel pós-login), com
**inversão de hierarquia** na landing: o **verde Chefiz** passa a ser o
acento de marca e CTAs, e o azul do admin entra como suporte.

| Uso | Cor | Hex |
|-----|-----|-----|
| **Marca / acento principal (NOVO)** | Verde Chefiz lime | #89D136 |
| Marca hover | Verde escuro | #6DAE1E |
| Marca claro | Verde claro | #A8E866 |
| Texto sobre verde | Cinza-escuro (logo Chef) | #3F3F3F |
| Suporte (admin) | Azul profundo | #105784 |
| Suporte hover | Azul escuro | #0B3D5E |
| Fundo app | Verde bem claro | #EEFFED |
| Fundo seções | Branco / cinza | #FFFFFF / #F8F9FA |
| Texto principal | Quase preto | #212529 |
| Texto secundário | Cinza médio | #6C757D |
| Bordas | Cinza suave | #E6E6E6 |
| Destaque IA | Roxo | #7C3AED |

**Logo** — usar `/chefiz.png` (positivo, em fundo claro) e `/chefiz-neg.png`
(negativo, em fundo escuro). Ambos já em `delivery-saas-frontend/public/`.

## Arquivos a Criar/Modificar

- **Existe:** `delivery-saas-frontend/src/views/LandingPage.vue` — atualizar copy + planos.
- **Existe:** rota `/` já aponta para LandingPage; sidebar já escondida.
- **Existe:** `delivery-saas-backend/src/routes/leads.js`.
- **Modificar:** `Lead` no Prisma — adicionar campo `plan: String?` (enum BASIC/PRO/PREMIUM ou string livre).
- **Adicionar:** mapa `KIWIFY_URLS = { BASIC: '...', PRO: '...', PREMIUM: '...' }` no front, ou expor via `/public/plans` no backend.
- **Atualizar:** copy do `OnboardingWizard.vue` se o nome "Core Delivery" ainda aparecer em mensagens internas.
