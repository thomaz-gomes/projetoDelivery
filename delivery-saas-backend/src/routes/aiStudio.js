/**
 * aiStudio.js — Rota de aprimoramento de imagens no AI Studio
 *
 * POST /ai-studio/enhance
 *   Body: { mediaId, style, angle, mode }
 *     style: "minimal" | "rustic" | "dark" | "vibrant"
 *     angle: "top" | "standard" | "hero"
 *     mode:  "new" | "replace"
 *
 * Fluxo:
 *   1. Valida créditos (AI_STUDIO_ENHANCE = 10 créditos)
 *   2. Lê a imagem original do disco em base64
 *   3. Monta prompt de retoque (mantém composição, melhora iluminação/qualidade)
 *   4. Envia imagem original + prompt ao Nano Banana (imagem como input + output)
 *   6. Decodifica base64 e salva em /public/uploads/media/{companyId}/
 *   7. Cria novo registro de Media (ou atualiza se mode=replace)
 *   8. Debita créditos com metadados de auditoria
 *
 * API: Google AI Studio (fetch nativo, sem SDK)
 */

import { Router } from 'express'
import { prisma } from '../prisma.js'
import { authMiddleware, requireRole } from '../auth.js'
import { requireModuleStrict } from '../modules.js'
import { checkCredits, debitCredits } from '../services/aiCreditManager.js'
import { getSetting } from '../services/systemSettings.js'
import { callVisionAI } from '../services/aiProvider.js'
import path from 'path'
import fs from 'fs'
import { randomUUID } from 'crypto'
import { optimizeForWeb, preserveHighQuality } from '../utils/imageOptimizer.js'
import { resolveTheme, buildThemeBlock, buildLessonsBlock } from '../utils/brandTheme.js'

const router = Router()
router.use(authMiddleware)
router.use(requireModuleStrict('CARDAPIO_SIMPLES'))

// Google AI Studio — endpoints REST (sem SDK)
const GOOGLE_AI_BASE   = 'https://generativelanguage.googleapis.com/v1beta'
const GEMINI_TEXT_MODEL = 'gemini-2.5-flash'       // visão + texto
const IMAGEN_MODEL      = 'gemini-2.5-flash-image' // Nano Banana (atual) — retoque e geração de foto

// Prompts de estilo fotográfico — otimizados para fotorrealismo máximo com DALL-E 3
// Evitar termos "artísticos" (ultra-detailed, 8K, cinematic) que geram look digital/plastificado
const STYLE_PROMPTS = {
  minimal:
    'white marble surface with visible natural veining, twin softbox studio lights from 45-degree angles creating soft even illumination with gentle shadows, neutral white or light gray background, clean food photography setup — real physical surface textures, subtle natural shadows, no artificial gloss',
  rustic:
    'aged reclaimed wood surface with visible grain knots and texture, warm tungsten side-lamp casting amber tones from the left, small folded linen napkin in background, coarse salt flakes scattered nearby — authentic restaurant bistro setting, natural wood imperfections visible, organic warm color palette',
  dark:
    'dark wet-look slate surface with fine natural texture, single hard spotlight from upper-left at 30 degrees creating deep directional shadows, minimal props, matte dark background — real studio food photography with natural specular highlights on food surfaces, true shadow falloff',
  vibrant:
    'solid coral or teal or saffron-yellow matte backdrop, bright front diffused light with fill reflector eliminating harsh shadows, saturated but natural colors — real commercial food photography for delivery apps, clean bright appearance, no neon or digital-looking tones',
}

// Descrições de aspect ratio para injetar no prompt textual
const RATIO_PROMPTS = {
  '1:1':  'Square format (1:1 aspect ratio)',
  '16:9': 'Wide landscape format (16:9 aspect ratio, wider than tall)',
  '9:16': 'Tall portrait format (9:16 aspect ratio, taller than wide, vertical orientation)',
}

// Prompts de ângulo de câmera
const ANGLE_PROMPTS = {
  top:      'camera positioned directly overhead at 90 degrees, perfectly parallel to the surface, symmetrical flat-lay composition',
  standard: 'camera elevated at 45-degree angle showing front and top of the dish, natural food photography perspective with visible depth',
  hero:     'camera at plate level (0-degree eye-level angle), emphasizing height and layering of the food with natural depth-of-field blur in foreground',
}

// Fetch com retry automático para 429/503 (rate limit / overload)
async function fetchWithRetry(url, options, { maxRetries = 3, baseDelay = 5000, label = 'API' } = {}) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, options)
    if (res.ok || (res.status !== 429 && res.status !== 503)) return res
    if (attempt === maxRetries) return res // última tentativa, retorna o erro
    const delay = baseDelay * Math.pow(2, attempt) // 5s, 10s, 20s
    console.warn(`[AI Studio] ${label}: ${res.status}, retrying in ${delay / 1000}s (attempt ${attempt + 1}/${maxRetries})`)
    await new Promise(r => setTimeout(r, delay))
  }
}

async function getGoogleAIKey() {
  const key = await getSetting('google_ai_api_key', 'GOOGLE_AI_API_KEY')
  if (!key) throw Object.assign(new Error('Chave da API Google AI não configurada. Acesse Painel SaaS → Configurações.'), { statusCode: 503 })
  return key
}

// GET /ai-studio/cost — custo em créditos e saldo atual
router.get('/cost', requireRole('ADMIN'), async (req, res) => {
  try {
    const check = await checkCredits(req.user.companyId, 'AI_STUDIO_ENHANCE', 1)
    res.json({
      cost: check.totalCost,
      balance: check.balance,
      ok: check.ok,
      unlimitedAiCredits: check.unlimitedAiCredits,
    })
  } catch (e) {
    res.status(500).json({ message: 'Erro ao verificar créditos' })
  }
})

