/**
 * aiProvider.js — Unified text/vision AI caller.
 *
 * Routes AI calls to the correct provider (Gemini or OpenAI) based on
 * a per-service configuration stored in SystemSetting `ai_provider_map`.
 */

import { getSetting } from './systemSettings.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const GOOGLE_AI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const GEMINI_MODEL   = 'gemini-2.5-flash';
const OPENAI_URL     = 'https://api.openai.com/v1/chat/completions';

const DEFAULT_PROVIDER_MAP = {
  NFE_IMPORT_MATCH:            'gemini',
  MENU_IMPORT_ITEM:            'openai',
  MENU_IMPORT_LINK:            'openai',
  MENU_IMPORT_PHOTO:           'openai',
  MENU_IMPORT_PLANILHA:        'openai',
  INGREDIENT_IMPORT_PARSE:     'openai',
  INGREDIENT_IMPORT_ITEM:      'openai',
  TECHNICAL_SHEET_IMPORT_PARSE:'openai',
  TECHNICAL_SHEET_IMPORT_ITEM: 'openai',
  GENERATE_DESCRIPTION:        'gemini',
  POS_PARSER:                  'openai',
};

// ─── Internal helpers ────────────────────────────────────────────────────────

async function getGeminiKey() {
  const key = await getSetting('google_ai_api_key', 'GOOGLE_AI_API_KEY');
  if (!key) {
    throw Object.assign(
      new Error('Chave da API Google AI não configurada.'),
      { statusCode: 503 },
    );
  }
  return key;
}

async function getOpenAIKey() {
  const key = await getSetting('openai_api_key', 'OPENAI_API_KEY');
  if (!key) {
    throw Object.assign(
      new Error('Chave da API OpenAI não configurada.'),
      { statusCode: 503 },
    );
  }
  return key;
}

async function getOpenAIModel() {
  return (await getSetting('openai_model', 'OPENAI_MODEL')) || 'gpt-4o-mini';
}

// ─── Gemini callers ──────────────────────────────────────────────────────────

async function geminiText(systemPrompt, userContent, opts) {
  const { temperature = 0.2, maxTokens, timeoutMs = 60_000 } = opts;
  const apiKey = await getGeminiKey();

  const generationConfig = { temperature };
  if (maxTokens) generationConfig.maxOutputTokens = maxTokens;

  const res = await fetch(
    `${GOOGLE_AI_BASE}/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userContent }] }],
        generationConfig,
      }),
    },
  );

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${errBody}`);
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const usage = data.usageMetadata;
  return {
    text,
    tokenUsage: {
      provider: 'gemini',
      model: GEMINI_MODEL,
      inputTokens: usage?.promptTokenCount || 0,
      outputTokens: usage?.candidatesTokenCount || 0,
      totalTokens: usage?.totalTokenCount || 0,
    },
  };
}

async function geminiVision(systemPrompt, textPrompt, imageBase64, mimeType, opts) {
  const { temperature = 0.2, maxTokens = 400, timeoutMs = 30_000 } = opts;
  const apiKey = await getGeminiKey();

  const body = {
    contents: [{
      role: 'user',
      parts: [
        { inlineData: { mimeType, data: imageBase64 } },
        { text: textPrompt },
      ],
    }],
    generationConfig: { temperature, maxOutputTokens: maxTokens },
  };
  if (systemPrompt) {
    body.systemInstruction = { parts: [{ text: systemPrompt }] };
  }

  const res = await fetch(
    `${GOOGLE_AI_BASE}/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify(body),
    },
  );

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${errBody}`);
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const usage = data.usageMetadata;
  return {
    text,
    tokenUsage: {
      provider: 'gemini',
      model: GEMINI_MODEL,
      inputTokens: usage?.promptTokenCount || 0,
      outputTokens: usage?.candidatesTokenCount || 0,
      totalTokens: usage?.totalTokenCount || 0,
    },
  };
}

// ─── OpenAI callers ──────────────────────────────────────────────────────────

