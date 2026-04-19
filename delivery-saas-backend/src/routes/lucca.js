import express from 'express'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { authMiddleware } from '../auth.js'
import { getSetting } from '../services/systemSettings.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const luccaRouter = express.Router()

// ── Constants ──
const GOOGLE_AI_BASE = 'https://generativelanguage.googleapis.com/v1beta'
const GEMINI_MODEL = 'gemini-2.5-flash'

// ── Cache da knowledge base em memória ──
let cachedKB = null
let systemPromptTemplate = null

function loadKnowledgeBase() {
  if (cachedKB) return { kb: cachedKB, systemPrompt: systemPromptTemplate }

  const kbDir = path.resolve(__dirname, '../../knowledge-base')
  const articles = []

  function readDir(dir) {
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        readDir(full)
      } else if (entry.name.endsWith('.md') && entry.name !== '_system-prompt.md') {
        const relative = path.relative(kbDir, full).replace(/\\/g, '/')
        articles.push(`<!-- ${relative} -->\n${fs.readFileSync(full, 'utf-8')}`)
      }
    }
  }

  const spPath = path.join(kbDir, '_system-prompt.md')
  systemPromptTemplate = fs.existsSync(spPath) ? fs.readFileSync(spPath, 'utf-8') : ''

  readDir(kbDir)
  cachedKB = articles.join('\n\n---\n\n')
  return { kb: cachedKB, systemPrompt: systemPromptTemplate }
}

// ── Rotas ──
luccaRouter.use(authMiddleware)

luccaRouter.post('/chat', async (req, res) => {
  const { message, currentPage, history } = req.body

  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ message: 'message é obrigatório' })
  }

  try {
    const apiKey = await getSetting('google_ai_api_key', 'GOOGLE_AI_API_KEY')
    if (!apiKey) {
      return res.status(503).json({ message: 'Assistente indisponível no momento' })
    }

    const { kb, systemPrompt } = loadKnowledgeBase()
    const resolvedSystemPrompt = systemPrompt.replace('{{currentPage}}', currentPage || 'desconhecida')
    const systemContext = `${resolvedSystemPrompt}\n\n---\n\nBase de Conhecimento do Sistema:\n\n${kb}`

    // Montar histórico no formato Gemini
    const contents = []

    if (Array.isArray(history)) {
      for (const msg of history.slice(-10)) {
        contents.push({
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: msg.content }]
        })
      }
    }

    contents.push({
      role: 'user',
      parts: [{ text: message }]
    })

    const response = await fetch(
      `${GOOGLE_AI_BASE}/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(30_000),
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemContext }] },
          contents,
          generationConfig: { temperature: 0.3 },
        }),
      },
    )

    if (!response.ok) {
      const errBody = await response.text()
      console.error('[Lucca] Gemini API error:', response.status, errBody)
      return res.status(502).json({ message: 'Erro ao consultar o assistente. Tente novamente.' })
    }

    const data = await response.json()
    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || 'Desculpe, não consegui gerar uma resposta.'

    res.json({ reply })
  } catch (e) {
    console.error('[Lucca] Error:', e.message || e)
    res.status(500).json({ message: 'Erro ao processar sua pergunta. Tente novamente.' })
  }
})

luccaRouter.post('/reload-kb', async (req, res) => {
  cachedKB = null
  systemPromptTemplate = null
  res.json({ ok: true, message: 'Knowledge base recarregada' })
})
