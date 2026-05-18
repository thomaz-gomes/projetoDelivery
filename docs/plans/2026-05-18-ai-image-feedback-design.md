# AI Image Feedback & Brand Theme — Design

**Data:** 2026-05-18
**Status:** Aprovado, pronto para planejamento de implementação

## Problema

O gerador atual (`POST /ai-studio/generate-pack`) sofre de três problemas:

1. **Qualidade visual inconsistente** — algumas imagens vêm com deformações, ingredientes errados ou sem apelo.
2. **Repetição entre packs ao longo do tempo** — cada pack é diverso internamente, mas o mesmo "balcão de madeira escuro + luz amarela" reaparece em dezenas de gerações.
3. **Falta de identidade visual da marca** — imagens são tecnicamente boas mas não seguem uma estética consistente da loja.

A causa raiz comum: o gerador não tem memória nem feedback. Não sabe o que já gerou antes, o que o operador curtiu, ou qual o "DNA visual" da loja.

## Contexto atual

- `POST /ai-studio/generate-pack` em `delivery-saas-backend/src/routes/aiStudio.js` faz pipeline de 3 estágios: Gemini Vision (análise do produto) → Gemini Flash (gera N cenários) → Imagen/Nano Banana (gera N imagens em paralelo).
- Tabela `Media` tem apenas flag `aiEnhanced` — nenhum mecanismo de feedback.
- Cada chamada é stateless: nada do feedback ou histórico anterior influencia a próxima geração.

## Decisões de produto

1. **Feedback categorizado por imagem** (não estrelas, não like impl​ícito): 👍 simples, ou 👎 com motivo.
2. **Tema visual configurado por loja** (não inferido pela IA): operador define paleta/mood/props/superfície/iluminação no admin.
3. **Lições aprendidas resumidas em texto** pela Gemini Flash, refresh **manual** (botão "Atualizar agora").
4. **Diversidade temporal entre packs** — adiada para fase 2.
5. **Few-shot visual (imagens-referência)** — adiada para fase 2.

## Arquitetura

### Modelagem (Prisma)

```prisma
model Media {
  // campos atuais (id, companyId, filename, mimeType, size, url, aiEnhanced) preservados
  aiPromptSnapshot Json?
  aiThemeId        String?
  aiTheme          BrandVisualTheme? @relation(fields: [aiThemeId], references: [id])
  feedbacks        MediaFeedback[]
}

model BrandVisualTheme {
  id        String   @id @default(uuid())
  companyId String
  company   Company  @relation(fields: [companyId], references: [id])
  storeId   String?
  store     Store?   @relation(fields: [storeId], references: [id])
  name      String
  palette   String?
  mood      String?
  props     String?
  surface   String?
  lighting  String?
  isDefault Boolean  @default(false)
  isActive  Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  medias    Media[]

  @@index([companyId])
  @@index([storeId])
}

enum MediaFeedbackReason {
  LIKED
  FOOD_DEFORMED
  SCENE_REPETITIVE
  OFF_BRAND
  WRONG_COLOR
  OTHER
}

model MediaFeedback {
  id        String              @id @default(uuid())
  mediaId   String
  media     Media               @relation(fields: [mediaId], references: [id], onDelete: Cascade)
  userId    String?
  reason    MediaFeedbackReason
  note      String?
  createdAt DateTime            @default(now())

  @@index([mediaId])
  @@unique([mediaId, userId, reason], name: "uniq_media_user_reason")
}

model Company {
  // campo novo (demais preservados)
  aiLessonsCache Json?  // { text, updatedAt, feedbacksConsidered }
}
```

- Validações:
  - `BrandVisualTheme`: pelo menos 1 dos campos visuais preenchido; apenas 1 `isDefault=true` por (companyId, storeId nulo); `storeId` deve pertencer à `companyId`.
  - `MediaFeedback`: unique constraint impede mesma combinação `(media, user, reason)`.
- `aiThemeId` em `Media` é FK direta + `aiPromptSnapshot.themeSnapshot` (cópia) — porque o tema pode ser editado depois, queremos saber qual versão foi usada.

