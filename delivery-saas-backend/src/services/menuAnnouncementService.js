const HEX = /^#[0-9A-Fa-f]{6}$/

const LIMITS = {
  popupTitle: 100,
  popupMessage: 500,
  popupButtonText: 100,
  popupCtaLabel: 100,
  bannerText: 200,
}

function isValidUrl(s) {
  try { const u = new URL(s); return u.protocol === 'http:' || u.protocol === 'https:' }
  catch { return false }
}

function stripTags(s) {
  if (typeof s !== 'string') return s
  return s.replace(/<[^>]*>/g, '').trim()
}

export function validateAnnouncementInput(input) {
  if (input.bannerBgColor != null && !HEX.test(input.bannerBgColor)) {
    return { ok: false, error: 'bannerBgColor must be #RRGGBB hex' }
  }
  if (input.popupCtaUrl != null && input.popupCtaUrl !== '' && !isValidUrl(input.popupCtaUrl)) {
    return { ok: false, error: 'popupCtaUrl must be a valid http(s) URL' }
  }
  for (const [field, max] of Object.entries(LIMITS)) {
    const v = input[field]
    if (typeof v === 'string' && v.length > max) {
      return { ok: false, error: `${field} exceeds ${max} chars` }
    }
  }
  return { ok: true }
}

export function sanitizeAnnouncementInput(input) {
  const out = { ...input }
  for (const f of ['popupTitle', 'popupMessage', 'popupButtonText', 'popupCtaLabel', 'bannerText']) {
    if (f in out) out[f] = stripTags(out[f])
  }
  return out
}

export function buildPublicAnnouncement(row) {
  if (!row) return null
  if (!row.popupEnabled && !row.bannerEnabled) return null
  const out = {
    popupEnabled: !!row.popupEnabled,
    bannerEnabled: !!row.bannerEnabled,
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
  }
  if (row.popupEnabled) {
    out.popupTitle = row.popupTitle || null
    out.popupMessage = row.popupMessage || ''
    out.popupButtonText = row.popupButtonText || null
    out.popupCtaUrl = row.popupCtaUrl || null
    out.popupCtaLabel = row.popupCtaLabel || null
    out.popupImageUrl = row.popupImageUrl || null
  }
  if (row.bannerEnabled) {
    out.bannerText = row.bannerText || ''
    out.bannerBgColor = row.bannerBgColor || null
  }
  return out
}
