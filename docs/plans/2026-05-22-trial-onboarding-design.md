# Trial Onboarding — Brief de Design

**Data:** 2026-05-22
**Marca:** Chefiz (leia-se "Chef Easy")
**Audiência deste doc:** designer (humano ou Claude Design) — descreve **o que** construir e **por quê**, não o **como**.
**Referências:**
- `docs/plans/2026-03-12-landing-page-design.md` — posicionamento da marca
- `docs/plans/2026-03-14-trial-plan-design.md` — trial como flag em `SaasPlan` + tabela `CompanyTrial`
- `delivery-saas-frontend/src/components/OnboardingWizard.vue` — wizard pós-pagamento atual (referência de UX, **não** ponto de partida)

---

## 1. Objetivo

Criar um onboarding **prático** para abrir conta Chefiz em **regime de trial gratuito** — sem cartão de crédito, sem checkout, sem aprovação manual. O fluxo vai do cadastro até **o primeiro cardápio digital totalmente funcional** (link público acessível, com pelo menos uma categoria e um produto reais). Meta de tempo: **menos de 5 minutos**.

**Fora do escopo do onboarding:** ativação do WhatsApp Business (conectar instância Evolution / Meta WA), emissão fiscal, cadastro de motoboys, configuração de pagamento. Tudo isso vira **checklist no dashboard pós-onboarding** — o usuário entra no produto com cardápio pronto e descobre o resto in-app.

**Não-objetivo:** treinar o usuário no produto inteiro. O onboarding cobre **o mínimo viável** pra ele ver valor; aprendizado profundo fica pra ferramentas in-app (tooltips, ajuda contextual).

## 2. Quem é o usuário

- Dono ou gerente de **restaurante pequeno** (lanchonete, pizzaria, marmita).
- Acessa pelo **celular** em mais de 70% dos casos — design **mobile-first** obrigatório.
- Pode estar:
  - **Sem nenhum sistema** — anota pedido no papel, manda PDF no WhatsApp.
  - **Vindo do iFood** — quer canal próprio para fugir da taxa.
  - **Vindo de outro SaaS** — comparando opções.
- Tem WhatsApp pessoal no celular. Pode ter ou não um número dedicado pra loja.
- Pouca paciência. Se em 2 telas não enxerga valor, abandona.

## 3. O que o trial entrega

**Escopo proposto** (a confirmar antes de fechar):

- **Plano oferecido no trial:** **Pro** (Básico + Riders + Cashback + Afiliados). Mostrar o produto "carregado" maximiza chance de conversão pra qualquer tier pago.
- **Duração:** **14 dias**. Tempo suficiente pra rodar 1-2 fins de semana de operação real.
- **Sem cartão.** Sem nenhuma fricção financeira.
- **Limites:** **sem limite artificial** durante os 14 dias. Throttle só nos custos variáveis (créditos de IA pré-pagos, mensagens WhatsApp Cloud cobradas à parte se tiver).

## 4. Princípios de UX

1. **Cada tela faz UMA pergunta.** Multi-step bem fatiado é menos intimidante que um form gigante.
2. **Auto-avançar quando possível.** Validou WhatsApp → próxima tela sem clique extra.
3. **Mostrar progresso.** Stepper visível ("Passo 2 de 4") reduz abandono.
4. **Pré-popular tudo que der.** Slug a partir do nome da loja, cidade pelo CEP, timezone pelo IP.
5. **Erros sob o campo, em PT-BR claro.** "Esse WhatsApp já está cadastrado — quer entrar na conta existente?" — não "ERR_DUPLICATE_KEY".
6. **Skip para depois.** Toda configuração não-bloqueante tem "Configurar depois" — o usuário entra no produto ainda que o cardápio esteja vazio.
7. **Mobile-first com toque generoso.** Botões 48px+, inputs com `font-size: 16px` (anti-zoom do iOS).

## 5. Fluxo proposto

```
[Landing /]  →  CTA "Testar grátis por 14 dias" (em qualquer plano)
       ↓
[1. Identifique-se]  →  Nome + e-mail + senha + WhatsApp de contato (1 tela)
       ↓
[2. Sobre a loja]  →  Nome da loja + Categoria (chips)
       ↓
[3. Endereço]  →  CEP → preenche cidade/estado/timezone automaticamente
       ↓
[4. Criar cardápio]  →  Escolhe um dos 3 caminhos (template / IA da foto / manual)
       ↓
[5. Revisar cardápio]  →  Ajusta produtos (nome/preço/descrição) e publica
       ↓
[Pronto! Cardápio no ar]  →  Mostra link público funcional + dashboard
```

