// List of iFood cancellation codes and helpers
const CODES = {
  '501': 'PROBLEMAS DE SISTEMA',
  '502': 'PEDIDO EM DUPLICIDADE',
  '503': 'ITEM INDISPONÍVEL',
  '504': 'RESTAURANTE SEM MOTOBOY',
  '505': 'CARDÁPIO DESATUALIZADO',
  '506': 'PEDIDO FORA DA ÁREA DE ENTREGA',
  '507': 'CLIENTE GOLPISTA / TROTE',
  '508': 'FORA DO HORÁRIO DO DELIVERY',
  '509': 'DIFICULDADES INTERNAS DO RESTAURANTE',
  '511': 'ÁREA DE RISCO',
  '512': 'RESTAURANTE ABRIRÁ MAIS TARDE'
};

function findByReason(reason) {
  if (!reason) return null;
  const r = String(reason).trim().toUpperCase();
  for (const [k, v] of Object.entries(CODES)) {
    if (String(v).toUpperCase() === r) return { code: k, reason: v };
  }
  return null;
}

function normalizeCancellationCode(input) {
  // Accept numeric code, numeric string, or reason string
  if (input == null) return null;
  const s = String(input).trim();
  const sl = s.toLowerCase();
  if (sl === 'undefined' || sl === 'null' || sl === 'nan' || sl === '') return null;
  // numeric
  if (/^\d+$/.test(s)) {
    const code = s;
    const reason = CODES[code] || null;
    return { code, reason };
  }
  // Try match reason
  const byReason = findByReason(s);
  if (byReason) return byReason;
  // nothing matched — return null to allow caller to fallback
  return null;
}

export { CODES, normalizeCancellationCode };