// POST /ai-studio/enhance — aprimora uma imagem da biblioteca
router.post('/enhance', requireRole('ADMIN'), async (req, res) => {
  const companyId = req.user.companyId
  const userId = req.user.id
  const { mediaId, style = 'minimal', angle = 'standard', mode = 'new', aspectRatio = '1:1' } = req.body || {}
  const VALID_RATIOS_E = ['1:1', '16:9', '9:16']
  const safeRatioE = VALID_RATIOS_E.includes(aspectRatio) ? aspectRatio : '1:1'

  if (!mediaId) return res.status(400).json({ message: 'mediaId é obrigatório' })
  if (!STYLE_PROMPTS[style]) return res.status(400).json({ message: `Estilo inválido: ${style}` })
  if (!ANGLE_PROMPTS[angle]) return res.status(400).json({ message: `Ângulo inválido: ${angle}` })

  try {
    // 1. Verifica créditos antes de qualquer operação
    const check = await checkCredits(companyId, 'AI_STUDIO_ENHANCE', 1)
    if (!check.ok) {
      return res.status(402).json({
        message: `Créditos de IA insuficientes. Necessário: ${check.totalCost}, Disponível: ${check.balance}.`,
        balance: check.balance,
        required: check.totalCost,
      })
    }

    // 2. Carrega registro de mídia
    const media = await prisma.media.findFirst({ where: { id: mediaId, companyId } })
    if (!media) return res.status(404).json({ message: 'Imagem não encontrada na biblioteca' })

    const apiKey = await getGoogleAIKey()

    // 3. Carrega os bytes da imagem — disco primeiro, depois HTTP (URLs externas ou imagens importadas)
    let imageBuffer
    let mimeType = media.mimeType || 'image/jpeg'
    const isExternal = /^https?:\/\//i.test(media.url)

    if (!isExternal) {
      const filePath = path.join(process.cwd(), media.url.replace(/^\//, ''))
      if (fs.existsSync(filePath)) {
        imageBuffer = await fs.promises.readFile(filePath)
      }
    }

    if (!imageBuffer) {
      // Fallback: busca a imagem via HTTP (funciona para URLs externas e para imagens cujo
      // arquivo físico não está no caminho esperado, ex: importadas via menu import)
      const imageUrl = isExternal
        ? media.url
        : `http://localhost:${process.env.PORT || 3000}${media.url.startsWith('/') ? '' : '/'}${media.url}`

      const imgFetchRes = await fetch(imageUrl, { signal: AbortSignal.timeout(30_000) })
      if (!imgFetchRes.ok) {
        return res.status(422).json({ message: `Não foi possível carregar a imagem da URL: ${imageUrl} (HTTP ${imgFetchRes.status})` })
      }
      // Usa o Content-Type real da resposta HTTP para garantir MIME type válido
      const contentType = imgFetchRes.headers.get('content-type') || ''
      const detectedMime = contentType.split(';')[0].trim()
      if (detectedMime.startsWith('image/')) mimeType = detectedMime
      imageBuffer = Buffer.from(await imgFetchRes.arrayBuffer())
    }

    // Normaliza para MIME types suportados pela API
    const VALID_MIMES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
    if (!VALID_MIMES.includes(mimeType)) mimeType = 'image/jpeg'

    const imageBase64 = imageBuffer.toString('base64')

    // 4. Monta prompt de retoque profissional
    // O modelo recebe a imagem original + instruções para melhorar SOMENTE iluminação/qualidade,
    // sem adicionar, remover ou mover nenhum elemento do prato.
    const enhancePrompt =
      `You are a professional food photographer and photo retoucher. ` +
      `Your task is to retouch the provided food photograph to look professionally shot. ` +
      `\n\nABSOLUTE RULES — follow these without exception:\n` +
      `- Keep EVERY ingredient, food item, garnish, sauce, topping, and prop EXACTLY as shown in the original photo\n` +
      `- Do NOT add any new elements: no extra food, no new props, no decorations not present in the original\n` +
      `- Do NOT remove any existing elements from the dish or scene\n` +
      `- Do NOT reposition, rearrange, or replate any food elements — the dish composition must be identical\n` +
      `- Do NOT change the camera angle or field of view beyond minor framing adjustments\n` +
      `\nENHANCE ONLY (these are the ONLY permitted changes):\n` +
      `- Lighting: ${STYLE_PROMPTS[style]}\n` +
      `- Camera angle framing: ${ANGLE_PROMPTS[angle]}\n` +
      `- Color grading: natural appetizing food tones, no oversaturation\n` +
      `- Sharpness and clarity of textures: crispy looks crispy, saucy looks saucy\n` +
      `- Background: clean up distracting elements while keeping the overall setting consistent\n` +
      `\nIMAGE FORMAT: ${RATIO_PROMPTS[safeRatioE]}. The output image MUST be in ${safeRatioE} aspect ratio.\n` +
      `\nThe result must look like this exact same dish retouched by a professional food photographer — not a new dish, not a recreation. ` +
      `Realistic photo, no CGI, no illustration, no watermarks, no text.`

    // 5. Envia a imagem original + prompt de retoque para o modelo de geração
    // O Nano Banana suporta imagem + texto como entrada e retorna imagem retocada
    const imageGenRes = await fetchWithRetry(
      `${GOOGLE_AI_BASE}/models/${IMAGEN_MODEL}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { inlineData: { mimeType, data: imageBase64 } },
              { text: enhancePrompt },
            ],
          }],
          generationConfig: {
            responseModalities: ['IMAGE'],
            imageConfig: { aspectRatio: safeRatioE },
          },
        }),
        signal: AbortSignal.timeout(120_000),
      }
    )

    if (!imageGenRes.ok) {
      const errText = await imageGenRes.text().catch(() => '')
      throw new Error(`Nano Banana error ${imageGenRes.status}: ${errText.slice(0, 300)}`)
    }

    const imageGenData = await imageGenRes.json()
    const imagePart = imageGenData.candidates?.[0]?.content?.parts?.find(p => p.inlineData)
    const b64 = imagePart?.inlineData?.data
    if (!b64) throw new Error('Nano Banana não retornou imagem')

    // 7. Decodifica base64
    const generatedBuffer = Buffer.from(b64, 'base64')

    // 8. Otimiza e salva no disco (WebP para web + HQ JPEG para download)
    const newId = randomUUID()
    const dir = path.join(process.cwd(), 'public', 'uploads', 'media', companyId)
    await fs.promises.mkdir(dir, { recursive: true })

    const { optimized, thumbnail } = await optimizeForWeb(generatedBuffer)
    const hqBuffer = await preserveHighQuality(generatedBuffer)
    await Promise.all([
      fs.promises.writeFile(path.join(dir, `${newId}.webp`), optimized),
      fs.promises.writeFile(path.join(dir, `${newId}_thumb.webp`), thumbnail),
      fs.promises.writeFile(path.join(dir, `${newId}_hq.jpg`), hqBuffer),
    ])
    const newUrl = `/public/uploads/media/${companyId}/${newId}.webp`

    // 9. Cria ou atualiza registro no banco
    const baseName = media.filename.replace(/^ai_studio_[^_]+_[^_]+_/, '')
    const enhancedFilename = `ai_studio_${style}_${angle}_${baseName}`
    let resultMedia

    if (mode === 'replace') {
      try {
        if (!isExternal) {
          const oldFilePath = path.join(process.cwd(), media.url.replace(/^\//, ''))
          if (fs.existsSync(oldFilePath)) await fs.promises.unlink(oldFilePath)
        }
      } catch { /* não-fatal */ }
      resultMedia = await prisma.media.update({
        where: { id: media.id },
        data: { filename: enhancedFilename, mimeType: 'image/webp', size: optimized.length, url: newUrl, aiEnhanced: true },
      })
    } else {
      resultMedia = await prisma.media.create({
        data: { id: newId, companyId, filename: enhancedFilename, mimeType: 'image/webp', size: optimized.length, url: newUrl, aiEnhanced: true },
      })
    }

    // 10. Debita créditos com metadados completos para auditoria
    await debitCredits(companyId, 'AI_STUDIO_ENHANCE', 1, {
      originalMediaId: mediaId,
      resultMediaId: resultMedia.id,
      style,
      angle,
      mode,
    }, userId)

    res.json({ media: resultMedia })
  } catch (e) {
    console.error('[AI Studio] Erro ao aprimorar imagem:', e?.message || e)
    const status = e.statusCode || 500
    res.status(status).json({ message: e?.message || 'Erro interno ao processar imagem com IA' })
  }
})

// POST /ai-studio/generate — gera imagem a partir de descrição de texto (sem imagem base)
router.post('/generate', requireRole('ADMIN'), async (req, res) => {
  const companyId = req.user.companyId
  const userId = req.user.id
  const {
    description, style = 'minimal', angle = 'standard', aspectRatio = '1:1',
    referenceBase64, productBase64, sceneBase64, quantity = 1,
  } = req.body || {}

  const descTrimmed = (description || '').trim()
  const VALID_RATIOS = ['1:1', '16:9', '9:16']
  const safeRatio = VALID_RATIOS.includes(aspectRatio) ? aspectRatio : '1:1'
  // 'reference' = estilo copiado da foto de referência (não tem entrada em STYLE_PROMPTS)
  if (style !== 'reference' && !STYLE_PROMPTS[style]) return res.status(400).json({ message: `Estilo inválido: ${style}` })
  if (!ANGLE_PROMPTS[angle]) return res.status(400).json({ message: `Ângulo inválido: ${angle}` })
  // Estilo usado nas linhas de prompt que dependem de STYLE_PROMPTS (fallback p/ 'minimal')
  const styleForPrompt = STYLE_PROMPTS[style] ? style : 'minimal'
  const qty = Math.max(1, Math.min(3, Math.floor(Number(quantity) || 1)))

  // Imagens opcionais (data URI base64):
  //   productBase64   → foto real do produto: reconhecer ingredientes e manter fidelidade total
  //   referenceBase64 → referência apenas de estilo/iluminação/composição
  //   sceneBase64     → cena/mesa real onde o produto deve ser aplicado
  const VALID_IMG_MIMES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
  const parseDataUri = (b64) => {
    if (!b64 || typeof b64 !== 'string') return null
    const m = b64.match(/^data:(image\/\w+);base64,(.+)$/)
    if (!m) return null
    return { mimeType: VALID_IMG_MIMES.includes(m[1]) ? m[1] : 'image/jpeg', data: m[2] }
  }
  const productImg = parseDataUri(productBase64)
  const referenceImg = parseDataUri(referenceBase64)
  const sceneImg = parseDataUri(sceneBase64)
  const hasImages = !!(productImg || referenceImg || sceneImg)

  if (!hasImages && descTrimmed.length < 5) {
    return res.status(400).json({ message: 'Forneça informações da imagem (mínimo 5 caracteres) ou envie a foto do produto.' })
  }

  try {
    const check = await checkCredits(companyId, 'AI_STUDIO_ENHANCE', qty)
    if (!check.ok) {
      return res.status(402).json({
        message: `Créditos de IA insuficientes. Necessário: ${check.totalCost}, Disponível: ${check.balance}.`,
        balance: check.balance,
        required: check.totalCost,
      })
    }

    const apiKey = await getGoogleAIKey()

    // Imagens enviadas ao modelo de geração: PRODUTO e CENÁRIO vão como imagem (o modelo precisa
    // "ver" o produto a manter fiel e o ambiente alvo). A REFERÊNCIA NÃO é enviada como imagem —
    // extraímos apenas o ESTILO dela em texto (via Vision). Enviar a referência como imagem faria o
    // modelo copiar a comida/composição dela; e, com o produto presente, ele tende a só replicar a foto.
    const imageParts = []
    const legendLines = []
    if (productImg) {
      imageParts.push({ inlineData: productImg })
      legendLines.push(`- Image ${imageParts.length} (PRODUCT): the exact food item to feature. Keep ONLY the food faithful — same ingredients, toppings, textures, colors and proportions; never add, remove, swap or invent ingredients.`)
    }
    if (sceneImg) {
      imageParts.push({ inlineData: sceneImg })
      legendLines.push(`- Image ${imageParts.length} (SCENE): the real environment/table where the product must be placed. Keep this background, surface and setting.`)
    }

    // Extrai o ESTILO fotográfico da referência (iluminação, cor, clima, composição) como texto.
    let refStyleText = ''
    if (referenceImg) {
      const styleRes = await fetchWithRetry(
        `${GOOGLE_AI_BASE}/models/${GEMINI_TEXT_MODEL}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [
                { inlineData: referenceImg },
                {
                  text:
                    `You are a food photography art director. Describe ONLY the PHOTOGRAPHIC STYLE of this image ` +
                    `so it can be reused on a COMPLETELY DIFFERENT dish.\n` +
                    `Cover: lighting (direction, hardness, color temperature), color grading and mood, ` +
                    `background and surface, prop styling, camera angle and depth of field.\n` +
                    `Do NOT describe the specific food, ingredients or dish shown. ` +
                    `Output a single concise comma-separated description in English, nothing else.`,
                },
              ],
            }],
            generationConfig: { maxOutputTokens: 512, temperature: 0.2, thinkingConfig: { thinkingBudget: 0 } },
          }),
          signal: AbortSignal.timeout(30_000),
        },
        { label: 'reference style analysis' }
      )
      if (styleRes.ok) {
        const styleData = await styleRes.json()
        refStyleText = styleData.candidates?.[0]?.content?.parts?.find(p => p.text)?.text?.trim() || ''
        console.log('[AI Studio] generate: reference style:', refStyleText.slice(0, 200))
      } else {
        console.warn('[AI Studio] generate: reference style analysis failed (%s)', styleRes.status)
      }
    }

    // ── Com imagens: re-fotografa o produto numa cena/estilo NOVOS (não copia a foto original) ──
    // ── Sem imagens: geração direta por descrição (prompt fotorrealista consagrado) ──
    let imagenPrompt
    if (hasImages) {
      const lines = []
      lines.push('You are a professional food photographer. Produce a brand-new, professionally styled food photograph.')
      if (legendLines.length) lines.push('INPUT IMAGES:\n' + legendLines.join('\n'))
      if (productImg) {
        lines.push('PRODUCT FIDELITY: keep ONLY the food item itself exactly as in the PRODUCT image — same ingredients, toppings, textures, colors and proportions; never add, remove, swap or invent ingredients.')
        lines.push("IMPORTANT: do NOT reuse the PRODUCT image's original background, surface, props, packaging, framing or lighting — replace them entirely with the new scene/style described below. The final image MUST look clearly different from the original product photo, not a copy of it.")
      } else if (descTrimmed) {
        lines.push(`SUBJECT: ${descTrimmed}.`)
      }
      if (descTrimmed) {
        lines.push(`ADDITIONAL INSTRUCTIONS (follow literally; apply ONLY what is explicitly stated here and do NOT invent ingredients, props, people or elements that are not described here or visible in the input images): ${descTrimmed}.`)
      }
      if (sceneImg) {
        lines.push('TARGET SCENE: place the food naturally into the environment shown in the SCENE image, preserving its background, surface and setting with realistic shadows and contact.')
      }
      if (referenceImg) {
        lines.push(`TARGET STYLE — recreate this photographic style${sceneImg ? ' (lighting, color grading and mood)' : ' for lighting, color grading, mood, background, surface and composition'}: ${refStyleText || 'cinematic high-end food photography with dramatic directional light and rich color grading'}.`)
      }
      if (!sceneImg && !referenceImg) {
        lines.push(`LIGHTING AND SURFACE: ${STYLE_PROMPTS[styleForPrompt]}.`)
        lines.push(`CAMERA: ${ANGLE_PROMPTS[angle]}.`)
      }
      lines.push(`IMAGE FORMAT: ${RATIO_PROMPTS[safeRatio]}. The output image MUST be in ${safeRatio} aspect ratio.`)
      lines.push('REALISM (critical): this must look like a real candid photo, NOT a flawless studio render. Embrace natural imperfections — slightly uneven plating and asymmetry, a few crumbs or sauce smears, natural grease and shine on the food, subtle condensation on cold items, minor irregular edges, real-world surface wear. Food must never look uniform or CGI-perfect.')
      lines.push('Realistic DSLR photograph with authentic textures, natural color rendition and subtle film grain, realistic shadows and highlights, shallow depth of field. Remove any readable text, labels or logos from the product and packaging. Avoid: clay or plastic appearance, waxy or glossy artificial surfaces, over-smoothing, perfect symmetry, CGI, 3D render, illustration, digital art, watermarks, text.')
      imagenPrompt = lines.join('\n\n')
    } else {
      imagenPrompt =
        `A real food photograph taken with a Canon EOS R5 DSLR, 100mm f/2.8 macro lens. ` +
        `Subject: ${descTrimmed}. ` +
        `Setting: ${STYLE_PROMPTS[styleForPrompt]}. ` +
        `Composition: ${ANGLE_PROMPTS[angle]}. ` +
        `Authentic natural food textures, realistic surface imperfections, genuine color rendition. ` +
        `Natural imperfections: food must never look uniform or CGI-perfect. ` +
        `If legumes or beans are present: vary size, color, and show some split or broken pieces. ` +
        `If broth or liquid is present: cloudy with natural fat pools on surface. ` +
        `If rice or grains: clump slightly, vary in opacity. ` +
        `This must look like an actual photograph, not digital art, not CGI, not 3D rendering, not illustration. ` +
        `\nIMAGE FORMAT: ${RATIO_PROMPTS[safeRatio]}. The output image MUST be in ${safeRatio} aspect ratio.\n` +
        `Avoid: clay or plastic appearance, artificial smoothness, fake gloss, cartoon style, neon colors, watermarks, text`
    }

    // Gera N imagens em paralelo (quantity), persistindo cada uma na biblioteca
    const dir = path.join(process.cwd(), 'public', 'uploads', 'media', companyId)
    await fs.promises.mkdir(dir, { recursive: true })
    const slug = (descTrimmed || (productImg ? 'produto' : 'imagem')).slice(0, 40).replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '_').toLowerCase()

    const genOne = async (index) => {
      const variationNote = qty > 1
        ? `\n\nVARIATION ${index + 1} of ${qty}: use a noticeably different camera angle, composition and prop arrangement from the other variations, while keeping the same product and the same overall style.`
        : ''
      const imageGenRes = await fetchWithRetry(
        `${GOOGLE_AI_BASE}/models/${IMAGEN_MODEL}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [...imageParts, { text: imagenPrompt + variationNote }] }],
            generationConfig: {
              responseModalities: ['IMAGE'],
              imageConfig: { aspectRatio: safeRatio },
            },
          }),
          signal: AbortSignal.timeout(120_000),
        },
        { label: `generate image ${index + 1}` }
      )

      if (!imageGenRes.ok) {
        const errText = await imageGenRes.text().catch(() => '')
        throw new Error(`Nano Banana error (image ${index + 1}) ${imageGenRes.status}: ${errText.slice(0, 300)}`)
      }

      const imageGenData = await imageGenRes.json()
      const imagePart = imageGenData.candidates?.[0]?.content?.parts?.find(p => p.inlineData)
      const b64 = imagePart?.inlineData?.data
      if (!b64) throw new Error(`Nano Banana não retornou imagem (image ${index + 1})`)

      const generatedBuffer = Buffer.from(b64, 'base64')
      const newId = randomUUID()
      const { optimized, thumbnail } = await optimizeForWeb(generatedBuffer)
      const hqBuffer = await preserveHighQuality(generatedBuffer)
      await Promise.all([
        fs.promises.writeFile(path.join(dir, `${newId}.webp`), optimized),
        fs.promises.writeFile(path.join(dir, `${newId}_thumb.webp`), thumbnail),
        fs.promises.writeFile(path.join(dir, `${newId}_hq.jpg`), hqBuffer),
      ])
      const newUrl = `/public/uploads/media/${companyId}/${newId}.webp`
      const filename = `ai_gen_${style}_${angle}_${slug || newId.slice(0, 8)}_${index + 1}.webp`

      return prisma.media.create({
        data: { id: newId, companyId, filename, mimeType: 'image/webp', size: optimized.length, url: newUrl, aiEnhanced: true },
      })
    }

    const settled = await Promise.allSettled(Array.from({ length: qty }, (_, i) => genOne(i)))
    const mediaResults = settled.filter(r => r.status === 'fulfilled').map(r => r.value)
    const failures = settled.filter(r => r.status === 'rejected')

    if (mediaResults.length === 0) {
      throw new Error(failures[0]?.reason?.message || 'Falha ao gerar imagem')
    }
    if (failures.length > 0) {
      console.warn('[AI Studio] generate: %d/%d images failed', failures.length, qty)
    }

    await debitCredits(companyId, 'AI_STUDIO_ENHANCE', mediaResults.length, {
      type: 'generate_from_description',
      description: descTrimmed.slice(0, 200),
      style,
      angle,
      quantityRequested: qty,
      quantityGenerated: mediaResults.length,
      usedProduct: !!productImg,
      usedReference: !!referenceImg,
      usedScene: !!sceneImg,
      resultMediaIds: mediaResults.map(m => m.id),
    }, userId)

    res.json({ media: mediaResults, partial: failures.length > 0 })
  } catch (e) {
    console.error('[AI Studio] Erro ao gerar imagem por descrição:', e?.message || e)
    const status = e.statusCode || 500
    res.status(status).json({ message: e?.message || 'Erro interno ao gerar imagem com IA' })
  }
})

// POST /ai-studio/apply-replace — substitui a mídia original pela versão gerada no preview
// NÃO re-executa IA nem debita créditos: apenas troca arquivo/registro no banco.
router.post('/apply-replace', requireRole('ADMIN'), async (req, res) => {
  const companyId = req.user.companyId
  const { originalMediaId, resultMediaId } = req.body || {}

  if (!originalMediaId || !resultMediaId) {
    return res.status(400).json({ message: 'originalMediaId e resultMediaId são obrigatórios' })
  }

  try {
    const [originalMedia, resultMedia] = await Promise.all([
      prisma.media.findFirst({ where: { id: originalMediaId, companyId } }),
      prisma.media.findFirst({ where: { id: resultMediaId, companyId } }),
    ])

    if (!originalMedia) return res.status(404).json({ message: 'Imagem original não encontrada' })
    if (!resultMedia)   return res.status(404).json({ message: 'Imagem gerada não encontrada' })

    // 1. Remove arquivo físico da imagem original (se local)
    const isExternal = /^https?:\/\//i.test(originalMedia.url)
    if (!isExternal) {
      try {
        const oldFilePath = path.join(process.cwd(), originalMedia.url.replace(/^\//, ''))
        if (fs.existsSync(oldFilePath)) await fs.promises.unlink(oldFilePath)
      } catch { /* não-fatal — arquivo pode já não existir */ }
    }

    // 2. Atualiza o registro original para apontar para o novo arquivo
    const updated = await prisma.media.update({
      where: { id: originalMedia.id },
      data: {
        url:        resultMedia.url,
        filename:   resultMedia.filename,
        mimeType:   resultMedia.mimeType,
        size:       resultMedia.size,
        aiEnhanced: true,
      },
    })

    // 3. Remove o registro temporário da preview (criado durante generate())
    try {
      await prisma.media.delete({ where: { id: resultMedia.id } })
    } catch { /* não-fatal — pode haver FK em outro lugar */ }

    res.json({ media: updated })
  } catch (e) {
    console.error('[AI Studio] Erro ao aplicar replace:', e?.message || e)
    res.status(500).json({ message: e?.message || 'Erro ao substituir imagem' })
  }
})

// POST /ai-studio/generate-description — gera descrição concisa de produto usando foto + título
// Custo: GENERATE_DESCRIPTION (2 créditos). Habilitado quando o produto tem nome + imagem.
router.post('/generate-description', requireRole('ADMIN'), async (req, res) => {
  const companyId = req.user.companyId
  const userId = req.user.id
  const { name, imageUrl } = req.body || {}

  if (!name?.trim()) return res.status(400).json({ message: 'name é obrigatório' })
  if (!imageUrl?.trim()) return res.status(400).json({ message: 'imageUrl é obrigatório' })

  try {
    const check = await checkCredits(companyId, 'GENERATE_DESCRIPTION', 1)
    if (!check.ok) {
      return res.status(402).json({
        message: `Créditos insuficientes. Necessário: ${check.totalCost}, Disponível: ${check.balance}.`,
        balance: check.balance,
        required: check.totalCost,
      })
    }

    // Carrega a imagem do produto (disco ou URL externa)
    let imageBuffer
    let mimeType = 'image/jpeg'
    const isExternal = /^https?:\/\//i.test(imageUrl)

    if (!isExternal) {
      const filePath = path.join(process.cwd(), imageUrl.replace(/^\//, ''))
      if (fs.existsSync(filePath)) imageBuffer = await fs.promises.readFile(filePath)
    }

    if (!imageBuffer) {
      const fetchUrl = isExternal
        ? imageUrl
        : `http://localhost:${process.env.PORT || 3000}${imageUrl.startsWith('/') ? '' : '/'}${imageUrl}`
      const imgRes = await fetch(fetchUrl, { signal: AbortSignal.timeout(30_000) })
      if (!imgRes.ok) return res.status(422).json({ message: `Imagem inacessível: HTTP ${imgRes.status}` })
      const ct = imgRes.headers.get('content-type') || ''
      const detected = ct.split(';')[0].trim()
      if (detected.startsWith('image/')) mimeType = detected
      imageBuffer = Buffer.from(await imgRes.arrayBuffer())
    }

    const VALID_MIMES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
    if (!VALID_MIMES.includes(mimeType)) mimeType = 'image/jpeg'

    const imageBase64 = imageBuffer.toString('base64')

    const textPrompt =
      `You are writing a short menu description for a Brazilian food delivery app.\n` +
      `Product name: "${name.trim()}"\n\n` +
      `Look at this food photo and write a concise description listing the main ingredients and cooking method visible.\n\n` +
      `RULES:\n` +
      `- Write in Portuguese (Brazil)\n` +
      `- Maximum 120 characters\n` +
      `- List ingredients and cooking method separated by commas\n` +
      `- No marketing language, no emojis, no exclamation marks\n` +
      `- No phrases like "Aproveite!", "Delicioso", "Peça agora", "Experimente"\n` +
      `- Start directly with the ingredients/description, no introduction\n` +
      `- Capitalize only the first word\n\n` +
      `GOOD examples:\n` +
      `"Iscas de frango grelhadas, arroz integral com cenoura picada e legumes (cenoura, brócolis e vagem)"\n` +
      `"Filé de frango grelhado, batata frita crocante e salada de alface com tomate"\n` +
      `"Macarrão ao molho bolonhesa com carne moída temperada e queijo parmesão ralado"\n\n` +
      `BAD examples (do NOT write like this):\n` +
      `"Aproveite nosso Completão! Filé suculento com cebolas na chapa, batatas fritas... Peça agora!"\n\n` +
      `Output ONLY the description text, nothing else.`

    const { text: description, tokenUsage } = await callVisionAI('GENERATE_DESCRIPTION', null, textPrompt, imageBase64, mimeType, { temperature: 0.2, maxTokens: 400, timeoutMs: 30_000 })
    if (!description) throw new Error('Modelo não retornou descrição')

    await debitCredits(companyId, 'GENERATE_DESCRIPTION', 1, {
      productName: name.trim().slice(0, 100),
      imageUrl: imageUrl.slice(0, 200),
      tokenUsage,
    }, userId)

    res.json({ description })
  } catch (e) {
    console.error('[AI Studio] Erro ao gerar descrição:', e?.message || e)
    const status = e.statusCode || 500
    res.status(status).json({ message: e?.message || 'Erro interno ao gerar descrição' })
  }
})

