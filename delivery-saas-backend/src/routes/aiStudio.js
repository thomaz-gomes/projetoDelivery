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
 *   3. Usa GPT-4o Vision para descrever o alimento em detalhe
 *   4. Monta prompt gastronômico profissional para DALL-E 3
 *   5. Gera nova imagem via gpt-image-1 (1024x1024 high quality)
 *   6. Decodifica base64 e salva em /public/uploads/media/{companyId}/
 *   7. Cria novo registro de Media (ou atualiza se mode=replace)
 *   8. Debita créditos com metadados de auditoria
 *
 * Padrão de chamada OpenAI: fetch nativo (sem SDK), igual ao menuImport.js
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

const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions'
const OPENAI_IMAGE_URL = 'https://api.openai.com/v1/images/generations'
const VISION_MODEL = 'gpt-4o'
const IMAGE_MODEL = 'gpt-image-1'

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

async function getOpenAIKey() {
  const key = await getSetting('openai_api_key', 'OPENAI_API_KEY')
  if (!key) throw Object.assign(new Error('Chave da API OpenAI não configurada. Acesse Painel SaaS → Configurações.'), { statusCode: 503 })
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

    const apiKey = await getOpenAIKey()

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

    // Normaliza para MIME types suportados pelo GPT-4o Vision
    const VALID_MIMES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
    if (!VALID_MIMES.includes(mimeType)) mimeType = 'image/jpeg'

    const imageBase64 = imageBuffer.toString('base64')

    // 4. Analisa o alimento com GPT-4o Vision (fetch nativo)
    const visionRes = await fetch(OPENAI_CHAT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: VISION_MODEL,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: { url: `data:${mimeType};base64,${imageBase64}`, detail: 'high' },
              },
              {
                type: 'text',
                text: `You are a food stylist preparing a description for a realistic food photo recreation.
Describe this exact dish precisely: food type, key ingredients, colors, surface textures (crispy, melted, glossy, saucy, charred, etc.), portion size, any sauces or garnishes visible, and plating style.
If any branded products are visible (e.g., Coca-Cola can, Pepsi bottle, Heinz ketchup, Hellmann's mayonnaise, or any identifiable packaged beverage or condiment), include the exact brand name in the description.
Pay special attention to natural imperfections and irregularities: if the dish contains beans, lentils, rice or other legumes/grains, explicitly describe size variation (some beans whole, some split or broken), color variation (lighter and darker beans mixed), and the broth/sauce texture (cloudy, thick, with fat pools on surface — not perfectly smooth). These irregularities must be mentioned so the recreation avoids a CGI-perfect look.
Be specific about textures and physical appearance. Output ONLY the food description in English, 60-90 words, no intro or commentary.
Example: "A grilled beef smash burger with melted cheddar dripping over the edges, crispy charred crust on the patty, fresh green lettuce, sliced ripe red tomato, yellow mustard and ketchup visible, dill pickles stacked between a lightly toasted sesame seed brioche bun, served beside a pile of thin crispy golden fries with visible seasoning"`,
              },
            ],
          },
        ],
        max_tokens: 150,
      }),
      signal: AbortSignal.timeout(90_000),
    })

    if (!visionRes.ok) {
      const errText = await visionRes.text().catch(() => '')
      throw new Error(`GPT-4o Vision error ${visionRes.status}: ${errText.slice(0, 200)}`)
    }

    const visionData = await visionRes.json()
    const foodDescription = visionData.choices?.[0]?.message?.content?.trim() || 'a delicious food dish'

    // 5. Monta o prompt gpt-image-1 focado em fotorrealismo — evitar look de massa/CGI
    const dallePrompt =
      `A real food photograph taken with a Canon EOS R5 DSLR, 100mm f/2.8 macro lens. ` +
      `Subject: ${foodDescription}. ` +
      `Setting: ${STYLE_PROMPTS[style]}. ` +
      `Composition: ${ANGLE_PROMPTS[angle]}. ` +
      `The food has authentic natural textures — crispy surfaces look genuinely crispy, melted cheese has real drip and pull, sauces have natural sheen, bread has real crust texture. ` +
      `CRITICAL — natural imperfection rule: food must NEVER look perfect or uniform. ` +
      `If beans, lentils, chickpeas or any legumes are present: beans must vary in size (small, medium, large), some must be whole, others visibly split or broken open, color varies from tan to dark brown within the same bowl — they must look like real cooked beans, not identical CGI spheres. ` +
      `If the dish has broth or liquid: the broth surface must be cloudy and organic with natural fat pools or oil droplets floating on top, not a flat mirror-like surface. ` +
      `If rice or grains are present: grains must clump slightly and vary in opacity, not be perfectly separated identical cylinders. ` +
      `Every element of the dish must show authentic variation — no two pieces should be perfectly identical. ` +
      `Natural depth of field, lens focus on the main subject. Real food photography with authentic imperfections. ` +
      `IMPORTANT — branded products rule: if any branded beverage, condiment, or packaged product is part of the scene (e.g., Coca-Cola can, Pepsi bottle, Heinz ketchup, Heinz bottle, Hellmann's jar), you MUST render it with its real and correct brand identity. If rendering the brand accurately is not possible, remove that item completely from the scene — do NOT replace it with a generic, logo-free, or modified-label version. ` +
      `This must look like an actual photograph, not digital art, not CGI, not 3D rendering, not illustration, not painting. ` +
      `Avoid: clay or plastic appearance, artificial smoothness, uniformly perfect food pieces, fake gloss, cartoon style, digital illustration, ` +
      `3D rendered look, studio-fake lighting, neon colors, extra dishes not described, watermarks, human hands, text`

    // 6. Gera a imagem com gpt-image-1 (qualidade alta, retorna base64 diretamente)
    const imageGenRes = await fetch(OPENAI_IMAGE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: IMAGE_MODEL,
        prompt: dallePrompt,
        n: 1,
        size: '1024x1024',
        quality: 'high',
        output_format: 'jpeg',
      }),
      signal: AbortSignal.timeout(120_000),
    })

    if (!imageGenRes.ok) {
      const errText = await imageGenRes.text().catch(() => '')
      throw new Error(`gpt-image-1 error ${imageGenRes.status}: ${errText.slice(0, 300)}`)
    }

    const imageGenData = await imageGenRes.json()
    const b64 = imageGenData.data?.[0]?.b64_json
    if (!b64) throw new Error('gpt-image-1 não retornou imagem')

    // 7. Decodifica base64 (gpt-image-1 retorna bytes diretamente, sem URL para download)
    const generatedBuffer = Buffer.from(b64, 'base64')

    // 8. Salva no disco
    const newId = randomUUID()
    const safeName = `${newId}.jpg`
    const dir = path.join(process.cwd(), 'public', 'uploads', 'media', companyId)
    await fs.promises.mkdir(dir, { recursive: true })
    await fs.promises.writeFile(path.join(dir, safeName), generatedBuffer)
    const newUrl = `/public/uploads/media/${companyId}/${safeName}`

    // 9. Cria ou atualiza registro no banco
    const enhancedFilename = `ai_studio_${style}_${angle}_${media.filename.replace(/^ai_studio_[^_]+_[^_]+_/, '')}`
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
        data: { filename: enhancedFilename, mimeType: 'image/jpeg', size: generatedBuffer.length, url: newUrl, aiEnhanced: true },
      })
    } else {
      resultMedia = await prisma.media.create({
        data: { id: newId, companyId, filename: enhancedFilename, mimeType: 'image/jpeg', size: generatedBuffer.length, url: newUrl, aiEnhanced: true },
      })
    }

    // 10. Debita créditos com metadados completos para auditoria
    await debitCredits(companyId, 'AI_STUDIO_ENHANCE', 1, {
      originalMediaId: mediaId,
      resultMediaId: resultMedia.id,
      style,
      angle,
      mode,
      foodDescription: foodDescription.slice(0, 200),
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

    const apiKey = await getOpenAIKey()

    // Monta o prompt gpt-image-1 a partir da descrição do usuário
    const dallePrompt =
      `A real food photograph taken with a Canon EOS R5 DSLR, 100mm f/2.8 macro lens. ` +
      `Subject: ${descTrimmed}. ` +
      `Setting: ${STYLE_PROMPTS[style]}. ` +
      `Composition: ${ANGLE_PROMPTS[angle]}. ` +
      `Authentic natural food textures, realistic surface imperfections, genuine color rendition. ` +
      `CRITICAL — natural imperfection rule: food must NEVER look perfect or uniform. ` +
      `If beans, lentils, chickpeas or any legumes are present: beans must vary in size (small, medium, large), some must be whole, others visibly split or broken open, color varies from tan to dark brown within the same bowl — they must look like real cooked beans, not identical CGI spheres. ` +
      `If the dish has broth or liquid: the broth surface must be cloudy and organic with natural fat pools or oil droplets floating on top, not a flat mirror-like surface. ` +
      `If rice or grains are present: grains must clump slightly and vary in opacity, not be perfectly separated identical cylinders. ` +
      `Every element of the dish must show authentic variation — no two pieces should be perfectly identical. ` +
      `IMPORTANT — branded products rule: if any branded beverage, condiment, or packaged product is mentioned (e.g., Coca-Cola can, Pepsi bottle, Heinz ketchup, Hellmann's jar), you MUST render it with its real and correct brand identity. If rendering the brand accurately is not possible, remove that item completely from the scene — do NOT replace it with a generic, logo-free, or modified-label version. ` +
      `This must look like an actual photograph, not digital art, not CGI, not 3D rendering, not illustration, not painting. ` +
      `Avoid: clay or plastic appearance, artificial smoothness, uniformly perfect food pieces, fake gloss, cartoon style, digital illustration, ` +
      `3D rendered look, watermarks, human hands, text`

    const imageGenRes = await fetch(OPENAI_IMAGE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: IMAGE_MODEL,
        prompt: dallePrompt,
        n: 1,
        size: '1024x1024',
        quality: 'high',
        output_format: 'jpeg',
      }),
      signal: AbortSignal.timeout(120_000),
    })

    if (!imageGenRes.ok) {
      const errText = await imageGenRes.text().catch(() => '')
      throw new Error(`gpt-image-1 error ${imageGenRes.status}: ${errText.slice(0, 300)}`)
    }

    const imageGenData = await imageGenRes.json()
    const b64 = imageGenData.data?.[0]?.b64_json
    if (!b64) throw new Error('gpt-image-1 não retornou imagem')

    const generatedBuffer = Buffer.from(b64, 'base64')

    const newId = randomUUID()
    const safeName = `${newId}.jpg`
    const dir = path.join(process.cwd(), 'public', 'uploads', 'media', companyId)
    await fs.promises.mkdir(dir, { recursive: true })
    await fs.promises.writeFile(path.join(dir, safeName), generatedBuffer)
    const newUrl = `/public/uploads/media/${companyId}/${safeName}`

    const slug = descTrimmed.slice(0, 40).replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '_').toLowerCase()
    const filename = `ai_gen_${style}_${angle}_${slug || newId.slice(0, 8)}.jpg`

    const resultMedia = await prisma.media.create({
      data: { id: newId, companyId, filename, mimeType: 'image/jpeg', size: generatedBuffer.length, url: newUrl, aiEnhanced: true },
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

export default router
