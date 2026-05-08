/**
 * Timezone-aware date helpers for queries and aggregations that depend on the
 * user's calendar day. The Node container runs in UTC by default, so plain
 * `new Date('2026-05-07')` parses as UTC midnight (= 21:00 BRT of the previous
 * day) and `date.toISOString().slice(0, 10)` returns the UTC calendar day.
 * For Brazilian businesses that means orders placed between 21:00 and 23:59
 * BRT get attributed to the next day's bucket — and the user's selected
 * "today" date filter starts 3h late.
 *
 * These helpers honor an explicit IANA timezone (defaulting to America/Sao_Paulo)
 * so the math is correct regardless of the container's clock.
 */

const DEFAULT_TZ = 'America/Sao_Paulo';

/**
 * Computes the offset of `tz` from UTC at the given Date, in milliseconds.
 * Positive when east of UTC, negative when west. Re-evaluated per Date so
 * historical DST transitions (irrelevant for Brazil since 2019, but useful
 * for other timezones) are handled correctly.
 */
function tzOffsetMs(date, tz) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts = dtf.formatToParts(date).reduce((acc, p) => {
    if (p.type !== 'literal') acc[p.type] = p.value;
    return acc;
  }, {});
  const localizedAsUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return localizedAsUtc - date.getTime();
}

/**
 * Parse "YYYY-MM-DD" as the start of that calendar day in the given timezone.
 * Returns a Date pointing at 00:00 local (= 03:00 UTC for BRT).
 *
 * Use for the lower bound of date-range filters from frontend date pickers.
 */
export function startOfDayInTz(yyyymmdd, tz = DEFAULT_TZ) {
  const [y, m, d] = String(yyyymmdd).split('-').map(Number);
  if (!y || !m || !d) throw new Error(`Invalid date: ${yyyymmdd}`);
  const utcGuess = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  const offset = tzOffsetMs(utcGuess, tz);
  return new Date(utcGuess.getTime() - offset);
}

/**
 * End of the calendar day in the given timezone (23:59:59.999 local).
 * Use for the upper bound of date-range filters.
 */
export function endOfDayInTz(yyyymmdd, tz = DEFAULT_TZ) {
  return new Date(startOfDayInTz(yyyymmdd, tz).getTime() + 24 * 60 * 60 * 1000 - 1);
}

/**
 * Format a Date as "YYYY-MM-DD" in the given timezone calendar.
 * Use for grouping aggregate data by day. Avoids the trap of
 * `date.toISOString().slice(0, 10)` returning the UTC day.
 */
export function dayKeyInTz(date, tz = DEFAULT_TZ) {
  const d = date instanceof Date ? date : new Date(date);
  // 'en-CA' produces "YYYY-MM-DD" format for date-only formatting.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

/**
 * Iterate calendar days (in the given timezone) from `fromKey` to `toKey`
 * inclusive, returning each day as "YYYY-MM-DD".
 */
export function listDayKeysInTz(fromKey, toKey, tz = DEFAULT_TZ) {
  const out = [];
  let cursor = startOfDayInTz(fromKey, tz);
  const end = startOfDayInTz(toKey, tz);
  while (cursor.getTime() <= end.getTime()) {
    out.push(dayKeyInTz(cursor, tz));
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
  }
  return out;
}