**5 telas** entre landing e dashboard, e o usuário sai com **cardápio publicado**. Cartão de crédito, ativação de WhatsApp Business, motoboy, fiscal — tudo isso fica como **checklist pós-onboarding** no dashboard.

### Detalhe por tela

#### Tela 1 — Identifique-se
- **Campos:** Nome completo, E-mail, Senha (mínimo 8 caracteres, sem regra ofuscada), WhatsApp de contato (máscara `(00) 00000-0000`) — não é o WhatsApp Business, é só pra contato/recuperação.
- **Validação de e-mail e WhatsApp duplicados** em tempo real (debounce 500ms): "Esse e-mail já está cadastrado — quer entrar?"
- **Sem verificação por código nesta etapa.** Confirma e-mail por link assíncrono (sem bloquear o onboarding). Ativação fiscal/cobrança eventual valida no checkout.
- **Microcopy do topo:** "Em 5 minutos seu cardápio digital está no ar. Sem cartão."
- **CTA:** "Começar grátis".
- **Footer:** "Já tem conta? Entrar" (link).

#### Tela 2 — Sobre a loja
- **Nome da loja** (text input).
- **Slug** sugerido automaticamente a partir do nome (`Lanchão Express` → `lanchao-express`). Mostrar a URL pública prévia em tempo real: `chefiz.com.br/lanchao-express`. Editável.
- **Categoria** (chips selecionáveis, uma escolha): Lanchonete · Pizzaria · Açaí/Sorvete · Marmita/Comida caseira · Hamburgueria · Doceria · Outros.
- **Microcopy:** "A categoria nos ajuda a montar seu cardápio mais rápido."

#### Tela 3 — Endereço
- **CEP** (8 dígitos, máscara `00000-000`).
- ViaCEP busca automaticamente → preenche rua, bairro, cidade, estado e timezone.
- Apenas **número** e **complemento** são editáveis pelo usuário.
- Erro de CEP inválido sem bloquear: "Não achei esse CEP. Quer preencher manualmente?"
- Endereço é só "endereço da loja" pro cardápio público — entrega/raio cobertura fica pra config posterior.

#### Tela 4 — Criar cardápio (a tela crítica)

Esta é a tela que **mais afeta ativação**. Apresenta 3 caminhos, em cards grandes lado a lado (no mobile, empilhados):

