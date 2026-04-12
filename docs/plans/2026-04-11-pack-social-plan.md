# Pack Social Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a "Pack Social" tab to Studio IA that takes a real product photo and generates 1-5 varied, cuisine-coherent photos for social media.

**Architecture:** Single new backend endpoint (`POST /ai-studio/generate-pack`) with a 3-stage AI pipeline: Gemini Vision analyzes product + detects cuisine type, Gemini Flash generates N coherent scene descriptions, Imagen generates N images in parallel via `Promise.all`. Frontend adds a new tab to the existing `StudioIA.vue` page.

**Tech Stack:** Express.js backend, Google AI REST API (Gemini 2.5 Flash + Imagen), Vue 3 frontend, existing Media model + aiCreditManager.

---

### Task 1: Backend — `POST /ai-studio/generate-pack` endpoint

**Files:**
- Modify: `delivery-saas-backend/src/routes/aiStudio.js` (insert before the `export default router` at line 580)

**Step 1: Add the endpoint skeleton with validation**

Insert before line 580 (`export default router`):

```javascript
// POST /ai-studio/generate-pack — gera pack de N fotos variadas para redes sociais
router.post('/generate-pack', requireRole('ADMIN'), async (req, res) => {
  const companyId = req.user.companyId
  const userId = req.user.id
  const { photoBase64, quantity = 3, aspectRatio = '1:1' } = req.body || {}

  // Validações
  const qty = Math.max(1, Math.min(5, parseInt(quantity) || 3))
  const VALID_RATIOS = ['1:1', '16:9', '9:16']
  const safeRatio = VALID_RATIOS.includes(aspectRatio) ? aspectRatio : '1:1'

  if (!photoBase64 || typeof photoBase64 !== 'string') {
    return res.status(400).json({ message: 'Foto do produto é obrigatória' })
  }

  // Decodifica data URI
  const match = photoBase64.match(/^data:(image\/\w+);base64,(.+)$/)
  if (!match) return res.status(400).json({ message: 'Formato de imagem inválido. Envie JPG, PNG ou WebP.' })

  let photoMime = match[1]
  const photoBuffer = Buffer.from(match[2], 'base64')
  const VALID_MIMES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
  if (!VALID_MIMES.includes(photoMime)) photoMime = 'image/jpeg'
  const photoB64 = photoBuffer.toString('base64')

  try {
    // 1. Verifica créditos (qty * custo unitário)
    const check = await checkCredits(companyId, 'AI_STUDIO_ENHANCE', qty)
    if (!check.ok) {
      return res.status(402).json({
        message: `Créditos insuficientes. Necessário: ${check.totalCost}, Disponível: ${check.balance}.`,
        balance: check.balance,
        required: check.totalCost,
      })
    }

    const apiKey = await getGoogleAIKey()

    // 2. ETAPA 1 — Gemini Vision: analisa produto + detecta tipo de culinária
    const visionRes = await fetch(
      `${GOOGLE_AI_BASE}/models/${GEMINI_TEXT_MODEL}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { inlineData: { mimeType: photoMime, data: photoB64 } },
              {
                text:
                  `You are a food photography expert. Analyze this food photo and return a JSON object with exactly these fields:\n\n` +
                  `{\n` +
                  `  "productDescription": "ultra-detailed description of the food item — every visible ingredient from top to bottom, textures, colors, cooking method, container/plate type, garnishes. Comma-separated, in English.",\n` +
                  `  "cuisineType": "specific cuisine/restaurant type in Portuguese, e.g. 'hamburgueria artesanal', 'açaiteria', 'pizzaria napolitana', 'restaurante japonês', 'padaria artesanal', 'sorveteria'",\n` +
                  `  "productName": "short product name in Portuguese, e.g. 'smash burger duplo', 'açaí com granola', 'pizza margherita'"\n` +
                  `}\n\n` +
                  `CRITICAL: Only describe what you ACTUALLY SEE. Do NOT invent ingredients not visible in the photo.\n` +
                  `Output ONLY the JSON object, no markdown fences, no extra text.`,
              },
            ],
          }],
          generationConfig: { maxOutputTokens: 600, temperature: 0.1 },
          thinkingConfig: { thinkingBudget: 0 },
        }),
        signal: AbortSignal.timeout(30_000),
      }
    )

    if (!visionRes.ok) {
      const errText = await visionRes.text().catch(() => '')
      throw new Error(`Vision analysis error ${visionRes.status}: ${errText.slice(0, 200)}`)
    }

    const visionData = await visionRes.json()
    const visionText = visionData.candidates?.[0]?.content?.parts?.find(p => p.text)?.text?.trim()
    if (!visionText) throw new Error('Não foi possível analisar a foto do produto')

    let analysis
    try {
      analysis = JSON.parse(visionText.replace(/```json\s*/g, '').replace(/```\s*/g, ''))
    } catch {
      throw new Error('Análise retornou formato inválido. Tente novamente.')
    }

    const { productDescription, cuisineType, productName } = analysis
    if (!productDescription || !cuisineType) throw new Error('Análise incompleta do produto')

    console.log('[AI Studio Pack] Produto:', productName, '| Culinária:', cuisineType)
    console.log('[AI Studio Pack] Descrição:', productDescription.slice(0, 150))

    // 3. ETAPA 2 — Gemini Flash: gera N descrições de cenário coerentes com o segmento
    const scenesRes = await fetch(
      `${GOOGLE_AI_BASE}/models/${GEMINI_TEXT_MODEL}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text:
                `You are a creative director for food photography for social media (Instagram feed, Stories, Facebook).\n\n` +
                `CONTEXT:\n` +
                `- Product: ${productName}\n` +
                `- Cuisine type: ${cuisineType}\n` +
                `- Product details: ${productDescription.slice(0, 300)}\n\n` +
                `Generate exactly ${qty} different scene/setting descriptions for professional food photography of this product.\n\n` +
                `RULES:\n` +
                `- Each scene MUST be coherent with the cuisine type "${cuisineType}" — never suggest settings from a different cuisine segment\n` +
                `- Each scene must be visually DISTINCT from the others (different surface, lighting, props, mood, angle)\n` +
                `- Include: surface/background material, lighting type and direction, props (if any), camera angle, overall mood\n` +
                `- Scenes should be optimized for social media engagement (appetizing, scroll-stopping)\n` +
                `- Keep each description under 100 words\n` +
                `- Write in English\n\n` +
                `BAD examples (incoherent):\n` +
                `- Breakfast table setting for a hamburgueria\n` +
                `- Formal dinner table for an açaiteria\n` +
                `- Japanese zen garden for a pizzaria\n\n` +
                `GOOD examples for a hamburgueria:\n` +
                `- Dark wood bar counter with craft beer glass in background, warm tungsten pendant light from above, kraft paper underneath, casual pub mood\n` +
                `- Black slate board on industrial metal surface, dramatic side light from left, ketchup bottle and fries basket as props, urban street food vibe\n\n` +
                `Return a JSON array of ${qty} strings. No markdown fences, no extra text. Example: ["scene 1 description", "scene 2 description"]`,
            }],
          }],
          generationConfig: { maxOutputTokens: 1000, temperature: 0.8 },
          thinkingConfig: { thinkingBudget: 0 },
        }),
        signal: AbortSignal.timeout(30_000),
      }
    )

    if (!scenesRes.ok) {
      const errText = await scenesRes.text().catch(() => '')
      throw new Error(`Scene generation error ${scenesRes.status}: ${errText.slice(0, 200)}`)
    }

    const scenesData = await scenesRes.json()
    const scenesText = scenesData.candidates?.[0]?.content?.parts?.find(p => p.text)?.text?.trim()
    if (!scenesText) throw new Error('Não foi possível gerar cenários')

    let scenes
    try {
      scenes = JSON.parse(scenesText.replace(/```json\s*/g, '').replace(/```\s*/g, ''))
    } catch {
      throw new Error('Cenários retornaram formato inválido. Tente novamente.')
    }

    if (!Array.isArray(scenes) || scenes.length < qty) {
      throw new Error(`Esperado ${qty} cenários, recebido ${scenes?.length || 0}`)
    }

    console.log('[AI Studio Pack] Cenários gerados:', scenes.length)

    // 4. ETAPA 3 — Imagen: gera N imagens em paralelo
    const imagePromises = scenes.slice(0, qty).map((scene, idx) => {
      const prompt =
        `FOOD (reproduce this EXACT food item with every ingredient — do NOT change, add, or remove anything): ${productDescription}. ` +
        `\nSCENE AND SETTING (affects ONLY background, surface, lighting, and props — NOT the food itself): ${scene}. ` +
        `\nIMAGE FORMAT: ${RATIO_PROMPTS[safeRatio]}. The output image MUST be in ${safeRatio} aspect ratio.\n` +
        `\nSTYLE: realistic DSLR photograph (Canon EOS R5, 100mm macro lens), shallow depth of field, ` +
        `natural food textures with real imperfections, appetizing presentation for social media, ` +
        `high-end food photography, no CGI, no illustration, no watermarks, no text, no logos`

      return fetch(
        `${GOOGLE_AI_BASE}/models/${IMAGEN_MODEL}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              responseModalities: ['IMAGE'],
              imageConfig: { aspectRatio: safeRatio },
            },
          }),
          signal: AbortSignal.timeout(120_000),
        }
      ).then(async (r) => {
        if (!r.ok) {
          const errText = await r.text().catch(() => '')
          throw new Error(`Imagen error (foto ${idx + 1}) ${r.status}: ${errText.slice(0, 200)}`)
        }
        const data = await r.json()
        const part = data.candidates?.[0]?.content?.parts?.find(p => p.inlineData)
        if (!part?.inlineData?.data) throw new Error(`Imagen não retornou imagem (foto ${idx + 1})`)
        return part.inlineData
      })
    })

    const imageResults = await Promise.all(imagePromises)

    // 5. Salva todas as imagens + cria registros Media
    const dir = path.join(process.cwd(), 'public', 'uploads', 'media', companyId)
    await fs.promises.mkdir(dir, { recursive: true })

    const slug = (productName || 'produto').slice(0, 30).replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '_').toLowerCase()
    const mediaRecords = []

    for (let i = 0; i < imageResults.length; i++) {
      const imgData = imageResults[i]
      const genBuffer = Buffer.from(imgData.data, 'base64')
      const genMime = imgData.mimeType || 'image/png'
      const genExt = genMime === 'image/png' ? 'png' : 'jpg'

      const newId = randomUUID()
      const safeName = `${newId}.${genExt}`
      await fs.promises.writeFile(path.join(dir, safeName), genBuffer)
      const newUrl = `/public/uploads/media/${companyId}/${safeName}`
      const filename = `ai_pack_${slug}_${i + 1}.${genExt}`

      const record = await prisma.media.create({
        data: { id: newId, companyId, filename, mimeType: genMime, size: genBuffer.length, url: newUrl, aiEnhanced: true },
      })
      mediaRecords.push(record)
    }

    // 6. Debita créditos
    await debitCredits(companyId, 'AI_STUDIO_ENHANCE', qty, {
      type: 'generate_pack',
      quantity: qty,
      cuisineType,
      productName: (productName || '').slice(0, 100),
      resultMediaIds: mediaRecords.map(m => m.id),
    }, userId)

    res.json({ media: mediaRecords, analysis: { productName, cuisineType } })
  } catch (e) {
    console.error('[AI Studio Pack] Erro:', e?.message || e)
    const status = e.statusCode || 500
    res.status(status).json({ message: e?.message || 'Erro interno ao gerar pack de fotos' })
  }
})
```

**Step 2: Verify backend starts without errors**

Run: `docker compose up -d && docker compose logs -f backend --tail=20`
Expected: No syntax errors, server running on port 3000.

**Step 3: Commit**

```bash
git add delivery-saas-backend/src/routes/aiStudio.js
git commit -m "feat(ai-studio): add POST /generate-pack endpoint for social media photo packs"
```

---

### Task 2: Frontend — Add "Pack Social" tab to StudioIA.vue

**Files:**
- Modify: `delivery-saas-frontend/src/views/StudioIA.vue`

**Step 1: Add the "Pack Social" tab button in the nav (after "Criar do Zero", before "Otimizar Foto")**

In the `<ul class="nav nav-tabs">` section (around line 21-37), add after the "Criar do Zero" `<li>` and before the "Otimizar Foto" `<li>`:

```html
<li class="nav-item">
  <a class="nav-link" :class="{ active: tab === 'pack' }" href="#" @click.prevent="tab = 'pack'">
    <i class="bi bi-grid-3x3-gap me-1"></i>Pack Social
  </a>
