// src/messaging/phoneVariants.js
// Helpers for normalizing and generating lookup variants of Brazilian
// WhatsApp phone numbers. Brazilian mobile numbers historically came in
// two forms: 55 + DDD(2) + 9XXXXXXXX (13 digits, with the 9th digit) or
// 55 + DDD(2) + XXXXXXXX (12 digits, legacy). WhatsApp/Meta may surface
// either form depending on when the contact was registered, so we look
// up customers/conversations against both variants.
//
// Legacy rows (created before the messaging refactor) may also have been
// stored without the country prefix at all — e.g. `7391429676` (10) or
// `73991429676` (11). We've confirmed ~3k such Customer rows in prod,
// so phoneVariants also emits the no-DDI forms to keep customer lookup
// working until a backfill migration normalises everything to 13 digits.
// This mirrors the OLD webhookEvolution.js#processSingleMessage variant set.

export function normalizePhone(raw) {
  const digits = String(raw).replace(/\D/g, '')
  if (digits.startsWith('55')) return digits
  return '55' + digits
}

export function phoneVariants(phone) {
  const n = normalizePhone(phone)
  const out = new Set([n])

  if (n.length === 13) {
    // 55 + DDD(2) + 9 + 8 digits  →  also emit without the 9th digit
    const without9 = n.slice(0, 4) + n.slice(5)
    out.add(without9)
    // No-DDI variants (legacy rows)
    out.add(n.slice(2))       // DDD + 9 + 8 digits  (11)
    out.add(without9.slice(2)) // DDD + 8 digits      (10)
  } else if (n.length === 12) {
    // 55 + DDD(2) + 8 digits  →  also emit with the 9th digit
    const with9 = n.slice(0, 4) + '9' + n.slice(4)
    out.add(with9)
    // No-DDI variants (legacy rows)
    out.add(n.slice(2))       // DDD + 8 digits      (10)
    out.add(with9.slice(2))   // DDD + 9 + 8 digits  (11)
  }

  return Array.from(out)
}