### Admin: cadastro de tema visual

Nova tela "Temas Visuais da Marca". Lista os temas da empresa, permite criar/editar/excluir/duplicar. Marcar 1 como padrão.

Formulário:
- Nome
- Aplicar a: todas as lojas ou loja específica
- Campos visuais: palette, mood, props, surface, lighting (texto livre)
- Checkbox "marcar como padrão"

Endpoints: `GET/POST /brand-themes`, `PATCH/DELETE /brand-themes/:id`.

No fluxo de geração no Studio IA, dropdown abaixo do seletor de proporção:
- Resolução automática: tema da loja ativa > padrão da empresa > "sem tema".
- Operador pode forçar outro tema da lista.

### Feedback por imagem

Em `StudioIA.vue` e `MediaLibraryModal.vue`, cada thumbnail de Media com `aiEnhanced=true` ganha 2 botões no hover:

- **👍** (1 clique) — cria `MediaFeedback { reason: LIKED }`. Toggle.
- **👎** (1 clique) — abre mini-modal com radio:
  - Comida deformada / ingredientes errados (FOOD_DEFORMED)
  - Cenário repetitivo / sem graça (SCENE_REPETITIVE)
  - Não combina com a marca da loja (OFF_BRAND)
  - Cor / textura / iluminação ruim (WRONG_COLOR)
  - Outro motivo (OTHER) — `note` obrigatório
  - Campo "observação" opcional para os outros casos

Endpoints:
- `POST /media/:id/feedback` — body `{ reason, note? }`
- `DELETE /media/:id/feedback/:feedbackId`
- `GET /media/:id/feedbacks` (admin/debug)

Indicador visual: badge verde "✓ curtida" para LIKED; badge cinza neutro para outros (tooltip mostra qual motivo).

### Pipeline de geração modificado

`POST /ai-studio/generate-pack` aceita `themeId?` no body.

1. **Resolve tema:** `themeId` informado → busca direto; senão `BrandVisualTheme` da `storeId` ou `isDefault=true` da empresa; senão sem tema.
2. **Lê `Company.aiLessonsCache.text`** (string vazia se nunca foi gerado).
3. **Gemini Vision** (sem mudança).
4. **Gemini Flash (cenários):** prompt ganha 2 blocos opcionais:

   ```
   BRAND THEME (apply consistently across all scenes):
   - Palette: <theme.palette>
   - Mood: <theme.mood>
   - Surface: <theme.surface>
   - Lighting: <theme.lighting>
   - Props to consider: <theme.props>

   LESSONS LEARNED FROM PAST FEEDBACK (apply when relevant):
   <Company.aiLessonsCache.text>
   ```

   Quando o tema ou as lições não existem, o bloco simplesmente não aparece (nenhum placeholder vazio).

5. **Imagen (Nano Banana):** prompt da imagem injeta:
   ```
   BRAND STYLE (apply to background, surface, lighting, props — NOT the food):
   <palette + mood + lighting>
   ```

6. **Persistência:** cada Media nova grava `aiThemeId` (FK) e `aiPromptSnapshot`:
   ```json
   {
     "scene": "...",
     "themeSnapshot": { "name", "palette", "mood", "props", "surface", "lighting" },
     "lessonsApplied": "texto das lições aplicadas",
     "imagenPrompt": "prompt final enviado"
   }
   ```

### Lições aprendidas — refresh manual

Sem cron, sem worker, sem stale check automático. Apenas botão.

Endpoint `POST /ai-studio/lessons/refresh`:
1. Busca até 30 feedbacks mais recentes dos últimos 90 dias da empresa.
2. Para cada Media envolvida, carrega `aiPromptSnapshot.scene` (contexto).
3. Chama Gemini Flash com prompt:

   ```
   You are auditing AI-generated food photos for a Brazilian restaurant.
   Below are pieces of feedback from operators about images.

   NEGATIVE FEEDBACK (grouped by reason, last 90 days):
   ...

   POSITIVE FEEDBACK (LIKED):
   ...

   TASK: Summarize the patterns into actionable lessons. Max 5 bullet points,
   each under 25 words. Mix avoid/prefer. Be specific. No platitudes.
   Output plain text, one lesson per line.
   ```