</li>
```

**Step 2: Add Pack Social state variables**

In the `<script setup>` section, after the "Create tab" state block (after line 428), add:

```javascript
// Pack Social tab
const packFile = ref(null)
const packPreview = ref(null)
const packBase64 = ref(null)
const packQuantity = ref(3)
const packRatio = ref('1:1')
const packLoading = ref(false)
const packError = ref(null)
const packResults = ref([])
const packAnalysis = ref(null)
const packDragOver = ref(false)
```

**Step 3: Add Pack Social template section**

Insert after the closing `</div>` of the "Criar do Zero" tab panel (after line 191), before the "Otimizar Foto" tab panel:

```html
<!-- ── Tab: Pack Social ── -->
<div v-if="tab === 'pack'" class="studio-ia-panel">
  <div class="row g-4">
    <div class="col-12 col-lg-5">
      <!-- Upload foto do produto (obrigatória) -->
      <div class="mb-3">
        <label class="form-label small fw-semibold">
          <i class="bi bi-camera me-1"></i>Foto do Produto
        </label>
        <div
          class="sia-dropzone"
          :class="{ 'drag-over': packDragOver }"
          @click="$refs.packFileInput.click()"
          @dragover.prevent="packDragOver = true"
          @dragleave.prevent="packDragOver = false"
          @drop.prevent="onPackDrop"
        >
          <div v-if="packPreview" class="sia-dropzone-preview">
            <img :src="packPreview" alt="Produto" />
            <button type="button" class="btn btn-sm btn-outline-danger sia-dropzone-clear" @click.stop="clearPack">
              <i class="bi bi-x-lg"></i>
            </button>
          </div>
          <template v-else>
            <i class="bi bi-camera" style="font-size:2rem;opacity:.4"></i>
            <span class="small text-muted mt-1">Arraste ou clique para enviar a foto do produto</span>
            <span class="small text-muted" style="font-size:.75rem">JPG, PNG — maximo 5 MB</span>
          </template>
        </div>
        <input ref="packFileInput" type="file" accept="image/jpeg,image/png,image/webp" style="display:none" @change="onPackFileChange" />
        <div class="form-text">A IA vai analisar o produto e gerar fotos variadas para redes sociais</div>
      </div>

      <!-- Quantidade -->
      <div class="mb-3">
        <label class="form-label small fw-semibold">
          <i class="bi bi-plus-slash-minus me-1"></i>Quantidade de Fotos
        </label>
        <div class="sia-qty-grid">
          <label
            v-for="n in 5"
            :key="n"
            :class="['sia-qty-card', { active: packQuantity === n }]"
          >
            <input type="radio" :value="n" v-model="packQuantity" class="d-none" :disabled="packLoading" />
            <span class="sia-qty-number">{{ n }}</span>
            <span class="sia-qty-cost">{{ n * (creditCost || 10) }} cr</span>
          </label>
        </div>
      </div>

      <!-- Formato -->
      <div class="mb-3">
        <label class="form-label small fw-semibold">
          <i class="bi bi-aspect-ratio me-1"></i>Formato
        </label>
        <div class="sia-ratio-grid">
          <label
            v-for="r in RATIOS"
            :key="r.key"
            :class="['sia-ratio-card', { active: packRatio === r.key }]"
          >
            <input type="radio" :value="r.key" v-model="packRatio" class="d-none" :disabled="packLoading" />
            <span class="sia-ratio-icon" :style="{ aspectRatio: r.preview }"><i class="bi bi-image"></i></span>
            <span class="sia-ratio-name">{{ r.name }}</span>
            <span class="sia-ratio-sub">{{ r.sub }}</span>
          </label>
        </div>
      </div>

      <div v-if="packError" class="alert alert-danger py-2 small mt-3 mb-0">
        <i class="bi bi-exclamation-triangle me-1"></i>{{ packError }}
      </div>
    </div>

    <!-- Resultado -->
    <div class="col-12 col-lg-7">
      <div class="d-flex align-items-center gap-2 flex-wrap mb-4">
        <span class="badge bg-warning text-dark px-3 py-2">
          <i class="bi bi-lightning-charge-fill me-1"></i>Custo: <strong>{{ packQuantity * (creditCost || 10) }}</strong> creditos
        </span>
        <button
          type="button"
          class="btn btn-warning fw-bold ms-auto"
          :disabled="!packFile || packLoading"
          @click="generatePack"
        >
          <span v-if="packLoading" class="spinner-border spinner-border-sm me-1" role="status"></span>
          <i v-else class="bi bi-grid-3x3-gap me-1"></i>
          {{ packLoading ? 'Gerando...' : `Gerar ${packQuantity} Foto${packQuantity > 1 ? 's' : ''}` }}
        </button>
      </div>

      <div v-if="packLoading" class="sia-preview-placeholder">
        <div class="spinner-border text-warning" style="width:3rem;height:3rem" role="status"></div>
        <p class="text-muted small mt-3 mb-0">Gerando {{ packQuantity }} fotos com IA...<br>Isso pode levar ate 3 minutos.</p>
      </div>
      <div v-else-if="packResults.length" class="sia-pack-results">
        <div v-if="packAnalysis" class="mb-3 text-center">
          <span class="badge bg-light text-dark border px-3 py-2">
            <i class="bi bi-shop me-1"></i>{{ packAnalysis.cuisineType }} — <strong>{{ packAnalysis.productName }}</strong>
          </span>
        </div>
        <div class="sia-pack-grid" :class="{ 'pack-single': packResults.length === 1 }">
          <div v-for="(item, idx) in packResults" :key="item.id" class="sia-pack-item">
            <img :src="assetUrl(item.url)" :alt="item.filename" />
            <div class="sia-pack-item-overlay">
              <button class="btn btn-sm btn-light" @click="downloadMedia(item)" title="Download">
                <i class="bi bi-download"></i>
              </button>
            </div>
            <span class="sia-pack-badge">{{ idx + 1 }}</span>
          </div>
        </div>
        <div class="sia-preview-actions mt-3">
          <button class="btn btn-outline-secondary btn-sm" @click="downloadAllPack">
            <i class="bi bi-download me-1"></i>Baixar todas
          </button>
          <button class="btn btn-link btn-sm text-muted" @click="resetPack">
            <i class="bi bi-arrow-counterclockwise me-1"></i>Gerar outro pack
          </button>
        </div>
      </div>
      <div v-else class="sia-preview-placeholder">
        <i class="bi bi-grid-3x3-gap" style="font-size:3rem;opacity:.2"></i>
        <p class="text-muted small mt-2 mb-0">As fotos geradas aparecerao aqui</p>
      </div>
    </div>
  </div>
