// src/messaging/phoneVariants.js
// Helpers for normalizing and generating lookup variants of Brazilian
// WhatsApp phone numbers. Brazilian mobile numbers historically came in
// two forms: 55 + DDD(2) + 9XXXXXXXX (13 digits, with the 9th digit) or
// 55 + DDD(2) + XXXXXXXX (12 digits, legacy). WhatsApp/Meta may surface
// either form depending on when the contact was registered, so we look
// up customers/conversations against both variants.

export function normalizePhone(raw) {
  const digits = String(raw).replace(/\D/g, '')
  if (digits.startsWith('55')) return digits
  return '55' + digits
}

export function phoneVariants(phone) {
  const n = normalizePhone(phone)
  const out = new Set([n])
  if (n.length === 13) {
    // has 9th digit: also produce without-9 variant
    out.add(n.slice(0, 4) + n.slice(5))
  } else if (n.length === 12) {
    // missing 9th digit: also produce with-9 variant
    out.add(n.slice(0, 4) + '9' + n.slice(4))
  }
  return Array.from(out)
}