```
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│ 📸 Da foto       │  │ ⚡ Modelo pronto │  │ ✍️ Do zero       │
│                 │  │ (recomendado)   │  │                 │
│ Tira foto do    │  │ Cardápio típico │  │ Cadastra cada   │
│ cardápio físico │  │ de [categoria]  │  │ produto manual  │
│ — IA monta tudo │  │ já no ar        │  │                 │
│                 │  │                 │  │                 │
│ ~2 min          │  │ ~30 segundos    │  │ ~5+ min         │
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

- **"Modelo pronto"** é o caminho **recomendado** (selo + selecionado por padrão). O sistema gera 8–12 produtos típicos da categoria escolhida na Tela 2, com nome + descrição + faixa de preço média + foto stock. Próxima tela já vem com tudo isso.
- **"Da foto"** usa a integração de import de cardápio por IA já existente no produto. Aceita uma foto (cardápio físico, PDF) ou múltiplas. Após processar, vai pra Tela 5 com os produtos extraídos. Loading bar enquanto processa (10–30s).
- **"Do zero"** abre a Tela 5 vazia, com 1 categoria padrão criada e 1 placeholder de produto.

Garantia técnica: **independente do caminho, o usuário NÃO conclui o passo sem ter pelo menos 1 categoria + 1 produto.**

#### Tela 5 — Revisar cardápio
- Lista editável de produtos (nome, preço, descrição curta). Foto opcional — usa stock se não tiver.
- Inline edit (clica no campo, edita, blur salva). Sem modal.
- Cada produto tem botão "remover".
- Categoria editável no topo da lista. "Adicionar categoria" cria nova.
- **Validação ao publicar:** pelo menos 1 produto com nome E preço > 0. Mostra erro inline no produto inválido.
- **Botão final:** "Publicar cardápio". Persiste tudo, redireciona pro welcome.

#### Tela 6 — Cardápio no ar
- Hero: "Pronto, [Nome]! Seu cardápio do [Nome da loja] está no ar."
- **URL pública** grande e copiável: `chefiz.com.br/lanchao-express` — com botão "Copiar link" e "Abrir no celular" (QR Code modal).
- Preview iframe mobile do cardápio público (lateral no desktop, embaixo no mobile).
- 2 CTAs principais:
  - **"Compartilhar no WhatsApp"** — abre `wa.me/?text=...` pré-preenchido com link.
  - **"Entrar no painel"** — vai pro dashboard.

## 6. Estado pós-trial (dashboard)

Depois do welcome, o usuário cai no dashboard com um **banner persistente no topo**:

```
🎉 Você está em trial Pro · 13 dias restantes
[Ver planos]  [Adicionar cartão]
```

Banner sempre visível, não-fechável. Cor da marca (verde Chefiz), discreto mas presente.

**Checklist lateral** (dismissable depois de completo):
- ☑ Cardápio publicado _(já vem marcado pós-onboarding)_
- ☐ Conectar WhatsApp Business da loja _(deeplink pro fluxo de Evolution / Meta WA)_
- ☐ Adicionar foto real aos produtos _(substituir stocks)_
- ☐ Criar primeiro cupom de desconto
- ☐ Configurar área de entrega e taxa
- ☐ Compartilhar link do cardápio

Cada item completo destrava um micro-feedback (confete leve, toast "Boa! Próximo passo:") — recompensa imediata. **Conectar WhatsApp Business** é a próxima fronteira crítica, então fica logo abaixo de "Cardápio publicado" no topo da lista.

## 7. Transições críticas

### Trial → Pago
- Faltando 3 dias: banner muda para amarelo, adiciona "Seu trial expira em 3 dias".
- No D-day: modal bloqueante com 3 cards (Básico/Pro/Premium) — não dá pra dispensar sem escolher um plano OU clicar "Continuar com acesso limitado" (vira read-only).
- Pós-expiração sem pagamento: conta **continua acessível** em modo read-only por 7 dias antes de bloquear total. Permite recuperação rápida.

### Trial → Abandono
- Se o usuário não voltou em 5 dias do welcome → **e-mail + WhatsApp** com um nudge ("Falta pouco pra sua loja vender — adicione seu primeiro produto").
- Se chegou ao D-14 sem nenhum produto cadastrado → trial expira silencioso, conta vira read-only, sem cobrança nem fricção. Manter a conta no banco pra futuro re-engajamento.

## 8. Restrições técnicas que o design precisa respeitar

- O schema `SaasPlan` já tem `isTrial` e `trialDurationDays` (ver `2026-03-14-trial-plan-design.md`).
- A tabela `CompanyTrial` rastreia `startedAt`, `expiresAt`, `status`, `originalPlanId`. Mas atenção: hoje o `originalPlanId` assume uma subscription **prévia** — trial-onboarding cria a conta NO trial, sem original. Tratar `originalPlanId = null` ou usar um sentinel "FREE_AFTER_TRIAL".
- **Import de cardápio por IA já existe no produto** (ver `2026-03-07-technical-sheet-ai-import-design.md` e o módulo de menu import). O caminho "Da foto" reusa essa pipeline — não é feature nova.
- **Templates por categoria precisam ser criados antes do launch.** É um seed de produtos típicos por categoria (lanchonete = X-burger/X-Salada/Coca/Suco; pizzaria = Margherita/Calabresa/Portuguesa; etc.). Cada template tem nome, descrição curta, faixa de preço médio (R$), e uma foto stock royalty-free.
- ViaCEP é gratuito mas tem rate-limit. Usar com debounce de 500ms.
- **Slug do cardápio** precisa ser único globalmente (`chefiz.com.br/[slug]`). Validar disponibilidade em tempo real e sugerir variações (`lanchao-express-2`, `lanchao-express-sp`).
- WhatsApp Evolution / Meta WA Business fica **inteiramente fora** do onboarding. Não provisionar nenhuma instância automaticamente. O usuário entra nesse fluxo só quando clicar em "Conectar WhatsApp" no checklist do dashboard.

## 9. Acessibilidade

- Contraste mínimo AA em tudo (verde Chefiz `#89D136` em fundo branco passa; em fundo escuro também).
- Foco visível em todos os inputs (não usar `outline: none` sem alternativa).
- Stepper acessível: `aria-current="step"` no ativo, `aria-label="Passo 2 de 4"`.
- Inputs com `<label>` real (não placeholder-only).

## 10. Métricas que vamos medir (passar pra analytics no front)

- `trial_signup_started` — chegou na tela 1.
- `trial_signup_step_completed` (props: `step`) — concluiu cada uma das 4 telas.
- `trial_signup_finished` — chegou no welcome.
- `trial_signup_dropoff_at` (props: `step`) — fechou a aba sem concluir uma tela.
- `trial_activation_milestone` (props: `milestone` = primeiro_produto, wa_conectado, primeiro_pedido).
- Objetivo informal: **funnel ≥ 60%** da tela 1 ao welcome.

## 11. O que NÃO fazer