</div>
```

**Step 4: Add Pack Social methods**

In the `<script setup>`, after the `clearGenRef()` function (around line 493), add:

```javascript
// ── Pack Social ──
function onPackFileChange(e) {
  const f = e.target.files?.[0]
  if (f) stagePackFile(f)
  try { e.target.value = '' } catch {}
}

function onPackDrop(e) {
  packDragOver.value = false
  const f = e.dataTransfer?.files?.[0]
  if (f) stagePackFile(f)
}

function stagePackFile(file) {
  packError.value = null
  if (!file.type.startsWith('image/')) {
    packError.value = 'Formato invalido. Use JPG, PNG ou WebP.'
    return
  }
  if (file.size > 5 * 1024 * 1024) {
    packError.value = 'Arquivo muito grande. Maximo: 5 MB.'
    return
  }
  packFile.value = file
  packResults.value = []
  packAnalysis.value = null
  if (packPreview.value) URL.revokeObjectURL(packPreview.value)
  packPreview.value = URL.createObjectURL(file)
  const reader = new FileReader()
  reader.onload = () => { packBase64.value = reader.result }
  reader.readAsDataURL(file)
}

function clearPack() {
  packFile.value = null
  packBase64.value = null
  packResults.value = []
  packAnalysis.value = null
  if (packPreview.value) {
    URL.revokeObjectURL(packPreview.value)
    packPreview.value = null
  }
}

