// Shared neighborhood-name matching utilities.
//
// Before this util, three call sites (riderAccount.js, orders.js retroactive
// fees, neighborhoods.js POST /match) each did slightly different things —
// case-insensitive equality, substring contains, etc. — which produced the
// user-visible bug "às vezes 'Centro' bate, às vezes não".
//
// Frontend (PublicMenu.vue) already normalizes aggressively: trim → lowercase
// → strip accents (NFD) → remove non-alphanumeric. We mirror that here so the
// same neighborhood name behaves identically on every surface.

// Strict normalize: collapses to bare alphanumeric. Best for exact-equality
// matching across two strings that may differ in accents, punctuation or
// whitespace.
export function normalizeForMatch(s) {
  if (s == null) return '';
  try {
    return String(s)
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '') // accents
      .replace(/[^a-z0-9]+/g, '');     // punctuation / spaces
  } catch (e) {
    return String(s || '').trim().toLowerCase();
  }
}

// Soft normalize: keeps spaces. Used for substring containment, where the
// input may be a phrase like "Centro, Eunápolis - BA" and we want to find
// the neighborhood name inside it.
export function softNormalizeForMatch(s) {
  if (s == null) return '';
  try {
    return String(s)
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/\s+/g, ' '); // collapse whitespace runs (incl. NBSP via \s)
  } catch (e) {
    return String(s || '').trim().toLowerCase();
  }
}

export function parseAliases(aliases) {
  if (!aliases) return [];
  if (Array.isArray(aliases)) return aliases;
  try {
    const parsed = JSON.parse(aliases);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

// Try to match a candidate text to one of the company's configured
// neighborhoods. Strategy:
//   1. Strict normalized equality against name or any alias.
//   2. If still unmatched, soft-normalized substring containment (candidate
//      contains the neighborhood name or alias) — handles geocoded strings
//      like "Centro, Eunápolis - BA".
// In the substring phase we iterate longest-name-first so "Novo Centro" wins
// over "Centro" when the candidate contains both.
export function findNeighborhoodMatch(neighborhoods, candidate) {
  if (!candidate || !Array.isArray(neighborhoods) || neighborhoods.length === 0) return null;

  const strict = normalizeForMatch(candidate);
  if (strict) {
    for (const n of neighborhoods) {
      if (!n?.name) continue;
      if (normalizeForMatch(n.name) === strict) return n;
      const aliases = parseAliases(n.aliases);
      if (aliases.some((a) => normalizeForMatch(a) === strict)) return n;
    }
  }

  const soft = softNormalizeForMatch(candidate);
  if (!soft) return null;
  const sorted = [...neighborhoods].sort((a, b) => (b?.name?.length || 0) - (a?.name?.length || 0));
  for (const n of sorted) {
    if (!n?.name) continue;
    const nameSoft = softNormalizeForMatch(n.name);
    if (nameSoft && soft.includes(nameSoft)) return n;
    const aliases = parseAliases(n.aliases);
    for (const a of aliases) {
      const aSoft = softNormalizeForMatch(a);
      if (aSoft && soft.includes(aSoft)) return n;
    }
  }
  return null;
}