4. Salva resultado em `Company.aiLessonsCache`.
5. Erro 400 se não houver feedback algum.
6. Custo do Flash arcado pela plataforma (não debita do operador).

UI no Studio IA — card "Lições aprendidas pela IA":
- Mostra `aiLessonsCache.text` formatado em bullet points.
- "Última atualização: há X dias · N feedbacks analisados".
- Botão "Atualizar agora" → chama o endpoint.
- Estado vazio: "Ainda sem lições. Dê feedback nas imagens e clique em 'Atualizar agora'."
- Texto NÃO editável manualmente (mantém o sinal de feedback puro).

### Métricas e auditoria

Sem dashboards novos. Telemetria persistida em:
- `Media.aiPromptSnapshot` (prompt + scene + tema + lições aplicadas).
- `Media.aiThemeId` (qual tema foi usado).
- `MediaFeedback.{reason, note, createdAt}` (todo feedback).
- `Company.aiLessonsCache` (estado atual do aprendizado).

Queries úteis SQL/Prisma para inspeção ad-hoc:
- Taxa de aprovação por tema.
- Razões de rejeição mais comuns nos últimos 30 dias.
- Lições aplicadas em uma imagem específica.

## Migração e rollout

- Migration Prisma adiciona `BrandVisualTheme`, `MediaFeedback`, enum `MediaFeedbackReason`, e campos novos em `Media` e `Company` — sem alteração em colunas existentes. Zero impacto em dados atuais.
- Pipeline de geração mantém comportamento atual quando: nenhum tema configurado E sem lições aprendidas. Operador continua usando como sempre.
- Feedback é opcional; nada pressiona o operador a usar.

## Fora de escopo

- **Diversidade temporal entre packs**: histórico/pool de cenários por cozinha (fase 2).
- **Few-shot visual**: usar imagens curtidas como referência direta no Imagen (fase 2).
- **Edição manual das lições aprendidas**: mantém puro o sinal do feedback.
- **Dashboard de métricas em UI**: dados ficam acessíveis via SQL; UI só se virar dor real.
- **Diff entre versões de tema**: se editar o tema, snapshot anterior continua disponível em `aiPromptSnapshot.themeSnapshot` das imagens já geradas.

## Arquivos a tocar

**Backend (`delivery-saas-backend/`)**:
- `prisma/schema.prisma` — 2 modelos novos, 1 enum, 2 campos novos.
- `src/routes/brandThemes.js` (novo) — CRUD de temas.
- `src/routes/aiStudio.js` — aceitar `themeId`; injetar tema e lições nos prompts; salvar snapshot; endpoint de refresh de lições.
- `src/routes/media.js` (ou similar onde estiver Media) — endpoints de feedback.
- `src/server.js` — registrar nova rota `brandThemes`.

**Frontend (`delivery-saas-frontend/`)**:
- Nova view/aba "Temas Visuais" no admin (sob Configurações ou Marketing).
- `views/StudioIA.vue` — dropdown de tema na geração; card de "Lições aprendidas" com botão atualizar; botões 👍/👎 nas thumbs da galeria; mini-modal de motivo.
- `components/MediaLibrary/MediaLibraryModal.vue` — mesmos botões nas thumbs.

## Testes mínimos

Unit:
- Resolução de tema: storeId específico > default da empresa > sem tema.
- Construção do prompt: blocos "BRAND THEME" e "LESSONS LEARNED" aparecem apenas quando dados existem.
- Refresh de lições com array vazio → erro 400.

Integration (manual):
- Cadastrar tema → gerar pack → confirmar que tema aparece em `aiPromptSnapshot`.
- Dar 👎 com motivo → checar `MediaFeedback` no banco.
- Clicar "Atualizar lições" → checar `Company.aiLessonsCache` populado.
- Próximo pack após refresh → confirmar que `aiPromptSnapshot.lessonsApplied` reflete o cache.
