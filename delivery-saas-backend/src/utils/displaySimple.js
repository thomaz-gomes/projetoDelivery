import { prisma } from '../prisma.js';

/**
 * Returns the UTC timestamp corresponding to midnight in the given IANA timezone
 * for the current moment. Used to correctly scope the daily order counter without
 * resetting at UTC midnight instead of local midnight.
 *
 * Example: at 21:04 BRT (UTC-3) this returns 2026-04-30T03:00:00Z, which is
 * midnight BRT — NOT midnight UTC (which would be 2026-05-01T00:00:00Z and would
 * cause a premature counter reset).
 */
export function startOfDayInTz(tz) {
  const timezone = tz || 'America/Sao_Paulo';
  const now = new Date();
  // Get current HH:MM:SS in the target timezone, then subtract those seconds from now.
  const timeStr = now.toLocaleTimeString('en-GB', { timeZone: timezone, hour12: false });
  const [h, m, s] = timeStr.split(':').map(Number);
  return new Date(now.getTime() - ((h * 3600 + m * 60 + s) * 1000 + now.getMilliseconds()));
}

/**
 * Same as startOfDayInTz but for an arbitrary past date — used when computing
 * the display number for an already-created order that lacks a persisted value.
 */
export function startOfDayForDateInTz(date, tz) {
  const timezone = tz || 'America/Sao_Paulo';
  const timeStr = date.toLocaleTimeString('en-GB', { timeZone: timezone, hour12: false });
  const [h, m, s] = timeStr.split(':').map(Number);
  return new Date(date.getTime() - ((h * 3600 + m * 60 + s) * 1000 + date.getMilliseconds()));
}

/**
 * Compute the next per-day sequential number for a new order.
 * Returns an integer (e.g. 1, 2, 3...) to persist as displaySimple.
 * Accepts an optional timezone string; if omitted it is fetched from the company.
 */
export async function nextDisplaySimple(companyId, timezone) {
  let tz = timezone;
  if (!tz) {
    try {
      const c = await prisma.company.findUnique({ where: { id: companyId }, select: { timezone: true } });
      tz = c?.timezone;
    } catch (e) { /* fallback to default */ }
  }
  const startOfDay = startOfDayInTz(tz);
  const count = await prisma.order.count({
    where: { companyId, createdAt: { gte: startOfDay } },
  });
  return count + 1;
}