// POST /ai-studio/generate-pack — gera N fotos de redes sociais a partir de uma foto real do produto
// Pipeline: Vision (analisa) → Gemini Flash (cenas) → Imagen (N imagens paralelas)
// Custo: quantity * 10 créditos
router.post('/generate-pack', requireRole('ADMIN'), async (req, res) => {
  const companyId = req.user.companyId
  const userId = req.user.id
  const { photoBase64, quantity = 3, aspectRatio = '1:1' } = req.body || {}
  const { themeId = null, menuId = null } = req.body || {}

  // ── Validação ──
  if (!photoBase64 || typeof photoBase64 !== 'string') {
    return res.status(400).json({ message: 'photoBase64 é obrigatório' })
  }
  const qty = Math.max(1, Math.min(3, Math.floor(Number(quantity) || 3)))
  const VALID_RATIOS = ['1:1', '16:9', '9:16']
  const safeRatio = VALID_RATIOS.includes(aspectRatio) ? aspectRatio : '1:1'

  // Limite de tamanho (~5 MB decodificado ≈ ~6.7 MB em base64)
  if (photoBase64.length > 7_500_000) {
    return res.status(400).json({ message: 'Imagem muito grande. Máximo: 5 MB.' })
  }

  // Decodifica data URI
  const dataUriMatch = photoBase64.match(/^data:(image\/\w+);base64,(.+)$/)
  if (!dataUriMatch) {
    return res.status(400).json({ message: 'photoBase64 deve ser um data URI válido (data:image/...;base64,...)' })
  }
  const photoMime = dataUriMatch[1]
  const photoB64 = dataUriMatch[2]

  const VALID_MIMES = ['image/jpeg', 'image/png', 'image/webp']
  const safeMime = VALID_MIMES.includes(photoMime) ? photoMime : 'image/jpeg'

  try {
    // 1. Verifica créditos (qty unidades × custo unitário definido em aiCreditManager)
    const check = await checkCredits(companyId, 'AI_STUDIO_ENHANCE', qty)
    if (!check.ok) {
      return res.status(402).json({
        message: `Créditos de IA insuficientes. Necessário: ${check.totalCost}, Disponível: ${check.balance}.`,
        balance: check.balance,
        required: check.totalCost,
      })
    }

    const apiKey = await getGoogleAIKey()

    // 2. Gemini Vision — analisa a foto e retorna JSON com productDescription, cuisineType, productName
    console.log('[AI Studio] generate-pack: analyzing product photo via Vision...')
    const visionRes = await fetchWithRetry(
      `${GOOGLE_AI_BASE}/models/${GEMINI_TEXT_MODEL}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { inlineData: { mimeType: safeMime, data: photoB64 } },
              {
                text:
                  `Analyze this food photo. Return ONLY a JSON object:\n` +
                  `{"productDescription":"brief description in English, max 30 words, main ingredients and type","cuisineType":"restaurant segment in Portuguese (e.g. hamburgueria, pizzaria, açaiteria, lanchonete)","productName":"short name in Portuguese, max 4 words"}\n` +
                  `Keep productDescription SHORT. Only describe what you see. Output valid JSON only, no markdown.`,
              },
            ],
          }],
          generationConfig: {
            maxOutputTokens: 2048,
            temperature: 0.1,
            thinkingConfig: { thinkingBudget: 0 },
            responseMimeType: 'application/json',
            responseSchema: {
              type: 'OBJECT',
              properties: {
                productDescription: { type: 'STRING', description: 'Brief food description in English, max 30 words' },
                cuisineType: { type: 'STRING', description: 'Restaurant segment in Portuguese (e.g. hamburgueria, pizzaria, açaiteria)' },
                productName: { type: 'STRING', description: 'Short product name in Portuguese, max 4 words' },
              },
              required: ['productDescription', 'cuisineType', 'productName'],
            },
          },
        }),
        signal: AbortSignal.timeout(30_000),
      }
    )

    if (!visionRes.ok) {
      const errText = await visionRes.text().catch(() => '')
      throw new Error(`Vision analysis error ${visionRes.status}: ${errText.slice(0, 300)}`)
    }

    const visionData = await visionRes.json()
    console.log('[AI Studio] generate-pack: visionRes finishReason:', visionData.candidates?.[0]?.finishReason)
    console.log('[AI Studio] generate-pack: visionRes tokenCount:', JSON.stringify(visionData.usageMetadata || {}))
    const visionText = visionData.candidates?.[0]?.content?.parts?.find(p => p.text)?.text?.trim() || ''
    console.log('[AI Studio] generate-pack: raw visionText (%d chars):', visionText.length, visionText)
    if (!visionText) throw new Error('Gemini Vision não retornou análise do produto')

    let analysis
    try {
      const cleanJson = visionText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
      analysis = JSON.parse(cleanJson)
    } catch {
      throw new Error(`Falha ao parsear JSON da análise (finishReason: ${visionData.candidates?.[0]?.finishReason}, chars: ${visionText.length}): ${visionText.slice(0, 300)}`)
    }

    const { productDescription, cuisineType, productName } = analysis
    if (!productDescription || !cuisineType) {
      throw new Error('Análise incompleta: productDescription e cuisineType são obrigatórios')
    }

    console.log('[AI Studio] generate-pack: product="%s", cuisine="%s"', productName, cuisineType)

    // Carrega tema (se houver) e lições aprendidas
    const [themesAll, companyRec] = await Promise.all([
      prisma.brandVisualTheme.findMany({ where: { companyId, isActive: true } }),
      prisma.company.findUnique({ where: { id: companyId }, select: { aiLessonsCache: true } }),
    ])
    const theme = resolveTheme(themesAll, themeId, menuId)
    const lessonsText = companyRec?.aiLessonsCache?.text || ''
    const themeBlock = buildThemeBlock(theme)
    const lessonsBlock = buildLessonsBlock(lessonsText)
    if (theme) console.log('[AI Studio] generate-pack: applying theme "%s"', theme.name)
    if (lessonsText) console.log('[AI Studio] generate-pack: applying %d chars of lessons', lessonsText.length)

    // 3. Gemini Flash text — gera N descrições de cena coerentes com o segmento
    console.log('[AI Studio] generate-pack: generating %d scene descriptions...', qty)
    const sceneRes = await fetchWithRetry(
      `${GOOGLE_AI_BASE}/models/${GEMINI_TEXT_MODEL}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text:
                `Generate ${qty} SHORT and VARIED social media photo concepts for "${cuisineType}" — "${productName}".\n\n` +
                `CONTEXT:\n- Product: ${productName}\n- Cuisine type: ${cuisineType}\n- Product details: ${productDescription.slice(0, 300)}\n\n` +
                (themeBlock ? themeBlock + '\n\n' : '') +
                (lessonsBlock ? lessonsBlock + '\n\n' : '') +
                `Generate exactly ${qty} different scene/setting descriptions.\n` +
                `Each concept must be VERY DIFFERENT from the others. Mix these categories:\n` +
                `- Classic product shot (different surface/lighting/props)\n` +
                `- Human interaction (hand holding the food, person about to bite, hand dipping sauce)\n` +
                `- Lifestyle/context (food on a table with drinks, outdoor setting, delivery box being opened)\n` +
                `- Detail/close-up (extreme close-up of texture, cross-section showing layers)\n` +
                `- Action/motion (cheese pull, sauce drizzle, steam rising)\n\n` +
                `Rules:\n` +
                `- MAX 25 words each. Describe the scene concept briefly.\n` +
                `- Coherent with "${cuisineType}" segment.\n` +
                `- At least 2 concepts MUST include human elements (hands, person).\n` +
                `- English only.\n\n` +
                `Example: ["hand holding burger at eye level, blurred pub background, warm light", "overhead flat-lay on dark wood, fries and beer beside, dramatic shadows", "close-up cheese pull, melted cheddar stretching, dark moody background"]\n\n` +
                `Output ONLY a JSON array of ${qty} strings. No markdown.`,
            }],
          }],
          generationConfig: {
            maxOutputTokens: 8000,
            temperature: 0.8,
            responseMimeType: 'application/json',
            responseSchema: {
              type: 'ARRAY',
              items: { type: 'STRING' },
            },
          },
        }),
        signal: AbortSignal.timeout(30_000),
      }
    )

    if (!sceneRes.ok) {
      const errText = await sceneRes.text().catch(() => '')
      throw new Error(`Scene generation error ${sceneRes.status}: ${errText.slice(0, 300)}`)
    }

    const sceneData = await sceneRes.json()
    console.log('[AI Studio] generate-pack: sceneRes finishReason:', sceneData.candidates?.[0]?.finishReason)
    console.log('[AI Studio] generate-pack: sceneRes tokenCount:', JSON.stringify(sceneData.usageMetadata || {}))
    const sceneText = sceneData.candidates?.[0]?.content?.parts?.find(p => p.text)?.text?.trim() || ''
    console.log('[AI Studio] generate-pack: raw sceneText (%d chars):', sceneText.length, sceneText.slice(0, 300))
    if (!sceneText) throw new Error('Gemini não retornou descrições de cena')

    let scenes
    try {
      const cleanJson = sceneText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
      scenes = JSON.parse(cleanJson)
    } catch {
      throw new Error(`Falha ao parsear JSON das cenas (finishReason: ${sceneData.candidates?.[0]?.finishReason}, chars: ${sceneText.length}): ${sceneText.slice(0, 300)}`)
    }

    if (!Array.isArray(scenes) || scenes.length === 0) {
      throw new Error('Nenhuma descrição de cena gerada')
    }
    // Garante que temos exatamente qty cenas (trunca ou repete a última se necessário)
    while (scenes.length < qty) scenes.push(scenes[scenes.length - 1])
    if (scenes.length > qty) scenes.length = qty

    console.log('[AI Studio] generate-pack: generating %d images in parallel...', qty)

    // 4. Imagen — N chamadas paralelas
    const dir = path.join(process.cwd(), 'public', 'uploads', 'media', companyId)
    await fs.promises.mkdir(dir, { recursive: true })
    const slug = (productName || 'pack').slice(0, 30).replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '_').toLowerCase()

    const imagePromises = scenes.map(async (scene, index) => {
      const brandStyleBlock = theme
        ? `\nBRAND STYLE (apply to background, surface, lighting, props — NOT the food):\n` +
          [theme.palette && `- Palette: ${theme.palette}`,
           theme.mood && `- Mood: ${theme.mood}`,
           theme.lighting && `- Lighting: ${theme.lighting}`,
           theme.surface && `- Surface: ${theme.surface}`,
           theme.props && `- Props: ${theme.props}`].filter(Boolean).join('\n')
        : ''

      const imagenPrompt =
        `You are a professional food photographer creating social media content.\n` +
        `The attached photo shows the EXACT product to feature. Keep this product visually faithful — same ingredients, same textures, same colors.\n\n` +
        `SCENE CONCEPT: ${scene}\n` +
        brandStyleBlock +
        `\nIMAGE FORMAT: ${RATIO_PROMPTS[safeRatio]}. The output image MUST be in ${safeRatio} aspect ratio.\n` +
        `\nRULES:\n` +
        `- The food/product must look IDENTICAL to the attached photo — do not add, remove, or change any ingredient\n` +
        `- Apply ONLY the scene concept described above (background, lighting, props, human interaction)\n` +
        `- REMOVE any visible text, labels, logos, or brand names from the product and packaging — the result must have NO readable text anywhere\n` +
        `- REALISM (critical): a real candid photo, NOT a flawless studio render. Embrace natural imperfections — slightly uneven plating, a few crumbs or sauce smears, natural grease and shine, subtle condensation on cold items, minor irregular edges. Food must never look uniform or CGI-perfect\n` +
        `- Realistic DSLR photograph with authentic textures, natural color and subtle film grain, realistic shadows. Avoid: clay or plastic appearance, waxy artificial gloss, over-smoothing, perfect symmetry, CGI, 3D render, illustration, watermarks, text`

      const imageGenRes = await fetchWithRetry(
        `${GOOGLE_AI_BASE}/models/${IMAGEN_MODEL}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [
                { inlineData: { mimeType: safeMime, data: photoB64 } },
                { text: imagenPrompt },
              ],
            }],
            generationConfig: {
              responseModalities: ['IMAGE'],
              imageConfig: { aspectRatio: safeRatio },
            },
          }),
          signal: AbortSignal.timeout(120_000),
        }
      )

      if (!imageGenRes.ok) {
        const errText = await imageGenRes.text().catch(() => '')
        throw new Error(`Imagen error (image ${index + 1}) ${imageGenRes.status}: ${errText.slice(0, 300)}`)
      }

      const imageGenData = await imageGenRes.json()
      const imagePart = imageGenData.candidates?.[0]?.content?.parts?.find(p => p.inlineData)
      const b64 = imagePart?.inlineData?.data
      if (!b64) throw new Error(`Imagen não retornou imagem (image ${index + 1})`)

      const generatedBuffer = Buffer.from(b64, 'base64')

      const newId = randomUUID()
      const { optimized, thumbnail } = await optimizeForWeb(generatedBuffer)
      const hqBuffer = await preserveHighQuality(generatedBuffer)
      await Promise.all([
        fs.promises.writeFile(path.join(dir, `${newId}.webp`), optimized),
        fs.promises.writeFile(path.join(dir, `${newId}_thumb.webp`), thumbnail),
        fs.promises.writeFile(path.join(dir, `${newId}_hq.jpg`), hqBuffer),
      ])
      const newUrl = `/public/uploads/media/${companyId}/${newId}.webp`
      const filename = `ai_pack_${slug}_${index + 1}.webp`

      const mediaRecord = await prisma.media.create({
        data: {
          id: newId,
          companyId,
          filename,
          mimeType: 'image/webp',
          size: optimized.length,
          url: newUrl,
          aiEnhanced: true,
          aiThemeId: theme?.id || null,
          aiPromptSnapshot: {
            scene,
            themeSnapshot: theme ? {
              name: theme.name,
              palette: theme.palette || null,
              mood: theme.mood || null,
              props: theme.props || null,
              surface: theme.surface || null,
              lighting: theme.lighting || null,
            } : null,
            lessonsApplied: lessonsText || null,
            imagenPrompt: imagenPrompt.slice(0, 2000),
          },
        },
      })

      return mediaRecord
    })

    const settled = await Promise.allSettled(imagePromises)
    const mediaResults = settled.filter(r => r.status === 'fulfilled').map(r => r.value)
    const failures = settled.filter(r => r.status === 'rejected')

    if (mediaResults.length === 0) {
      const firstErr = failures[0]?.reason?.message || 'Todas as imagens falharam'
      throw new Error(firstErr)
    }

    if (failures.length > 0) {
      console.warn('[AI Studio] generate-pack: %d/%d images failed', failures.length, qty)
    }

    // 5. Debita créditos apenas pelas imagens geradas com sucesso
    const successCount = mediaResults.length
    await debitCredits(companyId, 'AI_STUDIO_ENHANCE', successCount, {
      type: 'generate_pack',
      quantityRequested: qty,
      quantityGenerated: successCount,
      productName: (productName || '').slice(0, 100),
      cuisineType: (cuisineType || '').slice(0, 100),
      aspectRatio: safeRatio,
      resultMediaIds: mediaResults.map(m => m.id),
    }, userId)

    console.log('[AI Studio] generate-pack: completed %d/%d images for company %s', successCount, qty, companyId)

    res.json({
      media: mediaResults,
      analysis: { productName: productName || '', cuisineType: cuisineType || '' },
      partial: failures.length > 0,
    })
  } catch (e) {
    console.error('[AI Studio] Erro ao gerar pack de imagens:', e?.message || e)
    const status = e.statusCode || 500
    res.status(status).json({ message: e?.message || 'Erro interno ao gerar pack de imagens com IA' })
  }
})

router.post('/lessons/refresh', requireRole('ADMIN'), async (req, res) => {
  const companyId = req.user.companyId

  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
  const feedbacks = await prisma.mediaFeedback.findMany({
    where: { media: { companyId }, createdAt: { gte: since } },
    orderBy: { createdAt: 'desc' },
    take: 30,
    include: { media: { select: { aiPromptSnapshot: true } } },
  })

  if (feedbacks.length === 0) {
    return res.status(400).json({ message: 'Sem feedback nos últimos 90 dias. Dê feedback nas imagens primeiro.' })
  }

  // Agrupa por reason
  const groups = {}
  for (const f of feedbacks) {
    const key = f.reason
    if (!groups[key]) groups[key] = []
    const scene = f.media?.aiPromptSnapshot?.scene || '(sem contexto)'
    groups[key].push({ scene, note: f.note || '' })
  }

  const sections = Object.entries(groups).map(([reason, items]) => {
    const lines = items.slice(0, 10).map(it => `- "${String(it.scene).slice(0, 120)}"${it.note ? ` — note: "${String(it.note).slice(0, 120)}"` : ''}`)
    return `${reason} (count: ${items.length}):\n${lines.join('\n')}`
  }).join('\n\n')

  const prompt =
    `You are auditing AI-generated food photos for a Brazilian restaurant.\n` +
    `Below are pieces of feedback from operators about images.\n\n` +
    `FEEDBACK (last 90 days):\n${sections}\n\n` +
    `TASK: Summarize the patterns into actionable lessons for the next image generation.\n` +
    `Max 5 bullet points, each under 25 words. Mix avoid (based on negative reasons) and prefer (based on LIKED).\n` +
    `Be specific. No platitudes. Output plain text, one lesson per line, no markdown.`

  try {
    const apiKey = await getGoogleAIKey()
    const r = await fetch(
      `${GOOGLE_AI_BASE}/models/${GEMINI_TEXT_MODEL}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            maxOutputTokens: 400,
            temperature: 0.4,
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
        signal: AbortSignal.timeout(20_000),
      }
    )
    if (!r.ok) {
      const errText = await r.text().catch(() => '')
      throw new Error(`Gemini Flash error ${r.status}: ${errText.slice(0, 200)}`)
    }
    const data = await r.json()
    const text = data.candidates?.[0]?.content?.parts?.find(p => p.text)?.text?.trim()
    if (!text) throw new Error('Resumo vazio da IA')

    const cache = {
      text,
      updatedAt: new Date().toISOString(),
      feedbacksConsidered: feedbacks.length,
    }
    await prisma.company.update({ where: { id: companyId }, data: { aiLessonsCache: cache } })
    res.json(cache)
  } catch (e) {
    console.error('[AI Studio] lessons/refresh failed:', e?.message || e)
    res.status(500).json({ message: e?.message || 'Falha ao atualizar lições' })
  }
})

router.get('/lessons', requireRole('ADMIN'), async (req, res) => {
  const companyId = req.user.companyId
  const c = await prisma.company.findUnique({ where: { id: companyId }, select: { aiLessonsCache: true } })
  res.json(c?.aiLessonsCache || null)
})

export default router
