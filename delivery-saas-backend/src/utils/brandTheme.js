export function resolveTheme(themes, themeId, storeId) {
  if (!Array.isArray(themes) || themes.length === 0) return null
  if (themeId) {
    const t = themes.find(x => x.id === themeId)
    if (t) return t
  }
  if (storeId) {
    const t = themes.find(x => x.storeId === storeId && x.isActive !== false)
    if (t) return t
  }
  const def = themes.find(x => x.isDefault === true && x.storeId === null && x.isActive !== false)
  return def || null
}

export function buildThemeBlock(theme) {
  if (!theme) return ''
  const lines = []
  if (theme.palette) lines.push(`- Palette: ${theme.palette}`)
  if (theme.mood) lines.push(`- Mood: ${theme.mood}`)
  if (theme.surface) lines.push(`- Surface: ${theme.surface}`)
  if (theme.lighting) lines.push(`- Lighting: ${theme.lighting}`)
  if (theme.props) lines.push(`- Props to consider: ${theme.props}`)
  if (lines.length === 0) return ''
  return [
    'BRAND THEME (apply consistently across all scenes):',
    ...lines,
  ].join('\n')
}

export function buildLessonsBlock(text) {
  if (!text || !String(text).trim()) return ''
  return [
    'LESSONS LEARNED FROM PAST FEEDBACK (apply when relevant):',
    String(text).trim(),
  ].join('\n')
}
