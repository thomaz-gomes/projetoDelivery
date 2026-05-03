/**
 * Evaluate whether an entity (product/category/option) is available right now based on
 * { alwaysAvailable, weeklySchedule } plus a timezone for "now".
 *
 * weeklySchedule is expected to be an array of { day: 0..6, enabled, from: 'HH:mm', to: 'HH:mm' }
 * (day 0 = Sunday, matching the frontend).
 */

function nowInTimezone(timezone) {
  const tz = timezone || 'America/Sao_Paulo';
  // Intl DateTimeFormat with explicit parts gives us local Y/M/D/H/M in the target TZ.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date());
  const map = {};
  for (const p of parts) map[p.type] = p.value;
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const day = weekdayMap[map.weekday] ?? 0;
  const hour = parseInt(map.hour, 10) || 0;
  const minute = parseInt(map.minute, 10) || 0;
  return { day, minutes: hour * 60 + minute };
}

function parseHM(str) {
  if (!str || typeof str !== 'string') return null;
  const m = str.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

export function isScheduleOpenNow(weeklySchedule, timezone) {
  if (!Array.isArray(weeklySchedule)) return false;
  const { day, minutes } = nowInTimezone(timezone);
  const slot = weeklySchedule.find(s => s && Number(s.day) === day);
  if (!slot || !slot.enabled) return false;
  const from = parseHM(slot.from);
  const to = parseHM(slot.to);
  if (from == null || to == null) return false;
  if (to <= from) {
    // Crosses midnight: open if after from OR before to (using next day's slot).
    return minutes >= from || minutes < to;
  }
  return minutes >= from && minutes < to;
}

/**
 * Returns true if the entity is available right now.
 * entity = { alwaysAvailable?, weeklySchedule? }
 */
export function isAvailableNow(entity, timezone) {
  if (!entity) return true;
  if (entity.alwaysAvailable === true) return true;
  return isScheduleOpenNow(entity.weeklySchedule, timezone);
}
