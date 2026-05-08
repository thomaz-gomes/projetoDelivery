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

/**
 * Hour of the day (0..23) for `date` in the given timezone.
 * `Date.prototype.getHours()` uses the server's local clock — which is UTC
 * inside the container — so a sale at 22:00 BRT would report as 01:00.
 */
export function hourInTz(date, tz = DEFAULT_TZ) {
  const d = date instanceof Date ? date : new Date(date);
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour: '2-digit', hourCycle: 'h23',
  });
  return Number(fmt.format(d));
}

/**
 * Weekday (0=Sunday..6=Saturday) for `date` in the given timezone.
 */
export function weekdayInTz(date, tz = DEFAULT_TZ) {
  const d = date instanceof Date ? date : new Date(date);
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' });
  const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[fmt.format(d)];
}

/**
 * Time of day formatted as "HH:MM" (24h) for `date` in the given timezone.
 * Useful to compare against deadline strings like "09:00".
 */
export function timeStrInTz(date, tz = DEFAULT_TZ) {
  const d = date instanceof Date ? date : new Date(date);
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(d);
}

/**
 * Resolve a `{ from, to }` date range from a query object with optional
 * `dateFrom`/`dateTo` (or `from`/`to`) string filters. Defaults: first day of
 * the current month through "now" — both relative to the given timezone.
 */
export function parseDateRangeFromQuery(query = {}, tz = DEFAULT_TZ, opts = {}) {
  const fromKey = opts.fromKeyName || 'dateFrom';
  const toKey = opts.toKeyName || 'dateTo';
  const fromAlt = opts.fromKeyAlt || 'from';
  const toAlt = opts.toKeyAlt || 'to';
  const todayKey = dayKeyInTz(new Date(), tz);
  const defaultFrom = opts.defaultFromKey || `${todayKey.slice(0, 7)}-01`;
  const defaultTo = opts.defaultToKey || todayKey;
  const fromStr = String(query[fromKey] || query[fromAlt] || defaultFrom);
  const toStr = String(query[toKey] || query[toAlt] || defaultTo);
  return {
    from: startOfDayInTz(fromStr, tz),
    to: endOfDayInTz(toStr, tz),
    fromKey: fromStr,
    toKey: toStr,
  };
}

/**
 * Get the previous period of equal length immediately before `[from, to]`,
 * useful for week-over-week / month-over-month comparisons.
 */
export function previousPeriod(from, to) {
  const span = to.getTime() - from.getTime();
  const prevTo = new Date(from.getTime() - 1);
  const prevFrom = new Date(prevTo.getTime() - span);
  return { from: prevFrom, to: prevTo };
}