- ❌ Pedir CPF/CNPJ no signup. Pode pedir depois quando ele for emitir nota.
- ❌ Pedir cartão de crédito "só pra confirmar" — derruba o funil em 40-60%.
- ❌ Exigir verificação de WhatsApp ou e-mail por código de 6 dígitos no onboarding. Validação assíncrona por link (e-mail) é suficiente; bloquear o usuário em "espere o código" é o segundo motivo mais comum de abandono em onboardings SaaS.
- ❌ **Pedir pra conectar o WhatsApp Business no onboarding.** É um fluxo técnico (QR Code, instância Evolution, ou OAuth Meta) que toma 2–5 min e tem alta taxa de falha. Manter como passo opcional no dashboard.
- ❌ Forçar criação de senha forte ofuscada. Política simples: 8 caracteres mínimo, qualquer combinação.
- ❌ Mostrar todo o painel administrativo de uma vez. Esconder o que não está habilitado no plano trial (sem fiscal, sem stock, sem afiliados na sidebar até ele assinar Premium/Pro).
- ❌ Tela de "obrigado por se cadastrar, aguarde nosso e-mail". Acesso é **imediato**.
- ❌ Modais empilhados ou tooltips invasivos no primeiro acesso. Tour leve apenas.
- ❌ Sair do onboarding com cardápio vazio — o produto inteiro depende do link público funcionando.

## 12. Entregáveis esperados do design

1. **Fluxograma** das 6 telas + dashboard pós-onboarding (Figma/Miro/equivalente).
2. **Wireframes high-fidelity** em **2 breakpoints**: mobile 375px e desktop 1280px.
3. **Especificação visual** das telas: tipografia, espaçamentos, cores referenciando o design system do admin (`src/assets/overrides/_variables.css`).
4. **Mock dos 3 caminhos do passo "Criar cardápio"** — comparar visualmente o efeito da escolha.
5. **Mock da tela de revisão do cardápio** com inline edit funcionando (estados: padrão, em edição, com erro de validação).
6. **Mock da tela "Cardápio no ar"** com preview iframe do cardápio público real.
7. **Mock de erro** para cada tela (campo inválido, e-mail já cadastrado, CEP não encontrado, slug já em uso, IA falhou ao ler a foto, falha de servidor).
8. **Estados de loading** (spinner inline nos botões, skeleton nos cards do dashboard, progress bar no processamento de IA).
9. **Texto final** (microcopy) de cada tela em PT-BR — não Lorem Ipsum.
10. **Banner de trial** em variantes: verde (>= 5 dias), amarelo (< 5 dias), vermelho (< 1 dia).

## 13. Decisões tomadas

| # | Tema | Decisão |
|---|------|---------|
| 1 | **Plano do trial** | **Pro** — Básico + Riders + Cashback + Afiliados. Mostrar o produto carregado maximiza conversão pra qualquer tier pago. |
| 2 | **Duração** | **14 dias** — cobre 1 a 2 fins de semana de operação real. |
| 3 | **Pós-trial sem pagamento** | **Read-only por 7 dias** — usuário continua entrando, vê tudo, mas não consegue editar nem publicar. Após o 21º dia, conta vira inativa (dados preservados, login bloqueado). Permite recuperação rápida sem desperdiçar leads. |
| 4 | **Templates de cardápio** | **8–12 produtos por template, curados manualmente, 7 categorias no MVP**: Lanchonete, Pizzaria, Açaí/Sorvete, Marmita/Comida caseira, Hamburgueria, Doceria, Outros. Cada produto tem nome, descrição curta, faixa de preço médio em R$ e foto stock royalty-free. Curadoria fica com produto/marketing antes do launch. |
| 5 | **Caminho "Da foto"** | **Reaproveita** a pipeline de import por IA já existente no produto (referência: `2026-03-07-technical-sheet-ai-import-design.md` + módulo de menu import). Sem fluxo paralelo. Aceita 1 a N imagens (foto do cardápio físico, PDF). Loading bar com progresso de processamento; se IA não extrair nada, fallback automático pra "Modelo pronto" da categoria escolhida. |
| 6 | **Slug do cardápio** | **Editável até o primeiro pedido público**. Depois do primeiro pedido, slug fica **bloqueado** na UI (link mantém estável, sem quebrar QR Code ou compartilhamento). Mudança posterior só por suporte. |
| 7 | **Validação de e-mail** | **Assíncrona, link no e-mail, sem bloqueio**. Usuário entra no produto imediatamente. Banner discreto no topo do dashboard ("Confirme seu e-mail pra recuperar a senha") até confirmar. Sem ação bloqueada por estar pendente. |

Todas as decisões acima já estão refletidas no corpo do brief — esta tabela existe pra ser a fonte única de verdade caso alguém precise re-discutir.
