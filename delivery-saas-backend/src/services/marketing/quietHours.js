// src/services/marketing/quietHours.js
//
// Computa quando uma mensagem pode ser enviada respeitando o "horário
// silencioso" do cliente (default 23h–9h). Resolve duas perguntas:
//
//   isInQuietHours(now, params) → bool
//   nextAllowedTime(now, params) → Date (UTC) do próximo instante válido
//
// As janelas atravessam meia-noite (start > end), então a lógica trata
// ambas as ordens. Timezone é usado pra interpretar o relógio do cliente —
// um "23h" em America/Bahia é DIFERENTE de "23h" UTC, então convertemos
// pro fuso antes de comparar.

const DEFAULTS = {
  quietHoursStart: '23:00',
  quietHoursEnd: '09:00',
  timezone: 'America/Sao_Paulo',
}

function parseHHMM(str, fallback) {
  const m = String(str || '').match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return parseHHMM(fallback, '00:00')
  const h = Math.min(23, Math.max(0, parseInt(m[1], 10)))
  const mm = Math.min(59, Math.max(0, parseInt(m[2], 10)))
  return { h, mm }
}

// Retorna {year, month, day, hour, minute} no timezone alvo, derivado do
// `now` UTC. Usa Intl.DateTimeFormat porque Node 18+ tem suporte IANA full.
function partsInTimezone(date, timezone) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  })
  const parts = Object.fromEntries(
    fmt.formatToParts(date).filter(p => p.type !== 'literal').map(p => [p.type, p.value])
  )
  return {
    year: parseInt(parts.year, 10),
    month: parseInt(parts.month, 10),
    day: parseInt(parts.day, 10),
    hour: parseInt(parts.hour === '24' ? '00' : parts.hour, 10),
    minute: parseInt(parts.minute, 10),
    second: parseInt(parts.second, 10),
  }
}

// Volta de {year, month, day, hour, minute} em timezone para um Date UTC.
// Estratégia: monta candidato em UTC, depois ajusta pelo offset do timezone.
function makeDateInTimezone(parts, timezone) {
  // Cria como se fosse UTC pra ter um chute inicial.
  const utcGuess = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0)
  // Descobre que horas seria esse instante UTC no timezone alvo.
  const back = partsInTimezone(new Date(utcGuess), timezone)
  // Diferença entre o que queríamos e o que deu = offset que precisa compensar.
  const desiredMinutes = parts.hour * 60 + parts.minute
  const gotMinutes = back.hour * 60 + back.minute
  let deltaMinutes = desiredMinutes - gotMinutes
  // Tratamento de overflow de dia (ex: pedimos 09:00 mas deu 06:00 = adianta 3h)
  if (deltaMinutes > 12 * 60) deltaMinutes -= 24 * 60
  if (deltaMinutes < -12 * 60) deltaMinutes += 24 * 60
  return new Date(utcGuess + deltaMinutes * 60 * 1000)
}

// `now` é Date UTC. Retorna true se a hora local (no timezone) cai
// dentro do intervalo silencioso.
export function isInQuietHours(now, params = {}) {
  const tz = params.timezone || DEFAULTS.timezone
  const start = parseHHMM(params.quietHoursStart, DEFAULTS.quietHoursStart)
  const end = parseHHMM(params.quietHoursEnd, DEFAULTS.quietHoursEnd)
  const local = partsInTimezone(now, tz)
  const nowMin = local.hour * 60 + local.minute
  const startMin = start.h * 60 + start.mm
  const endMin = end.h * 60 + end.mm
  if (startMin === endMin) return false
  if (startMin < endMin) {
    // Janela "diurna" silenciosa (raro): ex 12:00–18:00
    return nowMin >= startMin && nowMin < endMin
  }
  // Janela atravessa meia-noite: ex 23:00–09:00 → silencioso se >= 23h OU < 09h
  return nowMin >= startMin || nowMin < endMin
}

// Retorna o próximo Date UTC em que está fora do quiet. Se `now` já está
// fora, retorna o próprio `now`. Sempre arredonda para o início da janela
// permitida (o "endTime" do quiet).
export function nextAllowedTime(now, params = {}) {
  if (!isInQuietHours(now, params)) return now
  const tz = params.timezone || DEFAULTS.timezone
  const end = parseHHMM(params.quietHoursEnd, DEFAULTS.quietHoursEnd)
  const local = partsInTimezone(now, tz)
  const nowMin = local.hour * 60 + local.minute
  const endMin = end.h * 60 + end.mm

  // Se `now` está depois da hora de "fim do silêncio" do MESMO dia,
  // então o "fim" é amanhã. Caso contrário, é hoje.
  // Ex: agora 02:00 (silencioso porque < 09:00) → fim hoje 09:00.
  // Ex: agora 23:30 (silencioso porque >= 23:00) → fim amanhã 09:00.
  let targetParts
  if (nowMin >= endMin) {
    // amanhã
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000)
    const tParts = partsInTimezone(tomorrow, tz)
    targetParts = { year: tParts.year, month: tParts.month, day: tParts.day, hour: end.h, minute: end.mm }
  } else {
    // hoje
    targetParts = { year: local.year, month: local.month, day: local.day, hour: end.h, minute: end.mm }
  }
  return makeDateInTimezone(targetParts, tz)
}

export const QUIET_HOURS_DEFAULTS = DEFAULTS
