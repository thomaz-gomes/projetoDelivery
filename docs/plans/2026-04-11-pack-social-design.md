# Pack Social — Studio IA

## Problema

A tab "Criar do Zero" gera 1 imagem por vez a partir de texto. Donos de restaurante precisam de múltiplas fotos profissionais do mesmo produto para alimentar feed e stories sem repetição visual.

## Solução

Nova tab **"Pack Social"** no Studio IA. O usuário envia uma foto real do produto e escolhe quantas fotos quer (1-5). A IA analisa o produto, detecta o tipo de culinária, e gera cenários variados e coerentes com o segmento — tudo em paralelo.

## Fluxo do Usuário

1. Envia foto real do produto (obrigatória, drag & drop)
2. Seleciona quantidade: 1 a 5 (cards clicáveis)
3. Seleciona formato: 1:1 (Feed), 9:16 (Stories/Reels), 16:9 (Capa)
4. Vê custo: N x 10 créditos
5. Clica "Gerar Pack"
6. Loading com spinner
7. Resultado: grid de N fotos com download individual + "Baixar todas"

Não há seletor de estilo/ângulo — a IA decide baseado no tipo de culinária.

## Fluxo do Backend

Novo endpoint: `POST /ai-studio/generate-pack`

**Body:** `{ photoBase64, quantity (1-5), aspectRatio }`

### Etapas:

1. **Validação** — créditos (`quantity * 10`), foto presente, quantity 1-5, aspectRatio válido
2. **Gemini Vision (1 chamada)** — analisa a foto e retorna JSON:
   - `productDescription`: descrição ultra-detalhada (ingredientes, texturas, cores)
   - `cuisineType`: tipo de culinária (ex: "hamburgueria artesanal", "açaiteria")
   - `productName`: nome curto do produto
3. **Gemini Flash texto (1 chamada)** — recebe cuisineType + productDescription + quantity, retorna array de N descrições de cenário:
   - Coerentes com o segmento (ex: hamburgueria → "tábua rústica com papel craft", nunca "mesa de café da manhã")
   - Variadas entre si (backgrounds, props, iluminação, mood diferentes)
   - Otimizadas para redes sociais
4. **Imagen (N chamadas em paralelo via Promise.all)** — cada chamada:
   - FOOD: productDescription (idêntico em todas, garante fidelidade)
   - SCENE: cenário específico da lista
   - FORMAT: aspectRatio escolhido
   - Estilo: foto realista DSLR, sem texto/watermark
5. **Persistência** — salva N imagens no disco, cria N registros Media (aiEnhanced: true)
6. **Débito** — quantity * 10 créditos em uma transação, metadados de auditoria
7. **Resposta** — array de medias

## Custo

| Chamada | Custo API | Créditos |
|---------|-----------|----------|
| Gemini Vision (análise) | ~centavos | 0 (incluso) |
| Gemini Flash (cenas) | ~centavos | 0 (incluso) |
| Imagen x N | custo principal | N x 10 |

## Arquivos Impactados

| Arquivo | Mudança |
|---------|---------|
| `delivery-saas-backend/src/routes/aiStudio.js` | Novo endpoint `POST /generate-pack` |
| `delivery-saas-frontend/src/views/StudioIA.vue` | Nova tab "Pack Social" com UI completa |

Sem mudança no schema Prisma (usa Media existente). Sem novas dependências.

## Decisões

- **Tab separada** (não substitui "Criar do Zero") — cada funcionalidade tem seu propósito
- **Sem seletor de estilo/ângulo** — a IA decide tudo baseado no contexto culinário
- **Geração em paralelo** — todas as N fotos geradas simultaneamente, exibidas juntas
- **Custo por unidade** — 10 créditos/foto, usuário escolhe 1-5
- **Detecção de culinária** — evita cenários incoerentes (café da manhã para hamburgueria, etc.)
