/**
 * purchaseImportService.js — Service for importing purchases from NFe XML,
 * AI-based ingredient matching, and receipt photo extraction.
 */

import { parseStringPromise } from 'xml2js';
import { checkCredits, debitCredits } from './aiCreditManager.js';
import { getSetting } from './systemSettings.js';
import { callTextAI } from './aiProvider.js';

const GOOGLE_AI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const GEMINI_MODEL = 'gemini-2.5-flash';

async function getGoogleAIKey() {
  const key = await getSetting('google_ai_api_key', 'GOOGLE_AI_API_KEY');
  if (!key) throw Object.assign(new Error('Chave da API Google AI não configurada.'), { statusCode: 503 });
  return key;
}

// ─── 1. Parse NFe XML ────────────────────────────────────────────────────────

/**
 * Parses an NFe XML string and extracts header info + item details.
 * Handles both <nfeProc> (authorized) and raw <NFe> formats.
 *
 * @param {string} xmlString - Raw XML content
 * @returns {object} Parsed NFe data with accessKey, header fields, and items array
 */
export async function parseNfeXml(xmlString) {
  const parsed = await parseStringPromise(xmlString, {
    explicitArray: false,
    ignoreAttrs: false,
  });

  const nfeProc = parsed.nfeProc || parsed;
  const nfe = nfeProc.NFe || nfeProc;
  const infNFe = nfe.infNFe || {};

  const ide = infNFe.ide || {};
  const emit = infNFe.emit || {};
  const det = infNFe.det;
  const total = infNFe.total?.ICMSTot || {};

  const protNFe = nfeProc.protNFe?.infProt || {};
  const accessKey = protNFe.chNFe || infNFe.$?.Id?.replace('NFe', '') || null;

  const detArray = Array.isArray(det) ? det : det ? [det] : [];

  const items = detArray.map((d) => {
    const prod = d.prod || {};
    return {
      nItem:    d.$.nItem || null,
      cProd:    prod.cProd || '',
      xProd:    prod.xProd || '',
      ncm:      prod.NCM || '',
      cfop:     prod.CFOP || '',
      uCom:     prod.uCom || '',
      qCom:     parseFloat(prod.qCom) || 0,
      vUnCom:   parseFloat(prod.vUnCom) || 0,
      vProd:    parseFloat(prod.vProd) || 0,
    };
  });

  return {
    accessKey,
    nfeNumber:    ide.nNF || null,
    nfeSeries:    ide.serie || null,
    issueDate:    ide.dhEmi ? new Date(ide.dhEmi) : null,
    supplierCnpj: emit.CNPJ || emit.CPF || null,
    supplierName: emit.xNome || null,
    totalValue:   parseFloat(total.vNF) || 0,
    items,
  };
}

// ─── 2. Match Items with AI ──────────────────────────────────────────────────

/**
 * Uses Gemini to match NFe item names with existing ingredients.
 *
 * @param {string} companyId
 * @param {Array} nfeItems - Items extracted from NFe XML
 * @param {Array} existingIngredients - Current ingredient catalog
 * @param {string} userId - User performing the action
 * @returns {Array} Items enriched with matching data
 */
