// Minimal AI-based parser that calls OpenAI Chat Completions API to transform
// arbitrary Saipos/printRows content into a strict JSON object compatible with
// the system's normalized order shape.
//
// Usage: set environment variable OPENAI_API_KEY with a valid key and
// set USE_AI_PARSER=true to enable. The function returns the parsed object
// or throws on fatal errors.

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

let _getSetting = null;
async function getSettingFn() {
  if (!_getSetting) {
    const mod = await import('./services/systemSettings.js');
    _getSetting = mod.getSetting;
  }
  return _getSetting;
}

async function parseSaiposWithAI(content, filename = 'unknown') {
  const getSetting = await getSettingFn();
  const key = await getSetting('openai_api_key', 'OPENAI_API_KEY');
  if (!key) throw new Error('Chave da API OpenAI não configurada. Acesse Painel SaaS → Configurações.');

  // system prompt: instruct model to return strict JSON only and provide a concrete example
  const system = `You are a parser that receives raw content exported from a POS (Saipos) file
or its printed rows. Your task is to return a single valid JSON object (no surrounding
text) that follows this schema (fields not present should be null or empty arrays):

{
  "id": string|null,
  "displayId": string|null,
  "customer": { "name": string|null, "phones": [{ "number": string }] },
  "delivery": { "deliveryAddress": { "formattedAddress": string|null, "coordinates": { "latitude": number|null, "longitude": number|null } }, "pickupCode": string|null },
  "items": [{ "id": string, "name": string, "quantity": number, "unitPrice": number, "totalPrice": number }],
  "total": { "orderAmount": number },
  "payments": { "prepaid": number, "methods": [{ "value": number, "currency": "BRL", "method": string, "type": string, "prepaid": boolean }] },
  "locator": string|null,            // optional internal locator if present in the input
  "salesChannel": string|null,      // optional sales channel (e.g. "Ifood")
  "raw": any
}

Extraction and normalization rules (apply these exactly):
- Phone: normalize to digits only, remove spaces, parentheses, dashes. Example: "0800 705 1020" -> "08007051020".
- Address: return a human-readable formattedAddress string (street, number, complement, neighborhood, any reference) if present.
- Pickup code: extract numeric pickup/collection code when present (string). Put in delivery.pickupCode.
- Items: return an array with each item's name, integer quantity, unitPrice (number), totalPrice (number). If the printed rows include item modifiers or sub-lines, attach them to the item's name or ignore as separate items.
- Totals: set total.orderAmount as the parsed total value in BRL (decimal using dot as separator).
- Payments: split prepaid amounts (vouchers) from payment methods. Each payment method should include value, currency="BRL", method (use normalized values like "VOUCHER", "CASH", "PAYMENT_ONLINE", "MASTERCARD_DEBIT"), type ("CARD","OFFLINE","OTHER","DISCOUNT"), prepaid boolean.
- Locator and salesChannel: if you find an internal order locator (numeric token) or a sales channel name (e.g. "Ifood", "Site Delivery"), include them in the respective fields; otherwise return null.
- displayId / id: prefer explicit sale number or id present in the printed rows; otherwise use a stable substring of an id if available.

- Numeric formatting (strict): ALWAYS output numeric fields as JSON numbers (not strings). Use dot as decimal separator and do NOT use thousand separators. Prices and amounts must be rounded/normalized to two decimal places (e.g. 19.90). Totals and item prices must be numbers, not strings.
- Phone normalization (strict): ALWAYS normalize phone numbers to digits-only strings (remove spaces, parentheses, dashes, plus signs). Do not include any formatting characters. Example: "0800 705 1020" -> "08007051020".
- Types and post-processing: ensure the following JSON types exactly: 'items[].quantity' (number, integer), 'items[].unitPrice' and 'items[].totalPrice' (number), 'total.orderAmount' (number), 'payments.prepaid' (number), 'payments.methods[].value' (number), 'payments.methods[].prepaid' (boolean). If a value cannot be determined, use null for numbers or false for booleans only when appropriate.

Important: ALWAYS output EXACTLY ONE JSON object and NOTHING ELSE. Do not add explanations, notes, lists or markdown. The JSON must be parseable by a strict JSON.parse().

Now follow the examples below. Use them as canonical mappings from sample inputs to the expected JSON output. Include both the JSON schema example and the following real 'printRows' excerpt example.

Example input (excerpt - structured JSON form):
"""

Example input (real 'printRows' excerpt):
"""
["<barra_mostrar>0</barra_mostrar>","<barra_largura>3</barra_largura>","<barra_altura>120</barra_altura>","</ce><n><e>ENTREGA</e></n>","</ad>28/out - 20:39","</ae>Pedido: <n><a>#73</a></n>","</ae>Chris Lopes","</ae>Telefone: 0800 705 1020, localizador: 65652921","</ae></linha_simples>","</ce>R. Pau Brasil, 101, Casa - Pequi - RefernciaEm Frente Ao Posto De Sade","</ae></linha_simples>","</ae><n>Obs: Desconto do Restaurante: 4.99","</ae>Desconto do Ifood: 11.91","</ae>Bandeira: PIX","</ae>Pago Online","</ae>Telefone: 0800 705 1020, localizador: 65652921","</ae>Fidelidade: 0 compra","</ae>Cdigo de Coleta: 4786","</ae>Entrega para s 21:14</n>","</linha_simples>","</ae>Qt.Descrio                           Valor","</ae></linha_simples>","</ae><n><a>1  Double dog                          19.90</a></n>","</ae>","</ae></linha_simples>","</ae>Quantidade de itens:            <e>     1</e>","</linha_simples>","Total itens(=)                         19,90","Taxa de entrega(+)                      4,99","Acrscimo(+)                            0,00","Desconto(-)                             4,99","TOTAL(=)                               19,90","</linha_simples>","<n><a>Forma de pagamento</a></n>","<in><a>Voucher Parceiro Desconto              11,91</a></in>","<in><a>Pago Online                             7,99</a></in>","</linha_simples>","</ae>","</ae><n>iFood</n> <n>n 7520</n>","</ae><n>Old Dog - Eunpolis</n>","</linha_simples>","Op: IFOOD","</ae><c><n>www.saipos.com</n></c>"," ","</corte_parcial>"]
"""

Example expected JSON output for the 'printRows' excerpt above (ONLY the JSON object):
{
  "id": "73",
  "displayId": "73",
  "customer": { "name": "Chris Lopes", "phones": [{ "number": "08007051020" }] },
  "delivery": { "deliveryAddress": { "formattedAddress": "R. Pau Brasil, 101, Casa - Pequi - Referência Em Frente Ao Posto De Saúde", "coordinates": { "latitude": null, "longitude": null } }, "pickupCode": "4786" },
  "items": [ { "id": "item-1", "name": "Double dog", "quantity": 1, "unitPrice": 19.90, "totalPrice": 19.90 } ],
  "total": { "orderAmount": 19.90 },
  "payments": { "prepaid": 11.91, "methods": [ { "value": 11.91, "currency": "BRL", "method": "VOUCHER", "type": "DISCOUNT", "prepaid": true }, { "value": 7.99, "currency": "BRL", "method": "PAYMENT_ONLINE", "type": "CARD", "prepaid": false } ] },
  "locator": "65652921",
  "salesChannel": "Ifood",
  "raw": null
}
`;

  const user = `Filename: ${filename}\n---BEGIN CONTENT---\n${String(content).slice(0, 20000)}\n---END CONTENT---\n\nPlease parse the content and return the JSON object described in the system prompt.`;

  const model = await getSetting('openai_model', 'OPENAI_MODEL') || 'gpt-4o-mini';
  const body = {
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ],
    temperature: 0,
    max_tokens: 1500
  };

  const res = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`OpenAI API error ${res.status}: ${txt}`);
  }

  const json = await res.json();
  const choice = json?.choices?.[0];
  const text = choice?.message?.content ?? choice?.text ?? null;
  if (!text) throw new Error('OpenAI returned empty response');

  // Try to extract JSON from the model response (it may include wrappers)
  let parsed = null;
  try {
    // If the assistant returned only JSON, parse directly
    parsed = JSON.parse(text);
  } catch (e) {
    // try to find JSON substring
    const m = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (m) {
      try { parsed = JSON.parse(m[0]); } catch (e2) { /* leave parsed null */ }
    }
  }

  // Return both the parsed object (or null) and the raw model text for debugging
  return { parsed, text };
}

export { parseSaiposWithAI };
