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
import path from 'path'
import fs from 'fs'
import { randomUUID } from 'crypto'

const router = Router()
router.use(authMiddleware)
router.use(requireModuleStrict('CARDAPIO_SIMPLES'))

// Google AI Studio — endpoints REST (sem SDK)
const GOOGLE_AI_BASE   = 'https://generativelanguage.googleapis.com/v1beta'
const GEMINI_TEXT_MODEL = 'gemini-2.5-flash'       // visão + texto (descrições, análise)
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

// Prompts de ângulo de câmera
const ANGLE_PROMPTS = {
  top:      'camera positioned directly overhead at 90 degrees, perfectly parallel to the surface, symmetrical flat-lay composition',
  standard: 'camera elevated at 45-degree angle showing front and top of the dish, natural food photography perspective with visible depth',
  hero:     'camera at plate level (0-degree eye-level angle), emphasizing height and layering of the food with natural depth-of-field blur in foreground',
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
  const { mediaId, style = 'minimal', angle = 'standard', mode = 'new' } = req.body || {}

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
      `\nThe result must look like this exact same dish retouched by a professional food photographer — not a new dish, not a recreation. ` +
      `Realistic photo, no CGI, no illustration, no watermarks, no text.`

    // 5. Envia a imagem original + prompt de retoque para o modelo de geração
    // O Nano Banana suporta imagem + texto como entrada e retorna imagem retocada
    const imageGenRes = await fetch(
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
          generationConfig: { responseModalities: ['IMAGE'] },
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

    // 8. Salva no disco
    const generatedMime = imagePart?.inlineData?.mimeType || 'image/png'
    const generatedExt  = generatedMime === 'image/png' ? 'png' : 'jpg'
    const newId = randomUUID()
    const safeName = `${newId}.${generatedExt}`
    const dir = path.join(process.cwd(), 'public', 'uploads', 'media', companyId)
    await fs.promises.mkdir(dir, { recursive: true })
    await fs.promises.writeFile(path.join(dir, safeName), generatedBuffer)
    const newUrl = `/public/uploads/media/${companyId}/${safeName}`

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
        data: { filename: enhancedFilename, mimeType: generatedMime, size: generatedBuffer.length, url: newUrl, aiEnhanced: true },
      })
    } else {
      resultMedia = await prisma.media.create({
        data: { id: newId, companyId, filename: enhancedFilename, mimeType: generatedMime, size: generatedBuffer.length, url: newUrl, aiEnhanced: true },
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
  const { description, style = 'minimal', angle = 'standard' } = req.body || {}

  const descTrimmed = (description || '').trim()
  if (descTrimmed.length < 5) return res.status(400).json({ message: 'Descrição do produto é obrigatória (mínimo 5 caracteres)' })
  if (!STYLE_PROMPTS[style]) return res.status(400).json({ message: `Estilo inválido: ${style}` })
  if (!ANGLE_PROMPTS[angle]) return res.status(400).json({ message: `Ângulo inválido: ${angle}` })

  try {
    const check = await checkCredits(companyId, 'AI_STUDIO_ENHANCE', 1)
    if (!check.ok) {
      return res.status(402).json({
        message: `Créditos de IA insuficientes. Necessário: ${check.totalCost}, Disponível: ${check.balance}.`,
        balance: check.balance,
        required: check.totalCost,
      })
    }

    const apiKey = await getGoogleAIKey()

    // Monta o prompt para Imagen 3 a partir da descrição do usuário
    const imagenPrompt =
      `A real food photograph taken with a Canon EOS R5 DSLR, 100mm f/2.8 macro lens. ` +
      `Subject: ${descTrimmed}. ` +
      `Setting: ${STYLE_PROMPTS[style]}. ` +
      `Composition: ${ANGLE_PROMPTS[angle]}. ` +
      `Authentic natural food textures, realistic surface imperfections, genuine color rendition. ` +
      `Natural imperfections: food must never look uniform or CGI-perfect. ` +
      `If legumes or beans are present: vary size, color, and show some split or broken pieces. ` +
      `If broth or liquid is present: cloudy with natural fat pools on surface. ` +
      `If rice or grains: clump slightly, vary in opacity. ` +
      `This must look like an actual photograph, not digital art, not CGI, not 3D rendering, not illustration. ` +
      `Avoid: clay or plastic appearance, artificial smoothness, fake gloss, cartoon style, neon colors, watermarks, text`

    const imageGenRes = await fetch(
      `${GOOGLE_AI_BASE}/models/${IMAGEN_MODEL}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: imagenPrompt }] }],
          generationConfig: { responseModalities: ['IMAGE'] },
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

    const generatedBuffer = Buffer.from(b64, 'base64')
    const generatedMime = imagePart?.inlineData?.mimeType || 'image/png'
    const generatedExt  = generatedMime === 'image/png' ? 'png' : 'jpg'

    const newId = randomUUID()
    const safeName = `${newId}.${generatedExt}`
    const dir = path.join(process.cwd(), 'public', 'uploads', 'media', companyId)
    await fs.promises.mkdir(dir, { recursive: true })
    await fs.promises.writeFile(path.join(dir, safeName), generatedBuffer)
    const newUrl = `/public/uploads/media/${companyId}/${safeName}`

    const slug = descTrimmed.slice(0, 40).replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '_').toLowerCase()
    const filename = `ai_gen_${style}_${angle}_${slug || newId.slice(0, 8)}.${generatedExt}`

    const resultMedia = await prisma.media.create({
      data: { id: newId, companyId, filename, mimeType: generatedMime, size: generatedBuffer.length, url: newUrl, aiEnhanced: true },
    })

    await debitCredits(companyId, 'AI_STUDIO_ENHANCE', 1, {
      type: 'generate_from_description',
      description: descTrimmed.slice(0, 200),
      style,
      angle,
      resultMediaId: resultMedia.id,
    }, userId)

    res.json({ media: resultMedia })
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

    const apiKey = await getGoogleAIKey()

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

    // Chama Gemini Flash Vision para gerar descrição concisa dos ingredientes
    const visionRes = await fetch(
      `${GOOGLE_AI_BASE}/models/${GEMINI_TEXT_MODEL}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { inlineData: { mimeType, data: imageBase64 } },
              {
                text:
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
                  `Output ONLY the description text, nothing else.`,
              },
            ],
          }],
          generationConfig: { maxOutputTokens: 400, temperature: 0.2 },
          thinkingConfig: { thinkingBudget: 0 },
        }),
        signal: AbortSignal.timeout(30_000),
      }
    )

    if (!visionRes.ok) {
      const errText = await visionRes.text().catch(() => '')
      throw new Error(`Gemini Vision error ${visionRes.status}: ${errText.slice(0, 200)}`)
    }

    const visionData = await visionRes.json()
    const parts = visionData.candidates?.[0]?.content?.parts || []
    const description = parts.find(p => p.text)?.text?.trim() || ''
    if (!description) throw new Error('Modelo não retornou descrição')

    await debitCredits(companyId, 'GENERATE_DESCRIPTION', 1, {
      productName: name.trim().slice(0, 100),
      imageUrl: imageUrl.slice(0, 200),
    }, userId)

    res.json({ description })
  } catch (e) {
    console.error('[AI Studio] Erro ao gerar descrição:', e?.message || e)
    const status = e.statusCode || 500
    res.status(status).json({ message: e?.message || 'Erro interno ao gerar descrição' })
  }
})

export default router