export async function matchItemsWithAI(companyId, nfeItems, existingIngredients, userId) {
  const itemCount = nfeItems.length;
  if (itemCount === 0) return [];

  const check = await checkCredits(companyId, 'NFE_IMPORT_MATCH', itemCount);
  if (!check.ok) {
    const err = new Error(`Créditos insuficientes. Necessário: ${check.totalCost}, Disponível: ${check.balance}`);
    err.statusCode = 402;
    throw err;
  }

  const catalogJson = existingIngredients.map(i => ({
    id: i.id,
    description: i.description,
    unit: i.unit,
    group: i.group?.name || null,
  }));

  const nfeItemsJson = nfeItems.map((it, idx) => ({
    index: idx,
    xProd: it.xProd,
    uCom: it.uCom,
    ncm: it.ncm || '',
  }));

  const systemPrompt = `You are an ingredient matching assistant for a restaurant inventory system.
You receive two lists:
1. "nfeItems" — items from a Brazilian NFe (electronic invoice) with product names (xProd), units (uCom), and NCM codes.
2. "catalog" — existing ingredients in the restaurant's inventory with id, description, unit, and group.

For each NFe item, find the best matching ingredient from the catalog using semantic similarity.
Consider that NFe names are often abbreviated or use commercial names (e.g., "TOMATE CARMEM KG" should match "Tomate").
NCM codes can help disambiguate (e.g., NCM 0702 = tomatoes).

Return a JSON array with one object per NFe item:
{
  "index": <number>,
  "matchedIngredientId": <string UUID or null>,
  "confidence": <number 0-1>,
  "suggestedName": <string — clean name for creating a new ingredient if no match>,
  "suggestedUnit": <string — one of UN, GR, KG, ML, L>
}

Rules:
- confidence >= 0.7 means a good match
- confidence < 0.5 means no match (set matchedIngredientId to null)
- If the catalog is empty, return all with null matchedIngredientId
- Output ONLY the JSON array, no other text`;

  const { text: content, tokenUsage } = await callTextAI(
    'NFE_IMPORT_MATCH',
    systemPrompt,
    JSON.stringify({ nfeItems: nfeItemsJson, catalog: catalogJson }),
    { temperature: 0.1 },
  );
  let matches;
  try {
    const cleaned = (content || '[]').replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    matches = JSON.parse(cleaned);
  } catch {
    matches = nfeItems.map((_, idx) => ({
      index: idx, matchedIngredientId: null, confidence: 0,
      suggestedName: nfeItems[idx].xProd, suggestedUnit: 'UN',
    }));
  }

  await debitCredits(companyId, 'NFE_IMPORT_MATCH', itemCount, {
    source: 'nfe_import', itemCount, tokenUsage,
  }, userId);

  return nfeItems.map((item, idx) => {
    const m = matches.find(x => x.index === idx) || {};
    return {
      ...item,
      matchedIngredientId: m.matchedIngredientId || null,
      confidence: m.confidence || 0,
      suggestedName: m.suggestedName || item.xProd,
      suggestedUnit: m.suggestedUnit || 'UN',
      createNew: false,
    };
  });
}

// ─── 3. Parse Receipt Photo ──────────────────────────────────────────────────

/**
 * Uses Gemini Vision to extract items from receipt photos and match with ingredients.
 *
 * @param {string} companyId
 * @param {string|string[]} base64Images - One or more base64-encoded images
 * @param {Array} existingIngredients - Current ingredient catalog
 * @param {string} userId - User performing the action
 * @returns {Array} Extracted items with matching data
 */
export async function parseReceiptPhoto(companyId, base64Images, existingIngredients, userId) {
  const photoCount = Array.isArray(base64Images) ? base64Images.length : 1;
  const images = Array.isArray(base64Images) ? base64Images : [base64Images];

  const check = await checkCredits(companyId, 'NFE_RECEIPT_PHOTO', photoCount);
  if (!check.ok) {
    const err = new Error(`Créditos insuficientes. Necessário: ${check.totalCost}, Disponível: ${check.balance}`);
    err.statusCode = 402;
    throw err;
  }

  const catalogJson = existingIngredients.map(i => ({
    id: i.id,
    description: i.description,
    unit: i.unit,
    group: i.group?.name || null,
  }));

  const systemPrompt = `You are a receipt/invoice reader for a restaurant inventory system.
Analyze the receipt photo(s) and extract each purchased item line.
Also try to match each item with the existing ingredient catalog provided.

Existing ingredient catalog:
${JSON.stringify(catalogJson)}

For each item found in the receipt, return:
{
  "xProd": <product name as shown on receipt>,
  "qCom": <quantity>,
  "uCom": <unit as shown>,
  "vUnCom": <unit price>,
  "vProd": <total price for this line>,
  "matchedIngredientId": <UUID from catalog or null>,
  "confidence": <0-1>,
  "suggestedName": <clean name for new ingredient>,
  "suggestedUnit": <one of UN, GR, KG, ML, L>
}

Return ONLY a JSON array. Extract ALL visible item lines.`;

  const apiKey = await getGoogleAIKey();

  const imageParts = images.map(img => {
    const isDataUrl = img.startsWith('data:');
    let mimeType = 'image/jpeg';
    let base64Data = img;
    if (isDataUrl) {
      const match = img.match(/^data:(image\/\w+);base64,(.+)$/);
      if (match) {
        mimeType = match[1];
        base64Data = match[2];
      }
    }
    return { inlineData: { mimeType, data: base64Data } };
  });

  const res = await fetch(
    `${GOOGLE_AI_BASE}/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [
          ...imageParts,
          { text: 'Extract all items from this receipt and match with the ingredient catalog.' },
        ] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 4096 },
      }),
    },
  );

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${errBody}`);
  }

  const data = await res.json();
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text || '[]';

  let items;
  try {
    const cleaned = content.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    items = JSON.parse(cleaned);
  } catch {
    items = [];
  }

  await debitCredits(companyId, 'NFE_RECEIPT_PHOTO', photoCount, {
    source: 'receipt_photo', photoCount,
  }, userId);

  return items.map(item => ({
    ...item,
    createNew: false,
  }));
}
