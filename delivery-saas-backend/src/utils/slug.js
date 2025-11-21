// src/utils/slug.js
export function normalizeSlug(v){
  return String(v || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function isValidSlug(s){
  if (!s || typeof s !== 'string') return false
  // only allow a-z0-9 and single dashes between segments
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s)
}

const RESERVED = new Set(['public','api','admin','login','order','orders','menu'])
export function isReservedSlug(s){
  if (!s) return false
  return RESERVED.has(String(s).toLowerCase())
}