async function openaiText(systemPrompt, userContent, opts) {
  const { temperature = 0.2, maxTokens, timeoutMs = 60_000 } = opts;
  const apiKey = await getOpenAIKey();
  const model  = await getOpenAIModel();

  const body = {
    model,
    temperature,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userContent },
    ],
  };
  if (maxTokens) body.max_tokens = maxTokens;

  const res = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`OpenAI API error ${res.status}: ${errBody}`);
  }

  const data = await res.json();
  const usage = data.usage;

  const choice = data.choices?.[0];
  if (choice?.finish_reason === 'length') {
    console.warn('[aiProvider] OpenAI response truncated (finish_reason=length)');
  }

  const text = choice?.message?.content || '';
  return {
    text,
    tokenUsage: {
      provider: 'openai',
      model,
      inputTokens: usage?.prompt_tokens || 0,
      outputTokens: usage?.completion_tokens || 0,
      totalTokens: usage?.total_tokens || 0,
    },
  };
}

async function openaiVision(systemPrompt, textPrompt, imageBase64, mimeType, opts) {
  const { temperature = 0.2, maxTokens = 400, timeoutMs = 30_000 } = opts;
  const apiKey = await getOpenAIKey();
  const model  = await getOpenAIModel();

  const dataUri = `data:${mimeType};base64,${imageBase64}`;

  const messages = [];
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }
  messages.push({
    role: 'user',
    content: [
      { type: 'text', text: textPrompt },
      { type: 'image_url', image_url: { url: dataUri } },
    ],
  });

  const body = {
    model,
    temperature,
    max_tokens: maxTokens,
    messages,
  };

  const res = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`OpenAI API error ${res.status}: ${errBody}`);
  }

  const data = await res.json();
  const usage = data.usage;

  const choice = data.choices?.[0];
  if (choice?.finish_reason === 'length') {
    console.warn('[aiProvider] OpenAI vision response truncated (finish_reason=length)');
  }

  const text = choice?.message?.content || '';
  return {
    text,
    tokenUsage: {
      provider: 'openai',
      model,
      inputTokens: usage?.prompt_tokens || 0,
      outputTokens: usage?.completion_tokens || 0,
      totalTokens: usage?.total_tokens || 0,
    },
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Returns the configured provider for a given service key.
 * @param {string} serviceKey - e.g. 'NFE_IMPORT_MATCH', 'MENU_IMPORT_ITEM'
 * @returns {Promise<'gemini'|'openai'>}
 */
export async function getProviderForService(serviceKey) {
  const raw = await getSetting('ai_provider_map');
  if (raw) {
    try {
      const map = JSON.parse(raw);
      if (map[serviceKey]) return map[serviceKey];
    } catch { /* ignore bad JSON, fall through to defaults */ }
  }
  return DEFAULT_PROVIDER_MAP[serviceKey] || 'openai';
}

/**
 * Sends a text prompt to the AI provider configured for the given service.
 * @param {string} serviceKey
 * @param {string} systemPrompt
 * @param {string} userContent
 * @param {{ temperature?: number, maxTokens?: number, timeoutMs?: number }} [options]
 * @returns {Promise<{ text: string, tokenUsage: { provider: string, model: string, inputTokens: number, outputTokens: number, totalTokens: number } }>}
 */
export async function callTextAI(serviceKey, systemPrompt, userContent, options = {}) {
  const provider = await getProviderForService(serviceKey);
  return provider === 'gemini'
    ? geminiText(systemPrompt, userContent, options)
    : openaiText(systemPrompt, userContent, options);
}

/**
 * Sends a text + image prompt to the AI provider configured for the given service.
 * @param {string} serviceKey
 * @param {string} systemPrompt - System-level instructions (or null/empty to skip)
 * @param {string} textPrompt - User-level text prompt sent alongside the image
 * @param {string} imageBase64 - Raw base64 string (no data: prefix)
 * @param {string} mimeType - e.g. 'image/jpeg', 'image/png'
 * @param {{ temperature?: number, maxTokens?: number, timeoutMs?: number }} [options]
 * @returns {Promise<{ text: string, tokenUsage: { provider: string, model: string, inputTokens: number, outputTokens: number, totalTokens: number } }>}
 */
export async function callVisionAI(serviceKey, systemPrompt, textPrompt, imageBase64, mimeType, options = {}) {
  const provider = await getProviderForService(serviceKey);
  return provider === 'gemini'
    ? geminiVision(systemPrompt, textPrompt, imageBase64, mimeType, options)
    : openaiVision(systemPrompt, textPrompt, imageBase64, mimeType, options);
}