function resetPack() {
  clearPack()
  packError.value = null
}

async function generatePack() {
  if (!packBase64.value) return
  packError.value = null
  packResults.value = []
  packAnalysis.value = null
  packLoading.value = true
  try {
    const res = await api.post('/ai-studio/generate-pack', {
      photoBase64: packBase64.value,
      quantity: packQuantity.value,
      aspectRatio: packRatio.value,
    }, { timeout: 300000 })
    packResults.value = res.data.media || []
    packAnalysis.value = res.data.analysis || null
    await refreshBalance()
  } catch (e) {
    packError.value = e?.response?.data?.message || 'Erro ao gerar pack. Tente novamente.'
  } finally {
    packLoading.value = false
  }
}

function downloadAllPack() {
  packResults.value.forEach(item => downloadMedia(item))
}
```

**Step 5: Add Pack Social CSS**

At the end of the `<style scoped>` section, before the closing `</style>`, add:

```css
/* ── Pack Social ── */
.sia-qty-grid {
  display: flex;
  gap: 0.5rem;
}
.sia-qty-card {
  flex: 1;
  border: 2px solid #e9ecef;
  border-radius: 10px;
  padding: 0.5rem 0.25rem;
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 0.1rem;
  background: #fff;
  user-select: none;
}
.sia-qty-card:hover {
  border-color: #ffc107;
  box-shadow: 0 2px 8px rgba(255, 193, 7, 0.2);
}
.sia-qty-card.active {
  border-color: #ffc107;
  background: #fffbeb;
  box-shadow: 0 2px 12px rgba(255, 193, 7, 0.3);
}
.sia-qty-number { font-weight: 800; font-size: 1.1rem; line-height: 1.2; }
.sia-qty-cost { font-size: 0.62rem; color: #6c757d; }

.sia-pack-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 0.75rem;
}
.sia-pack-grid.pack-single {
  grid-template-columns: 1fr;
  max-width: 400px;
  margin: 0 auto;
}
.sia-pack-item {
  position: relative;
  border-radius: 10px;
  overflow: hidden;
  border: 2px solid #e9ecef;
  aspect-ratio: 1;
}
.sia-pack-item img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.sia-pack-item-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  opacity: 0;
  transition: opacity 0.15s;
}
.sia-pack-item:hover .sia-pack-item-overlay {
  opacity: 1;
}
.sia-pack-badge {
  position: absolute;
  top: 6px;
  left: 6px;
  background: rgba(255, 193, 7, 0.9);
  color: #212529;
  border-radius: 50%;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.7rem;
  font-weight: 700;
}
```

**Step 6: Commit**

```bash
git add delivery-saas-frontend/src/views/StudioIA.vue
git commit -m "feat(ai-studio): add Pack Social tab UI with quantity selector and grid results"
```

---

### Task 3: Manual Testing

**Step 1: Start the dev environment**

Run: `docker compose up -d`

**Step 2: Test the Pack Social flow**

1. Navigate to `/marketing/studio-ia`
2. Click the "Pack Social" tab
3. Upload a real food photo (burger, pizza, etc.)
4. Select quantity = 2 (to save credits during testing)
5. Select format 1:1
6. Click "Gerar 2 Fotos"
7. Verify:
   - Loading spinner appears
   - After ~1-2 min, 2 different photos appear in the grid
   - Badge shows cuisine type + product name
   - Each photo has a download button on hover
   - "Baixar todas" downloads both
   - Credit balance decremented by 20
   - Photos appear in Gallery tab with AI badge

**Step 3: Test edge cases**

- Try without uploading photo → button should be disabled
- Try with insufficient credits → should show 402 error message
- Try quantity 1 and 5 → verify correct number of results

**Step 4: Final commit if any adjustments needed**

```bash
git add -A
git commit -m "fix(ai-studio): pack social adjustments from manual testing"
```
